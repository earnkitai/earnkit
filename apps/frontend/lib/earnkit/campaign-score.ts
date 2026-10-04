import { sql } from './db';
import {
  needsScore,
  scoreEntry,
  type InternalPage,
  type TxPage,
  type UserOp,
  type WalletKind,
} from './campaigns';

/** What scoring reads about an entry. */
export type ScoreRow = {
  id: number;
  contracts: string[];
  payout_wallet: string;
  deployers: string[] | null;
  score: number | null;
  scored_at: Date | null;
  scored_through: Date | null;
  score_final: boolean;
  /** When scoring last started on it: entries are taken oldest attempt first (never first). */
  score_attempted_at: Date | null;
};

type Scored = Awaited<ReturnType<typeof scoreEntry>>;
type StoreScore = (
  id: number,
  r: Scored,
  at: Date,
  through: Date | null,
  final: boolean,
) => Promise<void>;

/** Injection for tests and the e2e (the cron passes scoreOpts through). */
export type ScoreDeps = {
  score?: typeof scoreEntry;
  store?: StoreScore;
  fail?: (id: number, message: string) => Promise<void>;
  attempt?: (id: number, at: Date) => Promise<void>;
  scoreOpts?: {
    blockAt?: (at: Date) => Promise<bigint>;
    history?: (wallet: string, blockBefore: bigint) => Promise<WalletKind | null>;
    fetchPage?: (path: string) => Promise<TxPage>;
    fetchInternal?: (path: string) => Promise<InternalPage>;
    userOps?: (hash: string) => Promise<UserOp[]>;
    epNonce?: (entryPoint: string, sender: string, block: bigint) => Promise<bigint>;
  };
};

/**
 * Stores a score with its counted wallets (entry_wallets, replaced) in one transaction (v2.4 §3);
 * clears score_error. `through` null is a provisional score (a read cut short).
 */
export const storeScore: StoreScore = async (id, r, at, through, final) => {
  await sql().begin(async (tx) => {
    await tx`
      UPDATE projects SET score = ${r.score}, scored_at = ${at}, scored_through = ${through},
        score_partial = ${!r.complete}, score_error = NULL, code_share = ${r.codeShare},
        score_final = ${final}
      WHERE id = ${id}`;
    await tx`DELETE FROM entry_wallets WHERE project_id = ${id}`;
    if (r.counted.length > 0)
      await tx`INSERT INTO entry_wallets ${tx(
        r.counted.map((c) => ({ project_id: id, wallet: c.wallet, kind: c.kind })),
      )}`;
  });
};

const storeFailure = async (id: number, message: string) => {
  await sql()`UPDATE projects SET score_error = ${message.slice(0, 300)} WHERE id = ${id}`;
};

const storeAttempt = async (id: number, at: Date) => {
  await sql()`UPDATE projects SET score_attempted_at = ${at} WHERE id = ${id}`;
};

/**
 * Scores each entry that needs it, one at a time, until `deadline` (epoch ms). One entry's failure
 * is stored on it (score_error) and never stops the others (v2.4 §6). Running: the window ends at
 * min(now, ends_at) and a score is refreshed once older than maxAgeMs. `final`: after the end, the
 * whole window once per entry, marked score_final. A read cut short by the deadline is saved only
 * where there is no score yet (provisional), and the pass stops. Entries are taken oldest attempt
 * first (score_attempted_at, recorded as each starts), so one that ran out of time goes last next
 * pass and can't starve the others.
 */
export async function scoreCampaignEntries(
  program: { starts_at: Date; ends_at: Date },
  entries: ScoreRow[],
  a: { now: Date; deadline: number; final: boolean; maxAgeMs: number },
  deps: ScoreDeps = {},
) {
  const score = deps.score ?? scoreEntry;
  const store = deps.store ?? storeScore;
  const fail = deps.fail ?? storeFailure;
  const attempt = deps.attempt ?? storeAttempt;
  const tried = (e: ScoreRow) => e.score_attempted_at?.getTime() ?? 0;
  const ordered = [...entries].sort((x, y) => tried(x) - tried(y));
  const out: { id: number; result: 'scored' | 'final' | 'skipped' | 'failed' | 'timed_out'; error?: string }[] = [];
  for (const e of ordered) {
    const due = a.final
      ? !e.score_final
      : needsScore(e.scored_at, e.scored_through, program.ends_at, a.now, a.maxAgeMs);
    if (!due) {
      out.push({ id: e.id, result: 'skipped' });
      continue;
    }
    if (Date.now() >= a.deadline) {
      out.push({ id: e.id, result: 'timed_out' });
      continue;
    }
    const until = a.final
      ? program.ends_at
      : new Date(Math.min(a.now.getTime(), program.ends_at.getTime()));
    try {
      await attempt(e.id, a.now);
      const r = await score(e.contracts, program.starts_at, until, {
        ...deps.scoreOpts,
        deadline: a.deadline,
        exclude: [e.payout_wallet, ...(e.deployers ?? [])],
      });
      if (r.timedOut) {
        if (e.score === null) await store(e.id, r, a.now, null, false);
        out.push({ id: e.id, result: 'timed_out' });
        continue;
      }
      await store(e.id, r, a.now, until, a.final);
      out.push({ id: e.id, result: a.final ? 'final' : 'scored' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[score] entry ${e.id}:`, err);
      try {
        await fail(e.id, message);
      } catch (failErr) {
        console.error(`[score] entry ${e.id}: storing the failure failed:`, failErr);
      }
      out.push({ id: e.id, result: 'failed', error: message });
    }
  }
  return out;
}
