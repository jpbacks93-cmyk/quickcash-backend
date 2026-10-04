"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const notifications_1 = require("../lib/notifications");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────
// Helper: get or create savings account for user
// ─────────────────────────────────────────────
async function getOrCreateSavings(userId) {
    let savings = await prisma_1.prisma.savings.findUnique({
        where: { userId },
    });
    if (!savings) {
        savings = await prisma_1.prisma.savings.create({
            data: { userId, balance: 0 },
        });
    }
    return savings;
}
// ─────────────────────────────────────────────
// GET /api/savings
// Get savings account + recent transactions
// ─────────────────────────────────────────────
router.get('/', auth_1.requireAuth, async (req, res) => {
    try {
        const savings = await getOrCreateSavings(req.user.userId);
        const transactions = await prisma_1.prisma.savingsTransaction.findMany({
            where: { savingsId: savings.id },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        const progress = savings.goal && savings.goal > 0
            ? Math.min(1, savings.balance / savings.goal)
            : 0;
        return res.json({
            savings: {
                ...savings,
                progress,
            },
            transactions,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/savings/deposit
// ─────────────────────────────────────────────
const depositSchema = zod_1.z.object({
    amount: zod_1.z.number().positive().max(10000),
    method: zod_1.z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'BANK']).optional(),
    reference: zod_1.z.string().optional(),
});
router.post('/deposit', auth_1.requireAuth, async (req, res) => {
    try {
        const { amount, method, reference } = depositSchema.parse(req.body);
        const savings = await getOrCreateSavings(req.user.userId);
        const [updated, txn] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.savings.update({
                where: { id: savings.id },
                data: { balance: { increment: amount } },
            }),
            prisma_1.prisma.savingsTransaction.create({
                data: {
                    savingsId: savings.id,
                    type: 'DEPOSIT',
                    amount,
                    method: method || 'MTN_MOMO',
                    reference: reference || null,
                },
            }),
        ]);
        console.log(`[SAVINGS] Deposit $${amount} for user ${req.user.phone}`);
        // If a goal exists and user just crossed it, celebrate
        if (updated.goal &&
            updated.goal > 0 &&
            updated.balance >= updated.goal &&
            savings.balance < updated.goal) {
            await (0, notifications_1.createNotification)({
                userId: req.user.userId,
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
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
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
const withdrawSchema = zod_1.z.object({
    amount: zod_1.z.number().positive(),
    method: zod_1.z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'BANK']).optional(),
});
router.post('/withdraw', auth_1.requireAuth, async (req, res) => {
    try {
        const { amount, method } = withdrawSchema.parse(req.body);
        const savings = await getOrCreateSavings(req.user.userId);
        if (savings.balance < amount) {
            return res.status(400).json({
                error: `Insufficient balance. You have $${savings.balance.toFixed(2)}.`,
            });
        }
        const [updated, txn] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.savings.update({
                where: { id: savings.id },
                data: { balance: { decrement: amount } },
            }),
            prisma_1.prisma.savingsTransaction.create({
                data: {
                    savingsId: savings.id,
                    type: 'WITHDRAWAL',
                    amount,
                    method: method || 'MTN_MOMO',
                },
            }),
        ]);
        console.log(`[SAVINGS] Withdrawal $${amount} for user ${req.user.phone}`);
        return res.json({
            success: true,
            balance: updated.balance,
            transaction: txn,
        });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
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
const goalSchema = zod_1.z.object({
    goal: zod_1.z.number().nonnegative().max(1000000).nullable(),
    goalName: zod_1.z.string().max(100).optional(),
});
router.post('/goal', auth_1.requireAuth, async (req, res) => {
    try {
        const { goal, goalName } = goalSchema.parse(req.body);
        const savings = await getOrCreateSavings(req.user.userId);
        const updated = await prisma_1.prisma.savings.update({
            where: { id: savings.id },
            data: {
                goal: goal,
                goalName: goalName || null,
            },
        });
        return res.json({ success: true, savings: updated });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=savings.js.map