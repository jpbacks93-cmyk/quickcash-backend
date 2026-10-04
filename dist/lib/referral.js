"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateUniqueReferralCode = void 0;
const prisma_1 = require("./prisma");
/**
 * Generate a unique 6-character referral code (uppercase alphanumeric).
 * Retries up to 5 times if a collision occurs.
 */
async function generateUniqueReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
    for (let attempt = 0; attempt < 5; attempt++) {
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        const existing = await prisma_1.prisma.user.findUnique({
            where: { referralCode: code },
        });
        if (!existing)
            return code;
    }
    // Fallback: longer code with timestamp
    return 'R' + Date.now().toString(36).toUpperCase().slice(-6);
}
exports.generateUniqueReferralCode = generateUniqueReferralCode;
//# sourceMappingURL=referral.js.map