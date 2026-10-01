import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ─────────────────────────────────────────────
// GET /api/guarantors — list my guarantors
// ─────────────────────────────────────────────
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const guarantors = await prisma.guarantor.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'asc' },
    });

    return res.json({ guarantors });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/guarantors — add a guarantor
// ─────────────────────────────────────────────
const addSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(7),
  email: z.string().email().optional(),
  relationship: z.string().min(2).max(50),
  idNumber: z.string().min(4).max(50).optional(),
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = addSchema.parse(req.body);

    // Check count — max 2
    const count = await prisma.guarantor.count({
      where: { userId: req.user!.userId },
    });

    if (count >= 2) {
      return res
        .status(400)
        .json({ error: 'Maximum of 2 guarantors allowed' });
    }

    // Prevent duplicate phone
    const existing = await prisma.guarantor.findFirst({
      where: { userId: req.user!.userId, phone: data.phone },
    });

    if (existing) {
      return res
        .status(400)
        .json({ error: 'A guarantor with this phone already exists' });
    }

    // Generate a fake OTP for dev (real SMS would send this)
    const otpCode = '123456';

    const guarantor = await prisma.guarantor.create({
      data: {
        userId: req.user!.userId,
        name: data.name,
        phone: data.phone,
        email: data.email || null,
        relationship: data.relationship,
        idNumber: data.idNumber || null,
        status: 'PENDING',
        otpCode,
      },
    });

    console.log(`[GUARANTOR] ${data.name} (${data.phone}) added by ${req.user!.phone} | OTP: ${otpCode}`);

    return res.json({
      success: true,
      guarantor,
      devOtp: otpCode, // remove in production
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.issues });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/guarantors/:id/verify — verify via OTP
// ─────────────────────────────────────────────
const verifySchema = z.object({
  code: z.string().length(6),
});

router.post('/:id/verify', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { code } = verifySchema.parse(req.body);

    const guarantor = await prisma.guarantor.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });

    if (!guarantor) {
      return res.status(404).json({ error: 'Guarantor not found' });
    }

    if (guarantor.status === 'VERIFIED') {
      return res.json({ success: true, message: 'Already verified', guarantor });
    }

    if (guarantor.otpCode !== code) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    const updated = await prisma.guarantor.update({
      where: { id: guarantor.id },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        otpCode: null,
      },
    });

    console.log(`[GUARANTOR] ${guarantor.name} verified`);

    return res.json({ success: true, guarantor: updated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid code' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/guarantors/:id
// ─────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const guarantor = await prisma.guarantor.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });

    if (!guarantor) {
      return res.status(404).json({ error: 'Guarantor not found' });
    }

    await prisma.guarantor.delete({ where: { id: guarantor.id } });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;