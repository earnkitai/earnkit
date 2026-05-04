import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseAbi,
  parseUnits,
  type Abi,
  type TransactionSerializableEIP1559,
} from 'viem';
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
} from '../lib/uniswap';
import { DEAD_ADDRESS } from '../lib/tokenSafety';
import { signTransaction } from '../services/turnkeyService';
import { SUPPORTED_TOKENS } from '../services/tokenService';
import { priceService } from '../services/priceService';
import { ensureGasFunded } from '../lib/operatorGas';

const POLL_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]; // 1m, 5m, 30m, 2h, 12h
const MIN_GAS_RESERVE_WEI = parseUnits('0.0001', 18); // ~$0.30 worth on Base
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
  const gasWithBuffer = (gas * BigInt(120)) / BigInt(100);
  return {
    chainId: base.id,
    type: 'eip1559',
    to,
    data,
    value,
    nonce,
    gas: gasWithBuffer,
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
  await client.waitForTransactionReceipt({
    hash: txHash,
    timeout: TX_RECEIPT_TIMEOUT_MS,
  });
  return txHash;
}

// ---------- State machine steps ----------

async function withdrawAllFromWarehouse(ctx: RunCtx): Promise<string[]> {
  const client = getBasePublicClient();
  const hashes: string[] = [];

  // ETH first
  const ethBal = await readWarehouseBalance({
    owner: ctx.walletAddress,
    token: SPLIT_NATIVE_TOKEN_ADDRESS,
    client,
  });
  if (ethBal > BigInt(0)) {
    const data = encodeWarehouseWithdraw({
      owner: ctx.walletAddress,
      token: SPLIT_NATIVE_TOKEN_ADDRESS,
    });
    hashes.push(
      await sendTurnkeySignedTx(ctx, SPLIT_WAREHOUSE_ADDRESS, data),
    );
  }

  // Each supported ERC-20
  for (const token of SUPPORTED_TOKENS) {
    const bal = await readWarehouseBalance({
      owner: ctx.walletAddress,
      token: token.address as `0x${string}`,
      client,
    });
    if (bal === BigInt(0)) continue;
    const data = encodeWarehouseWithdraw({
      owner: ctx.walletAddress,
      token: token.address as `0x${string}`,
    });
    hashes.push(await sendTurnkeySignedTx(ctx, SPLIT_WAREHOUSE_ADDRESS, data));
  }

  return hashes;
}

async function approveIfNeeded(
  ctx: RunCtx,
  token: `0x${string}`,
  amount: bigint,
): Promise<void> {
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
    args: [UNISWAP_V3_SWAP_ROUTER_02, BigInt(2) ** BigInt(256) - BigInt(1)], // max approve
  });
  await sendTurnkeySignedTx(ctx, token, data);
}

interface SwapStepResult {
  swapHash: string | null;
  tokensOutAmount: bigint;
}

