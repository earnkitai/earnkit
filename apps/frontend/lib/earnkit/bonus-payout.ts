import { encodeFunctionData, formatUnits, type Hex } from 'viem';
import type { LocalAccount } from 'viem/accounts';
import { FEE_LOCKER_ABI, sendCall, worthIt, type BonusChain, type BonusDeps, type BonusRpc } from './bonus-ledger';
import { REVIEW_MS } from './campaigns';
import { sql } from './db';
import {
  PAY_FAILED,
  PAY_FAILED_RUNS,
  STEP_FAILED,
  TOP_UP,
  needsOwner,
  openStoredSends,
  payRanked,
  type PayoutStore,
  type RankedRow,
} from './payout';
import { finalRanking, readyToFreeze } from './traction';

/**
 * The builder bonus round lifecycle (v2.5 §3 Payout, Task 7). Each hourly cron run, for every
 * round that has ended:
 * 1. open → freeze: once readyToFreeze (the deposit index read past the end, every eligible entry
 *    has a final read; 24 h after the end, failed sources stop holding it and are flagged), the
 *    final ranking (traction.ts finalRanking: eligible at the end, re-ranked) is stored in
 *    bonus_payouts and the round's pool (its bookings) is split by place with splitPool over the
 *    payable entries (one per creator wallet and per installation, at most 10), frozen in `terms`.
 *    No payable entry: the round is 'empty' and its bookings become the Safe's (terminal).
 * 2. review: 48 h, top 10 public, the owner's veto per round (bonus_vetoes, Ruling 17). A veto moves
 *    the next entry up into the same frozen amounts: the split is made once, at review open.
 *    Flagged entries put the round in needs_owner (the cron answers 503) once (Ruling 18).
 * 3. paying: the bonus wallet's FeeLocker WETH is claimed first when the wallet holds less than the
 *    round still owes; still short, the round waits on the owner (TOP_UP, 503). Then one WETH
 *    transfer per place, to the entry's creator_wallet (Ruling 14), through payRanked: every v2.4
 *    payout rule (stored before broadcast, stale sends, sanctions, idempotency, nonce floor).
 * 4. paid: what no entry could take (a veto or refusal left a place empty) is booked to the Safe.
 * Deposits after the end are never the round's (bookDeposit: the round isn't open), so they go to
 * the Safe and the frozen amounts never change.
 */

/** The payout split by place (global constraints), in bps of the round pool. */
export const BONUS_SPLIT_BPS = [2500, 1800, 1400, 1100, 900, 700, 600, 400, 300, 300];
/** The places a round pays at most. */
export const BONUS_PLACES = BONUS_SPLIT_BPS.length;

/**
 * The pool split over `n` places (at most 10), renormalized over the places paid, rounding dust to
 * the first place: always sums exactly to the pool. Pure (the plan's code, verbatim).
 */
export function splitPool(pool: bigint, n: number): bigint[] {
  if (n <= 0 || pool <= 0n) return [];
  const bps = BONUS_SPLIT_BPS.slice(0, Math.min(n, 10));
  const total = BigInt(bps.reduce((a, b) => a + b, 0));
  const out = bps.map((b) => (pool * BigInt(b)) / total);
  out[0] += pool - out.reduce((a, b) => a + b, 0n); // rounding dust to first place
  return out;
}

/** What a round pays, frozen when its review opens (bonus_rounds.terms). */
export type BonusTerms = {
  token: string;
  symbol: 'WETH';
  decimals: 18;
  /** The round's booked pool at the freeze, wei. */
  pool_wei: string;
  /** Each place's amount, best first, wei (splitPool). */
  amounts: string[];
  /** Entries whose final read still had failed sources (the review page shows them; 503 in review). */
  flagged: number[];
};

