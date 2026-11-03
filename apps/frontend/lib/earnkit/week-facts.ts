import { sql, type Db } from './db';
import { noteEvent } from './events';
import { poolChanged } from './profile-cache';
import { benchConfirmedSql } from './main-project';
import { weekCounts } from './person-score';
import { COIN_PROGRAM } from './policy-constants';
import { awardWeekPoints, type ApproveVia } from './points';
import { hit, windowStart } from './rate-limit';
import { APP_PROOF, appClient } from './repo-proof';
import { repoReadPublic } from './repo-public';
import { TITLES_MAX, namesRepo, readWeekTitles, shipTitles } from './ship-titles';
import { SUMMARY_TITLES_MAX, weekSummary, type SummaryCreate } from './week-summary';
import { REPO_READER } from './sources';
import { lastFinishedMonday, streakOf, weekOfMonday } from './weeks';

/**
 * v2.13 spec "The facts": what EarnKit checked itself about one project in one ISO week, pinned to
 * that week's project_updates row (plan B6). The update's text never sets them.
 */
export type WeekFacts = {
  shipped_code?: { n: number }; went_live?: true;
  /** Old rows only: R16b stopped counting people and money, so no new row has users_up or earned. */
  users_up?: { n: number }; earned?: { usd: number };
  won?: { title: string }[]; streak?: { w: number }; started?: { live: boolean; weeks: number; people?: number }; checked?: true;
  /** R13: the week's titles read completed (the backfill and its catch-up; never read again). */
  titles_read?: true;
  /**
   * Hotfix 2026-10-19: the repo reader version (sources.ts REPO_READER) of the reading the facts came from. A backfill
   * week is done only when written from a current reading, so a week written from a short reading (a busy repo's
   * newest 100 commits) is redone once.
   */
  reader?: number;
  /** The builder's yes at the weekly moment (weekly-moment.ts approveWeek); a week without it reads UNCONFIRMED_LABEL. */
  approved?: boolean; approved_at?: string; approved_via?: string;
  /** Owner batch fix round: the stored summary at the latest approval (week-summary.ts summaryConsented). */
  approved_summary?: string | null;
  /** Owner batch fix wave: a summary offered once without being shown (weekly-moment.ts markOffered). */
  offered_summary?: string;
};
/** The terms' promise: an unconfirmed week is shown, marked this. Lives in update-links.ts so the card (a client component) never imports this server module. */
export { UNCONFIRMED_LABEL } from './update-links';
export const WEEKLY_HOUR_UTC = 15;
export const WEEKLY_PER_RUN = 200;
const DAY = 86_400_000;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The week's chips, in the order the card shows them. Scoring and clarity: shipping facts only (people,
 * money and a community round are stored but never a chip). Pure.
 */
export function factChips(f: WeekFacts): string[] {
  const out: string[] = [];
  if (f.went_live) out.push('Went live');
  for (const w of f.won ?? []) out.push(`Won ${w.title}`);
  if (f.shipped_code && f.shipped_code.n > 0) out.push(plural(f.shipped_code.n, 'commit', 'commits'));
  if (f.streak && f.streak.w >= 2) out.push(`${f.streak.w} weeks in a row`);
  return out;
}
export const startedLine = (name: string) => `Started tracking ${name}.`;
export function startedChips(s: NonNullable<WeekFacts['started']>): string[] {
  return [
    ...(s.live ? ['Live'] : []),
    ...(s.weeks > 0 ? [plural(s.weeks, 'week shipping', 'weeks shipping')] : []),
  ];
}
/** A fact is shipped code, going live or a win; a streak, people, money, the start or the check alone is not. Pure. */
/**
 * v4.10.3 final fix (F5): the builder confirmed the week (their own yes: share, connect or email). EarnKit's automatic
 * add ('auto') puts the week on the page but is no confirmation, so the page and the feed still read UNCONFIRMED_LABEL.
 * Pure.
 */
export const weekConfirmed = (f: WeekFacts | null | undefined): boolean => f?.approved === true && f.approved_via !== 'auto';
export const hasFacts = (f: WeekFacts): boolean => Boolean((f.shipped_code?.n ?? 0) > 0 || f.went_live || (f.won?.length ?? 0) > 0);

