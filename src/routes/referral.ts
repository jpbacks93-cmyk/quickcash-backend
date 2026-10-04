import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ─────────────────────────────────────────────
// GET /api/referral
// Get my referral code + stats + referred users
// ─────────────────────────────────────────────
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        referralCode: true,
        referralCredit: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const referredUsers = await prisma.user.findMany({
      where: { referredById: req.user!.userId },
      select: {
        id: true,
        name: true,
        phone: true,
        referralBonusPaid: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const earned = referredUsers.filter((u) => u.referralBonusPaid).length * 5;

    return res.json({
      referralCode: user.referralCode,
      referralCredit: user.referralCredit,
      totalReferred: referredUsers.length,
      totalEarned: earned,
      referredUsers: referredUsers.map((u) => ({
        name: u.name || 'Anonymous',
        phone: u.phone.replace(/(\+?\d{3})\d+(\d{3})/, '$1****$2'),
        bonusPaid: u.referralBonusPaid,
        joinedAt: u.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;