/** One row of a round's frozen ranking and its payout (bonus_payouts), with its veto. */
export type BonusPayoutRow = {
  id: number;
  project_id: number;
  rank: number;
  score: number;
  wallet: string | null;
  installation_id: number | null;
  flags: string[];
  slot: number | null;
  amount_wei: string | null;
  status: 'sending' | 'paid' | 'refused' | null;
  tx_hash: string | null;
  raw_tx: string | null;
  stale_at: Date | null;
  reverts: number;
  paid_at: Date | null;
  vetoed: boolean;
  veto_reason: string | null;
};

const lower = (s: string) => s.toLowerCase();

/** Whether a row can still take a place: a wallet, not vetoed, not refused. Pure. */
const payable = (r: Pick<BonusPayoutRow, 'wallet' | 'vetoed' | 'status'>) => Boolean(r.wallet) && !r.vetoed && r.status !== 'refused';

/**
 * Who takes which frozen place, best first: rows with a transfer keep their stored place; the
 * other places go, in rank order, to payable rows (not vetoed or refused, with a wallet) whose
 * wallet and installation hold no place yet. The same rule payRanked pays by; the review page
 * shows it. Pure.
 */
export function placesFor(rows: BonusPayoutRow[], amounts: bigint[]) {
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  const out: { id: number; project_id: number; slot: number; amount: bigint }[] = [];
  const wallets = new Set<string>();
  const agents = new Set<number>();
  const take = (r: BonusPayoutRow, slot: number) => {
    out.push({ id: r.id, project_id: r.project_id, slot, amount: amounts[slot] });
    if (r.wallet) wallets.add(lower(r.wallet));
    if (r.installation_id !== null) agents.add(r.installation_id);
  };
  for (const r of byRank) if (r.tx_hash && r.slot !== null) take(r, r.slot);
  const free = amounts.map((_, i) => i).filter((i) => !out.some((o) => o.slot === i));
  for (const r of byRank) {
    if (free.length === 0) break;
    if (r.tx_hash || !payable(r) || wallets.has(lower(r.wallet!)) || (r.installation_id !== null && agents.has(r.installation_id))) continue;
    take(r, free.shift()!);
  }
  return out.sort((a, b) => a.slot - b.slot);
}

/** How many places a frozen ranking can fill: payable rows, one per wallet and per installation, at most 10. Pure. */
export const payablePlaces = (rows: BonusPayoutRow[]) =>
  placesFor(rows, Array.from({ length: BONUS_PLACES }, () => 0n)).length;

/** A round's frozen ranking with its vetoes, best first. */
export const roundRows = (roundKey: string) => sql()<BonusPayoutRow[]>`
  SELECT b.id, b.project_id, b.rank, b.score, b.wallet, b.installation_id, b.flags, b.slot,
    b.amount_wei::text AS amount_wei, b.status, b.tx_hash, b.raw_tx, b.stale_at, b.reverts, b.paid_at,
    (v.project_id IS NOT NULL) AS vetoed, v.reason AS veto_reason
  FROM bonus_payouts b LEFT JOIN bonus_vetoes v ON v.round_key = b.round_key AND v.project_id = b.project_id
  WHERE b.round_key = ${roundKey}
  ORDER BY b.rank`;

/**
 * The v2.4 PayoutStore over bonus_payouts: a transfer is stored with its place and that place's
 * frozen amount before it is broadcast; 'paid' once mined; a revert or a provably dead send clears
 * it (place included) for a new signature; a refusal frees the place for the next entry.
 */
