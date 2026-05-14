import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  toEventSelector,
} from 'viem';
import { base } from 'viem/chains';
import { PaymentIntentStatus, PaymentMethodType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { PaymentIntentService } from '../services/paymentIntentService';

// Poll cadence — the top-up modal is interactive, so we want first attempt
// within ~10s of recordPaymentSeen rather than the legacy worker's 30s.
const POLL_INTERVAL_MS = 10_000;
const BATCH_LIMIT = 50;

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
});

const ERC20_TRANSFER_ABI = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);
const ERC20_TRANSFER_TOPIC = toEventSelector(ERC20_TRANSFER_ABI);

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function markFailed(id: string, reason: string): Promise<void> {
  console.log(`[PIVerifier] ${id} failed: ${reason}`);
  await prisma.paymentIntent.update({
    where: { id },
    data: {
      status: PaymentIntentStatus.FAILED,
      metadata: { verifierError: reason },
    },
  });
}

async function processOne(id: string): Promise<void> {
  const pi = await prisma.paymentIntent.findUnique({
    where: { id },
    include: { agent: { select: { splitAddress: true } } },
  });
  if (!pi) return;
  if (pi.status !== PaymentIntentStatus.PROCESSING) return;
  if (!pi.txHash) return;

  // Bound the verification window. Intents past their TTL with no on-chain
  // confirmation get cleared so they don't stay in PROCESSING forever.
  if (pi.expiresAt && pi.expiresAt < new Date()) {
    await markFailed(id, 'Payment intent expired before verification');
    return;
  }

  const splitAddress = pi.agent.splitAddress;
  if (!splitAddress) {
    // PI flow targets splits-mode agents. Legacy escrow agents are still
    // covered by TopUpService.verifyAndCredit; surface the mismatch and stop.
    await markFailed(id, 'Agent has no splitAddress — PI flow requires splits mode');
    return;
  }

  const expectedFrom = pi.customerWalletAddress?.toLowerCase();
  if (!expectedFrom) {
    await markFailed(id, 'PaymentIntent has no customerWalletAddress');
    return;
  }

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: pi.txHash as `0x${string}`,
    });
  } catch {
    // Receipt not yet mined — silently retry on next poll.
    return;
  }

  if (receipt.status !== 'success') {
    await markFailed(id, 'Transaction reverted on-chain');
    return;
  }

  const splitAddr = splitAddress.toLowerCase();
  const required = BigInt(pi.amountAtomic);
  let depositVerified = false;

  if (pi.paymentMethodType === PaymentMethodType.ETH) {
    if (receipt.to?.toLowerCase() !== splitAddr) {
      await markFailed(
        id,
        `receipt.to ${receipt.to} != splitAddress ${splitAddr}`,
      );
      return;
    }
    const tx = await publicClient.getTransaction({
      hash: pi.txHash as `0x${string}`,
    });
    if (tx.from.toLowerCase() !== expectedFrom) {
      await markFailed(id, `sender ${tx.from} != customer ${expectedFrom}`);
      return;
    }
    if (tx.value < required) {
      await markFailed(
        id,
        `value ${tx.value.toString()} < required ${required.toString()}`,
      );
      return;
    }
    depositVerified = true;
  } else {
    // ERC-20 splits transfer — find a Transfer log from the customer wallet
    // to the split address for at least the quoted amount.
    if (!pi.tokenAddress) {
      await markFailed(id, 'ERC20 intent missing tokenAddress');
      return;
    }
    const tokenAddr = pi.tokenAddress.toLowerCase();
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== tokenAddr) continue;
      if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC.toLowerCase())
        continue;
      try {
        const decoded = decodeEventLog({
          abi: [ERC20_TRANSFER_ABI],
          data: log.data,
          topics: log.topics,
        });
        const { from, to, value } = decoded.args as {
          from: `0x${string}`;
          to: `0x${string}`;
          value: bigint;
        };
        if (from.toLowerCase() !== expectedFrom) continue;
        if (to.toLowerCase() !== splitAddr) continue;
        if (value < required) continue;
        depositVerified = true;
        break;
      } catch {
        // Ignore malformed Transfer logs and keep scanning.
      }
    }
    if (!depositVerified) {
      await markFailed(id, 'No matching ERC-20 Transfer event found');
      return;
    }
  }

  // Grant credits via the service so the cross-path idempotency guard
  // (ledger unique (agentId, idempotencyKey=txHash)) is honored. Duplicate
  // credit attempts from the legacy worker are caught there.
  try {
    await PaymentIntentService.confirmPayment(id);
    console.log(`[PIVerifier] Confirmed ${id} (tx ${pi.txHash})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PIVerifier] confirmPayment failed for ${id}: ${message}`);
  }
}

async function processPending(): Promise<void> {
  const pending = await prisma.paymentIntent.findMany({
    where: {
      status: PaymentIntentStatus.PROCESSING,
      txHash: { not: null },
    },
    select: { id: true },
    take: BATCH_LIMIT,
  });
  if (pending.length === 0) return;
  console.log(`[PIVerifier] Processing ${pending.length} intent(s)`);
  for (const { id } of pending) {
    try {
      await processOne(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[PIVerifier] Error on ${id}: ${message}`);
    }
  }
}

export function startPaymentIntentVerifierWorker(): void {
  if (intervalHandle) return;
  console.log(
    `[PIVerifier] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`,
  );
  processPending().catch((e) =>
    console.error('[PIVerifier] Initial run error:', e),
  );
  intervalHandle = setInterval(() => {
    processPending().catch((e) =>
      console.error('[PIVerifier] Poll error:', e),
    );
  }, POLL_INTERVAL_MS);
}

export function stopPaymentIntentVerifierWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
