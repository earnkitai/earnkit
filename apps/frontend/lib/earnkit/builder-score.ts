import { countProject, moneyOf, ringWeights, type ActorFacts, type Touch } from './anti-farming';
import { sql } from './db';
import { discover, type LoginOf } from './discovery';
import { noteEvent } from './events';
import { readParams, secretMatches } from './http';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { FORMULA, computeScore, percentileOf, type Parts, type ProjectInput, type Scored } from './score';
import { LIVE_CALIBRATION, calibration } from './score-calibration';
import { readSources } from './sources'; // sources.ts never imports this file (READS_PER_RUN lives there)
import { defaultReaderDeps, isoWeek, type ContractSignals, type PackageSignals, type PrSignals, type ReaderDeps, type RepoSignals, type SiteSignals, type Who } from './source-readers';
import { vetoKey } from './veto';

/**
 * v2.12 spec 4 to 6: the builder score's cron steps (discover, readSources, scoreBuilders,
 * percentiles, profileEmpty), the review hold, and the owner's release (app/admin/scores).
 */

/** v2.12 spec 6: the four steps share at most this much of what remains of runCron's budget. */
export const SCORE_SLICE = 0.4;
/** The slice's end: at most SCORE_SLICE of what remains before `deadline`, never past it. Pure. */
export const scoreSliceEnd = (now: number, deadline: number) => Math.min(deadline, now + SCORE_SLICE * Math.max(0, deadline - now));
/** Plan R8: from this UTC hour a person is scored even when some sources were not read today. */
export const LATE_HOUR_UTC = 22;
export const HOLD = { jump: 30, oneSource: 0.8, minScore: 60 } as const;
export type EmptyReason = 'no_github' | 'nothing_live' | 'ownership_unproven' | 'read_failed';
/** `proof`: how the source was verified (a site counts as use only with a proof of its own, siteShowsUse). */
export type SourceRow = { id: number; kind: string; ref: string; project_key: string; owner_is_org: boolean; proof?: string | null };

/**
 * Whether a verified site's "up" readings count as the project being used (staying power): only
 * when the site itself is proven (earnkit.txt or DNS TXT) or it is the repo's own GitHub Pages host.
 * A site a repo merely links (homepage, CNAME, vercel.json, wrangler.toml) is shown, never scored:
 * anyone can link google.com. Pure.
 */
export function siteShowsUse(s: Pick<SourceRow, 'ref' | 'project_key' | 'proof'>): boolean {
  if (s.proof === 'earnkit_txt' || s.proof === 'dns_txt') return true;
  if (s.proof !== 'repo_link' || !URL.canParse(s.ref)) return false;
  const owner = s.project_key.split('/')[0]?.toLowerCase();
  return !!owner && new URL(s.ref).hostname.toLowerCase() === `${owner}.github.io`;
}
export type ReadingRow = { source_id: number; day: string; ok: boolean; signals: unknown };

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;
const d = (s: unknown) => new Date(typeof s === 'string' ? s : NaN);
const ok = (t: Date) => Number.isFinite(t.getTime());
/** score.ts has no NaN guard: every number reaching it is finite and non-negative. */
const fin = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/**
 * Readings to the formula's inputs (pure): per project, every touch through anti-farming, plus
 * merged-PR credit (R11) and downloads / 50. Each counted account is credited to the one source it
 * touched first, and each source's money is its share of the project's raw volume, so `perSource`
 * adds up to the project (the hold's one-source rule reads it). A contract's calls accumulate over
 * a year of readings, each call once; every other kind uses its latest successful reading.
 */
