/**
 * One-shot: recompute `tokens_out_usd` for shared-split buyback executions from
 * the LIVE price feed — never a hardcoded value.
 *
 * Why: historically `tokensOutUsd` was copied from the pre-swap trigger estimate
 * (wrong — it hid slippage and mispriced pools). The correct value is the market
 * value of the tokens actually received: humanAmount(tokens_out_amount) × price.
 *
 * For each COMPLETED execution (optionally scoped to one config), this reads the
 * on-chain `tokens_out_amount` from the row, fetches the token's USD price via
 * the same `priceService` the app uses (CoinGecko → DexScreener, fail-closed),
 * and writes the recomputed value. It logs the price + timestamp it used so the
 * correction is auditable. Rows whose price can't be fetched are SKIPPED, never
 * guessed.
 *
 * All inputs via env (never commit secrets):
 *   DATABASE_URL   the earn-backend DB (already required by Prisma)
 *   CONFIG_ID      optional — limit to one SharedSplitBuybackConfig id
 *   DRY_RUN        optional — 'true' to print without writing (default: write)
 *
 * Run:
 *   CONFIG_ID=... DRY_RUN=true pnpm --filter earn-backend exec tsx src/scripts/repriceBuybackExecutions.ts
 */
import { formatUnits } from 'viem';
import { prisma } from '../lib/prisma';
import { priceService } from '../services/priceService';

async function main(): Promise<void> {
  const configId = process.env.CONFIG_ID || undefined;
  const dryRun = process.env.DRY_RUN === 'true';

  const executions = await prisma.sharedSplitExecution.findMany({
    where: {
      status: 'COMPLETED',
      tokensOutAmount: { not: null },
      ...(configId ? { configId } : {}),
    },
    include: { config: { select: { tokenAddress: true, tokenSymbol: true, tokenDecimals: true } } },
    orderBy: { startedAt: 'desc' },
  });

  console.log(
    `[reprice] ${executions.length} completed execution(s)${configId ? ` for config ${configId}` : ''}` +
      `${dryRun ? ' — DRY RUN' : ''}`,
  );

  let updated = 0;
  let skipped = 0;

  for (const exec of executions) {
    const cfg = exec.config;
    const rawAmount = exec.tokensOutAmount;
    if (!cfg || !rawAmount) {
      skipped++;
      continue;
    }

    let price: number;
    try {
      // Live market price by contract address (fail-closed: throws if no feed).
      price = await priceService.getTokenPriceUsd(cfg.tokenAddress);
    } catch (err) {
      console.warn(`[reprice] SKIP ${exec.id} — price unavailable for ${cfg.tokenSymbol}:`, err);
      skipped++;
      continue;
    }

    if (!(price > 0)) {
      console.warn(`[reprice] SKIP ${exec.id} — non-positive price for ${cfg.tokenSymbol}`);
      skipped++;
      continue;
    }

    const human = Number(formatUnits(BigInt(rawAmount), cfg.tokenDecimals));
    const tokensOutUsd = human * price;
    const pricedAt = new Date().toISOString();

    console.log(
      `[reprice] ${exec.id}: ${human} ${cfg.tokenSymbol} × $${price} = $${tokensOutUsd.toFixed(6)} ` +
        `(was $${exec.tokensOutUsd ?? 'null'}) @ ${pricedAt}`,
    );

    if (!dryRun) {
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { tokensOutUsd },
      });
    }
    updated++;
  }

  console.log(`[reprice] done — ${updated} ${dryRun ? 'would update' : 'updated'}, ${skipped} skipped`);
}

main()
  .catch((err) => {
    console.error('[reprice] fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
