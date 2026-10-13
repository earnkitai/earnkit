import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LeaderboardView from '../../app/leaderboard/LeaderboardView';
import { percentiles } from './builder-score';
import { sql } from './db';
import { MAX_BOARD_PAGE, boardHref, boardOutcome, leaderboardData, leaderboardFilters, PAGE_SIZE, type BoardRow, type LeaderboardData } from './profile-data';

/** v2.12 T12: the unified leaderboard (spec 7 "Leaderboard"). Markup on the pure view, then the one query. */

(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const ALL = { chain: null, program: null, window: 'all', page: 1 } as const;
const board = (data: Partial<LeaderboardData>, programs: { id: string; title: string }[] = []) =>
  html(React.createElement(LeaderboardView, { data: { rows: [], page: 1, pages: 1, filters: ALL, ...data }, programs }));

test('12.1 the board: rank, name, score, Top N%, top outcome, each row links its profile; 50 a page', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ rank: i + 1, slug: `p${i}`, name: `@p${i}`, score: 90 - i, top_percent: i + 1, top_outcome: `${100 - i} people used app${i}`, change_7d: 0 }));
  const h = html(React.createElement(LeaderboardView, { data: { rows, page: 1, pages: 3, filters: { chain: null, program: null, window: 'all', page: 1 } }, programs: [] }));
  assert.equal((h.match(/<tr data-row=/g) ?? []).length, 50);
  assert.match(h, /href="\/b\/p0"/);
  assert.match(text(h), /1 @p0 90 Top 1% 100 people used app0/);
  assert.match(h, /href="\/leaderboard\?page=2"/);
  assert.equal(PAGE_SIZE, 50);
  // Page 1 has no previous link; the last page has no next one.
  assert.doesNotMatch(h, /href="\/leaderboard\?page=0"/);
  const last = board({ rows: rows.slice(0, 2), page: 3, pages: 3, filters: { ...ALL, page: 3 } });
  assert.match(last, /href="\/leaderboard\?page=2"/);
  assert.doesNotMatch(last, /page=4/);
  // A public page: no em dash, no emoji (cut at the shared Footer, as 10.3 does).
  assert.doesNotMatch(h.split('<footer')[0], /—|\p{Extended_Pictographic}/u);
});

test('final T15 ruling: a row above the top 50% shows its score and no "Top N%"', () => {
  const rows = [
    { rank: 1, slug: 'a', name: '@a', score: 60, top_percent: 2, top_outcome: 'x', change_7d: 0 },
    { rank: 2, slug: 'b', name: '@b', score: 5, top_percent: null, top_outcome: 'y', change_7d: 0 },
  ];
  const t = text(board({ rows }));
  assert.match(t, /1 @a 60 Top 2% x/);
  assert.match(t, /2 @b 5 y/);
  assert.equal((t.match(/Top \d+%/g) ?? []).length, 1);
});

test('12.2 filters as query params; the week window ranks by 7-day change and says so', () => {
  assert.deepEqual(leaderboardFilters({ chain: 'arc', program: 'arc-microgrants', window: 'week', page: '2' }), { chain: 'arc', program: 'arc-microgrants', window: 'week', page: 2 });
  assert.deepEqual(leaderboardFilters({ chain: 'solana', program: '../x', window: 'x', page: '-4' }), { chain: null, program: null, window: 'all', page: 1 });
  const h = html(React.createElement(LeaderboardView, { data: { rows: [], page: 1, pages: 1, filters: { chain: null, program: null, window: 'week', page: 1 } }, programs: [] }));
  assert.match(text(h), /Biggest movers this week/);
  assert.match(text(h), /No builders here yet/);
  // Repeated, odd or huge values are dropped, never echoed.
  assert.deepEqual(leaderboardFilters({ chain: ['arc', 'base'], program: 'A<b>', page: '1.5' }), ALL);
  assert.deepEqual(leaderboardFilters({ chain: 'Base', page: '1e3' }), ALL);
  assert.equal(leaderboardFilters({ page: '99999999999999999999' }).page, 1);
  // Final review (T12): pages cap at MAX_BOARD_PAGE (200); past it, page 1 (no cache entry per crafted page).
  assert.equal(MAX_BOARD_PAGE, 200);
  assert.equal(leaderboardFilters({ page: '200' }).page, 200);
  assert.equal(leaderboardFilters({ page: '201' }).page, 1);
  assert.equal(leaderboardFilters({ page: '5000' }).page, 1);
});

