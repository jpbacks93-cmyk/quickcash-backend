"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const notifications_1 = require("../lib/notifications");
const router = (0, express_1.Router)();
const INTEREST_RATES = {
    7: 0.08,
    14: 0.12,
    30: 0.15,
};
const MIN_AMOUNT = 50;
const MAX_AMOUNT = 500;
// ─────────────────────────────────────────────
// POST /api/loans/apply
// ─────────────────────────────────────────────
const applySchema = zod_1.z.object({
    amount: zod_1.z.number().min(MIN_AMOUNT).max(MAX_AMOUNT),
    durationDays: zod_1.z.union([zod_1.z.literal(7), zod_1.z.literal(14), zod_1.z.literal(30)]),
    purpose: zod_1.z.string().max(100).optional(),
});
router.post('/apply', auth_1.requireAuth, async (req, res) => {
    try {
        const { amount, durationDays, purpose } = applySchema.parse(req.body);
        const existingActive = await prisma_1.prisma.loan.findFirst({
            where: {
                userId: req.user.userId,
                status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] },
            },
        });
        if (existingActive) {
            return res.status(400).json({
                error: 'You already have an active loan.',
                activeLoanId: existingActive.id,
            });
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.user.userId },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (amount > 100 && user.kycStatus !== 'VERIFIED') {
            return res.status(400).json({
                error: 'KYC verification required for loans above $100',
                code: 'KYC_REQUIRED',
            });
        }
        const interestRate = INTEREST_RATES[durationDays];
        const interest = amount * interestRate;
        const totalDue = amount + interest;
        const dailyPayment = totalDue / durationDays;
        const loan = await prisma_1.prisma.loan.create({
            data: {
                userId: req.user.userId,
                amount,
                interestRate,
                totalDue,
                dailyPayment,
                durationDays,
                purpose: purpose || null,
                status: 'PENDING',
            },
        });
        console.log(`[LOAN] New: $${amount} for ${durationDays} days by ${user.phone}`);
        // Notify user
        await (0, notifications_1.createNotification)({
            userId: user.id,
            type: 'LOAN_APPLIED',
            title: 'Application Received',
            message: `Your loan application for $${amount.toFixed(2)} is being reviewed.`,
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
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: err.issues });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// GET /api/loans
// ─────────────────────────────────────────────
router.get('/', auth_1.requireAuth, async (req, res) => {
    try {
        const loans = await prisma_1.prisma.loan.findMany({
            where: { userId: req.user.userId },
            orderBy: { appliedAt: 'desc' },
            include: { repayments: true },
        });
        const enriched = loans.map((loan) => {
            const totalRepaid = loan.repayments
                .filter((r) => r.status === 'SUCCESSFUL')
                .reduce((sum, r) => sum + r.amount, 0);
            const outstanding = Math.max(0, loan.totalDue - totalRepaid);
            const progress = loan.totalDue > 0 ? totalRepaid / loan.totalDue : 0;
            return { ...loan, totalRepaid, outstanding, progress };
        });
        return res.json({ loans: enriched });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// GET /api/loans/:id
// ─────────────────────────────────────────────
router.get('/:id', auth_1.requireAuth, async (req, res) => {
    try {
        const loan = await prisma_1.prisma.loan.findFirst({
            where: { id: req.params.id, userId: req.user.userId },
            include: { repayments: { orderBy: { createdAt: 'desc' } } },
        });
        if (!loan)
            return res.status(404).json({ error: 'Loan not found' });
        const totalRepaid = loan.repayments
            .filter((r) => r.status === 'SUCCESSFUL')
            .reduce((sum, r) => sum + r.amount, 0);
        return res.json({
            loan: {
                ...loan,
                totalRepaid,
                outstanding: Math.max(0, loan.totalDue - totalRepaid),
            },
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/loans/:id/repay
// ─────────────────────────────────────────────
const repaySchema = zod_1.z.object({
    amount: zod_1.z.number().positive(),
    method: zod_1.z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'BANK']),
    reference: zod_1.z.string().optional(),
});
router.post('/:id/repay', auth_1.requireAuth, async (req, res) => {
    try {
        const { amount, method, reference } = repaySchema.parse(req.body);
        const loan = await prisma_1.prisma.loan.findFirst({
            where: { id: req.params.id, userId: req.user.userId },
            include: { repayments: true },
        });
        if (!loan)
            return res.status(404).json({ error: 'Loan not found' });
        if (loan.status === 'PAID')
            return res.status(400).json({ error: 'Already paid' });
        if (loan.status === 'PENDING' || loan.status === 'REJECTED') {
            return res.status(400).json({ error: 'Loan not disbursed yet' });
        }
        const totalRepaid = loan.repayments
            .filter((r) => r.status === 'SUCCESSFUL')
            .reduce((sum, r) => sum + r.amount, 0);
        const outstanding = loan.totalDue - totalRepaid;
        if (amount > outstanding + 0.01) {
            return res
                .status(400)
                .json({ error: `Exceeds outstanding $${outstanding.toFixed(2)}` });
        }
        const repayment = await prisma_1.prisma.repayment.create({
            data: { loanId: loan.id, amount, method, reference: reference || null },
        });
        const newTotalRepaid = totalRepaid + amount;
        const isFullyPaid = newTotalRepaid >= loan.totalDue - 0.01;
        if (isFullyPaid) {
            await prisma_1.prisma.loan.update({
                where: { id: loan.id },
                data: { status: 'PAID' },
            });
            await prisma_1.prisma.user.update({
                where: { id: req.user.userId },
                data: { creditScore: { increment: 20 } },
            });
            console.log(`[LOAN] ${loan.id} fully paid! +20 credit`);
            // Notify: Loan fully paid
            await (0, notifications_1.createNotification)({
                userId: req.user.userId,
                type: 'LOAN_PAID',
                title: 'Loan Fully Paid! 🎉',
                message: "You've successfully repaid your loan. Your credit score has improved.",
                metadata: { loanId: loan.id },
            });
        }
        else {
            // Notify: Partial repayment
            await (0, notifications_1.createNotification)({
                userId: req.user.userId,
                type: 'REPAYMENT_SUCCESS',
                title: 'Payment Received',
                message: `Your payment of $${amount.toFixed(2)} was successful. Remaining: $${Math.max(0, loan.totalDue - newTotalRepaid).toFixed(2)}.`,
                metadata: { loanId: loan.id, amount },
            });
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
            newOutstanding: Math.max(0, loan.totalDue - newTotalRepaid),
        });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: err.issues });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/loans/:id/approve (DEV only)
// ─────────────────────────────────────────────
router.post('/:id/approve', auth_1.requireAuth, async (req, res) => {
    try {
        const loan = await prisma_1.prisma.loan.findFirst({
            where: { id: req.params.id, userId: req.user.userId },
        });
        if (!loan)
            return res.status(404).json({ error: 'Loan not found' });
        const updated = await prisma_1.prisma.loan.update({
            where: { id: loan.id },
            data: {
                status: 'ACTIVE',
                approvedAt: new Date(),
                dueDate: new Date(Date.now() + loan.durationDays * 24 * 60 * 60 * 1000),
            },
        });
        console.log(`[LOAN] Auto-approved ${loan.id}`);
        return res.json({ success: true, loan: updated });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=loans.js.map