/**
 * The progress points of one week's facts (a start is not progress). R16b: shipping facts only (went live,
 * a win, commits, the streak); an old row's people and money count nothing. Ties go to the builder's
 * Shipping score (feedRows). Pure.
 */
export function pointsOf(f: WeekFacts): number {
  let p = 0;
  if (f.went_live) p += 40;
  if ((f.won?.length ?? 0) > 0) p += 40;
  if (f.shipped_code && f.shipped_code.n > 0) p += 10;
  if (f.streak && f.streak.w > 0) p += Math.min(10, f.streak.w);
  return Math.round(p);
}

/**
 * The one reading the ship log reads for a repo source `s` (a LATERAL subquery): the newest good one, live or daily,
 * preferring one the current reader wrote (sources.ts REPO_READER). Launch-ready (hotfix carry-over): a reader-1
 * reading (a busy repo's newest 100 commits only) newer than a reader-2 one would otherwise write short weeks.
 */
export const shipReading = (db: Db) => db`(
  SELECT y.signals FROM (
    (SELECT l.signals, l.read_at AS at FROM source_live l WHERE l.source_id = s.id AND l.ok)
    UNION ALL (SELECT r.signals, r.day::timestamptz AS at FROM source_readings r WHERE r.source_id = s.id AND r.ok
      ORDER BY COALESCE((r.signals->>'reader')::numeric, 0) >= ${REPO_READER} DESC, r.day DESC LIMIT 1)
  ) y ORDER BY COALESCE((y.signals->>'reader')::numeric, 0) >= ${REPO_READER} DESC, y.at DESC LIMIT 1)`;

/**
 * When the project `key` first went live, as one SQL expression: the earliest of its hosted deploy, its deployed
 * contract and its verified site's first good reading that said up. Null when never.
 */
const firstLiveSql = (db: Db, builderId: number, key: string) => db`LEAST(
      (SELECT min(h.deployed_at) FROM hosted_sites h JOIN installations i ON i.id = h.installation_id WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND lower(h.repo_key) = lower(${key})),
      (SELECT min(d.created_at) FROM contract_deploys d JOIN installations i ON i.id = d.installation_id WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND d.status = 'deployed' AND lower(d.repo_key) = lower(${key})),
      (SELECT min(r.day)::timestamptz FROM source_readings r JOIN builder_sources s ON s.id = r.source_id
        WHERE s.builder_id = ${builderId} AND s.kind = 'site' AND s.state = 'verified' AND lower(s.project_key) = lower(${key}) AND r.ok AND r.signals->>'up' = 'true')
    )`;
/** v3.1 one-tap posts: when the person's project `key` first went live (firstLiveSql), or null. */
export async function firstLiveAt(builderId: number, key: string): Promise<Date | null> {
  const db = sql();
  const [r] = await db<{ first: Date | null }[]>`SELECT ${firstLiveSql(db, builderId, key)} AS first`;
  return r?.first ?? null;
}

