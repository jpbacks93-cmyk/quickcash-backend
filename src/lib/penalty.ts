import { prisma } from './prisma';
import { createNotification } from './notifications';

// Penalty rate: 5% of outstanding per 7 days = 0.714% per day
const DAILY_PENALTY_RATE = 0.05 / 7;

// Cap: penalty cannot exceed 30% of original loan amount
const MAX_PENALTY_RATIO = 0.30;

/**
 * Calculate the penalty for a loan based on days late.
 * Returns { daysLate, penaltyAmount, shouldMarkDefaulted }
 */
export function calculatePenalty(
  loanAmount: number,
  totalDue: number,
  totalRepaid: number,
  dueDate: Date,
  now: Date = new Date()
): {
  daysLate: number;
  penaltyAmount: number;
  shouldMarkDefaulted: boolean;
} {
  if (now <= dueDate) {
    return { daysLate: 0, penaltyAmount: 0, shouldMarkDefaulted: false };
  }

  const msLate = now.getTime() - dueDate.getTime();
  const daysLate = Math.floor(msLate / (24 * 60 * 60 * 1000));

  // Outstanding balance (without penalty)
  const outstanding = Math.max(0, totalDue - totalRepaid);

  // Raw penalty
  let penaltyAmount = outstanding * DAILY_PENALTY_RATE * daysLate;

  // Apply cap
  const maxPenalty = loanAmount * MAX_PENALTY_RATIO;
  if (penaltyAmount > maxPenalty) {
    penaltyAmount = maxPenalty;
  }

  // Mark as DEFAULTED after 60 days
  const shouldMarkDefaulted = daysLate >= 60;

  return {
    daysLate,
    penaltyAmount: Math.round(penaltyAmount * 100) / 100,
    shouldMarkDefaulted,
  };
}

/**
 * Run the penalty calculation for all overdue loans.
 * Called via cron (or admin trigger).
 */
export async function runPenaltyCheck(): Promise<{
  processed: number;
  updated: number;
  defaulted: number;
}> {
  console.log('[PENALTY] Running penalty check...');

  const now = new Date();

  // Find all ACTIVE loans past due
  const overdueLoans = await prisma.loan.findMany({
    where: {
      status: 'ACTIVE',
      dueDate: { lt: now },
    },
    include: {
      repayments: true,
      user: { select: { phone: true, name: true } },
    },
  });

  let updated = 0;
  let defaulted = 0;

  for (const loan of overdueLoans) {
    const totalRepaid = loan.repayments
      .filter((r) => r.status === 'SUCCESSFUL')
      .reduce((sum, r) => sum + r.amount, 0);

    const result = calculatePenalty(
      loan.amount,
      loan.totalDue,
      totalRepaid,
      loan.dueDate!,
      now
    );

    // Skip if no change
    const penaltyChanged =
      Math.abs(result.penaltyAmount - loan.lateFee) > 0.5;
    const daysChanged = result.daysLate !== loan.daysLate;
    const statusChanged = result.shouldMarkDefaulted;

    if (!penaltyChanged && !daysChanged && !statusChanged) continue;

    // Update loan
    const updateData: any = {
      lateFee: result.penaltyAmount,
      daysLate: result.daysLate,
      lastPenaltyAt: now,
    };

    if (result.shouldMarkDefaulted) {
      updateData.status = 'DEFAULTED';
      defaulted++;
    }

    await prisma.loan.update({
      where: { id: loan.id },
      data: updateData,
    });

    // Notify user if penalty crossed into a new milestone
    if (daysChanged && result.daysLate > 0) {
      // Only notify on key milestones to avoid spam
      const shouldNotify =
        result.daysLate === 1 ||
        result.daysLate % 7 === 0 ||
        result.shouldMarkDefaulted;

      if (shouldNotify) {
        await createNotification({
          userId: loan.userId,
          type: 'LOAN_DUE_SOON',
          title: result.shouldMarkDefaulted
            ? '⚠️ Loan Marked as Defaulted'
            : '⚠️ Payment Overdue',
          message: result.shouldMarkDefaulted
            ? `Your loan is ${result.daysLate} days overdue and has been marked as DEFAULTED. Please contact support immediately.`
            : `Your payment is ${result.daysLate} day${result.daysLate > 1 ? 's' : ''} late. A penalty of UGX ${result.penaltyAmount.toLocaleString()} has been added.`,
          metadata: { loanId: loan.id, daysLate: result.daysLate },
        });
      }
    }

    updated++;
    console.log(
      `[PENALTY] Loan ${loan.id} (${loan.user.phone}): ${result.daysLate} days late, penalty UGX ${result.penaltyAmount.toLocaleString()}`
    );
  }

  console.log(`[PENALTY] Complete: ${overdueLoans.length} checked, ${updated} updated, ${defaulted} defaulted`);

  return {
    processed: overdueLoans.length,
    updated,
    defaulted,
  };
}