export function buildInputs(
  sources: SourceRow[],
  readings: ReadingRow[],
  ctx: { self: Set<string>; owner: Map<string, number>; edges: [number, number][]; person: number; now: Date },
): { projects: ProjectInput[]; perSource: Map<number, { users: number; money: number }> } {
  // The whole ringWeights() output (ring, ringOwner, clusterCap): a partner counts once per project.
  const ring = ringWeights(ctx.edges, ctx.person, ctx.owner);
  const good = readings.filter((r) => r.ok && r.signals && typeof r.signals === 'object');
  const latest = new Map<number, ReadingRow>();
  for (const r of good) if (!latest.has(r.source_id) || latest.get(r.source_id)!.day < r.day) latest.set(r.source_id, r);
  const inYear = (r: ReadingRow) => ctx.now.getTime() - d(`${r.day}T00:00:00Z`).getTime() <= YEAR_MS;
  const weekFloor = isoWeek(new Date(ctx.now.getTime() - 52 * 7 * DAY_MS));
  const projects: ProjectInput[] = [];
  const perSource = new Map<number, { users: number; money: number }>();
  for (const key of [...new Set(sources.map((s) => s.project_key))]) {
    const touches: Touch[] = [];
    const facts = new Map<string, ActorFacts>();
    const self = new Set(ctx.self);
    let extraUsers = 0;
    const extraOutcomes: { at: Date; weight: number }[] = [];
    let commitWeeks = new Set<string>();
    let lastUp: Date | null = null;
    const firstSource = new Map<string, { sid: number; at: number }>();
    const rawVolume = new Map<number, number>();
    const add = (sid: number, kind: Touch['kind'], w: Who, money = 0) => {
      const at = d(w?.at);
      if (typeof w?.id !== 'string' || !ok(at)) return;
      const id = w.id.toLowerCase();
      touches.push({ project: key, actor: id, kind, at, volume_usd: fin(money) });
      if (w.created_at !== undefined) facts.set(id, { ...facts.get(id), created_at: w.created_at ? d(w.created_at) : null });
      const f = firstSource.get(id);
      if (!f || at.getTime() < f.at) firstSource.set(id, { sid, at: at.getTime() });
      rawVolume.set(sid, (rawVolume.get(sid) ?? 0) + fin(money));
    };
    for (const s of sources.filter((x) => x.project_key === key)) {
      const r = latest.get(s.id);
      if (s.kind === 'repo' && r) {
        const g = r.signals as Partial<RepoSignals>;
        // Members of their own org never count (spec 5): every contributor of an org repo is self.
        if (s.owner_is_org) for (const c of list<Who>(g.contributors)) if (typeof c?.id === 'string') self.add(c.id.toLowerCase());
        for (const w of list<Who>(g.stargazers)) add(s.id, 'stargazer', w);
        for (const w of list<Who>(g.forkers)) add(s.id, 'forker', w);
        for (const w of list<Who>(g.issue_authors)) add(s.id, 'issue_author', w);
        for (const w of list<Who>(g.contributors)) add(s.id, 'contributor', w);
        commitWeeks = new Set([...commitWeeks, ...list<unknown>(g.commit_weeks).filter((w): w is string => typeof w === 'string')]);
      }
      if (s.kind === 'contract') {
        const seen = new Set<string>();
        for (const rr of good.filter((x) => x.source_id === s.id && inYear(x)))
          for (const c of list<ContractSignals['callers'][number]>((rr.signals as Partial<ContractSignals>).callers)) {
            // Readings overlap (each starts at the last read day): a call read twice is one call.
            const once = `${c?.id}|${c?.at}|${c?.value_usd}`;
            if (seen.has(once)) continue;
            seen.add(once);
            add(s.id, 'caller', c, c.value_usd);
            // first_tx_at is never filled in v2.12: unknown counts at the strict 50% (R12).
            if (typeof c?.id === 'string') facts.set(c.id.toLowerCase(), { ...facts.get(c.id.toLowerCase()), first_tx_at: c.first_tx_at ? d(c.first_tx_at) : null });
          }
      }
      if ((s.kind === 'package_npm' || s.kind === 'package_pypi') && r) {
        const credit = fin((r.signals as Partial<PackageSignals>).weekly) / 50;
        extraUsers += credit;
        if (credit > 0) extraOutcomes.push({ at: d(`${r.day}T00:00:00Z`), weight: credit });
        perSource.set(s.id, { users: credit, money: 0 });
      }
      if (s.kind === 'merged_pr' && r) {
        const p = r.signals as Partial<PrSignals>;
        const credit = Math.min(5, Math.log10(1 + fin(p.target_stars)));
        extraUsers += credit;
        const merged = d(p.merged_at);
        if (credit > 0 && ok(merged)) extraOutcomes.push({ at: merged, weight: credit });
        perSource.set(s.id, { users: credit, money: 0 });
      }
      if (s.kind === 'site' && siteShowsUse(s))
        for (const rr of good.filter((x) => x.source_id === s.id && inYear(x) && (x.signals as Partial<SiteSignals>).up === true)) {
          const day = d(`${rr.day}T00:00:00Z`);
          if (ok(day) && (!lastUp || day > lastUp)) lastUp = day;
        }
    }
    const c = countProject(key, touches, { self, actors: facts, ...ring });
    const money = moneyOf(c);
    const volume = [...rawVolume.values()].reduce((n, x) => n + x, 0);
    for (const sid of rawVolume.keys()) perSource.set(sid, { users: 0, money: volume > 0 ? (money * rawVolume.get(sid)!) / volume : 0 });
    for (const [actor, f] of firstSource) perSource.get(f.sid)!.users += c.actors.get(actor) ?? 0;
    const outcomes = [...c.outcomes, ...extraOutcomes];
    const times = outcomes.map((o) => o.at.getTime());
    const first = times.length ? new Date(Math.min(...times)) : null;
    const lastTouch = times.length ? new Date(Math.max(...times)) : null;
    const up = lastUp as Date | null;
    const lastUsed = lastTouch && up && up > lastTouch ? up : lastTouch;
    projects.push({
      key, title: key, users: c.users + extraUsers, money_usd: money, outcomes,
      first_outcome_at: first, last_used_at: lastUsed,
      commit_weeks: [...commitWeeks].filter((w) => w >= weekFloor).sort(),
    });
  }
  return { projects, perSource };
}