/** The facts of the person's one project for the ISO week starting `monday`; {} unless that project is confirmed. */
export async function weekFactsFor(builderId: number, monday: string, now: Date): Promise<WeekFacts> {
  const week = weekOfMonday(monday);
  if (!week) return {};
  const db = sql();
  const [p] = await db<{ key: string; commit_weeks: string[] }[]>`
    SELECT b.project_key AS key, b.commit_weeks FROM builder_profiles f JOIN builder_projects b ON b.builder_id = f.builder_id AND lower(b.project_key) = lower(f.main_project_key)
    WHERE f.builder_id = ${builderId} AND ${benchConfirmedSql(db)}`;
  if (!p) return {};
  const start = new Date(`${monday}T00:00:00Z`);
  const end = new Date(start.getTime() + 7 * DAY);
  const f: WeekFacts = {};
  // shipped_code: the main repo's newest good reading (live or daily), its count for the week. R13 fix round 1: only a
  // week the reading counts by the anti-backdating floor (person-score.ts weekCounts), for the weekly job and the
  // backfill alike; from commit_counts, never commit_weeks (GitHub's stats endpoint lags: 202 gives []).
  const [repo] = await db<{ counts: Record<string, number> | null; created_at: unknown; pushes_checked: unknown }[]>`
    SELECT x.signals->'commit_counts' AS counts, x.signals->'created_at' AS created_at, x.signals->'pushes_checked' AS pushes_checked FROM builder_sources s
    JOIN LATERAL ${shipReading(db)} x ON true
    WHERE s.builder_id = ${builderId} AND s.kind = 'repo' AND s.state = 'verified' AND lower(s.project_key) = lower(${p.key})`;
  const n = Number(repo?.counts?.[week] ?? 0);
  if (n > 0 && weekCounts(repo!, week, now)) f.shipped_code = { n };
  // went_live: the first live moment ever falls in this week, and no week was said to before.
  const [live] = await db<{ first: Date | null; said: boolean }[]>`
    SELECT ${firstLiveSql(db, builderId, p.key)} AS first,
    EXISTS (SELECT 1 FROM builder_events e WHERE e.type = 'went_live' AND lower(e.repo_key) = lower(${p.key})) AS said`;
  if (live?.first && !live.said && live.first >= start && live.first < end) f.went_live = true;
  // R16b: no users_up or earned facts (people and money are no longer counted); a program win stays a fact.
  const outcomes = await db<{ title: string; result: string }[]>`
    SELECT g.title, o.result FROM entry_outcomes o JOIN projects x ON x.id = o.project_id JOIN programs g ON g.id = o.program_id
    JOIN installations i ON i.id = x.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND o.basis = 'announcement' AND o.captured_at >= ${start} AND o.captured_at < ${end}
      AND x.program_id <> ${COIN_PROGRAM} AND lower(COALESCE(x.repo_key, x.token_repo_key)) = lower(${p.key}) ORDER BY o.captured_at`;
  const won = outcomes.filter((x) => x.result === 'won' || x.result === 'placed').map((x) => ({ title: x.title }));
  if (won.length > 0) f.won = won;
  // streak: this week had code (the rescored commit weeks, or the count just read above, which rescore may not have yet),
  // and the run of commit weeks ending here is 2 or more (the one definition: site-streak.ts, never deploys or sites).
  const code = new Set(p.commit_weeks.filter((x) => x <= week));
  if (f.shipped_code) code.add(week);
  if (code.has(week)) {
    const w = streakOf(code, new Date(start.getTime() + DAY));
    if (w >= 2) f.streak = { w };
  }
  return f;
}

/**
 * The week's row for the project: facts merged in, text, pins and hides kept; v2.14 spec 3: the week's
 * titles (ship-titles.ts) replace the stored ones only when there are some. Another builder's row is left
 * alone. True when a row was written. v3 final review: an approved row that now has facts and no points row earns its
 * points (awardWeekPoints, via its approved_via).
 */
export async function upsertWeekFacts(builderId: number, projectKey: string, monday: string, f: WeekFacts, titles: string[] = [], summary: string | null = null): Promise<boolean> {
  const wrote = await sql()`
    INSERT INTO project_updates (builder_id, project_key, week, facts, titles, summary) VALUES (${builderId}, ${projectKey}, ${monday}, ${sql().json(f as never)}, ${titles}::text[], ${summary})
    ON CONFLICT (project_key, week) DO UPDATE SET facts = project_updates.facts || EXCLUDED.facts,
      titles = CASE WHEN cardinality(EXCLUDED.titles) > 0 THEN EXCLUDED.titles ELSE project_updates.titles END,
      summary = COALESCE(EXCLUDED.summary, project_updates.summary)
    WHERE project_updates.builder_id = EXCLUDED.builder_id RETURNING id::int AS id, facts, points::int AS points`;
  // v3: the points are written with the week (the feed shows points > 0), not left to the daily rank step.
  const row = wrote[0] as { id: number; facts: WeekFacts; points: number } | undefined;
  if (row) {
    const p = hasFacts(row.facts) ? pointsOf(row.facts) : 0;
    if (p !== row.points) await sql()`UPDATE project_updates SET points = ${p} WHERE id = ${row.id}`;
    // v3 final review: a week approved before its facts arrived earns its points now, once (awardWeekPoints is one row a week).
    if (row.facts.approved && hasFacts(row.facts)) {
      const [had] = await sql()`SELECT 1 FROM builder_points WHERE builder_id = ${builderId} AND week = ${monday}`;
      if (!had) {
        const v = row.facts.approved_via;
        // v4.10.3 final fix (F4): an automatic week ('auto') awards nothing (awardWeekPoints).
        const via: ApproveVia = v === 'connect' || v === 'email' || v === 'auto' ? v : 'share';
        await awardWeekPoints(builderId, monday, via, new Date())
          .catch((err: unknown) => console.error('[points] retro award', err instanceof Error ? err.name : 'error'));
      }
    }
  }
  return wrote.length > 0;
}

