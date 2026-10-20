import { countProject, moneyOf, ringWeights, type ActorFacts, type Touch } from './anti-farming';
import { sql, type Db } from './db';
import { discover, type LoginOf } from './discovery';
import { ownPagesSite } from './discovery-clues';
import { noteEvent } from './events';
import { scorePeopleV2 } from './person-score'; // person-score imports this file too: functions only, called after load
import { clearXHandle, releaseXClear } from './profiles';
import { readParams, secretMatches } from './http';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { type ProjectInput, type Scored } from './score';
import { calibration, type Calibration } from './score-calibration';
import { readSources } from './sources'; // sources.ts never imports this file (READS_PER_RUN lives there)
import { READ_CAPS, defaultReaderDeps, isoWeek, type ContractSignals, type PackageSignals, type PrSignals, type ReaderDeps, type RepoSignals, type SiteSignals, type Who } from './source-readers';
import { vetoKey } from './veto';
import { feedRankStep } from './feed'; // feed imports person-score: functions only, called after load
import { appCheckStep, orgProofExpiryStep } from './repo-proof';
import { originalityStep, type Embed } from './originality';
import { backfillStep, weeklyFactsStep } from './week-facts'; // week-facts imports person-score, which imports this file: functions only, called after load

/**
 * v2.12 spec 4 to 6: the builder score's cron steps (discover, readSources, score, profileEmpty;
 * v2.12.1: the score step is person-score.ts scorePeopleV2), the review hold, and the owner's
 * release (app/admin/scores). v2.12.1 T12: the v1 scorer (scoreBuilders), its percentile pass and
 * publicScore are gone; buildInputs and sourceShares stay as the tested record of v1's rules (score.ts
 * keeps formula v1 for stored history).
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
  return s.proof === 'repo_link' && ownPagesSite(s.ref, s.project_key);
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
 *
 * v2.12 final review: a package counts at most `cal.package_users` (I6). Merged PRs count once per
 * target repo, at most `cal.pr_target_users` each, for the top READ_CAPS.prs targets, and all of them
 * are ONE source in `perSource` (keyed by the lowest merged_pr source id), so the one-source hold
 * sees a PR farm as one source (I2). A contributor's reading time is not when they contributed, so a
 * person whose first touch is as a contributor still counts as a user but adds no dated outcome:
 * no recency, no "still used" (I3).
 */
