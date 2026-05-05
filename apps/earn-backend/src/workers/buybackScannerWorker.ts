import { prisma } from '../lib/prisma';
import { snapshotBuybackBalance } from '../lib/buybackBalance';

const POLL_INTERVAL_MS = 5 * 60_000; // 5 min
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function scan(): Promise<void> {
  const configs = await prisma.buybackConfig.findMany({
    where: { isActive: true },
  });

  if (configs.length === 0) return;

  console.log(`[BuybackScanner] Scanning ${configs.length} active config(s)`);

  for (const config of configs) {
    try {
      // Skip if a non-terminal execution already exists — let the executor finish first.
      const inFlight = await prisma.buybackExecution.findFirst({
        where: {
          buybackConfigId: config.id,
          status: { in: ['QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING'] },
        },
        select: { id: true },
      });
      if (inFlight) {
        await prisma.buybackConfig.update({
          where: { id: config.id },
          data: { lastCheckedAt: new Date() },
        });
        continue;
      }

      const snapshot = await snapshotBuybackBalance(
        config.walletAddress as `0x${string}`,
      );

      await prisma.buybackConfig.update({
        where: { id: config.id },
        data: { lastCheckedAt: new Date() },
      });

      if (snapshot.totalUsd < config.thresholdUsd) {
        continue;
      }

      await prisma.buybackExecution.create({
        data: {
          buybackConfigId: config.id,
          status: 'QUEUED',
          triggerBalanceUsd: snapshot.totalUsd,
          assetsIn: snapshot.assets as any,
        },
      });

      console.log(
        `[BuybackScanner] Queued buyback for config ${config.id} ($${snapshot.totalUsd.toFixed(2)} >= $${config.thresholdUsd})`,
      );
    } catch (err) {
      console.error(
        `[BuybackScanner] Error processing config ${config.id}:`,
        err,
      );
    }
  }
}

export function startBuybackScannerWorker(): void {
  if (intervalHandle) return;
  console.log(
    `[BuybackScanner] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`,
  );
  scan().catch((e) => console.error('[BuybackScanner] Initial run error:', e));
  intervalHandle = setInterval(() => {
    scan().catch((e) => console.error('[BuybackScanner] Poll error:', e));
  }, POLL_INTERVAL_MS);
}

export function stopBuybackScannerWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
