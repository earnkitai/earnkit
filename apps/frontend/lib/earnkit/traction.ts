import { BASE_BONUS, indexedThrough } from './bonus-ledger';
import { blockscout, isWalletAddress, normalizeRepoUrl, scoreEntry } from './campaigns';
import type postgres from 'postgres';
import { sql } from './db';
import { testInstallationIds } from './installations';
import { GitHubError, gh } from './match-projects';
import { payoutAccount } from './payout';
import { safeProbe } from './safe-fetch';

/**
 * The builder bonus traction score (v2.5 §3). Every eligible entry of a round (eligibleSql: coin
 * launched, submission proof confirmed, the earliest entry of its repo) gets seven signals, read
 * at most once per entry per UTC day and cached in `bonus_scores`; the round is ranked from them:
 *
 *   score = 40·users + 20·live + 20·shipping + 10·interest + 10·holders
 *
 * where each signal is rank-normalized within the round (rankNormalize) and shipping combines
 * commit days and contributors 3:1. Market cap only breaks exact ties, then the earlier entry.
 * Trading volume is never an input: Signals has no field for it.
 */
export type Signals = {
  /** v2.4 real onchain users of the entry's verified contracts in the round window (scoreEntry). */
  users: number;
  /** Share of the daily live-link probes that loaded since the entry joined the round (≥ 7 days). */
  liveRatio: number;
  /** UTC days on which a daily read first saw new commits (built up day by day, never recomputed). */
  commitDays: number;
  /** Linked GitHub authors of those commits, 30+ days old when first seen, capped at CONTRIBUTORS_CAP. */
  contributors: number;
  /** Stars and forks in the window by distinct accounts 30+ days old, not the builder's, capped. */
  interest: number;
  /** Coin holders worth ≥ $1 at the explorer's price (no price: 0), not the builder, EarnKit or Clanker, capped. */
  holders: number;
  /** Tie-breaker only. */
  marketCapUsd: number;
};
export const SIGNAL_KEYS: readonly (keyof Signals)[] = [
  'users',
  'liveRatio',
  'commitDays',
  'contributors',
  'interest',
  'holders',
  'marketCapUsd',
];

export const INTEREST_CAP = 50;
export const HOLDERS_CAP = 200;
export const CONTRIBUTORS_CAP = 10;
/** The traction weights (global constraints); shipping is commit days 3 : contributors 1. */
export const WEIGHTS = { users: 40, live: 20, shipping: 20, interest: 10, holders: 10 } as const;
/** An account must be this old at the star, fork or first sight of its commit to count. */
export const ACCOUNT_MIN_AGE_MS = 30 * 86_400_000;
/** The live ratio's smallest denominator (a few lucky days aren't a record). */
export const LIVE_MIN_DAYS = 7;
/** A holder counts at this USD value (Blockscout exchange_rate); a coin without a price has 0 holders. */
export const HOLDER_MIN_USD = 1;
/** GitHub reads stop when the token has fewer requests left this hour (list_programs keeps headroom). */
export const GITHUB_MIN_REMAINING = 1000;
/** Entries read per scoring run, across all rounds (oldest read first): spreads the day's reads across hourly runs. */
export const ENTRIES_PER_RUN = 10;
/** Days in a row, each with exactly one new commit, that flag a scheduled-commit pattern for the review. */
export const SINGLE_COMMIT_STREAK = 7;
export const SINGLE_COMMIT_FLAG = 'single_commit_streak';
/** After a round's end, an entry whose final read still has failed sources counts done after this. */
export const FREEZE_ESCAPE_MS = 24 * 3_600_000;

// Read caps per entry per day (cost: GitHub's 5,000/h free token, Blockscout's public API).
export const COMMIT_PAGES = 3;
export const STAR_PAGES = 3;
export const FORK_PAGES = 2;
export const USER_LOOKUPS = 80;
export const HOLDER_PAGES = 5;

/**
 * Addresses that are never an entry's users, holders or contracts (lowercase): the Uniswap v4
 * PoolManager on Base (tokens.fun lib/chains/registry.ts) and Clanker v4's Base contracts
 * (clanker-sdk `CLANKERS.clanker_v4.related`, plus the older LP locker in BASE_BONUS): factory,
 * LP lockers, vault, airdrop, dev buy, MEV modules, FeeLocker, fee hooks and presale contracts.
 */
export const CLANKER_ADDRESSES: readonly string[] = [
  '0x498581ff718922c3f8e6a244956af099b2652b2b', // Uniswap v4 PoolManager
  '0xe85a59c628f7d27878aceb4bf3b35733630083a9', // Clanker v4 factory
  ...BASE_BONUS.lockers, // LP lockers
  '0x8e845ead15737bf71904a30bddd3aee76d6adf6c', // vault
  '0xf652b3610d75d81871bf96db50825d9af28391e0', // airdrop
  '0x1331f0788f9c08c8f38d52c7a1152250a9de00be', // dev buy
  '0xfdc013ce003980889cffd66b0c8329545ae1d1e8', // MEV module
  '0xebb25bb797d82cb78e1bc70406b13233c0854413', // MEV module v2
  BASE_BONUS.feeLocker,
  '0xdd5eeaff7bd481ad55db083062b13a3cdf0a68cc', // static fee hook
  '0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc', // static fee hook v2
  '0x34a45c6b61876d739400bd71228cbcbd4f53e8cc', // dynamic fee hook
  '0xd60d6b218116cfd801e28f78d011a203d2b068cc', // dynamic fee hook v2
  '0xeebbc567c3d612f50a67820f39cdd30dccf7e6b8', // presale
  '0x789c2452353eee400868e7d3e5add6be0ef4185d', // presale allowlist
].map((a) => a.toLowerCase());

const ZERO: Signals = { users: 0, liveRatio: 0, commitDays: 0, contributors: 0, interest: 0, holders: 0, marketCapUsd: 0 };

/**
 * Rank-based scores in [0, 1]: values ranked ascending 1..n (ties take their average rank), each
 * scored rank/n, so the best gets 1; a value of 0 (or less) always gets 0. Pure.
 */
