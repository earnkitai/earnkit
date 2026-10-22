import { holdReason, publicRow } from './builder-score'; // builder-score imports this file too: functions only, called after load
import { ScoreDeadline } from './campaigns';
import { isConfirmedProof } from './confirmed';
import { sql, type Db } from './db';
import { discoverPerson } from './discovery';
import { REPO_KEY, benchConfirmedSql, mainProjectOf, pickMainProject } from './main-project';
import { noteEvent } from './events';
import { poolChanged } from './profile-cache';
import { REPOS_MAX, readAppRepos, readGithubRepos, type PersonRepo } from './person-github';
import { BENCH_CHAINS, type BenchChain, type Standing } from './rank';
import { COIN_PROGRAM } from './policy-constants';
import { LIMITS, hit } from './rate-limit';
import { countingDeps, flushReadUsage } from './read-usage';
import { LIVE_CALIBRATION_V2, calibrationV2 } from './score-calibration';
import { FORMULA_V2, SHIPPING_WEEKS, computeScoreV2, type ScoreInput, type Ship } from './score-v2';
import {
  defaultReaderDeps, isBudgetStop, readError, readNpm, readNpmBulk, readPypi, type PackageSignals, type ReaderDeps, type RepoSignals, type SiteSignals,
} from './source-readers';
import { firstPushes, needsPushCheck, previousRepoSignals, storedCommits } from './sources';
import { CHAIN_IDS } from './tokens';
import { wholeWords } from './untrusted-text';
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
  confirmed: boolean; shipped: boolean; tracked: boolean;
  has_coin: boolean; sends_tx: boolean; last_active_at: Date | null;
  /** v2.13: the Bench chains it is on, its streak (commit weeks in a row), weeks shipping in the last 52, and those weeks (plan B7). */
  chains: BenchChain[]; streak: number; weeks_shipping: number; ship_weeks: string[];
  /** R18 fix 1: the weeks with counted commits on its repo (the profile grid; never deploys or sites). */
  commit_weeks: string[];
  /**
   * v2.13 Bench gate (T4 fix round 1, ruling): confirmed, and for a repo-shaped key (owner/repo) a
   * confirmed repo source on that very key. A coin or an entry naming a repo never proves it. Not stored.
   */
  bench_confirmed: boolean;
  /**
   * Scoring and clarity (R4): a confirmed repo source of this project has at least one good reading
   * (daily or live). Ranked needs it on the one project. Not stored.
   */
  repo_read: boolean;
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
/**
 * The anti-backdating floor of one repo reading: whether it counts commit week `wk`. Never a week before the repo's
 * created_at (rule 2); an unverified reading (pushes_checked false, fix round 3) only its last 4 weeks. A verified
 * reading's commit_weeks and commit_counts are already push-backed (sources.ts storedCommits), so nothing more.
 * The score (countedCommitWeeks) and the ship log (week-facts.ts weekFactsFor, so the weekly job and the backfill)
 * share it. Pure.
 */
export function weekCounts(g: { created_at?: unknown; pushes_checked?: unknown }, wk: string, now: Date): boolean {
  if (!WEEK.test(wk)) return false;
  const created = date(g.created_at);
  if (created && wk < isoWeekOf(created)) return false;
  return g.pushes_checked !== false || wk >= isoWeekOf(new Date(now.getTime() - 3 * WEEK_MS));
}
/** The commit weeks one repo reading counts (weekCounts on its commit_weeks). Pure. */
export function countedCommitWeeks(g: { commit_weeks?: unknown; created_at?: unknown; pushes_checked?: unknown }, now: Date): string[] {
  return list<unknown>(g.commit_weeks).filter((wk): wk is string => typeof wk === 'string' && weekCounts(g, wk, now));
}
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
const lowKey = (k: string) => k.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').toLowerCase();
const hostOf = (k: string) => (URL.canParse(k) ? new URL(k).hostname : null);
const firstSentence = (s: string) => {
  const one = s.split(/(?<=[.!?])\s/)[0].trim();
  return one.length > 60 ? `${one.slice(0, 59).trimEnd()}…` : one;
};
const packagePage = (s: Src) =>
  s.kind === 'package_npm' ? `https://www.npmjs.com/package/${s.ref}` : `https://pypi.org/project/${s.ref.replace(/^pypi:/i, '')}/`;

type IdentityProject = { name?: unknown; what?: unknown; repo?: unknown; live_url?: unknown; package?: unknown; contracts?: unknown };