export const bonusPayoutStore: PayoutStore = {
  sending: async (id, hash, raw, place) =>
    (
      await sql()`
        UPDATE bonus_payouts SET status = 'sending', tx_hash = ${hash}, raw_tx = ${raw}, stale_at = NULL,
          slot = ${place?.slot ?? null}, amount_wei = ${place?.amount ?? null}
        WHERE id = ${id} AND tx_hash IS NULL RETURNING id`
    ).length > 0,
  paid: async (id, amount) => {
    await sql()`
      UPDATE bonus_payouts SET status = 'paid', paid_at = now(), amount_wei = ${amount}, stale_at = NULL
      WHERE id = ${id}`;
  },
  failed: async (id, reverted) => {
    const [r] = await sql()<{ reverts: number }[]>`
      UPDATE bonus_payouts SET status = NULL, tx_hash = NULL, raw_tx = NULL, stale_at = NULL, slot = NULL,
        amount_wei = NULL, reverts = reverts + ${reverted ? 1 : 0}
      WHERE id = ${id} AND status = 'sending' RETURNING reverts`;
    return r?.reverts ?? 0;
  },
  refused: async (id) => {
    await sql()`UPDATE bonus_payouts SET status = 'refused' WHERE id = ${id} AND tx_hash IS NULL`;
  },
  stale: async (id, at) => {
    await sql()`
      UPDATE bonus_payouts SET stale_at = ${at === null ? null : sql()`COALESCE(stale_at, ${at})`}
      WHERE id = ${id} AND status = 'sending'`;
  },
};

/**
 * Freezes an ended round (readyToFreeze said so): under the round row's lock (bookDeposit takes
 * it too, so no deposit is booked to the round meanwhile), its pool is summed, its final ranking
 * stored, and either the 48 h review opens with the amounts frozen in `terms`, or, with no payable
 * entry, the round is 'empty' and its bookings move to the Safe. Only from 'open'.
 */
export async function freezeRound(roundKey: string, now: Date, a: { weth: string; flagged: number[] }) {
  const ranking = await finalRanking(roundKey);
  const info = ranking.length
    ? await sql()<{ id: number; creator_wallet: string | null; installation_id: number | null }[]>`
        SELECT id, creator_wallet, installation_id FROM projects WHERE id IN ${sql()(ranking.map((r) => r.id))}`
    : [];
  const byId = new Map(info.map((p) => [p.id, p]));
  const rows: BonusPayoutRow[] = ranking.map((r) => ({
    id: r.id,
    project_id: r.id,
    rank: r.rank,
    score: r.score,
    wallet: byId.get(r.id)?.creator_wallet ? lower(byId.get(r.id)!.creator_wallet!) : null,
    installation_id: byId.get(r.id)?.installation_id ?? null,
    flags: [...r.review_flags, ...r.failed.map((g) => `failed:${g}`)],
    slot: null,
    amount_wei: null,
    status: null,
    tx_hash: null,
    raw_tx: null,
    stale_at: null,
    reverts: 0,
    paid_at: null,
    vetoed: false,
    veto_reason: null,
  }));
  return sql().begin(async (tx) => {
    const [r] = await tx<{ state: string }[]>`SELECT state FROM bonus_rounds WHERE round_key = ${roundKey} FOR UPDATE`;
    if (r?.state !== 'open') return { state: r?.state ?? 'missing' };
    const [{ wei }] = await tx<{ wei: string }[]>`
      SELECT COALESCE(sum(amount_wei), 0)::text AS wei FROM bonus_ledger WHERE round_key = ${roundKey} AND destination = 'round'`;
    const pool = BigInt(wei);
    const amounts = splitPool(pool, payablePlaces(rows));
    const terms: BonusTerms = {
      token: lower(a.weth),
      symbol: 'WETH',
      decimals: 18,
      pool_wei: pool.toString(),
      amounts: amounts.map(String),
      flagged: a.flagged,
    };
    if (amounts.length === 0) {
      await tx`UPDATE bonus_ledger SET destination = 'safe' WHERE round_key = ${roundKey} AND destination = 'round'`;
      await tx`UPDATE bonus_rounds SET state = 'empty', frozen_at = ${now}, terms = ${tx.json(terms)} WHERE round_key = ${roundKey}`;
      return { state: 'empty' as const, pool_wei: terms.pool_wei };
    }
    await tx`
      INSERT INTO bonus_payouts ${tx(
        rows.map((x) => ({
          round_key: roundKey,
          project_id: x.project_id,
          rank: x.rank,
          score: x.score,
          wallet: x.wallet,
          installation_id: x.installation_id,
          flags: x.flags,
        })),
      )}
      ON CONFLICT (round_key, project_id) DO NOTHING`;
    await tx`
      UPDATE bonus_rounds SET state = 'review', frozen_at = ${now}, review_until = ${new Date(now.getTime() + REVIEW_MS)},
        terms = ${tx.json(terms)}
      WHERE round_key = ${roundKey}`;
    return { state: 'review' as const, pool_wei: terms.pool_wei, amounts: terms.amounts, flagged: a.flagged };
  });
}