export function holdReason(prev: number | null, next: number, shares: number[]): 'jump' | 'one_source' | null {
  if (prev !== null && next - prev >= HOLD.jump) return 'jump';
  if (next >= HOLD.minScore && shares.some((s) => s > HOLD.oneSource)) return 'one_source';
  return null;
}

/**
 * Each source's share of the outcomes the score stands on: its part of the users and money points
 * over both. Every other part derives from those outcomes, so one source holding all users is 1.0
 * (a share of the total score could never pass 0.8 at 60+, since users top out at 45). Pure.
 */
export function sourceShares(perSource: Map<number, { users: number; money: number }>, s: Scored): number[] {
  const denom = s.parts.users.points + s.parts.money.points;
  if (denom === 0) return [];
  const U = s.parts.users.raw.U || 1;
  const M = s.parts.money.raw.M || 1;
  return [...perSource.values()].map((x) => ((x.users / U) * s.parts.users.points + (x.money / M) * s.parts.money.points) / denom);
}

/**
 * The single thing that would fill an empty profile (spec 3). With a proven login and nothing found
 * it is 'nothing_live' (there is nothing to link); without one, proposed sources are
 * 'ownership_unproven' and none is 'no_github' (plan R4).
 */
export function emptyReason(f: { login: boolean; proposed: number; verified: number; okReadings: number; failedReadings: number }): EmptyReason {
  if (f.verified === 0) return f.proposed > 0 ? 'ownership_unproven' : f.login ? 'nothing_live' : 'no_github';
  if (f.okReadings === 0 && f.failedReadings > 0) return 'read_failed';
  return 'nothing_live';
}

/** The person's public score: the latest row not held, or held and released (plan R7, R8). */
export async function publicScore(builderId: number): Promise<{ score: number; percentile: number; day: string; parts: Parts } | null> {
  const [row] = await sql()<{ score: number; percentile: number; day: string; parts: Parts }[]>`
    SELECT s.score, COALESCE(r.percentile, s.percentile) AS percentile, s.day::text AS day, s.parts
    FROM builder_scores s LEFT JOIN builder_ranks r ON r.builder_id = s.builder_id
    WHERE s.builder_id = ${builderId}
      AND (NOT s.held OR EXISTS (SELECT 1 FROM score_releases x WHERE x.builder_id = s.builder_id AND x.day = s.day))
    ORDER BY s.day DESC LIMIT 1`;
  return row ?? null;
}

/** Who is due today (R8): no score today, not a shared client (R2), and every verified source read today or it's late. */
async function dueToday(day: string, late: boolean, only?: number[]) {
  return sql()<{ builder_id: number }[]>`
    SELECT p.builder_id FROM builder_profiles p
    WHERE NOT EXISTS (SELECT 1 FROM builder_scores s WHERE s.builder_id = p.builder_id AND s.day = ${day})
      AND NOT EXISTS (SELECT 1 FROM installations i WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND i.shared_client)
      AND (${late} OR NOT EXISTS (SELECT 1 FROM builder_sources b WHERE b.builder_id = p.builder_id AND b.state = 'verified'
        AND (b.last_read_day IS NULL OR b.last_read_day < ${day}::date)))
      ${only ? sql()`AND p.builder_id IN ${sql()(only.length ? only : [-1])}` : sql()``}
    ORDER BY p.builder_id`;
}

