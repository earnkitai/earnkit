/**
 * One-shot: convert an existing (V3-provisioned) shared-split buyback to
 * Uniswap V4 — WITHOUT re-provisioning the wallet (funds stay in place).
 *
 * A buyback wallet's Turnkey policy is built at provisioning time from its
 * swapVenue. A config provisioned as UNISWAP_V3 has a policy that does NOT
 * authorize the V4 UniversalRouter, so merely flipping `swap_venue` in the DB
 * makes every V4 swap get rejected at signing. This script:
 *   1. Verifies the candidate V4 pool key derives the EXPECTED pool AND quotes
 *      within market (refuses otherwise — no wrong-pool routing).
 *   2. Attaches a NEW V4 policy to the existing sub-org (adds UniversalRouter +
 *      Permit2 authorization; the old V3 policy is left in place, harmless).
 *   3. Flips the config to V4 with the verified pool key + records the new
 *      policyId and the (previously null) stamper user IDs.
 *
 * All inputs via env (never commit secrets):
 *   DATABASE_URL                     earn-backend DB
 *   BASE_RPC_URL                     Base RPC
 *   TURNKEY_API_PUBLIC_KEY / _PRIVATE_KEY / TURNKEY_PARENT_ORG_ID   Turnkey creds
 *   TURNKEY_COSIGNER_PUBLIC_KEY      (needed only if it re-derives stampers)
 *   BUYBACK_TREASURY_ADDRESS         treasury (match runtime; needed if feeRateBps>0)
 *   CONFIG_ID                        the SharedSplitBuybackConfig id
 *   V4_POOL_HOOK / V4_PAIRED_TOKEN / V4_FEE_FLAG / V4_TICK_SPACING   pool key
 *   EXPECTED_POOL_ID                 the real poolId (hard-checked)
 *   PROBE_WETH_IN                    quote probe size, default 0.01
 *   DRY_RUN=true                     verify + fetch, but DON'T create policy or write DB
 *
 * Run (dry-run first):
 *   CONFIG_ID=... V4_POOL_HOOK=0x... V4_PAIRED_TOKEN=0x4200...0006 \
 *   V4_FEE_FLAG=8388608 V4_TICK_SPACING=200 EXPECTED_POOL_ID=0x... DRY_RUN=true \
 *     pnpm --filter earn-backend exec tsx src/scripts/attachBuybackV4Policy.ts
 */
import { getAddress, parseUnits, formatUnits } from 'viem';
import { prisma } from '../lib/prisma';
import { priceService } from '../services/priceService';
import { getBasePublicClient } from '../lib/splitsWarehouse';
import { buildV4SwapPlan, estimateV4Output } from '../lib/uniswapV4';
import { WETH_BASE } from '../lib/uniswap';
import { attachBuybackPolicy, getSubOrgStamperUserIds } from '../services/turnkeyService';

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
  const expectedPoolId = reqEnv('EXPECTED_POOL_ID').toLowerCase();
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
  if (!config.turnkeySubOrgId || !config.walletAddress) {
    console.error(`config ${configId} has no turnkeySubOrgId/walletAddress — cannot attach policy`);
    process.exit(1);
  }

  const client = getBasePublicClient();
  const target = getAddress(config.tokenAddress) as `0x${string}`;

  // --- Gate 1: the pool key must derive EXACTLY the expected pool ---
  const plan = buildV4SwapPlan({
    tokenAddress: target,
    pairedToken,
    hook,
    fee,
    tickSpacing,
    inputCurrency: pairedToken,
  });
  console.log(`[v4-policy] derived poolId: ${plan.poolId}`);
  if (plan.poolId.toLowerCase() !== expectedPoolId) {
    console.error(
      `[v4-policy] REFUSING: derived poolId != EXPECTED_POOL_ID. Pool-key params are wrong.`,
    );
    process.exit(1);
  }

  // --- Gate 2: the pool must quote within market ---
  const amountIn = parseUnits(probe, 18);
  const expectedOut = await estimateV4Output({ plan, amountIn, client });
  if (expectedOut === BigInt(0)) {
    console.error('[v4-policy] REFUSING: pool not readable / no liquidity.');
    process.exit(1);
  }
  const inPrice =
    pairedToken.toLowerCase() === WETH_BASE.toLowerCase()
      ? await priceService.getEthPriceUsd()
      : await priceService.getTokenPriceUsd(pairedToken);
  const outPrice = await priceService.getTokenPriceUsd(target);
  const inUsd = Number(formatUnits(amountIn, 18)) * inPrice;
  const outUsd = Number(formatUnits(expectedOut, config.tokenDecimals)) * outPrice;
  const floor = (inUsd * (10_000 - maxDeviationBps())) / 10_000;
  console.log(
    `[v4-policy] probe $${inUsd.toFixed(2)} -> ${formatUnits(expectedOut, config.tokenDecimals)} ` +
      `${config.tokenSymbol} ($${outUsd.toFixed(4)}); floor $${floor.toFixed(2)}`,
  );
  if (!(outUsd >= floor)) {
    console.error('[v4-policy] REFUSING: pool quotes far below market — wrong pool. Not proceeding.');
    process.exit(1);
  }

  // --- Fetch the sub-org stamper user IDs (they may be null in the DB) ---
  const { parentAdminUserId, coSignerUserId } = await getSubOrgStamperUserIds(config.turnkeySubOrgId);
  console.log(`[v4-policy] stampers: parentAdmin=${parentAdminUserId} coSigner=${coSignerUserId}`);

  if (dryRun) {
    console.log('[v4-policy] DRY RUN — pool + stampers verified. No policy created, no DB write.');
    return;
  }

  // --- Attach a NEW V4 policy to the existing sub-org ---
  const treasuryAddress = process.env.BUYBACK_TREASURY_ADDRESS;
  const { policyId } = await attachBuybackPolicy({
    subOrgId: config.turnkeySubOrgId,
    parentAdminUserId,
    coSignerUserId,
    policyParams: {
      userTokenAddress: target,
      recoveryAddress: getAddress(config.recoveryAddress) as `0x${string}`,
      ...(treasuryAddress ? { treasuryAddress: getAddress(treasuryAddress) as `0x${string}` } : {}),
      swapVenue: 'UNISWAP_V4',
    },
  });
  console.log(`[v4-policy] attached new V4 policy: ${policyId}`);

  // --- Flip the config to V4 with the verified pool key ---
  await prisma.sharedSplitBuybackConfig.update({
    where: { id: configId },
    data: {
      swapVenue: 'UNISWAP_V4',
      v4PoolHook: hook,
      v4PairedToken: pairedToken,
      v4FeeFlag: fee,
      v4TickSpacing: tickSpacing,
      policyId,
      parentAdminUserId,
      coSignerUserId,
    },
  });
  console.log('[v4-policy] config updated to V4. Buyback will now route through the real pool.');
}

main()
  .catch((err) => {
    console.error('[v4-policy] fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