async function swapAllToUserToken(ctx: RunCtx): Promise<SwapStepResult> {
  const client = getBasePublicClient();
  const beforeUserToken = (await client.readContract({
    address: ctx.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.walletAddress],
  })) as bigint;

  // Discover what's on the wallet (after warehouse withdraw step).
  const ethBal = await client.getBalance({ address: ctx.walletAddress });
  const tokenBalances: Array<{ address: `0x${string}`; amount: bigint; symbol: string; decimals: number }> = [];
  for (const t of SUPPORTED_TOKENS) {
    const bal = (await client.readContract({
      address: t.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.walletAddress],
    })) as bigint;
    if (bal > BigInt(0) && t.address.toLowerCase() !== ctx.tokenAddress.toLowerCase()) {
      tokenBalances.push({
        address: t.address as `0x${string}`,
        amount: bal,
        symbol: t.symbol,
        decimals: t.decimals,
      });
    }
  }

  // Reserve gas: only swap ETH amount > MIN_GAS_RESERVE_WEI.
  const ethSwappable =
    ethBal > MIN_GAS_RESERVE_WEI ? ethBal - MIN_GAS_RESERVE_WEI : BigInt(0);

  let lastSwapHash: string | null = null;

  // Swap ETH first (it's the input that needs no approve).
  if (ethSwappable > BigInt(0)) {
    // ETH -> userToken needs to wrap to WETH first. SwapRouter02 supports
    // exactInput with ETH via msg.value when path starts with WETH and we
    // route via the multicall pattern; simpler is to send ETH as msg.value
    // and use exactInputSingle with WETH as tokenIn. We use exactInput here
    // for path consistency — viem will wrap via WETH automatically only if
    // we go through the router's payable wrap. To keep this simple and
    // policy-safe (we only allow exactInput*), we route ETH->userToken by
    // setting tokenIn = WETH and sending ETH as msg.value. The router
    // wraps internally because the path starts with WETH.
    const { WETH_BASE } = await import('../lib/uniswap');
    const quote = await quoteBestPath({
      tokenIn: WETH_BASE,
      tokenOut: ctx.tokenAddress,
      amountIn: ethSwappable,
      client,
    });
    if (!quote || quote.amountOut === BigInt(0)) {
      throw new Error('no_liquidity_eth_to_token');
    }
    const minOut = applySlippage(quote.amountOut, ctx.slippageBps);
    const data = encodeExactInput({
      path: quote.path,
      recipient: ctx.walletAddress,
      amountIn: ethSwappable,
      amountOutMinimum: minOut,
    });
    lastSwapHash = await sendTurnkeySignedTx(
      ctx,
      UNISWAP_V3_SWAP_ROUTER_02,
      data,
      ethSwappable, // msg.value
    );
  }

  // Then each ERC-20 input
  for (const t of tokenBalances) {
    const quote = await quoteBestPath({
      tokenIn: t.address,
      tokenOut: ctx.tokenAddress,
      amountIn: t.amount,
      client,
    });
    if (!quote || quote.amountOut === BigInt(0)) {
      // Skip this asset — keep funds on wallet for retry / manual handling.
      console.warn(
        `[BuybackExecutor] No swap route for ${t.symbol} -> ${ctx.tokenAddress}, leaving on wallet`,
      );
      continue;
    }
    await approveIfNeeded(ctx, t.address, t.amount);
    const minOut = applySlippage(quote.amountOut, ctx.slippageBps);
    const data = encodeExactInput({
      path: quote.path,
      recipient: ctx.walletAddress,
      amountIn: t.amount,
      amountOutMinimum: minOut,
    });
    lastSwapHash = await sendTurnkeySignedTx(
      ctx,
      UNISWAP_V3_SWAP_ROUTER_02,
      data,
    );
  }

  const afterUserToken = (await client.readContract({
    address: ctx.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.walletAddress],
  })) as bigint;

  return {
    swapHash: lastSwapHash,
    tokensOutAmount: afterUserToken - beforeUserToken,
  };
}

async function burnAcquiredTokens(ctx: RunCtx): Promise<{ burnHash: string; amount: bigint }> {
  const client = getBasePublicClient();
  const balance = (await client.readContract({
    address: ctx.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.walletAddress],
  })) as bigint;

  if (balance === BigInt(0)) {
    throw new Error('no_balance_to_burn');
  }

  const data =
    ctx.burnMode === 'TOKEN_BURN_FN'
      ? encodeFunctionData({ abi: BURN_FN_ABI, functionName: 'burn', args: [balance] })
      : encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [DEAD_ADDRESS, balance],
        });
  const hash = await sendTurnkeySignedTx(ctx, ctx.tokenAddress, data);
  return { burnHash: hash, amount: balance };
}

// ---------- Recovery (sweep funds back to dev wallet) ----------

async function recoverToDevWallet(ctx: RunCtx, devWallet: `0x${string}`): Promise<string[]> {
  const client = getBasePublicClient();
  const hashes: string[] = [];

  // First ensure everything is withdrawn from the Warehouse.
  hashes.push(...(await withdrawAllFromWarehouse(ctx)));

  // Sweep each ERC-20 we hold to devWallet. The Turnkey policy must permit
  // transfers to devWallet — for v1 recovery we call transfer to devWallet
  // which the policy *does not* currently allow (policy only permits transfer
  // to 0xdEaD). Recovery sweeps therefore require the user to revoke the
  // delegated key + use their root credential to sign sweep txs themselves.
  // We expose this with a clear FAILED reason so the dashboard surfaces it.
  // (TODO: extend policy with a per-config "recoveryRecipient" address that
  // the user pre-signs at config time, so we can sweep with our delegated key.)

  return hashes;
}

// ---------- Main loop ----------