/**
 * spec 6, step 3: one score row per due person per UTC day (R8), with the formula and calibration
 * ids, the parts' raw inputs and the hold verdict. A held row sets builder_profiles.held and never
 * reaches a public surface until the owner releases it (score_releases).
 */
export async function scoreBuilders(now: Date, o: { deadline: number; only?: number[] }): Promise<{ scored: number; held: number[] }> {
  const day = now.toISOString().slice(0, 10);
  const cal = calibration(LIVE_CALIBRATION);
  const due = await dueToday(day, now.getUTCHours() >= LATE_HOUR_UTC, o.only);
  if (due.length === 0) return { scored: 0, held: [] };
  // Who owns which account, for self-exclusion and rings (spec 5): proven logins and every group wallet.
  const owners = await sql()<{ actor: string; builder_id: number }[]>`
    SELECT 'gh:' || lower(github_login) AS actor, builder_id FROM builder_profiles WHERE github_login IS NOT NULL
    UNION ALL
    SELECT 'wallet:' || lower(w.wallet), COALESCE(i.builder_id, i.id) FROM installation_wallets w JOIN installations i ON i.id = w.installation_id`;
  const owner = new Map(owners.map((r) => [r.actor, r.builder_id]));
  const edges = await ringEdges(owner);
  const all = (await sql()<{ score: number }[]>`SELECT score FROM builder_ranks`).map((r) => r.score);
  let scored = 0;
  const held: number[] = [];
  for (const { builder_id: id } of due) {
    if (Date.now() >= o.deadline) break;
    const sources = await sql()<SourceRow[]>`
      SELECT b.id::int AS id, b.kind, b.ref, b.project_key, b.proof,
        (b.kind = 'repo' AND lower(split_part(b.ref, '/', 1)) <> lower(COALESCE(p.github_login, ''))) AS owner_is_org
      FROM builder_sources b JOIN builder_profiles p USING (builder_id)
      WHERE b.builder_id = ${id} AND b.state = 'verified'`;
    const readings = sources.length === 0 ? [] : await sql()<ReadingRow[]>`
      SELECT source_id::int AS source_id, day::text AS day, ok, signals FROM source_readings
      WHERE source_id IN ${sql()(sources.map((s) => s.id))} AND day > ${new Date(now.getTime() - YEAR_MS)}`;
    // Every account of the person's group is self, even one another group also names.
    const self = new Set(owners.filter((r) => r.builder_id === id).map((r) => r.actor));
    const { projects, perSource } = buildInputs(sources, readings, { self, owner, edges, person: id, now });
    const s = computeScore(projects, cal, now);
    const prev = await publicScore(id);
    const reason = holdReason(prev?.score ?? null, s.score, sourceShares(perSource, s));
    const top = s.top ? { key: s.top.key, title: s.top.title, users: Math.round(s.top.users), money_usd: Math.round(s.top.money_usd) } : {};
    const [row] = await sql()<{ id: string }[]>`
      INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
      VALUES (${id}, ${day}, ${s.score}, ${percentileOf(s.score, all)}, ${sql().json(s.parts as never)}, ${sql().json(top as never)}, ${FORMULA}, ${cal.id}, ${reason !== null})
      ON CONFLICT (builder_id, day) DO NOTHING RETURNING id`;
    if (!row) continue;
    scored++;
    await noteEvent('score_computed', () => ({ type: 'score_computed', dedupe_key: `score:${id}:${day}`, installation_id: id, detail: { score: s.score, calibration: cal.id } }));
    if (!reason) {
      // A later day's score came in unheld: it is the public one now, so nothing waits on the owner.
      await sql()`UPDATE builder_profiles SET held = false, updated_at = now() WHERE builder_id = ${id} AND held`;
    } else {
      held.push(id);
      await sql()`UPDATE builder_profiles SET held = true, updated_at = now() WHERE builder_id = ${id}`;
      await noteEvent('score_held', () => ({ type: 'score_held', dedupe_key: `score_held:${id}:${day}`, installation_id: id, detail: { reason, score: s.score, previous: prev?.score ?? null } }));
    }
  }
  return { scored, held };
}

