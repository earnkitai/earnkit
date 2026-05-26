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
import { DEAD_ADDRESS } from '../lib/tokenSafety';
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

const BURN_FN_ABI = parseAbi(['function burn(uint256 amount)']) as Abi;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

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
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: TX_RECEIPT_TIMEOUT_MS });
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

  for (const token of SUPPORTED_TOKENS) {
    const bal = await readWarehouseBalance({ owner: ctx.walletAddress, token: token.address as `0x${string}`, client });
    if (bal === BigInt(0)) continue;
    const data = encodeWarehouseWithdraw({ owner: ctx.walletAddress, token: token.address as `0x${string}` });
    await persistHash(await sendTurnkeySignedTx(ctx, SPLIT_WAREHOUSE_ADDRESS, data));
  }

  return hashes;
}

// ---------- Step 2: Deduct platform fee ----------

async function deductFees(ctx: RunCtx): Promise<{ hashes: string[]; feeUsd: number }> {
  const treasury = getTreasuryAddress();
  if (!treasury || ctx.feeRateBps === 0) return { hashes: [], feeUsd: 0 };

  const client = getBasePublicClient();
  const hashes: string[] = [];
  let feeUsd = 0;

  // Native ETH fee
  const ethBal = await client.getBalance({ address: ctx.walletAddress });
  const ethSwappable = ethBal > MIN_GAS_RESERVE_WEI ? ethBal - MIN_GAS_RESERVE_WEI : BigInt(0);
  if (ethSwappable > BigInt(0)) {
    const feeWei = (ethSwappable * BigInt(ctx.feeRateBps)) / BigInt(10_000);
    if (feeWei > BigInt(0)) {
      try {
        const hash = await sendTurnkeySignedTx(ctx, treasury, '0x', feeWei);
        hashes.push(hash);
        try {
          const ethPrice = await priceService.getEthPriceUsd();
          feeUsd += Number(formatUnits(feeWei, 18)) * ethPrice;
        } catch { /* best-effort */ }
      } catch (err: unknown) {
        console.warn(`[SharedSplitWorker] ETH fee transfer failed for ${ctx.executionId}:`, err);
      }
    }
  }

  // ERC-20 fees
  for (const token of SUPPORTED_TOKENS) {
    const tokenAddr = token.address as `0x${string}`;
    const isUserToken = tokenAddr.toLowerCase() === ctx.tokenAddress.toLowerCase();
    if (isUserToken) continue; // don't take fee from the token we're trying to buy back

    const bal = (await client.readContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.walletAddress],
    })) as bigint;

    if (bal === BigInt(0)) continue;
    const feeAmt = (bal * BigInt(ctx.feeRateBps)) / BigInt(10_000);
    if (feeAmt === BigInt(0)) continue;

    try {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [treasury, feeAmt] });
      const hash = await sendTurnkeySignedTx(ctx, tokenAddr, data);
      hashes.push(hash);
      try {
        const tokenPrice = await priceService.getTokenPriceUsd(tokenAddr);
        feeUsd += Number(formatUnits(feeAmt, token.decimals)) * tokenPrice;
      } catch { /* best-effort */ }
    } catch (err: unknown) {
      console.warn(`[SharedSplitWorker] ${token.symbol} fee transfer failed for ${ctx.executionId}:`, err);
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

async function swapAllToUserToken(ctx: RunCtx): Promise<{ swapHash: string | null; tokenBalanceAfter: bigint }> {
  const client = getBasePublicClient();
  let lastSwapHash: string | null = null;

  const ethBal = await client.getBalance({ address: ctx.walletAddress });
  const ethSwappable = ethBal > MIN_GAS_RESERVE_WEI ? ethBal - MIN_GAS_RESERVE_WEI : BigInt(0);

  const isV4 = ctx.swapVenue === 'UNISWAP_V4';

  if (ethSwappable > BigInt(0)) {
    try {
      if (isV4) {
        // Doppler tokens: V4 expects WETH input (not native ETH). Native ETH
        // that lands in the wallet from gas drips etc. stays as gas reserve.
        // The Doppler-fees-as-WETH case is handled by the SUPPORTED_TOKENS
        // loop below; this branch only triggers if the user manually sent
        // native ETH to the wallet. For now we skip it on V4 — the loop's
        // WETH balance check will catch the WETH that Doppler distributes.
        await recordSwapNote(ctx.executionId, {
          symbol: 'ETH',
          status: 'no_quote',
          error: 'native ETH not routed for V4 venue (wrap to WETH first)',
        });
      } else {
        const quote = await quoteBestPath({ tokenIn: WETH_BASE, tokenOut: ctx.tokenAddress, amountIn: ethSwappable, client });
        if (!quote || quote.amountOut === BigInt(0)) {
          await recordSwapNote(ctx.executionId, { symbol: 'ETH', status: 'no_quote' });
        } else {
          const data = encodeExactInput({
            path: quote.path,
            recipient: ctx.walletAddress,
            amountIn: ethSwappable,
            amountOutMinimum: applySlippage(quote.amountOut, ctx.slippageBps),
          });
          lastSwapHash = await sendTurnkeySignedTx(ctx, UNISWAP_V3_SWAP_ROUTER_02, data, ethSwappable);
          await recordSwapNote(ctx.executionId, { symbol: 'ETH', status: 'ok', hash: lastSwapHash });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SharedSplitWorker] ETH swap failed for ${ctx.executionId}:`, err);
      await recordSwapNote(ctx.executionId, { symbol: 'ETH', status: 'failed', error: msg.slice(0, 300) });
    }
  }

  for (const token of SUPPORTED_TOKENS) {
    const tokenAddr = token.address as `0x${string}`;
    if (tokenAddr.toLowerCase() === ctx.tokenAddress.toLowerCase()) continue;

    const bal = (await client.readContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.walletAddress],
    })) as bigint;
    if (bal === BigInt(0)) continue;

    try {
      if (isV4) {
        // V4 only supports a direct pool between input and target (no
        // multi-hop routing in our worker). For Doppler tokens that means
        // the input MUST be the paired token (WETH). Skip other inputs
        // clearly — they need to be converted to WETH first (future work).
        if (
          !ctx.v4PairedToken ||
          tokenAddr.toLowerCase() !== ctx.v4PairedToken.toLowerCase()
        ) {
          await recordSwapNote(ctx.executionId, {
            symbol: token.symbol,
            status: 'no_quote',
            error: `V4 swap only supports paired token (${ctx.v4PairedToken ?? 'unset'}) as input — convert ${token.symbol} to WETH first`,
          });
          continue;
        }
        lastSwapHash = await swapV4(ctx, tokenAddr, bal);
        await recordSwapNote(ctx.executionId, {
          symbol: token.symbol,
          status: 'ok',
          hash: lastSwapHash ?? undefined,
        });
      } else {
        const quote = await quoteBestPath({ tokenIn: tokenAddr, tokenOut: ctx.tokenAddress, amountIn: bal, client });
        if (!quote || quote.amountOut === BigInt(0)) {
          await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'no_quote' });
          continue;
        }
        await approveIfNeeded(ctx, tokenAddr, bal);
        const data = encodeExactInput({
          path: quote.path,
          recipient: ctx.walletAddress,
          amountIn: bal,
          amountOutMinimum: applySlippage(quote.amountOut, ctx.slippageBps),
        });
        lastSwapHash = await sendTurnkeySignedTx(ctx, UNISWAP_V3_SWAP_ROUTER_02, data);
        await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'ok', hash: lastSwapHash });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SharedSplitWorker] ${token.symbol} swap failed for ${ctx.executionId}:`, err);
      await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'failed', error: msg.slice(0, 300) });
    }
  }

  const tokenBalanceAfter = (await client.readContract({
    address: ctx.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.walletAddress],
  })) as bigint;

  return { swapHash: lastSwapHash, tokenBalanceAfter };
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
      const snapshot = await snapshotBuybackBalance(config.walletAddress! as `0x${string}`);

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

