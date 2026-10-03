import { prisma } from './prisma';

export type NotificationType =
  | 'LOAN_APPLIED'
  | 'LOAN_APPROVED'
  | 'LOAN_REJECTED'
  | 'LOAN_DUE_SOON'
  | 'REPAYMENT_SUCCESS'
  | 'LOAN_PAID'
  | 'KYC_VERIFIED'
  | 'GUARANTOR_ADDED'
  | 'GUARANTOR_VERIFIED'
  | 'WELCOME';

interface CreateNotificationOptions {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

/**
 * Create a notification for a user.
 * Never throws — logs on error so it doesn't break the main flow.
 */
export async function createNotification({
  userId,
  type,
  title,
  message,
  metadata,
}: CreateNotificationOptions): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
    console.log(`[NOTIF] ${type} → user ${userId}`);
  } catch (err: any) {
    console.error('[NOTIF] Failed to create:', err?.message || err);
  }
}