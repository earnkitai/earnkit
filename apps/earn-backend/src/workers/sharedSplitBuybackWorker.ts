import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseAbi,
  parseUnits,
  type Abi,
  type TransactionSerializableEIP1559,
} from 'viem';
import { getAddress, isAddress } from 'viem';
import { base } from 'viem/chains';
import { prisma } from '../lib/prisma';
import {
  encodeWarehouseWithdraw,
  getBasePublicClient,
  readWarehouseBalance,
  SPLIT_NATIVE_TOKEN_ADDRESS,
  SPLIT_WAREHOUSE_ADDRESS,
} from '../lib/splitsWarehouse';
import {
  applySlippage,
  encodeExactInput,
  quoteBestPath,
  UNISWAP_V3_SWAP_ROUTER_02,
  WETH_BASE,
} from '../lib/uniswap';
import * as V4 from '../lib/uniswapV4';
import { discoverWalletErc20s, discoverWarehouseTokens, isSeedToken } from '../lib/tokenDiscovery';
import { DEAD_ADDRESS } from '../lib/tokenSafety';
import { assertSwapValueVsMarket, clampSlippageBps } from '../lib/swapGuard';
import { signTransaction } from '../services/turnkeyService';
import { SUPPORTED_TOKENS } from '../services/tokenService';
import { priceService } from '../services/priceService';
import { ensureGasFunded } from '../lib/operatorGas';
import { isWalletInSplit } from '../lib/splitReader';
import { snapshotBuybackBalance } from '../lib/buybackBalance';

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? String(5 * 60_000), 10);
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
const MIN_GAS_RESERVE_WEI = parseUnits('0.0001', 18);
const TX_RECEIPT_TIMEOUT_MS = 5 * 60_000;
// See BuybackExecutor reaper note — re-drive rows abandoned in a transitional
// state by a crashed worker so the one-in-flight unique index can't wedge a config.
const STUCK_EXECUTION_TIMEOUT_MS = parseInt(
  process.env.BUYBACK_STUCK_TIMEOUT_MS ?? String(30 * 60_000),
  10,
);
const TRANSITIONAL_STATUSES = ['WITHDRAWING', 'SWAPPING', 'BURNING'] as const;

const BURN_FN_ABI = parseAbi(['function burn(uint256 amount)']) as Abi;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
// Guards against overlapping poll ticks (see startSharedSplitBuybackWorker).
let isPolling = false;

interface RunCtx {
  configId: string;
  executionId: string;
  walletAddress: `0x${string}`;
  subOrgId: string;
  tokenAddress: `0x${string}`;
  tokenDecimals: number;
  slippageBps: number;
  burnMode: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
  recoveryAddress: `0x${string}`;
  feeRateBps: number;
  // Splits contract this buyback draws from (null for Doppler token-creation
  // configs where fees land directly in the wallet). Used to discover which
  // revenue tokens the warehouse may hold.
  splitAddress: `0x${string}` | null;
  // Doppler tokens trade on V4 multicurve; legacy on V3. The swap step
  // branches on this. V4 fields are required when swapVenue === 'UNISWAP_V4'.
  swapVenue: 'UNISWAP_V3' | 'UNISWAP_V4';
  v4PoolHook: `0x${string}` | null;
  v4PairedToken: `0x${string}` | null;
  v4TickSpacing: number | null;
  v4FeeFlag: number | null;
}

function getTreasuryAddress(): `0x${string}` | null {
  const addr = process.env.BUYBACK_TREASURY_ADDRESS;
  if (!addr || !isAddress(addr)) return null;
  return getAddress(addr) as `0x${string}`;
}

async function buildBaseTx(
  client: ReturnType<typeof getBasePublicClient>,
  walletAddress: `0x${string}`,
  to: `0x${string}`,
  data: `0x${string}`,
  value: bigint,
): Promise<TransactionSerializableEIP1559> {
  const [nonce, fees, gas] = await Promise.all([
    client.getTransactionCount({ address: walletAddress, blockTag: 'pending' }),
    client.estimateFeesPerGas(),
    client.estimateGas({ account: walletAddress, to, data, value }),
  ]);
  return {
    chainId: base.id,
    type: 'eip1559',
    to,
    data,
    value,
    nonce,
    gas: (gas * BigInt(120)) / BigInt(100),
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };
}

async function sendTurnkeySignedTx(
  ctx: RunCtx,
  to: `0x${string}`,
  data: `0x${string}`,
  value: bigint = BigInt(0),
): Promise<`0x${string}`> {
  const client = getBasePublicClient();
  const unsignedTx = await buildBaseTx(client, ctx.walletAddress, to, data, value);
  const signed = await signTransaction({
    subOrgId: ctx.subOrgId,
    fromAddress: ctx.walletAddress,
    unsignedTx,
  });
  const txHash = await client.sendRawTransaction({ serializedTransaction: signed });
  // Log the broadcast hash BEFORE awaiting the receipt so a receipt-wait timeout
  // never loses the on-chain reference (reconciliation + avoids a blind
  // re-broadcast being untraceable on retry).
  console.log(`[SharedSplitWorker] broadcast ${txHash} to ${to} (exec ${ctx.executionId})`);
  // Heartbeat the claim lease on every on-chain action so the stuck-execution
  // reaper never re-drives a still-progressing execution (even a slow one with
  // many swap legs) a second time on the same wallet. Best-effort — a DB blip
  // must not fail a broadcast.
  try {
    await prisma.sharedSplitExecution.update({
      where: { id: ctx.executionId },
      data: { claimedAt: new Date() },
    });
  } catch {
    /* heartbeat is best-effort */
  }
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: TX_RECEIPT_TIMEOUT_MS });
  } catch {
    // The tx may still confirm later; surface the hash so it isn't lost.
    throw new Error(`receipt_timeout:${txHash}`);
  }
  if (receipt.status === 'reverted') throw new Error(`tx_reverted:${txHash}`);
  return txHash;
}

// ---------- Step 1: Withdraw from warehouse ----------

