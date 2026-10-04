import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseUnits,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type LocalAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import type { EarnKitCampaign } from './campaigns';
import { privateKeyProblem } from './cli';
import { sql } from './db';
import { BASE_MAINNET, sanctionedWallets } from './sanctions';
import { pickWinners, type Candidate } from './winners';

/**
 * The campaign payout wallet (v2.4 §3, §8): CAMPAIGN_PAYOUT_PRIVATE_KEY, the only key on Railway,
 * holding one campaign's prize plus gas. Null when unset; a malformed key throws.
 */
export function payoutAccount(env: Record<string, string | undefined> = process.env): LocalAccount | null {
  const key = env.CAMPAIGN_PAYOUT_PRIVATE_KEY?.trim();
  if (!key) return null;
  const problem = privateKeyProblem('CAMPAIGN_PAYOUT_PRIVATE_KEY', key);
  if (problem) throw new Error(problem);
  return privateKeyToAccount(key as Hex);
}

type Receipt = { status: 'success' | 'reverted' };
/** The chain reads and the one write a payout needs; replaced in tests. */
export type PayoutRpc = {
  getChainId: () => Promise<number>;
  nonce: (address: Hex) => Promise<number>;
  fees: () => Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  estimateGas: (a: { account: Hex; to: Hex; data: Hex }) => Promise<bigint>;
  receipt: (hash: Hex) => Promise<Receipt | null>;
  broadcast: (raw: Hex) => Promise<void>;
  waitFor: (hash: Hex, timeoutMs: number) => Promise<Receipt | null>;
  balanceOf: (token: Hex, holder: Hex) => Promise<bigint>;
};

/** Base over BASE_RPC_URL (the public RPC by default). */
export function payoutRpc(url = process.env.BASE_RPC_URL): PayoutRpc {
  const c = createPublicClient({ chain: base, transport: http(url) });
  return {
    getChainId: () => c.getChainId(),
    nonce: (address) => c.getTransactionCount({ address, blockTag: 'pending' }),
    fees: async () => {
      const f = await c.estimateFeesPerGas();
      return { maxFeePerGas: f.maxFeePerGas!, maxPriorityFeePerGas: f.maxPriorityFeePerGas! };
    },
    estimateGas: (a) => c.estimateGas(a),
    receipt: (hash) => c.getTransactionReceipt({ hash }).then((r) => ({ status: r.status }), () => null),
    broadcast: async (raw) => {
      await c.sendRawTransaction({ serializedTransaction: raw }).catch((err: unknown) => {
        // Rebroadcasting a known transaction is fine: it can only be mined once.
        if (!/already known|known transaction|nonce too low/i.test(String(err))) throw err;
      });
    },
    waitFor: (hash, timeout) =>
      c.waitForTransactionReceipt({ hash, timeout }).then((r) => ({ status: r.status }), () => null),
    balanceOf: (token, holder) =>
      c.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [holder] }),
  };
}

/** Payout writes; each is one statement on the winner's row. */
export type PayoutStore = {
  /** Stores the signed transfer before it is sent; false when another run already did. */
  sending: (id: number, hash: Hex, raw: Hex) => Promise<boolean>;
  paid: (id: number, amount: string) => Promise<void>;
  /** A reverted transfer: cleared so the next run signs a new one. */
  failed: (id: number) => Promise<void>;
  /** The payout wallet is on the sanctions list: the next entry takes the slot. */
  refused: (id: number) => Promise<void>;
};

