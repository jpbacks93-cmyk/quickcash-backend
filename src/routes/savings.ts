import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { createNotification } from '../lib/notifications';

const router = Router();

// ─────────────────────────────────────────────
// Helper: get or create savings account for user
// ─────────────────────────────────────────────
async function getOrCreateSavings(userId: string) {
  let savings = await prisma.savings.findUnique({
    where: { userId },
  });

  if (!savings) {
    savings = await prisma.savings.create({
      data: { userId, balance: 0 },
    });
  }

  return savings;
}

// ─────────────────────────────────────────────
// GET /api/savings
// Get savings account + recent transactions
// ─────────────────────────────────────────────
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const savings = await getOrCreateSavings(req.user!.userId);

    const transactions = await prisma.savingsTransaction.findMany({
      where: { savingsId: savings.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const progress =
      savings.goal && savings.goal > 0
        ? Math.min(1, savings.balance / savings.goal)
        : 0;

    return res.json({
      savings: {
        ...savings,
        progress,
      },
      transactions,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/savings/deposit
// ─────────────────────────────────────────────
const depositSchema = z.object({
  amount: z.number().positive().max(10000),
  method: z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'BANK']).optional(),
  reference: z.string().optional(),
});

router.post('/deposit', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { amount, method, reference } = depositSchema.parse(req.body);

    const savings = await getOrCreateSavings(req.user!.userId);

    const [updated, txn] = await prisma.$transaction([
      prisma.savings.update({
        where: { id: savings.id },
        data: { balance: { increment: amount } },
      }),
      prisma.savingsTransaction.create({
        data: {
          savingsId: savings.id,
          type: 'DEPOSIT',
          amount,
          method: method || 'MTN_MOMO',
          reference: reference || null,
        },
      }),
    ]);

    console.log(
      `[SAVINGS] Deposit $${amount} for user ${req.user!.phone}`
    );

    // If a goal exists and user just crossed it, celebrate
    if (
      updated.goal &&
      updated.goal > 0 &&
      updated.balance >= updated.goal &&
      savings.balance < updated.goal
    ) {
      await createNotification({
        userId: req.user!.userId,
        type: 'LOAN_PAID', // reuse icon
        title: 'Savings Goal Reached! 🎯',
        message: `You reached your goal of $${updated.goal.toFixed(2)}!`,
      });
    }

    return res.json({
      success: true,
      balance: updated.balance,
      transaction: txn,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: 'Invalid amount', details: err.issues });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/savings/withdraw
// ─────────────────────────────────────────────
const withdrawSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'BANK']).optional(),
});

router.post('/withdraw', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { amount, method } = withdrawSchema.parse(req.body);

    const savings = await getOrCreateSavings(req.user!.userId);

    if (savings.balance < amount) {
      return res.status(400).json({
        error: `Insufficient balance. You have $${savings.balance.toFixed(2)}.`,
      });
    }

    const [updated, txn] = await prisma.$transaction([
      prisma.savings.update({
        where: { id: savings.id },
        data: { balance: { decrement: amount } },
      }),
      prisma.savingsTransaction.create({
        data: {
          savingsId: savings.id,
          type: 'WITHDRAWAL',
          amount,
          method: method || 'MTN_MOMO',
        },
      }),
    ]);

    console.log(
      `[SAVINGS] Withdrawal $${amount} for user ${req.user!.phone}`
    );

    return res.json({
      success: true,
      balance: updated.balance,
      transaction: txn,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/savings/goal
// Set or clear the goal
// ─────────────────────────────────────────────
const goalSchema = z.object({
  goal: z.number().nonnegative().max(1000000).nullable(),
  goalName: z.string().max(100).optional(),
});

router.post('/goal', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { goal, goalName } = goalSchema.parse(req.body);

    const savings = await getOrCreateSavings(req.user!.userId);

    const updated = await prisma.savings.update({
      where: { id: savings.id },
      data: {
        goal: goal,
        goalName: goalName || null,
      },
    });

    return res.json({ success: true, savings: updated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;