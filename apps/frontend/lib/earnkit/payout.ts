import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseTransaction,
  parseUnits,
  recoverTransactionAddress,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
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
  /** Transactions from `address` in finalized blocks: a nonce below it is used for good (no reorg). */
  finalizedNonce: (address: Hex) => Promise<number>;
  fees: () => Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  estimateGas: (a: { account: Hex; to: Hex; data: Hex }) => Promise<bigint>;
  /** Null ONLY when the node says there is no such receipt (typed not-found); any other error throws. */
  receipt: (hash: Hex) => Promise<Receipt | null>;
  /** Whether the node knows the transaction; false ONLY on a typed not-found, any other error throws. */
  transaction: (hash: Hex) => Promise<boolean>;
  /**
   * Whether the transaction's receipt is at or below the finalized block (it can't be reorged
   * away); false when not found or not final yet, any other error throws.
   */
  finalReceipt: (hash: Hex) => Promise<boolean>;
  /**
   * 'sent' (accepted), 'known' (the node already has these bytes) or 'stale' (rejected as "nonce
   * too low": that nonce is already used). Anything else throws.
   */
  broadcast: (raw: Hex) => Promise<'sent' | 'known' | 'stale'>;
  waitFor: (hash: Hex, timeoutMs: number) => Promise<Receipt | null>;
  balanceOf: (token: Hex, holder: Hex) => Promise<bigint>;
};

/** EIP-1559 caps with headroom: twice the base fee plus the tip, so a rising base fee can't strand it. Pure. */
export const feeCaps = (baseFee: bigint, tip: bigint) => ({
  maxFeePerGas: 2n * baseFee + tip,
  maxPriorityFeePerGas: tip,
});

/** Base over BASE_RPC_URL (the public RPC by default). */
export function payoutRpc(url = process.env.BASE_RPC_URL): PayoutRpc {
  const c = createPublicClient({ chain: base, transport: http(url) });
  // No client-side retry for the one write: a retried send could read back its own success as
  // "nonce too low" and get the transfer cleared and signed again.
  const once = createPublicClient({ chain: base, transport: http(url, { retryCount: 0 }) });
  return {
    getChainId: () => c.getChainId(),
    nonce: (address) => c.getTransactionCount({ address, blockTag: 'pending' }),
    finalizedNonce: (address) => c.getTransactionCount({ address, blockTag: 'finalized' }),
    fees: async () => {
      const [block, tip] = await Promise.all([c.getBlock(), c.estimateMaxPriorityFeePerGas()]);
      return feeCaps(block.baseFeePerGas ?? 0n, tip);
    },
    estimateGas: (a) => c.estimateGas(a),
    // A 429, a timeout or a node without a tx index is not "not found": it throws, so the run
    // stops (PAY_FAILED) and retries instead of judging the transfer dead (Ruling 33).
    receipt: (hash) =>
      c.getTransactionReceipt({ hash }).then(
        (r) => ({ status: r.status }),
        (err: unknown) => {
          if (err instanceof TransactionReceiptNotFoundError) return null;
          throw err;
        },
      ),
    finalReceipt: async (hash) => {
      const r = await c.getTransactionReceipt({ hash }).catch((err: unknown) => {
        if (err instanceof TransactionReceiptNotFoundError) return null;
        throw err;
      });
      if (!r) return false;
      const finalized = await c.getBlock({ blockTag: 'finalized' });
      return r.blockNumber <= finalized.number;
    },
    transaction: (hash) =>
      c.getTransaction({ hash }).then(
        () => true,
        (err: unknown) => {
          if (err instanceof TransactionNotFoundError) return false;
          throw err;
        },
      ),
    broadcast: (raw) =>
      once.sendRawTransaction({ serializedTransaction: raw }).then(
        () => 'sent' as const,
        (err: unknown) => {
          const text = String(err);
          if (/already known|known transaction/i.test(text)) return 'known' as const;
          if (/nonce too low/i.test(text)) return 'stale' as const;
          throw err;
        },
      ),
    waitFor: (hash, timeout) =>
      c.waitForTransactionReceipt({ hash, timeout }).then((r) => ({ status: r.status }), () => null),
    balanceOf: (token, holder) =>
      c.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [holder] }),
  };
}