// Persists each hash incrementally so a mid-loop failure doesn't lose
// prior progress on retry — see docs §5.
async function withdrawAllFromWarehouse(ctx: RunCtx): Promise<string[]> {
  const client = getBasePublicClient();
  const hashes: string[] = [];

  const persistHash = async (hash: string): Promise<void> => {
    hashes.push(hash);
    await prisma.sharedSplitExecution.update({
      where: { id: ctx.executionId },
      data: { warehouseWithdrawHashes: { push: hash } },
    });
  };

  const ethBal = await readWarehouseBalance({ owner: ctx.walletAddress, token: SPLIT_NATIVE_TOKEN_ADDRESS, client });
  if (ethBal > BigInt(0)) {
    const data = encodeWarehouseWithdraw({ owner: ctx.walletAddress, token: SPLIT_NATIVE_TOKEN_ADDRESS });
    await persistHash(await sendTurnkeySignedTx(ctx, SPLIT_WAREHOUSE_ADDRESS, data));
  }

  // Discover every revenue token the warehouse may hold for this owner (not a
  // hardcoded list — revenue is arbitrary), then withdraw the ones with a live
  // balance. Seeded with WETH + SUPPORTED_TOKENS, so an Alchemy outage degrades
  // to the previous static behaviour rather than skipping tokens.
  const warehouseTokens = await discoverWarehouseTokens(ctx.splitAddress);
  for (const token of warehouseTokens) {
    const bal = await readWarehouseBalance({ owner: ctx.walletAddress, token: token.address as `0x${string}`, client });
    if (bal === BigInt(0)) continue;
    const data = encodeWarehouseWithdraw({ owner: ctx.walletAddress, token: token.address as `0x${string}` });
    await persistHash(await sendTurnkeySignedTx(ctx, SPLIT_WAREHOUSE_ADDRESS, data));
  }

  return hashes;
}

// Liquidity / spam guard for arbitrary discovered tokens. Seed tokens (WETH +
// SUPPORTED_TOKENS) are always processed; any other token must prove real
// liquidity via a Uniswap V3 route to WETH before we spend gas skimming a fee
// or swapping it. This works regardless of the buyback's own swap venue (a real
// revenue token has a WETH route even on a V4/Doppler config) and stops
// airdropped scam tokens from costing a signed transfer on every execution.
async function isSellableToken(
  tokenAddr: `0x${string}`,
  amountIn: bigint,
  client: ReturnType<typeof getBasePublicClient>,
): Promise<boolean> {
  if (isSeedToken(tokenAddr)) return true;
  try {
    const quote = await quoteBestPath({ tokenIn: tokenAddr, tokenOut: WETH_BASE, amountIn, client });
    return !!quote && quote.amountOut > BigInt(0);
  } catch {
    return false;
  }
}

// ---------- Step 2: Platform fee (reserve-then-charge-on-success) ----------
//
// The platform fee is a % of the revenue that flows in. It MUST NEVER be taken
// on a buyback that doesn't succeed — charging up-front (the old deductFees)
// donated a fee to the treasury on every failed/retried execution, bleeding
// funds. Instead the fee portion of each input is RESERVED (held back, not
// swapped) during the swap step, and only transferred to the treasury AFTER the
// swap has actually produced target tokens. If the swap fails, the reserve
// simply stays in the wallet and no fee is ever taken.
//
// A reserve is recorded ONLY for a swap leg that succeeded, so the fee is
// collected strictly on revenue that was actually bought back.
interface FeeReserve {
  kind: 'NATIVE' | 'ERC20';
  address: `0x${string}`; // for ERC20: the token; for NATIVE: unused (WETH placeholder)
  amount: bigint;
  symbol: string;
  decimals: number;
}

// Fee as a fraction of an input amount. Zero when fees are off (no treasury or
// feeRateBps == 0) so the whole balance is swapped and nothing is held back.
function feeReserveOf(ctx: RunCtx, amount: bigint): bigint {
  const treasury = getTreasuryAddress();
  if (!treasury || ctx.feeRateBps <= 0) return BigInt(0);
  return (amount * BigInt(ctx.feeRateBps)) / BigInt(10_000);
}

// Transfer the reserved fee amounts to the treasury. Called ONLY after a
// successful swap. Per-asset try/catch + best-effort USD accounting; a failed
// transfer just leaves that reserve in the wallet (safe — never over-charges).
async function collectReservedFees(
  ctx: RunCtx,
  reserves: FeeReserve[],
): Promise<{ hashes: string[]; feeUsd: number }> {
  const treasury = getTreasuryAddress();
  if (!treasury || reserves.length === 0) return { hashes: [], feeUsd: 0 };

  const hashes: string[] = [];
  let feeUsd = 0;
  for (const r of reserves) {
    if (r.amount <= BigInt(0)) continue;
    try {
      let hash: string;
      if (r.kind === 'NATIVE') {
        hash = await sendTurnkeySignedTx(ctx, treasury, '0x', r.amount);
      } else {
        const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [treasury, r.amount] });
        hash = await sendTurnkeySignedTx(ctx, r.address, data);
      }
      // Persist EACH hash the instant it confirms. The caller's collection guard
      // is "feeTransferHashes is empty" — so once the first transfer lands, a
      // crash or DB error before the caller's write can no longer cause a retry
      // to re-charge (the array is already non-empty). Worst case is a partial
      // collection (remaining reserve stays in the wallet) — never a double-charge.
      await prisma.sharedSplitExecution.update({
        where: { id: ctx.executionId },
        data: { feeTransferHashes: { push: hash } },
      });
      hashes.push(hash);
      try {
        const isEthLike =
          r.kind === 'NATIVE' || r.address.toLowerCase() === WETH_BASE.toLowerCase();
        const price = isEthLike
          ? await priceService.getEthPriceUsd()
          : await priceService.getTokenPriceUsd(r.address);
        feeUsd += Number(formatUnits(r.amount, r.decimals)) * price;
      } catch { /* best-effort accounting */ }
    } catch (err: unknown) {
      console.warn(`[SharedSplitWorker] ${r.symbol} fee transfer failed for ${ctx.executionId}:`, err);
    }
  }
  return { hashes, feeUsd };
}

// ---------- Step 3: Swap to target token ----------