export function rankNormalize(values: number[]): number[] {
  const n = values.length;
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(n).fill(0);
  for (let k = 0; k < n; ) {
    let j = k;
    while (j + 1 < n && order[j + 1].v === order[k].v) j++;
    const avg = (k + 1 + (j + 1)) / 2;
    for (let m = k; m <= j; m++) out[order[m].i] = order[m].v > 0 ? avg / n : 0;
    k = j + 1;
  }
  return out;
}

/**
 * Ranks a round's entries by traction score (best first): rank 1..n, no shared ranks. Ties on the
 * score (to 1e-6) break by market cap, then the earlier entry, then the lower id. Only the fields
 * of Signals are read; caps are applied here too. Pure.
 */
export function rankRound(
  entries: { id: number; submittedAt: Date }[],
  signals: Map<number, Signals>,
): { id: number; score: number; rank: number }[] {
  const s = entries.map((e) => signals.get(e.id) ?? ZERO);
  const col = (f: (x: Signals) => number) => rankNormalize(s.map((x) => Math.max(0, f(x) || 0)));
  const users = col((x) => x.users);
  const live = col((x) => x.liveRatio);
  const days = col((x) => x.commitDays);
  const people = col((x) => Math.min(x.contributors, CONTRIBUTORS_CAP));
  const interest = col((x) => Math.min(x.interest, INTEREST_CAP));
  const holders = col((x) => Math.min(x.holders, HOLDERS_CAP));
  const scored = entries.map((e, i) => {
    const raw =
      WEIGHTS.users * users[i] +
      WEIGHTS.live * live[i] +
      WEIGHTS.shipping * ((3 * days[i] + people[i]) / 4) +
      WEIGHTS.interest * interest[i] +
      WEIGHTS.holders * holders[i];
    return { id: e.id, at: e.submittedAt.getTime(), cap: s[i].marketCapUsd || 0, score: Math.round(raw * 1e6) / 1e6 };
  });
  scored.sort((a, b) => b.score - a.score || b.cap - a.cap || a.at - b.at || a.id - b.id);
  return scored.map((x, i) => ({ id: x.id, score: x.score, rank: i + 1 }));
}

/**
 * Task 4 carry: a round may freeze only once the deposit index has read past its end (so every
 * deposit made inside the round is booked to it). Pure.
 */
export const canFreeze = (endsAt: Date, indexed: { time: Date | null } | null) =>
  !!indexed?.time && indexed.time.getTime() > endsAt.getTime();

export type TractionEntry = {
  id: number;
  contracts: string[] | null;
  repo_url: string | null;
  live_url: string | null;
  coin_address: string | null;
  creator_wallet: string | null;
  payout_wallet: string | null;
  deployers: string[] | null;
  submitted_at: Date;
  /** The builder's GitHub login (the entering installation's github_user), when known. */
  builder_login?: string | null;
};
export type TractionRound = { key: string; starts: Date; ends: Date };

/** The signal groups, each read (and retried after a failure) as one. */
export type Group = 'users' | 'live' | 'github' | 'coin';
export const GROUPS: readonly Group[] = ['users', 'live', 'github', 'coin'];

/** GitHub reads stopped for this run: the token's hourly budget is nearly spent. */
export class GitHubBudgetLow extends Error {}

/**
 * The GitHub token's remaining requests this hour, as the last response said
 * (x-ratelimit-remaining). One per scoring run, shared by every entry.
 */
export class GitHubBudget {
  remaining: number | null = null;
  constructor(readonly min = GITHUB_MIN_REMAINING) {}
  note(remaining: string | number | null | undefined) {
    if (remaining === null || remaining === undefined || remaining === '') return;
    const n = Number(remaining);
    if (Number.isFinite(n)) this.remaining = n;
  }
  check() {
    if (this.remaining !== null && this.remaining < this.min)
      throw new GitHubBudgetLow(`GitHub budget low (${this.remaining} left); reads resume next run`);
  }
}

/** Where commit sightings and account ages are kept (DB by default; a memory one in tests). */
export type TractionStore = {
  /** Account creation times (ms) known for these logins (lowercase). */
  accounts(logins: string[]): Promise<Map<string, number>>;
  saveAccount(login: string, createdMs: number): Promise<void>;
  /** Of these SHAs, the ones not yet seen for this entry in this round. */
  unseen(roundKey: string, projectId: number, shas: string[]): Promise<Set<string>>;
  /** Records commits first seen in `day`'s read (kept as first seen: never overwritten). */
  record(roundKey: string, projectId: number, day: string, commits: { sha: string; login: string | null }[]): Promise<void>;
  /** Distinct first-seen days and distinct counted logins of the entry's commits in the round. */
  stats(roundKey: string, projectId: number): Promise<{ days: number; contributors: number }>;
  /** The longest run of consecutive days on each of which exactly one new commit was first seen. */
  singleCommitStreak(roundKey: string, projectId: number): Promise<number>;
};

export const dbStore: TractionStore = {
  accounts: async (logins) => {
    if (!logins.length) return new Map();
    const rows = await sql()<{ login: string; created_at: Date }[]>`
      SELECT login, created_at FROM github_users WHERE login IN ${sql()(logins)}`;
    return new Map(rows.map((r) => [r.login, r.created_at.getTime()]));
  },
  saveAccount: async (login, createdMs) => {
    await sql()`INSERT INTO github_users (login, created_at) VALUES (${login}, ${new Date(createdMs)})
      ON CONFLICT (login) DO NOTHING`;
  },
  unseen: async (roundKey, projectId, shas) => {
    if (!shas.length) return new Set();
    const rows = await sql()<{ sha: string }[]>`
      SELECT sha FROM bonus_commits WHERE round_key = ${roundKey} AND project_id = ${projectId} AND sha IN ${sql()(shas)}`;
    const seen = new Set(rows.map((r) => r.sha));
    return new Set(shas.filter((s) => !seen.has(s)));
  },
  record: async (roundKey, projectId, day, commits) => {
    if (!commits.length) return;
    await sql()`
      INSERT INTO bonus_commits ${sql()(commits.map((c) => ({ round_key: roundKey, project_id: projectId, sha: c.sha, day, login: c.login })))}
      ON CONFLICT (round_key, project_id, sha) DO NOTHING`;
  },
  stats: async (roundKey, projectId) => {
    const [r] = await sql()<{ days: number; contributors: number }[]>`
      SELECT count(DISTINCT day)::int AS days, count(DISTINCT login)::int AS contributors
      FROM bonus_commits WHERE round_key = ${roundKey} AND project_id = ${projectId}`;
    return r;
  },
  singleCommitStreak: async (roundKey, projectId) => {
    const [r] = await sql()<{ streak: number }[]>`
      WITH d AS (
        SELECT day FROM bonus_commits WHERE round_key = ${roundKey} AND project_id = ${projectId}
        GROUP BY day HAVING count(*) = 1),
      g AS (SELECT day - (row_number() OVER (ORDER BY day))::int AS grp FROM d)
      SELECT COALESCE(max(n), 0)::int AS streak FROM (SELECT count(*) AS n FROM g GROUP BY grp) x`;
    return r.streak;
  },
};