export function buildInputs(
  sources: SourceRow[],
  readings: ReadingRow[],
  ctx: { self: Set<string>; owner: Map<string, number>; edges: [number, number][]; person: number; now: Date; cal?: Calibration },
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
  const cal = ctx.cal ?? calibration();
  for (const key of [...new Set(sources.map((s) => s.project_key))]) {
    const touches: Touch[] = [];
    const facts = new Map<string, ActorFacts>();
    const self = new Set(ctx.self);
    let extraUsers = 0;
    const extraOutcomes: { at: Date; weight: number }[] = [];
    let commitWeeks = new Set<string>();
    let lastUp: Date | null = null;
    const firstSource = new Map<string, { sid: number; at: number; kind: Touch['kind'] }>();
    const rawVolume = new Map<number, number>();
    // Merged PRs by target repo: the best credit and the newest merge (I2).
    const prTargets = new Map<string, { credit: number; merged: Date | null }>();
    let prSource: number | null = null;
    const add = (sid: number, kind: Touch['kind'], w: Who, money = 0) => {
      const at = d(w?.at);
      if (typeof w?.id !== 'string' || !ok(at)) return;
      const id = w.id.toLowerCase();
      touches.push({ project: key, actor: id, kind, at, volume_usd: fin(money) });
      if (w.created_at !== undefined) facts.set(id, { ...facts.get(id), created_at: w.created_at ? d(w.created_at) : null });
      const f = firstSource.get(id);
      if (!f || at.getTime() < f.at) firstSource.set(id, { sid, at: at.getTime(), kind });
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
        const credit = Math.min(cal.package_users, fin((r.signals as Partial<PackageSignals>).weekly) / 50);
        extraUsers += credit;
        if (credit > 0) extraOutcomes.push({ at: d(`${r.day}T00:00:00Z`), weight: credit });
        perSource.set(s.id, { users: credit, money: 0 });
      }
      if (s.kind === 'merged_pr' && r) {
        const p = r.signals as Partial<PrSignals>;
        const target = (typeof p.target === 'string' && p.target ? p.target : s.ref).toLowerCase();
        const credit = Math.min(cal.pr_target_users, Math.log10(1 + fin(p.target_stars)));
        const merged = d(p.merged_at);
        const t = prTargets.get(target) ?? { credit: 0, merged: null };
        prTargets.set(target, { credit: Math.max(t.credit, credit), merged: ok(merged) && (!t.merged || merged > t.merged) ? merged : t.merged });
        prSource = prSource === null ? s.id : Math.min(prSource, s.id);
      }
      if (s.kind === 'site' && siteShowsUse(s))
        for (const rr of good.filter((x) => x.source_id === s.id && inYear(x) && (x.signals as Partial<SiteSignals>).up === true)) {
          const day = d(`${rr.day}T00:00:00Z`);
          if (ok(day) && (!lastUp || day > lastUp)) lastUp = day;
        }
    }
    if (prSource !== null) {
      const best = [...prTargets.values()].sort((a, b) => b.credit - a.credit).slice(0, READ_CAPS.prs);
      const credit = best.reduce((n, t) => n + t.credit, 0);
      extraUsers += credit;
      for (const t of best) if (t.credit > 0 && t.merged) extraOutcomes.push({ at: t.merged, weight: t.credit });
      perSource.set(prSource, { users: credit, money: 0 });
    }
    const c = countProject(key, touches, { self, actors: facts, ...ring });
    const money = moneyOf(c);
    const volume = [...rawVolume.values()].reduce((n, x) => n + x, 0);
    for (const sid of rawVolume.keys()) perSource.set(sid, { users: 0, money: volume > 0 ? (money * rawVolume.get(sid)!) / volume : 0 });
    for (const [actor, f] of firstSource) perSource.get(f.sid)!.users += c.actors.get(actor) ?? 0;
    // countProject's outcomes, minus anyone first seen as a contributor (read time, not their contribution: I3).
    const counted = [...c.actors]
      .filter(([a, w]) => w > 0 && firstSource.get(a)?.kind !== 'contributor')
      .map(([a, w]) => ({ at: new Date(firstSource.get(a)!.at), weight: w }));
    const outcomes = [...counted, ...extraOutcomes];
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

/** A builder_scores row `s` is public: not held, or held and released (plan R7, R8). One rule for every reader. */
export const publicRow = () => sql()`(NOT s.held OR EXISTS (SELECT 1 FROM score_releases x WHERE x.builder_id = s.builder_id AND x.day = s.day
  AND (x.score IS NULL OR x.score = s.score OR s.score = ANY(x.scores))))`;

/**
 * v2 release of `score` for a day: `score` becomes the newest released one (the hold baseline) and
 * joins `scores`, so a history row public under an earlier release that day stays public.
 */
const releaseV2 = (tx: Db, id: number, day: string, score: number) => tx`
  INSERT INTO score_releases (builder_id, day, score, scores) VALUES (${id}, ${day}::date, ${score}, ARRAY[${score}]::smallint[])
  ON CONFLICT (builder_id, day) DO UPDATE SET score = EXCLUDED.score, released_at = now(),
    scores = (SELECT COALESCE(array_agg(DISTINCT v), '{}') FROM unnest(score_releases.scores || score_releases.score || EXCLUDED.score) v WHERE v IS NOT NULL)
  RETURNING day`;

type EmptyFacts = { builder_id: number; login: boolean; proposed: number; verified: number; ok_r: number; failed_r: number; filled: boolean };
/** profileEmpty's per-person facts (`p` is builder_profiles). */
const emptyFacts = () => sql()`
  p.builder_id, p.github_login IS NOT NULL AS login,
  (SELECT count(*)::int FROM builder_sources b WHERE b.builder_id = p.builder_id AND b.state = 'proposed') AS proposed,
  (SELECT count(*)::int FROM builder_sources b WHERE b.builder_id = p.builder_id AND b.state = 'verified') AS verified,
  (SELECT count(*)::int FROM source_readings r JOIN builder_sources b ON b.id = r.source_id WHERE b.builder_id = p.builder_id AND r.ok) AS ok_r,
  (SELECT count(*)::int FROM source_readings r JOIN builder_sources b ON b.id = r.source_id WHERE b.builder_id = p.builder_id AND NOT r.ok) AS failed_r,
  EXISTS (SELECT 1 FROM builder_scores s WHERE s.builder_id = p.builder_id AND s.score > 0) AS filled`;
const reasonOf = (r: EmptyFacts) => emptyReason({ login: r.login, proposed: r.proposed, verified: r.verified, okReadings: r.ok_r, failedReadings: r.failed_r });

/**
 * spec 3's metric: once per person, 10 minutes after their first find, a profile with no score
 * above 0 gets one profile_empty event naming what would fill it. `only`: these people (tests).
 */
export async function profileEmpty(now: Date, o: { only?: number[] } = {}): Promise<number> {
  const due = await sql()<EmptyFacts[]>`
    SELECT ${emptyFacts()}
    FROM builder_profiles p
    WHERE p.empty_checked_at IS NULL AND p.first_find_at <= ${new Date(now.getTime() - 10 * 60_000)}
      ${o.only ? sql()`AND p.builder_id IN ${sql()(o.only.length ? o.only : [-1])}` : sql()``}`;
  let n = 0;
  for (const r of due) {
    const [claimed] = await sql()`UPDATE builder_profiles SET empty_checked_at = ${now} WHERE builder_id = ${r.builder_id} AND empty_checked_at IS NULL RETURNING 1`;
    if (!claimed || r.filled) continue;
    const missing = reasonOf(r);
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

/** `embed`: Originality's embedder (default: a child process, originality.ts workerEmbed); tests pass a fake. */
export type ScoreCronDeps = { reader?: ReaderDeps; login?: LoginOf; only?: number[]; embed?: Embed };

/**
 * spec 6: discover, readSources, score (v2.12.1: scorePeopleV2, the live score; the rank is read
 * live, so no percentile pass) then profileEmpty, each failing soft, none started after `sliceEnd`.
 * One ReaderDeps for the whole run, so its GitHub budget is shared.
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
  // v2.13.2 (1): org repos' proof branches (before v2.14) expire after 90 days (daily, bounded); the re-proof is the App.
  await step('proof_expiry', () => orgProofExpiryStep(now, { only: deps.only, deadline: sliceEnd }));
  // v2.14 A8: an App-proven repo GitHub no longer lists an installation for goes back to proposed (daily per source).
  await step('app_check', () => appCheckStep(now, { deadline: sliceEnd, only: deps.only, fetch: reader.ghFetch }));
  await step('discover', () => discover(now, { deadline: sliceEnd, reader, login: deps.login, only: deps.only }));
  await step('read', () => readSources(now, { deadline: sliceEnd, reader, only: deps.only }));
  await step('score', () => scorePeopleV2(now, { deadline: sliceEnd, only: deps.only }));
  await step('empty', () => profileEmpty(now, { only: deps.only }));
  // Scoring and clarity R3: Originality for main projects whose text changed (bounded; never ranked).
  await step('originality', () => originalityStep(now, { deadline: sliceEnd, only: deps.only, ghFetch: reader.ghFetch, embed: deps.embed }));
  // v2.13 spec "Cost": the weekly facts (Mondays from 15:00 UTC; v3 Stage 1: the digest follows, from 16:00).
  await step('weekly', () => weeklyFactsStep(now, { deadline: sliceEnd, only: deps.only, ghFetch: reader.ghFetch }));
  // R13: the backfill's catch-up (App-proven projects missing their last 3 finished weeks or their titles; bounded).
  await step('backfill', () => backfillStep(now, { deadline: sliceEnd, only: deps.only, ghFetch: reader.ghFetch }));
  // v2.13 spec "Cost": the feed rank, once a day (F11: from 15:00 UTC, after the weekly step).
  await step('feed', () => feedRankStep(now));
  return out;
}

/**
 * One held person on /admin/scores: what waits for the owner and the score the public sees now.
 * `version` (v2): the pending rescore's id, posted back so a release applies exactly what was shown.
 */
export type HeldReview = {
  builder_id: number; slug: string; day: string; score: number; formula: string; parts: unknown; top_outcome: Record<string, unknown>;
  shown: { score: number; day: string } | null; version: string | null;
};
/**
 * /admin/scores's rows. v1: each held person's newest held day not yet released, beside their public
 * v1 score. v2 (v2.12.1): everyone whose live rescore waits in builder_live.pending (the current
 * one, however many rescores the day had, and also when today's history row was written unheld),
 * beside the public live score (a held first score is public 0). History rows are append-only, so
 * the review reads the pending rescore itself.
 */
export async function heldForReview(): Promise<HeldReview[]> {
  const v1 = await sql()<Omit<HeldReview, 'shown' | 'version'>[]>`
    SELECT p.builder_id, p.slug, s.day::text AS day, s.score, s.formula, s.parts, s.top_outcome
    FROM builder_profiles p
    JOIN LATERAL (
      SELECT day, score, formula, parts, top_outcome FROM builder_scores s
      WHERE s.builder_id = p.builder_id AND s.held AND s.formula = 'v1'
        AND NOT EXISTS (SELECT 1 FROM score_releases x WHERE x.builder_id = s.builder_id AND x.day = s.day)
      ORDER BY s.day DESC LIMIT 1) s ON true
    WHERE p.held`;
  const v2 = await sql()<(Omit<HeldReview, 'shown'> & { live: number; live_day: string })[]>`
    SELECT p.builder_id, p.slug, COALESCE(l.pending->>'day', l.computed_at::date::text) AS day,
      (l.pending->>'score')::int AS score, 'v2' AS formula, l.pending->'parts' AS parts, '{}'::jsonb AS top_outcome,
      l.pending->>'at' AS version, l.score AS live, l.computed_at::date::text AS live_day
    FROM builder_live l JOIN builder_profiles p USING (builder_id)
    WHERE l.pending IS NOT NULL`;
  const rows: HeldReview[] = [
    ...(await Promise.all(v1.map(async (h) => {
      // The public v1 score beside it: the latest v1 row not held, or held and released (plan R7).
      const [pub] = await sql()<{ score: number; day: string }[]>`
        SELECT s.score, s.day::text AS day FROM builder_scores s
        WHERE s.builder_id = ${h.builder_id} AND s.formula = 'v1' AND ${publicRow()}
        ORDER BY s.day DESC LIMIT 1`;
      return { ...h, shown: pub ? { score: pub.score, day: pub.day } : null, version: null };
    }))),
    ...v2.map(({ live, live_day, ...h }) => ({ ...h, shown: { score: live, day: live_day } })),
  ];
  return rows.sort((a, b) => a.day.localeCompare(b.day) || a.builder_id - b.builder_id);
}

const round1 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);
/** A score's parts as review lines ('used: 36 (U 267.4, people 267.4)'), any formula's shape; junk reads 0. Pure. */
export function partLines(parts: unknown): string[] {
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return [];
  return Object.entries(parts as Record<string, { points?: unknown; raw?: unknown } | null>).map(([name, part]) => {
    const raw = part?.raw && typeof part.raw === 'object' ? Object.entries(part.raw as Record<string, unknown>) : [];
    return `${name}: ${round1(part?.points)} (${raw.map(([k, v]) => `${k} ${round1(v)}`).join(', ')})`;
  });
}

// 'admin:' keeps this key apart from every campaign veto key (vetoKey(slug)); bonus keys use 'bonus:'.
export const scoresAdminKey = (secret = process.env.ADMIN_VETO_SECRET) => vetoKey('admin:scores', secret);
/** The owner's /admin/scores link (pnpm campaign scores-link prints it); never sent anywhere by EarnKit. */
export const scoresAdminLink = (origin: string, secret = process.env.ADMIN_VETO_SECRET) => {
  const key = scoresAdminKey(secret);
  return key ? `${origin.replace(/\/$/, '')}/admin/scores?key=${key}` : null;
};

const staleRelease = () =>
  new Response('This held score changed after it was put up for review, so it was not released. Reload the review page and look at the new one.', {
    status: 409, headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

/** A real calendar day 'YYYY-MM-DD'. Pure. */
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * POST /api/admin/scores (form: key, builder, day, or action=clear_x / release_x and builder): releases a held day (a score_releases row,
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
  const valid = Number.isInteger(id) && id > 0 && id <= 2_147_483_647;
  // v2.12 T7 review: "Clear X handle" (a self-declared handle in conflict, or one the owner rules out).
  const version = form.get('version');
  if (form.get('action') === 'clear_x') {
    if (valid) await clearXHandle(id, 'owner');
  } else if (form.get('action') === 'release_x') {
    // Final fix wave: the owner's clear sticks until the owner releases it here.
    if (valid) await releaseXClear(id);
  } else if (valid && version) {
    // v2.12.1: release the pending live rescore the owner saw (its `at`), if it is still the pending
    // one; a newer rescore since is refused once (reload shows it), never forever.
    const outcome = await sql().begin(async (tx) => {
      const [live] = await tx<{ pending: { at?: unknown; day?: unknown; score?: unknown } | null }[]>`SELECT pending FROM builder_live WHERE builder_id = ${id} FOR UPDATE`;
      const pending = live?.pending ?? null;
      if (!pending || pending.at !== version) return 'stale';
      await tx`
        UPDATE builder_live SET score = (pending->>'score')::smallint, parts = pending->'parts', ranked = (pending->>'ranked')::boolean,
          shipped = (pending->>'shipped')::int, people = (pending->>'people')::int, formula = pending->>'formula',
          calibration = pending->>'calibration', pending = NULL
        WHERE builder_id = ${id}`;
      // Only the reviewed score becomes public: the release names it, so that day's history row is
      // public only if it holds this score, and it is the next days' baseline. A held day the owner
      // never saw stays private.
      const pday = typeof pending.day === 'string' && isDay(pending.day) ? pending.day : null;
      if (pday) await releaseV2(tx, id, pday, Number(pending.score));
      // Still held only while another day waits: a later held v2 day, or a v1 held day, not public.
      await tx`
        UPDATE builder_profiles SET updated_at = now(), held = EXISTS (
          SELECT 1 FROM builder_scores s WHERE s.builder_id = ${id} AND s.held AND NOT ${publicRow()}
            AND (s.formula = 'v1' OR s.day > ${pday ?? '0001-01-01'}::date))
        WHERE builder_id = ${id}`;
      return 'released';
    });
    if (outcome === 'stale') return staleRelease();
  } else if (valid && isDay(day)) {
    const outcome = await sql().begin(async (tx) => {
      // v2.12.1: a held v2 day is what the owner reviewed (the pending score of that day). Released
      // only while builder_live.pending is still that score; a later rescore changed it: refused.
      const [live] = await tx<{ pending: { day?: unknown; score?: unknown } | null }[]>`SELECT pending FROM builder_live WHERE builder_id = ${id} FOR UPDATE`;
      const [h] = await tx<{ score: number; formula: string; public: boolean }[]>`
        SELECT s.score, s.formula, ${publicRow()} AS public FROM builder_scores s WHERE s.builder_id = ${id} AND s.day = ${day}::date AND s.held`;
      if (!h || h.public) return 'none';
      const pending = live?.pending ?? null;
      // A v2 day is released only as the reviewed pending score of that day (the release names it);
      // nothing pending, or a pending score that changed, was never what the owner saw: refused.
      if (h.formula === 'v2' && (!pending || pending.day !== day || pending.score !== h.score)) return 'stale';
      const released = h.formula === 'v2'
        ? await releaseV2(tx, id, day, h.score)
        : await tx`INSERT INTO score_releases (builder_id, day) VALUES (${id}, ${day}::date) ON CONFLICT DO NOTHING RETURNING day`;
      if (released.length === 0) return 'none';
      // The reviewed pending score becomes the public live score.
      if (h.formula === 'v2')
        await tx`
          UPDATE builder_live SET score = (pending->>'score')::smallint, parts = pending->'parts', ranked = (pending->>'ranked')::boolean,
            shipped = (pending->>'shipped')::int, people = (pending->>'people')::int, formula = pending->>'formula',
            calibration = pending->>'calibration', pending = NULL
          WHERE builder_id = ${id}`;
      return 'released';
    });
    if (outcome === 'stale') return staleRelease();
    if (outcome === 'released') {
      await sql()`
        UPDATE builder_profiles SET updated_at = now(), held = EXISTS (
          SELECT 1 FROM builder_scores s WHERE s.builder_id = ${id} AND s.held AND NOT ${publicRow()}
            AND (s.formula = 'v1' OR s.day > ${day}::date))
        WHERE builder_id = ${id}`;
    }
  }
  return new Response(null, { status: 303, headers: { Location: `/admin/scores?key=${encodeURIComponent(key)}` } });
}
