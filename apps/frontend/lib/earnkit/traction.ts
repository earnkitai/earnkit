import { BASE_BONUS, indexedThrough } from './bonus-ledger';
import { blockscout, normalizeRepoUrl, scoreEntry } from './campaigns';
import { sql } from './db';
import { GitHubError, gh } from './match-projects';
import { payoutAccount } from './payout';
import { safeProbe } from './safe-fetch';

/**
 * The builder bonus traction score (v2.5 §3). Every eligible entry of a round (coin launched and
 * submission proof confirmed) gets seven signals, read at most once per entry per UTC day and
 * cached in `bonus_scores`; the round is ranked from them:
 *
 *   score = 40·users + 20·live + 20·shipping + 10·interest + 10·holders
 *
 * where each signal is rank-normalized within the round (rankNormalize) and shipping combines
 * commit days and contributors 3:1. Market cap only breaks exact ties, then the earlier entry.
 * Trading volume is never an input: Signals has no field for it.
 */
export type Signals = {
  /** v2.4 real onchain users of the entry's contracts in the round window (scoreEntry). */
  users: number;
  /** Share of the daily live-link probes that loaded, since the entry joined the round. */
  liveRatio: number;
  /** Distinct UTC days with a commit in the window. */
  commitDays: number;
  /** Distinct commit authors in the window (bots excluded). */
  contributors: number;
  /** Stars plus forks in the window from accounts created 30+ days earlier, capped at INTEREST_CAP. */
  interest: number;
  /** Coin holders excluding the builder, EarnKit's wallets and pools, capped at HOLDERS_CAP. */
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
/** The traction weights (global constraints); shipping is commit days 3 : contributors 1. */
export const WEIGHTS = { users: 40, live: 20, shipping: 20, interest: 10, holders: 10 } as const;
/** An account must be this old at the star or fork to count as interest. */
export const ACCOUNT_MIN_AGE_MS = 30 * 86_400_000;

// Read caps per entry per day (cost: GitHub's 5,000/h free token, Blockscout's public API).
export const COMMIT_PAGES = 3;
export const STAR_PAGES = 3;
export const FORK_PAGES = 2;
export const USER_LOOKUPS = 80;
export const HOLDER_PAGES = 5;

/**
 * Addresses that hold a coin without being its users (lowercase): the Uniswap v4 PoolManager
 * (Clanker v4 pools' liquidity), the Clanker LP lockers and the FeeLocker.
 */
export const POOL_ADDRESSES = [
  '0x498581ff718922c3f8e6a244956af099b2652b2b',
  ...BASE_BONUS.lockers,
  BASE_BONUS.feeLocker,
];

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
  const people = col((x) => x.contributors);
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
};
export type TractionRound = { key: string; starts: Date; ends: Date };

/** The signal groups, each read (and retried after a failure) as one. */
export type Group = 'users' | 'live' | 'github' | 'coin';
export const GROUPS: readonly Group[] = ['users', 'live', 'github', 'coin'];

export type TractionDeps = {
  now?: Date;
  /** Epoch ms: no new entry starts reading after it (and scoreEntry stops at it). */
  deadline?: number;
  /** v2.4 onchain users (default scoreEntry); timedOut counts as a failed read. */
  users?: (contracts: string[], from: Date, to: Date, exclude: string[], deadline?: number) => Promise<{ score: number; timedOut: boolean }>;
  /** The live ratio (default: today's probe stored in live_checks, then the ratio from it). */
  live?: (entry: TractionEntry, from: Date, now: Date, probeToday: boolean) => Promise<number>;
  /** Whether a live link loads (default safeProbe). */
  probe?: (url: string) => Promise<boolean>;
  /** A GitHub API GET (default: the authenticated `gh`). */
  github?: (path: string, accept?: string) => Promise<unknown>;
  /** A Base Blockscout GET (default `blockscout`). */
  explorer?: (path: string) => Promise<unknown>;
  /** EarnKit's wallets never counted besides the Safe (default: the bonus wallet). */
  excluded?: string[];
  /** Values kept for a group whose read fails (the last stored ones). */
  previous?: Signals;
  /** Only these groups are read; the rest come from `previous`. Default: all. */
  groups?: readonly Group[];
};

const lower = (a: string) => a.toLowerCase();
const day = (t: Date | string | number) => new Date(t).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

function bonusWallet() {
  const bonus = payoutAccount()?.address;
  return bonus ? [bonus] : [];
}

