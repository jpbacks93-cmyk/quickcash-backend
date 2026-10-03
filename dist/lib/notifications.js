"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotification = void 0;
const prisma_1 = require("./prisma");
/**
 * Create a notification for a user.
 * Never throws — logs on error so it doesn't break the main flow.
 */
async function createNotification({ userId, type, title, message, metadata, }) {
    try {
        await prisma_1.prisma.notification.create({
            data: {
                userId,
                type,
                title,
                message,
                metadata: metadata ? JSON.stringify(metadata) : null,
            },
        });
        console.log(`[NOTIF] ${type} → user ${userId}`);
    }
    catch (err) {
        console.error('[NOTIF] Failed to create:', err?.message || err);
    }
}
exports.createNotification = createNotification;
//# sourceMappingURL=notifications.js.map