/**
 * The person's v2 inputs (confirmed data only) and their projects (everything they have, confirmed
 * or not, spec S1). Reads only this person's rows. Scoring and clarity R16b: Shipping reads the one
 * project's ships and commit weeks; people, money, stars and the ring are no longer counted.
 */
export async function personInputsV2(
  id: number, now: Date, db: Db = sql(), o: { scope?: string | null } = {},
): Promise<{ input: ScoreInput; projects: ProjectRow[]; shipWeeks: Map<string, string[]>; chains: Map<string, BenchChain[]> }> {
  const yearAgo = new Date(now.getTime() - YEAR_MS);
  const [profile] = await db<{ identity: { projects?: unknown } | null }[]>`
    SELECT identity FROM builder_profiles WHERE builder_id = ${id}`;
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
  const coins = await db<{ name: string; coin: string; repo_key: string | null; launched: Date }[]>`
    SELECT name, lower(coin_address) AS coin, COALESCE(token_repo_key, repo_key) AS repo_key, COALESCE(coin_launched_at, submitted_at) AS launched
    FROM projects WHERE installation_id IN ${db(group)} AND coin_address IS NOT NULL ORDER BY id`;
  const events = await db<{ at: Date; repo_key: string | null }[]>`
    SELECT at, lower(repo_key) AS repo_key FROM builder_events
    WHERE installation_id IN ${db(group)} AND type IN ('built', 'deployed', 'hosted') AND at > ${yearAgo}`;
  // v2.13: chains from program entries and launched coins (any chain; coin_address is Base only).
  const entries = await db<{ repo_key: string | null; chains: string[] | null }[]>`
    SELECT COALESCE(p.repo_key, p.token_repo_key) AS repo_key, g.chains FROM projects p JOIN programs g ON g.id = p.program_id
    WHERE p.installation_id IN ${db(group)} AND p.program_id <> ${COIN_PROGRAM} AND p.vetoed_at IS NULL`;
  const launched = await db<{ repo_key: string | null; chain_id: number | null; coin: string | null }[]>`
    SELECT COALESCE(token_repo_key, repo_key) AS repo_key, coin_chain_id AS chain_id, lower(coin_address) AS coin
    FROM projects WHERE installation_id IN ${db(group)} AND token_status = 'launched'`;

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
  /** A site's first observation up (`last`: its newest, which is up). */
  const firstUp = (sid: number, last: Date) =>
    (obs.get(sid) ?? []).filter((o) => (o.signals as Partial<SiteSignals>).up === true).reduce((m, o) => (o.at < m ? o.at : m), last);

  const identity = list<IdentityProject>(profile?.identity?.projects);
  const named = (key: string) => {
    const k = lowKey(key);
    return identity.find((p) => [p.repo, p.live_url, p.package, ...list<unknown>(p.contracts)].some((v) => typeof v === 'string' && lowKey(v) === k));
  };
  const confirmedSrc = (s: Src) => s.state === 'verified' && isConfirmedProof(s.proof);

  const input: ScoreInput = { ships: [], commitWeeks: [] };
  const projects: ProjectRow[] = [];
  // v2.13 (scope): only the one project's work feeds the score; every project's row is still built.
  const scopeLow = o.scope ? lowKey(o.scope) : null;
  const shipWeeks = new Map<string, string[]>();
  const chainsOf = new Map<string, BenchChain[]>();
  const last53 = new Set([...last52(now), isoWeekOf(new Date(now.getTime() - 52 * WEEK_MS))]);
  const weekOf = (at: Date | null | undefined) => (at && Number.isFinite(at.getTime()) ? isoWeekOf(at) : null);

  for (const key of keys) {
    const low = lowKey(key);
    const inScope = !scopeLow || scopeLow === low;
    const ship = new Set<string>();
    const commits = new Set<string>();
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

    let shipped = hostedHere.length > 0 || deploysHere.length > 0 || coinsHere.length > 0;
    let liveSite: string | null = null;
    let pkgLink: string | null = null;
    let description: string | null = null;
    let ghName: string | null = null;
    let lastActive: Date | null = newest(
      ...hostedHere.map((h) => h.deployed_at), ...deploysHere.map((x) => x.created_at), ...coinsHere.map((x) => x.launched),
    );
    let hasSite = false;
    let hasContract = deploysHere.length > 0;
    let hasPackage = false;
    let hasCoinSource = false;
    // Shipping's live bonus: the live ships (a live site, a contract deploy, a published package), each once. A coin is not one.
    const ships: Ship[] = [];
    for (const h of hostedHere) ships.push({ key: `site:${h.slug}.earnkit.com`, kind: 'site' });
    for (const x of deploysHere) ships.push({ key: `contract:${x.ref}`, kind: 'contract' });
    let repoRead = false;

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
        repoRead = true;
        // Fix rounds 2 and 3 (anti-backdating): no week before the repo existed; an unverified reading, its last 4 weeks.
        for (const wk of countedCommitWeeks(g, now)) {
          ship.add(wk);
          commits.add(wk);
          if (inScope) input.commitWeeks.push(wk);
        }
      } else if (s.kind === 'site') {
        hasSite = true;
        const up = last && (last.signals as Partial<SiteSignals>).up === true;
        if (up) {
          shipped = true;
          liveSite ??= s.ref;
          lastActive = newest(lastActive, last.at);
          // A site is a ship only on a project with a confirmed repo (spec: "Repos with a live homepage").
          if (scored && confirmedRepo) ships.push({ key: `site:${hostOf(s.ref) ?? s.ref.toLowerCase()}`, kind: 'site' });
          // Fail strict: only a confirmed site's first day up is a shipping week.
          if (scored) shipAt(firstUp(s.id, last.at));
        }
      } else if (s.kind === 'package_npm' || s.kind === 'package_pypi') {
        hasPackage = true;
        pkgLink ??= packagePage(s);
        if (fin((last?.signals as Partial<PackageSignals> | undefined)?.weekly) > 0) {
          shipped = true;
          lastActive = newest(lastActive, last!.at);
        }
        if (scored && last) ships.push({ key: `package:${s.kind}:${s.ref.toLowerCase()}`, kind: 'package' });
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
        // R16b: a confirmed contract is a live ship; its callers are no longer read.
        if (!isCoin && scored) ships.push({ key: `contract:${s.ref.toLowerCase()}`, kind: 'contract' });
      }
    }
    if (inScope) input.ships.push(...ships);

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
    const repoName = /^[^/:\s]+\/[^/\s]+$/.test(key) ? (ghName ?? key.split('/')[1]) : null;
    const identName = typeof ident?.name === 'string' && ident.name.trim() ? wholeWords(ident.name, 60) : null;
    const identWhat = typeof ident?.what === 'string' && ident.what.trim() ? ident.what.trim().slice(0, 120) : null;
    const slug = hostedHere[0]?.slug;
    projects.push({
      key,
      name: identName ?? repoName ?? hostOf(key) ?? (slug ? slug : null) ?? coinsHere[0]?.name ?? key,
      what: identWhat ?? (description ? firstSentence(description) : null),
      link: slug ? `https://${slug}.earnkit.com` : liveSite ?? pkgLink,
      kind: slug || hasSite ? 'app' : hasContract ? 'contract' : hasPackage ? 'package' : coinsHere.length || hasCoinSource ? 'coin' : 'code',
      confirmed, shipped, tracked: true,
      // Twin of main-project benchConfirmedSql: a repo source matched on its ref, whatever its project.
      bench_confirmed: confirmed && (!REPO_KEY.test(low) || sources.some((s) => s.kind === 'repo' && confirmedSrc(s) && lowKey(s.ref) === low)),
      repo_read: repoRead,
      has_coin: coinsHere.length > 0 || hasCoinSource,
      sends_tx: hasContract,
      last_active_at: lastActive ?? newest(...srcs.map((s) => s.created_at)),
      chains: chainList,
      ship_weeks: [...ship].filter((w) => last53.has(w)).sort(),
      commit_weeks: [...commits].filter((w) => last53.has(w)).sort(),
      // builder_projects.streak is a rescore-time cache of commit weeks in a row; no surface reads it (streak.ts streaksFor is the one read).
      streak: streakOf(commits, now),
      weeks_shipping: weeksShipping(ship, now),
    });
  }
  return { input, projects, shipWeeks, chains: chainsOf };
}

