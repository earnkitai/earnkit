import { RULES, countProject, moneyOf, ringWeights, type ActorFacts, type FarmCtx, type Touch } from './anti-farming';
import { holdReason, publicRow, scoreContext } from './builder-score'; // builder-score imports this file too: functions only, called after load
import { personCode } from './attribution';
import { EARNKIT_BUILDER_CODE } from './builder-code';
import { benchEnabled, builderScoreEnabled } from './builder-score-flag';
import { ScoreDeadline } from './campaigns';
import { isConfirmedProof } from './confirmed';
import { sql, type Db } from './db';
import { discoverPerson } from './discovery';
import { MAIN_PROOF_MIN_MS, confirmingFast, mainProjectOf, pickMainProject } from './main-project';
import { noteEvent } from './events';
import { REPOS_MAX, readGithubRepos, readPersonGithub, type PersonRepo } from './person-github';
import { BENCH_CHAINS, type BenchChain, type Standing } from './rank';
import { COIN_PROGRAM } from './policy-constants';
import { LIMITS, hit } from './rate-limit';
import { countingDeps, flushReadUsage } from './read-usage';
import { LIVE_CALIBRATION_V2, calibrationV2 } from './score-calibration';
import { FORMULA_V2, computeScoreV2, type Ship, type UseTouch, type V2Input, type V2Scored } from './score-v2';
import {
  defaultReaderDeps, isBudgetStop, isoWeek, readCoin, readContract, readContractOrigin, readNpm, readNpmBulk, readPypi, soft,
  type ContractSignals, type CoinSignals, type PackageSignals, type ReaderDeps, type RepoSignals, type SiteSignals, type Who,
} from './source-readers';
import { previousSignals, withPastCounts, withPastWeeks } from './sources';
import { CHAIN_IDS } from './tokens';
import { isoWeekOf, last52, mondayOf, streakOf, weeksShipping } from './weeks';

/**
 * v2.12.1 spec "Score" and "Scale": each person's live score (formula v2) from confirmed data only,
 * their projects (shown confirmed or not), their rank, the 25-project cap, the cron's `score` step
 * and the on-demand refresh (at most once every 10 minutes, inside find's 10-second answer).
 */
export const TRACKED_MAX = 25;
export const REFRESH_MS = 10 * 60_000;
/**
 * find answers within 10 s (spec 2): the refresh gets 8 s of it. A refresh cut off by it rescores from
 * what it read in time (or not at all); the rest waits for the next 10-minute window.
 */
export const REFRESH_BUDGET_MS = 8_000;
const QUIET_MS = 90 * 86_400_000;
const DAY_MS = 86_400_000;
/** pg_advisory_xact_lock namespace of a person's rescore (key 2: the person). */
const RESCORE_LOCK = 21_214;
const YEAR_MS = 365 * DAY_MS;
const WEEK_MS = 7 * DAY_MS;
/** v2.13: a launched coin's tokens.fun chain id (tokens.ts CHAIN_IDS), read back as a Bench chain. */
const CHAIN_OF_ID: Record<number, BenchChain> = { [CHAIN_IDS.base]: 'base', [CHAIN_IDS.robinhood]: 'robinhood' };
/** Refresh runs discovery for a person at most this often (unless a new clue queued them again). */
export const REFRESH_DISCOVER_MS = DAY_MS;

export type ProjectRow = {
  key: string; name: string; what: string | null; link: string | null; kind: 'app' | 'package' | 'contract' | 'coin' | 'code';
  confirmed: boolean; shipped: boolean; tracked: boolean; people: number; people_week: number; money_usd: number;
  has_coin: boolean; sends_tx: boolean; tagged: boolean; untracked_contract: string | null; last_active_at: Date | null;
  /** v2.13: the Bench chains it is on, its streak, weeks shipping in the last 52, and those weeks (plan B7). */
  chains: BenchChain[]; streak: number; weeks_shipping: number; ship_weeks: string[];
  /**
   * v2.13 Bench gate (T4 fix round 1, ruling): confirmed, and for a repo-shaped key (owner/repo) a
   * confirmed repo source on that very key. A coin or an entry naming a repo never proves it. Not stored.
   */
  bench_confirmed: boolean;
  /**
   * v2.12.1 T9: the distinct accounts of other people counted on a confirmed project (weight above 0
   * after every anti-farming rule; stars and forks aside), for "Done. 140 people who used it now
   * count." Not stored.
   */
  accounts?: number;
};

/** spec "Scale": the 25 most recently active projects; a tracked project keeps its place until it is quiet 90 days. Pure. */
export function trackedKeys(projects: Pick<ProjectRow, 'key' | 'last_active_at'>[], now: Date, prevTracked: ReadonlySet<string>): Set<string> {
  const active = (p: { last_active_at: Date | null }) => (p.last_active_at && Number.isFinite(p.last_active_at.getTime()) ? p.last_active_at.getTime() : 0);
  const keep = projects.filter((p) => prevTracked.has(p.key) && now.getTime() - active(p) <= QUIET_MS).sort((a, b) => active(b) - active(a));
  const out = new Set(keep.slice(0, TRACKED_MAX).map((p) => p.key));
  for (const p of [...projects].sort((a, b) => active(b) - active(a) || a.key.localeCompare(b.key))) {
    if (out.size >= TRACKED_MAX) break;
    out.add(p.key);
  }
  return out;
}

// ---- Readings to inputs ---------------------------------------------------------------------------

type Src = { id: number; kind: string; ref: string; project_key: string; proof: string | null; state: string; created_at: Date };
/** One good observation of a source: a daily reading (`at` = its day) or the refresh's live one (`at` = read time). */
type Obs = { at: Date; rank: number; signals: Record<string, unknown> };

const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const fin = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
const date = (s: unknown): Date | null => {
  const t = s instanceof Date ? s.getTime() : typeof s === 'string' ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? new Date(t) : null;
};
const newest = (...ds: (Date | null | undefined)[]): Date | null =>
  ds.reduce<Date | null>((m, d) => (d && Number.isFinite(d.getTime()) && (!m || d > m) ? d : m), null);
const WEEK = /^(\d{4})-W(\d{2})$/;
/** The last moment of an ISO week ('2026-W40'), never after `now`; null for a malformed week. Pure. */
export function weekEnd(week: string, now: Date): Date | null {
  const m = WEEK.exec(week);
  if (!m) return null;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const monday1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  const end = monday1 + (Number(m[2]) - 1) * WEEK_MS + WEEK_MS - 1;
  return new Date(Math.min(end, now.getTime()));
}
/** A project key: 'github.com/' dropped, lowercase (the grouping key). */
/** A repo-shaped project key ('owner/repo'). */
const REPO_SHAPE = /^[^/:\s]+\/[^/\s]+$/;
const lowKey = (k: string) => k.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').toLowerCase();
const hostOf = (k: string) => (URL.canParse(k) ? new URL(k).hostname : null);
const firstSentence = (s: string) => {
  const one = s.split(/(?<=[.!?])\s/)[0].trim();
  return one.length > 60 ? `${one.slice(0, 59).trimEnd()}…` : one;
};
const packagePage = (s: Src) =>
  s.kind === 'package_npm' ? `https://www.npmjs.com/package/${s.ref}` : `https://pypi.org/project/${s.ref.replace(/^pypi:/i, '')}/`;

/** A person's ring weights (anti-farming ringWeights), stored on builder_profiles.ring by the cron's score step. */
export type PersonRing = Pick<FarmCtx, 'ring' | 'ringOwner' | 'clusterCap'>;
/**
 * `checked`: accounts of other EarnKit people that touched the person's work when the cron computed
 * the ring from the full graph and found no ring between them (one-directional use: counts in full),
 * with the owners they had then; `checked_at`: that cron run. A refresh honours an entry only while
 * the account has the same owners and the check is under CHECKED_MAX_MS old.
 */
type StoredRing = {
  ring?: [string, number][]; ringOwner?: [string, number][]; clusterCap?: { actors: string[]; cap: number };
  checked?: [string, number[]][]; checked_at?: string;
};
export const CHECKED_MAX_MS = 36 * 3_600_000;
export type KnownRing = PersonRing & { checked: ReadonlyMap<string, number[]>; checkedAt: Date | null };
export const ringToJson = (r: PersonRing, checked: [string, number[]][] = [], at: Date | null = null): StoredRing => ({
  ring: [...r.ring], ringOwner: [...(r.ringOwner ?? [])],
  ...(r.clusterCap && { clusterCap: { actors: [...r.clusterCap.actors], cap: r.clusterCap.cap } }),
  checked, ...(at && { checked_at: at.toISOString() }),
});
const sameOwners = (a: readonly number[] | undefined, b: readonly number[]) =>
  a !== undefined && a.length === b.length && [...a].sort((x, y) => x - y).every((x, i) => x === [...b].sort((p, q) => p - q)[i]);
