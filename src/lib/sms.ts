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

// ─────────────────────────────────────────────
// Base send function
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Helper: format UGX
// ─────────────────────────────────────────────
function formatUGX(amount: number): string {
  return 'UGX ' + Math.round(amount).toLocaleString('en-US');
}

// ─────────────────────────────────────────────
// OTP SMS
// ─────────────────────────────────────────────
export async function sendOtpSms(phone: string, code: string) {
  const message = `Your Jobacks verification code is ${code}. It expires in 5 minutes. Do not share it.`;
  return sendSms(phone, message);
}

// ─────────────────────────────────────────────
// Loan approved SMS
// ─────────────────────────────────────────────
export async function sendLoanApprovedSms(
  phone: string,
  amount: number,
  totalDue: number,
  dueDate: Date
) {
  const dateStr = dueDate.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const message =
    `Jobacks: Your loan of ${formatUGX(amount)} has been APPROVED. ` +
    `Total to repay: ${formatUGX(totalDue)} by ${dateStr}. ` +
    `Repay in the app.`;
  return sendSms(phone, message);
}

// ─────────────────────────────────────────────
// Loan rejected SMS
// ─────────────────────────────────────────────
export async function sendLoanRejectedSms(
  phone: string,
  reason: string
) {
  const message =
    `Jobacks: Your loan application was NOT approved. ` +
    `Reason: ${reason.slice(0, 100)}. ` +
    `You can reapply in 30 days.`;
  return sendSms(phone, message);
}

// ─────────────────────────────────────────────
// Repayment received SMS
// ─────────────────────────────────────────────
export async function sendRepaymentSms(
  phone: string,
  amountPaid: number,
  remaining: number
) {
  const message =
    `Jobacks: Payment received: ${formatUGX(amountPaid)}. ` +
    `Remaining balance: ${formatUGX(remaining)}. ` +
    `Thank you!`;
  return sendSms(phone, message);
}

// ─────────────────────────────────────────────
// Loan fully paid SMS
// ─────────────────────────────────────────────
export async function sendLoanPaidSms(phone: string) {
  const message =
    `Jobacks: Congratulations! Your loan is FULLY PAID. ` +
    `Your credit score has improved. Apply for a bigger loan next time!`;
  return sendSms(phone, message);
}

// ─────────────────────────────────────────────
// Loan overdue SMS
// ─────────────────────────────────────────────
export async function sendOverdueSms(
  phone: string,
  daysLate: number,
  lateFee: number,
  totalOwed: number
) {
  const message =
    `Jobacks: Your loan is ${daysLate} day${daysLate > 1 ? 's' : ''} OVERDUE. ` +
    `Late fee: ${formatUGX(lateFee)}. ` +
    `Total due now: ${formatUGX(totalOwed)}. ` +
    `Pay in the app to avoid further charges.`;
  return sendSms(phone, message);
}

// ─────────────────────────────────────────────
// Referral bonus SMS
// ─────────────────────────────────────────────
export async function sendReferralBonusSms(
  phone: string,
  bonus: number,
  newBalance: number
) {
  const message =
    `Jobacks: You earned ${formatUGX(bonus)} referral bonus! ` +
    `Your credit balance: ${formatUGX(newBalance)}. ` +
    `Credit applies to your next loan.`;
  return sendSms(phone, message);
}