/** Weekly updates: the week's titles (at most TITLES_MAX shown) and its summary (week-summary.ts). */
export type WeekWork = { titles: string[]; summary: string | null };
const NO_WORK: WeekWork = { titles: [], summary: null };

/**
 * v2.14 spec 3 (A11): the week's cleaned titles of the person's App-proven repo `key`, read with its installation
 * token (repo-proof.ts appClient); [] for any other repo. A repo that doesn't read public (repo-public.ts) and has
 * titles off: one GET /repos/{key} through the same client checks it (fix round 1; a public answer stamps
 * builder_sources.public_at); a private one is still read for its AI summary (owner batch 2026-10-23; only with a
 * model, `summarize` or ANTHROPIC_API_KEY) but its titles are not returned. At most 3 GitHub calls (plus the
 * token). Only called for a week with shipped code (writeWeek). Weekly updates: also the week's summary, from up
 * to SUMMARY_TITLES_MAX titles.
 */
export async function weekTitles(id: number, key: string, monday: string, now: Date, ghFetch: typeof fetch, summarize?: SummaryCreate | null): Promise<WeekWork> {
  const db = sql();
  const k = key.toLowerCase();
  const [app] = await db<{ id: number; titles_on: boolean }[]>`
    SELECT s.id::int AS id, (p.ship_titles_at IS NOT NULL) AS titles_on FROM builder_sources s JOIN builder_profiles p ON p.builder_id = s.builder_id
    WHERE s.builder_id = ${id} AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = ${APP_PROOF}
      AND regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', '') = ${k}`;
  if (!app) return NO_WORK;
  const get = await appClient(id, k, ghFetch);
  if (!get) return NO_WORK;
  let isPublic = await repoReadPublic(id, k, now);
  if (!isPublic && !app.titles_on) {
    const meta = await get<{ private?: unknown }>(`/repos/${k}`);
    if (meta?.private === false) {
      await db`UPDATE builder_sources SET public_at = ${now} WHERE id = ${app.id}`;
      isPublic = true;
    } else if (meta?.private !== true) return NO_WORK;
  }
  // A private repo with titles off is read only for its AI summary: with no model, not at all.
  const aiOff = summarize === null || (summarize === undefined && !process.env.ANTHROPIC_API_KEY);
  if (!isPublic && !app.titles_on && aiOff) return NO_WORK;
  // updates.ts imports this file: ownLinks is loaded when called.
  const own = await (await import('./updates')).ownLinks(id);
  const all = shipTitles(await readWeekTitles(get, k, monday), own, SUMMARY_TITLES_MAX);
  // Security review: the model never sees the project's name, and a private repo's titles naming it never reach it.
  const fed = isPublic && !app.titles_on ? all : all.filter((t) => !namesRepo(t, k));
  // Owner batch 2026-10-23: a private repo's week gets an AI summary too (shown only once the builder approves the
  // week, week-summary.ts summaryShown); its titles are stored only while titles are on.
  const summary = fed.length > 0 ? await weekSummary({ titles: fed, own, ...(!isPublic && { privateRepo: { repoKey: k } }) }, summarize) : null;
  return { titles: isPublic || app.titles_on ? all.slice(0, TITLES_MAX) : [], summary };
}

/**
 * R13: one finished week of the person's one project, as the weekly job writes it: the week's facts
 * (weekFactsFor), its titles when it shipped code (weekTitles), the row (upsertWeekFacts, facts.checked), then one
 * dated event per fact (dedupe key `<type>:<project_key>:<week>`). Shared by the weekly job and the backfill.
 The anti-backdating floor is weekFactsFor's (one rule for both). The backfill's options (the weekly job passes none):
 * - `deadline`: titles are fetched only before it (the caller's ghFetch carries the per-call abort).
 * - `mark`: a week with shipped code whose titles read completed is stamped facts.titles_read, so the catch-up never
 *   reads it again. Completed: a titles call on the repo answered ok (GET /repos/{key} for the private check, or its
 *   commits and pulls) and no call failed (an answer other than ok or 404, or a throw). A token or client that came
 *   back null without such a call, or a failed or skipped read, leaves it for the catch-up.
 * - `summarize`: the model call for the week's summary (tests); default Haiku with ANTHROPIC_API_KEY.
 * `wrote`: false when another builder's row holds the week (nothing written, no events).
 */
