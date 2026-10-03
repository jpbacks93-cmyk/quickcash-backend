"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────
// GET /api/notifications
// List user's notifications (newest first)
// ─────────────────────────────────────────────
router.get('/', auth_1.requireAuth, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const notifications = await prisma_1.prisma.notification.findMany({
            where: { userId: req.user.userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        const unreadCount = await prisma_1.prisma.notification.count({
            where: { userId: req.user.userId, read: false },
        });
        return res.json({
            notifications,
            unreadCount,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// GET /api/notifications/unread-count
// Just the count for the bell badge
// ─────────────────────────────────────────────
router.get('/unread-count', auth_1.requireAuth, async (req, res) => {
    try {
        const count = await prisma_1.prisma.notification.count({
            where: { userId: req.user.userId, read: false },
        });
        return res.json({ count });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/notifications/:id/read
// Mark one notification as read
// ─────────────────────────────────────────────
router.post('/:id/read', auth_1.requireAuth, async (req, res) => {
    try {
        const notif = await prisma_1.prisma.notification.findFirst({
            where: { id: req.params.id, userId: req.user.userId },
        });
        if (!notif) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        const updated = await prisma_1.prisma.notification.update({
            where: { id: notif.id },
            data: { read: true },
        });
        return res.json({ success: true, notification: updated });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/notifications/read-all
// Mark all as read
// ─────────────────────────────────────────────
router.post('/read-all', auth_1.requireAuth, async (req, res) => {
    try {
        await prisma_1.prisma.notification.updateMany({
            where: { userId: req.user.userId, read: false },
            data: { read: true },
        });
        return res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=notifications.js.map