// ---- Live score, rank, refresh ---------------------------------------------------------------------

/**
 * The review hold for a rescore `s` on `day`: the baseline is the newest public score before that
 * day, a public v2 history row or a released live score (a held day the owner never saw is neither).
 */
async function holdOf(tx: Db, id: number, day: string, score: number) {
  // Scoring and clarity: only a ranked baseline of the live calibration from the last 12 weeks counts
  // (Shipping's first day is never a jump from the four-part score, nor from a day the builder was
  // unranked, so the first App connect is never held). Losing and regaining the rank (the App removed and
  // reinstalled) keeps the ranked baseline, so it never skips the hold. No source shares: people and money
  // aren't scored.
  const cal = calibrationV2().id;
  const since = new Date(Date.parse(`${day}T00:00:00Z`) - SHIPPING_WEEKS * WEEK_MS).toISOString().slice(0, 10);
  const [before] = await tx<{ score: number }[]>`
    SELECT score FROM (
      SELECT s.day, 0 AS pri, s.score FROM builder_scores s
      WHERE s.builder_id = ${id} AND s.formula = ${FORMULA_V2} AND s.calibration = ${cal} AND s.ranked AND s.day < ${day}::date AND s.day >= ${since}::date AND ${publicRow()}
      UNION ALL
      SELECT x.day, 1, x.score FROM score_releases x WHERE x.builder_id = ${id} AND x.score IS NOT NULL AND x.day < ${day}::date AND x.day >= ${since}::date
        AND EXISTS (SELECT 1 FROM builder_scores h WHERE h.builder_id = x.builder_id AND h.day = x.day AND h.calibration = ${cal} AND h.ranked)
    ) b ORDER BY day DESC, pri DESC LIMIT 1`;
  return { before, reason: holdReason(before?.score ?? null, score, []) };
}