// ---------- Execute queued executions ----------

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
    if (!config.isActive || config.status !== 'ACTIVE') {
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
      data: { attempts: exec.attempts + 1, status: 'WITHDRAWING', nextAttemptAt: null },
    });
    if (claim.count === 0) continue;

    const ctx: RunCtx = {
      configId: config.id,
      executionId: exec.id,
      walletAddress: config.walletAddress as `0x${string}`,
      subOrgId: config.turnkeySubOrgId,
      tokenAddress: config.tokenAddress as `0x${string}`,
      tokenDecimals: config.tokenDecimals,
      slippageBps: config.slippageBps,
      burnMode: config.burnMode as 'DEAD_ADDRESS' | 'TOKEN_BURN_FN',
      recoveryAddress: config.recoveryAddress as `0x${string}`,
      feeRateBps: config.feeRateBps,
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

      const { hashes: feeHashes, feeUsd } = await deductFees(ctx);
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { feeTransferHashes: feeHashes, feeCollectedUsd: feeUsd },
      });

      const { swapHash, tokenBalanceAfter } = await swapAllToUserToken(ctx);
      if (tokenBalanceAfter === BigInt(0)) {
        await prisma.sharedSplitExecution.update({
          where: { id: exec.id },
          data: { status: 'FAILED', swapHash: swapHash ?? undefined, lastError: 'swap_produced_no_tokens', completedAt: new Date() },
        });
        continue;
      }
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { swapHash: swapHash ?? undefined, status: 'BURNING' },
      });

      const burn = await burnAcquiredTokens(ctx);

      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: {
          status: 'COMPLETED',
          burnHash: burn.burnHash,
          tokensOutAmount: burn.amount.toString(),
          tokensOutUsd: exec.triggerBalanceUsd,
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

      // After a final failure, check if the last 3 executions are all FAILED → mark BROKEN
      if (isFinal) {
        try {
          const lastExecs = await prisma.sharedSplitExecution.findMany({
            where:   { configId: config.id },
            orderBy: { startedAt: 'desc' },
            take:    3,
            select:  { status: true },
          });
          if (lastExecs.length >= 3 && lastExecs.every((e) => e.status === 'FAILED')) {
            await prisma.sharedSplitBuybackConfig.update({
              where: { id: config.id },
              data:  { status: 'BROKEN' },
            });
            console.warn(`[SharedSplitWorker] Config ${config.id} marked BROKEN after 3 consecutive failed executions`);
          }
        } catch { /* non-fatal */ }
      }
    }
  }
}

// ---------- Main poll loop ----------

async function poll(): Promise<void> {
  await checkPendingActivations();
  await retryProvisioningActivations();
  await scanActiveConfigs();
  await processExecutions();
}

export function startSharedSplitBuybackWorker(): void {
  if (intervalHandle) return;
  console.log(`[SharedSplitWorker] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`);
  poll().catch((e) => console.error('[SharedSplitWorker] Initial run error:', e));
  intervalHandle = setInterval(() => {
    poll().catch((e) => console.error('[SharedSplitWorker] Poll error:', e));
  }, POLL_INTERVAL_MS);
}

export function stopSharedSplitBuybackWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
