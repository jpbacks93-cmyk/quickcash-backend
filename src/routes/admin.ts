import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { requireAdmin, AdminRequest } from '../middleware/adminAuth';

const router = Router();

// ─────────────────────────────────────────────
// POST /api/admin/login
// Login with admin password → returns admin JWT
// ─────────────────────────────────────────────
const loginSchema = z.object({
  password: z.string().min(4),
});

router.post('/login', async (req, res) => {
  try {
    const { password } = loginSchema.parse(req.body);

    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (password !== adminPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Issue admin-scoped token
    const token = signToken({ role: 'ADMIN' });

    return res.json({
      success: true,
      token,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid password format' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/stats
// Dashboard numbers
// ─────────────────────────────────────────────
router.get('/stats', requireAdmin, async (_req, res) => {
  try {
    const [
      totalUsers,
      pendingLoans,
      activeLoans,
      paidLoans,
      rejectedLoans,
      kycVerified,
      loanTotals,
      repaidTotals,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.loan.count({ where: { status: 'PENDING' } }),
      prisma.loan.count({ where: { status: 'ACTIVE' } }),
      prisma.loan.count({ where: { status: 'PAID' } }),
      prisma.loan.count({
        where: { status: { in: ['REJECTED', 'DEFAULTED'] } },
      }),
      prisma.user.count({ where: { kycStatus: 'VERIFIED' } }),
      prisma.loan.aggregate({
        where: { status: { in: ['ACTIVE', 'PAID'] } },
        _sum: { amount: true, totalDue: true },
      }),
      prisma.repayment.aggregate({
        where: { status: 'SUCCESSFUL' },
        _sum: { amount: true },
      }),
    ]);

    return res.json({
      totalUsers,
      kycVerified,
      pendingLoans,
      activeLoans,
      paidLoans,
      rejectedLoans,
      totalDisbursed: loanTotals._sum.amount || 0,
      totalExpected: loanTotals._sum.totalDue || 0,
      totalCollected: repaidTotals._sum.amount || 0,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/users
// List all users, newest first
// ─────────────────────────────────────────────
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        kycStatus: true,
        creditScore: true,
        createdAt: true,
        _count: {
          select: { loans: true, guarantors: true },
        },
      },
    });

    return res.json({ users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/loans
// List loans, filter by status via ?status=PENDING
// ─────────────────────────────────────────────
router.get('/loans', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const loans = await prisma.loan.findMany({
      where,
      orderBy: { appliedAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: { id: true, phone: true, name: true, kycStatus: true },
        },
        repayments: {
          select: { amount: true, status: true },
        },
      },
    });

    const enriched = loans.map((loan) => {
      const totalRepaid = loan.repayments
        .filter((r) => r.status === 'SUCCESSFUL')
        .reduce((sum, r) => sum + r.amount, 0);

      return {
        ...loan,
        totalRepaid,
        outstanding: Math.max(0, loan.totalDue - totalRepaid),
      };
    });

    return res.json({ loans: enriched });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/loans/:id/approve
// Approve a PENDING loan → becomes ACTIVE
// ─────────────────────────────────────────────
router.post('/loans/:id/approve', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const loanId = req.params.id;

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'PENDING') {
      return res.status(400).json({
        error: `Cannot approve a loan with status ${loan.status}`,
      });
    }

    const dueDate = new Date(
      Date.now() + loan.durationDays * 24 * 60 * 60 * 1000
    );

    const updated = await prisma.loan.update({
      where: { id: loanId },
      data: {
        status: 'ACTIVE',
        approvedAt: new Date(),
        dueDate,
      },
    });

    console.log(`[ADMIN] Approved loan ${loanId}`);

    return res.json({ success: true, loan: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/loans/:id/reject
// Reject a PENDING loan
// ─────────────────────────────────────────────
const rejectSchema = z.object({
  reason: z.string().max(200).optional(),
});

router.post('/loans/:id/reject', requireAdmin, async (req, res) => {
  try {
    const loanId = req.params.id;
    const { reason } = rejectSchema.parse(req.body || {});

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'PENDING') {
      return res.status(400).json({
        error: `Cannot reject a loan with status ${loan.status}`,
      });
    }

    const updated = await prisma.loan.update({
      where: { id: loanId },
      data: { status: 'REJECTED' },
    });

    console.log(`[ADMIN] Rejected loan ${loanId} — ${reason || 'no reason'}`);

    return res.json({ success: true, loan: updated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;