"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────
// GET /api/referral
// Get my referral code + stats + referred users
// ─────────────────────────────────────────────
router.get('/', auth_1.requireAuth, async (req, res) => {
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                referralCode: true,
                referralCredit: true,
            },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const referredUsers = await prisma_1.prisma.user.findMany({
            where: { referredById: req.user.userId },
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
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=referral.js.map