export type TractionDeps = {
  now?: Date;
  /** Epoch ms: no new entry starts reading after it (and scoreEntry stops at it). */
  deadline?: number;
  /** v2.4 onchain users (default scoreEntry); timedOut counts as a failed read. */
  users?: (contracts: string[], from: Date, to: Date, exclude: string[], deadline?: number) => Promise<{ score: number; timedOut: boolean }>;
  /** The live ratio (default: today's probe stored in live_checks, then the ratio from it). */
  live?: (entry: TractionEntry, from: Date, now: Date, probeToday: boolean) => Promise<number>;
  /** Whether a live link loads (default safeProbe; v2.10 item 14, Pre-flight P31: an error page counts as down). */
  probe?: (url: string) => Promise<boolean>;
  /** A GitHub API GET (default: the authenticated `gh`, noting x-ratelimit-remaining in `budget`). */
  github?: (path: string, accept: string | undefined, budget: GitHubBudget) => Promise<unknown>;
  /** The run's GitHub budget (scoreOpenRounds/scoreRound make one per run). */
  budget?: GitHubBudget;
  /** A Base Blockscout GET (default `blockscout`). */
  explorer?: (path: string) => Promise<unknown>;
  /** EarnKit's wallets never counted besides the Safe (default: resolveBonusWallet, once per run). */
  excluded?: string[];
  /** Commit sightings and account ages (default dbStore). */
  store?: TractionStore;
  /** Values kept for a group whose read fails (the last stored ones). */
  previous?: Signals;
  /** Only these groups are read; the rest come from `previous`. Default: all. */
  groups?: readonly Group[];
  /** Entries read per run (default ENTRIES_PER_RUN), when no shared `allowance` is given. */
  maxEntries?: number;
  /** The run's remaining entry reads, shared by every round of one scoreOpenRounds run. */
  allowance?: { left: number };
};

const lower = (a: string) => a.toLowerCase();
const day = (t: Date | string | number) => new Date(t).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

/**
 * The bonus wallet's address, resolved once per scoring run: EARNKIT_BONUS_WALLET when it is an
 * address, else derived from the payout key; [] (and logged) when neither works.
 */
