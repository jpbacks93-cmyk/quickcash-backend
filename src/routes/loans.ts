import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { createNotification } from '../lib/notifications';
import { sendRepaymentSms, sendLoanPaidSms } from '../lib/sms';

const router = Router();

// ─────────────────────────────────────────────
// Loan tiers — UGX
// ─────────────────────────────────────────────
const INTEREST_RATES: Record<number, number> = {
  7: 0.08,
  14: 0.12,
  30: 0.15,
};

const MIN_AMOUNT = 50000;
const MAX_AMOUNT = 1000000;

// ─────────────────────────────────────────────
// POST /api/loans/apply
// ─────────────────────────────────────────────
const applySchema = z.object({
  amount: z.number().min(MIN_AMOUNT).max(MAX_AMOUNT),
  durationDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
  purpose: z.string().max(100).optional(),
});

router.post('/apply', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { amount, durationDays, purpose } = applySchema.parse(req.body);

    const existingActive = await prisma.loan.findFirst({
      where: {
        userId: req.user!.userId,
        status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] },
      },
    });

    if (existingActive) {
      return res.status(400).json({
        error: 'You already have an active loan.',
        activeLoanId: existingActive.id,
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (amount > 200000 && user.kycStatus !== 'VERIFIED') {
      return res.status(400).json({
        error: 'KYC verification required for loans above UGX 200,000',
        code: 'KYC_REQUIRED',
      });
    }

    const interestRate = INTEREST_RATES[durationDays];
    const interest = amount * interestRate;
    const totalDue = amount + interest;
    const dailyPayment = totalDue / durationDays;

    const loan = await prisma.loan.create({
      data: {
        userId: req.user!.userId,
        amount,
        interestRate,
        totalDue,
        dailyPayment,
        durationDays,
        purpose: purpose || null,
        status: 'PENDING',
      },
    });

    console.log(
      `[LOAN] New: UGX ${amount.toLocaleString()} for ${durationDays} days by ${user.phone}`
    );

    await createNotification({
      userId: user.id,
      type: 'LOAN_APPLIED',
      title: 'Application Received',
      message: `Your loan application for UGX ${amount.toLocaleString()} is being reviewed.`,
      metadata: { loanId: loan.id },
    });

    return res.json({
      success: true,
      message: 'Loan application submitted',
      loan: {
        id: loan.id,
        amount: loan.amount,
        interestRate: loan.interestRate,
        totalDue: loan.totalDue,
        dailyPayment: loan.dailyPayment,
        durationDays: loan.durationDays,
        status: loan.status,
        appliedAt: loan.appliedAt,
      },
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
// GET /api/loans
// FIX: progress uses totalOwed, capped at 100%
// ─────────────────────────────────────────────
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const loans = await prisma.loan.findMany({
      where: { userId: req.user!.userId },
      orderBy: { appliedAt: 'desc' },
      include: { repayments: true },
    });

    const enriched = loans.map((loan) => {
      const totalRepaid = loan.repayments
        .filter((r) => r.status === 'SUCCESSFUL')
        .reduce((sum, r) => sum + r.amount, 0);

      // Total owed = base total due + any late fee
      const totalOwed = loan.totalDue + (loan.lateFee || 0);
      const outstanding = Math.max(0, totalOwed - totalRepaid);

      // Progress is capped at 100% so over-payments don't break the UI
      const progress = totalOwed > 0
        ? Math.min(1.0, totalRepaid / totalOwed)
        : 0;

      return {
        ...loan,
        totalRepaid,
        outstanding,
        progress,
        totalOwed,
      };
    });

    return res.json({ loans: enriched });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/loans/:id
// ─────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const loan = await prisma.loan.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
      include: { repayments: { orderBy: { createdAt: 'desc' } } },
    });

    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const totalRepaid = loan.repayments
      .filter((r) => r.status === 'SUCCESSFUL')
      .reduce((sum, r) => sum + r.amount, 0);

    const totalOwed = loan.totalDue + (loan.lateFee || 0);
    const outstanding = Math.max(0, totalOwed - totalRepaid);
    const progress = totalOwed > 0
      ? Math.min(1.0, totalRepaid / totalOwed)
      : 0;

    return res.json({
      loan: { ...loan, totalRepaid, outstanding, totalOwed, progress },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/loans/:id/repay
// FIX: tolerant isFullyPaid check + self-heal status
// ─────────────────────────────────────────────
const repaySchema = z.object({
  amount: z.number().positive(),
  method: z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'BANK']),
  reference: z.string().optional(),
});

router.post('/:id/repay', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { amount, method, reference } = repaySchema.parse(req.body);

    const loan = await prisma.loan.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
      include: { repayments: true, user: true },
    });

    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    if (loan.status === 'PAID') {
      return res.status(400).json({ error: 'Already paid' });
    }

    if (loan.status === 'PENDING' || loan.status === 'REJECTED') {
      return res.status(400).json({ error: 'Loan not disbursed yet' });
    }

    const totalRepaid = loan.repayments
      .filter((r) => r.status === 'SUCCESSFUL')
      .reduce((sum, r) => sum + r.amount, 0);

    const totalOwed = loan.totalDue + (loan.lateFee || 0);
    const outstanding = totalOwed - totalRepaid;

    // If already overpaid, auto-heal status and return early
    if (outstanding <= 0.01) {
      await prisma.loan.update({
        where: { id: loan.id },
        data: { status: 'PAID' },
      });
      console.log(`[LOAN] ${loan.id} was overpaid — auto-marked PAID`);
      return res.json({
        success: true,
        message: 'Loan already fully paid',
        loanStatus: 'PAID',
        newOutstanding: 0,
      });
    }

    if (amount > outstanding + 0.01) {
      return res.status(400).json({
        error: `Exceeds outstanding UGX ${outstanding.toLocaleString()}`,
      });
    }

    const repayment = await prisma.repayment.create({
      data: { loanId: loan.id, amount, method, reference: reference || null },
    });

    const newTotalRepaid = totalRepaid + amount;
    const newOutstanding = Math.max(0, totalOwed - newTotalRepaid);

    // Tolerant full-paid detection:
    // PAID if user covered the total owed (base + late fee) OR
    // PAID if user covered the base totalDue (in case late fee was
    // inflated after they paid) OR
    // PAID if remaining < 1 UGX (rounding).
    const isFullyPaid =
      newTotalRepaid >= totalOwed - 0.01 ||
      newTotalRepaid >= loan.totalDue - 0.01 ||
      newOutstanding <= 0.01;

    if (isFullyPaid) {
      await prisma.loan.update({
        where: { id: loan.id },
        data: { status: 'PAID' },
      });

      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { creditScore: { increment: 20 } },
      });

      console.log(`[LOAN] ${loan.id} fully paid! +20 credit`);

      await createNotification({
        userId: req.user!.userId,
        type: 'LOAN_PAID',
        title: 'Loan Fully Paid! 🎉',
        message: `You've successfully repaid your loan. Your credit score has improved.`,
        metadata: { loanId: loan.id },
      });

      // SMS: fully paid
      try {
        await sendLoanPaidSms(loan.user.phone);
      } catch (smsErr) {
        console.error('[SMS] Failed on loan paid:', smsErr);
      }
    } else {
      await createNotification({
        userId: req.user!.userId,
        type: 'REPAYMENT_SUCCESS',
        title: 'Payment Received',
        message: `Your payment of UGX ${amount.toLocaleString()} was successful. Remaining: UGX ${newOutstanding.toLocaleString()}.`,
        metadata: { loanId: loan.id, amount },
      });

      // SMS: partial
      try {
        await sendRepaymentSms(loan.user.phone, amount, newOutstanding);
      } catch (smsErr) {
        console.error('[SMS] Failed on repayment:', smsErr);
      }
    }

    return res.json({
      success: true,
      repayment: {
        id: repayment.id,
        amount: repayment.amount,
        method: repayment.method,
        status: repayment.status,
        createdAt: repayment.createdAt,
      },
      loanStatus: isFullyPaid ? 'PAID' : loan.status,
      newOutstanding,
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
// POST /api/loans/:id/approve (DEV only)
// ─────────────────────────────────────────────
router.post('/:id/approve', requireAuth, async (req: AuthRequest, res) => {
  try {
    const loan = await prisma.loan.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });

    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const updated = await prisma.loan.update({
      where: { id: loan.id },
      data: {
        status: 'ACTIVE',
        approvedAt: new Date(),
        dueDate: new Date(
          Date.now() + loan.durationDays * 24 * 60 * 60 * 1000
        ),
      },
    });

    console.log(`[LOAN] Auto-approved ${loan.id}`);
    return res.json({ success: true, loan: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;