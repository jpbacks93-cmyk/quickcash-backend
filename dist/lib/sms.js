"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendOtpSms = exports.sendSms = void 0;
// @ts-ignore — africastalking ships without TypeScript types
const africastalking_1 = __importDefault(require("africastalking"));
const AT_USERNAME = process.env.AT_USERNAME || '';
const AT_API_KEY = process.env.AT_API_KEY || '';
let smsClient = null;
if (AT_USERNAME && AT_API_KEY) {
    try {
        const at = (0, africastalking_1.default)({
            username: AT_USERNAME,
            apiKey: AT_API_KEY,
        });
        smsClient = at.SMS;
        console.log(`[SMS] Africa's Talking initialized (user: ${AT_USERNAME})`);
    }
    catch (err) {
        console.error('[SMS] Initialization failed:', err?.message || err);
    }
}
else {
    console.log('[SMS] AT credentials missing — SMS will be skipped');
}
/**
 * Send an SMS to a phone number.
 * Returns { success, messageId?, error? }
 */
async function sendSms(phone, message) {
    if (!smsClient) {
        console.log(`[SMS] SKIPPED (no client) → ${phone}: ${message}`);
        return { success: false, error: 'SMS not configured' };
    }
    try {
        const result = await smsClient.send({
            to: [phone],
            message,
        });
        // AT returns: { SMSMessageData: { Recipients: [ { status, messageId } ] } }
        const recipient = result?.SMSMessageData?.Recipients?.[0];
        if (recipient?.status === 'Success') {
            console.log(`[SMS] Sent to ${phone} | id: ${recipient.messageId}`);
            return { success: true, messageId: recipient.messageId };
        }
        console.log(`[SMS] Failed to ${phone}:`, recipient?.status);
        return { success: false, error: recipient?.status || 'Unknown error' };
    }
    catch (err) {
        console.error('[SMS] Error:', err?.message || err);
        return { success: false, error: err?.message || 'SMS send failed' };
    }
}
exports.sendSms = sendSms;
/**
 * Send an OTP SMS with a standardized message.
 */
async function sendOtpSms(phone, code) {
    const message = `Your QuickCash verification code is ${code}. It expires in 5 minutes. Do not share it.`;
    return sendSms(phone, message);
}
exports.sendOtpSms = sendOtpSms;
//# sourceMappingURL=sms.js.map