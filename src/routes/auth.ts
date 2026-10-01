import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ─────────────────────────────────────────────
// OTP generation & dev-mode helpers
// ─────────────────────────────────────────────
function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateFakeCode(): string {
  return '123456';
}

/**
 * Decide whether to allow dev OTPs.
 * - If ALLOW_DEV_OTP=true → yes (explicit opt-in)
 * - If NODE_ENV is NOT production → yes (local dev)
 * - Otherwise → no (real production)
 */
function shouldAllowDevOtp(): boolean {
  return (
    process.env.ALLOW_DEV_OTP === 'true' ||
    process.env.NODE_ENV !== 'production'
  );
}

// ─────────────────────────────────────────────
// POST /api/auth/send-otp
// ─────────────────────────────────────────────
const sendOtpSchema = z.object({
  phone: z.string().min(7),
});

router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = sendOtpSchema.parse(req.body);

    const allowDev = shouldAllowDevOtp();
    const code = allowDev ? generateFakeCode() : generateOtp();

    // Delete any existing OTPs for this phone
    await prisma.otp.deleteMany({ where: { phone } });

    // Create new OTP valid for 5 minutes
    await prisma.otp.create({
      data: {
        phone,
        code,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    // TODO: Send real SMS here (Africa's Talking, Twilio, etc.)
    // For now, just log it so we can see it in Railway/terminal logs.
    console.log(`[OTP] Phone: ${phone} | Code: ${code} | DevMode: ${allowDev}`);

    return res.json({
      success: true,
      message: 'OTP sent',
      // Only expose the code when dev mode is active
      devCode: allowDev ? code : undefined,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/verify-otp
// ─────────────────────────────────────────────
const verifyOtpSchema = z.object({
  phone: z.string().min(7),
  code: z.string().length(6),
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code } = verifyOtpSchema.parse(req.body);

    const otp = await prisma.otp.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      return res
        .status(400)
        .json({ error: 'No OTP found. Request a new one.' });
    }

    if (otp.expiresAt < new Date()) {
      return res
        .status(400)
        .json({ error: 'OTP expired. Request a new one.' });
    }

    if (otp.code !== code) {
      await prisma.otp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Code is correct — delete it
    await prisma.otp.delete({ where: { id: otp.id } });

    // Find or create user
    let user = await prisma.user.findUnique({ where: { phone } });
    const isNewUser = !user;

    if (!user) {
      user = await prisma.user.create({
        data: { phone },
      });
    }

    // Issue JWT
    const token = signToken({ userId: user.id, phone: user.phone });

    return res.json({
      success: true,
      token,
      isNewUser,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        kycStatus: user.kycStatus,
        creditScore: user.creditScore,
        hasPin: !!user.pinHash,
      },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/set-pin  (protected)
// ─────────────────────────────────────────────
const setPinSchema = z.object({
  pin: z.string().length(4).regex(/^\d+$/, 'PIN must be digits'),
});

router.post('/set-pin', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { pin } = setPinSchema.parse(req.body);

    const pinHash = await bcrypt.hash(pin, 10);

    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { pinHash },
    });

    return res.json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'PIN must be 4 digits' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/login-pin  (protected)
// ─────────────────────────────────────────────
router.post('/login-pin', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { pin } = setPinSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    if (!user || !user.pinHash) {
      return res.status(400).json({ error: 'No PIN set' });
    }

    const ok = await bcrypt.compare(pin, user.pinHash);
    if (!ok) {
      return res.status(400).json({ error: 'Wrong PIN' });
    }

    return res.json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'PIN must be 4 digits' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;