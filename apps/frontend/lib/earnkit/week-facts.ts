import { sql } from './db';
import { noteEvent } from './events';
import { benchConfirmedSql } from './main-project';
import { personInputsV2 } from './person-score';
import { COIN_PROGRAM } from './policy-constants';
import { APP_PROOF, appClient } from './repo-proof';
import { repoReadPublic } from './repo-public';
import { readWeekTitles, shipTitles } from './ship-titles';
import { lastFinishedMonday, streakOf, weekOfMonday } from './weeks';

/**
 * v2.13 spec "The facts": what EarnKit checked itself about one project in one ISO week, pinned to
 * that week's project_updates row (plan B6). The update's text never sets them.
 */
export type WeekFacts = {
  shipped_code?: { n: number }; went_live?: true; users_up?: { n: number }; earned?: { usd: number };
  won?: { title: string }[]; streak?: { w: number }; started?: { live: boolean; weeks: number; people: number }; checked?: true;
};
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
export const hasFacts = (f: WeekFacts): boolean => Boolean((f.shipped_code?.n ?? 0) > 0 || f.went_live || (f.won?.length ?? 0) > 0);

/** The facts of the person's one project for the ISO week starting `monday`; {} unless that project is confirmed. */
export async function weekFactsFor(builderId: number, monday: string, now: Date): Promise<WeekFacts> {
  const week = weekOfMonday(monday);
  if (!week) return {};
  const db = sql();
  const [p] = await db<{ key: string; ship_weeks: string[] }[]>`
    SELECT b.project_key AS key, b.ship_weeks FROM builder_profiles f JOIN builder_projects b ON b.builder_id = f.builder_id AND lower(b.project_key) = lower(f.main_project_key)
    WHERE f.builder_id = ${builderId} AND ${benchConfirmedSql(db)}`;
  if (!p) return {};
  const start = new Date(`${monday}T00:00:00Z`);
  const end = new Date(start.getTime() + 7 * DAY);
  const f: WeekFacts = {};
  // shipped_code: the main repo's newest good reading (live or daily), its count for the week.
  const [repo] = await db<{ counts: Record<string, number> | null }[]>`
    SELECT x.signals->'commit_counts' AS counts FROM builder_sources s
    JOIN LATERAL ((SELECT l.signals, l.read_at AS at FROM source_live l WHERE l.source_id = s.id AND l.ok)
      UNION ALL (SELECT r.signals, r.day::timestamptz AS at FROM source_readings r WHERE r.source_id = s.id AND r.ok ORDER BY r.day DESC LIMIT 1)
      ORDER BY at DESC LIMIT 1) x ON true
    WHERE s.builder_id = ${builderId} AND s.kind = 'repo' AND s.state = 'verified' AND lower(s.project_key) = lower(${p.key})`;
  const n = Number(repo?.counts?.[week] ?? 0);
  if (n > 0) f.shipped_code = { n };
  // went_live: the first live moment ever falls in this week, and no week was said to before.
  const [live] = await db<{ first: Date | null; said: boolean }[]>`
    SELECT LEAST(
      (SELECT min(h.deployed_at) FROM hosted_sites h JOIN installations i ON i.id = h.installation_id WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND lower(h.repo_key) = lower(${p.key})),
      (SELECT min(d.created_at) FROM contract_deploys d JOIN installations i ON i.id = d.installation_id WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND d.status = 'deployed' AND lower(d.repo_key) = lower(${p.key})),
      (SELECT min(r.day)::timestamptz FROM source_readings r JOIN builder_sources s ON s.id = r.source_id
        WHERE s.builder_id = ${builderId} AND s.kind = 'site' AND s.state = 'verified' AND lower(s.project_key) = lower(${p.key}) AND r.ok AND r.signals->>'up' = 'true')
    ) AS first,
    EXISTS (SELECT 1 FROM builder_events e WHERE e.type = 'went_live' AND lower(e.repo_key) = lower(${p.key})) AS said`;
  if (live?.first && !live.said && live.first >= start && live.first < end) f.went_live = true;
  // users_up: counted people whose first touch fell in the week (the one project's inputs).
  const { newPeople } = await personInputsV2(builderId, now, undefined, db, { scope: p.key });
  const up = newPeople.get(p.key)?.[week] ?? 0;
  if (up > 0) f.users_up = { n: up };
  // earned: creator fee claims in the week, priced at the wallet's own USD per WETH; prizes captured in the week.
  const [fees] = await db<{ usd: string | null }[]>`
    SELECT sum(c.weth / 1e18 * (t.usd / NULLIF(t.weth::numeric / 1e18, 0)))::text AS usd
    FROM fee_claims c JOIN token_fees t ON lower(t.wallet) = lower(c.owner)
    WHERE c.role = 'creator' AND c.at >= ${start} AND c.at < ${end} AND lower(c.owner) IN (
      SELECT lower(x.creator_wallet) FROM projects x JOIN installations i ON i.id = x.installation_id
      WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND x.token_status = 'launched' AND lower(COALESCE(x.token_repo_key, x.repo_key)) = lower(${p.key}))`;
  const outcomes = await db<{ title: string; usd: string | null; result: string }[]>`
    SELECT g.title, o.prize_usd::text AS usd, o.result FROM entry_outcomes o JOIN projects x ON x.id = o.project_id JOIN programs g ON g.id = o.program_id
    JOIN installations i ON i.id = x.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND o.basis = 'announcement' AND o.captured_at >= ${start} AND o.captured_at < ${end}
      AND x.program_id <> ${COIN_PROGRAM} AND lower(COALESCE(x.repo_key, x.token_repo_key)) = lower(${p.key}) ORDER BY o.captured_at`;
  const usd = Number(fees?.usd ?? 0) + outcomes.filter((x) => ['won', 'placed', 'finalist'].includes(x.result)).reduce((a, x) => a + Number(x.usd ?? 0), 0);
  if (usd >= 1) f.earned = { usd: Math.round(usd) };
  const won = outcomes.filter((x) => x.result === 'won' || x.result === 'placed').map((x) => ({ title: x.title }));
  if (won.length > 0) f.won = won;
  // streak: this week shipped, and the run ending here is 2 or more.
  if (p.ship_weeks.includes(week)) {
    const w = streakOf(p.ship_weeks.filter((x) => x <= week), new Date(start.getTime() + DAY));
    if (w >= 2) f.streak = { w };
  }
  return f;
}