/** Payout writes; each is one statement on the winner's row. */
export type PayoutStore = {
  /**
   * Stores the signed transfer before it is sent; false when another run already did. `place`
   * (per-place payouts, v2.5): the payout place this transfer takes and its amount, stored with it.
   */
  sending: (id: number, hash: Hex, raw: Hex, place?: { slot: number; amount: string }) => Promise<boolean>;
  paid: (id: number, amount: string) => Promise<void>;
  /**
   * A transfer that will never be mined (reverted, or its nonce was already used): cleared so the
   * next run signs a new one. `reverted` counts it; returns the entry's revert count.
   */
  failed: (id: number, reverted: boolean) => Promise<number>;
  /** The payout wallet is on the sanctions list: the next entry takes the slot. */
  refused: (id: number) => Promise<void>;
  /**
   * A send answered "nonce too low": the row stays 'sending'; the first such time is kept. Null
   * resets it (a later send was accepted).
   */
  stale: (id: number, at: Date | null) => Promise<void>;
};

export const dbPayoutStore: PayoutStore = {
  sending: async (id, hash, raw) =>
    (
      await sql()`
        UPDATE projects SET payout_status = 'sending', prize_tx = ${hash}, prize_raw_tx = ${raw},
          payout_stale_at = NULL
        WHERE id = ${id} AND prize_tx IS NULL RETURNING id`
    ).length > 0,
  paid: async (id, amount) => {
    await sql()`
      UPDATE projects SET payout_status = 'paid', prize_paid_at = now(), prize_amount = ${amount},
        payout_stale_at = NULL
      WHERE id = ${id}`;
  },
  failed: async (id, reverted) => {
    const [r] = await sql()<{ payout_reverts: number }[]>`
      UPDATE projects SET payout_status = NULL, prize_tx = NULL, prize_raw_tx = NULL, payout_stale_at = NULL,
        payout_reverts = payout_reverts + ${reverted ? 1 : 0}
      WHERE id = ${id} AND payout_status = 'sending'
      RETURNING payout_reverts`;
    return r?.payout_reverts ?? 0;
  },
  refused: async (id) => {
    await sql()`UPDATE projects SET payout_status = 'refused' WHERE id = ${id} AND prize_tx IS NULL`;
  },
  stale: async (id, at) => {
    await sql()`
      UPDATE projects SET payout_stale_at = ${at === null ? null : sql()`COALESCE(payout_stale_at, ${at})`}
      WHERE id = ${id} AND payout_status = 'sending'`;
  },
};

export type PayoutRow = Pick<Candidate, 'id' | 'payout_status' | 'prize_tx' | 'payout_wallet'> & {
  prize_raw_tx: string | null;
  /** How many of its transfers reverted (2 refuse the entry: v2.4 fix round 1, M4). */
  payout_reverts?: number;
  /** When a send of the stored bytes was first answered "nonce too low" (fix round 2). */
  payout_stale_at?: Date | null;
  /** Per-place payouts (v2.5 builder bonus): the place its transfer takes (0 = first), while it has one. */
  slot?: number | null;
};

/** How long a "nonce too low" answer is waited on before its bytes may be judged dead. */
export const STALE_CLEAR_MS = 30 * 60_000;

/** The page note when a stuck transfer can't be proven dead (Ruling 33). */
export const MANUAL_CHECK = 'Payouts paused: a transfer needs a manual check.';
/** The run note when the program's prize terms no longer match the frozen ones. */
export const TERMS_CHANGED = "Payout paused: the campaign's prize terms changed after the review opened.";

/** Shown on the campaign page when a payout step fails (the cause stays in the server log). */
export const PAY_FAILED = 'Payouts paused: a check failed; retrying hourly.';
/** Consecutive failed pay steps after which the run waits on the owner (503): six hourly runs. */
export const PAY_FAILED_RUNS = 6;
/** A failed step in the cron's answer (the GitHub Actions log): fixed, so no RPC URL or key leaks. */
export const STEP_FAILED = 'This step failed; it is retried on the next run.';

/** The run note when CAMPAIGN_PAYOUT_PRIVATE_KEY is unset: waits on the owner. */
export const NO_PAYOUT_KEY = "The payout wallet isn't set up yet (CAMPAIGN_PAYOUT_PRIVATE_KEY); nothing was sent.";
/** The run note when BASE_RPC_URL answers another chain: waits on the owner. */
export const NOT_MAINNET = 'BASE_RPC_URL is not Base mainnet; nothing was sent.';
/** Ends the note when the payout wallet is short of the prize token or of ETH for gas. */
export const TOP_UP = 'Payouts resume once it is topped up.';