/** Person pairs where one's account is a counted touch of the other's verified sources (latest readings). */
async function ringEdges(owner: Map<string, number>): Promise<[number, number][]> {
  const rows = await sql()<{ builder_id: number; actor: string }[]>`
    SELECT DISTINCT b.builder_id, lower(a.actor) AS actor FROM builder_sources b
    JOIN LATERAL (SELECT signals FROM source_readings r WHERE r.source_id = b.id AND r.ok ORDER BY r.day DESC LIMIT 1) last ON true
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements(
        CASE WHEN jsonb_typeof(last.signals->'stargazers') = 'array' THEN last.signals->'stargazers' ELSE '[]'::jsonb END ||
        CASE WHEN jsonb_typeof(last.signals->'forkers') = 'array' THEN last.signals->'forkers' ELSE '[]'::jsonb END ||
        CASE WHEN jsonb_typeof(last.signals->'callers') = 'array' THEN last.signals->'callers' ELSE '[]'::jsonb END)->>'id' AS actor) a
    WHERE b.state = 'verified' AND a.actor IS NOT NULL`;
  const out: [number, number][] = [];
  for (const r of rows) {
    const counter = owner.get(r.actor);
    if (counter !== undefined && counter !== r.builder_id) out.push([counter, r.builder_id]);
  }
  return out;
}

/** Plan R7: every person's public score and percentile (hidden included, held at the last unheld) in one SQL pass. */
export async function percentiles(now: Date): Promise<number> {
  const rows = await sql()<{ n: number }[]>`
    WITH pub AS (
      SELECT DISTINCT ON (s.builder_id) s.builder_id, s.score FROM builder_scores s
      WHERE NOT s.held OR EXISTS (SELECT 1 FROM score_releases x WHERE x.builder_id = s.builder_id AND x.day = s.day)
      ORDER BY s.builder_id, s.day DESC),
    ranked AS (
      SELECT builder_id, score, 100.0 * (rank() OVER (ORDER BY score) - 1) / count(*) OVER () AS percentile FROM pub),
    up AS (
      INSERT INTO builder_ranks (builder_id, score, percentile, computed_at)
      SELECT builder_id, score, percentile, ${now} FROM ranked
      ON CONFLICT (builder_id) DO UPDATE SET score = EXCLUDED.score, percentile = EXCLUDED.percentile, computed_at = EXCLUDED.computed_at
      RETURNING 1)
    SELECT count(*)::int AS n FROM up`;
  return rows[0].n;
}

/**
 * spec 3's metric: once per person, 10 minutes after their first find, a profile with no score
 * above 0 gets one profile_empty event naming what would fill it. `only`: these people (tests).
 */
export async function profileEmpty(now: Date, o: { only?: number[] } = {}): Promise<number> {
  const due = await sql()<{ builder_id: number; login: boolean; proposed: number; verified: number; ok_r: number; failed_r: number; filled: boolean }[]>`
    SELECT p.builder_id, p.github_login IS NOT NULL AS login,
      (SELECT count(*)::int FROM builder_sources b WHERE b.builder_id = p.builder_id AND b.state = 'proposed') AS proposed,
      (SELECT count(*)::int FROM builder_sources b WHERE b.builder_id = p.builder_id AND b.state = 'verified') AS verified,
      (SELECT count(*)::int FROM source_readings r JOIN builder_sources b ON b.id = r.source_id WHERE b.builder_id = p.builder_id AND r.ok) AS ok_r,
      (SELECT count(*)::int FROM source_readings r JOIN builder_sources b ON b.id = r.source_id WHERE b.builder_id = p.builder_id AND NOT r.ok) AS failed_r,
      EXISTS (SELECT 1 FROM builder_scores s WHERE s.builder_id = p.builder_id AND s.score > 0) AS filled
    FROM builder_profiles p
    WHERE p.empty_checked_at IS NULL AND p.first_find_at <= ${new Date(now.getTime() - 10 * 60_000)}
      ${o.only ? sql()`AND p.builder_id IN ${sql()(o.only.length ? o.only : [-1])}` : sql()``}`;
  let n = 0;
  for (const r of due) {
    const [claimed] = await sql()`UPDATE builder_profiles SET empty_checked_at = ${now} WHERE builder_id = ${r.builder_id} AND empty_checked_at IS NULL RETURNING 1`;
    if (!claimed || r.filled) continue;
    const missing = emptyReason({ login: r.login, proposed: r.proposed, verified: r.verified, okReadings: r.ok_r, failedReadings: r.failed_r });
    await noteEvent('profile_empty', () => ({ type: 'profile_empty', dedupe_key: `profile_empty:${r.builder_id}`, installation_id: r.builder_id, detail: { missing } }));
    n++;
  }
  return n;
}