export const dbPayoutStore: PayoutStore = {
  sending: async (id, hash, raw) =>
    (
      await sql()`
        UPDATE projects SET payout_status = 'sending', prize_tx = ${hash}, prize_raw_tx = ${raw}
        WHERE id = ${id} AND prize_tx IS NULL RETURNING id`
    ).length > 0,
  paid: async (id, amount) => {
    await sql()`
      UPDATE projects SET payout_status = 'paid', prize_paid_at = now(), prize_amount = ${amount}, prize_raw_tx = NULL
      WHERE id = ${id}`;
  },
  failed: async (id) => {
    await sql()`
      UPDATE projects SET payout_status = NULL, prize_tx = NULL, prize_raw_tx = NULL
      WHERE id = ${id} AND payout_status = 'sending'`;
  },
  refused: async (id) => {
    await sql()`UPDATE projects SET payout_status = 'refused' WHERE id = ${id} AND prize_tx IS NULL`;
  },
};

export type PayoutRow = Pick<Candidate, 'id' | 'payout_status' | 'prize_tx' | 'payout_wallet'> & {
  prize_raw_tx: string | null;
};

/**
 * Paid: 'paid', or a transfer hash with no signed bytes kept (only 'paid' clears them; an entry
 * paid before v2.4 has no status). Never signed again. Pure.
 */
const settled = (row: PayoutRow) => row.payout_status === 'paid' || Boolean(row.prize_tx && !row.prize_raw_tx);

/**
 * Pays one winner, idempotently (v2.4 §3; Review Focus 3): the ERC-20 transfer is signed, and its
 * hash and raw bytes stored ('sending') before it is broadcast. A crash, or another run, finds
 * them and rebroadcasts the same bytes (one nonce: mined at most once) instead of signing again.
 * 'paid' once mined; 'pending' while not; 'failed' (cleared for a retry) if it reverted.
 */
export async function payWinner(
  row: PayoutRow,
  a: {
    token: Hex;
    amount: bigint;
    amountText: string;
    account: LocalAccount;
    rpc: PayoutRpc;
    store: PayoutStore;
    /** Epoch ms: the wait for the receipt ends by then (at least 5 s, at most 60 s). */
    deadline?: number;
  },
): Promise<'paid' | 'pending' | 'failed'> {
  if (settled(row)) return 'paid';
  let raw = row.prize_raw_tx as Hex | null;
  let hash = row.prize_tx as Hex | null;
  if (!raw || !hash) {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      // Lowercased first: a stored wallet in mixed case that isn't a valid checksum is still that address.
      args: [getAddress(row.payout_wallet.toLowerCase()), a.amount],
    });
    const [chainId, nonce, fees, gas] = await Promise.all([
      a.rpc.getChainId(),
      a.rpc.nonce(a.account.address),
      a.rpc.fees(),
      a.rpc.estimateGas({ account: a.account.address, to: a.token, data }),
    ]);
    raw = await a.account.signTransaction({
      chainId,
      type: 'eip1559',
      to: a.token,
      data,
      nonce,
      gas: (gas * 12n) / 10n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    hash = keccak256(raw);
    if (!(await a.store.sending(row.id, hash, raw))) return 'pending';
    Object.assign(row, { prize_tx: hash, prize_raw_tx: raw, payout_status: 'sending' });
  }
  let receipt = await a.rpc.receipt(hash);
  if (!receipt) {
    await a.rpc.broadcast(raw);
    const left = (a.deadline ?? Infinity) - Date.now();
    receipt = await a.rpc.waitFor(hash, Math.max(5_000, Math.min(60_000, left)));
  }
  if (!receipt) return 'pending';
  if (receipt.status === 'success') {
    await a.store.paid(row.id, a.amountText);
    row.payout_status = 'paid';
    return 'paid';
  }
  await a.store.failed(row.id);
  Object.assign(row, { prize_tx: null, prize_raw_tx: null, payout_status: null });
  return 'failed';
}

export type PayDeps = {
  account?: LocalAccount | null;
  rpc?: PayoutRpc;
  store?: PayoutStore;
  /** Whether a wallet is on the sanctions list (production fails closed: it throws). */
  listed?: (wallet: string) => Promise<boolean>;
  /** Epoch ms: no new transfer is signed after it, and a wait for one is cut to it (the cron's budget). */
  deadline?: number;
};

