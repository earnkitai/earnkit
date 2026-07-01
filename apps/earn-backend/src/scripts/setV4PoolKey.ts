/**
 * One-shot: set (and VERIFY) a shared-split buyback config's Uniswap v4 pool key.
 *
 * The MINI buyback was routing through the wrong v4 pool (Doppler assumptions on
 * a Clanker token) → ~800x worse-than-market fills. This script writes the
 * correct pool key, but ONLY after proving the resulting pool quotes within the
 * allowed market deviation. It never hardcodes prices and refuses to save a
 * pool that doesn't price sanely — so a wrong pool key can't be re-introduced.
 *
 * You supply the pool params from a TRUSTED source (the v4 Initialize event for
 * the pool on BaseScan, Clanker's authenticated API, or tokens.fun's pool-key
 * endpoint) — never guessed.
 *
 * Env (never commit secrets):
 *   DATABASE_URL           earn-backend DB
 *   BASE_RPC_URL           Base RPC (same as the app)
 *   CONFIG_ID              SharedSplitBuybackConfig id to fix
 *   V4_POOL_HOOK           the pool's hook address
 *   V4_PAIRED_TOKEN        the pool's paired token (e.g. WETH)
 *   V4_FEE_FLAG            uint24 fee
 *   V4_TICK_SPACING        int24 tick spacing
 *   PROBE_WETH_IN          optional test size in WETH for the quote (default 0.01)
 *   BUYBACK_MAX_MARKET_DEVIATION_BPS  optional, same env the runtime guard uses
 *   DRY_RUN                'true' to verify without writing (default: write)
 *
 * Run:
 *   CONFIG_ID=... V4_POOL_HOOK=0x... V4_PAIRED_TOKEN=0x... V4_FEE_FLAG=... \
 *   V4_TICK_SPACING=... DRY_RUN=true \
 *     pnpm --filter earn-backend exec tsx src/scripts/setV4PoolKey.ts
 */
import { getAddress, parseUnits, formatUnits } from 'viem';
import { prisma } from '../lib/prisma';
import { priceService } from '../services/priceService';
import { getBasePublicClient } from '../lib/splitsWarehouse';
import { buildV4SwapPlan, estimateV4Output } from '../lib/uniswapV4';
import { WETH_BASE } from '../lib/uniswap';

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function maxDeviationBps(): number {
  const raw = parseInt(process.env.BUYBACK_MAX_MARKET_DEVIATION_BPS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 && raw < 10_000 ? raw : 1500;
}

async function main(): Promise<void> {
  const configId = reqEnv('CONFIG_ID');
  const hook = getAddress(reqEnv('V4_POOL_HOOK')) as `0x${string}`;
  const pairedToken = getAddress(reqEnv('V4_PAIRED_TOKEN')) as `0x${string}`;
  const fee = Number(reqEnv('V4_FEE_FLAG'));
  const tickSpacing = Number(reqEnv('V4_TICK_SPACING'));
  const dryRun = process.env.DRY_RUN === 'true';
  const probe = process.env.PROBE_WETH_IN ?? '0.01';

  if (!Number.isInteger(fee) || !Number.isInteger(tickSpacing)) {
    console.error('V4_FEE_FLAG and V4_TICK_SPACING must be integers');
    process.exit(1);
  }

  const config = await prisma.sharedSplitBuybackConfig.findUnique({ where: { id: configId } });
  if (!config) {
    console.error(`config ${configId} not found`);
    process.exit(1);
  }

  const client = getBasePublicClient();
  const target = getAddress(config.tokenAddress) as `0x${string}`;

  // Build the candidate pool and probe an actual quote from it.
  const plan = buildV4SwapPlan({
    tokenAddress: target,
    pairedToken,
    hook,
    fee,
    tickSpacing,
    inputCurrency: pairedToken,
  });
  const amountIn = parseUnits(probe, 18);
  const expectedOut = await estimateV4Output({ plan, amountIn, client });

  console.log(`[setV4PoolKey] candidate poolId: ${plan.poolId}`);

  // Hard gate: the (hook, fee, tickSpacing, tokens) must derive the EXACT pool
  // we intend. If EXPECTED_POOL_ID is provided and doesn't match, the params are
  // wrong — refuse rather than point the buyback at some other pool.
  const expectedPoolId = process.env.EXPECTED_POOL_ID?.toLowerCase();
  if (expectedPoolId && plan.poolId.toLowerCase() !== expectedPoolId) {
    console.error(
      `[setV4PoolKey] REFUSING: derived poolId ${plan.poolId} != expected ${expectedPoolId}. ` +
        'Pool-key params (hook / fee / tickSpacing / paired token) are wrong.',
    );
    process.exit(1);
  }

  if (expectedOut === BigInt(0)) {
    console.error('[setV4PoolKey] REFUSING: pool not readable / no liquidity for these params.');
    process.exit(1);
  }

  // Compare the pool's quote to the independent market feed (fail-closed).
  const inputPrice =
    pairedToken.toLowerCase() === WETH_BASE.toLowerCase()
      ? await priceService.getEthPriceUsd()
      : await priceService.getTokenPriceUsd(pairedToken);
  const outputPrice = await priceService.getTokenPriceUsd(target);

  const inUsd = Number(formatUnits(amountIn, 18)) * inputPrice;
  const outUsd = Number(formatUnits(expectedOut, config.tokenDecimals)) * outputPrice;
  const bps = maxDeviationBps();
  const floor = (inUsd * (10_000 - bps)) / 10_000;

  console.log(
    `[setV4PoolKey] probe ${probe} ${pairedToken === WETH_BASE ? 'WETH' : pairedToken} ` +
      `($${inUsd.toFixed(2)}) -> ${formatUnits(expectedOut, config.tokenDecimals)} ${config.tokenSymbol} ` +
      `($${outUsd.toFixed(4)}); floor $${floor.toFixed(2)} at ${bps}bps`,
  );

  if (!(outUsd >= floor)) {
    console.error(
      '[setV4PoolKey] REFUSING: this pool quotes far below market — wrong pool key. Not saving.',
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log('[setV4PoolKey] DRY RUN — pool key verified sane, not written.');
    return;
  }

  await prisma.sharedSplitBuybackConfig.update({
    where: { id: configId },
    data: {
      swapVenue: 'UNISWAP_V4',
      v4PoolHook: hook,
      v4PairedToken: pairedToken,
      v4FeeFlag: fee,
      v4TickSpacing: tickSpacing,
    },
  });
  console.log('[setV4PoolKey] pool key updated and verified. Config still requires manual un-pause.');
}

main()
  .catch((err) => {
    console.error('[setV4PoolKey] fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
