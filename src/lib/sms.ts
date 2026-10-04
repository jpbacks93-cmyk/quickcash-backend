// @ts-ignore — africastalking ships without TypeScript types
import AfricasTalking from 'africastalking';

const AT_USERNAME = process.env.AT_USERNAME || '';
const AT_API_KEY = process.env.AT_API_KEY || '';
const AT_SENDER_ID = process.env.AT_SENDER_ID || '';

let smsClient: any = null;

if (AT_USERNAME && AT_API_KEY) {
  try {
    const at = AfricasTalking({
      username: AT_USERNAME,
      apiKey: AT_API_KEY,
    });
    smsClient = at.SMS;
    console.log(`[SMS] Africa's Talking initialized (user: ${AT_USERNAME})`);
  } catch (err: any) {
    console.error('[SMS] Initialization failed:', err?.message || err);
  }
} else {
  console.log('[SMS] AT credentials missing — SMS will be skipped');
}

export async function sendSms(
  phone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!smsClient) {
    console.log(`[SMS] SKIPPED (no client) → ${phone}: ${message}`);
    return { success: false, error: 'SMS not configured' };
  }

  try {
    const result = await smsClient.send({
      to: [phone],
      message,
      from: AT_SENDER_ID || undefined,
    });

    const recipient = result?.SMSMessageData?.Recipients?.[0];
    if (recipient?.status === 'Success') {
      console.log(`[SMS] Sent to ${phone} | id: ${recipient.messageId}`);
      return { success: true, messageId: recipient.messageId };
    }

    console.log(`[SMS] Failed to ${phone}:`, recipient?.status);
    return { success: false, error: recipient?.status || 'Unknown error' };
  } catch (err: any) {
    console.error('[SMS] Error:', err?.message || err);
    return { success: false, error: err?.message || 'SMS send failed' };
  }
}

export async function sendOtpSms(phone: string, code: string) {
  const message = `Your Jobacks verification code is ${code}. It expires in 5 minutes. Do not share it.`;
  return sendSms(phone, message);
}