export async function writeWeek(
  p: { id: number; key: string }, monday: string, now: Date,
  d: { ghFetch?: typeof fetch; deadline?: number; mark?: boolean; summarize?: SummaryCreate | null } = {},
): Promise<{ wrote: boolean; facts: WeekFacts; titled: boolean }> {
  const { id, key } = p;
  const week = weekOfMonday(monday)!;
  const f = await weekFactsFor(id, monday, now);
  // v2.14 spec 3 (A11): the week's titles (weekTitles). Fix round 1: a failure there never stops the facts.
  let work: WeekWork = NO_WORK;
  let titled = !f.shipped_code;
  if (f.shipped_code && d.ghFetch && (d.deadline === undefined || Date.now() < d.deadline)) {
    const base = d.ghFetch;
    let failed = false;
    let read = false;
    const k = key.toLowerCase();
    const repoPaths = new Set([`/repos/${k}`, `/repos/${k}/commits`, `/repos/${k}/pulls`]);
    const tracked = (async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const res = await base(input, init);
        if (!res.ok && res.status !== 404) failed = true;
        if (res.ok && repoPaths.has(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname.toLowerCase())) read = true;
        return res;
      } catch (err) {
        failed = true;
        throw err;
      }
    }) as typeof fetch;
    work = await weekTitles(id, key, monday, now, tracked, d.summarize).catch((err: unknown) => {
      console.error('[weekly] titles', err instanceof Error ? err.name : 'error');
      failed = true;
      return NO_WORK;
    });
    titled = read && !failed;
  }
  const reader = Number((await readingOf(id, key))?.reader ?? 0) || 0;
  const facts: WeekFacts = { ...f, checked: true, ...(d.mark && f.shipped_code && titled && { titles_read: true as const }), ...(reader > 0 && { reader }) };
  if (!(await upsertWeekFacts(id, key, monday, facts, work.titles, work.summary))) return { wrote: false, facts, titled };
  const at = new Date(`${monday}T12:00:00Z`);
  // R16b: weekFactsFor never sets users_up (people aren't counted), so no users_up event is written.
  const ev = (type: 'shipped_code' | 'went_live', detail: Record<string, unknown>) =>
    noteEvent(type, () => ({ type, dedupe_key: `${type}:${key.toLowerCase()}:${week}`, installation_id: id, repo_key: key.toLowerCase(), at, detail }));
  if (f.shipped_code) await ev('shipped_code', { n: f.shipped_code.n, week });
  if (f.went_live) await ev('went_live', { week });
  return { wrote: true, facts, titled };
}

/**
 * spec "Cost": Mondays, after the digest (from 15:00 UTC), the finished week's facts for every
 * confirmed one project not done yet (facts.checked), WEEKLY_PER_RUN a run while `deadline` allows;
 * then one dated event per fact and project and week (dedupe key `<type>:<project_key>:<week>`).
 * Shared clients never. F2: an unconfirmed one project (perhaps someone else's repo) writes nothing.
 * R13: the per-week body is writeWeek (also the backfill's).
 */
export async function weeklyFactsStep(now: Date, o: { deadline: number; only?: number[]; ghFetch?: typeof fetch }): Promise<{ step: 'skipped' } | { people: number; rows: number }> {
  if (now.getUTCDay() !== 1 || now.getUTCHours() < WEEKLY_HOUR_UTC) return { step: 'skipped' };
  const monday = lastFinishedMonday(now);
  const db = sql();
  const due = await db<{ id: number; key: string }[]>`
    SELECT p.builder_id AS id, b.project_key AS key FROM builder_profiles p
    JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(db)}
    WHERE NOT EXISTS (SELECT 1 FROM installations i WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND i.shared_client AND i.x_user_id IS NULL)
      -- Per (project_key, week), any builder: done once checked, and never due while another builder's
      -- row holds the week (checked or not, e.g. Started only). By ruling the first confirmed owner of a
      -- shared repo keeps the ship log; a later owner (whose upsert writes nothing) must never be due
      -- every run, crowding the WEEKLY_PER_RUN slots.
      AND NOT EXISTS (SELECT 1 FROM project_updates u WHERE lower(u.project_key) = lower(b.project_key) AND u.week = ${monday}
        AND (u.facts ? 'checked' OR u.builder_id <> p.builder_id))
      ${o.only ? db`AND p.builder_id IN ${db(o.only.length ? o.only : [-1])}` : db``}
    ORDER BY p.builder_id LIMIT ${WEEKLY_PER_RUN}`;
  let people = 0;
  let rows = 0;
  for (const p of due) {
    if (Date.now() >= o.deadline) break;
    people++;
    if ((await writeWeek(p, monday, now, { ghFetch: o.ghFetch })).wrote) rows++;
  }
  if (rows > 0) poolChanged();
  return { people, rows };
}

