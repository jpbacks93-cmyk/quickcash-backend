"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const jwt_1 = require("../lib/jwt");
const adminAuth_1 = require("../middleware/adminAuth");
const notifications_1 = require("../lib/notifications");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────
// POST /api/admin/login
// ─────────────────────────────────────────────
const loginSchema = zod_1.z.object({
    password: zod_1.z.string().min(4),
});
router.post('/login', async (req, res) => {
    try {
        const { password } = loginSchema.parse(req.body);
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        if (password !== adminPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        const token = (0, jwt_1.signToken)({ role: 'ADMIN' });
        return res.json({
            success: true,
            token,
        });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Invalid password format' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// GET /api/admin/stats
// ─────────────────────────────────────────────
router.get('/stats', adminAuth_1.requireAdmin, async (_req, res) => {
    try {
        const [totalUsers, pendingLoans, activeLoans, paidLoans, rejectedLoans, kycVerified, loanTotals, repaidTotals,] = await Promise.all([
            prisma_1.prisma.user.count(),
            prisma_1.prisma.loan.count({ where: { status: 'PENDING' } }),
            prisma_1.prisma.loan.count({ where: { status: 'ACTIVE' } }),
            prisma_1.prisma.loan.count({ where: { status: 'PAID' } }),
            prisma_1.prisma.loan.count({
                where: { status: { in: ['REJECTED', 'DEFAULTED'] } },
            }),
            prisma_1.prisma.user.count({ where: { kycStatus: 'VERIFIED' } }),
            prisma_1.prisma.loan.aggregate({
                where: { status: { in: ['ACTIVE', 'PAID'] } },
                _sum: { amount: true, totalDue: true },
            }),
            prisma_1.prisma.repayment.aggregate({
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
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// GET /api/admin/users
// ─────────────────────────────────────────────
router.get('/users', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const users = await prisma_1.prisma.user.findMany({
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
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// GET /api/admin/loans
// ─────────────────────────────────────────────
router.get('/loans', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const status = req.query.status;
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const where = {};
        if (status && status !== 'ALL') {
            where.status = status;
        }
        const loans = await prisma_1.prisma.loan.findMany({
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
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/admin/loans/:id/approve
// ─────────────────────────────────────────────
router.post('/loans/:id/approve', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const loanId = req.params.id;
        const loan = await prisma_1.prisma.loan.findUnique({
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
        const dueDate = new Date(Date.now() + loan.durationDays * 24 * 60 * 60 * 1000);
        const updated = await prisma_1.prisma.loan.update({
            where: { id: loanId },
            data: {
                status: 'ACTIVE',
                approvedAt: new Date(),
                dueDate,
            },
        });
        console.log(`[ADMIN] Approved loan ${loanId}`);
        // Notify user
        await (0, notifications_1.createNotification)({
            userId: loan.userId,
            type: 'LOAN_APPROVED',
            title: 'Loan Approved! 🎉',
            message: `Your loan of $${loan.amount.toFixed(2)} has been approved. Total due: $${loan.totalDue.toFixed(2)}.`,
            metadata: { loanId: loan.id },
        });
        return res.json({ success: true, loan: updated });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/admin/loans/:id/reject
// ─────────────────────────────────────────────
const rejectSchema = zod_1.z.object({
    reason: zod_1.z.string().max(200).optional(),
});
router.post('/loans/:id/reject', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const loanId = req.params.id;
        const { reason } = rejectSchema.parse(req.body || {});
        const loan = await prisma_1.prisma.loan.findUnique({
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
        const rejectionReason = reason || 'Application did not meet our criteria';
        const updated = await prisma_1.prisma.loan.update({
            where: { id: loanId },
            data: {
                status: 'REJECTED',
                rejectionReason,
                rejectedAt: new Date(),
            },
        });
        console.log(`[ADMIN] Rejected loan ${loanId} — Reason: ${rejectionReason}`);
        // Notify user
        await (0, notifications_1.createNotification)({
            userId: loan.userId,
            type: 'LOAN_REJECTED',
            title: 'Loan Application Rejected',
            message: rejectionReason,
            metadata: { loanId: loan.id },
        });
        return res.json({ success: true, loan: updated });
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
//# sourceMappingURL=admin.js.map