/**
 * The live ratio: records today's probe of the entry's live link (once per UTC day, while the
 * round runs), then ok days / days since the entry joined the round (round start or submission,
 * whichever is later) through today or the round's last day.
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
    const [seen] = await sql()`SELECT 1 FROM live_checks WHERE project_id = ${entry.id} AND day = ${today}`;
    if (!seen) {
      const ok = await probe(entry.live_url).catch(() => false);
      await sql()`INSERT INTO live_checks (project_id, day, ok) VALUES (${entry.id}, ${today}, ${ok})
        ON CONFLICT (project_id, day) DO NOTHING`;
    }
  }
  const startDay = day(Math.max(from.getTime(), entry.submitted_at.getTime()));
  const days = Math.floor((Date.parse(today) - Date.parse(startDay)) / DAY_MS) + 1;
  if (days <= 0) return 0;
  const [r] = await sql()<{ ok: number }[]>`
    SELECT count(*)::int AS ok FROM live_checks
    WHERE project_id = ${entry.id} AND ok AND day >= ${startDay} AND day <= ${today}`;
  return Math.min(1, r.ok / days);
}

type Commit = { commit: { author: { date: string; email?: string | null } | null }; author: { login: string } | null };
type Star = { starred_at: string; user: { login: string } | null };
type Fork = { created_at: string; owner: { login: string } | null };
type Holders = { items: { address: { hash: string }; value: string }[]; next_page_params: Record<string, unknown> | null };
type TokenInfo = { circulating_market_cap?: string | null; exchange_rate?: string | null; total_supply?: string | null; decimals?: string | null };

const isBot = (login: string) => /\[bot\]$/i.test(login);

/** Commit days, contributors and interest from GitHub, inside [from, to). */
async function githubSignals(repoUrl: string, from: Date, to: Date, get: (path: string, accept?: string) => Promise<unknown>) {
  const m = /^github\.com\/([^/]+)\/([^/]+)$/.exec(normalizeRepoUrl(repoUrl));
  if (!m) return { commitDays: 0, contributors: 0, interest: 0 };
  const base = `/repos/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`;
  let repo: { stargazers_count: number; owner: { login: string } };
  try {
    repo = (await get(base)) as typeof repo;
  } catch (err) {
    // A deleted or private repo shows no activity (not a failed read to retry hourly).
    if (err instanceof GitHubError && err.status === 404) return { commitDays: 0, contributors: 0, interest: 0 };
    throw err;
  }
  const since = from.toISOString();
  const until = to.toISOString();
  const days = new Set<string>();
  const people = new Set<string>();
  for (let page = 1; page <= COMMIT_PAGES; page++) {
    const batch = (await get(`${base}/commits?since=${since}&until=${until}&per_page=100&page=${page}`)) as Commit[];
    for (const c of batch) {
      const who = c.author?.login ?? c.commit.author?.email ?? null;
      if (!who || isBot(who) || !c.commit.author?.date) continue;
      days.add(day(c.commit.author.date));
      people.add(lower(who));
    }
    if (batch.length < 100) break;
  }
  const inWindow = (t: string) => {
    const ms = Date.parse(t);
    return ms >= from.getTime() && ms < to.getTime();
  };
  const owner = lower(repo.owner.login);
  // Candidates newest first: stargazers are listed oldest first, so read from the last page back.
  const candidates: { login: string; at: string }[] = [];
  const lastPage = Math.max(1, Math.ceil((repo.stargazers_count ?? 0) / 100));
  for (let page = lastPage, read = 0; page >= 1 && read < STAR_PAGES; page--, read++) {
    const batch = (await get(`${base}/stargazers?per_page=100&page=${page}`, 'application/vnd.github.star+json')) as Star[];
    for (const s of batch) if (s.user && inWindow(s.starred_at)) candidates.push({ login: s.user.login, at: s.starred_at });
    if (batch.length === 0 || Date.parse(batch[0].starred_at) < from.getTime()) break;
  }
  for (let page = 1; page <= FORK_PAGES; page++) {
    const batch = (await get(`${base}/forks?sort=newest&per_page=100&page=${page}`)) as Fork[];
    for (const f of batch) if (f.owner && inWindow(f.created_at)) candidates.push({ login: f.owner.login, at: f.created_at });
    if (batch.length < 100 || Date.parse(batch[batch.length - 1].created_at) < from.getTime()) break;
  }
  const created = new Map<string, number>();
  let interest = 0;
  let lookups = 0;
  for (const c of candidates) {
    if (interest >= INTEREST_CAP) break;
    const login = lower(c.login);
    if (login === owner || isBot(login)) continue;
    let at = created.get(login);
    if (at === undefined) {
      if (lookups++ >= USER_LOOKUPS) break;
      const u = (await get(`/users/${encodeURIComponent(c.login)}`)) as { created_at: string };
      at = Date.parse(u.created_at);
      created.set(login, at);
    }
    if (at <= Date.parse(c.at) - ACCOUNT_MIN_AGE_MS) interest++;
  }
  return { commitDays: days.size, contributors: people.size, interest: Math.min(interest, INTEREST_CAP) };
}

