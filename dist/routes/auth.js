"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const jwt_1 = require("../lib/jwt");
const auth_1 = require("../middleware/auth");
const sms_1 = require("../lib/sms");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────
// OTP generation & dev-mode helpers
// ─────────────────────────────────────────────
function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
function generateFakeCode() {
    return '123456';
}
function shouldAllowDevOtp() {
    return (process.env.ALLOW_DEV_OTP === 'true' ||
        process.env.NODE_ENV !== 'production');
}
// ─────────────────────────────────────────────
// POST /api/auth/send-otp
// ─────────────────────────────────────────────
const sendOtpSchema = zod_1.z.object({
    phone: zod_1.z.string().min(7),
});
router.post('/send-otp', async (req, res) => {
    try {
        const { phone } = sendOtpSchema.parse(req.body);
        const allowDev = shouldAllowDevOtp();
        const code = allowDev ? generateFakeCode() : generateOtp();
        await prisma_1.prisma.otp.deleteMany({ where: { phone } });
        await prisma_1.prisma.otp.create({
            data: {
                phone,
                code,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
        });
        let smsSent = false;
        if (!allowDev) {
            const result = await (0, sms_1.sendOtpSms)(phone, code);
            smsSent = result.success;
        }
        else {
            console.log(`[OTP] DEV MODE → ${phone} | Code: ${code}`);
        }
        return res.json({
            success: true,
            message: allowDev
                ? 'OTP sent (dev mode — no SMS)'
                : smsSent
                    ? 'OTP sent via SMS'
                    : 'OTP created but SMS delivery failed',
            devCode: allowDev ? code : undefined,
        });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/auth/verify-otp
// ─────────────────────────────────────────────
const verifyOtpSchema = zod_1.z.object({
    phone: zod_1.z.string().min(7),
    code: zod_1.z.string().length(6),
});
router.post('/verify-otp', async (req, res) => {
    try {
        const { phone, code } = verifyOtpSchema.parse(req.body);
        const otp = await prisma_1.prisma.otp.findFirst({
            where: { phone },
            orderBy: { createdAt: 'desc' },
        });
        if (!otp) {
            return res
                .status(400)
                .json({ error: 'No OTP found. Request a new one.' });
        }
        if (otp.expiresAt < new Date()) {
            return res
                .status(400)
                .json({ error: 'OTP expired. Request a new one.' });
        }
        if (otp.code !== code) {
            await prisma_1.prisma.otp.update({
                where: { id: otp.id },
                data: { attempts: { increment: 1 } },
            });
            return res.status(400).json({ error: 'Invalid code' });
        }
        await prisma_1.prisma.otp.delete({ where: { id: otp.id } });
        let user = await prisma_1.prisma.user.findUnique({ where: { phone } });
        const isNewUser = !user;
        if (!user) {
            user = await prisma_1.prisma.user.create({
                data: { phone },
            });
        }
        const token = (0, jwt_1.signToken)({ userId: user.id, phone: user.phone });
        return res.json({
            success: true,
            token,
            isNewUser,
            user: {
                id: user.id,
                phone: user.phone,
                name: user.name,
                kycStatus: user.kycStatus,
                creditScore: user.creditScore,
                hasPin: !!user.pinHash,
            },
        });
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
// POST /api/auth/set-pin  (protected)
// ─────────────────────────────────────────────
const setPinSchema = zod_1.z.object({
    pin: zod_1.z.string().length(4).regex(/^\d+$/, 'PIN must be digits'),
});
router.post('/set-pin', auth_1.requireAuth, async (req, res) => {
    try {
        const { pin } = setPinSchema.parse(req.body);
        const pinHash = await bcrypt_1.default.hash(pin, 10);
        await prisma_1.prisma.user.update({
            where: { id: req.user.userId },
            data: { pinHash },
        });
        return res.json({ success: true });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'PIN must be 4 digits' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/auth/login-pin  (protected)
// ─────────────────────────────────────────────
router.post('/login-pin', auth_1.requireAuth, async (req, res) => {
    try {
        const { pin } = setPinSchema.parse(req.body);
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.user.userId },
        });
        if (!user || !user.pinHash) {
            return res.status(400).json({ error: 'No PIN set' });
        }
        const ok = await bcrypt_1.default.compare(pin, user.pinHash);
        if (!ok) {
            return res.status(400).json({ error: 'Wrong PIN' });
        }
        return res.json({ success: true });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'PIN must be 4 digits' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// ─────────────────────────────────────────────
// POST /api/auth/change-pin  (protected)
// ─────────────────────────────────────────────
const changePinSchema = zod_1.z.object({
    oldPin: zod_1.z.string().length(4).regex(/^\d+$/),
    newPin: zod_1.z.string().length(4).regex(/^\d+$/),
});
router.post('/change-pin', auth_1.requireAuth, async (req, res) => {
    try {
        const { oldPin, newPin } = changePinSchema.parse(req.body);
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.user.userId },
        });
        if (!user || !user.pinHash) {
            return res.status(400).json({ error: 'No PIN set' });
        }
        const ok = await bcrypt_1.default.compare(oldPin, user.pinHash);
        if (!ok) {
            return res.status(400).json({ error: 'Current PIN is incorrect' });
        }
        if (oldPin === newPin) {
            return res.status(400).json({ error: 'New PIN must be different' });
        }
        const newPinHash = await bcrypt_1.default.hash(newPin, 10);
        await prisma_1.prisma.user.update({
            where: { id: req.user.userId },
            data: { pinHash: newPinHash },
        });
        console.log(`[AUTH] PIN changed for user ${req.user.phone}`);
        return res.json({ success: true });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: 'PIN must be 4 digits' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map