/** The pay note while a stored send couldn't be rebroadcast this run (retried next run). */
export const STORED_SEND_WAIT = 'Waiting on a stored send of the payout wallet; nothing new was signed.';

/** A pay step that threw, with how many have failed in a row (bonus_rounds.pay_failures). */
class RoundPayFailed extends Error {
  readonly failures: number;
  constructor(failures: number, cause: unknown) {
    super('bonus pay step failed', { cause });
    this.failures = failures;
  }
}

type Deps = BonusDeps & {
  rpc: BonusRpc;
  chain: BonusChain;
  /** Whether a wallet is on the sanctions list (default: the v2.4 screen; fails closed). */
  listed?: (wallet: string) => Promise<boolean>;
  /** Only these round keys (tests and the e2e, like runCron's `only`). */
  only?: string[];
  /**
   * A stored send couldn't be rebroadcast this run (settleStoredSends failed): the pay step only
   * follows transfers in flight; no claim and nothing new is signed (fix round 1, a).
   */
  followOnly?: boolean;
  /** The freeze check (default traction.ts readyToFreeze); replaced in tests. */
  ready?: typeof readyToFreeze;
};

/** Freeze-side steps failing in a row after which the round waits on the owner (as PAY_FAILED_RUNS). */
export const FREEZE_FAILED_RUNS = PAY_FAILED_RUNS;

/**
 * Ruling 18: a round with flagged entries waits on the owner (503) once per round. Marks it
 * notified and returns true only the first time.
 */
const flaggedFirstTime = async (roundKey: string, now: Date) =>
  (
    await sql()`
      UPDATE bonus_rounds SET flagged_notified_at = ${now}
      WHERE round_key = ${roundKey} AND flagged_notified_at IS NULL RETURNING round_key`
  ).length > 0;

/**
 * Pays a round whose review has closed: switches it to 'paying' (the row lock a veto waits on, so a
 * veto either lands first or is refused), claims the bonus wallet's FeeLocker WETH when the wallet
 * holds less than the round still owes, then pays the frozen places. Done: the places no entry
 * could take go to the Safe and the round is 'paid'.
 */