/**
 * A payout note that waits on the owner (I6): a manual check, changed terms, the payout key unset
 * or BASE_RPC_URL not Base mainnet (never clear by themselves), or a payout wallet short of the prize token or of ETH for gas (clears only once the
 * owner tops it up). The cron answers 503 so the GitHub Actions run fails and emails the owner;
 * the public page still reads "Payouts paused; they resume automatically." for a top-up. Pure.
 */
export const needsOwner = (note: string | null | undefined) =>
  Boolean(note && (note.includes(MANUAL_CHECK) || note.includes(TERMS_CHANGED) || note.includes(TOP_UP) ||
      note.includes(NO_PAYOUT_KEY) || note.includes(NOT_MAINNET)));

/** The nonce of a signed transaction, when the payout key signed it; null otherwise. */
async function ownNonce(raw: Hex, account: LocalAccount) {
  const sender = await recoverTransactionAddress({ serializedTransaction: raw as never });
  return sender.toLowerCase() === account.address.toLowerCase() ? parseTransaction(raw).nonce! : null;
}

/** Reverted transfers after which an entry is refused, so it can't block the others. */
export const MAX_REVERTS = 2;

/**
 * Paid: 'paid', or a transfer hash with no signed bytes and no status (an entry paid before v2.4).
 * Never signed again. Pure.
 */
const settled = (row: PayoutRow) => row.payout_status === 'paid' || Boolean(row.prize_tx && !row.prize_raw_tx);

/**
 * Pays one winner, idempotently (v2.4 §3; Review Focus 3): the ERC-20 transfer is signed, and its
 * hash and raw bytes stored ('sending') before it is broadcast. A crash, or another run, finds
 * them and rebroadcasts the same bytes (one nonce: mined at most once) instead of signing again.
 * 'paid' once mined; 'pending' while not; 'failed' (cleared for a retry) if it reverted.
 *
 * A send answered "nonce too low" is never cleared in the same run (a provider retry or fan-out
 * may have mined it while answering that): the row stays 'sending' with its stale time, reset
 * when a later send is accepted. A later run clears it ('dropped', then re-signed) only when that
 * is provably safe (Ruling 33): STALE_CLEAR_MS have passed; the receipt AND the transaction are
 * both a typed not-found (any other read error throws: the run fails and retries); the finalized
 * nonce is past the transfer's; that nonce is the one of another entry's PAID transfer from
 * this wallet (`otherPaid`, its kept signed bytes): EarnKit's own payout took it, so these bytes
 * can never land; and that paid transfer's receipt is at or below the finalized block (until it
 * is, 'pending'). Every other case past STALE_CLEAR_MS with nothing found and the nonce finalized
 * returns 'manual' (the page: MANUAL_CHECK); only a use of the key outside EarnKit gets there.
 *
 * Manual runbook for 'manual' (docs/codebase-context/architecture-guide.md, Runbooks): on
 * Basescan, find the payout wallet's transaction with the stuck transfer's nonce (decode
 * projects.prize_raw_tx). If it is not this transfer and this winner was not paid by any other
 * transaction, clear the row (payout_status, prize_tx, prize_raw_tx, payout_stale_at to NULL) and
 * the next hourly run signs a new transfer. If the winner was paid, set payout_status = 'paid',
 * prize_tx to that transaction's hash and prize_raw_tx = NULL (the stored bytes never landed;
 * kept, their nonce would read as one EarnKit's own payout used).
 *
 * `nonces.next` (one payout run) is the lowest nonce to sign with, raised past every transfer
 * mined in the run. `now` is the run's time (injectable for the e2e).
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
    nonces?: { next: number };
    now?: Date;
    /** Signed bytes of the campaign's other paid transfers (kept on paid rows). */
    otherPaid?: string[];
    /** Per-place payouts: the place a NEW transfer takes, stored with it (PayoutStore.sending). */
    slot?: number;
  },
): Promise<'paid' | 'pending' | 'failed' | 'dropped' | 'manual'> {
  if (settled(row)) return 'paid';
  const now = a.now ?? new Date();
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
      nonce: Math.max(nonce, a.nonces?.next ?? 0),
      gas: (gas * 15n) / 10n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    hash = keccak256(raw);
    const place = a.slot === undefined ? undefined : { slot: a.slot, amount: a.amountText };
    if (!(await a.store.sending(row.id, hash, raw, place))) return 'pending';
    Object.assign(row, { prize_tx: hash, prize_raw_tx: raw, payout_status: 'sending', payout_stale_at: null });
    if (place) row.slot = place.slot;
  }
  const clear = async (reverted: boolean) => {
    row.payout_reverts = await a.store.failed(row.id, reverted);
    Object.assign(row, { prize_tx: null, prize_raw_tx: null, payout_status: null, payout_stale_at: null });
    if (row.slot !== undefined) row.slot = null;
  };
  const txNonce = parseTransaction(raw).nonce!;
  let receipt = await a.rpc.receipt(hash);
  if (!receipt) {
    if (
      row.payout_stale_at &&
      now.getTime() - row.payout_stale_at.getTime() >= STALE_CLEAR_MS &&
      !(await a.rpc.transaction(hash)) &&
      (await a.rpc.finalizedNonce(a.account.address)) > txNonce
    ) {
      const others = a.otherPaid ?? [];
      const taken = await Promise.all(others.map((r) => ownNonce(r as Hex, a.account)));
      const by = taken.indexOf(txNonce);
      if (by === -1) return 'manual';
      // That paid transfer is final itself, so no reorg can bring these bytes back to life.
      if (!(await a.rpc.finalReceipt(keccak256(others[by] as Hex)))) return 'pending';
      // Read last, right before clearing: still no receipt.
      if (await a.rpc.receipt(hash)) return 'pending';
      await clear(false);
      return 'dropped';
    }
    const sent = await a.rpc.broadcast(raw);
    if (sent === 'stale') {
      if (!row.payout_stale_at) {
        await a.store.stale(row.id, now);
        row.payout_stale_at = now;
      }
      return 'pending';
    }
    if (row.payout_stale_at) {
      await a.store.stale(row.id, null);
      row.payout_stale_at = null;
    }
    const left = (a.deadline ?? Infinity) - Date.now();
    receipt = await a.rpc.waitFor(hash, Math.max(5_000, Math.min(60_000, left)));
  }
  if (!receipt) return 'pending';
  if (a.nonces) a.nonces.next = Math.max(a.nonces.next, txNonce + 1);
  if (receipt.status === 'success') {
    await a.store.paid(row.id, a.amountText);
    row.payout_status = 'paid';
    return 'paid';
  }
  await clear(true);
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
  /** The run's time (stale sends are judged against it); default the real time. */
  now?: Date;
  /** Only follow transfers already in flight to paid or failed; sign nothing new (a paused payout). */
  followOnly?: boolean;
  /**
   * The payout wallet's signed, stored, unmined sends anywhere in EarnKit (openStoredSends): a new
   * transfer is never signed at or below their nonces. Default: the database's, with the database
   * store; none with a custom `store` (tests), unless given.
   */
  openSends?: () => Promise<{ raw: Hex; nonce: number }[]>;
};

