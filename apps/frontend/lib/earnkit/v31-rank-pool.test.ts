import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person } from './fixtures/find';
import { checkFitsAsked } from './fixtures/wallet-step';
import { computeScoreV2 } from './score-v2';
import { isoWeekOf, lastFinishedMonday } from './weeks';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { RANK_MIN_POOL, shownRankLine } from './rank';
import { momentLines, shareText } from './weekly-moment';
import { digestBody } from './digest';
import { builderJson } from './builder-json';
import { profileData } from './bench-data';
import BenchProfileView from '../../app/[handle]/BenchProfileView';
import { profileSite } from './site-data';

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
  // v4.3: a no to Base's grant steps (the qualify reply carries no ship line), so the ranked step is the ship step.
  // v4.7.1 T1: check_fits (no fit) asked already too (v4.7.2 T2: said no to for every program, checkFitsAsked).
  const id = await person({ main: key, claimed: handle, ranked: true, seen: { connect_done: '2026-09-01T00:00:00.000Z', declined: { [`qualify:${key}`]: new Date().toISOString() } }, projects: [{ key, name: 'App', confirmed: true }] });
  await checkFitsAsked(id);
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
  // Task 16 step 7 under RANK_MIN_POOL: "on EarnKit", no rank. Last week has no ship-log row with facts, so there is no
  // post to offer (v3.1 one-tap posts): the page is the one link. v4.8 Task 1: no "Open now:" paragraph.
  assert.match(s, new RegExp(`^Your week is ready, \\S+\\. You shipped this week\\. Nice work\\.\\n\\n\\| \\| This week \\|\\n[^]*\\n\\nYour page: https://earnkit\\.com/${me.handle}\\n\\nBuilders who share wins get noticed by programs\\.\\n\\nAdd this week to your page\\?$`), s);
  assert.equal(links(s).length, 1, s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(JSON.stringify(f.reply), /#\d/, 'no rank anywhere in the reply');
  assert.deepEqual((f.reply as { rank_lines?: string[] }).rank_lines ?? [], []);
  const sc = await mcpCall(ctx(me.id), 'score', {});
  const t = show(sc);
  assert.match(t, /\n\nShipping this week starts your streak and lifts your score\.\n\n[^\n]*\?$/, t);
  assert.doesNotMatch(JSON.stringify(sc.reply), /#\d/, t);
  assert.equal(shownRankLine({ ranked: true, rank: 1, total: 9 }), null);
});

test('(b) 10 ranked builders: "#3 of 10 builders" as today', db, async () => {
  const me = await pool('rpb', 10);
  const f = await mcpCall(ctx(me.id), 'find', {});
  const s = show(f);
  // v4.0 Task 7: the Monday block (no rank); the rank stays on the standing line.
  assert.match(s.split('\n')[0], /^Your week is ready, /, s);
  // v4.7 T2: score leads with the standing paragraph, the page's score and rank.
  const t = show(await mcpCall(ctx(me.id), 'score', {}));
  assert.match(t, /^Score \d+ · #3 of 10 builders\. /, t);
  // v4.7 T4 fix round 0 (R13): the weekly rank target is the ship ask's why, its own paragraph before the question.
  assert.match(t, /\n\nShip code this week to move toward #1\.\n\n[^\n]*\?$/, t);
  assert.equal(shownRankLine({ ranked: true, rank: 3, total: 10 }), '#3 of 10 builders');
});

test('(c) the Monday email subject and body under 10: "Your week on EarnKit: Shipping 60", no "#"', () => {
  const now = { score: 60, rank: 1, total: 9 };
  const lines = momentLines({ monday: '2026-10-05', now, before: { score: 54, rank: 2, total: 8 }, titles: ['Fixed the login loop'], checked: true });
  assert.equal(lines[0], 'Last week you finished at Shipping 60 (+6).');
  assert.equal(momentLines({ monday: '2026-10-05', now, before: null, titles: [], checked: true })[0], 'Last week you finished at Shipping 60.');
  assert.equal(shareText(now), 'My week on EarnKit: Shipping 60');
  const b = digestBody({ money: [], newPrograms: [], wins: [], deadlines: [], handle: null, week: { lines, standing: now, approveUrl: 'https://earnkit.com/api/week?t=a', hideUrl: 'https://earnkit.com/api/week?t=h', approved: false } })!;
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

test('(e) the profile under 10: the Shipping ring stays, no standing pill, no rank anywhere (v3.1 Review Focus 2)', db, async () => {
  await freshBoard();
  const me = await builder('rpe', [1, 2, 3], 50);
  const d = (await profileData(me.id, new Date()))!;
  assert.equal(d.bench, null);
  assert.equal(d.line, `Shipping ${me.score}`);
  assert.equal(d.rankListed, true);
  assert.equal(d.score, me.score, 'the Shipping number stays');
  const site = await profileSite(me.id, d, new Date());
  assert.equal(site.standing, null);
  const h = renderToStaticMarkup(React.createElement(BenchProfileView, { data: d, site, page: 1 }));
  assert.ok(h.includes(`aria-label="Shipping score ${me.score} out of 100"`), 'the ring');
  assert.doesNotMatch(h, /data-ek-standing|data-ek-numbers|data-ek-earned/);
  assert.doesNotMatch(h.replace(/<[^>]+>/g, ' '), /#\d|Top \d+%|of \d+ builders/, 'no rank in the page text');
});

test('(f) the share card under 10 (GTM W4): the Shipping ring without a rank, the project and the streak; no "#"', async () => {
  const { benchCard } = await import('../../app/[handle]/card-response');
  const f = {
    handle: 'maya_makes', name: 'Maya Chen', avatar: null, url: 'earnkit.com/maya_makes', idle: null,
    project: { name: 'Recipes', letter: 'R', color: '#7C3AED', onBase: false, live: null, facts: [] },
    tiles: [{ kind: 'score' as const, score: 60, rank: null }, { kind: 'streak' as const, weeks: 3 }],
  };
  const h = renderToStaticMarkup(benchCard(f, null));
  assert.match(h, /font-size:\d+px[^>]*>Recipes</, 'the project is named');
  assert.match(h, />60<[\s\S]*?>out of 100</, 'the ring and what it is out of');
  assert.match(h, />3<[\s\S]*?>weeks<[\s\S]*?>in a row</, 'the streak');
  assert.doesNotMatch(h.replace(/<[^>]+>/g, ' '), /#\d|of \d+ builders|Shipping 60/);
});