async function payRound(roundKey: string, account: LocalAccount, d: Deps, now: Date) {
  const [run] = await sql()<{ terms: BonusTerms }[]>`
    UPDATE bonus_rounds SET state = 'paying'
    WHERE round_key = ${roundKey} AND (state = 'paying' OR (state = 'review' AND review_until <= ${now}))
    RETURNING terms`;
  if (!run) return { step: 'wait' };
  const t = run.terms;
  const amounts = t.amounts.map(BigInt);
  let r: { done: boolean; note: string | null };
  try {
    const rows = await roundRows(roundKey);
    // What the round still owes: every place not paid yet (one in flight still holds its WETH).
    const owed = amounts.reduce((s, x, i) => (rows.some((w) => w.slot === i && w.status === 'paid') ? s : s + x), 0n);
    let short: string | null = null;
    if (owed > 0n && !d.followOnly && Date.now() < (d.deadline ?? Infinity)) {
      let balance = await d.rpc.balanceOf(t.token as Hex, account.address);
      if (balance < owed) {
        // Carry to T7: claim before paying (the sweep may have drawn on claimed round WETH only as
        // far as roundsCovered allows; the rest of the round may still sit in the FeeLocker).
        // Only when the claim covers what is owed, or is itself worth 10x its gas (fix round 1, b).
        const available = await d.rpc.availableFees(account.address, t.token as Hex);
        if (available > 0n) {
          const data = encodeFunctionData({ abi: FEE_LOCKER_ABI, functionName: 'claim', args: [account.address, t.token as Hex] });
          const [gas, fees] = await Promise.all([
            d.rpc.estimateGas({ account: account.address, to: d.chain.feeLocker, data }),
            d.rpc.fees(),
          ]);
          if (balance + available >= owed || worthIt(available, gas, fees.maxFeePerGas)) {
            await sendCall(account, d.rpc, d.chain.feeLocker, data, gas, d.deadline ?? Infinity);
            balance = await d.rpc.balanceOf(t.token as Hex, account.address);
          }
        }
        if (balance < owed)
          short = `The payout wallet ${account.address} holds ${formatUnits(balance, t.decimals)} ${t.symbol}, less than builder bonus round ${roundKey} still owes (${formatUnits(owed, t.decimals)}). ${TOP_UP}`;
      }
    }
    const entries = rows
      .filter((w) => w.wallet)
      .map((w) => ({
        id: w.id,
        rank: w.rank,
        vetoed: w.vetoed,
        payout_wallet: w.wallet!,
        installation_id: w.installation_id,
        payout_status: w.status,
        prize_tx: w.tx_hash,
        prize_raw_tx: w.raw_tx,
        payout_stale_at: w.stale_at,
        payout_reverts: w.reverts,
        slot: w.slot,
      })) satisfies (RankedRow & { rank: number; vetoed: boolean })[];
    r = await payRanked(
      { token: t.token, symbol: t.symbol, decimals: t.decimals, amounts, perPlace: true, nothing: null },
      entries,
      // Best first; never a vetoed or refused entry (payRanked already skips taken wallets and installations).
      (pool) => pool.filter((e) => !e.vetoed && e.payout_status !== 'refused').sort((a, b) => a.rank - b.rank)[0],
      {
        account,
        rpc: d.rpc,
        store: bonusPayoutStore,
        openSends: () => openStoredSends(account),
        deadline: d.deadline,
        now,
        ...(d.listed && { listed: d.listed }),
        followOnly: short !== null || Boolean(d.followOnly),
      },
    );
    if (short) r = { done: false, note: [r.note, short].filter(Boolean).join(' ') };
    else if (d.followOnly && !r.done) r = { done: false, note: r.note ?? STORED_SEND_WAIT };
  } catch (err) {
    const [row] = await sql()<{ pay_failures: number }[]>`
      UPDATE bonus_rounds SET note = ${PAY_FAILED}, pay_failures = pay_failures + 1
      WHERE round_key = ${roundKey} RETURNING pay_failures`.catch(() => []);
    throw new RoundPayFailed(row?.pay_failures ?? 0, err);
  }
  if (!r.done) {
    await sql()`UPDATE bonus_rounds SET note = ${r.note}, pay_failures = 0 WHERE round_key = ${roundKey}`;
    return { step: 'pay', done: false, note: r.note };
  }
  // Paid: what no entry took (a veto or a refusal left a place empty) is the Safe's.
  const rest = await sql().begin(async (tx) => {
    const [{ paid }] = await tx<{ paid: string }[]>`
      SELECT COALESCE(sum(amount_wei), 0)::text AS paid FROM bonus_payouts WHERE round_key = ${roundKey} AND status = 'paid'`;
    const left = BigInt(t.pool_wei) - BigInt(paid);
    if (left > 0n)
      await tx`
        INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_time)
        VALUES (${`round-rest:${roundKey}`}, 0, NULL, ${roundKey}, 'safe', ${left.toString()}, ${now})
        ON CONFLICT DO NOTHING`;
    await tx`UPDATE bonus_rounds SET state = 'paid', note = ${r.note}, pay_failures = 0 WHERE round_key = ${roundKey}`;
    return left;
  });
  return { step: 'pay', done: true, note: r.note, to_safe: rest.toString() };
}

