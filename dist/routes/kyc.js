"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────
// GET /api/kyc — get my KYC status
// ─────────────────────────────────────────────
router.get('/', auth_1.requireAuth, async (req, res) => {
    try {
        const kyc = await prisma_1.prisma.kyc.findUnique({
            where: { userId: req.user.userId },
        });
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { kycStatus: true },
        });
        return res.json({
            kyc: kyc || null,
            kycStatus: user?.kycStatus || 'PENDING',
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/kyc/submit — submit ID documents
// ─────────────────────────────────────────────
const submitSchema = zod_1.z.object({
    documentType: zod_1.z.string().min(2).max(50),
    frontImageUrl: zod_1.z.string().min(4).optional(),
    backImageUrl: zod_1.z.string().min(4).optional(),
    selfieUrl: zod_1.z.string().min(4).optional(),
});
router.post('/submit', auth_1.requireAuth, async (req, res) => {
    try {
        const data = submitSchema.parse(req.body);
        // Upsert — user may re-submit
        const kyc = await prisma_1.prisma.kyc.upsert({
            where: { userId: req.user.userId },
            create: {
                userId: req.user.userId,
                documentType: data.documentType,
                frontImageUrl: data.frontImageUrl || null,
                backImageUrl: data.backImageUrl || null,
                selfieUrl: data.selfieUrl || null,
                status: 'PENDING',
            },
            update: {
                documentType: data.documentType,
                frontImageUrl: data.frontImageUrl || null,
                backImageUrl: data.backImageUrl || null,
                selfieUrl: data.selfieUrl || null,
                status: 'PENDING',
            },
        });
        // Auto-approve in dev
        if (process.env.NODE_ENV !== 'production') {
            await prisma_1.prisma.kyc.update({
                where: { id: kyc.id },
                data: { status: 'VERIFIED', verifiedAt: new Date() },
            });
            await prisma_1.prisma.user.update({
                where: { id: req.user.userId },
                data: { kycStatus: 'VERIFIED', creditScore: { increment: 50 } },
            });
            console.log(`[KYC] Auto-verified user ${req.user.phone} (dev mode)`);
        }
        return res.json({
            success: true,
            message: 'KYC submitted',
            status: process.env.NODE_ENV !== 'production' ? 'VERIFIED' : 'PENDING',
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
exports.default = router;
//# sourceMappingURL=kyc.js.map