async function approveIfNeeded(ctx: RunCtx, token: `0x${string}`, amount: bigint): Promise<void> {
  const client = getBasePublicClient();
  const allowance = (await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [ctx.walletAddress, UNISWAP_V3_SWAP_ROUTER_02],
  })) as bigint;
  if (allowance >= amount) return;

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [UNISWAP_V3_SWAP_ROUTER_02, BigInt(2) ** BigInt(256) - BigInt(1)],
  });
  await sendTurnkeySignedTx(ctx, token, data);
}

// V4-side approval dance: ERC20 -> Permit2 -> UniversalRouter.
async function ensurePermit2ApprovedV4(
  ctx: RunCtx,
  token: `0x${string}`,
  amount: bigint,
): Promise<void> {
  const client = getBasePublicClient();

  // (1) ERC20.approve(PERMIT2, max) — set once per token. Permit2 then mediates
  // all router approvals, so each Doppler token only ever requires one ERC-20
  // approval from this wallet.
  const erc20Allowance = (await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [ctx.walletAddress, V4.PERMIT2_BASE],
  })) as bigint;
  if (erc20Allowance < amount) {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [V4.PERMIT2_BASE, BigInt(2) ** BigInt(256) - BigInt(1)],
    });
    await sendTurnkeySignedTx(ctx, token, data);
  }

  // (2) Permit2.approve(token, UniversalRouter, max, expiration) — refresh if
  // amount or expiration are stale. Permit2 expirations are unix seconds in a
  // uint48; we always renew if the current expiry is less than an hour out.
  const permit2 = await V4.readPermit2Allowance({ owner: ctx.walletAddress, token, client });
  const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
  if (permit2.amount < amount || permit2.expiration < oneHourFromNow) {
    const tx = V4.encodePermit2Approve({ token });
    await sendTurnkeySignedTx(ctx, tx.to, tx.data, tx.value);
  }
}

// V4 swap path — for Doppler tokens that trade on Uniswap V4 multicurve via
// RehypeDopplerHook. Constructs the UniversalRouter.execute() V4_SWAP call
// using the pool key derived from config-stored hook + paired token.
async function swapV4(
  ctx: RunCtx,
  inputCurrency: `0x${string}`,
  amountIn: bigint,
): Promise<string | null> {
  if (!ctx.v4PoolHook || !ctx.v4PairedToken || ctx.v4TickSpacing == null || ctx.v4FeeFlag == null) {
    throw new Error(
      `V4 swap requested but config is missing pool details (hook/paired/tickSpacing/feeFlag). configId=${ctx.configId}`,
    );
  }
  const client = getBasePublicClient();

  const plan = V4.buildV4SwapPlan({
    tokenAddress: ctx.tokenAddress,
    pairedToken: ctx.v4PairedToken,
    hook: ctx.v4PoolHook,
    fee: ctx.v4FeeFlag,
    tickSpacing: ctx.v4TickSpacing,
    inputCurrency,
  });

  // Estimate output. If the pool isn't readable (sqrtPriceX96 = 0) we abort —
  // sending a zero minOut would be open season for sandwich bots.
  const estimated = await V4.estimateV4Output({ plan, amountIn, client });
  if (estimated === BigInt(0)) {
    throw new Error(
      `V4 pool ${plan.poolId} not readable or has no liquidity — aborting swap to prevent front-running`,
    );
  }
  const amountOutMinimum = applySlippage(estimated, ctx.slippageBps);

  // Independent market check — the pool's own spot (via estimateV4Output) cannot
  // be trusted as the slippage reference if the pool key is wrong/thin. Abort if
  // the expected output is worth far less than the WETH going in.
  await assertSwapValueVsMarket({
    client,
    inputToken: inputCurrency,
    amountIn,
    outputToken: ctx.tokenAddress,
    expectedOut: estimated,
  });

  await ensurePermit2ApprovedV4(ctx, inputCurrency, amountIn);

  const tx = V4.encodeV4SwapCall({ plan, amountIn, amountOutMinimum });
  return sendTurnkeySignedTx(ctx, tx.to, tx.data, tx.value);
}

interface SwapNote {
  symbol: string;
  status: 'ok' | 'no_quote' | 'failed';
  hash?: string;
  error?: string;
}

// Read-modify-write on assetsIn.swapResults — see docs §6.
async function recordSwapNote(executionId: string, note: SwapNote): Promise<void> {
  const exec = await prisma.sharedSplitExecution.findUnique({
    where: { id: executionId },
    select: { assetsIn: true },
  });
  const current = (exec?.assetsIn as Record<string, unknown> | null) ?? {};
  const list = (Array.isArray(current.swapResults) ? current.swapResults : []) as SwapNote[];
  list.push(note);
  await prisma.sharedSplitExecution.update({
    where: { id: executionId },
    data: { assetsIn: { ...current, swapResults: list } as never },
  });
}

// Single Uniswap V3 exact-in swap (tokenIn -> tokenOut), using the best
// quoted path. Returns the tx hash, or null if there's no route. Used both to
// swap directly into the user token (V3 configs) and to convert arbitrary
// tokens into WETH before a V4 swap (V4/Doppler configs).
async function swapV3ToToken(
  ctx: RunCtx,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  client: ReturnType<typeof getBasePublicClient>,
): Promise<string | null> {
  const quote = await quoteBestPath({ tokenIn, tokenOut, amountIn, client });
  if (!quote || quote.amountOut === BigInt(0)) return null;
  // Guard EVERY swap against the market feed — the buyback leg AND intermediate
  // token->WETH hops. Any leg could route through a thin/mispriced pool.
  await assertSwapValueVsMarket({
    client,
    inputToken: tokenIn,
    amountIn,
    outputToken: tokenOut,
    expectedOut: quote.amountOut,
  });
  await approveIfNeeded(ctx, tokenIn, amountIn);
  const data = encodeExactInput({
    path: quote.path,
    recipient: ctx.walletAddress,
    amountIn,
    amountOutMinimum: applySlippage(quote.amountOut, ctx.slippageBps),
  });
  return sendTurnkeySignedTx(ctx, UNISWAP_V3_SWAP_ROUTER_02, data);
}