/**
 * The cron's rounds step (bonus-ledger.ts runBonusLedger runs it under its lease, after the claims
 * and before the sweep): one step for every ended round not yet paid or empty, oldest end first,
 * until the deadline. One round's failure never stops the others. `needs_owner` lists the rounds
 * waiting on the owner: a pay note that does (needsOwner), PAY_FAILED_RUNS failed pay steps or
 * FREEZE_FAILED_RUNS failed freeze steps in a row, or flagged entries (once per round, Ruling 18:
 * `flagged_notified_at`; the review page keeps showing them). `d.only` limits it to these round keys.
 */
export async function advanceRounds(account: LocalAccount, d: Deps) {
  const now = d.now ?? new Date();
  const rounds = await sql()<{ round_key: string; state: string; review_until: Date | null; terms: BonusTerms | null }[]>`
    SELECT round_key, state, review_until, terms FROM bonus_rounds
    WHERE ((state = 'open' AND ends_at <= ${now}) OR state IN ('review', 'paying'))
      ${d.only ? sql()`AND round_key IN ${sql()(d.only)}` : sql()``}
    ORDER BY ends_at, round_key`;
  const out: { round: string; step: string; [k: string]: unknown }[] = [];
  const needs_owner: string[] = [];
  for (const x of rounds) {
    if (Date.now() >= (d.deadline ?? Infinity)) break;
    try {
      if (x.state === 'open') {
        let f: Awaited<ReturnType<typeof readyToFreeze>>;
        let r: Awaited<ReturnType<typeof freezeRound>> | null = null;
        try {
          f = await (d.ready ?? readyToFreeze)(x.round_key, now);
          if (f.ready) r = await freezeRound(x.round_key, now, { weth: d.chain.weth, flagged: f.flagged });
        } catch (err) {
          // Fix round 1 (c): freeze-side failures in a row; FREEZE_FAILED_RUNS wait on the owner.
          const [c] = await sql()<{ freeze_failures: number }[]>`
            UPDATE bonus_rounds SET freeze_failures = freeze_failures + 1 WHERE round_key = ${x.round_key}
            RETURNING freeze_failures`.catch(() => []);
          console.error('[bonus] freeze', x.round_key, err);
          out.push({ round: x.round_key, step: 'error', note: STEP_FAILED, freeze_failures: c?.freeze_failures ?? 0 });
          if ((c?.freeze_failures ?? 0) >= FREEZE_FAILED_RUNS) needs_owner.push(x.round_key);
          continue;
        }
        await sql()`UPDATE bonus_rounds SET freeze_failures = 0 WHERE round_key = ${x.round_key} AND freeze_failures <> 0`;
        if (!r) {
          out.push({ round: x.round_key, step: 'freeze-wait', pending: f.pending });
          continue;
        }
        out.push({ round: x.round_key, step: r.state === 'review' || r.state === 'empty' ? r.state : 'busy', ...r });
        if (r.state === 'review' && f.flagged.length > 0 && (await flaggedFirstTime(x.round_key, now))) needs_owner.push(x.round_key);
        continue;
      }
      if (x.state === 'review' && x.review_until && now < x.review_until) {
        const flagged = x.terms?.flagged ?? [];
        out.push({ round: x.round_key, step: 'wait', flagged });
        if (flagged.length > 0 && (await flaggedFirstTime(x.round_key, now))) needs_owner.push(x.round_key);
        continue;
      }
      const r = await payRound(x.round_key, account, d, now);
      out.push({ round: x.round_key, ...r });
      if (needsOwner(r.note)) needs_owner.push(x.round_key);
    } catch (err) {
      console.error('[bonus] round', x.round_key, err instanceof RoundPayFailed ? err.cause : err);
      const failures = err instanceof RoundPayFailed ? err.failures : 0;
      out.push({ round: x.round_key, step: 'error', note: STEP_FAILED, ...(failures && { pay_failures: failures }) });
      if (failures >= PAY_FAILED_RUNS) needs_owner.push(x.round_key);
    }
  }
  return { rounds: out, needs_owner };
}