/** Holders (excluding `never`, capped) and market cap from Blockscout. */
async function coinSignals(coin: string, never: Set<string>, get: (path: string) => Promise<unknown>) {
  let holders = 0;
  let query = '';
  for (let page = 0; page < HOLDER_PAGES && holders < HOLDERS_CAP; page++) {
    const r = (await get(`/api/v2/tokens/${coin}/holders${query}`)) as Holders;
    for (const h of r.items ?? []) if (!never.has(lower(h.address.hash)) && BigInt(h.value || '0') > 0n) holders++;
    if (!r.next_page_params) break;
    query = '?' + new URLSearchParams(Object.entries(r.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  const t = (await get(`/api/v2/tokens/${coin}`)) as TokenInfo;
  let marketCapUsd = Number(t.circulating_market_cap ?? 0) || 0;
  if (!marketCapUsd && t.exchange_rate && t.total_supply)
    marketCapUsd = (Number(t.exchange_rate) * Number(t.total_supply)) / 10 ** Number(t.decimals ?? 18) || 0;
  return { holders: Math.min(holders, HOLDERS_CAP), marketCapUsd };
}

/**
 * One entry's signals over the round window (its start to now, or to its end once it ended). Each
 * group is read independently: a group that throws keeps `previous`'s values (else 0) and is
 * listed in `failed`, so the caller retries just it. Missing contracts, repo, live link or coin
 * give 0 without a read.
 */
export async function signalsFor(
  entry: TractionEntry,
  round: TractionRound,
  deps: TractionDeps = {},
): Promise<{ signals: Signals; failed: Group[] }> {
  const now = deps.now ?? new Date();
  const to = now < round.ends ? now : round.ends;
  const from = round.starts;
  const prev = deps.previous ?? ZERO;
  const want = new Set(deps.groups ?? GROUPS);
  const out: Signals = { ...prev };
  const failed: Group[] = [];
  const excluded = [BASE_BONUS.safe, ...(deps.excluded ?? bonusWallet())].map(lower);
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
    if (!entry.contracts?.length) return { users: 0 };
    const exclude = [...excluded, ...(entry.payout_wallet ? [entry.payout_wallet] : []), ...(entry.creator_wallet ? [entry.creator_wallet] : []), ...(entry.deployers ?? [])];
    const r = deps.users
      ? await deps.users(entry.contracts, from, to, exclude, deps.deadline)
      : await scoreEntry(entry.contracts, from, to, { exclude, deadline: deps.deadline });
    if (r.timedOut) throw new Error('users read ran out of time');
    return { users: r.score };
  });
  await run('live', async () => {
    const probeToday = now < round.ends;
    if (deps.live) return { liveRatio: entry.live_url ? await deps.live(entry, from, now, probeToday) : 0 };
    const probe = deps.probe ?? ((url: string) => safeProbe(url).then(() => true, () => false));
    return { liveRatio: await liveRatio(entry, from, to.getTime() === round.ends.getTime() ? new Date(round.ends.getTime() - 1) : now, probeToday, probe) };
  });
  await run('github', async () => {
    if (!entry.repo_url) return { commitDays: 0, contributors: 0, interest: 0 };
    return githubSignals(entry.repo_url, from, to, deps.github ?? ((p, a) => gh(p, a)));
  });
  await run('coin', async () => {
    if (!entry.coin_address) return { holders: 0, marketCapUsd: 0 };
    const never = new Set([...excluded, ...POOL_ADDRESSES, ...(entry.creator_wallet ? [entry.creator_wallet] : []), ...(entry.payout_wallet ? [entry.payout_wallet] : [])].map(lower));
    return coinSignals(lower(entry.coin_address), never, deps.explorer ?? ((p) => blockscout(p, deps.deadline)));
  });
  return { signals: out, failed };
}

type Cached = { day: string; signals: Signals; failed: Group[]; through: Date };

/**
 * Scores one round now: for each eligible entry (coin launched, submission proof confirmed,
 * entered before the round's end), reads its signals at most once per UTC day (a group that failed
 * is retried alone on the next run), stores them in `bonus_scores`, then ranks the round from each
 * entry's latest stored signals and writes the score and rank on those rows. After the round's
 * end, one final read covers the whole window (`through` = ends_at) and is never read again.
 * Returns the ranking, best first.
 */
export async function scoreRound(roundKey: string, deps: TractionDeps = {}) {
  const now = deps.now ?? new Date();
  const [r] = await sql()<{ program_id: string; starts_at: Date; ends_at: Date }[]>`
    SELECT program_id, starts_at, ends_at FROM bonus_rounds WHERE round_key = ${roundKey}`;
  if (!r) return [];
  const round: TractionRound = { key: roundKey, starts: r.starts_at, ends: r.ends_at };
  const ended = now >= round.ends;
  const entries = await sql()<TractionEntry[]>`
    SELECT id, contracts, repo_url, live_url, coin_address, creator_wallet, payout_wallet, deployers, submitted_at
    FROM projects
    WHERE program_id = ${r.program_id} AND coin_address IS NOT NULL AND submission_proof_ok_at IS NOT NULL
      AND submitted_at < ${round.ends}
    ORDER BY id`;
  const today = day(now);
  const latest = new Map<number, Cached>();
  if (entries.length) {
    const rows = await sql()<{ project_id: number; day: string; signals: Signals; failed: Group[]; through: Date }[]>`
      SELECT DISTINCT ON (project_id) project_id, day::text, signals, failed, through
      FROM bonus_scores WHERE round_key = ${roundKey} AND project_id IN ${sql()(entries.map((e) => e.id))}
      ORDER BY project_id, day DESC`;
    for (const x of rows) latest.set(x.project_id, x);
  }
  for (const e of entries) {
    if (deps.deadline !== undefined && Date.now() >= deps.deadline) break;
    const c = latest.get(e.id);
    const final = !!c && c.through.getTime() >= round.ends.getTime();
    const fresh = !!c && (final || (!ended && c.day === today));
    const groups = fresh ? c.failed : GROUPS;
    if (groups.length === 0) continue;
    const { signals, failed } = await signalsFor(e, round, { ...deps, now, previous: c?.signals, groups });
    // A partial retry keeps the window of the groups it didn't re-read.
    const through = fresh ? c.through : ended ? round.ends : now;
    const row = { day: fresh ? c.day : today, signals, failed, through };
    await sql()`
      INSERT INTO bonus_scores (round_key, project_id, day, signals, failed, through, computed_at)
      VALUES (${roundKey}, ${e.id}, ${row.day}, ${sql().json(signals)}, ${failed}, ${through}, ${now})
      ON CONFLICT (round_key, project_id, day) DO UPDATE
        SET signals = EXCLUDED.signals, failed = EXCLUDED.failed, through = EXCLUDED.through, computed_at = EXCLUDED.computed_at`;
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
 * Daily traction scoring for the cron (Task 7 wires it): every 'open' round that has started,
 * oldest end first, until `deadline`. One round's failure never stops the others.
 */
export async function scoreOpenRounds(deps: TractionDeps = {}) {
  const now = deps.now ?? new Date();
  const rounds = await sql()<{ round_key: string }[]>`
    SELECT round_key FROM bonus_rounds WHERE state = 'open' AND starts_at <= ${now} ORDER BY ends_at, round_key`;
  const out: { round: string; ranked?: number; error?: string }[] = [];
  for (const { round_key } of rounds) {
    if (deps.deadline !== undefined && Date.now() >= deps.deadline) break;
    try {
      out.push({ round: round_key, ranked: (await scoreRound(round_key, { ...deps, now })).length });
    } catch (err) {
      console.error('[traction]', round_key, err);
      out.push({ round: round_key, error: 'scoring failed; retried next run' });
    }
  }
  return out;
}

/**
 * Whether a round may freeze now (Task 7): the deposit index has read past its end (canFreeze),
 * and every eligible entry's latest score covers the whole window.
 */
export async function readyToFreeze(roundKey: string) {
  const [r] = await sql()<{ ends_at: Date; pending: number }[]>`
    SELECT r.ends_at, (
      SELECT count(*)::int FROM projects p
      WHERE p.program_id = r.program_id AND p.coin_address IS NOT NULL AND p.submission_proof_ok_at IS NOT NULL
        AND p.submitted_at < r.ends_at
        AND NOT EXISTS (SELECT 1 FROM bonus_scores s WHERE s.round_key = r.round_key AND s.project_id = p.id
                          AND s.through >= r.ends_at AND s.failed = '{}')
    ) AS pending
    FROM bonus_rounds r WHERE r.round_key = ${roundKey}`;
  if (!r) return false;
  return r.pending === 0 && canFreeze(r.ends_at, await indexedThrough());
}
