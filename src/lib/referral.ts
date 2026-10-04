import { prisma } from './prisma';

/**
 * Generate a unique 6-character referral code (uppercase alphanumeric).
 * Retries up to 5 times if a collision occurs.
 */
export async function generateUniqueReferralCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars

  for (let attempt = 0; attempt < 5; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    const existing = await prisma.user.findUnique({
      where: { referralCode: code },
    });

    if (!existing) return code;
  }

  // Fallback: longer code with timestamp
  return 'R' + Date.now().toString(36).toUpperCase().slice(-6);
}