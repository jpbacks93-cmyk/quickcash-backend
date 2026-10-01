"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────
// GET /api/guarantors — list my guarantors
// ─────────────────────────────────────────────
router.get('/', auth_1.requireAuth, async (req, res) => {
    try {
        const guarantors = await prisma_1.prisma.guarantor.findMany({
            where: { userId: req.user.userId },
            orderBy: { createdAt: 'asc' },
        });
        return res.json({ guarantors });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/guarantors — add a guarantor
// ─────────────────────────────────────────────
const addSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(100),
    phone: zod_1.z.string().min(7),
    email: zod_1.z.string().email().optional(),
    relationship: zod_1.z.string().min(2).max(50),
    idNumber: zod_1.z.string().min(4).max(50).optional(),
});
router.post('/', auth_1.requireAuth, async (req, res) => {
    try {
        const data = addSchema.parse(req.body);
        // Check count — max 2
        const count = await prisma_1.prisma.guarantor.count({
            where: { userId: req.user.userId },
        });
        if (count >= 2) {
            return res
                .status(400)
                .json({ error: 'Maximum of 2 guarantors allowed' });
        }
        // Prevent duplicate phone
        const existing = await prisma_1.prisma.guarantor.findFirst({
            where: { userId: req.user.userId, phone: data.phone },
        });
        if (existing) {
            return res
                .status(400)
                .json({ error: 'A guarantor with this phone already exists' });
        }
        // Generate a fake OTP for dev (real SMS would send this)
        const otpCode = '123456';
        const guarantor = await prisma_1.prisma.guarantor.create({
            data: {
                userId: req.user.userId,
                name: data.name,
                phone: data.phone,
                email: data.email || null,
                relationship: data.relationship,
                idNumber: data.idNumber || null,
                status: 'PENDING',
                otpCode,
            },
        });
        console.log(`[GUARANTOR] ${data.name} (${data.phone}) added by ${req.user.phone} | OTP: ${otpCode}`);
        return res.json({
            success: true,
            guarantor,
            devOtp: otpCode, // remove in production
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
// POST /api/guarantors/:id/verify — verify via OTP
// ─────────────────────────────────────────────
const verifySchema = zod_1.z.object({
    code: zod_1.z.string().length(6),
});
router.post('/:id/verify', auth_1.requireAuth, async (req, res) => {
    try {
        const { code } = verifySchema.parse(req.body);
        const guarantor = await prisma_1.prisma.guarantor.findFirst({
            where: { id: req.params.id, userId: req.user.userId },
        });
        if (!guarantor) {
            return res.status(404).json({ error: 'Guarantor not found' });
        }
        if (guarantor.status === 'VERIFIED') {
            return res.json({ success: true, message: 'Already verified', guarantor });
        }
        if (guarantor.otpCode !== code) {
            return res.status(400).json({ error: 'Invalid code' });
        }
        const updated = await prisma_1.prisma.guarantor.update({
            where: { id: guarantor.id },
            data: {
                status: 'VERIFIED',
                verifiedAt: new Date(),
                otpCode: null,
            },
        });
        console.log(`[GUARANTOR] ${guarantor.name} verified`);
        return res.json({ success: true, guarantor: updated });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Invalid code' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// DELETE /api/guarantors/:id
// ─────────────────────────────────────────────
router.delete('/:id', auth_1.requireAuth, async (req, res) => {
    try {
        const guarantor = await prisma_1.prisma.guarantor.findFirst({
            where: { id: req.params.id, userId: req.user.userId },
        });
        if (!guarantor) {
            return res.status(404).json({ error: 'Guarantor not found' });
        }
        await prisma_1.prisma.guarantor.delete({ where: { id: guarantor.id } });
        return res.json({ success: true });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=guarantors.js.map