/** R13: the backfill covers this many finished weeks (lastFinishedMonday and the ones before it). */
export const BACKFILL_WEEKS = 3;
/** R13: the hourly catch-up's bound: projects a run, and tries a project a UTC day (rate_windows). */
export const BACKFILL_PER_RUN = 20;
export const BACKFILL_TRIES_A_DAY = 3;

/** The backfill's Mondays, newest first. Pure. */
export function backfillMondays(now: Date): string[] {
  const last = Date.parse(`${lastFinishedMonday(now)}T00:00:00Z`);
  return Array.from({ length: BACKFILL_WEEKS }, (_, i) => new Date(last - i * 7 * DAY).toISOString().slice(0, 10));
}

/**
 * The repo reading the ship log's facts come from (weekFactsFor's, shipReading) of the person's verified repo source
 * filed under `key`; null when there is none.
 */
async function readingOf(builderId: number, key: string): Promise<Record<string, unknown> | null> {
  const db = sql();
  const [r] = await db<{ signals: Record<string, unknown> }[]>`
    SELECT x.signals FROM builder_sources s
    JOIN LATERAL ${shipReading(db)} x ON true
    WHERE s.builder_id = ${builderId} AND s.kind = 'repo' AND s.state = 'verified' AND lower(s.project_key) = lower(${key})
    LIMIT 1`;
  return r?.signals ?? null;
}

/**
 * R13: the ship log's last BACKFILL_WEEKS finished weeks for the person's confirmed one project `key`, newest
 * first, each through writeWeek, while `deadline` allows. A week is skipped when its row is done (checked, and
 * titled, or no shipped code, or its titles read completed) or another builder's row holds it. Nothing is written
 * until the repo has a good reading whose push check passed (anti-backdating: an unverified reading waits; the
 * catch-up picks it up once a read verifies it). `done`: every week is complete (nothing left for the catch-up).
 */
export async function backfillWeeks(
  p: { id: number; key: string }, now: Date, o: { deadline: number; ghFetch?: typeof fetch; mondays?: string[] },
): Promise<{ rows: number; done: boolean }> {
  const reading = await readingOf(p.id, p.key);
  // Hotfix 2026-10-19: also wait for a reading of the current reader (a short one would write short weeks).
  if (!reading || reading.pushes_checked === false || !(Number(reading.reader) >= REPO_READER)) return { rows: 0, done: false };
  const mondays = o.mondays ?? backfillMondays(now);
  const have = await sql()<{ week: string; builder_id: number; done: boolean }[]>`
    SELECT week::text AS week, builder_id::int AS builder_id,
      (facts ? 'checked' AND COALESCE((facts->>'reader')::numeric, 0) >= ${REPO_READER}
        AND (NOT (facts ? 'shipped_code') OR cardinality(titles) > 0 OR facts ? 'titles_read')) AS done
    FROM project_updates WHERE lower(project_key) = lower(${p.key}) AND week IN ${sql()(mondays)}`;
  let rows = 0;
  let done = true;
  for (const monday of mondays) {
    const row = have.find((h) => h.week === monday);
    if (row && (row.builder_id !== p.id || row.done)) continue;
    if (Date.now() >= o.deadline) {
      done = false;
      break;
    }
    const w = await writeWeek(p, monday, now, { ghFetch: o.ghFetch, deadline: o.deadline, mark: true });
    if (w.wrote) rows++;
    if (w.wrote && w.facts.shipped_code && !w.titled) done = false;
  }
  // Hotfix 2026-10-19: a written week can put a card in the feed and the landing carousel.
  if (rows > 0) poolChanged();
  return { rows, done };
}