export function resolveBonusWallet(env: Record<string, string | undefined> = process.env): string[] {
  const set = env.EARNKIT_BONUS_WALLET?.trim();
  if (set && isWalletAddress(set)) return [set.toLowerCase()];
  try {
    const a = payoutAccount(env)?.address;
    return a ? [a.toLowerCase()] : [];
  } catch (err) {
    console.error('[traction] bonus wallet unresolved; not excluded:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** The last UTC day of a round (a read after the end is booked to it). */
const lastDay = (round: TractionRound) => day(round.ends.getTime() - 1);

/**
 * The live ratio: probes the entry's live link for today (while the round runs) unless today
 * already loaded — a failed probe is retried on later runs that day, and the day becomes ok on any
 * success — then ok days / max(LIVE_MIN_DAYS, days since the entry joined the round).
 */
export async function liveRatio(
  entry: TractionEntry,
  from: Date,
  now: Date,
  probeToday: boolean,
  probe: (url: string) => Promise<boolean>,
) {
  if (!entry.live_url) return 0;
  const today = day(now);
  if (probeToday) {
    const [seen] = await sql()<{ ok: boolean }[]>`SELECT ok FROM live_checks WHERE project_id = ${entry.id} AND day = ${today}`;
    if (!seen?.ok) {
      const ok = await probe(entry.live_url).catch(() => false);
      await sql()`INSERT INTO live_checks (project_id, day, ok) VALUES (${entry.id}, ${today}, ${ok})
        ON CONFLICT (project_id, day) DO UPDATE SET ok = live_checks.ok OR EXCLUDED.ok`;
    }
  }
  const startDay = day(Math.max(from.getTime(), entry.submitted_at.getTime()));
  const days = Math.floor((Date.parse(today) - Date.parse(startDay)) / DAY_MS) + 1;
  if (days <= 0) return 0;
  const [r] = await sql()<{ ok: number }[]>`
    SELECT count(*)::int AS ok FROM live_checks
    WHERE project_id = ${entry.id} AND ok AND day >= ${startDay} AND day <= ${today}`;
  return Math.min(1, r.ok / Math.max(days, LIVE_MIN_DAYS));
}

type Commit = { sha: string; author: { login: string } | null };
type Star = { starred_at: string; user: { login: string } | null };
type Fork = { created_at: string; owner: { login: string } | null };
type Holders = { items: { address: { hash: string }; value: string }[]; next_page_params: Record<string, unknown> | null };
type TokenInfo = { circulating_market_cap?: string | null; exchange_rate?: string | null; total_supply?: string | null; decimals?: string | null };

const isBot = (login: string) => /\[bot\]$/i.test(login);
/** GitHub answers meaning "no activity to read" (missing, empty repo, legal block), not a failure. */
const NO_ACTIVITY = new Set([404, 409, 451]);

/**
 * Shipping and interest from GitHub. Commits: each read lists the window's commits and records the
 * SHAs it sees for the first time under `readDay` (today, or the round's last day after its end);
 * commit days are the distinct days new SHAs appeared, so backdated or bulk-pushed history counts
 * once, on the day it was seen. Contributors are linked logins 30+ days old at that read.
 */
async function githubSignals(
  entry: TractionEntry,
  round: TractionRound,
  to: Date,
  readDay: string,
  get: (path: string, accept?: string) => Promise<unknown>,
  store: TractionStore,
) {
  const repoUrl = entry.repo_url!;
  const m = /^github\.com\/([^/]+)\/([^/]+)$/.exec(normalizeRepoUrl(repoUrl));
  const stored = () => store.stats(round.key, entry.id);
  if (!m) return { commitDays: 0, contributors: 0, interest: 0 };
  /** A GET where a missing repo, an empty repo or a legal block reads as nothing. */
  const read = async <T,>(path: string, accept?: string): Promise<T | null> => {
    try {
      return (await get(path, accept)) as T;
    } catch (err) {
      if (err instanceof GitHubError && err.status !== undefined && NO_ACTIVITY.has(err.status)) return null;
      throw err;
    }
  };
  const base = `/repos/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`;
  const repo = await read<{ stargazers_count: number; owner: { login: string } }>(base);
  if (!repo) {
    const s = await stored();
    return { commitDays: s.days, contributors: Math.min(s.contributors, CONTRIBUTORS_CAP), interest: 0 };
  }
  const from = round.starts;
  const known = new Map<string, number>();
  let lookups = 0;
  /** An account's creation time (ms): this run, the stored table, else GitHub (bounded); null if unknown. */
  const createdAt = async (login: string): Promise<number | null> => {
    const l = lower(login);
    if (known.has(l)) return known.get(l)!;
    const cached = (await store.accounts([l])).get(l);
    if (cached !== undefined) {
      known.set(l, cached);
      return cached;
    }
    if (lookups++ >= USER_LOOKUPS) return null;
    const u = await read<{ created_at: string }>(`/users/${encodeURIComponent(login)}`);
    if (!u) return null;
    const ms = Date.parse(u.created_at);
    known.set(l, ms);
    await store.saveAccount(l, ms);
    return ms;
  };
  const oldEnough = async (login: string, at: number) => {
    const c = await createdAt(login);
    return c !== null && c <= at - ACCOUNT_MIN_AGE_MS;
  };

  // Commits: new SHAs only, recorded under this read's day.
  const listed = new Map<string, string | null>();
  for (let page = 1; page <= COMMIT_PAGES; page++) {
    const batch =
      (await read<Commit[]>(`${base}/commits?since=${from.toISOString()}&until=${to.toISOString()}&per_page=100&page=${page}`)) ?? [];
    for (const c of batch) {
      const login = c.author?.login ?? null;
      if (login && isBot(login)) continue;
      listed.set(c.sha, login);
    }
    if (batch.length < 100) break;
  }
  const fresh = await store.unseen(round.key, entry.id, [...listed.keys()]);
  const rows: { sha: string; login: string | null }[] = [];
  for (const sha of fresh) {
    const login = listed.get(sha) ?? null;
    rows.push({ sha, login: login && (await oldEnough(login, to.getTime())) ? lower(login) : null });
  }
  await store.record(round.key, entry.id, readDay, rows);
  const s = await stored();

  // Interest: stars (newest pages first) and forks in the window, one per account.
  const inWindow = (t: string) => {
    const ms = Date.parse(t);
    return ms >= from.getTime() && ms < to.getTime();
  };
  const builder = new Set([lower(repo.owner.login), ...(entry.builder_login ? [lower(entry.builder_login)] : [])]);
  const candidates = new Map<string, { login: string; at: number }>();
  const add = (login: string, at: string) => {
    const l = lower(login);
    if (!builder.has(l) && !isBot(l) && !candidates.has(l) && inWindow(at)) candidates.set(l, { login, at: Date.parse(at) });
  };
  const lastPage = Math.max(1, Math.ceil((repo.stargazers_count ?? 0) / 100));
  for (let page = lastPage, n = 0; page >= 1 && n < STAR_PAGES; page--, n++) {
    const batch = (await read<Star[]>(`${base}/stargazers?per_page=100&page=${page}`, 'application/vnd.github.star+json')) ?? [];
    for (const st of batch) if (st.user) add(st.user.login, st.starred_at);
    if (batch.length === 0 || Date.parse(batch[0].starred_at) < from.getTime()) break;
  }
  for (let page = 1; page <= FORK_PAGES; page++) {
    const batch = (await read<Fork[]>(`${base}/forks?sort=newest&per_page=100&page=${page}`)) ?? [];
    for (const f of batch) if (f.owner) add(f.owner.login, f.created_at);
    if (batch.length < 100 || Date.parse(batch[batch.length - 1].created_at) < from.getTime()) break;
  }
  let interest = 0;
  for (const c of candidates.values()) {
    if (interest >= INTEREST_CAP) break;
    if (await oldEnough(c.login, c.at)) interest++;
  }
  return { commitDays: s.days, contributors: Math.min(s.contributors, CONTRIBUTORS_CAP), interest };
}

/**
 * Holders and market cap from Blockscout. A holder counts with a balance worth ≥ HOLDER_MIN_USD at
 * the explorer's exchange_rate, never one in `never`. Without a price, holders is 0 (Ruling 15: a
 * supply share is cheap to fake with an airdrop) and the holder list isn't read.
 */
async function coinSignals(coin: string, never: Set<string>, get: (path: string) => Promise<unknown>) {
  const t = (await get(`/api/v2/tokens/${coin}`)) as TokenInfo;
  const decimals = Number(t.decimals ?? 18);
  const rate = Number(t.exchange_rate ?? 0) || 0;
  const supply = t.total_supply ? BigInt(t.total_supply) : null;
  const counts = (value: string) => {
    const v = BigInt(value || '0');
    return v > 0n && (Number(v) / 10 ** decimals) * rate >= HOLDER_MIN_USD;
  };
  let holders = 0;
  let query = '';
  for (let page = 0; rate > 0 && page < HOLDER_PAGES && holders < HOLDERS_CAP; page++) {
    const r = (await get(`/api/v2/tokens/${coin}/holders${query}`)) as Holders;
    for (const h of r.items ?? []) if (!never.has(lower(h.address.hash)) && counts(h.value)) holders++;
    if (!r.next_page_params) break;
    query = '?' + new URLSearchParams(Object.entries(r.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  let marketCapUsd = Number(t.circulating_market_cap ?? 0) || 0;
  if (!marketCapUsd && rate && supply) marketCapUsd = (Number(supply) / 10 ** decimals) * rate || 0;
  return { holders: Math.min(holders, HOLDERS_CAP), marketCapUsd };
}

/** The entry's contracts that can have users: never its coin or Clanker/Uniswap contracts. Pure. */
export const scorableContracts = (entry: Pick<TractionEntry, 'contracts' | 'coin_address'>) => {
  const never = new Set([...CLANKER_ADDRESSES, ...(entry.coin_address ? [lower(entry.coin_address)] : [])]);
  return (entry.contracts ?? []).filter((c) => !never.has(lower(c)));
};

/**
 * One entry's signals over the round window (its start to now, or to its end once it ended). Each
 * group is read independently: a group that throws (a GitHub budget stop included) keeps
 * `previous`'s values (else 0) and is listed in `failed`, so the caller retries just it. Missing
 * contracts, repo, live link or coin give 0 without a read.
 */
export async function signalsFor(
  entry: TractionEntry,
  round: TractionRound,
  deps: TractionDeps = {},
): Promise<{ signals: Signals; failed: Group[] }> {
  const now = deps.now ?? new Date();
  const ended = now >= round.ends;
  const to = ended ? round.ends : now;
  const from = round.starts;
  const out: Signals = { ...(deps.previous ?? ZERO) };
  const want = new Set(deps.groups ?? GROUPS);
  const failed: Group[] = [];
  const excluded = [BASE_BONUS.safe, ...(deps.excluded ?? resolveBonusWallet())].map(lower);
  const builderWallets = [entry.payout_wallet, entry.creator_wallet, ...(entry.deployers ?? [])].filter((w): w is string => !!w).map(lower);
  const run = async (g: Group, read: () => Promise<Partial<Signals>>) => {
    if (!want.has(g)) return;
    try {
      Object.assign(out, await read());
    } catch (err) {
      console.error(`[traction] ${g} of entry ${entry.id} failed; kept the last value:`, err instanceof Error ? err.message : err);
      failed.push(g);
    }
  };
  await run('users', async () => {
    const contracts = scorableContracts(entry);
    if (!contracts.length) return { users: 0 };
    const exclude = [...excluded, ...builderWallets];
    const r = deps.users
      ? await deps.users(contracts, from, to, exclude, deps.deadline)
      : await scoreEntry(contracts, from, to, { exclude, deadline: deps.deadline });
    if (r.timedOut) throw new Error('users read ran out of time');
    return { users: r.score };
  });
  await run('live', async () => {
    if (!entry.live_url) return { liveRatio: 0 };
    const at = ended ? new Date(round.ends.getTime() - 1) : now;
    if (deps.live) return { liveRatio: await deps.live(entry, from, at, !ended) };
    const probe = deps.probe ?? ((url: string) => safeProbe(url).then(() => true, () => false));
    return { liveRatio: await liveRatio(entry, from, at, !ended, probe) };
  });
  await run('github', async () => {
    if (!entry.repo_url) return { commitDays: 0, contributors: 0, interest: 0 };
    const budget = deps.budget ?? new GitHubBudget();
    const raw =
      deps.github ??
      ((p: string, a: string | undefined, b: GitHubBudget) =>
        gh(p, a, (res) => b.note(res.headers.get('x-ratelimit-remaining'))));
    const get = (p: string, a?: string) => {
      budget.check();
      return raw(p, a, budget);
    };
    return githubSignals(entry, round, to, ended ? lastDay(round) : day(now), get, deps.store ?? dbStore);
  });
  await run('coin', async () => {
    if (!entry.coin_address) return { holders: 0, marketCapUsd: 0 };
    const never = new Set([...excluded, ...CLANKER_ADDRESSES, ...builderWallets].map(lower));
    return coinSignals(lower(entry.coin_address), never, deps.explorer ?? ((p) => blockscout(p, deps.deadline)));
  });
  return { signals: out, failed };
}

/**
 * v2.8.1 §D (option B), T5 fix round 1: the entry `e` has a token for the round `roundKey` ending
 * `endsAt`: its own, launched before the end; or, with none of its own, its repo's one EarnKit
 * token (`token_repo_key` = its `bonus_repo_key`, from another program, launched before the end,
 * never an owner test installation's) that actually rolled a deposit into THIS round
 * (`bonus_ledger`, booked by bonus-ledger.ts rolloverRound). Tied to the ledger, so one token
 * competes in one round at a time (Ruling F6), whatever its home program does later. With no
 * round key (null), only an own token counts.
 */
export const coinSql = (e: 'p' | 'q', endsAt: Date | postgres.Fragment, roundKey: string | postgres.Fragment | null) => {
  const x = sql()(e);
  const own = sql()`(${x}.coin_address IS NOT NULL AND ${x}.coin_launched_at < ${endsAt})`;
  if (roundKey === null) return own;
  return sql()`(
    ${own}
    OR (${x}.coin_address IS NULL AND ${x}.bonus_repo_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects tk
      WHERE tk.token_repo_key = ${x}.bonus_repo_key AND tk.token_url IS NOT NULL
        AND tk.coin_address IS NOT NULL AND tk.coin_launched_at < ${endsAt}
        AND tk.program_id <> ${x}.program_id
        AND NOT COALESCE(tk.installation_id = ANY(${testInstallationIds()}::int[]), false)
        AND EXISTS (SELECT 1 FROM bonus_ledger l
          WHERE l.coin = tk.coin_address AND l.round_key = ${roundKey} AND l.destination = 'round'))))`;
};

/**
 * v2.8.1 §D: the token an entry is scored on: its own coin, else its repo's EarnKit token from
 * another program (coinSql says when that one counts). For `projects p`.
 */
export const scoredCoinSql = () => sql()`COALESCE(p.coin_address, (
  SELECT tk.coin_address FROM projects tk
  WHERE tk.token_repo_key = p.bonus_repo_key AND tk.token_url IS NOT NULL AND tk.coin_address IS NOT NULL
    AND tk.program_id <> p.program_id
  ORDER BY tk.id LIMIT 1))`;

/**
 * The builder bonus eligibility rule in SQL, for `projects p` in a round ending `endsAt`
 * (projects.ts bonusEligible is its pure twin): a coin launched and a submission that counts
 * (`submission_proof_ok_at`, on any v2.6 basis: page, unverified_page or confirmed; a v2.5 row
 * with it set and no basis counted on its page), both before the round's end (Ruling 16: frozen at the end), and no EARLIER entry of
 * the same normalized repo in the program that is eligible by the same rule (Rulings 13b, 15: an
 * ineligible earlier row, a squatter's or the builder's own failed attempt, never blocks).
 * v2.6 Ruling 6 (plan): never true for an owner test installation (EARNKIT_TEST_INSTALLATIONS),
 * for `p` or for the earlier entry `q` it would otherwise be blocked by.
 * v2.8 Rulings 2-3 (plan): the owner's rule, a launched token, is required here, in SQL; so are a
 * complete entry (`complete_at`, the v2.7 C7 gate moved from the launch, before the round's end)
 * and a confirmation never skipped (`confirm_choice` 'skip' is final, even if a token launches
 * later; NULL is an older agent's entry that never saw the step). Both for `p` and for the earlier
 * same-repo entry `q`.
 * v2.8.1 §D (option B): the token may also be the repo's one token carried from another program,
 * only in the round `roundKey` its fees rolled into (coinSql), so that entry can win them.
 * Task 7 picks winners with this (finalRanking), never from a stored rank. `endsAt` and `roundKey`
 * may be SQL fragments (a joined round's `r.ends_at`, `r.round_key`, alerts.ts); a null round key
 * counts only an entry's own token.
 */
export const eligibleSql = (endsAt: Date | postgres.Fragment, roundKey: string | postgres.Fragment | null) => {
  const testIds = testInstallationIds();
  return sql()`
  ${coinSql('p', endsAt, roundKey)}
  AND p.complete_at IS NOT NULL AND p.complete_at < ${endsAt}
  AND p.confirm_choice IS DISTINCT FROM 'skip'
  AND p.submission_proof_ok_at IS NOT NULL AND p.submission_proof_ok_at < ${endsAt}
  AND p.submitted_at < ${endsAt}
  AND NOT COALESCE(p.installation_id = ANY(${testIds}::int[]), false)
  AND NOT EXISTS (
    SELECT 1 FROM projects q
    WHERE q.program_id = p.program_id AND q.bonus_repo_key IS NOT NULL AND q.bonus_repo_key = p.bonus_repo_key
      AND ${coinSql('q', endsAt, roundKey)}
      AND q.complete_at IS NOT NULL AND q.complete_at < ${endsAt}
      AND q.confirm_choice IS DISTINCT FROM 'skip'
      AND q.submission_proof_ok_at IS NOT NULL AND q.submission_proof_ok_at < ${endsAt}
      AND NOT COALESCE(q.installation_id = ANY(${testIds}::int[]), false)
      AND (q.submitted_at, q.id) < (p.submitted_at, p.id))`;
};

/**
 * Ruling 15: a contract backs only one eligible entry per program, the earliest eligible one.
 * Given the program's eligible entries, each entry's scorable contracts without those an earlier
 * one already holds, and the contracts it lost. Pure.
 */
export function ownContracts(entries: Pick<TractionEntry, 'id' | 'contracts' | 'coin_address' | 'submitted_at'>[]) {
  const held = new Map<string, number>();
  const out = new Map<number, { contracts: string[]; dropped: { contract: string; heldBy: number }[] }>();
  const ordered = [...entries].sort((a, b) => a.submitted_at.getTime() - b.submitted_at.getTime() || a.id - b.id);
  for (const e of ordered) {
    const contracts: string[] = [];
    const dropped: { contract: string; heldBy: number }[] = [];
    for (const c of scorableContracts(e).map(lower)) {
      const by = held.get(c);
      if (by !== undefined && by !== e.id) dropped.push({ contract: c, heldBy: by });
      else {
        held.set(c, e.id);
        if (!contracts.includes(c)) contracts.push(c);
      }
    }
    out.set(e.id, { contracts, dropped });
  }
  return out;
}

type Cached = { day: string; signals: Signals; failed: Group[]; through: Date; computed_at: Date; review_flags: string[] };

/**
 * Scores one round now: for each eligible entry entered before the round's end, reads its signals
 * at most once per UTC day (a failed group is retried alone on the next run; a live link that
 * failed today's probe is re-probed), within the run's entry allowance, oldest read first. It
 * stores them in `bonus_scores`, ranks the round from each entry's latest signals and writes the
 * score and rank on those rows. After the round's end one final read covers the whole window
 * (`through` = ends_at); only its failed groups are ever read again. Returns the ranking.
 */
export async function scoreRound(roundKey: string, deps: TractionDeps = {}) {
  const now = deps.now ?? new Date();
  const [r] = await sql()<{ program_id: string; starts_at: Date; ends_at: Date }[]>`
    SELECT program_id, starts_at, ends_at FROM bonus_rounds WHERE round_key = ${roundKey}`;
  if (!r) return [];
  const round: TractionRound = { key: roundKey, starts: r.starts_at, ends: r.ends_at };
  const ended = now >= round.ends;
  const entries = await sql()<TractionEntry[]>`
    SELECT p.id, p.contracts, p.repo_url, p.live_url, ${scoredCoinSql()} AS coin_address, p.creator_wallet, p.payout_wallet, p.deployers,
      p.submitted_at, i.github_user AS builder_login
    FROM projects p LEFT JOIN installations i ON i.id = p.installation_id
    WHERE p.program_id = ${r.program_id} AND ${eligibleSql(round.ends, roundKey)}
    ORDER BY p.id`;
  const today = day(now);
  const latest = new Map<number, Cached>();
  const downToday = new Set<number>();
  if (entries.length) {
    const ids = entries.map((e) => e.id);
    const rows = await sql()<({ project_id: number } & Cached)[]>`
      SELECT DISTINCT ON (project_id) project_id, day::text, signals, failed, through, computed_at, review_flags
      FROM bonus_scores WHERE round_key = ${roundKey} AND project_id IN ${sql()(ids)}
      ORDER BY project_id, day DESC`;
    for (const x of rows) latest.set(x.project_id, x);
    if (!ended)
      for (const x of await sql()<{ project_id: number }[]>`
        SELECT project_id FROM live_checks WHERE project_id IN ${sql()(ids)} AND day = ${today} AND NOT ok`)
        downToday.add(x.project_id);
  }
  // What each entry needs this run: everything once a day (or once after the end), else only the
  // groups that failed, plus a re-probe of a live link that failed today.
  const plan = entries.map((e) => {
    const c = latest.get(e.id);
    const final = !!c && c.through.getTime() >= round.ends.getTime();
    const fresh = !!c && (final || (!ended && c.day === today));
    const groups = new Set<Group>(fresh ? c.failed : GROUPS);
    if (fresh && downToday.has(e.id) && e.live_url) groups.add('live');
    return { e, c, fresh, groups: [...groups] };
  });
  const heavy = (g: Group[]) => g.some((x) => x !== 'live');
  const todo = plan
    .filter((p) => p.groups.length > 0)
    .sort((a, b) => (a.c?.computed_at.getTime() ?? 0) - (b.c?.computed_at.getTime() ?? 0) || a.e.id - b.e.id);
  const budget = deps.budget ?? new GitHubBudget();
  const excluded = deps.excluded ?? resolveBonusWallet();
  const allowance = deps.allowance ?? { left: deps.maxEntries ?? ENTRIES_PER_RUN };
  const store = deps.store ?? dbStore;
  const own = ownContracts(entries);
  for (const { e, c, fresh, groups } of todo) {
    if (deps.deadline !== undefined && Date.now() >= deps.deadline) break;
    if (heavy(groups)) {
      if (allowance.left <= 0) continue;
      allowance.left--;
    }
    const mine = own.get(e.id)!;
    for (const x of mine.dropped)
      console.log(`[traction] entry ${e.id}: contract ${x.contract} already backs entry #${x.heldBy}; not counted here`);
    const { signals, failed } = await signalsFor({ ...e, contracts: mine.contracts }, round, {
      ...deps, now, budget, excluded, store, previous: c?.signals, groups,
    });
    // A partial retry keeps the window of the groups it didn't re-read.
    const through = fresh ? c!.through : ended ? round.ends : now;
    // For the review page (Ruling 15): a scheduled-commit pattern is shown, not scored.
    const review_flags = e.repo_url && (await store.singleCommitStreak(roundKey, e.id)) >= SINGLE_COMMIT_STREAK ? [SINGLE_COMMIT_FLAG] : [];
    const row = { day: fresh ? c!.day : today, signals, failed, through, computed_at: now, review_flags };
    await sql()`
      INSERT INTO bonus_scores (round_key, project_id, day, signals, failed, through, computed_at, review_flags)
      VALUES (${roundKey}, ${e.id}, ${row.day}, ${sql().json(signals)}, ${failed}, ${through}, ${now}, ${review_flags})
      ON CONFLICT (round_key, project_id, day) DO UPDATE
        SET signals = EXCLUDED.signals, failed = EXCLUDED.failed, through = EXCLUDED.through,
          computed_at = EXCLUDED.computed_at, review_flags = EXCLUDED.review_flags`;
    latest.set(e.id, row);
  }
  const scored = entries.filter((e) => latest.has(e.id));
  const ranking = rankRound(
    scored.map((e) => ({ id: e.id, submittedAt: e.submitted_at })),
    new Map(scored.map((e) => [e.id, latest.get(e.id)!.signals])),
  );
  for (const x of ranking)
    await sql()`UPDATE bonus_scores SET score = ${x.score}, rank = ${x.rank}
      WHERE round_key = ${roundKey} AND project_id = ${x.id} AND day = ${latest.get(x.id)!.day}`;
  return ranking;
}

/**
 * Traction scoring for the cron (Task 7 wires it; hourly is fine, reads stay once a day): every
 * 'open' round that has started, oldest end first, until `deadline`, sharing one GitHub budget,
 * one bonus wallet lookup and one per-run entry allowance. One round's failure never stops the
 * others; an ended round's failure is pushed to `needsOwner` once (Ruling 23). `only` limits the
 * run to these round keys (tests, like runCron's); `score` replaces scoreRound (tests).
 */
export async function scoreOpenRounds(
  deps: TractionDeps & {
    only?: string[];
    score?: (roundKey: string, deps: TractionDeps) => Promise<unknown[]>;
    /** Collects the ended rounds whose scoring failed, once per round (the cron's needs_owner). */
    needsOwner?: string[];
  } = {},
) {
  const now = deps.now ?? new Date();
  const budget = deps.budget ?? new GitHubBudget();
  const excluded = deps.excluded ?? resolveBonusWallet();
  const allowance = deps.allowance ?? { left: deps.maxEntries ?? ENTRIES_PER_RUN };
  const rounds = await sql()<{ round_key: string; ends_at: Date }[]>`
    SELECT round_key, ends_at FROM bonus_rounds WHERE state = 'open' AND starts_at <= ${now}
      ${deps.only ? sql()`AND round_key IN ${sql()(deps.only)}` : sql()``}
    ORDER BY ends_at, round_key`;
  const out: { round: string; ranked?: number; error?: string }[] = [];
  for (const { round_key, ends_at } of rounds) {
    if (deps.deadline !== undefined && Date.now() >= deps.deadline) break;
    try {
      out.push({ round: round_key, ranked: (await (deps.score ?? scoreRound)(round_key, { ...deps, now, budget, excluded, allowance })).length });
    } catch (err) {
      console.error('[traction]', round_key, err);
      out.push({ round: round_key, error: 'scoring failed; retried next run' });
      // Ruling 23: a round failing its final scoring after its end waits on the owner, once per
      // round (its entries' final reads may never land; the freeze escape then scores them 0).
      if (now >= ends_at && (await scoreErrorFirstTime(round_key, now))) deps.needsOwner?.push(round_key);
    }
  }
  return out;
}

/** Marks a round's final-scoring failure notified; true only the first time (Ruling 23). */
const scoreErrorFirstTime = async (roundKey: string, now: Date) =>
  (
    await sql()`
      UPDATE bonus_rounds SET score_error_notified_at = ${now}
      WHERE round_key = ${roundKey} AND score_error_notified_at IS NULL RETURNING round_key`
  ).length > 0;

/**
 * v2.6 Ruling 4 (plan): the review flag of an entry that counts on the builder's confirmation
 * because its program's entry page couldn't be fetched (projects.submission_basis). It goes into
 * the frozen row's flags for the owner's review page only, never into `terms.flagged`, so it never
 * holds a round for the owner or makes the cron answer 503 by itself.
 */
export const UNVERIFIED_PAGE_FLAG = 'unverified_page';

/** The review flag of an eligible entry frozen without any final read (Ruling 23: scored 0, last). */
export const NO_FINAL_READ_FLAG = 'no_final_read';

/**
 * Whether a round may freeze now (Task 7): the deposit index has read past its end (canFreeze),
 * and every eligible entry has a final read covering the whole window with no failed source.
 * Escape (Rulings 12, 23): FREEZE_ESCAPE_MS after the end, an entry whose final read still has
 * failed sources counts as done with its last values, and one with no final read at all counts
 * with score 0 (finalRanking ranks it last); both are listed in `flagged` (the review page shows
 * them; the cron puts the round in needs_owner once). `pending` lists the entries still holding it.
 */
export async function readyToFreeze(roundKey: string, now = new Date()) {
  const [r] = await sql()<{ program_id: string; ends_at: Date }[]>`
    SELECT program_id, ends_at FROM bonus_rounds WHERE round_key = ${roundKey}`;
  if (!r) return { ready: false, pending: [] as number[], flagged: [] as number[] };
  const rows = await sql()<{ id: number; failed: string[] | null }[]>`
    SELECT p.id, (
      SELECT s.failed FROM bonus_scores s
      WHERE s.round_key = ${roundKey} AND s.project_id = p.id AND s.through >= ${r.ends_at}
      ORDER BY s.day DESC LIMIT 1) AS failed
    FROM projects p
    WHERE p.program_id = ${r.program_id} AND ${eligibleSql(r.ends_at, roundKey)}
    ORDER BY p.id`;
  const escaped = now.getTime() > r.ends_at.getTime() + FREEZE_ESCAPE_MS;
  const pending: number[] = [];
  const flagged: number[] = [];
  for (const x of rows)
    if (x.failed === null || x.failed.length > 0) (escaped ? flagged : pending).push(x.id);
  const ready = pending.length === 0 && canFreeze(r.ends_at, await indexedThrough());
  return { ready, pending, flagged };
}

/**
 * The round's final ranking for the payout (Task 7), best first: only entries eligible at the
 * round's end (eligibleSql), each with its latest final read (`through` ≥ ends_at), re-ranked
 * from those signals with rankRound, so a stored rank of an entry displaced since (a duplicate
 * repo, a coin launched after the end) can never be read as a winner. `flagged` marks entries
 * whose final read still has failed sources (`failed`: which); `review_flags` carries the review
 * page's patterns, plus UNVERIFIED_PAGE_FLAG for an entry counted on an unverified page (Ruling 4
 * (plan): a review note, never `flagged`).
 * Ruling 23: an eligible entry with no final read (only possible past readyToFreeze's escape) is
 * ranked after every read entry, score 0, flagged NO_FINAL_READ_FLAG.
 */
export async function finalRanking(roundKey: string) {
  const [r] = await sql()<{ program_id: string; ends_at: Date }[]>`
    SELECT program_id, ends_at FROM bonus_rounds WHERE round_key = ${roundKey}`;
  if (!r) return [];
  const rows = await sql()<
    {
      id: number;
      submitted_at: Date;
      submission_basis: string | null;
      signals: Signals | null;
      failed: string[] | null;
      review_flags: string[] | null;
    }[]
  >`
    SELECT p.id, p.submitted_at, p.submission_basis, s.signals, s.failed, s.review_flags
    FROM projects p
    LEFT JOIN LATERAL (
      SELECT signals, failed, review_flags FROM bonus_scores b
      WHERE b.round_key = ${roundKey} AND b.project_id = p.id AND b.through >= ${r.ends_at}
      ORDER BY b.day DESC LIMIT 1) s ON true
    WHERE p.program_id = ${r.program_id} AND ${eligibleSql(r.ends_at, roundKey)}`;
  const read = rows.filter((x) => x.signals !== null);
  const unread = rows
    .filter((x) => x.signals === null)
    .sort((a, b) => a.submitted_at.getTime() - b.submitted_at.getTime() || a.id - b.id);
  const byId = new Map(read.map((x) => [x.id, x]));
  const basisFlags = (x: { submission_basis: string | null }) =>
    x.submission_basis === UNVERIFIED_PAGE_FLAG ? [UNVERIFIED_PAGE_FLAG] : [];
  const ranked = rankRound(
    read.map((x) => ({ id: x.id, submittedAt: x.submitted_at })),
    new Map(read.map((x) => [x.id, x.signals!])),
  ).map((x) => ({
    ...x,
    flagged: byId.get(x.id)!.failed!.length > 0,
    failed: byId.get(x.id)!.failed!,
    review_flags: [...(byId.get(x.id)!.review_flags ?? []), ...basisFlags(byId.get(x.id)!)],
  }));
  return [
    ...ranked,
    ...unread.map((x, i) => ({
      id: x.id,
      score: 0,
      rank: ranked.length + i + 1,
      flagged: true,
      failed: [] as string[],
      review_flags: [NO_FINAL_READ_FLAG, ...basisFlags(x)],
    })),
  ];
}