/**
 * The stored ring, or null when it was never computed ('{}': a new profile, or cleared by redaction)
 * or is malformed (fail strict: the caller then treats every other person's account as a partner).
 * Malformed entries inside a computed ring are dropped; every ring actor keeps its owner. Pure.
 */
export function storedRing(j: unknown): KnownRing | null {
  const o = (j && typeof j === 'object' && !Array.isArray(j) ? j : {}) as StoredRing;
  if (!Array.isArray(o.ring) || !Array.isArray(o.ringOwner)) return null;
  const pairs = (x: unknown) => list<unknown>(x).filter((e): e is [string, number] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number' && Number.isFinite(e[1]));
  const ringOwner = new Map(pairs(o.ringOwner));
  const ring = new Map(pairs(o.ring).filter(([a]) => ringOwner.has(a)));
  const cap = o.clusterCap;
  const clusterCap = cap && typeof cap.cap === 'number' && Number.isFinite(cap.cap)
    ? { actors: new Set(list<unknown>(cap.actors).filter((a): a is string => typeof a === 'string')), cap: cap.cap } : undefined;
  const checked = new Map(
    list<unknown>(o.checked)
      .filter((e): e is [string, number[]] => Array.isArray(e) && typeof e[0] === 'string' && Array.isArray(e[1]) && e[1].every((n) => Number.isInteger(n)))
      .map(([a, w]) => [a, [...w]] as [string, number[]]),
  );
  return { ring, ringOwner, checked, checkedAt: date(o.checked_at), ...(clusterCap && { clusterCap }) };
}

/**
 * Who owns these accounts ('gh:<login>', 'wallet:0x..'): proven logins, group wallets and proven
 * wallets, looked up for these ids only (never everyone's). An account two people claim maps to
 * all of them.
 */
async function ownersOf(actors: string[], db: Db = sql()): Promise<Map<string, number[]>> {
  const logins = [...new Set(actors.filter((a) => a.startsWith('gh:')).map((a) => a.slice(3)))];
  const wallets = [...new Set(actors.filter((a) => a.startsWith('wallet:')).map((a) => a.slice(7)))];
  const out = new Map<string, number[]>();
  if (logins.length === 0 && wallets.length === 0) return out;
  const rows = await db<{ actor: string; builder_id: number }[]>`
    SELECT 'gh:' || lower(github_login) AS actor, builder_id FROM builder_profiles WHERE lower(github_login) = ANY(${logins}::text[])
    UNION SELECT 'wallet:' || lower(w.wallet), COALESCE(i.builder_id, i.id) FROM installation_wallets w JOIN installations i ON i.id = w.installation_id
      WHERE lower(w.wallet) = ANY(${wallets}::text[])
    UNION SELECT 'wallet:' || lower(wallet), builder_id FROM person_wallets WHERE lower(wallet) = ANY(${wallets}::text[])`;
  for (const r of rows) out.set(r.actor, [...(out.get(r.actor) ?? []), r.builder_id]);
  return out;
}

type IdentityProject = { name?: unknown; what?: unknown; repo?: unknown; live_url?: unknown; package?: unknown; contracts?: unknown };

/**
 * The person's v2 inputs (confirmed data only) and their projects (everything they have, confirmed
 * or not, spec S1). Reads only this person's rows: `ring` is given by the cron's score step, else
 * read from builder_profiles.ring (stored by that step), so a refresh never scans everyone's edges.
 */
export async function personInputsV2(
  id: number, now: Date, personRing?: PersonRing, db: Db = sql(), o: { scope?: string | null } = {},
): Promise<{
  input: V2Input; projects: ProjectRow[]; perSource: Map<number, { users: number; money: number }>; ringComputed: boolean; checked: [string, number[]][];
  newPeople: Map<string, Record<string, number>>; shipWeeks: Map<string, string[]>; chains: Map<string, BenchChain[]>;
}> {
  const yearAgo = new Date(now.getTime() - YEAR_MS);
  const [profile] = await db<{ login: string | null; reported: string | null; identity: { projects?: unknown } | null; ring: unknown; base_code: string | null }[]>`
    SELECT lower(github_login) AS login, lower(reported_github) AS reported, identity, ring, base_builder_code AS base_code FROM builder_profiles WHERE builder_id = ${id}`;
  // v2.12.1 T9: a call is tagged when it carries this person's own code (ek_<person>, or their Base
  // code) or EarnKit's, and it is a call to this person's own tracked contract (only those are read).
  const ownCodes = new Set([EARNKIT_BUILDER_CODE, personCode(id), profile?.base_code].filter((c): c is string => typeof c === 'string' && c.length > 0));
  const members = (await db<{ id: number }[]>`SELECT id FROM installations WHERE COALESCE(builder_id, id) = ${id}`).map((m) => m.id);
  const group = members.length ? members : [-1];
  const sources = [...(await db<Src[]>`
    SELECT id::int AS id, kind, ref, project_key, proof, state, created_at FROM builder_sources
    WHERE builder_id = ${id} AND state <> 'rejected' AND kind <> 'merged_pr' ORDER BY id`)];
  const ids = sources.map((s) => s.id);
  const readings = ids.length === 0 ? [] : await db<{ source_id: number; day: string; at: Date; signals: unknown }[]>`
    SELECT source_id::int AS source_id, day::text AS day, at, signals FROM source_readings
    WHERE source_id IN ${db(ids)} AND ok AND day > ${yearAgo} ORDER BY day`;
  const lives = ids.length === 0 ? [] : await db<{ source_id: number; read_at: Date; signals: unknown }[]>`
    SELECT source_id::int AS source_id, read_at, signals FROM source_live WHERE source_id IN ${db(ids)} AND ok`;
  const hosted = await db<{ slug: string; repo_key: string; deployed_at: Date }[]>`
    SELECT slug, repo_key, deployed_at FROM hosted_sites WHERE installation_id IN ${db(group)} AND status = 'live' ORDER BY slug`;
  const deploys = await db<{ ref: string; repo_key: string; created_at: Date }[]>`
    SELECT chain || ':' || lower(address) AS ref, repo_key, created_at FROM contract_deploys
    WHERE installation_id IN ${db(group)} AND status = 'deployed' AND address IS NOT NULL ORDER BY id`;
  const coins = await db<{ name: string; coin: string; creator: string | null; repo_key: string | null; launched: Date }[]>`
    SELECT name, lower(coin_address) AS coin, lower(creator_wallet) AS creator, COALESCE(token_repo_key, repo_key) AS repo_key,
      COALESCE(coin_launched_at, submitted_at) AS launched
    FROM projects WHERE installation_id IN ${db(group)} AND coin_address IS NOT NULL ORDER BY id`;
  const creators = [...new Set(coins.map((x) => x.creator).filter((w): w is string => !!w))];
  const fees = creators.length === 0 ? [] : await db<{ wallet: string; usd: string }[]>`
    SELECT lower(wallet) AS wallet, usd::text AS usd FROM token_fees WHERE lower(wallet) IN ${db(creators)}`;
  const prizes = await db<{ repo_key: string | null; usd: string }[]>`
    SELECT COALESCE(p.repo_key, p.token_repo_key) AS repo_key, o.prize_usd::text AS usd
    FROM entry_outcomes o JOIN projects p ON p.id = o.project_id
    WHERE p.installation_id IN ${db(group)} AND o.basis = 'announcement' AND o.result IN ('won', 'placed', 'finalist') AND o.prize_usd > 0`;
  const events = await db<{ at: Date; repo_key: string | null }[]>`
    SELECT at, lower(repo_key) AS repo_key FROM builder_events
    WHERE installation_id IN ${db(group)} AND type IN ('built', 'deployed', 'hosted') AND at > ${yearAgo}`;
  // v2.13: chains from program entries and launched coins (any chain; coin_address is Base only).
  // Flag off: neither query runs (production as it is).
  const bench = benchEnabled();
  const entries = !bench ? [] : await db<{ repo_key: string | null; chains: string[] | null }[]>`
    SELECT COALESCE(p.repo_key, p.token_repo_key) AS repo_key, g.chains FROM projects p JOIN programs g ON g.id = p.program_id
    WHERE p.installation_id IN ${db(group)} AND p.program_id <> ${COIN_PROGRAM} AND p.vetoed_at IS NULL`;
  const launched = !bench ? [] : await db<{ repo_key: string | null; chain_id: number | null; coin: string | null }[]>`
    SELECT COALESCE(token_repo_key, repo_key) AS repo_key, coin_chain_id AS chain_id, lower(coin_address) AS coin
    FROM projects WHERE installation_id IN ${db(group)} AND token_status = 'launched'`;
  const wallets = await db<{ wallet: string }[]>`
    SELECT wallet FROM person_wallets WHERE builder_id = ${id}
    UNION SELECT lower(w.wallet) FROM installation_wallets w WHERE w.installation_id IN ${db(group)}`;

  // Keys: a source's own project_key wins (builder_projects matches it exactly, sources.ts dueSources).
  const canon = new Map<string, string>();
  for (const s of sources) if (!canon.has(lowKey(s.project_key))) canon.set(lowKey(s.project_key), s.project_key);
  const keyOf = (k: string) => canon.get(lowKey(k)) ?? lowKey(k);
  const keys = [...new Set([
    ...sources.map((s) => s.project_key),
    ...hosted.map((h) => keyOf(h.repo_key)),
    ...deploys.map((x) => keyOf(x.repo_key)),
    ...coins.map((x) => (x.repo_key ? keyOf(x.repo_key) : `coin:${x.coin}`)),
  ])];

  // Observations per source: the newest good one (the refresh's live read only when newer than the daily one), and all of them.
  const obs = new Map<number, Obs[]>();
  const push = (sid: number, o: Obs) => obs.set(sid, [...(obs.get(sid) ?? []), o]);
  for (const r of readings) {
    const dayAt = new Date(`${r.day}T00:00:00Z`);
    if (!r.signals || typeof r.signals !== 'object' || !Number.isFinite(dayAt.getTime())) continue;
    // A reading's own time, or the end of its day when it was stored later (a backfill, a test).
    const rank = Math.min(r.at instanceof Date ? r.at.getTime() : Infinity, dayAt.getTime() + DAY_MS);
    push(r.source_id, { at: dayAt, rank, signals: r.signals as Record<string, unknown> });
  }
  for (const l of lives) if (l.signals && typeof l.signals === 'object') push(l.source_id, { at: l.read_at, rank: l.read_at.getTime(), signals: l.signals as Record<string, unknown> });
  const latest = (sid: number): Obs | null => (obs.get(sid) ?? []).reduce<Obs | null>((m, o) => (!m || o.rank > m.rank ? o : m), null);
  const oldest = (sid: number): Obs | null => (obs.get(sid) ?? []).reduce<Obs | null>((m, o) => (!m || o.rank < m.rank ? o : m), null);
  /** A site's first observation up (`last`: its newest, which is up). */
  const firstUp = (sid: number, last: Date) =>
    (obs.get(sid) ?? []).filter((o) => (o.signals as Partial<SiteSignals>).up === true).reduce((m, o) => (o.at < m ? o.at : m), last);

  const identity = list<IdentityProject>(profile?.identity?.projects);
  const named = (key: string) => {
    const k = lowKey(key);
    return identity.find((p) => [p.repo, p.live_url, p.package, ...list<unknown>(p.contracts)].some((v) => typeof v === 'string' && lowKey(v) === k));
  };

  // Self: every wallet of the person's group, their proven wallets, their proven and reported logins.
  const self = new Set<string>();
  for (const l of [profile?.login, profile?.reported]) if (l) self.add(`gh:${l}`);
  for (const w of wallets) self.add(`wallet:${w.wallet.toLowerCase()}`);
  const confirmedSrc = (s: Src) => s.state === 'verified' && isConfirmedProof(s.proof);
  // The ring. The cron gives it, computed from the full graph (spec: only rings are discounted;
  // builders using each other's work otherwise count in full), and records the other people's
  // accounts it checked. A refresh reads the stored one (null: never computed or malformed) and,
  // fail strict, weighs any other EarnKit person's account the cron has not checked as a partner's
  // (0.5, once per project) until the next cron run.
  const given = personRing !== undefined;
  const stored: KnownRing | null = given ? { ...personRing, checked: new Map(), checkedAt: null } : storedRing(profile?.ring);
  const checkFresh = stored?.checkedAt != null && now.getTime() - stored.checkedAt.getTime() < CHECKED_MAX_MS;
  const ring = { ring: new Map(stored?.ring ?? []), ringOwner: new Map(stored?.ringOwner ?? []), ...(stored?.clusterCap && { clusterCap: stored.clusterCap }) };
  const touchedBy = new Set<string>();
  for (const s of sources)
    if (confirmedSrc(s))
      for (const o of obs.get(s.id) ?? [])
        for (const f of ['stargazers', 'forkers', 'callers', 'traders'])
          for (const w of list<Who>(o.signals[f])) if (typeof w?.id === 'string') touchedBy.add(w.id.toLowerCase());
  const checked: [string, number[]][] = [];
  // Other EarnKit people's accounts that touched this person's work (the ring is about them only).
  let others = 0;
  for (const [actor, who] of await ownersOf([...touchedBy], db)) {
    if (who.includes(id)) {
      self.add(actor);
      continue;
    }
    others++;
    if (ring.ringOwner.has(actor)) continue;
    if (given) checked.push([actor, [...who].sort((x, y) => x - y)]);
    // Honoured only while it still has the owners the cron saw, and the check is fresh.
    else if (!(checkFresh && sameOwners(stored?.checked.get(actor), who))) {
      ring.ring.set(actor, RULES.ringWeight);
      ring.ringOwner.set(actor, Math.min(...who));
    }
  }
  const cal = calibrationV2();

  const input: V2Input = { ships: [], touches: [], packages: [], earned: [], weeks: [] };
  const perSource = new Map<number, { users: number; money: number }>();
  const rows: (Omit<ProjectRow, 'tracked' | 'people' | 'money_usd'> & { scored: boolean })[] = [];
  // v2.13 (scope): only the one project's work feeds the score; every project's row is still built.
  const scopeLow = o.scope ? lowKey(o.scope) : null;
  const addWeek = (at: Date | null, inScope = true) => {
    if (!inScope || !at || !Number.isFinite(at.getTime()) || now.getTime() - at.getTime() > YEAR_MS) return;
    input.weeks.push({ week: isoWeek(at), at });
  };
  const usedCreator = new Set<string>();
  const peopleWeek = new Map<string, number>();
  const newPeople = new Map<string, Record<string, number>>();
  const shipWeeks = new Map<string, string[]>();
  const chainsOf = new Map<string, BenchChain[]>();
  const last53 = new Set([...last52(now), isoWeekOf(new Date(now.getTime() - 52 * WEEK_MS))]);
  const weekOf = (at: Date | null | undefined) => (at && Number.isFinite(at.getTime()) ? isoWeekOf(at) : null);

  for (const key of keys) {
    const low = lowKey(key);
    const inScope = !scopeLow || scopeLow === low;
    const ship = new Set<string>();
    const shipAt = (at: Date | null | undefined) => {
      const w = weekOf(at);
      if (w) ship.add(w);
    };
    const chains = new Set<BenchChain>();
    const srcs = sources.filter((s) => lowKey(s.project_key) === low);
    const hostedHere = hosted.filter((h) => lowKey(h.repo_key) === low);
    const deploysHere = deploys.filter((x) => lowKey(x.repo_key) === low);
    const coinsHere = coins.filter((x) => (x.repo_key ? lowKey(x.repo_key) === low : `coin:${x.coin}` === key));
    const confirmedRepo = srcs.some((s) => s.kind === 'repo' && confirmedSrc(s));
    const confirmed = srcs.some(confirmedSrc) || hostedHere.length > 0 || deploysHere.length > 0 || coinsHere.length > 0;
    const touches: Touch[] = [];
    const kinds = new Map<Touch, UseTouch['kind']>();
    const facts = new Map<string, ActorFacts>();
    const projSelf = new Set(self);
    const firstSource = new Map<string, { sid: number; at: number }>();
    const rawVolume = new Map<number, number>();
    const add = (sid: number, kind: Touch['kind'], use: UseTouch['kind'], w: Who | undefined, money = 0) => {
      const at = date(w?.at);
      if (typeof w?.id !== 'string' || !at) return;
      const actor = w.id.toLowerCase();
      const t: Touch = { project: key, actor, kind, at, volume_usd: fin(money) };
      touches.push(t);
      kinds.set(t, use);
      if (w.created_at !== undefined) facts.set(actor, { ...facts.get(actor), created_at: w.created_at ? date(w.created_at) : null });
      const f = firstSource.get(actor);
      if (!f || at.getTime() < f.at) firstSource.set(actor, { sid, at: at.getTime() });
      rawVolume.set(sid, (rawVolume.get(sid) ?? 0) + fin(money));
    };

    let shipped = hostedHere.length > 0 || deploysHere.length > 0 || coinsHere.length > 0;
    let liveSite: string | null = null;
    let pkgLink: string | null = null;
    let description: string | null = null;
    let ghName: string | null = null;
    let lastActive: Date | null = newest(
      ...hostedHere.map((h) => h.deployed_at), ...deploysHere.map((x) => x.created_at), ...coinsHere.map((x) => x.launched),
    );
    let untracked: string | null = null;
    let hasSite = false;
    let hasContract = deploysHere.length > 0;
    let hasPackage = false;
    let hasCoinSource = false;
    const ships: Ship[] = [];
    for (const h of hostedHere) ships.push({ key, at: h.deployed_at, alive_at: now });
    for (const x of deploysHere) ships.push({ key, at: x.created_at, alive_at: null });
    for (const x of coinsHere) ships.push({ key, at: x.launched, alive_at: null });

    for (const s of srcs) {
      const scored = confirmedSrc(s);
      const last = latest(s.id);
      if (s.kind === 'repo') {
        const g = (last?.signals ?? {}) as Partial<RepoSignals & PersonRepo>;
        if (typeof g.description === 'string' && g.description.trim()) description ??= g.description.trim();
        // v2.12.2: GitHub's own casing for the name ("Hello-World"), when the reading has it.
        if (typeof g.name === 'string' && g.name && lowKey(s.ref) === low) ghName ??= g.name;
        lastActive = newest(lastActive, date(g.pushed_at));
        if (!scored || !last) continue;
        // Members of their own org never count: every contributor of an org repo is self.
        if (g.owner_type === 'Organization') for (const w of list<Who>(g.contributors)) if (typeof w?.id === 'string') projSelf.add(w.id.toLowerCase());
        for (const w of list<Who>(g.stargazers)) add(s.id, 'stargazer', 'star', w);
        for (const w of list<Who>(g.forkers)) add(s.id, 'forker', 'fork', w);
        for (const wk of list<unknown>(g.commit_weeks))
          if (typeof wk === 'string') {
            addWeek(weekEnd(wk, now), inScope);
            if (WEEK.test(wk)) ship.add(wk);
          }
      } else if (s.kind === 'site') {
        hasSite = true;
        const up = last && (last.signals as Partial<SiteSignals>).up === true;
        if (up) {
          shipped = true;
          liveSite ??= s.ref;
          lastActive = newest(lastActive, last.at);
          // A site is a ship only on a project with a confirmed repo (spec: "Repos with a live homepage").
          if (scored && confirmedRepo) {
            ships.push({ key, at: firstUp(s.id, last.at), alive_at: last.at });
          }
          // Fail strict: only a confirmed site's first day up is a shipping week.
          if (scored) shipAt(firstUp(s.id, last.at));
        }
      } else if (s.kind === 'package_npm' || s.kind === 'package_pypi') {
        hasPackage = true;
        pkgLink ??= packagePage(s);
        const weekly = fin((last?.signals as Partial<PackageSignals> | undefined)?.weekly);
        if (weekly > 0) {
          shipped = true;
          lastActive = newest(lastActive, last!.at);
        }
        if (scored && last) {
          ships.push({ key, at: oldest(s.id)!.at, alive_at: weekly > 0 ? last.at : null });
          const credit = Math.min(cal.package_users, weekly / 50);
          input.packages.push({ project: key, users: credit, at: last.at });
          if (inScope) perSource.set(s.id, { users: credit, money: 0 });
        }
      } else if (s.kind === 'contract' || s.kind === 'coin') {
        const isCoin = s.kind === 'coin';
        // A chain only from a confirmed contract (never the agent's word: identity, repo facts, fit_chains).
        if (!isCoin && scored) {
          const chain = /^(base|arc):/i.exec(s.ref)?.[1].toLowerCase();
          if (chain === 'base' || chain === 'arc') chains.add(chain);
        }
        if (isCoin) hasCoinSource = true;
        else hasContract = true;
        shipped = true;
        if (!isCoin && s.state === 'proposed') {
          const first = oldest(s.id);
          if (first && list((first.signals as Partial<ContractSignals>).callers).length > 0) untracked ??= s.ref;
        }
        if (!scored) continue;
        // Calls and buys accumulate over a year of readings (each overlaps the last read day): each once.
        const seen = new Set<string>();
        let newestCall: Date | null = null;
        for (const o of obs.get(s.id) ?? []) {
          const who = isCoin ? list<Who>((o.signals as Partial<CoinSignals>).traders) : list<ContractSignals['callers'][number]>((o.signals as Partial<ContractSignals>).callers);
          for (const w of who) {
            const v = isCoin ? 0 : fin((w as ContractSignals['callers'][number]).value_usd);
            const once = `${w?.id}|${w?.at}|${v}`;
            if (seen.has(once)) continue;
            seen.add(once);
            const codes = isCoin ? [] : list<unknown>((w as ContractSignals['callers'][number]).codes);
            // Trades are onchain use like calls (the spread rule applies to both).
            add(s.id, 'caller', isCoin ? 'trader' : codes.some((c) => typeof c === 'string' && ownCodes.has(c)) ? 'tagged' : 'caller', w, v);
            newestCall = newest(newestCall, date(w?.at));
            if (!isCoin && typeof w?.id === 'string') {
              const ftx = (w as ContractSignals['callers'][number]).first_tx_at;
              facts.set(w.id.toLowerCase(), { ...facts.get(w.id.toLowerCase()), first_tx_at: ftx ? date(ftx) : null });
            }
          }
        }
        lastActive = newest(lastActive, newestCall);
        const made = isCoin ? coinsHere[0]?.launched : deploysHere[0]?.created_at;
        ships.push({ key, at: made ?? oldest(s.id)?.at ?? s.created_at, alive_at: newestCall });
      }
    }
    // The newest call or buy keeps a deploy or a coin alive.
    const usedAt = newest(...touches.filter((t) => t.kind === 'caller').map((t) => t.at));
    for (const sh of ships) if (sh.alive_at === null && usedAt) sh.alive_at = usedAt;
    if (inScope) input.ships.push(...ships);

    // Use: every touch through anti-farming; each counted account's newest touch per kind.
    const counted = countProject(key, touches, { self: projSelf, actors: facts, ...ring });
    const best = new Map<string, UseTouch>();
    let tagged = false;
    const recent = new Set<string>();
    for (const t of touches) {
      const w = counted.actors.get(t.actor) ?? 0;
      if (!(w > 0)) continue;
      const kind = kinds.get(t)!;
      const k = `${t.actor}\u0000${kind}`;
      const b = best.get(k);
      if (!b || b.at < t.at) best.set(k, { project: key, actor: t.actor, at: t.at, weight: w, kind });
      if (kind === 'tagged') tagged = true;
      if (kind !== 'star' && kind !== 'fork') {
        addWeek(t.at, inScope);
        if (now.getTime() - t.at.getTime() <= WEEK_MS && t.at <= now) recent.add(t.actor);
      }
    }
    if (inScope) input.touches.push(...best.values());
    peopleWeek.set(key, recent.size);
    lastActive = newest(lastActive, ...[...best.values()].map((t) => t.at));
    // Fees into their contracts: 1% of counted callers' value (v2.12 R10), split by each source's raw volume.
    const money = moneyOf(counted);
    if (money > 0 && inScope) input.earned.push({ project: key, usd: money, kind: 'contract_fees' });
    const volume = [...rawVolume.values()].reduce((n, x) => n + x, 0);
    // The hold's shares are of the scored U: only the one project's sources (v2.13 scope) credit it.
    if (inScope) for (const sid of rawVolume.keys()) perSource.set(sid, { users: 0, money: volume > 0 ? (money * rawVolume.get(sid)!) / volume : 0 });
    // Users per source (the hold's one-source rule): real use only, credited where it was first seen.
    const users = new Set(touches.filter((t) => kinds.get(t) !== 'star' && kinds.get(t) !== 'fork').map((t) => t.actor));
    const accounts = [...users].filter((a) => (counted.actors.get(a) ?? 0) > 0).length;
    if (inScope) for (const [actor, f] of firstSource) if (users.has(actor)) perSource.get(f.sid)!.users += counted.actors.get(actor) ?? 0;
    // v2.13: new people per ISO week, each counted account (real use) at its first touch.
    const fresh: Record<string, number> = {};
    for (const [actor, f] of firstSource) {
      if (!users.has(actor) || !((counted.actors.get(actor) ?? 0) > 0)) continue;
      const w = isoWeekOf(new Date(f.at));
      fresh[w] = (fresh[w] ?? 0) + 1;
    }
    newPeople.set(key, fresh);
    // Coin creator fees, each creator wallet once.
    for (const x of coinsHere) {
      if (!x.creator || usedCreator.has(x.creator)) continue;
      usedCreator.add(x.creator);
      const usd = fin(Number(fees.find((f) => f.wallet === x.creator)?.usd));
      if (usd > 0 && inScope) input.earned.push({ project: key, usd, kind: 'coin_fees' });
    }
    if (inScope) for (const p of prizes) if (p.repo_key && lowKey(p.repo_key) === low) input.earned.push({ project: key, usd: fin(Number(p.usd)), kind: 'prize' });

    // v2.13: shipping weeks (commits, EarnKit hosting and deploys, a site's first day up, EarnKit's
    // own build events) and the Bench chains (verified contracts, EarnKit deploys, launched coins, entries).
    for (const h of hostedHere) shipAt(h.deployed_at);
    for (const x of deploysHere) {
      shipAt(x.created_at);
      const chain = x.ref.split(':')[0];
      if ((BENCH_CHAINS as readonly string[]).includes(chain)) chains.add(chain as BenchChain);
    }
    for (const e of events) if (e.repo_key === low) shipAt(e.at);
    for (const c of launched) {
      if (!c.repo_key || lowKey(c.repo_key) !== low) continue;
      const chain = (c.chain_id !== null ? CHAIN_OF_ID[c.chain_id] : undefined) ?? (c.coin ? 'base' : null);
      if (chain) chains.add(chain);
    }
    for (const e of entries)
      if (e.repo_key && lowKey(e.repo_key) === low)
        for (const c of e.chains ?? []) if ((BENCH_CHAINS as readonly string[]).includes(c)) chains.add(c as BenchChain);
    shipWeeks.set(key, [...ship].sort());
    const chainList = BENCH_CHAINS.filter((c) => chains.has(c));
    chainsOf.set(key, chainList);

    const ident = named(key);
    const repoName = REPO_SHAPE.test(key) ? (ghName ?? key.split('/')[1]) : null;
    const identName = typeof ident?.name === 'string' && ident.name.trim() ? ident.name.trim().slice(0, 60) : null;
    const identWhat = typeof ident?.what === 'string' && ident.what.trim() ? ident.what.trim().slice(0, 120) : null;
    const slug = hostedHere[0]?.slug;
    rows.push({
      key,
      name: identName ?? repoName ?? hostOf(key) ?? (slug ? slug : null) ?? coinsHere[0]?.name ?? key,
      what: identWhat ?? (description ? firstSentence(description) : null),
      link: slug ? `https://${slug}.earnkit.com` : liveSite ?? pkgLink,
      kind: slug || hasSite ? 'app' : hasContract ? 'contract' : hasPackage ? 'package' : coinsHere.length || hasCoinSource ? 'coin' : 'code',
      confirmed, shipped, scored: confirmed,
      bench_confirmed: confirmed && (!REPO_SHAPE.test(key) || srcs.some((s) => s.kind === 'repo' && confirmedSrc(s) && lowKey(s.ref) === low)),
      people_week: confirmed ? peopleWeek.get(key) ?? 0 : 0,
      has_coin: coinsHere.length > 0 || hasCoinSource,
      sends_tx: hasContract,
      tagged: confirmed && tagged,
      untracked_contract: untracked,
      last_active_at: lastActive ?? newest(...srcs.map((s) => s.created_at)),
      accounts: confirmed ? accounts : 0,
      chains: chainList,
      ship_weeks: [...ship].filter((w) => last53.has(w)).sort(),
      streak: streakOf(ship, now),
      weeks_shipping: weeksShipping(ship, now),
    });
  }
  // EarnKit's own events (built, deployed, hosted) mark their weeks.
  for (const e of events) addWeek(e.at, !scopeLow || e.repo_key === scopeLow);

  const scored = computeScoreV2(input, cal, now);
  const projects: ProjectRow[] = rows.map(({ scored: isScored, ...r }) => {
    const p = scored.perProject.get(r.key);
    return { ...r, tracked: true, people: isScored ? Math.round(p?.people ?? 0) : 0, money_usd: isScored ? Math.round(100 * (p?.usd ?? 0)) / 100 : 0 };
  });
  // Final fix wave (first-message rank): with no other EarnKit person's account touching the work
  // there is no ring to find, so the ring counts as computed and a confirmed ship ranks on the first
  // refresh. Touched by others and never computed by the cron: unranked until it is (fail strict;
  // the touches above are already weighed as a partner's).
  return { input, projects, perSource, ringComputed: stored !== null || others === 0, checked, newPeople, shipWeeks, chains: chainsOf };
}

// ---- Live score, rank, refresh ---------------------------------------------------------------------

/**
 * The review hold for a rescore `s` on `day`: the baseline is the newest public score before that
 * day, a public v2 history row or a released live score (a held day the owner never saw is neither).
 */
async function holdOf(tx: Db, id: number, day: string, s: V2Scored, perSource: Map<number, { users: number; money: number }>) {
  const [before] = await tx<{ score: number }[]>`
    SELECT score FROM (
      SELECT s.day, 0 AS pri, s.score FROM builder_scores s
      WHERE s.builder_id = ${id} AND s.formula = ${FORMULA_V2} AND s.day < ${day}::date AND ${publicRow()}
      UNION ALL
      SELECT x.day, 1, x.score FROM score_releases x WHERE x.builder_id = ${id} AND x.score IS NOT NULL AND x.day < ${day}::date
    ) b ORDER BY day DESC, pri DESC LIMIT 1`;
  const U = s.parts.used.raw.U;
  const shares = [...perSource.values()].map((x) => (U > 0 ? x.users / U : 0));
  return { before, reason: holdReason(before?.score ?? null, s.score, shares) };
}

class DryRun extends Error {}
/**
 * v2.12.1 T9 fix round 1: whether tracking the person's proposed contract `ref` now would be held for
 * the owner's review (a jump or one source). Scored as if verified inside a transaction that is
 * always rolled back: nothing is written. True on any error (fail strict: never promise "today").
 */
export async function trackingHeld(id: number, ref: string, now: Date): Promise<boolean> {
  let held = true;
  try {
    await sql().begin(async (tx) => {
      await tx`
        UPDATE builder_sources SET state = 'verified', proof = 'deploy_wallet', verified_at = ${now}
        WHERE builder_id = ${id} AND kind = 'contract' AND lower(ref) = ${ref.toLowerCase()} AND state = 'proposed'`;
      const { input, perSource } = await personInputsV2(id, now, undefined, tx);
      const sc = computeScoreV2(input, calibrationV2(), now);
      held = (await holdOf(tx, id, now.toISOString().slice(0, 10), sc, perSource)).reason !== null;
      throw new DryRun();
    });
  } catch (err) {
    if (!(err instanceof DryRun)) {
      console.error('[score] tracking held', err instanceof Error ? err.name : 'error');
      return true;
    }
  }
  return held;
}

/**
 * v2.13 plan B9: the "Started tracking" facts on the week the one project entered, once per builder
 * and project (F2: scoped to the builder, so someone else's row for the same key never blocks it).
 * Lives here, not in week-facts.ts, which imports this file (no import cycle). Callers pass only a
 * confirmed project. A week row of another builder for the key is left alone.
 */
export async function ensureStartedRow(db: Db, builderId: number, key: string, at: Date, s: { live: boolean; weeks: number; people: number }): Promise<void> {
  const [had] = await db`SELECT 1 FROM project_updates WHERE builder_id = ${builderId} AND lower(project_key) = lower(${key}) AND facts ? 'started' LIMIT 1`;
  if (had) return;
  await db`
    INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${builderId}, ${key}, ${mondayOf(at)}, ${db.json({ started: s } as never)})
    ON CONFLICT (project_key, week) DO UPDATE SET facts = project_updates.facts || EXCLUDED.facts
    WHERE project_updates.builder_id = EXCLUDED.builder_id AND NOT (project_updates.facts ? 'started')`;
}

/**
 * Rescore one person now: the live row, their projects with the 25-project cap. A rescore the
 * review hold stops (holdReason) waits in `pending` with its day; the public columns stay (a first
 * score held this way is public 0, unranked). The 30-point jump is measured against the newest
 * public history row before today, so ten-minute refreshes can never step past it.
 */
export async function rescorePerson(id: number, now: Date, ring?: PersonRing): Promise<{ score: number; ranked: boolean; held: boolean }> {
  const cal = calibrationV2();
  // One transaction for the decision and the write: a per-person advisory lock first (rescores of
  // one person never interleave), then every input the hold depends on (the live row, the
  // baseline, the stored ring) is read under it. A rescore older than the stored one writes nothing.
  const result = await sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${RESCORE_LOCK}, ${id})`;
    const [cur] = await tx<{ score: number; ranked: boolean; computed_at: Date }[]>`
      SELECT score, ranked, computed_at FROM builder_live WHERE builder_id = ${id} FOR UPDATE`;
    // A newer rescore exists (a refresh during this cron run). Without a ring (an older refresh)
    // nothing is written. The cron's ring is the freshest, so the cron rescores at the newer row's
    // time: same readings, same computed_at (never moves back), the rank, cap and projects rebuilt
    // with the computed ring. `checked_at` stays this cron run.
    if (cur && cur.computed_at > now && !ring) return { score: cur.score, ranked: cur.ranked, held: false, reason: null, s: null, before: null };
    const at = cur && cur.computed_at > now ? cur.computed_at : now;
    const day = at.toISOString().slice(0, 10);
    // v2.13 (flag on): the score is the one project's (plan B2: picked once when none was named).
    const bench = benchEnabled();
    const main = bench ? ((await mainProjectOf(id, tx)) ?? (await pickMainProject(id, tx))) : null;
    const { input, projects, perSource, ringComputed, checked } = await personInputsV2(id, at, ring, tx, { scope: main });
    const s = computeScoreV2(input, cal, at);
    const mainRow = main ? projects.find((p) => p.key.toLowerCase() === main.toLowerCase()) : undefined;
    // Ranked only once the ring is known: computed by the cron, or no other EarnKit person touched
    // the work (fail strict on ring partners). v2.13 B5: on the Bench as soon as the one project is
    // confirmed (a repo key: by its own repo proof); flag off: v2.12.1's rule.
    const ranked = (bench ? Boolean(mainRow?.bench_confirmed) : s.ranked) && ringComputed;
    const prevTracked = new Set((await tx<{ project_key: string }[]>`
      SELECT project_key FROM builder_projects WHERE builder_id = ${id} AND tracked`).map((r) => r.project_key));
    const tracked = trackedKeys(projects, at, prevTracked);
    const { before, reason } = await holdOf(tx, id, day, s, perSource);
    const people = [...s.perProject.values()].filter((p) => p.people > 0).length;
    // `at` names this rescore: the owner's release applies it only while it is still the pending one.
    // A cron rescore at a newer row's time is a different rescore, so it carries the run's time too.
    const version = at === now ? now.toISOString() : `${at.toISOString()}~${now.toISOString()}`;
    const row = { score: s.score, parts: s.parts, ranked, shipped: s.shipped, people, formula: FORMULA_V2, calibration: cal.id, day, at: version };
    // The cron's ring (and the accounts it checked, with their owners) is stored for the refreshes.
    if (ring) await tx`UPDATE builder_profiles SET ring = ${tx.json(ringToJson(ring, checked, now) as never)} WHERE builder_id = ${id}`;
    let out: { score: number; ranked: boolean };
    if (reason) {
      // Held: the public columns stay (none yet: public 0, unranked) and the rescore waits for the owner.
      await tx`
        INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, pending, computed_at)
        VALUES (${id}, 0, '{}'::jsonb, false, 0, 0, ${FORMULA_V2}, ${cal.id}, ${tx.json(row as never)}, ${at})
        ON CONFLICT (builder_id) DO UPDATE SET pending = EXCLUDED.pending, computed_at = EXCLUDED.computed_at`;
      await tx`UPDATE builder_profiles SET held = true, updated_at = now() WHERE builder_id = ${id}`;
      out = cur ? { score: cur.score, ranked: cur.ranked } : { score: 0, ranked: false };
    } else {
      await tx`
        INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, pending, computed_at)
        VALUES (${id}, ${s.score}, ${tx.json(s.parts as never)}, ${ranked}, ${s.shipped}, ${people}, ${FORMULA_V2}, ${cal.id}, NULL, ${at})
        ON CONFLICT (builder_id) DO UPDATE SET score = EXCLUDED.score, parts = EXCLUDED.parts, ranked = EXCLUDED.ranked,
          shipped = EXCLUDED.shipped, people = EXCLUDED.people, formula = EXCLUDED.formula, calibration = EXCLUDED.calibration,
          pending = NULL, computed_at = EXCLUDED.computed_at`;
      await tx`UPDATE builder_profiles SET held = false, updated_at = now() WHERE builder_id = ${id} AND held`;
      out = { score: s.score, ranked };
    }
    await tx`DELETE FROM builder_projects WHERE builder_id = ${id} AND NOT (project_key = ANY(${projects.map((p) => p.key)}::text[]))`;
    for (const p of projects)
      await tx`
        INSERT INTO builder_projects ${tx({
          builder_id: id, project_key: p.key, name: p.name, what: p.what, link: p.link, kind: p.kind,
          confirmed: p.confirmed, shipped: p.shipped, tracked: tracked.has(p.key), people: p.people, people_week: p.people_week,
          money_usd: p.money_usd, has_coin: p.has_coin, sends_tx: p.sends_tx, tagged: p.tagged,
          untracked_contract: p.untracked_contract, last_active_at: p.last_active_at, updated_at: at,
          chains: p.chains, streak: p.streak, weeks_shipping: p.weeks_shipping, ship_weeks: p.ship_weeks,
        })}
        ON CONFLICT (builder_id, project_key) DO UPDATE SET name = EXCLUDED.name, what = EXCLUDED.what, link = EXCLUDED.link,
          kind = EXCLUDED.kind, confirmed = EXCLUDED.confirmed, shipped = EXCLUDED.shipped, tracked = EXCLUDED.tracked,
          people = EXCLUDED.people, people_week = EXCLUDED.people_week, money_usd = EXCLUDED.money_usd, has_coin = EXCLUDED.has_coin,
          sends_tx = EXCLUDED.sends_tx, tagged = EXCLUDED.tagged, untracked_contract = EXCLUDED.untracked_contract,
          last_active_at = EXCLUDED.last_active_at, updated_at = EXCLUDED.updated_at, chains = EXCLUDED.chains,
          streak = EXCLUDED.streak, weeks_shipping = EXCLUDED.weeks_shipping, ship_weeks = EXCLUDED.ship_weeks`;
    // v2.13 B9 (F2): the "Started tracking" row, only for a confirmed one project.
    if (bench && mainRow?.bench_confirmed)
      await ensureStartedRow(tx, id, mainRow.key, at, { live: mainRow.shipped && mainRow.kind === 'app', weeks: mainRow.weeks_shipping, people: mainRow.people });
    return { ...out, held: reason !== null, reason, s, before: before?.score ?? null };
  });
  if (result.reason && result.s) {
    const { reason, s, before } = result;
    await noteEvent('score_held', () => ({
      type: 'score_held', dedupe_key: `score_held:${id}:${now.toISOString().slice(0, 13)}`, installation_id: id,
      detail: { reason, score: s.score, previous: before },
    }));
  }
  return { score: result.score, ranked: result.ranked, held: result.held };
}

/**
 * v2.12.1 T11 fix round 1: the one ranked population behind every rank (replies, page, card,
 * leaderboard): ranked, claimed with X with a handle (bindX clears a stale one), not hidden and not held (held = profile.held or a rescore
 * waiting in builder_live.pending). A FROM source of (builder_id, score). `only` limits it (tests).
 */
export function listedRanked(db: Db, only?: number[]) {
  const among = only ? db`AND l.builder_id IN ${db(only.length ? only : [-1])}` : db``;
  return db`(SELECT l.builder_id, l.score FROM builder_live l JOIN builder_profiles p USING (builder_id)
    WHERE l.ranked AND l.pending IS NULL AND p.x_user_id IS NOT NULL AND p.x_handle IS NOT NULL AND NOT p.hidden AND NOT p.held ${among})`;
}

/**
 * Where the person stands: their public live score and rank among the listed ranked people
 * (listedRanked: 1 + those with a higher score; ties share a number). A ranked person outside that
 * population (not claimed yet, or held) is counted in as well, so their reply still has a place.
 */
export async function standingOf(id: number, o: { only?: number[] } = {}): Promise<Standing & { score: number; shipped: number; people: number; claimed: boolean; handle: string | null }> {
  const db = sql();
  const listed = listedRanked(db, o.only);
  const [row] = await db<{ score: number; ranked: boolean; shipped: number; people: number; claimed: boolean; handle: string | null; total: number; rank: number }[]>`
    SELECT l.score, l.ranked, l.shipped, l.people, p.x_user_id IS NOT NULL AS claimed, p.x_handle AS handle,
      (SELECT count(*)::int FROM ${listed} x)
        + CASE WHEN l.ranked AND NOT EXISTS (SELECT 1 FROM ${listed} y WHERE y.builder_id = l.builder_id) THEN 1 ELSE 0 END AS total,
      CASE WHEN l.ranked THEN 1 + (SELECT count(*)::int FROM ${listed} z WHERE z.score > l.score AND z.builder_id <> l.builder_id) ELSE 0 END AS rank
    FROM builder_live l JOIN builder_profiles p USING (builder_id) WHERE l.builder_id = ${id}`;
  if (row) return { ...row };
  const [p] = await db<{ claimed: boolean; handle: string | null }[]>`
    SELECT x_user_id IS NOT NULL AS claimed, x_handle AS handle FROM builder_profiles WHERE builder_id = ${id}`;
  const [{ total }] = await db<{ total: number }[]>`SELECT count(*)::int AS total FROM ${listed} x`;
  return { ranked: false, rank: 0, total, score: 0, shipped: 0, people: 0, claimed: p?.claimed ?? false, handle: p?.handle ?? null };
}

/**
 * spec "Fresh within minutes for the person asking": re-read the person's sources and rescore, at
 * most once every REFRESH_MS (claimed atomically, so two finds at once read once). Never a shared
 * client's group. Never throws (find and the page go on without it): nothing is retried and the
 * page keeps the last good number. `minAgeMs` (a page view: PAGE_REFRESH_MS) replaces REFRESH_MS.
 */
export async function refreshPerson(id: number, o: { now: Date; deadline: number; reader?: ReaderDeps; minAgeMs?: number }): Promise<{ refreshed: boolean }> {
  if (!builderScoreEnabled()) return { refreshed: false };
  let claimed = false;
  try {
    const [g] = await sql()<{ shared: boolean | null }[]>`SELECT bool_or(shared_client) AS shared FROM installations WHERE COALESCE(builder_id, id) = ${id}`;
    if (g?.shared) return { refreshed: false };
    const rows = await sql()`
      INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
      VALUES (${id}, 0, '{}'::jsonb, false, 0, 0, ${FORMULA_V2}, ${LIVE_CALIBRATION_V2}, ${o.now}, ${o.now})
      ON CONFLICT (builder_id) DO UPDATE SET read_at = EXCLUDED.read_at
        WHERE builder_live.read_at IS NULL OR builder_live.read_at <= ${new Date(o.now.getTime() - (o.minAgeMs ?? REFRESH_MS))}
      RETURNING 1`;
    if (rows.length === 0) return { refreshed: false };
    claimed = true;
    const { deps, counts, stop } = countingDeps(o.reader ?? defaultReaderDeps(o.now, o.deadline));
    try {
      // spec "Skip, don't chase": each step fails on its own, so a discovery error never stops the
      // person's own sources being read.
      for (const [step, run] of [
        ['discover', () => refreshDiscovery(id, o.now, { deadline: o.deadline, reader: deps })],
        ['read', () => readPersonLive(id, o.now, { deadline: o.deadline, reader: deps })],
      ] as const) {
        if (Date.now() >= o.deadline) break;
        try {
          await run();
        } catch (err) {
          console.error(`[refresh] ${step}`, err instanceof Error ? err.name : 'error');
        }
      }
    } finally {
      stop();
      await flushReadUsage(o.now.toISOString().slice(0, 10), counts).catch((err: unknown) => console.error('[refresh] usage', err instanceof Error ? err.name : 'error'));
    }
    if (Date.now() < o.deadline) await rescorePerson(id, o.now);
    await noteEvent('refreshed', () => ({ type: 'refreshed', dedupe_key: `refreshed:${id}:${o.now.toISOString().slice(0, 15)}`, installation_id: id }));
  } catch (err) {
    console.error('[refresh] person', err instanceof Error ? err.name : 'error');
  }
  return { refreshed: claimed };
}

/** Final fix wave: a page view re-reads the person it shows only when their last read is this old. */
export const PAGE_REFRESH_MS = DAY_MS;

/**
 * Final fix wave (spec "On-demand refresh is limited to the person asking"): a page view (anyone,
 * signed in or not) refreshes the person it shows only when their last read is over PAGE_REFRESH_MS
 * old (never read, or reset by a claim or merge, counts as old), and only under the hourly caps
 * (LIMITS.pageRefreshIp for `ip`, then LIMITS.pageRefresh for all views), so crawlers can never spend
 * the reads the cron needs. find, score and make-countable keep refreshPerson's 10 minutes. Never throws.
 */
export async function pageViewRefresh(id: number, o: { now: Date; deadline: number; ip: string; reader?: ReaderDeps }): Promise<{ refreshed: boolean }> {
  if (!builderScoreEnabled()) return { refreshed: false };
  try {
    const [l] = await sql()<{ read_at: Date | null }[]>`SELECT read_at FROM builder_live WHERE builder_id = ${id}`;
    if (l?.read_at && o.now.getTime() - l.read_at.getTime() < PAGE_REFRESH_MS) return { refreshed: false };
    const cap = async (name: 'pageRefreshIp' | 'pageRefresh', who: string) => (await hit(`${name}:${who}`, LIMITS[name].limit, LIMITS[name].windowSeconds, o.now)).allowed;
    if (!(await cap('pageRefreshIp', o.ip)) || !(await cap('pageRefresh', 'global'))) return { refreshed: false };
  } catch (err) {
    console.error('[refresh] page view', err instanceof Error ? err.name : 'error');
    return { refreshed: false };
  }
  return refreshPerson(id, { now: o.now, deadline: o.deadline, reader: o.reader, minAgeMs: PAGE_REFRESH_MS });
}

/** Discovery inside a refresh: when a clue queued the person, else at most once a REFRESH_DISCOVER_MS (cost). Exported for tests. */
export async function refreshDiscovery(id: number, now: Date, o: { deadline: number; reader: ReaderDeps }): Promise<void> {
  // v2.13 plan B4: in the hour after the one project's proof line was issued, check that line on every
  // refresh (the refresh may run every minute then), with a 4 s floor in place of the cron's 15 s. A
  // skipped check still goes to the cron (discoverPerson queues 'proof_line').
  if (benchEnabled() && (await confirmingFast(id, now))) return void (await discoverPerson(id, { ...o, proofLineMinMs: MAIN_PROOF_MIN_MS }));
  const [q] = await sql()<{ done_at: Date | null; reason: string }[]>`SELECT done_at, reason FROM discovery_queue WHERE builder_id = ${id}`;
  if (q?.done_at && now.getTime() - q.done_at.getTime() < REFRESH_DISCOVER_MS) return;
  // v2.12.2: a proof-line check the refresh had no time for waits for the cron (it has the time).
  if (q && !q.done_at && q.reason === 'proof_line') return;
  await discoverPerson(id, o);
}

/** v2.12.1 T9: proposed contracts read for their past users per refresh, at most. */
export const PROPOSED_CONTRACTS_MAX = 5;
type LiveDue = { id: number; builder_id: number; kind: string; ref: string; state: string; last_read_day: string | null };
const LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

/**
 * The refresh's reads: every tracked source of the person not read in the last REFRESH_MS (verified
 * ones, plus the agent's proposed repos, sites and packages for display; contracts and coins only
 * when verified). One GraphQL query for their repos (others by name), one npm bulk call, one
 * Blockscout walk per contract or coin since its last daily read, one request per site. Each answer
 * goes to source_live (never source_readings: the daily history stays the cron's); a failure is
 * `ok = false` and is not retried. A spent GitHub budget writes nothing; the deadline stops the reads.
 */
export async function readPersonLive(id: number, now: Date, o: { deadline: number; reader: ReaderDeps }): Promise<{ read: number; failed: number }> {
  const db = sql();
  const due = await db<LiveDue[]>`
    SELECT b.id::int AS id, b.builder_id, b.kind, b.ref, b.state, b.last_read_day::text AS last_read_day
    FROM builder_sources b LEFT JOIN source_live l ON l.source_id = b.id
    WHERE b.builder_id = ${id}
      AND ((b.state = 'verified' AND b.kind <> 'merged_pr') OR (b.state = 'proposed' AND b.kind IN ('repo', 'site', 'package_npm', 'package_pypi'))
        -- v2.12.1 T9: a proposed contract on a chain EarnKit reads, at most once a day, to see whether
        -- it has past users to count (shown as a step, never scored) and who created it.
        OR (b.state = 'proposed' AND b.kind = 'contract' AND b.ref ~ '^(base|arc):'
          AND (l.read_at IS NULL OR l.read_at <= ${new Date(now.getTime() - DAY_MS)})))
      AND (l.read_at IS NULL OR l.read_at <= ${new Date(now.getTime() - REFRESH_MS)})
      AND NOT EXISTS (SELECT 1 FROM builder_projects p WHERE p.builder_id = b.builder_id AND p.project_key = b.project_key AND NOT p.tracked)
    -- Most recently active first, so a refresh the deadline cuts reads what matters (also before the
    -- first rescore, when no project rows exist yet).
    ORDER BY (SELECT max(r.day) FROM source_readings r WHERE r.source_id = b.id) DESC NULLS LAST, b.created_at DESC, b.id`;
  let read = 0;
  let failed = 0;
  const put = async (s: LiveDue, r: { ok: true; signals: unknown } | { ok: false }) => {
    if (r.ok) {
      read++;
      await db`
        INSERT INTO source_live (source_id, signals, ok, read_at) VALUES (${s.id}, ${db.json(r.signals as never)}, true, ${now})
        ON CONFLICT (source_id) DO UPDATE SET signals = EXCLUDED.signals, ok = true, read_at = EXCLUDED.read_at`;
    } else {
      failed++;
      // A failed read: personInputsV2 reads only ok rows, so the score falls back to the newest good
      // daily reading (the last good number). The row's old signals stay, unused.
      await db`
        INSERT INTO source_live (source_id, signals, ok, read_at) VALUES (${s.id}, '{}'::jsonb, false, ${now})
        ON CONFLICT (source_id) DO UPDATE SET ok = false, read_at = EXCLUDED.read_at`;
    }
  };
  /** One read for `group`; false when the deadline cut it (stop). A spent budget writes nothing. */
  const attempt = async (group: LiveDue[], run: () => Promise<void>): Promise<boolean> => {
    if (Date.now() >= o.deadline) return false;
    try {
      await run();
    } catch (err) {
      if (err instanceof ScoreDeadline) return false;
      if (isBudgetStop(err)) return true;
      for (const s of group) await put(s, { ok: false });
    }
    return true;
  };
  const since = (s: LiveDue) => (s.last_read_day ? new Date(`${s.last_read_day}T00:00:00Z`) : new Date(now.getTime() - YEAR_MS));
  const done = () => ({ read, failed });

  // Repos: the person's own under their login in one query, the rest by name (REPOS_MAX a call).
  const repos = due.filter((s) => s.kind === 'repo');
  if (repos.length > 0) {
    const [p] = await db<{ login: string | null; reported: string | null }[]>`
      SELECT lower(github_login) AS login, lower(reported_github) AS reported FROM builder_profiles WHERE builder_id = ${id}`;
    const login = [p?.login, p?.reported].find((l): l is string => typeof l === 'string' && LOGIN.test(l)) ?? null;
    const found = new Map<string, PersonRepo>();
    const asked = new Set<number>();
    // v2.13 (R2): under the flag no person query; every repo goes by name below.
    const mine = login && !benchEnabled() ? repos.filter((s) => s.ref.toLowerCase().split('/')[0] === login) : [];
    if (mine.length > 0) {
      const go = await attempt(mine, async () => {
        for (const [k, r] of (await readPersonGithub(login!, o.reader))?.repos ?? []) found.set(k, r);
        for (const s of mine) asked.add(s.id);
      });
      if (!go) return done();
    }
    const rest = repos.filter((s) => !found.has(s.ref.toLowerCase()));
    for (let i = 0; i < rest.length; i += REPOS_MAX) {
      const batch = rest.slice(i, i + REPOS_MAX);
      const go = await attempt(batch, async () => {
        for (const [k, r] of await readGithubRepos(batch.map((s) => s.ref), o.reader)) found.set(k, r);
        for (const s of batch) asked.add(s.id);
      });
      if (!go) return done();
    }
    for (const s of repos) {
      if (!asked.has(s.id)) continue; // a spent budget or a failed call (already written)
      const r = found.get(s.ref.toLowerCase());
      if (!r) {
        await put(s, { ok: false });
        continue;
      }
      const prev = (await previousSignals(s.id)) as Partial<RepoSignals> | null;
      // An organization's contributors (the top-contributor rule) come from the daily read.
      const contributors = r.owner_type === 'Organization' ? list<Who>(prev?.contributors) : r.contributors;
      await put(s, { ok: true, signals: { ...r, contributors, commit_weeks: withPastWeeks(r.commit_weeks, prev, now), commit_counts: withPastCounts(r.commit_counts ?? {}, prev, now) } });
    }
  }

  // Unscoped npm packages in one bulk call; scoped ones and PyPI one at a time.
  const bulk = due.filter((s) => s.kind === 'package_npm' && !s.ref.startsWith('@'));
  if (bulk.length > 0) {
    const go = await attempt(bulk, async () => {
      const weekly = await readNpmBulk(bulk.map((s) => s.ref), o.reader);
      for (const s of bulk) {
        const n = weekly.get(s.ref);
        await put(s, typeof n === 'number' ? { ok: true, signals: { weekly: n, repo_url: null } satisfies PackageSignals } : { ok: false });
      }
    });
    if (!go) return done();
  }
  // v2.12.1 T9: at most PROPOSED_CONTRACTS_MAX proposed contracts a refresh, in `due`'s order.
  let proposedContracts = 0;
  const rest = due.filter((x) => x.kind !== 'repo' && !bulk.includes(x) && !(x.kind === 'contract' && x.state === 'proposed' && ++proposedContracts > PROPOSED_CONTRACTS_MAX));
  for (const s of rest) {
    const go = await attempt([s], async () => {
      switch (s.kind) {
        case 'site': {
          // A thrown probe is a failed read here (the last good reading stays), not a down site.
          const { status } = await o.reader.probe(s.ref);
          const n = typeof status === 'number' && Number.isFinite(status) ? status : 0;
          return put(s, { ok: true, signals: { status: n, up: n >= 200 && n < 300 } satisfies SiteSignals });
        }
        case 'package_npm':
          return put(s, { ok: true, signals: await readNpm(s.ref, o.reader) });
        case 'package_pypi':
          return put(s, { ok: true, signals: await readPypi(s.ref, o.reader) });
        case 'contract': {
          const signals = await readContract(s.ref, since(s), o.reader);
          if (s.state === 'proposed') {
            // Who created it (kept on the proposed row; contractConflicts reads verified rows only), so
            // the reply knows whether counting it moves the rank today (stand-view.ts certain).
            const origin = await soft(readContractOrigin(s.ref, o.reader), { deployer: null, created_at: null });
            if (origin.deployer) await db`UPDATE builder_sources SET deployer = ${origin.deployer} WHERE id = ${s.id} AND state = 'proposed'`;
          }
          return put(s, { ok: true, signals });
        }
        case 'coin': {
          const wallets = await db<{ wallet: string }[]>`SELECT wallet FROM person_wallets WHERE builder_id = ${s.builder_id}`;
          return put(s, { ok: true, signals: await readCoin(s.ref, since(s), o.reader, new Set(wallets.map((w) => `wallet:${w.wallet}`))) });
        }
        default:
          throw new Error('unknown source kind');
      }
    });
    if (!go) break;
  }
  return done();
}

/**
 * The cron's `score` step: everyone with a new reading since their last live score, plus everyone
 * not yet scored today (UTC), never a shared client; each person's ring is stored, they are
 * rescored while `deadline` allows, then one history row per person per day (the public score, or
 * on a held day the pending score the owner reviews).
 */
export async function scorePeopleV2(now: Date, o: { deadline: number; only?: number[] }): Promise<{ scored: number; held: number[] }> {
  const db = sql();
  const day = now.toISOString().slice(0, 10);
  const due = await db<{ builder_id: number }[]>`
    SELECT p.builder_id FROM builder_profiles p LEFT JOIN builder_live l USING (builder_id)
    WHERE NOT EXISTS (SELECT 1 FROM installations i WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND i.shared_client)
      AND (NOT EXISTS (SELECT 1 FROM builder_scores s WHERE s.builder_id = p.builder_id AND s.day = ${day})
        OR EXISTS (SELECT 1 FROM builder_sources b JOIN source_readings r ON r.source_id = b.id
          WHERE b.builder_id = p.builder_id AND r.at > COALESCE(l.computed_at, '-infinity'::timestamptz)))
      ${o.only ? db`AND p.builder_id IN ${db(o.only.length ? o.only : [-1])}` : db``}
    ORDER BY p.builder_id`;
  if (due.length === 0) return { scored: 0, held: [] };
  // Everyone's accounts and ring edges, once a run: each person's ring is stored on their profile, so
  // the on-demand refresh reads only that row.
  const ctx = await scoreContext();
  let scored = 0;
  const held: number[] = [];
  for (const { builder_id: id } of due) {
    if (Date.now() >= o.deadline) break;
    const r = await rescorePerson(id, now, ringWeights(ctx.edges, id, ctx.owner));
    scored++;
    if (r.held) held.push(id);
    const [row] = await db<{ score: number }[]>`
      INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, projects)
      SELECT builder_id, ${day},
        -- A held day keeps what the owner reviews: the pending score and its parts.
        COALESCE((pending->>'score')::smallint, score), 0, COALESCE(pending->'parts', parts), '{}'::jsonb,
        COALESCE(pending->>'formula', formula), COALESCE(pending->>'calibration', calibration), pending IS NOT NULL, NULL
      FROM builder_live
      WHERE builder_id = ${id} ON CONFLICT (builder_id, day) DO NOTHING RETURNING score`;
    if (row)
      await noteEvent('score_computed', () => ({
        type: 'score_computed', dedupe_key: `score:${id}:${day}`, installation_id: id, detail: { score: row.score, calibration: LIVE_CALIBRATION_V2 },
      }));
  }
  return { scored, held };
}