/**
 * v2.13 plan B9: the "Started tracking" facts on the week the one project entered, once per builder
 * and project (F2: scoped to the builder, so someone else's row for the same key never blocks it).
 * Lives here, not in week-facts.ts, which imports this file (no import cycle). Callers pass only a
 * confirmed project. A week row of another builder for the key is left alone.
 */
export async function ensureStartedRow(db: Db, builderId: number, key: string, at: Date, s: { live: boolean; weeks: number }): Promise<void> {
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
 * public history row before today, so ten-minute refreshes can never step past it. `cron`: the cron's
 * score step (it rescores even when a refresh wrote a newer row during the run).
 */
export async function rescorePerson(id: number, now: Date, o: { cron?: boolean } = {}): Promise<{ score: number; ranked: boolean; held: boolean; changed: boolean }> {
  const cal = calibrationV2();
  // One transaction for the decision and the write: a per-person advisory lock first (rescores of
  // one person never interleave), then every input the hold depends on (the live row, the
  // baseline, the stored ring) is read under it. A rescore older than the stored one writes nothing.
  const result = await sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${RESCORE_LOCK}, ${id})`;
    const [cur] = await tx<{ score: number; ranked: boolean; computed_at: Date; held: boolean }[]>`
      SELECT l.score, l.ranked, l.computed_at, (l.pending IS NOT NULL OR COALESCE(p.held, false)) AS held
      FROM builder_live l LEFT JOIN builder_profiles p USING (builder_id) WHERE l.builder_id = ${id} FOR UPDATE OF l`;
    // A newer rescore exists (a refresh during this cron run). An older refresh writes nothing. The cron
    // rescores at the newer row's time: same readings, same computed_at (never moves back), the rank, cap
    // and projects rebuilt.
    if (cur && cur.computed_at > now && !o.cron) return { score: cur.score, ranked: cur.ranked, held: false, reason: null, s: null, before: null, changed: false };
    const at = cur && cur.computed_at > now ? cur.computed_at : now;
    const day = at.toISOString().slice(0, 10);
    // v2.13: the score is the one project's (plan B2: picked once when none was named).
    const main = (await mainProjectOf(id, tx)) ?? (await pickMainProject(id, tx));
    const { input, projects } = await personInputsV2(id, at, tx, { scope: main });
    const s = computeScoreV2(input, at);
    const mainRow = main ? projects.find((p) => p.key.toLowerCase() === main.toLowerCase()) : undefined;
    // R4: ranked once the one project is confirmed (a repo key: by its own repo proof) and a repo of it
    // has been read at least once. No commits ranks at 0, never hidden.
    const ranked = Boolean(mainRow?.bench_confirmed && mainRow.repo_read);
    const prevTracked = new Set((await tx<{ project_key: string }[]>`
      SELECT project_key FROM builder_projects WHERE builder_id = ${id} AND tracked`).map((r) => r.project_key));
    const tracked = trackedKeys(projects, at, prevTracked);
    const { before, reason } = await holdOf(tx, id, day, s.score);
    // `at` names this rescore: the owner's release applies it only while it is still the pending one.
    // A cron rescore at a newer row's time is a different rescore, so it carries the run's time too.
    const version = at === now ? now.toISOString() : `${at.toISOString()}~${now.toISOString()}`;
    // R16b: people are no longer counted; the column keeps 0.
    const row = { score: s.score, parts: s.parts, ranked, shipped: s.shipped, people: 0, formula: FORMULA_V2, calibration: cal.id, day, at: version };
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
        VALUES (${id}, ${s.score}, ${tx.json(s.parts as never)}, ${ranked}, ${s.shipped}, 0, ${FORMULA_V2}, ${cal.id}, NULL, ${at})
        ON CONFLICT (builder_id) DO UPDATE SET score = EXCLUDED.score, parts = EXCLUDED.parts, ranked = EXCLUDED.ranked,
          shipped = EXCLUDED.shipped, people = EXCLUDED.people, formula = EXCLUDED.formula, calibration = EXCLUDED.calibration,
          pending = NULL, computed_at = EXCLUDED.computed_at`;
      await tx`UPDATE builder_profiles SET held = false, updated_at = now() WHERE builder_id = ${id} AND held`;
      out = { score: s.score, ranked };
    }
    await tx`DELETE FROM builder_projects WHERE builder_id = ${id} AND NOT (project_key = ANY(${projects.map((p) => p.key)}::text[]))`;
    // R16b: people, people_week, money_usd, tagged and untracked_contract are no longer counted: constants (old rows still read).
    for (const p of projects)
      await tx`
        INSERT INTO builder_projects ${tx({
          builder_id: id, project_key: p.key, name: p.name, what: p.what, link: p.link, kind: p.kind,
          confirmed: p.confirmed, shipped: p.shipped, tracked: tracked.has(p.key), people: 0, people_week: 0,
          money_usd: 0, has_coin: p.has_coin, sends_tx: p.sends_tx, tagged: false,
          untracked_contract: null, last_active_at: p.last_active_at, updated_at: at,
          chains: p.chains, streak: p.streak, weeks_shipping: p.weeks_shipping, ship_weeks: p.ship_weeks, commit_weeks: p.commit_weeks,
        })}
        ON CONFLICT (builder_id, project_key) DO UPDATE SET name = EXCLUDED.name, what = EXCLUDED.what, link = EXCLUDED.link,
          kind = EXCLUDED.kind, confirmed = EXCLUDED.confirmed, shipped = EXCLUDED.shipped, tracked = EXCLUDED.tracked,
          people = EXCLUDED.people, people_week = EXCLUDED.people_week, money_usd = EXCLUDED.money_usd, has_coin = EXCLUDED.has_coin,
          sends_tx = EXCLUDED.sends_tx, tagged = EXCLUDED.tagged, untracked_contract = EXCLUDED.untracked_contract,
          last_active_at = EXCLUDED.last_active_at, updated_at = EXCLUDED.updated_at, chains = EXCLUDED.chains,
          streak = EXCLUDED.streak, weeks_shipping = EXCLUDED.weeks_shipping, ship_weeks = EXCLUDED.ship_weeks,
          commit_weeks = EXCLUDED.commit_weeks`;
    // v2.13 B9 (F2): the "Started tracking" row, only for a confirmed one project.
    if (mainRow?.bench_confirmed)
      await ensureStartedRow(tx, id, mainRow.key, at, { live: mainRow.shipped && mainRow.kind === 'app', weeks: mainRow.weeks_shipping });
    // Hotfix 2026-10-19: the public pool moved (a new row, its score or rank, or a hold starting or ending). A builder
    // who stays held changes nothing public (the public columns stay), so their ten-minute refreshes expire no cache.
    const changed = !cur || cur.score !== out.score || cur.ranked !== out.ranked || cur.held !== (reason !== null);
    return { ...out, held: reason !== null, reason, s, before: before?.score ?? null, changed };
  });
  if (result.reason && result.s) {
    const { reason, s, before } = result;
    await noteEvent('score_held', () => ({
      type: 'score_held', dedupe_key: `score_held:${id}:${now.toISOString().slice(0, 13)}`, installation_id: id,
      detail: { reason, score: s.score, previous: before },
    }));
  }
  // Hotfix 2026-10-19: the home page, feed and leaderboard follow the pool at once (never a stale "Nobody").
  if (result.changed) poolChanged();
  return { score: result.score, ranked: result.ranked, held: result.held, changed: result.changed };
}