async function swapAllToUserToken(
  ctx: RunCtx,
): Promise<{ swapHash: string | null; tokenBalanceAfter: bigint; feeReserves: FeeReserve[] }> {
  const client = getBasePublicClient();
  let lastSwapHash: string | null = null;
  // Fee held back from each SUCCESSFUL swap leg — transferred to treasury only
  // after the swap produces tokens (see collectReservedFees).
  const feeReserves: FeeReserve[] = [];

  const ethBal = await client.getBalance({ address: ctx.walletAddress });
  const ethSwappable = ethBal > MIN_GAS_RESERVE_WEI ? ethBal - MIN_GAS_RESERVE_WEI : BigInt(0);

  const isV4 = ctx.swapVenue === 'UNISWAP_V4';

  if (ethSwappable > BigInt(0)) {
    try {
      if (isV4) {
        // Doppler tokens: V4 expects WETH input (not native ETH). Native ETH
        // that lands in the wallet from gas drips etc. stays as gas reserve.
        // The Doppler-fees-as-WETH case is handled by the FEE_SWAP_TOKENS loop
        // below — WETH is its first entry and equals v4PairedToken, so it swaps
        // directly via swapV4. This branch only fires for genuine native ETH,
        // which we deliberately leave as gas reserve on V4.
        await recordSwapNote(ctx.executionId, {
          symbol: 'ETH',
          status: 'no_quote',
          error: 'native ETH not routed for V4 venue (wrap to WETH first)',
        });
      } else {
        // Reserve the fee portion of the ETH before swapping; only swap the rest.
        const ethFee = feeReserveOf(ctx, ethSwappable);
        const ethToSwap = ethSwappable - ethFee;
        const quote = await quoteBestPath({ tokenIn: WETH_BASE, tokenOut: ctx.tokenAddress, amountIn: ethToSwap, client });
        if (ethToSwap <= BigInt(0) || !quote || quote.amountOut === BigInt(0)) {
          await recordSwapNote(ctx.executionId, { symbol: 'ETH', status: 'no_quote' });
        } else {
          await assertSwapValueVsMarket({
            client,
            inputToken: WETH_BASE,
            amountIn: ethToSwap,
            outputToken: ctx.tokenAddress,
            expectedOut: quote.amountOut,
          });
          const data = encodeExactInput({
            path: quote.path,
            recipient: ctx.walletAddress,
            amountIn: ethToSwap,
            amountOutMinimum: applySlippage(quote.amountOut, ctx.slippageBps),
          });
          lastSwapHash = await sendTurnkeySignedTx(ctx, UNISWAP_V3_SWAP_ROUTER_02, data, ethToSwap);
          await recordSwapNote(ctx.executionId, { symbol: 'ETH', status: 'ok', hash: lastSwapHash });
          // Swap succeeded — the fee on this ETH revenue is now collectible.
          if (ethFee > BigInt(0)) {
            feeReserves.push({ kind: 'NATIVE', address: WETH_BASE, amount: ethFee, symbol: 'ETH', decimals: 18 });
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SharedSplitWorker] ETH swap failed for ${ctx.executionId}:`, err);
      await recordSwapNote(ctx.executionId, { symbol: 'ETH', status: 'failed', error: msg.slice(0, 300) });
    }
  }

  // Swap every ERC-20 in the wallet (WETH, USDC, arbitrary revenue tokens) into
  // the user token. Tokens with no Uniswap route resolve to no_quote and are
  // skipped — that also filters out spam/airdrop tokens that can't be sold.
  const walletTokens = await discoverWalletErc20s(ctx.walletAddress);
  for (const token of walletTokens) {
    const tokenAddr = token.address as `0x${string}`;
    if (tokenAddr.toLowerCase() === ctx.tokenAddress.toLowerCase()) continue;

    const bal = (await client.readContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.walletAddress],
    })) as bigint;
    if (bal === BigInt(0)) continue;
    // Skip illiquid/spam tokens before attempting any swap or approval.
    if (!(await isSellableToken(tokenAddr, bal, client))) {
      await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'no_quote' });
      continue;
    }

    try {
      if (isV4) {
        // V4 routes only the paired token (WETH) directly into the user token.
        // WETH itself is deferred to a single consolidated V4 swap AFTER the
        // loop, so any arbitrary tokens we convert to WETH below are included.
        if (!ctx.v4PairedToken) {
          await recordSwapNote(ctx.executionId, {
            symbol: token.symbol,
            status: 'no_quote',
            error: 'v4PairedToken unset',
          });
          continue;
        }
        if (tokenAddr.toLowerCase() === ctx.v4PairedToken.toLowerCase()) continue;
        // Arbitrary (non-WETH) token: convert to WETH on V3 first. The resulting
        // WETH is swept into the user token by the post-loop V4 consolidation.
        const hash = await swapV3ToToken(ctx, tokenAddr, ctx.v4PairedToken, bal, client);
        if (!hash) {
          await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'no_quote' });
          continue;
        }
        await recordSwapNote(ctx.executionId, {
          symbol: token.symbol,
          status: 'ok',
          hash,
          error: 'converted to WETH for V4 swap',
        });
      } else {
        // V3 direct: reserve the fee portion, swap only the remainder.
        const fee = feeReserveOf(ctx, bal);
        const toSwap = bal - fee;
        if (toSwap <= BigInt(0)) {
          await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'no_quote' });
          continue;
        }
        const hash = await swapV3ToToken(ctx, tokenAddr, ctx.tokenAddress, toSwap, client);
        if (!hash) {
          await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'no_quote' });
          continue;
        }
        lastSwapHash = hash;
        await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'ok', hash });
        // Swap succeeded — fee on this token's revenue is collectible.
        if (fee > BigInt(0)) {
          feeReserves.push({ kind: 'ERC20', address: tokenAddr, amount: fee, symbol: token.symbol, decimals: token.decimals });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SharedSplitWorker] ${token.symbol} swap failed for ${ctx.executionId}:`, err);
      await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'failed', error: msg.slice(0, 300) });
    }
  }

  // V4 consolidation: by now every sellable token has been converted to WETH
  // (the paired token). Swap the whole WETH balance into the user token in one
  // V4 swap. This is what lets V4/Doppler configs absorb arbitrary revenue
  // tokens, not just WETH.
  if (isV4 && ctx.v4PairedToken) {
    try {
      const wethBal = (await client.readContract({
        address: ctx.v4PairedToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ctx.walletAddress],
      })) as bigint;
      // All V4 revenue (direct WETH + arbitrary tokens converted above) is now
      // WETH, so the fee is reserved here ONCE on the whole WETH balance —
      // arbitrary tokens are converted at full balance to avoid double-charging.
      const wethFee = feeReserveOf(ctx, wethBal);
      const wethToSwap = wethBal - wethFee;
      if (wethToSwap > BigInt(0)) {
        lastSwapHash = await swapV4(ctx, ctx.v4PairedToken, wethToSwap);
        await recordSwapNote(ctx.executionId, { symbol: 'WETH', status: 'ok', hash: lastSwapHash ?? undefined });
        // Swap succeeded — the reserved WETH fee is collectible.
        if (wethFee > BigInt(0)) {
          feeReserves.push({ kind: 'ERC20', address: ctx.v4PairedToken, amount: wethFee, symbol: 'WETH', decimals: 18 });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SharedSplitWorker] V4 WETH consolidation swap failed for ${ctx.executionId}:`, err);
      await recordSwapNote(ctx.executionId, { symbol: 'WETH', status: 'failed', error: msg.slice(0, 300) });
    }
  }

  const readTargetBalance = async (): Promise<bigint> =>
    (await client.readContract({
      address: ctx.tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.walletAddress],
    })) as bigint;

  // Read the acquired balance. If a swap actually executed but this reads 0, the
  // RPC node is lagging the just-mined block — a false 0 here would skip the burn
  // and wrongly mark the buyback failed (and pause the config). Retry briefly.
  let tokenBalanceAfter = await readTargetBalance();
  for (let i = 0; tokenBalanceAfter === BigInt(0) && lastSwapHash && i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    tokenBalanceAfter = await readTargetBalance();
  }

  return { swapHash: lastSwapHash, tokenBalanceAfter, feeReserves };
}

// ---------- Step 4: Burn ----------

async function burnAcquiredTokens(ctx: RunCtx): Promise<{ burnHash: string; amount: bigint }> {
  const client = getBasePublicClient();
  const balance = (await client.readContract({
    address: ctx.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.walletAddress],
  })) as bigint;

  if (balance === BigInt(0)) throw new Error('no_balance_to_burn');

  if (ctx.burnMode === 'TOKEN_BURN_FN') {
    try {
      const data = encodeFunctionData({ abi: BURN_FN_ABI, functionName: 'burn', args: [balance] });
      const hash = await sendTurnkeySignedTx(ctx, ctx.tokenAddress, data);
      return { burnHash: hash, amount: balance };
    } catch {
      // fall through to dead-address
    }
  }

  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEAD_ADDRESS, balance] });
  const hash = await sendTurnkeySignedTx(ctx, ctx.tokenAddress, data);
  return { burnHash: hash, amount: balance };
}

// ---------- Activation check ----------

async function checkPendingActivations(): Promise<void> {
  // Skip configs without a split yet (Token card flow: user hasn't completed
  // the deploy step). They'll surface here once `/set-split` lands.
  const pending = await prisma.sharedSplitBuybackConfig.findMany({
    where: {
      status: 'PENDING_SPLIT_UPDATE',
      isActive: true,
      walletAddress: { not: null },
      splitAddress: { not: null },
    },
    take: 20,
  });

  for (const config of pending) {
    try {
      const inSplit = await isWalletInSplit(
        config.splitAddress! as `0x${string}`,
        config.walletAddress! as `0x${string}`,
      );
      if (inSplit === true) {
        await prisma.sharedSplitBuybackConfig.update({
          where: { id: config.id },
          data: { status: 'ACTIVE' },
        });
        console.log(`[SharedSplitWorker] Activated config ${config.id} — wallet found in split`);
      } else if (inSplit === null) {
        // null = unknown; retry next poll. See docs §4.
        console.log(`[SharedSplitWorker] Activation check for ${config.id}: membership unknown, will retry`);
      }
    } catch (err: unknown) {
      console.warn(`[SharedSplitWorker] Activation check failed for ${config.id}:`, err);
    }
  }
}

// ---------- Auto-retry PROVISIONING configs (Doppler token-creation flow) ----------
//
// Phase 2 of the per-token Doppler buyback flow (attach policy + flip ACTIVE)
// can fail — for instance a transient Turnkey error or a token-safety probe
// hiccup. tokens.fun makes that call non-blocking (the on-chain token already
// exists; we can't roll back), so a single Phase 2 failure used to mean the
// config was stuck in PROVISIONING forever.
//
// This pass picks up any config that:
//   - is still in PROVISIONING
//   - has a pendingTokenAddress (caller attempted Phase 2 at least once)
//   - has a Turnkey wallet (Phase 1 completed)
//   - hasn't been retried in the last 60s (backoff)
// and re-runs activation. The runActivation logic is owned by the route
// module — import it here so backend logic stays in one place.

import { attachBuybackPolicy } from '../services/turnkeyService';
import {
  assertHasCode,
  canReceiveDead,
  detectBurnFunction,
  getTokenMeta,
  TokenSafetyError,
} from '../lib/tokenSafety';
import { SPLIT_NATIVE_TOKEN_ADDRESS as SPLIT_NATIVE } from '../lib/splitsWarehouse';

const RETRY_BACKOFF_MS = 60_000;
const RETRY_MAX_ATTEMPTS = 10; // 10 retries with backoff before we give up

async function retryProvisioningActivations(): Promise<void> {
  const cutoff = new Date(Date.now() - RETRY_BACKOFF_MS);
  const stuck = await prisma.sharedSplitBuybackConfig.findMany({
    where: {
      status: 'PROVISIONING',
      isActive: true,
      walletAddress: { not: null },
      turnkeySubOrgId: { not: null },
      parentAdminUserId: { not: null },
      coSignerUserId: { not: null },
      pendingTokenAddress: { not: null },
      activationAttempts: { lt: RETRY_MAX_ATTEMPTS },
      OR: [
        { lastActivationAttemptAt: null },
        { lastActivationAttemptAt: { lt: cutoff } },
      ],
    },
    take: 10,
  });

  for (const config of stuck) {
    const tokenAddress = config.pendingTokenAddress as `0x${string}`;
    console.log(`[SharedSplitWorker] Auto-retry activation for ${config.id} (attempt ${config.activationAttempts + 1}/${RETRY_MAX_ATTEMPTS}, token ${tokenAddress})`);

    try {
      // Mark the attempt — increments counter and updates lastActivationAttemptAt
      // so concurrent workers don't double-attempt.
      await prisma.sharedSplitBuybackConfig.update({
        where: { id: config.id },
        data: {
          lastActivationAttemptAt: new Date(),
          activationAttempts: { increment: 1 },
        },
      });

      await assertHasCode(tokenAddress);
      const meta = await getTokenMeta(tokenAddress);

      const canDead = await canReceiveDead(tokenAddress);
      let burnMode: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
      if (canDead) {
        burnMode = 'DEAD_ADDRESS';
      } else {
        const hasBurn = await detectBurnFunction(tokenAddress);
        if (!hasBurn) {
          throw new TokenSafetyError(
            'no_burn_function',
            `Token ${tokenAddress} cannot be auto-burned (no DEAD path, no burn() function)`,
          );
        }
        burnMode = 'TOKEN_BURN_FN';
      }

      const allowedSwapInputTokens = [
        SPLIT_NATIVE,
        ...SUPPORTED_TOKENS.map((t) => t.address as `0x${string}`),
      ];
      const { policyId } = await attachBuybackPolicy({
        subOrgId: config.turnkeySubOrgId!,
        parentAdminUserId: config.parentAdminUserId!,
        coSignerUserId: config.coSignerUserId!,
        policyParams: {
          userTokenAddress: tokenAddress,
          allowedSwapInputTokens,
          recoveryAddress: config.recoveryAddress as `0x${string}`,
          swapVenue: (config.swapVenue as 'UNISWAP_V3' | 'UNISWAP_V4') ?? 'UNISWAP_V3',
        },
      });

      await prisma.sharedSplitBuybackConfig.update({
        where: { id: config.id },
        data: {
          tokenAddress,
          tokenSymbol: meta.symbol,
          tokenDecimals: meta.decimals,
          burnMode,
          policyId,
          status: 'ACTIVE',
          lastActivationError: null,
        },
      });
      console.log(`[SharedSplitWorker] Auto-retry activation SUCCEEDED for ${config.id}`);
    } catch (err: unknown) {
      const reason =
        err instanceof TokenSafetyError
          ? `[${err.reason}] ${err.message}`
          : err instanceof Error
            ? err.message
            : 'unknown_retry_error';
      await prisma.sharedSplitBuybackConfig.update({
        where: { id: config.id },
        data: { lastActivationError: reason.slice(0, 1000) },
      });
      console.warn(`[SharedSplitWorker] Auto-retry activation FAILED for ${config.id}:`, reason);
    }
  }
}

// ---------- Balance scan + queue ----------

async function scanActiveConfigs(): Promise<void> {
  const active = await prisma.sharedSplitBuybackConfig.findMany({
    where: { status: 'ACTIVE', isActive: true, walletAddress: { not: null } },
  });

  for (const config of active) {
    try {
      const snapshot = await snapshotBuybackBalance(
        config.walletAddress! as `0x${string}`,
        config.tokenAddress,
      );

      await prisma.sharedSplitBuybackConfig.update({
        where: { id: config.id },
        data: { lastCheckedAt: new Date() },
      });

      if (snapshot.totalUsd < config.thresholdUsd) continue;

      const inFlight = await prisma.sharedSplitExecution.findFirst({
        where: { configId: config.id, status: { in: ['QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING'] } },
      });
      if (inFlight) continue;

      await prisma.sharedSplitExecution.create({
        data: {
          configId: config.id,
          triggerBalanceUsd: snapshot.totalUsd,
          assetsIn: snapshot.assets as any,
        },
      });
      console.log(`[SharedSplitWorker] Queued execution for config ${config.id} at $${snapshot.totalUsd.toFixed(2)}`);
    } catch (err: unknown) {
      console.warn(`[SharedSplitWorker] Scan failed for config ${config.id}:`, err);
    }
  }
}

// ---------- Recovery (sweep funds back to the config's recoveryAddress) ----------

// Drains the Splits Warehouse (if any) and sweeps every wallet balance (ERC-20s
// + the target token + native ETH, less a gas reserve) to the config's
// recoveryAddress. Every transfer is permitted by the Turnkey policy (recovery
// address is whitelisted at provision time). Per-asset best-effort so one stuck
// token can't block the rest. Used to rescue funds from a BROKEN/PAUSED config.
async function sweepToRecoveryAddress(ctx: RunCtx): Promise<string[]> {
  const client = getBasePublicClient();
  const hashes: string[] = [];

  if (ctx.splitAddress) {
    try {
      hashes.push(...(await withdrawAllFromWarehouse(ctx)));
    } catch (err: unknown) {
      console.warn(`[SharedSplitWorker] recovery warehouse drain failed for ${ctx.executionId}:`, err);
    }
  }

  const walletTokens = await discoverWalletErc20s(ctx.walletAddress);
  const toSweep: Array<{ address: `0x${string}`; symbol: string }> = [
    ...walletTokens.map((t) => ({ address: t.address as `0x${string}`, symbol: t.symbol })),
    { address: ctx.tokenAddress, symbol: 'TARGET' },
  ];
  const seen = new Set<string>();
  for (const t of toSweep) {
    const key = t.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const bal = (await client.readContract({
        address: t.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ctx.walletAddress],
      })) as bigint;
      if (bal === BigInt(0)) continue;
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [ctx.recoveryAddress, bal] });
      hashes.push(await sendTurnkeySignedTx(ctx, t.address, data));
    } catch (err: unknown) {
      console.warn(`[SharedSplitWorker] recovery sweep ${t.symbol} failed for ${ctx.executionId}:`, err);
    }
  }

  try {
    const ethBal = await client.getBalance({ address: ctx.walletAddress });
    if (ethBal > MIN_GAS_RESERVE_WEI) {
      hashes.push(await sendTurnkeySignedTx(ctx, ctx.recoveryAddress, '0x', ethBal - MIN_GAS_RESERVE_WEI));
    }
  } catch (err: unknown) {
    console.warn(`[SharedSplitWorker] recovery ETH sweep failed for ${ctx.executionId}:`, err);
  }

  return hashes;
}

// ---------- Execute queued executions ----------

// Pause a config once it's clearly broken so it can't keep re-queuing and
// re-skimming the fee every poll. A swap that repeatedly produces no tokens
// (wrong pool / venue / no route) means the buyback can't succeed — stop trying.
async function maybeMarkBrokenAfterFailures(configId: string): Promise<void> {
  try {
    const lastExecs = await prisma.sharedSplitExecution.findMany({
      where: { configId },
      orderBy: { startedAt: 'desc' },
      take: 3,
      select: { status: true },
    });
    if (lastExecs.length >= 3 && lastExecs.every((e) => e.status === 'FAILED')) {
      await prisma.sharedSplitBuybackConfig.update({
        where: { id: configId },
        data: { status: 'BROKEN' },
      });
      console.warn(
        `[SharedSplitWorker] Config ${configId} marked BROKEN after 3 consecutive failed executions — pausing to stop fee bleed`,
      );
    }
  } catch {
    /* non-fatal */
  }
}

async function processExecutions(): Promise<void> {
  const now = new Date();
  const due = await prisma.sharedSplitExecution.findMany({
    where: {
      status: { in: ['QUEUED', 'RETRYING'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    include: { config: true },
    take: 5,
  });

  for (const exec of due) {
    const config = exec.config;
    // A recovery sweep must run even on a BROKEN/PAUSED config — that's exactly
    // when funds get stranded — so it deliberately bypasses the active check.
    const isRecovery =
      !!exec.assetsIn &&
      typeof exec.assetsIn === 'object' &&
      !Array.isArray(exec.assetsIn) &&
      (exec.assetsIn as { intent?: string }).intent === 'recover';

    if (!isRecovery && (!config.isActive || config.status !== 'ACTIVE')) {
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { status: 'FAILED', lastError: 'config_disabled', completedAt: new Date() },
      });
      continue;
    }

    if (!config.walletAddress || !config.turnkeySubOrgId) {
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { status: 'FAILED', lastError: 'wallet_not_provisioned', completedAt: new Date() },
      });
      continue;
    }

    const claim = await prisma.sharedSplitExecution.updateMany({
      where: { id: exec.id, attempts: exec.attempts },
      data: { attempts: exec.attempts + 1, status: 'WITHDRAWING', nextAttemptAt: null, claimedAt: new Date() },
    });
    if (claim.count === 0) continue;

    const ctx: RunCtx = {
      configId: config.id,
      executionId: exec.id,
      walletAddress: config.walletAddress as `0x${string}`,
      subOrgId: config.turnkeySubOrgId,
      tokenAddress: config.tokenAddress as `0x${string}`,
      tokenDecimals: config.tokenDecimals,
      slippageBps: clampSlippageBps(config.slippageBps),
      burnMode: config.burnMode as 'DEAD_ADDRESS' | 'TOKEN_BURN_FN',
      recoveryAddress: config.recoveryAddress as `0x${string}`,
      feeRateBps: config.feeRateBps,
      splitAddress: (config.splitAddress as `0x${string}` | null) ?? null,
      swapVenue: (config.swapVenue as 'UNISWAP_V3' | 'UNISWAP_V4') ?? 'UNISWAP_V3',
      v4PoolHook: config.v4PoolHook as `0x${string}` | null,
      v4PairedToken: config.v4PairedToken as `0x${string}` | null,
      v4TickSpacing: config.v4TickSpacing,
      v4FeeFlag: config.v4FeeFlag,
    };

    const attempt = exec.attempts + 1;
    const isFinal = attempt >= MAX_ATTEMPTS;

    try {
      try {
        await ensureGasFunded(ctx.walletAddress);
      } catch (err: unknown) {
        throw new Error(`gas_drip_failed: ${err instanceof Error ? err.message : err}`);
      }

      // Recovery sweep: drain the warehouse + every wallet balance to the
      // config's recoveryAddress, then complete. No swap/burn/fee. Runs even for
      // BROKEN/PAUSED configs so stranded funds always have an exit.
      if (isRecovery) {
        const sweepHashes = await sweepToRecoveryAddress(ctx);
        await prisma.sharedSplitExecution.update({
          where: { id: exec.id },
          data: {
            status: 'COMPLETED',
            warehouseWithdrawHashes: sweepHashes,
            completedAt: new Date(),
          },
        });
        console.log(
          `[SharedSplitWorker] Recovery sweep completed for ${exec.id}: ${sweepHashes.length} transfers to ${ctx.recoveryAddress}`,
        );
        continue;
      }

      // Hashes are persisted inside the helper; don't overwrite on retry.
      // Skip warehouse withdrawal for configs without a Splits contract — in
      // the Doppler token-creation flow fees land directly in the Turnkey
      // wallet via StreamableFeesLockerV2, so there's nothing in the warehouse.
      if (config.splitAddress) {
        await withdrawAllFromWarehouse(ctx);
      }
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { status: 'SWAPPING' },
      });

      // Swap holds back the fee portion of each input (reserve-then-charge). The
      // fee is transferred to the treasury ONLY below, after we confirm the swap
      // produced tokens — a failed buyback reserves nothing and pays no fee.
      const { swapHash, tokenBalanceAfter, feeReserves } = await swapAllToUserToken(ctx);
      if (tokenBalanceAfter === BigInt(0)) {
        if (!swapHash) {
          // No swap actually executed this attempt: every leg threw (fail-closed
          // market guard on a stale price, a transient RPC/quote blip, or no
          // route this poll). RETRYABLE — do NOT immediately mark the config
          // BROKEN on one bad poll. The retry/backoff and the 3-consecutive-
          // failure auto-pause (maybeMarkBrokenAfterFailures) handle persistence.
          throw new Error('no_swap_executed_this_attempt');
        }
        // A swap executed on-chain but yielded zero tokens (even after the RPC
        // re-read loop) — a genuine wrong pool / venue / no-route signal. Pause
        // the config so the scanner can't re-queue the same broken swap.
        await prisma.sharedSplitExecution.update({
          where: { id: exec.id },
          data: { status: 'FAILED', swapHash, lastError: 'swap_produced_no_tokens', completedAt: new Date() },
        });
        await prisma.sharedSplitBuybackConfig.update({
          where: { id: config.id },
          data: { status: 'BROKEN' },
        });
        console.warn(
          `[SharedSplitWorker] Config ${config.id} paused (BROKEN): swap executed but produced no tokens`,
        );
        continue;
      }

      // Collect the reserved fee now that tokens were bought. Idempotent: a retry
      // that already collected (feeTransferHashes set) never re-charges.
      let feeUsd = exec.feeCollectedUsd ?? 0;
      if (!exec.feeTransferHashes || exec.feeTransferHashes.length === 0) {
        // Hashes are persisted incrementally inside collectReservedFees; here we
        // only record the USD total. The empty-check above + incremental persist
        // make re-charging on retry impossible.
        const { feeUsd: collected } = await collectReservedFees(ctx, feeReserves);
        feeUsd = collected;
        await prisma.sharedSplitExecution.update({
          where: { id: exec.id },
          data: { feeCollectedUsd: feeUsd },
        });
      }

      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { swapHash: swapHash ?? undefined, status: 'BURNING' },
      });

      const burn = await burnAcquiredTokens(ctx);

      // USD value of the tokens ACTUALLY bought — price the received amount at
      // market, not the pre-swap trigger estimate. triggerBalanceUsd reflects
      // everything in the wallet before the swap (WETH + gas ETH + dust) and is
      // wrong for "value bought"; copying it hid slippage entirely. Null when the
      // price feed is unavailable — never record a fabricated number.
      let tokensOutUsd: number | null = null;
      try {
        const price = await priceService.getTokenPriceUsd(ctx.tokenAddress);
        tokensOutUsd = Number(formatUnits(burn.amount, ctx.tokenDecimals)) * price;
      } catch (err) {
        console.warn(
          `[SharedSplitWorker] tokensOutUsd price unavailable for ${ctx.executionId}:`,
          err,
        );
      }

      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: {
          status: 'COMPLETED',
          burnHash: burn.burnHash,
          tokensOutAmount: burn.amount.toString(),
          tokensOutUsd,
          completedAt: new Date(),
        },
      });
      await prisma.sharedSplitBuybackConfig.update({
        where: { id: config.id },
        data: { lastTriggeredAt: new Date() },
      });

      console.log(
        `[SharedSplitWorker] Completed ${exec.id}: burned ${formatUnits(burn.amount, ctx.tokenDecimals)} ${config.tokenSymbol}, fee $${feeUsd.toFixed(2)}`,
      );
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown_error';
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: {
          status: isFinal ? 'FAILED' : 'RETRYING',
          lastError: reason.slice(0, 500),
          nextAttemptAt: isFinal ? null : new Date(Date.now() + delay),
          completedAt: isFinal ? new Date() : null,
        },
      });
      console.error(`[SharedSplitWorker] Execution ${exec.id} attempt ${attempt} failed:`, reason);

      // Pause the config if it's now repeatedly failing (stops fee bleed).
      if (isFinal) {
        await maybeMarkBrokenAfterFailures(config.id);
      }
    }
  }
}

// Re-drive executions abandoned in a transitional state by a dead worker (see
// the per-agent reaper note). Safe to re-drive: every step re-reads live
// balances and the fee is idempotent, so no double-spend.
async function reapStuckExecutions(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_EXECUTION_TIMEOUT_MS);
  const stuck = await prisma.sharedSplitExecution.findMany({
    where: {
      status: { in: [...TRANSITIONAL_STATUSES] },
      OR: [{ claimedAt: { lt: cutoff } }, { claimedAt: null, startedAt: { lt: cutoff } }],
    },
    take: 20,
  });
  for (const exec of stuck) {
    const isFinal = exec.attempts >= MAX_ATTEMPTS;
    await prisma.sharedSplitExecution.update({
      where: { id: exec.id },
      data: {
        status: isFinal ? 'FAILED' : 'RETRYING',
        lastError: `reaped_stuck_${exec.status.toLowerCase()}`,
        nextAttemptAt: isFinal ? null : new Date(),
        completedAt: isFinal ? new Date() : null,
      },
    });
    console.warn(
      `[SharedSplitWorker] Reaped stuck execution ${exec.id} (was ${exec.status}, claimedAt=${exec.claimedAt?.toISOString() ?? 'null'}) -> ${isFinal ? 'FAILED' : 'RETRYING'}`,
    );
    if (isFinal) await maybeMarkBrokenAfterFailures(exec.configId);
  }
}

// ---------- Main poll loop ----------

async function poll(): Promise<void> {
  await reapStuckExecutions();
  await checkPendingActivations();
  await retryProvisioningActivations();
  await scanActiveConfigs();
  await processExecutions();
}

export function startSharedSplitBuybackWorker(): void {
  if (intervalHandle) return;
  console.log(`[SharedSplitWorker] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`);
  // Re-entrancy guard: skip a tick if the previous one is still running (a slow
  // execution holding the loop past POLL_INTERVAL_MS). Without it, setInterval
  // fires overlapping polls that drive the same execution concurrently.
  const guardedPoll = async (): Promise<void> => {
    if (isPolling) return;
    isPolling = true;
    try {
      await poll();
    } finally {
      isPolling = false;
    }
  };
  guardedPoll().catch((e) => console.error('[SharedSplitWorker] Initial run error:', e));
  intervalHandle = setInterval(() => {
    guardedPoll().catch((e) => console.error('[SharedSplitWorker] Poll error:', e));
  }, POLL_INTERVAL_MS);
}

export function stopSharedSplitBuybackWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