async function processOne(): Promise<void> {
  const now = new Date();

  const due = await prisma.buybackExecution.findMany({
    where: {
      status: { in: ['QUEUED', 'RETRYING'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    include: { buybackConfig: true },
    take: 5,
  });

  if (due.length === 0) return;

  for (const exec of due) {
    const config = exec.buybackConfig;
    if (!config.isActive) {
      // Owner disabled buyback — cancel pending executions.
      await prisma.buybackExecution.update({
        where: { id: exec.id },
        data: { status: 'FAILED', lastError: 'config_disabled', completedAt: new Date() },
      });
      continue;
    }

    // Atomic claim: set status to a transitional state so other workers skip.
    const claim = await prisma.buybackExecution.updateMany({
      where: { id: exec.id, attempts: exec.attempts },
      data: {
        attempts: exec.attempts + 1,
        status: 'WITHDRAWING',
        nextAttemptAt: null,
      },
    });
    if (claim.count === 0) {
      console.log(`[BuybackExecutor] Skipping ${exec.id} — claimed by another worker`);
      continue;
    }

    const isRecovery =
      exec.assetsIn &&
      typeof exec.assetsIn === 'object' &&
      !Array.isArray(exec.assetsIn) &&
      (exec.assetsIn as any).intent === 'recover';

    const ctx: RunCtx = {
      configId: config.id,
      executionId: exec.id,
      walletAddress: config.walletAddress as `0x${string}`,
      subOrgId: config.turnkeySubOrgId,
      tokenAddress: config.tokenAddress as `0x${string}`,
      tokenDecimals: config.tokenDecimals,
      slippageBps: config.slippageBps,
      burnMode: config.burnMode,
    };

    const attempt = exec.attempts + 1;
    const isFinal = attempt >= MAX_ATTEMPTS;

    try {
      // Top up gas from the platform's operator wallet before any signing.
      // The buyback wallet pays its own gas for the actual ops; the drip just
      // ensures it has enough ETH on hand to do so. Drips come from a Turnkey
      // wallet with a "ETH transfers only, to known buyback wallets" policy,
      // so a Railway compromise still cannot reroute the gas budget.
      try {
        await ensureGasFunded(ctx.walletAddress);
      } catch (err: any) {
        // Operator-gas failures should fail the execution attempt, not silently
        // proceed and hit "insufficient funds" deeper in the flow with a
        // confusing error.
        throw new Error(`gas_drip_failed: ${err?.message ?? err}`);
      }

      const withdrawHashes = await withdrawAllFromWarehouse(ctx);
      await prisma.buybackExecution.update({
        where: { id: exec.id },
        data: {
          warehouseWithdrawHashes: withdrawHashes,
          status: isRecovery ? 'COMPLETED' : 'SWAPPING',
        },
      });

      if (isRecovery) {
        // For v1: recovery only withdraws Warehouse balances back to the wallet.
        // The user then claims them via root credential at app.splits.org / Turnkey.
        await prisma.buybackExecution.update({
          where: { id: exec.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            lastError:
              'Recovery: funds withdrawn to buyback wallet. Use Turnkey root credential to sweep to your wallet.',
          },
        });
        continue;
      }

      const swap = await swapAllToUserToken(ctx);
      await prisma.buybackExecution.update({
        where: { id: exec.id },
        data: {
          swapHash: swap.swapHash ?? undefined,
          status: 'BURNING',
        },
      });

      const burn = await burnAcquiredTokens(ctx);

      let usdEstimate: number | undefined;
      try {
        const tokenAmountHuman = Number(formatUnits(burn.amount, ctx.tokenDecimals));
        // We don't know the token's USD price from coingecko (it's user-supplied),
        // so we report the trigger USD as a stand-in.
        usdEstimate = exec.triggerBalanceUsd;
        void tokenAmountHuman;
      } catch {
        // ignore — accounting is best-effort.
      }

      await prisma.buybackExecution.update({
        where: { id: exec.id },
        data: {
          status: 'COMPLETED',
          burnHash: burn.burnHash,
          tokensOutAmount: burn.amount.toString(),
          tokensOutUsd: usdEstimate,
          completedAt: new Date(),
        },
      });
      await prisma.buybackConfig.update({
        where: { id: config.id },
        data: { lastTriggeredAt: new Date() },
      });

      console.log(
        `[BuybackExecutor] Completed ${exec.id}: burned ${formatUnits(burn.amount, ctx.tokenDecimals)} ${config.tokenSymbol}`,
      );
    } catch (err: any) {
      const reason: string = err?.message ?? 'unknown_error';
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      await prisma.buybackExecution.update({
        where: { id: exec.id },
        data: {
          status: isFinal ? 'FAILED' : 'RETRYING',
          lastError: reason.slice(0, 500),
          nextAttemptAt: isFinal ? null : new Date(Date.now() + delay),
          completedAt: isFinal ? new Date() : null,
        },
      });
      console.error(
        `[BuybackExecutor] Execution ${exec.id} attempt ${attempt} failed:`,
        reason,
      );
    }
  }
}

export function startBuybackExecutorWorker(): void {
  if (intervalHandle) return;
  console.log(
    `[BuybackExecutor] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`,
  );
  processOne().catch((e) =>
    console.error('[BuybackExecutor] Initial run error:', e),
  );
  intervalHandle = setInterval(() => {
    processOne().catch((e) => console.error('[BuybackExecutor] Poll error:', e));
  }, POLL_INTERVAL_MS);
}

export function stopBuybackExecutorWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