test('12.2b filter links keep the other filters and reset the page; the selected program shows by its title', () => {
  assert.equal(boardHref(ALL), '/leaderboard');
  assert.equal(boardHref({ chain: 'base', program: 'arc-microgrants', window: 'week', page: 3 }), '/leaderboard?chain=base&program=arc-microgrants&window=week&page=3');
  const f = { chain: 'arc', program: 'arc-microgrants', window: 'all', page: 2 } as const;
  const rows: BoardRow[] = [{ rank: 51, slug: 'lee', name: '@lee', score: 40, top_percent: 20, top_outcome: 'Shipped tipjar', change_7d: 3 }];
  const h = board({ rows, page: 2, pages: 2, filters: f }, [{ id: 'arc-microgrants', title: 'Arc Microgrants' }, { id: 'base-builder-grants', title: 'Base Builder Grants' }]);
  assert.match(h, /href="\/leaderboard\?chain=base&amp;program=arc-microgrants"/);
  assert.match(h, /href="\/leaderboard\?program=arc-microgrants"/, 'all chains');
  assert.match(h, /href="\/leaderboard\?chain=arc&amp;program=arc-microgrants&amp;window=week"/);
  assert.match(h, /href="\/leaderboard\?chain=arc&amp;program=base-builder-grants"/);
  assert.match(h, /href="\/leaderboard\?chain=arc"/, 'all programs');
  assert.match(h, /href="\/leaderboard\?chain=arc&amp;program=arc-microgrants"/, 'previous page keeps the filters');
  assert.match(h, /aria-current="page"[^>]*>Arc</);
  assert.match(text(h), /Arc Microgrants/);
  // The all-time board does not show the week's change; the week board does, in words.
  assert.doesNotMatch(text(h), /up 3/);
  const week = board({ rows, filters: { ...f, window: 'week', page: 1 } });
  assert.match(text(week), /up 3/);
  assert.match(text(board({ rows: [{ ...rows[0], change_7d: -2 }], filters: { ...ALL, window: 'week' } })), /down 2/);
  assert.match(text(board({ rows: [{ ...rows[0], change_7d: 0 }], filters: { ...ALL, window: 'week' } })), /no change/);
});

test('12.2c the top outcome in plain words: users, else money, else shipped; never a private repo or a wallet', () => {
  assert.equal(boardOutcome({ score: 41, users: 1240, money_usd: 0, repo_title: 'tipjar', oss: false, site_ref: null, package_ref: null }), '1,240 people used tipjar');
  assert.equal(boardOutcome({ score: 41, users: 1, money_usd: 0, repo_title: 'tipjar', oss: false, site_ref: null, package_ref: null }), '1 person used tipjar');
  assert.equal(boardOutcome({ score: 41, users: 0, money_usd: 3100, repo_title: null, oss: false, site_ref: null, package_ref: null }), '$3.1k through a private project');
  assert.equal(boardOutcome({ score: 41, users: 0, money_usd: 0, repo_title: null, oss: true, site_ref: null, package_ref: null }), 'Shipped their open source work');
  assert.equal(boardOutcome({ score: 41, users: 3, money_usd: 0, repo_title: null, oss: false, site_ref: 'https://tip.example.com/x', package_ref: 'tip-sdk' }), '3 people used tip.example.com');
  assert.equal(boardOutcome({ score: 41, users: 3, money_usd: 0, repo_title: null, oss: false, site_ref: null, package_ref: 'tip-sdk' }), '3 people used tip-sdk');
  assert.equal(boardOutcome({ score: 41, users: null, money_usd: null, repo_title: null, oss: false, site_ref: null, package_ref: null }), 'Verified builder');
  assert.equal(boardOutcome({ score: 0, users: null, money_usd: null, repo_title: null, oss: false, site_ref: null, package_ref: null }), 'No verified outcomes yet');
});

test('12.5 the page: ISR 600, 404 with the flag off, strict params, one cached read revalidated with the profiles', () => {
  const page = readFileSync(join(import.meta.dirname, '../../app/leaderboard/page.tsx'), 'utf8');
  assert.match(page, /export const revalidate = 600/);
  assert.match(page, /if \(!builderScoreEnabled\(\)\) notFound\(\)/);
  // searchParams is read before the flag check, so the route is dynamic: a static prerender would serve one page for every filter.
  assert.match(page, /const q = await searchParams;\s*(\/\/.*\s*)*if \(!builderScoreEnabled\(\)\) notFound\(\);\s*const f = leaderboardFilters\(q\)/);
  const load = readFileSync(join(import.meta.dirname, '../../app/leaderboard/leaderboard-load.ts'), 'utf8');
  assert.match(load, /tags: \[PROFILE_TAG\]/);
  // Final review (T12): program= is checked against one cached id list before the board's cached read.
  assert.match(page, /if \(f\.program && !\(await cachedProgramIds\(\)\)\.includes\(f\.program\)\) notFound\(\);\s*const board = await cachedBoard\(f\)/);
  assert.match(load, /export const cachedProgramIds = unstable_cache\(async \(\) => programIds\(\), \[[^\]]+\], \{ revalidate: 600 \}\)/);
  assert.match(load, /revalidate: 600/);
  const cache = readFileSync(join(import.meta.dirname, 'profile-cache.ts'), 'utf8');
  assert.match(cache, /revalidatePath\('\/leaderboard'\)/);
});

