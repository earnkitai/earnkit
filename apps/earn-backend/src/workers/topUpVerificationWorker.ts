import { prisma } from '../lib/prisma';
import { BalanceService } from '../services/balanceService';
import { TopUpService } from '../services/topUpService';

const POLL_INTERVAL_MS = parseInt(process.env.TOPUP_POLL_INTERVAL_MS ?? String(30_000), 10);
const MAX_ATTEMPTS = 10;
// Retry back-off: attempt N waits N * BASE_DELAY_MS before next attempt
const BASE_DELAY_MS = 15_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function processPendingTransactions(): Promise<void> {
  const now = new Date();

  const pending = await prisma.topUpTransaction.findMany({
    where: {
      status: 'PENDING',
      // Only pick up rows that are due for a retry
      OR: [
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: now } },
      ],
    },
    select: { txHash: true, attemptCount: true },
  });

  if (pending.length === 0) return;

  console.log(`[TopUpWorker] Processing ${pending.length} pending transaction(s)`);

  const balanceService = new BalanceService();
  const topUpService = new TopUpService(balanceService);

  for (const tx of pending) {
    const attempt = (tx.attemptCount ?? 0) + 1;

    if (attempt > MAX_ATTEMPTS) {
      await prisma.topUpTransaction.update({
        where: { txHash: tx.txHash },
        data: {
          status: 'FAILED',
          errorMessage: `Verification abandoned after ${MAX_ATTEMPTS} attempts`,
        },
      });
      console.log(`[TopUpWorker] Abandoned ${tx.txHash} after ${MAX_ATTEMPTS} attempts`);
      continue;
    }

    // Stamp the attempt count and schedule next retry before we verify,
    // so a crash mid-verify doesn't leave the row eligible for immediate re-pickup.
    const nextAttemptAt = new Date(Date.now() + attempt * BASE_DELAY_MS);
    await prisma.topUpTransaction.update({
      where: { txHash: tx.txHash },
      data: { attemptCount: attempt, nextAttemptAt },
    });

    try {
      await topUpService.verifyAndCredit(tx.txHash);
    } catch (err: any) {
      console.error(`[TopUpWorker] Error verifying ${tx.txHash}:`, err?.message);
    }
  }
}

export function startTopUpVerificationWorker(): void {
  if (intervalHandle) return;
  console.log(`[TopUpWorker] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`);
  // Run once immediately to pick up anything left over from the last process run
  processPendingTransactions().catch((e) =>
    console.error('[TopUpWorker] Initial run error:', e),
  );
  intervalHandle = setInterval(() => {
    processPendingTransactions().catch((e) =>
      console.error('[TopUpWorker] Poll error:', e),
    );
  }, POLL_INTERVAL_MS);
}

export function stopTopUpVerificationWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
