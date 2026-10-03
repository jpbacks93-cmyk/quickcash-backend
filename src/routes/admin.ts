import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { requireAdmin, AdminRequest } from '../middleware/adminAuth';
import { createNotification } from '../lib/notifications';

const router = Router();

// ─────────────────────────────────────────────
// POST /api/admin/login
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

    const token = signToken({ role: 'ADMIN' });

    return res.json({ success: true, token });
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
      kycPending,
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
      prisma.kyc.count({ where: { status: 'PENDING' } }),
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
      kycPending,
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
// GET /api/admin/users?q=search
// List or search users
// ─────────────────────────────────────────────
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const q = (req.query.q as string || '').trim();

    const where: any = {};
    if (q) {
      where.OR = [
        { phone: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
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
// GET /api/admin/users/:id
// Single user detail with everything
// ─────────────────────────────────────────────
router.get('/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        kycStatus: true,
        creditScore: true,
        createdAt: true,
        updatedAt: true,
        loans: {
          orderBy: { appliedAt: 'desc' },
          include: {
            repayments: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        guarantors: {
          orderBy: { createdAt: 'asc' },
        },
        kyc: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/loans?status=PENDING&range=week
// List loans with filters
// ─────────────────────────────────────────────
router.get('/loans', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const range = req.query.range as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const where: any = {};

    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (range && range !== 'all') {
      const now = new Date();
      let from: Date;

      switch (range) {
        case 'today':
          from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          from = new Date(0);
      }

      where.appliedAt = { gte: from };
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
// GET /api/admin/kyc?status=PENDING
// KYC review queue
// ─────────────────────────────────────────────
router.get('/kyc', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const submissions = await prisma.kyc.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, phone: true, name: true },
        },
      },
    });

    return res.json({ submissions });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/kyc/:id/approve
// ─────────────────────────────────────────────
router.post('/kyc/:id/approve', requireAdmin, async (req, res) => {
  try {
    const kyc = await prisma.kyc.findUnique({
      where: { id: req.params.id },
    });

    if (!kyc) {
      return res.status(404).json({ error: 'KYC not found' });
    }

    await prisma.kyc.update({
      where: { id: kyc.id },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });

    await prisma.user.update({
      where: { id: kyc.userId },
      data: { kycStatus: 'VERIFIED', creditScore: { increment: 50 } },
    });

    console.log(`[ADMIN] KYC approved for user ${kyc.userId}`);

    await createNotification({
      userId: kyc.userId,
      type: 'KYC_VERIFIED',
      title: 'Identity Verified ✅',
      message:
        'Your identity has been verified. You can now apply for higher loan limits.',
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/kyc/:id/reject
// ─────────────────────────────────────────────
const rejectKycSchema = z.object({
  reason: z.string().max(200).optional(),
});

router.post('/kyc/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { reason } = rejectKycSchema.parse(req.body || {});

    const kyc = await prisma.kyc.findUnique({
      where: { id: req.params.id },
    });

    if (!kyc) {
      return res.status(404).json({ error: 'KYC not found' });
    }

    await prisma.kyc.update({
      where: { id: kyc.id },
      data: { status: 'REJECTED' },
    });

    await prisma.user.update({
      where: { id: kyc.userId },
      data: { kycStatus: 'REJECTED' },
    });

    console.log(`[ADMIN] KYC rejected for user ${kyc.userId}`);

    await createNotification({
      userId: kyc.userId,
      type: 'LOAN_REJECTED',
      title: 'KYC Verification Failed',
      message:
        reason ||
        'Your identity documents could not be verified. Please resubmit clear photos.',
    });

    return res.json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/loans/:id/approve
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

    await createNotification({
      userId: loan.userId,
      type: 'LOAN_APPROVED',
      title: 'Loan Approved! 🎉',
      message: `Your loan of $${loan.amount.toFixed(2)} has been approved. Total due: $${loan.totalDue.toFixed(2)}.`,
      metadata: { loanId: loan.id },
    });

    return res.json({ success: true, loan: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/loans/:id/reject
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

    const rejectionReason =
      reason || 'Application did not meet our criteria';

    const updated = await prisma.loan.update({
      where: { id: loanId },
      data: {
        status: 'REJECTED',
        rejectionReason,
        rejectedAt: new Date(),
      },
    });

    console.log(
      `[ADMIN] Rejected loan ${loanId} — Reason: ${rejectionReason}`
    );

    await createNotification({
      userId: loan.userId,
      type: 'LOAN_REJECTED',
      title: 'Loan Application Rejected',
      message: rejectionReason,
      metadata: { loanId: loan.id },
    });

    return res.json({ success: true, loan: updated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/export/loans.csv
// CSV export of loans
// ─────────────────────────────────────────────
router.get('/export/loans.csv', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const loans = await prisma.loan.findMany({
      where,
      orderBy: { appliedAt: 'desc' },
      include: {
        user: { select: { phone: true, name: true } },
        repayments: true,
      },
    });

    const header =
      'ID,Phone,Name,Amount,Interest Rate,Total Due,Repaid,Outstanding,Status,Duration (days),Applied At\n';

    const rows = loans.map((l) => {
      const repaid = l.repayments
        .filter((r) => r.status === 'SUCCESSFUL')
        .reduce((s, r) => s + r.amount, 0);
      const outstanding = Math.max(0, l.totalDue - repaid);

      return [
        l.id,
        l.user.phone,
        `"${(l.user.name || '').replace(/"/g, '""')}"`,
        l.amount.toFixed(2),
        (l.interestRate * 100).toFixed(0) + '%',
        l.totalDue.toFixed(2),
        repaid.toFixed(2),
        outstanding.toFixed(2),
        l.status,
        l.durationDays,
        l.appliedAt.toISOString(),
      ].join(',');
    });

    const csv = header + rows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="quickcash-loans-${Date.now()}.csv"`
    );

    return res.send(csv);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;