/** What a payout pays: frozen in campaign_runs.terms when the review opens (v2.4 fix round 1, I2). */
export type PayoutTerms = {
  prize: Pick<EarnKitCampaign['prize'], 'token' | 'symbol' | 'decimals'>;
  amount_each: string;
  winners: number;
  min_score: number;
};

/** The terms to freeze, flat (campaign_runs.terms). Pure; exported for tests. */
export const termsOf = (c: PayoutTerms) => ({
  token: c.prize.token,
  symbol: c.prize.symbol,
  decimals: c.prize.decimals,
  amount_each: c.amount_each,
  winners: c.winners,
  min_score: c.min_score,
});
export type FrozenTerms = ReturnType<typeof termsOf>;

/** Frozen terms back in campaign shape. Pure. */
export const fromTerms = (t: FrozenTerms): PayoutTerms => ({
  prize: { token: t.token, symbol: t.symbol, decimals: t.decimals },
  amount_each: t.amount_each,
  winners: t.winners,
  min_score: t.min_score,
});

/** Whether two sets of terms pay the same (token compared in any case). Pure; exported for tests. */
export const sameTerms = (a: FrozenTerms, b: FrozenTerms) =>
  a.token.toLowerCase() === b.token.toLowerCase() &&
  a.symbol === b.symbol &&
  a.decimals === b.decimals &&
  a.amount_each === b.amount_each &&
  a.winners === b.winners &&
  a.min_score === b.min_score;

/** The payout wallet can't pay gas: viem's InsufficientFundsError, or the node's own words. Pure. */
const outOfGas = (err: unknown) =>
  /insufficient funds|exceeds the balance of the account/i.test(
    err instanceof Error ? `${err.name} ${err.message}` : String(err),
  );

/**
 * The payout wallet's signed transfers stored before broadcast and not settled yet, with their
 * nonces, lowest first: a bonus sweep, a campaign payout or a builder bonus payout in 'sending'
 * (v2.5 Task 4 fix round 1, I2). Only ones this key signed. Nothing new is signed at or below them.
 */