/** The payout wallet can't pay gas: viem's InsufficientFundsError, or the node's own words. Pure. */
const outOfGas = (err: unknown) =>
  /insufficient funds|exceeds the balance of the account/i.test(
    err instanceof Error ? `${err.name} ${err.message}` : String(err),
  );

/**
 * Pays an EarnKit campaign's frozen winners (v2.4 §3, §8), in rank order: only winners from
 * pickWinners (one prize per payout wallet and per installation, vetoes applied), amount_each from
 * the program file, to their payout wallet only, each screened first (a listed wallet is skipped
 * and the next entry moves up). Stops with a note when the wallet holds less than the next prize
 * or too little ETH for gas, a transfer isn't mined yet, or the deadline passes; the next run
 * continues. Never sends off Base mainnet.
 */
export async function payCampaign(
  c: EarnKitCampaign,
  entries: (Candidate & { prize_raw_tx: string | null })[],
  deps: PayDeps = {},
): Promise<{ done: boolean; note: string | null }> {
  const account = deps.account === undefined ? payoutAccount() : deps.account;
  if (!account)
    return { done: false, note: "The payout wallet isn't set up yet (CAMPAIGN_PAYOUT_PRIVATE_KEY); nothing was sent." };
  const rpc = deps.rpc ?? payoutRpc();
  const store = deps.store ?? dbPayoutStore;
  const listed =
    deps.listed ?? (async (w: string) => (await sanctionedWallets([w], BASE_MAINNET)).length > 0);
  if ((await rpc.getChainId()) !== BASE_MAINNET)
    return { done: false, note: 'BASE_RPC_URL is not Base mainnet; nothing was sent.' };
  const token = c.prize.token as Hex;
  const amount = parseUnits(c.amount_each, c.prize.decimals);
  const deadline = deps.deadline ?? Infinity;
  for (let step = 0; step <= entries.length + c.winners; step++) {
    const { winners } = pickWinners(entries, c.winners, c.min_score);
    const next = winners.find((w) => !settled(w));
    if (!next)
      return { done: true, note: winners.length ? null : 'No entry reached the minimum score; nothing to pay.' };
    if (!next.prize_tx) {
      if (Date.now() >= deadline) break;
      if (await listed(next.payout_wallet)) {
        await store.refused(next.id);
        next.payout_status = 'refused';
        continue;
      }
      const balance = await rpc.balanceOf(token, account.address);
      if (balance < amount)
        return {
          done: false,
          note: `The payout wallet ${account.address} holds ${formatUnits(balance, c.prize.decimals)} ${c.prize.symbol}, less than the next prize (${c.amount_each}). Payouts resume once it is topped up.`,
        };
    }
    let r: Awaited<ReturnType<typeof payWinner>>;
    try {
      r = await payWinner(next, { token, amount, amountText: c.amount_each, account, rpc, store, deadline });
    } catch (err) {
      if (!outOfGas(err)) throw err;
      return {
        done: false,
        note: `The payout wallet ${account.address} needs a little ETH for gas. Payouts resume once it is topped up.`,
      };
    }
    if (r === 'paid') continue;
    return {
      done: false,
      note: r === 'failed'
        ? `The transfer to entry #${next.id} failed; it is retried on the next run.`
        : `Waiting for the transfer to entry #${next.id} to be mined.`,
    };
  }
  return { done: false, note: 'Payout stopped early; it continues on the next run.' };
}

/** Proof of funds for the campaign page (v2.4 §3): the payout wallet and its live prize balance. */
export async function payoutFunds(c: EarnKitCampaign) {
  try {
    const account = payoutAccount();
    if (!account) return null;
    const balance = await payoutRpc().balanceOf(c.prize.token as Hex, account.address);
    return { wallet: account.address, balance: formatUnits(balance, c.prize.decimals) };
  } catch (err) {
    console.error('[funds]', err);
    return null;
  }
}
