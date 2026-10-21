import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person } from './fixtures/find';
import { computeScoreV2 } from './score-v2';
import { isoWeekOf, lastFinishedMonday } from './weeks';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { RANK_MIN_POOL, shownRankLine } from './rank';
import { momentLines, shareText } from './weekly-moment';
import { digestBody } from './digest';
import { builderJson } from './builder-json';
import { profileData } from './bench-data';
import BenchProfileView, { DASH } from '../../app/[handle]/BenchProfileView';

/**
 * v3.1 F3: no rank is shown while fewer than RANK_MIN_POOL (10) builders are ranked ("#1 of 1 builder" read as a
 * joke). Replies, the weekly moment, the share post, the Monday email and the profile drop the rank; from 10 they show
 * it as before. The builder JSON keeps the numeric rank at any pool size.
 */
(globalThis as { React?: typeof React }).React = React;
process.env.EARNKIT_URL = 'https://earnkit.com';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// A fixed clock (Date only): a Wednesday, so the moment's Monday gate is open (as weekly-moment.test.ts).
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
const NO_MATCH = (async () => ({ checked: 1, scored: 0, fits: [] })) as never;
const ctx = (id: number) => ({ installationId: id, ownInstallationId: id, sharedClient: false, matchProjects: NO_MATCH });
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
/** Each test starts with an empty leaderboard (one database per file): earlier builders are hidden. */
const freshBoard = () => sql()`UPDATE builder_profiles SET hidden = true`;
const plusDays = (monday: string, n: number) => new Date(Date.parse(`${monday}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** A ranked, listed builder whose Shipping comes from commits `ages` weeks ago, with a ranked day last Sunday at `last`. */
async function builder(tag: string, ages: number[], last: number) {
  const key = `${tag}${RUN}/app`;
  const handle = `${tag}${RUN}`.slice(0, 15);
  const id = await person({ main: key, claimed: handle, ranked: true, seen: { connect_done: '2026-09-01T00:00:00.000Z' }, projects: [{ key, name: 'App', confirmed: true }] });
  const now = new Date();
  const s = computeScoreV2({ ships: [], commitWeeks: ages.map((i) => isoWeekOf(new Date(now.getTime() - i * 7 * DAY))) }, now);
  await sql()`UPDATE builder_live SET score = ${s.score}, parts = ${sql().json(s.parts as never)} WHERE builder_id = ${id}`;
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
    VALUES (${id}, ${plusDays(lastFinishedMonday(now), 6)}, ${last}, 0, '{}'::jsonb, '{}'::jsonb, 'v2', ${LIVE_CALIBRATION_V2}, false, true)`;
  return { id, key, handle, score: s.score };
}

/** `n` ranked builders: two above "me" (more weeks of code), the rest below; me last (#3 of n). */
async function pool(tag: string, n: number) {
  await freshBoard();
  for (let i = 0; i < n - 1; i++) await builder(`${tag}${i}`, i < 2 ? [1, 2, 3, 4, 5, 6] : [9], i < 2 ? 90 : 10);
  return builder(`${tag}me`, [1, 2, 3], 50);
}

test('(a) 9 ranked builders: find and score replies, the moment and the share post carry no "#"', db, async () => {
  assert.equal(RANK_MIN_POOL, 10);
  const me = await pool('rpa', 9);
  const f = await mcpCall(ctx(me.id), 'find', {});
  const s = show(f);
  // Task 16 step 7 under RANK_MIN_POOL: "on EarnKit", the post to paste with no rank. Last week has no ship-log row with
  // facts, so its yes pays nothing and no points are promised (fix round 1).
  assert.equal(s, `Last week done. You're on EarnKit.\nA post for X, ready to paste:\n"Shipping App. https://earnkit.com/${me.handle}"\nDoes last week look right?`);
  assert.equal(links(s).length, 1, s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(JSON.stringify(f.reply), /#\d/, 'no rank anywhere in the reply');
  assert.deepEqual((f.reply as { rank_lines?: string[] }).rank_lines ?? [], []);
  const sc = await mcpCall(ctx(me.id), 'score', {});
  const t = show(sc);
  assert.ok(t.endsWith('\nShip code this week: up to +100 points'), t);
  assert.doesNotMatch(JSON.stringify(sc.reply), /#\d/, t);
  assert.equal(shownRankLine({ ranked: true, rank: 1, total: 9 }), null);
});

test('(b) 10 ranked builders: "#3 of 10 builders" as today', db, async () => {
  const me = await pool('rpb', 10);
  const f = await mcpCall(ctx(me.id), 'find', {});
  const s = show(f);
  assert.equal(s.split('\n')[0], "Last week done. You're now #3.", s);
  const t = show(await mcpCall(ctx(me.id), 'score', {}));
  assert.match(t, /^App · #3 of 10 builders/, t);
  assert.ok(t.endsWith('\nShip code this week to move toward #1: up to +100 points'), t);
  assert.equal(shownRankLine({ ranked: true, rank: 3, total: 10 }), '#3 of 10 builders');
});

test('(c) the Monday email subject and body under 10: "Your week on EarnKit: Shipping 60", no "#"', () => {
  const now = { score: 60, rank: 1, total: 9 };
  const lines = momentLines({ monday: '2026-10-05', now, before: { score: 54, rank: 2, total: 8 }, titles: ['Fixed the login loop'], checked: true });
  assert.equal(lines[0], 'Last week you finished at Shipping 60 (+6).');
  assert.equal(momentLines({ monday: '2026-10-05', now, before: null, titles: [], checked: true })[0], 'Last week you finished at Shipping 60.');
  assert.equal(shareText(now), 'My week on EarnKit: Shipping 60');
  const b = digestBody({ newPrograms: [], wins: [], deadlines: [], handle: null, week: { lines, standing: now, approveUrl: 'https://earnkit.com/api/week?t=a', hideUrl: 'https://earnkit.com/api/week?t=h', approved: false } })!;
  assert.equal(b.subject, 'Your week on EarnKit: Shipping 60');
  assert.doesNotMatch(`${b.subject}\n${b.text}`, /#/);
  // From 10, unchanged.
  const ten = { score: 60, rank: 1, total: 10 };
  assert.equal(shareText(ten), 'My week on EarnKit: Shipping 60 · #1 of 10 builders');
  assert.equal(momentLines({ monday: '2026-10-05', now: ten, before: { score: 54, rank: 2, total: 10 }, titles: [], checked: true })[0], 'Last week you finished at Shipping 60 (+6), #1 (up 1).');
});

test('(d) builder JSON keeps rank at 1 of 1', db, async () => {
  await freshBoard();
  const me = await builder('rpd', [1, 2, 3], 50);
  const j = (await builderJson(me.handle, new Date()))!;
  assert.deepEqual([j.rank, j.total, j.shipping], [1, 1, me.score]);
});

test('(e) the profile shows a dash for Rank under 10', db, async () => {
  await freshBoard();
  const me = await builder('rpe', [1, 2, 3], 50);
  const d = (await profileData(me.id, new Date()))!;
  assert.equal(d.bench, null);
  assert.equal(d.line, `Shipping ${me.score}`);
  assert.equal(d.rankListed, true);
  assert.equal(d.score, me.score, 'the Shipping number stays');
  const h = renderToStaticMarkup(React.createElement(BenchProfileView, { data: d, tab: 'log' }));
  const at = h.indexOf('data-ek-numbers');
  const row = h.slice(at, h.indexOf('</ul>', at));
  assert.ok(row.includes(`aria-label="Shipping ${me.score} of 100"`), row);
  assert.match(row, new RegExp(`>${DASH}</p><p class="[^"]*">Rank<`), row);
  assert.ok(row.includes('data-ek-earned'), 'Earned shows on a ranked page');
  assert.doesNotMatch(h.replace(/<[^>]+>/g, ' '), /#\d/, 'no rank in the page text');
});

test('(f) the share card under 10: the project is the headline, Shipping and Earned still show, no "#"', async () => {
  const { benchCard } = await import('../../app/[handle]/card-response');
  const f = { handle: 'maya_makes', name: 'Maya Chen', avatar: null, bench: 'Shipping 60', project: 'Recipes', streak: 3, raising: null, score: 60, earned: 340 };
  const h = renderToStaticMarkup(benchCard(f, null, false));
  assert.match(h, /font-size:\d+px[^>]*>Recipes</, 'the project is the headline');
  assert.match(h, />60<[\s\S]*?>Shipping</);
  assert.match(h, />\$340<[\s\S]*?>Earned</);
  assert.ok(h.includes('>3 weeks in a row<'), 'the foot: the streak, the project not repeated');
  assert.doesNotMatch(h.replace(/<[^>]+>/g, ' '), /#\d|Shipping 60/);
});