/**
 * The week's row for the project: facts merged in, text, pins and hides kept; v2.14 spec 3: the week's
 * titles (ship-titles.ts) replace the stored ones only when there are some. Another builder's row is left
 * alone. True when a row was written.
 */
export async function upsertWeekFacts(builderId: number, projectKey: string, monday: string, f: WeekFacts, titles: string[] = []): Promise<boolean> {
  const wrote = await sql()`
    INSERT INTO project_updates (builder_id, project_key, week, facts, titles) VALUES (${builderId}, ${projectKey}, ${monday}, ${sql().json(f as never)}, ${titles}::text[])
    ON CONFLICT (project_key, week) DO UPDATE SET facts = project_updates.facts || EXCLUDED.facts,
      titles = CASE WHEN cardinality(EXCLUDED.titles) > 0 THEN EXCLUDED.titles ELSE project_updates.titles END
    WHERE project_updates.builder_id = EXCLUDED.builder_id RETURNING 1`;
  return wrote.length > 0;
}

/**
 * v2.14 spec 3 (A11): the week's cleaned titles of the person's App-proven repo `key`, read with its installation
 * token (repo-proof.ts appClient); [] for any other repo. A repo that doesn't read public (repo-public.ts) is read
 * only once the builder turned titles on; fix round 1: else one GET /repos/{key} through the same client checks it,
 * and a public answer stamps builder_sources.public_at. At most 3 GitHub calls (plus the token). Only called for a
 * week with shipped code (weeklyFactsStep).
 */
export async function weekTitles(id: number, key: string, monday: string, now: Date, ghFetch: typeof fetch): Promise<string[]> {
  const db = sql();
  const k = key.toLowerCase();
  const [app] = await db<{ id: number; titles_on: boolean }[]>`
    SELECT s.id::int AS id, (p.ship_titles_at IS NOT NULL) AS titles_on FROM builder_sources s JOIN builder_profiles p ON p.builder_id = s.builder_id
    WHERE s.builder_id = ${id} AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = ${APP_PROOF}
      AND regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', '') = ${k}`;
  if (!app) return [];
  const get = await appClient(id, k, ghFetch);
  if (!get) return [];
  if (!app.titles_on && !(await repoReadPublic(id, k, now))) {
    const meta = await get<{ private?: unknown }>(`/repos/${k}`);
    if (meta?.private !== false) return [];
    await db`UPDATE builder_sources SET public_at = ${now} WHERE id = ${app.id}`;
  }
  // updates.ts imports this file: ownLinks is loaded when called.
  return shipTitles(await readWeekTitles(get, k, monday), await (await import('./updates')).ownLinks(id));
}

/**
 * spec "Cost": Mondays, after the digest (from 15:00 UTC), the finished week's facts for every
 * confirmed one project not done yet (facts.checked), WEEKLY_PER_RUN a run while `deadline` allows;
 * then one dated event per fact and project and week (dedupe key `<type>:<project_key>:<week>`).
 * Shared clients never. F2: an unconfirmed one project (perhaps someone else's repo) writes nothing.
 */
export async function weeklyFactsStep(now: Date, o: { deadline: number; only?: number[]; ghFetch?: typeof fetch }): Promise<{ step: 'skipped' } | { people: number; rows: number }> {
  if (now.getUTCDay() !== 1 || now.getUTCHours() < WEEKLY_HOUR_UTC) return { step: 'skipped' };
  const monday = lastFinishedMonday(now);
  const week = weekOfMonday(monday)!;
  const db = sql();
  const due = await db<{ id: number; key: string }[]>`
    SELECT p.builder_id AS id, b.project_key AS key FROM builder_profiles p
    JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(db)}
    WHERE NOT EXISTS (SELECT 1 FROM installations i WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND i.shared_client)
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
  for (const { id, key } of due) {
    if (Date.now() >= o.deadline) break;
    const f = await weekFactsFor(id, monday, now);
    people++;
    // v2.14 spec 3 (A11): the week's titles (weekTitles). Fix round 1: a failure there never stops the facts.
    let titles: string[] = [];
    if (f.shipped_code && o.ghFetch)
      titles = await weekTitles(id, key, monday, now, o.ghFetch).catch((err: unknown) => {
        console.error('[weekly] titles', err instanceof Error ? err.name : 'error');
        return [];
      });
    // Another builder's row for the key and week: nothing written, no events.
    if (!(await upsertWeekFacts(id, key, monday, { ...f, checked: true }, titles))) continue;
    rows++;
    const at = new Date(`${monday}T12:00:00Z`);
    const ev = (type: 'shipped_code' | 'went_live' | 'users_up', detail: Record<string, unknown>) =>
      noteEvent(type, () => ({ type, dedupe_key: `${type}:${key.toLowerCase()}:${week}`, installation_id: id, repo_key: key.toLowerCase(), at, detail }));
    if (f.shipped_code) await ev('shipped_code', { n: f.shipped_code.n, week });
    if (f.went_live) await ev('went_live', { week });
    if (f.users_up) await ev('users_up', { n: f.users_up.n, week });
  }
  return { people, rows };
}