/** Everyone whose profile is held now (not only this run's holds), for the cron's needs_owner. `only`: these people. */
export async function heldPeople(only?: number[]): Promise<number[]> {
  const rows = await sql()<{ builder_id: number }[]>`
    SELECT builder_id FROM builder_profiles WHERE held
      ${only ? sql()`AND builder_id IN ${sql()(only.length ? only : [-1])}` : sql()``}
    ORDER BY builder_id`;
  return rows.map((r) => r.builder_id);
}

export type ScoreCronDeps = { reader?: ReaderDeps; login?: LoginOf; only?: number[] };

/**
 * spec 6: discover, readSources, scoreBuilders, percentiles then profileEmpty, each failing soft,
 * none started after `sliceEnd`. One ReaderDeps for the whole run, so its GitHub budget is shared.
 */
export async function runScoreSteps(now: Date, sliceEnd: number, deps: ScoreCronDeps = {}): Promise<Record<string, unknown>> {
  const reader = deps.reader ?? defaultReaderDeps(now, sliceEnd);
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    if (Date.now() >= sliceEnd) return void (out[name] = { step: 'skipped' });
    try {
      out[name] = await fn();
    } catch (err) {
      console.error(`[cron] builder score ${name}`, err instanceof Error ? err.name : 'error');
      out[name] = { step: 'error' };
    }
  };
  await step('discover', () => discover(now, { deadline: sliceEnd, reader, login: deps.login, only: deps.only }));
  await step('read', () => readSources(now, { deadline: sliceEnd, reader, only: deps.only }));
  await step('score', () => scoreBuilders(now, { deadline: sliceEnd, only: deps.only }));
  await step('ranks', () => percentiles(now));
  await step('empty', () => profileEmpty(now, { only: deps.only }));
  return out;
}

// 'admin:' keeps this key apart from every campaign veto key (vetoKey(slug)); bonus keys use 'bonus:'.
export const scoresAdminKey = (secret = process.env.ADMIN_VETO_SECRET) => vetoKey('admin:scores', secret);

/** A real calendar day 'YYYY-MM-DD'. Pure. */
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * POST /api/admin/scores (form: key, builder, day): releases a held day (a score_releases row,
 * never an UPDATE of builder_scores). Only a held day can be released; the profile stays held while
 * a newer held day waits. Rate limited per IP; a wrong key is a 404; otherwise back to the page (303).
 */
export async function scoresPost(request: Request, deps: { limit?: (ip: string) => Promise<unknown> } = {}): Promise<Response> {
  try {
    await (deps.limit ?? ((ip: string) => enforce('veto', ip, 'Too many review requests from this address.')))(clientIp(request.headers));
  } catch (err) {
    if (err instanceof RateLimitError) return new Response('Too many requests', { status: 429 });
    throw err;
  }
  const form = await readParams(request);
  const key = form.get('key') ?? '';
  const expected = scoresAdminKey();
  if (expected === null || !secretMatches(key, expected)) return new Response('Not found', { status: 404 });
  const id = Number(form.get('builder'));
  const day = form.get('day') ?? '';
  if (Number.isInteger(id) && id > 0 && id <= 2_147_483_647 && isDay(day)) {
    const released = await sql()`
      INSERT INTO score_releases (builder_id, day)
      SELECT ${id}, ${day}::date WHERE EXISTS (SELECT 1 FROM builder_scores WHERE builder_id = ${id} AND day = ${day}::date AND held)
      ON CONFLICT DO NOTHING RETURNING day`;
    if (released.length > 0)
      await sql()`
        UPDATE builder_profiles SET updated_at = now(), held = EXISTS (
          SELECT 1 FROM builder_scores s WHERE s.builder_id = ${id} AND s.held AND s.day > ${day}::date
            AND NOT EXISTS (SELECT 1 FROM score_releases x WHERE x.builder_id = s.builder_id AND x.day = s.day))
        WHERE builder_id = ${id}`;
  }
  return new Response(null, { status: 303, headers: { Location: `/admin/scores?key=${encodeURIComponent(key)}` } });
}