export async function openStoredSends(account: LocalAccount) {
  const rows = await sql()<{ raw: string }[]>`
    SELECT raw_tx AS raw FROM bonus_sweeps WHERE status = 'sending' AND raw_tx IS NOT NULL
    UNION ALL
    SELECT prize_raw_tx AS raw FROM projects WHERE payout_status = 'sending' AND prize_raw_tx IS NOT NULL
    UNION ALL
    SELECT raw_tx AS raw FROM bonus_payouts WHERE status = 'sending' AND raw_tx IS NOT NULL`;
  const out: { raw: Hex; nonce: number }[] = [];
  for (const r of rows) {
    const sender = await recoverTransactionAddress({ serializedTransaction: r.raw as never });
    if (sender.toLowerCase() === account.address.toLowerCase()) out.push({ raw: r.raw as Hex, nonce: parseTransaction(r.raw as Hex).nonce! });
  }
  return out.sort((a, b) => a.nonce - b.nonce);
}

/** A row `payRanked` pays: the v2.4 payout fields, its payout wallet and installation. */
export type RankedRow = PayoutRow & { installation_id: number | null };

/** What `payRanked` pays: any ERC-20, an amount per place (best first). */
export type RankedTerms = {
  token: string;
  symbol: string;
  decimals: number;
  /** The amount of each place, best first; its length is the number of places. */
  amounts: bigint[];
  /** Per-place amounts: each transfer stores its place (PayoutStore.sending); else places are counted. */
  perPlace?: boolean;
  /** How an amount reads in a note (default: formatUnits). */
  label?: (amount: bigint) => string;
  /** The amount recorded when paid (default: wei as a decimal string). */
  amountText?: (amount: bigint) => string;
  /** The note when no entry can be paid at all. */
  nothing?: string | null;
};

/**
 * Pays ranked winners, one place at a time, best first (v2.4 §3, §8; v2.5 §3 generalizes it to
 * per-place amounts and any ERC-20). Every v2.4 rule is kept:
 * - A transfer in flight ('sending') is followed to paid or failed first, before anything new is
 *   signed, even if its entry has since left the winners (`followOnly`: only that).
 * - Entries with a transfer hold a place (their stored one, `perPlace`), with their wallet and
 *   installation; the next free place goes to `pick` over the others (never a refused entry; one
 *   payout per payout wallet and per installation).
 * - Each new winner is screened first (a listed wallet is refused and the next entry moves up); a
 *   transfer that reverts MAX_REVERTS times refuses its entry the same way, with a note.
 * - A new transfer is never signed at or below the nonce of another stored, unmined send
 *   (`openSends`), nor below one mined earlier in the run.
 * - Stops with a note when the wallet holds less than the next place's amount or too little ETH
 *   for gas, a transfer isn't mined yet, or the deadline passes; the next run continues. Never
 *   sends off Base mainnet.
 */