// ---- With a database: the one leaderboard query.

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const NOW = new Date('2026-10-12T12:00:00Z');
const TAG = `t12-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const made: { installs: number[]; programs: string[] } = { installs: [], programs: [] };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  const ids = made.installs;
  if (ids.length) {
    await sql()`DELETE FROM projects WHERE installation_id IN ${sql()(ids)}`;
    await sql()`DELETE FROM builder_sources WHERE builder_id IN ${sql()(ids)}`;
    await sql()`DELETE FROM builder_ranks WHERE builder_id IN ${sql()(ids)}`;
    await sql()`DELETE FROM builder_profiles WHERE builder_id IN ${sql()(ids)}`;
  }
  if (made.programs.length) await sql()`DELETE FROM programs WHERE id IN ${sql()(made.programs)}`;
  await sql().end();
});

const parts = { users: { points: 1, raw: { U: 1 } }, money: { points: 0, raw: { M: 0 } }, staying: { points: 0, raw: {} }, recency: { points: 0, raw: {} }, consistency: { points: 0, raw: { weeks: 0 } } };
async function person(name: string, o: { hidden?: boolean; held?: boolean; x?: string; login?: string; unconsented?: boolean } = {}) {
  const [i] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`${TAG}-${name}`}) RETURNING id`;
  made.installs.push(i.id);
  const slug = `${TAG}-${name}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_handle, github_login, fallback_handle, held, hidden, consent_shown_at)
    VALUES (${i.id}, ${slug}, ${o.x ?? null}, ${o.login ?? null}, ${o.login ?? '0xabcd…1234'}, ${o.held ?? false}, ${o.hidden ?? false}, ${o.unconsented ? null : new Date()})`;
  return { id: i.id, slug };
}
const scoreRow = (id: number, day: string, score: number, o: { held?: boolean; top?: object } = {}) =>
  sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, projects)
    VALUES (${id}, ${day}, ${score}, 50, ${sql().json(parts as never)}, ${sql().json((o.top ?? {}) as never)}, 'v1', 'v1-launch', ${o.held ?? false}, null)`;
const source = async (id: number, kind: string, ref: string, project_key: string) => {
  const [r] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, ${kind}, ${ref}, ${project_key}, 'verified', 'repo_owner', 'server') RETURNING id`;
  return Number(r.id);
};
const reading = (sid: number, day: string, signals: unknown) =>
  sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${sid}, ${day}, ${sql().json(signals as never)}, true)`;
async function program(id: string) {
  made.programs.push(id);
  await sql()`INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, ends_at, opened_at)
    VALUES (${id}, 'o', ${`Program ${id}`}, 'd', 'https://x', 'https://x', 'r', '$500', 'active', 'unknown', now() + interval '10 days', now())`;
}
/** Every page of a filter, so the seeded people are found wherever the shared DB ranks them. */
async function everyRow(f: Omit<Parameters<typeof leaderboardData>[0], 'page'>) {
  const out: BoardRow[] = [];
  for (let page = 1; ; page++) {
    const d = await leaderboardData({ ...f, page }, NOW);
    out.push(...d.rows);
    if (page >= d.pages) return out;
  }
}

/** 3 people: A 70 (hidden), B 50 (held today at 95, yesterday 50), C 30 with an Arc contract and an entry in the program. */
async function seedBoard() {
  const prog = `${TAG}-arc`;
  await program(prog);
  const a = await person('a', { hidden: true, x: 'aaa' });
  const b = await person('b', { held: true, login: `bee-${TAG}` });
  const c = await person('c');
  const u = await person('u', { unconsented: true, login: `you-${TAG}` });
  await scoreRow(u.id, '2026-10-11', 60);
  await scoreRow(a.id, '2026-10-11', 70);
  await scoreRow(b.id, '2026-10-11', 50);
  await scoreRow(b.id, '2026-10-12', 95, { held: true });
  await scoreRow(c.id, '2026-10-12', 30);
  await source(c.id, 'contract', `arc:0x${'c'.repeat(40)}`, 'arc-app');
  await sql()`INSERT INTO projects (program_id, name, installation_id) VALUES (${prog}, 'Arc app', ${c.id})`;
  await percentiles(NOW);
  return { a: a.slug, b: b.slug, c: c.slug, u: u.slug, slugs: [a.slug, b.slug, c.slug, u.slug], prog };
}

test('12.3 hidden people are not listed but count; held people show their last unheld score; program and chain filters', dbTest, async () => {
  const seeded = await seedBoard();
  const all = await everyRow({ chain: null, program: null, window: 'all' });
  const mine = all.filter((r) => seeded.slugs.includes(r.slug));
  assert.deepEqual(mine.map((r) => [r.slug, r.score]), [[seeded.b, 50], [seeded.c, 30]]);
  // Final review: "Top N%" only for N <= 50, else null (the rank is read, so only the order is pinned).
  assert.ok((mine[0].top_percent ?? 101) <= (mine[1].top_percent ?? 101));
  for (const r of mine) assert.ok(r.top_percent === null || (r.top_percent >= 1 && r.top_percent <= 50));
  assert.ok(mine[0].rank < mine[1].rank);
  assert.equal(mine[0].name, `bee-${TAG}`);
  assert.equal(mine[1].name, 'Builder', 'never a wallet as the name');
  // The hidden person still counts: B's rank sits below A's 70 in the percentiles.
  const [ranks] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_ranks r JOIN builder_profiles p USING (builder_id) WHERE p.slug = ${seeded.a}`;
  assert.equal(ranks.n, 1);
  // Final review I4: never shown the consent line: not listed, still ranked (it counts for others).
  const [unshown] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_ranks r JOIN builder_profiles p USING (builder_id) WHERE p.slug = ${seeded.u}`;
  assert.equal(unshown.n, 1);
  assert.ok(!all.some((r) => r.slug === seeded.u));
  const arc = await leaderboardData({ chain: 'arc', program: seeded.prog, window: 'all', page: 1 }, NOW);
  assert.deepEqual(arc.rows.filter((r) => seeded.slugs.includes(r.slug)).map((r) => r.slug), [seeded.c]);
  assert.deepEqual(arc.rows.map((r) => r.slug), [seeded.c], 'only this program');
  assert.equal(arc.rows[0].rank, 1);
  const base = await leaderboardData({ chain: 'base', program: seeded.prog, window: 'all', page: 1 }, NOW);
  assert.deepEqual(base.rows, []);
  assert.equal(base.pages, 1);
});

test('12.4 the week ranks by the bounded 7-day change; the top outcome never names a private repo', dbTest, async () => {
  const prog = `${TAG}-wk`;
  await program(prog);
  const up = await person('up', { x: 'up_builder' });
  const flat = await person('flat');
  const old = await person('old');
  const priv = await person('priv', { login: `pv-${TAG}` });
  for (const p of [up, flat, old, priv]) await sql()`INSERT INTO projects (program_id, name, installation_id) VALUES (${prog}, 'x', ${p.id})`;
  // up: 20 on Oct 3 (9 days back), 32 today: +12. flat: no row 7 to 10 days back: no change. old: only an 11-day-old row: no change.
  await scoreRow(up.id, '2026-10-03', 20);
  await scoreRow(up.id, '2026-10-12', 32, { top: { key: `pub-${TAG}/tipjar`, title: 'tipjar', users: 1240, money_usd: 0 } });
  await scoreRow(flat.id, '2026-10-10', 60);
  await scoreRow(flat.id, '2026-10-12', 61);
  await scoreRow(old.id, '2026-10-01', 10);
  await scoreRow(old.id, '2026-10-12', 70);
  await scoreRow(priv.id, '2026-10-12', 25, { top: { key: `pv-${TAG}/secret-plan`, title: 'secret-plan', users: 7, money_usd: 0 } });
  const pub = await source(up.id, 'repo', `pub-${TAG}/tipjar`, `pub-${TAG}/tipjar`);
  await reading(pub, '2026-10-12', { private: false });
  const hid = await source(priv.id, 'repo', `pv-${TAG}/secret-plan`, `pv-${TAG}/secret-plan`);
  await reading(hid, '2026-10-12', { private: true });
  await percentiles(NOW);

  const week = await leaderboardData({ chain: null, program: prog, window: 'week', page: 1 }, NOW);
  assert.deepEqual(week.rows.map((r) => [r.slug, r.change_7d]), [[up.slug, 12], [old.slug, 0], [flat.slug, 0], [priv.slug, 0]]);
  assert.deepEqual(week.rows.map((r) => r.rank), [1, 2, 3, 4]);
  assert.equal(week.rows[0].name, '@up_builder');
  assert.equal(week.rows[0].top_outcome, '1,240 people used tipjar');
  const p = week.rows.find((r) => r.slug === priv.slug);
  assert.equal(p?.top_outcome, '7 people used a private project');
  assert.doesNotMatch(JSON.stringify(week), /secret-plan/);
  const all = await leaderboardData({ chain: null, program: prog, window: 'all', page: 1 }, NOW);
  assert.deepEqual(all.rows.map((r) => r.slug), [old.slug, flat.slug, up.slug, priv.slug]);
  // A page past the end has no rows.
  assert.deepEqual((await leaderboardData({ chain: null, program: prog, window: 'all', page: 2 }, NOW)).rows, []);
});