/**
 * v2.12.1 T11 fix round 1: the one ranked population behind every rank (replies, page, card,
 * leaderboard): ranked, claimed with X with a handle (bindX clears a stale one), not hidden and not held (held = profile.held or a rescore
 * waiting in builder_live.pending). A FROM source of (builder_id, score). `only` limits it (tests).
 */
export function listedRanked(db: Db, only?: number[]) {
  const among = only ? db`AND l.builder_id IN ${db(only.length ? only : [-1])}` : db``;
  // Scoring and clarity: only rows of the live calibration (Shipping); an older row is unranked until rescored.
  return db`(SELECT l.builder_id, l.score FROM builder_live l JOIN builder_profiles p USING (builder_id)
    WHERE l.ranked AND l.calibration = ${LIVE_CALIBRATION_V2} AND l.pending IS NULL AND p.x_user_id IS NOT NULL AND p.x_handle IS NOT NULL AND NOT p.hidden AND NOT p.held ${among})`;
}

/**
 * v2.13 spec "Chains (R14)", final fix M1: the Bench, the listed ranked people (listedRanked) whose one
 * project counts as confirmed now (benchConfirmedSql, not only at the last rescore). The one pool behind
 * the leaderboard, its header count and every "#N of M" (standingOf), so they always agree.
 */
