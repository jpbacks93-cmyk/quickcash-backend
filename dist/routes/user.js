"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────
// GET /api/user/me  — get current user profile
// ─────────────────────────────────────────────
router.get('/me', auth_1.requireAuth, async (req, res) => {
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                phone: true,
                name: true,
                email: true,
                kycStatus: true,
                creditScore: true,
                createdAt: true,
            },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({ user });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// PUT /api/user/me  — update name / email
// ─────────────────────────────────────────────
const updateSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(100).optional(),
    email: zod_1.z.string().email().optional(),
});
router.put('/me', auth_1.requireAuth, async (req, res) => {
    try {
        const data = updateSchema.parse(req.body);
        const user = await prisma_1.prisma.user.update({
            where: { id: req.user.userId },
            data,
            select: {
                id: true,
                phone: true,
                name: true,
                email: true,
                kycStatus: true,
                creditScore: true,
            },
        });
        return res.json({ success: true, user });
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
//# sourceMappingURL=user.js.map