export async function payRanked<R extends RankedRow>(
  t: RankedTerms,
  entries: R[],
  pick: (pool: R[]) => R | undefined,
  deps: PayDeps = {},
): Promise<{ done: boolean; note: string | null }> {
  const account = deps.account === undefined ? payoutAccount() : deps.account;
  if (!account)
    return { done: false, note: NO_PAYOUT_KEY };
  const rpc = deps.rpc ?? payoutRpc();
  const store = deps.store ?? dbPayoutStore;
  const listed =
    deps.listed ?? (async (w: string) => (await sanctionedWallets([w], BASE_MAINNET)).length > 0);
  const openSends = deps.openSends ?? (deps.store ? async () => [] : () => openStoredSends(account));
  if ((await rpc.getChainId()) !== BASE_MAINNET)
    return { done: false, note: NOT_MAINNET };
  const token = t.token as Hex;
  const label = t.label ?? ((x: bigint) => formatUnits(x, t.decimals));
  const amountText = t.amountText ?? ((x: bigint) => x.toString());
  const placeOf = (e: R) => (t.perPlace && typeof e.slot === 'number' ? e.slot : null);
  const deadline = deps.deadline ?? Infinity;
  const nonces = { next: 0 };
  const notes: string[] = [];
  const stop = (note: string) => ({ done: false, note: [...notes, note].join(' ') });
  for (let step = 0; step <= 2 * entries.length + t.amounts.length; step++) {
    let next = entries.find((e) => e.payout_status === 'sending' && e.prize_tx && e.prize_raw_tx);
    let slot: number | undefined;
    let amount: bigint;
    if (!next && deps.followOnly) return { done: false, note: notes.join(' ') || null };
    if (next) amount = t.amounts[placeOf(next) ?? 0];
    else {
      const taken = entries.filter((e) => e.prize_tx);
      const wallets = new Set(taken.map((e) => e.payout_wallet.toLowerCase()));
      const agents = new Set(taken.map((e) => e.installation_id).filter((i) => i !== null));
      // Places held by a transfer; one without a stored place holds the lowest free one.
      const held = new Set(taken.map(placeOf).filter((p) => p !== null));
      const counted = taken.filter((e) => placeOf(e) === null).length;
      const free = t.amounts.map((_, i) => i).filter((i) => !held.has(i)).slice(counted);
      const pool = entries.filter(
        (e) =>
          !e.prize_tx &&
          e.payout_status !== 'refused' &&
          !wallets.has(e.payout_wallet.toLowerCase()) &&
          !(e.installation_id !== null && agents.has(e.installation_id)),
      );
      next = free.length > 0 ? pick(pool) : undefined;
      if (!next)
        return {
          done: true,
          note: taken.length || notes.length ? notes.join(' ') || null : (t.nothing ?? null),
        };
      slot = free[0];
      amount = t.amounts[slot];
      if (Date.now() >= deadline) break;
      if (await listed(next.payout_wallet)) {
        await store.refused(next.id);
        next.payout_status = 'refused';
        continue;
      }
      const balance = await rpc.balanceOf(token, account.address);
      if (balance < amount)
        return stop(
          `The payout wallet ${account.address} holds ${formatUnits(balance, t.decimals)} ${t.symbol}, less than the next prize (${label(amount)}). ${TOP_UP}`,
        );
      // Never at or below the nonce of another stored, unmined send (v2.5 Task 4 deferred item).
      const open = await openSends();
      nonces.next = Math.max(nonces.next, ...open.filter((o) => o.raw !== next!.prize_raw_tx).map((o) => o.nonce + 1));
    }
    let r: Awaited<ReturnType<typeof payWinner>>;
    try {
      const otherPaid = entries
        .filter((e) => e !== next && e.payout_status === 'paid' && e.prize_raw_tx)
        .map((e) => e.prize_raw_tx!);
      r = await payWinner(next, {
        token,
        amount,
        amountText: amountText(amount),
        account,
        rpc,
        store,
        deadline,
        nonces,
        now: deps.now,
        otherPaid,
        ...(t.perPlace && slot !== undefined && { slot }),
      });
    } catch (err) {
      if (!outOfGas(err)) throw err;
      return stop(`The payout wallet ${account.address} needs a little ETH for gas. ${TOP_UP}`);
    }
    if (r === 'paid' || r === 'dropped') continue;
    if (r === 'manual') return stop(MANUAL_CHECK);
    if (r === 'failed' && (next.payout_reverts ?? 0) >= MAX_REVERTS) {
      await store.refused(next.id);
      next.payout_status = 'refused';
      notes.push(`The transfer to entry #${next.id} reverted twice; that entry was skipped and the next one moved up.`);
      continue;
    }
    return stop(
      r === 'failed'
        ? `The transfer to entry #${next.id} failed; it is retried on the next run.`
        : `Waiting for the transfer to entry #${next.id} to be mined.`,
    );
  }
  return stop('Payout stopped early; it continues on the next run.');
}

/**
 * Pays an EarnKit campaign's frozen winners (v2.4 §3, §8) from its frozen terms, in rank order:
 * `payRanked` with amount_each for each of `winners` places and pickWinners (min_score, vetoes,
 * refusals; one prize per payout wallet and per installation).
 */
export async function payCampaign(
  c: PayoutTerms,
  entries: (Candidate & { prize_raw_tx: string | null; payout_reverts?: number; payout_stale_at?: Date | null })[],
  deps: PayDeps = {},
): Promise<{ done: boolean; note: string | null }> {
  const amount = parseUnits(c.amount_each, c.prize.decimals);
  return payRanked(
    {
      token: c.prize.token,
      symbol: c.prize.symbol,
      decimals: c.prize.decimals,
      amounts: Array.from({ length: Math.max(0, c.winners) }, () => amount),
      label: () => c.amount_each,
      amountText: () => c.amount_each,
      nothing: 'No entry reached the minimum score; nothing to pay.',
    },
    entries,
    (pool) => pickWinners(pool, 1, c.min_score).winners[0],
    deps,
  );
}