export const benchPool = (only?: number[]) => {
  const db = sql();
  return db`(SELECT l.builder_id, l.score, b.chains FROM ${listedRanked(db, only)} l
    JOIN builder_profiles p ON p.builder_id = l.builder_id
    JOIN builder_projects b ON b.builder_id = l.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(db)})`;
};

/**
 * Where the person stands: their public live score and rank on the Bench (benchPool, the leaderboard's
 * own pool: 1 + those with a higher score; ties share a number; the total is the leaderboard's "of M builders"). A ranked person outside that pool (not claimed yet, or held) is counted in as well, so their
 * reply still has a place; `listed` says whether they are in it (a public rank shows only then: bench-rank rankLines).
 */
export async function standingOf(id: number, o: { only?: number[] } = {}): Promise<Standing & { score: number; shipped: number; people: number; claimed: boolean; handle: string | null; listed: boolean }> {
  const db = sql();
  const listed = benchPool(o.only);
  const [row] = await db<{ score: number; ranked: boolean; shipped: number; people: number; claimed: boolean; handle: string | null; total: number; rank: number; listed: boolean }[]>`
    SELECT l.score, l.ranked AND l.calibration = ${LIVE_CALIBRATION_V2} AS ranked, l.shipped, l.people, p.x_user_id IS NOT NULL AS claimed, p.x_handle AS handle,
      (SELECT count(*)::int FROM ${listed} x)
        + CASE WHEN l.ranked AND l.calibration = ${LIVE_CALIBRATION_V2} AND NOT EXISTS (SELECT 1 FROM ${listed} y WHERE y.builder_id = l.builder_id) THEN 1 ELSE 0 END AS total,
      CASE WHEN l.ranked AND l.calibration = ${LIVE_CALIBRATION_V2} THEN 1 + (SELECT count(*)::int FROM ${listed} z WHERE z.score > l.score AND z.builder_id <> l.builder_id) ELSE 0 END AS rank,
      EXISTS (SELECT 1 FROM ${listed} w WHERE w.builder_id = l.builder_id) AS listed
    FROM builder_live l JOIN builder_profiles p USING (builder_id) WHERE l.builder_id = ${id}`;
  if (row) return { ...row };
  const [p] = await db<{ claimed: boolean; handle: string | null }[]>`
    SELECT x_user_id IS NOT NULL AS claimed, x_handle AS handle FROM builder_profiles WHERE builder_id = ${id}`;
  const [{ total }] = await db<{ total: number }[]>`SELECT count(*)::int AS total FROM ${listed} x`;
  return { ranked: false, rank: 0, total, score: 0, shipped: 0, people: 0, claimed: p?.claimed ?? false, handle: p?.handle ?? null, listed: false };
}

/**
 * spec "Fresh within minutes for the person asking": re-read the person's sources and rescore, at
 * most once every REFRESH_MS (claimed atomically, so two finds at once read once). Never a shared
 * client's group. Never throws (find and the page go on without it): nothing is retried and the
 * page keeps the last good number. `minAgeMs` (a page view: PAGE_REFRESH_MS) replaces REFRESH_MS.
 */
