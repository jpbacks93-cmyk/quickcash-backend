import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ─────────────────────────────────────────────
// GET /api/kyc — get my KYC status
// ─────────────────────────────────────────────
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const kyc = await prisma.kyc.findUnique({
      where: { userId: req.user!.userId },
    });

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { kycStatus: true },
    });

    return res.json({
      kyc: kyc || null,
      kycStatus: user?.kycStatus || 'PENDING',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/kyc/submit — submit ID documents
// ─────────────────────────────────────────────
const submitSchema = z.object({
  documentType: z.string().min(2).max(50),
  frontImageUrl: z.string().min(4).optional(),
  backImageUrl: z.string().min(4).optional(),
  selfieUrl: z.string().min(4).optional(),
});

router.post('/submit', requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = submitSchema.parse(req.body);

    // Upsert — user may re-submit
    const kyc = await prisma.kyc.upsert({
      where: { userId: req.user!.userId },
      create: {
        userId: req.user!.userId,
        documentType: data.documentType,
        frontImageUrl: data.frontImageUrl || null,
        backImageUrl: data.backImageUrl || null,
        selfieUrl: data.selfieUrl || null,
        status: 'PENDING',
      },
      update: {
        documentType: data.documentType,
        frontImageUrl: data.frontImageUrl || null,
        backImageUrl: data.backImageUrl || null,
        selfieUrl: data.selfieUrl || null,
        status: 'PENDING',
      },
    });

    // Auto-approve in dev
    if (process.env.NODE_ENV !== 'production') {
      await prisma.kyc.update({
        where: { id: kyc.id },
        data: { status: 'VERIFIED', verifiedAt: new Date() },
      });
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { kycStatus: 'VERIFIED', creditScore: { increment: 50 } },
      });
      console.log(`[KYC] Auto-verified user ${req.user!.phone} (dev mode)`);
    }

    return res.json({
      success: true,
      message: 'KYC submitted',
      status: process.env.NODE_ENV !== 'production' ? 'VERIFIED' : 'PENDING',
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.issues });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;