/**
 * R13: the backfill at the first App connect (repo-proof.ts proveByApp, after its read and rescore): only when the
 * proved repo is the person's confirmed one project (shared clients never), within the connect's `deadline`.
 */
export async function backfillOnConnect(builderId: number, repoKey: string, now: Date, o: { deadline: number; ghFetch?: typeof fetch }): Promise<{ rows: number; done: boolean }> {
  const db = sql();
  const [p] = await db<{ key: string }[]>`
    SELECT b.project_key AS key FROM builder_profiles p
    JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(db)}
    WHERE p.builder_id = ${builderId} AND lower(b.project_key) = ${repoKey.toLowerCase()}
      AND NOT EXISTS (SELECT 1 FROM installations i WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND i.shared_client AND i.x_user_id IS NULL)`;
  if (!p) return { rows: 0, done: false };
  return backfillWeeks({ id: builderId, key: p.key }, now, o);
}

/**
 * R13: the hourly catch-up for the backfill: App-proven confirmed one projects (shared clients never) missing
 * any of their backfill weeks' rows, or with a checked row that shipped code but has no titles and no completed
 * titles read, whose repo reading is good and verified. BACKFILL_PER_RUN a run, each tried at most
 * BACKFILL_TRIES_A_DAY times a UTC day (so a repo whose titles keep failing never takes every run's slots), while
 * `deadline` allows. The newest finished week waits for the weekly job until its Monday slot (WEEKLY_HOUR_UTC).
 */
export async function backfillStep(now: Date, o: { deadline: number; only?: number[]; ghFetch?: typeof fetch }): Promise<{ people: number; rows: number }> {
  const all = backfillMondays(now);
  const mondays = now.getUTCDay() === 1 && now.getUTCHours() < WEEKLY_HOUR_UTC ? all.slice(1) : all;
  const db = sql();
  const day = windowStart(now, DAY);
  const due = await db<{ id: number; key: string }[]>`
    SELECT p.builder_id AS id, b.project_key AS key FROM builder_profiles p
    JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(db)}
    WHERE NOT EXISTS (SELECT 1 FROM installations i WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND i.shared_client AND i.x_user_id IS NULL)
      -- App-proven, with a good reading (readingOf's) whose push check passed.
      AND EXISTS (SELECT 1 FROM builder_sources s
        JOIN LATERAL ${shipReading(db)} x ON true
        WHERE s.builder_id = p.builder_id AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = ${APP_PROOF}
          AND lower(s.project_key) = lower(b.project_key) AND x.signals->'pushes_checked' IS DISTINCT FROM 'false'::jsonb
          AND COALESCE((x.signals->>'reader')::numeric, 0) >= ${REPO_READER})
      AND EXISTS (SELECT 1 FROM unnest(${mondays}::date[]) m(week) WHERE NOT EXISTS (
        SELECT 1 FROM project_updates u WHERE lower(u.project_key) = lower(b.project_key) AND u.week = m.week
          AND (u.builder_id <> p.builder_id OR (u.facts ? 'checked' AND COALESCE((u.facts->>'reader')::numeric, 0) >= ${REPO_READER}
            AND (NOT (u.facts ? 'shipped_code') OR cardinality(u.titles) > 0 OR u.facts ? 'titles_read')))))
      AND NOT EXISTS (SELECT 1 FROM rate_windows w WHERE w.key = 'backfill:' || p.builder_id AND w.window_start = ${day} AND w.count >= ${BACKFILL_TRIES_A_DAY})
      ${o.only ? db`AND p.builder_id IN ${db(o.only.length ? o.only : [-1])}` : db``}
    ORDER BY p.builder_id LIMIT ${BACKFILL_PER_RUN}`;
  let people = 0;
  let rows = 0;
  for (const p of due) {
    if (Date.now() >= o.deadline) break;
    await hit(`backfill:${p.id}`, BACKFILL_TRIES_A_DAY, DAY / 1000, now);
    people++;
    rows += (await backfillWeeks(p, now, { deadline: o.deadline, ghFetch: o.ghFetch, mondays })).rows;
  }
  return { people, rows };
}
