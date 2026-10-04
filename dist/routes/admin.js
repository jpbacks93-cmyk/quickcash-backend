"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const jwt_1 = require("../lib/jwt");
const adminAuth_1 = require("../middleware/adminAuth");
const notifications_1 = require("../lib/notifications");
const penalty_1 = require("../lib/penalty");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────
const loginSchema = zod_1.z.object({ password: zod_1.z.string().min(4) });
router.post('/login', async (req, res) => {
    try {
        const { password } = loginSchema.parse(req.body);
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        if (password !== adminPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        const token = (0, jwt_1.signToken)({ role: 'ADMIN' });
        return res.json({ success: true, token });
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
// Stats
// ─────────────────────────────────────────────
router.get('/stats', adminAuth_1.requireAdmin, async (_req, res) => {
    try {
        const [totalUsers, pendingLoans, activeLoans, paidLoans, rejectedLoans, kycVerified, kycPending, loanTotals, repaidTotals,] = await Promise.all([
            prisma_1.prisma.user.count(),
            prisma_1.prisma.loan.count({ where: { status: 'PENDING' } }),
            prisma_1.prisma.loan.count({ where: { status: 'ACTIVE' } }),
            prisma_1.prisma.loan.count({ where: { status: 'PAID' } }),
            prisma_1.prisma.loan.count({ where: { status: { in: ['REJECTED', 'DEFAULTED'] } } }),
            prisma_1.prisma.user.count({ where: { kycStatus: 'VERIFIED' } }),
            prisma_1.prisma.kyc.count({ where: { status: 'PENDING' } }),
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
            totalUsers, kycVerified, kycPending, pendingLoans, activeLoans,
            paidLoans, rejectedLoans,
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
// Analytics
// ─────────────────────────────────────────────
router.get('/analytics', adminAuth_1.requireAdmin, async (_req, res) => {
    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const recentLoans = await prisma_1.prisma.loan.findMany({
            where: { appliedAt: { gte: thirtyDaysAgo } },
            select: {
                id: true, amount: true, totalDue: true, status: true, appliedAt: true, userId: true,
            },
        });
        const dailyLabels = [];
        const dailyLoansCount = [];
        const dailyDisbursed = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
            const dayLoans = recentLoans.filter((l) => l.appliedAt >= dayStart && l.appliedAt < dayEnd);
            const dayDisbursed = dayLoans
                .filter((l) => ['ACTIVE', 'PAID'].includes(l.status))
                .reduce((s, l) => s + l.amount, 0);
            dailyLabels.push(`${d.getDate()}/${d.getMonth() + 1}`);
            dailyLoansCount.push(dayLoans.length);
            dailyDisbursed.push(Math.round(dayDisbursed * 100) / 100);
        }
        const statusCounts = {
            PENDING: 0, ACTIVE: 0, PAID: 0, REJECTED: 0, DEFAULTED: 0,
        };
        for (const l of recentLoans) {
            if (statusCounts[l.status] !== undefined) {
                statusCounts[l.status]++;
            }
        }
        const allTimeAgg = await prisma_1.prisma.loan.aggregate({
            where: { status: { in: ['ACTIVE', 'PAID'] } },
            _sum: { totalDue: true, amount: true },
        });
        const repaidAgg = await prisma_1.prisma.repayment.aggregate({
            where: { status: 'SUCCESSFUL' },
            _sum: { amount: true },
        });
        const totalExpected = allTimeAgg._sum.totalDue || 0;
        const totalCollected = repaidAgg._sum.amount || 0;
        const collectionRate = totalExpected > 0
            ? Math.min(100, (totalCollected / totalExpected) * 100)
            : 0;
        const totalUsers = await prisma_1.prisma.user.count();
        const kycSubmitted = await prisma_1.prisma.kyc.count();
        const kycVerified = await prisma_1.prisma.user.count({
            where: { kycStatus: 'VERIFIED' },
        });
        return res.json({
            daily: {
                labels: dailyLabels,
                loans: dailyLoansCount,
                disbursed: dailyDisbursed,
            },
            statusBreakdown: statusCounts,
            collection: {
                totalExpected: Math.round(totalExpected * 100) / 100,
                totalCollected: Math.round(totalCollected * 100) / 100,
                rate: Math.round(collectionRate * 10) / 10,
            },
            kycFunnel: { totalUsers, submitted: kycSubmitted, verified: kycVerified },
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// Users list + search
// ─────────────────────────────────────────────
router.get('/users', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const q = (req.query.q || '').trim();
        const where = {};
        if (q) {
            where.OR = [
                { phone: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
            ];
        }
        const users = await prisma_1.prisma.user.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true, phone: true, name: true, email: true,
                kycStatus: true, creditScore: true, createdAt: true,
                _count: { select: { loans: true, guarantors: true } },
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
// Single user detail
// ─────────────────────────────────────────────
router.get('/users/:id', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, phone: true, name: true, email: true,
                kycStatus: true, creditScore: true, createdAt: true, updatedAt: true,
                loans: {
                    orderBy: { appliedAt: 'desc' },
                    include: { repayments: { orderBy: { createdAt: 'desc' } } },
                },
                guarantors: { orderBy: { createdAt: 'asc' } },
                kyc: true,
            },
        });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        return res.json({ user });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// Loans list with filters
// ─────────────────────────────────────────────
router.get('/loans', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const status = req.query.status;
        const range = req.query.range;
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const where = {};
        if (status && status !== 'ALL')
            where.status = status;
        if (range && range !== 'all') {
            const now = new Date();
            let from;
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
        const loans = await prisma_1.prisma.loan.findMany({
            where,
            orderBy: { appliedAt: 'desc' },
            take: limit,
            include: {
                user: { select: { id: true, phone: true, name: true, kycStatus: true } },
                repayments: { select: { amount: true, status: true } },
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
// KYC list
// ─────────────────────────────────────────────
router.get('/kyc', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const status = req.query.status;
        const where = {};
        if (status && status !== 'ALL')
            where.status = status;
        const submissions = await prisma_1.prisma.kyc.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { id: true, phone: true, name: true } } },
        });
        return res.json({ submissions });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// KYC approve
// ─────────────────────────────────────────────
router.post('/kyc/:id/approve', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const kyc = await prisma_1.prisma.kyc.findUnique({ where: { id: req.params.id } });
        if (!kyc)
            return res.status(404).json({ error: 'KYC not found' });
        await prisma_1.prisma.kyc.update({
            where: { id: kyc.id },
            data: { status: 'VERIFIED', verifiedAt: new Date() },
        });
        await prisma_1.prisma.user.update({
            where: { id: kyc.userId },
            data: { kycStatus: 'VERIFIED', creditScore: { increment: 50 } },
        });
        console.log(`[ADMIN] KYC approved for user ${kyc.userId}`);
        await (0, notifications_1.createNotification)({
            userId: kyc.userId,
            type: 'KYC_VERIFIED',
            title: 'Identity Verified ✅',
            message: 'Your identity has been verified. You can now apply for higher loan limits.',
        });
        return res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// KYC reject
// ─────────────────────────────────────────────
const rejectKycSchema = zod_1.z.object({ reason: zod_1.z.string().max(200).optional() });
router.post('/kyc/:id/reject', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const { reason } = rejectKycSchema.parse(req.body || {});
        const kyc = await prisma_1.prisma.kyc.findUnique({ where: { id: req.params.id } });
        if (!kyc)
            return res.status(404).json({ error: 'KYC not found' });
        await prisma_1.prisma.kyc.update({
            where: { id: kyc.id },
            data: { status: 'REJECTED' },
        });
        await prisma_1.prisma.user.update({
            where: { id: kyc.userId },
            data: { kycStatus: 'REJECTED' },
        });
        console.log(`[ADMIN] KYC rejected for user ${kyc.userId}`);
        await (0, notifications_1.createNotification)({
            userId: kyc.userId,
            type: 'LOAN_REJECTED',
            title: 'KYC Verification Failed',
            message: reason || 'Your identity documents could not be verified. Please resubmit clear photos.',
        });
        return res.json({ success: true });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// Approve loan + trigger referral bonus
// ─────────────────────────────────────────────
router.post('/loans/:id/approve', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const loanId = req.params.id;
        const loan = await prisma_1.prisma.loan.findUnique({
            where: { id: loanId },
            include: { user: true },
        });
        if (!loan)
            return res.status(404).json({ error: 'Loan not found' });
        if (loan.status !== 'PENDING') {
            return res.status(400).json({
                error: `Cannot approve a loan with status ${loan.status}`,
            });
        }
        const dueDate = new Date(Date.now() + loan.durationDays * 24 * 60 * 60 * 1000);
        const updated = await prisma_1.prisma.loan.update({
            where: { id: loanId },
            data: { status: 'ACTIVE', approvedAt: new Date(), dueDate },
        });
        console.log(`[ADMIN] Approved loan ${loanId}`);
        await (0, notifications_1.createNotification)({
            userId: loan.userId,
            type: 'LOAN_APPROVED',
            title: 'Loan Approved! 🎉',
            message: `Your loan of UGX ${loan.amount.toLocaleString()} has been approved. Total due: UGX ${loan.totalDue.toLocaleString()}.`,
            metadata: { loanId: loan.id },
        });
        // Referral bonus
        if (loan.user.referredById && !loan.user.referralBonusPaid) {
            const REFERRER_BONUS = 20000;
            const REFEREE_BONUS = 20000;
            await prisma_1.prisma.user.update({
                where: { id: loan.userId },
                data: {
                    referralBonusPaid: true,
                    referralCredit: { increment: REFEREE_BONUS },
                },
            });
            await prisma_1.prisma.user.update({
                where: { id: loan.user.referredById },
                data: { referralCredit: { increment: REFERRER_BONUS } },
            });
            await (0, notifications_1.createNotification)({
                userId: loan.userId,
                type: 'GUARANTOR_VERIFIED',
                title: 'Referral Bonus Received! 🎁',
                message: `You earned UGX ${REFEREE_BONUS.toLocaleString()} credit for joining with a referral code.`,
            });
            await (0, notifications_1.createNotification)({
                userId: loan.user.referredById,
                type: 'GUARANTOR_VERIFIED',
                title: 'Referral Bonus Earned! 🎉',
                message: `You earned UGX ${REFERRER_BONUS.toLocaleString()} credit because someone you referred got approved.`,
            });
            console.log(`[REFERRAL] Bonus paid: referrer ${loan.user.referredById} +UGX ${REFERRER_BONUS}, referee ${loan.userId} +UGX ${REFEREE_BONUS}`);
        }
        return res.json({ success: true, loan: updated });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// Reject loan
// ─────────────────────────────────────────────
const rejectSchema = zod_1.z.object({ reason: zod_1.z.string().max(200).optional() });
router.post('/loans/:id/reject', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const loanId = req.params.id;
        const { reason } = rejectSchema.parse(req.body || {});
        const loan = await prisma_1.prisma.loan.findUnique({ where: { id: loanId } });
        if (!loan)
            return res.status(404).json({ error: 'Loan not found' });
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
// ─────────────────────────────────────────────
// CSV export
// ─────────────────────────────────────────────
router.get('/export/loans.csv', adminAuth_1.requireAdmin, async (req, res) => {
    try {
        const status = req.query.status;
        const where = {};
        if (status && status !== 'ALL')
            where.status = status;
        const loans = await prisma_1.prisma.loan.findMany({
            where,
            orderBy: { appliedAt: 'desc' },
            include: {
                user: { select: { phone: true, name: true } },
                repayments: true,
            },
        });
        const header = 'ID,Phone,Name,Amount (UGX),Interest Rate,Total Due (UGX),Repaid (UGX),Outstanding (UGX),Status,Duration (days),Applied At\n';
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
        res.setHeader('Content-Disposition', `attachment; filename="jobacks-loans-${Date.now()}.csv"`);
        return res.send(csv);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/admin/run-penalties
// Trigger penalty calculation manually
// ─────────────────────────────────────────────
router.post('/run-penalties', adminAuth_1.requireAdmin, async (_req, res) => {
    try {
        console.log('[ADMIN] Manual penalty check triggered');
        const result = await (0, penalty_1.runPenaltyCheck)();
        return res.json({ success: true, ...result });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map