export async function refreshPerson(id: number, o: { now: Date; deadline: number; reader?: ReaderDeps; minAgeMs?: number }): Promise<{ refreshed: boolean }> {
  let claimed = false;
  try {
    const [g] = await sql()<{ shared: boolean | null }[]>`SELECT bool_or(shared_client AND x_user_id IS NULL) AS shared FROM installations WHERE COALESCE(builder_id, id) = ${id}`;
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
          console.error(`[refresh] ${step}`, readError(err));
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
  const [q] = await sql()<{ done_at: Date | null; reason: string }[]>`SELECT done_at, reason FROM discovery_queue WHERE builder_id = ${id}`;
  if (q?.done_at && now.getTime() - q.done_at.getTime() < REFRESH_DISCOVER_MS) return;
  await discoverPerson(id, o);
}

type LiveDue = { id: number; builder_id: number; kind: string; ref: string; state: string };

/**
 * The refresh's reads: every tracked source of the person not read in the last REFRESH_MS (verified
 * ones, plus the agent's proposed repos, sites and packages for display). One GraphQL query for their
 * repos (others by name), one npm bulk call, one request per site. R16b: contracts, coins and merged PRs
 * are not read (their callers and traders fed only people and money). Each answer
 * goes to source_live (never source_readings: the daily history stays the cron's); a failure is
 * `ok = false` and is not retried. A spent GitHub budget writes nothing; the deadline stops the reads.
 * `only`: just these sources, read now even within REFRESH_MS of their last read (the App connect reads the
 * one repo it proved, R5: a refresh may have tried it, as a proposed repo, moments before). `soft`: a failed
 * read writes nothing, so an earlier good live reading still counts and the next refresh reads it again.
 */
export async function readPersonLive(id: number, now: Date, o: { deadline: number; reader: ReaderDeps; only?: number[]; soft?: boolean }): Promise<{ read: number; failed: number }> {
  const db = sql();
  const due = await db<LiveDue[]>`
    SELECT b.id::int AS id, b.builder_id, b.kind, b.ref, b.state
    FROM builder_sources b LEFT JOIN source_live l ON l.source_id = b.id
    WHERE b.builder_id = ${id} ${o.only ? db`AND b.id IN ${db(o.only.length ? o.only : [-1])}` : db``}
      AND b.kind IN ('repo', 'site', 'package_npm', 'package_pypi')
      AND (b.state = 'verified' OR (b.state = 'proposed'
          -- v2.13.1 O5 N4: a proposed repo is read only while it is the one project (never a replaced one).
          AND (b.kind <> 'repo' OR EXISTS (SELECT 1 FROM builder_profiles f WHERE f.builder_id = b.builder_id
            AND lower(f.main_project_key) = lower(b.project_key)))))
      AND (l.read_at IS NULL OR l.read_at <= ${new Date(now.getTime() - REFRESH_MS)} OR ${Boolean(o.only)}::boolean)
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
      if (o.soft) return;
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
      console.error('[refresh] read failed', group.map((s) => s.id).join(','), readError(err));
      for (const s of group) await put(s, { ok: false });
    }
    return true;
  };
  const done = () => ({ read, failed });

  // Repos: by name, REPOS_MAX a call (v2.13 R2: no person query).
  const repos = due.filter((s) => s.kind === 'repo');
  if (repos.length > 0) {
    const found = new Map<string, PersonRepo>();
    const asked = new Set<number>();
    // v2.14 A10: a repo proven by the read-only App is read with its installation's token first (a per-call
    // token, never kept); EarnKit's shared token reads by name only what isn't installed.
    const viaApp = new Map<number, PersonRepo>();
    const viaAppIds = new Set(
      (await db<{ id: number }[]>`SELECT id::int AS id FROM builder_sources WHERE id IN ${db(repos.map((s) => s.id))} AND proof = 'github_app' AND state = 'verified'`).map((r) => r.id),
    );
    // Launch-ready (hotfix carry-over): a short read's extra 52-week call runs only when needed (person-github.ts
    // needsAllWeeks). Fix round 1: "has a baseline" is the write's own lookup (previousRepoSignals with the repo as
    // read), asked only for a short read; a ref read for several sources has one only when every one of them has.
    const opts = {
      baseline: async (k: string, r: PersonRepo) => {
        for (const s of repos) if (s.ref.toLowerCase() === k && needsPushCheck(await previousRepoSignals(s.id, r))) return false;
        return true;
      },
    };
    /** Fix round 1: what GitHub said refusing a repo on its own alias (logged when the App can't read it either). */
    const refused = new Map<string, string>();
    for (const s of repos.filter((x) => viaAppIds.has(x.id))) {
      const go = await attempt([s], async () => {
        for (const [k, r] of await readAppRepos([s], o.reader, opts)) viaApp.set(k, r);
        asked.add(s.id);
      });
      if (!go) return done();
    }
    const byName = repos.filter((s) => !viaAppIds.has(s.id));
    for (let i = 0; i < byName.length; i += REPOS_MAX) {
      const batch = byName.slice(i, i + REPOS_MAX);
      const go = await attempt(batch, async () => {
        const got = await readGithubRepos(batch.map((s) => s.ref), o.reader, opts);
        for (const [k, r] of got.repos) found.set(k, r);
        for (const [k, why] of got.refused) refused.set(k, why);
        for (const s of batch) {
          const err = got.failed.get(s.ref.toLowerCase());
          if (err === undefined) {
            asked.add(s.id);
            continue;
          }
          // One repo's failed weekly call fails only its own reading.
          console.error('[refresh] read failed', s.id, readError(err));
          await put(s, { ok: false });
        }
      });
      if (!go) return done();
    }
    // v2.13.3 (5): a repo EarnKit's token couldn't read, through the read-only App when this person
    // installed it on that repo (a per-call token, never kept).
    for (const s of byName.filter((x) => asked.has(x.id) && !found.has(x.ref.toLowerCase()))) {
      const go = await attempt([s], async () => {
        for (const [k, r] of await readAppRepos([s], o.reader, opts)) viaApp.set(k, r);
      });
      if (!go) return done();
    }
    for (const s of repos) {
      if (!asked.has(s.id)) continue; // a spent budget or a failed call (already written)
      const app = viaAppIds.has(s.id) || !found.has(s.ref.toLowerCase()) ? viaApp.get(s.id) : undefined;
      const r = app ?? found.get(s.ref.toLowerCase());
      if (!r) {
        const why = refused.get(s.ref.toLowerCase());
        if (why) console.error('[refresh] read failed', s.id, why);
        await put(s, { ok: false });
        continue;
      }
      // Fix round 2 (anti-backdating): the newest good reading, daily or live, decides what is new; a first
      // reading reads GitHub's push times (rule 4, within this read's deadline; a read the deadline skips stays unverified).
      const prev = await previousRepoSignals(s.id, r);
      const pushes = needsPushCheck(prev) && Date.now() < o.deadline ? await firstPushes(s, o.reader) : null;
      await put(s, { ok: true, signals: { ...r, ...storedCommits(r, prev, now, pushes) } });
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
  const rest = due.filter((x) => x.kind !== 'repo' && !bulk.includes(x));
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
 * not yet scored today (UTC), never a shared client; they are rescored while `deadline` allows, then one history row per person per day (the public score, or
 * on a held day the pending score the owner reviews).
 */
export async function scorePeopleV2(now: Date, o: { deadline: number; only?: number[] }): Promise<{ scored: number; held: number[] }> {
  const db = sql();
  const day = now.toISOString().slice(0, 10);
  const due = await db<{ builder_id: number }[]>`
    SELECT p.builder_id FROM builder_profiles p LEFT JOIN builder_live l USING (builder_id)
    WHERE NOT EXISTS (SELECT 1 FROM installations i WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND i.shared_client AND i.x_user_id IS NULL)
      -- Scoring and clarity: a live row of an older calibration is rescored at once (the deploy's catch-up).
      AND (l.calibration <> ${LIVE_CALIBRATION_V2}
        OR NOT EXISTS (SELECT 1 FROM builder_scores s WHERE s.builder_id = p.builder_id AND s.day = ${day})
        OR EXISTS (SELECT 1 FROM builder_sources b JOIN source_readings r ON r.source_id = b.id
          WHERE b.builder_id = p.builder_id AND r.at > COALESCE(l.computed_at, '-infinity'::timestamptz)))
      ${o.only ? db`AND p.builder_id IN ${db(o.only.length ? o.only : [-1])}` : db``}
    ORDER BY (l.calibration IS DISTINCT FROM ${LIVE_CALIBRATION_V2} AND l.builder_id IS NOT NULL) DESC, p.builder_id`;
  if (due.length === 0) return { scored: 0, held: [] };
  let scored = 0;
  const held: number[] = [];
  for (const { builder_id: id } of due) {
    if (Date.now() >= o.deadline) break;
    const r = await rescorePerson(id, now, { cron: true });
    scored++;
    if (r.held) held.push(id);
    const [row] = await db<{ score: number }[]>`
      INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, projects, ranked)
      SELECT builder_id, ${day},
        -- A held day keeps what the owner reviews: the pending score and its parts.
        COALESCE((pending->>'score')::smallint, score), 0, COALESCE(pending->'parts', parts), '{}'::jsonb,
        COALESCE(pending->>'formula', formula), COALESCE(pending->>'calibration', calibration), pending IS NOT NULL, NULL,
        COALESCE((pending->>'ranked')::boolean, ranked)
      FROM builder_live
      WHERE builder_id = ${id} ON CONFLICT (builder_id, day) DO NOTHING RETURNING score`;
    if (row)
      await noteEvent('score_computed', () => ({
        type: 'score_computed', dedupe_key: `score:${id}:${day}`, installation_id: id, detail: { score: row.score, calibration: LIVE_CALIBRATION_V2 },
      }));
  }
  return { scored, held };
}
