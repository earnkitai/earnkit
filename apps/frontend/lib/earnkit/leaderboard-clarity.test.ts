import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { benchCardFacts, benchRows, filterHref, profileData } from './bench-data';
import { INTRO_LINE, STATE_COPY, VARIANT_COPY } from './bench-reply';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { FORMULA_V2 } from './score-v2';
import { rankSplit } from './rank';
import { rankLines } from './bench-rank';
import { standingOf } from './person-score';
import { isoWeekOf } from './weeks';
import { wholeWords } from './untrusted-text';
import { projectOf } from './identity-input';
import { PROFILES_POINTS } from './policy';
import BenchRowItem from '../../app/leaderboard/BenchRowItem';
import BenchProfileView, { confirmingCardLine } from '../../app/[handle]/BenchProfileView';
import { BENCH_TITLE } from '../../app/leaderboard/BenchView';
import { padPool } from './fixtures/rank-pool';
import { profileSite } from './site-data';

/**
 * Scoring and clarity, Task 3: the leaderboard (R9, R17), rank wording (R6), one status line and one
 * next step with no rank beside "not on the leaderboard" (R10), and names never cut (R11).
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'leaderboard-test-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
(globalThis as { React?: typeof React }).React = React;
const RUN = String(process.pid % 100000);
const NO_MATCH = (async () => ({ checked: 1, scored: 0, fits: [] })) as never;
const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function agent(o: { x?: string } = {}) {
  const t = `ek_lb_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  if (o.x) assert.ok((await attachToX(own, { id: `96${RUN}${o.x.length}${o.x.charCodeAt(0)}${o.x.charCodeAt(1)}`, username: `${o.x}${RUN}`.slice(0, 15), name: o.x, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  return { id: c.id, ctx: { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: NO_MATCH } };
}

/** The status lines a reply can carry (Task 16: the signed-out intro, "You're in", VARIANT_COPY, the ranked standing). */
const STATUS = /EarnKit gets you paid for building\.|You're in, @|isn't counted yet|is already on the leaderboard under|is a copy of someone else's project|is on the leaderboard: |is on EarnKit|^[^\n]+ · (#|Top )/gm;
const RANKED = /#[\d,]+ of [\d,]+ builders?|Top [\d.]+% of builders/;
/** R10, Task 16: exactly one status line and one next step: one question in all. */
function oneStatusOneStep(reply: Record<string, unknown> | null): string {
  const s = String(reply?.show_to_builder ?? '');
  assert.equal((s.match(STATUS) ?? []).length, 1, `one status line: ${s}`);
  const questions = (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
  assert.equal(questions, 1, `one question in all: ${s}`);
  return s;
}

/** A ranked builder with a confirmed repo (the App), then its reply. */
async function rankedBuilder(x: string, name: string, repo: string, gh: number) {
  const a = await agent({ x });
  const key = `${x}${RUN}/${repo}`.toLowerCase();
  await mcpCall(a.ctx, 'find', { identity: { project: { name, repo: `https://github.com/${key}` } } });
  await installApp({ builderId: a.id, repoKey: key, login: `${x}${RUN}`, gh: fakeGitHub({ [key]: { id: gh, owner: `${x}${RUN}`, installation: gh } }) });
  return { ...a, key };
}

// ---- R9: the leaderboard, by name and by route ---------------------------------------------------

test('R9: the page is "Leaderboard", its filters link /leaderboard, the sitemap lists /leaderboard (never /bench)', async () => {
  assert.equal(BENCH_TITLE, 'Leaderboard');
  assert.equal(filterHref({ chain: null, weekly: false }), '/leaderboard');
  assert.equal(filterHref({ chain: 'arc', weekly: true }), '/leaderboard?chain=arc&weekly=1');
  const map = readFileSync(join(FRONTEND, 'app/sitemap.ts'), 'utf8');
  assert.match(map, /\/leaderboard`/);
  assert.doesNotMatch(map, /\/bench`/);
  const page = readFileSync(join(FRONTEND, 'app/leaderboard/page.tsx'), 'utf8');
  assert.match(page, /BENCH_TITLE\} · EarnKit/);
});

/** Source with comments removed (block, line, JSX and SQL comments): what can reach a person. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1').replace(/--[^\n]*/g, '');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? (['node_modules', 'fixtures'].includes(f) ? [] : walk(p)) : [p];
  });

test('R9: no user-visible copy says "Bench": app/ and lib/ strings, the reply copy tables, llms.txt and the terms', () => {
  const found: string[] = [];
  for (const f of [...walk(join(FRONTEND, 'app')), ...walk(join(FRONTEND, 'lib'))]) {
    if (!/\.(tsx?|mts|txt)$/.test(f) || /\.test\.ts$/.test(f)) continue;
    const text = f.endsWith('.txt') ? readFileSync(f, 'utf8') : stripComments(readFileSync(f, 'utf8'));
    text.split('\n').forEach((line, i) => {
      if (/^\s*import /.test(line) || /^\s*\} from '/.test(line)) return;
      // Identifiers (BenchRow, benchView, BENCH_*, bench_*) never match: only the word on its own, or a /bench link.
      if (/\bBench\b/.test(line) || /\bthe bench\b|\/bench\b/i.test(line)) found.push(`${relative(FRONTEND, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, []);
  const copy = [
    INTRO_LINE, STATE_COPY.signed_out.ask('L'), STATE_COPY.no_project.noApp(), STATE_COPY.no_project.ask('L'), STATE_COPY.not_counted.stand('X'), STATE_COPY.not_counted.ask('L'),
    ...Object.values(VARIANT_COPY).flatMap((v) => [v.stand('X'), v.ask('X')]),
  ];
  for (const c of copy) assert.doesNotMatch(c, /bench/i, c);
  assert.match(STATE_COPY.signed_out.ask('L'), /^Step 1 of 2: sign in with X \(one click\): L\nDone\?$/);
  const llms = readFileSync(join(FRONTEND, 'lib/earnkit/llms/v213.txt'), 'utf8');
  assert.match(llms, /^## The leaderboard$/m);
  assert.match(llms, /https:\/\/earnkit\.com\/leaderboard/);
  assert.doesNotMatch(JSON.stringify(PROFILES_POINTS), /bench/i);
});

// ---- R6, R17: the row's points and rank ----------------------------------------------------------

test('R17, R18 fix 1, R11 (v3.1 Task 8): a leaderboard row shows the Shipping score, "#N" (the full rank line to screen readers), and long names whole', () => {
  const name = 'Maximiliana Alexandrovna Montgomery-Featherstonehaugh';
  const project = 'The Recipe Planner For Busy Families Who Cook Every Night';
  const html = renderToStaticMarkup(React.createElement(BenchRowItem, {
    r: { rank: 3, line: '#3 of 12 builders', points: 72, handle: 'maxi', name, avatar: null, backing: null, chains: [], project, best: '3 weeks in a row', streak: 0 },
    ranked: true,
  }));
  // Clarity batch: the number carries a visible, quiet "Shipping" caption (was screen-reader only).
  assert.match(html, /data-points=""[^>]*><span data-ek-score-unit=""[^>]*><span[^>]*tabular-nums[^>]*>72<\/span><span class="text-\[12px\] leading-none text-s-muted">Shipping<\/span><\/span>/);
  // R18 fix 1 (supersedes R6 for rows): "#3" alone on screen; the whole rank line only for screen readers.
  assert.match(html, /aria-hidden="true">#3<\/span><span class="sr-only">#3 of 12 builders<\/span>/);
  assert.equal(html.replace(/<span class="sr-only">[^<]*<\/span>/g, '').includes('of 12 builders'), false, 'no rank words on screen');
  assert.doesNotMatch(html, /max-w-\[/, 'the rank column is never squeezed');
  // Fixed-width rank and score columns (36px and 56px, Leaderboard board), so every row lines up at #1 and #100.
  assert.match(html, /data-rank="" class="w-9 shrink-0/);
  assert.match(html, /data-points="" class="w-14 shrink-0/);
  assert.ok(html.includes(name) && html.includes(project), 'names whole');
  // Never cut: the name and the project wrap; only the @handle (XHandle) truncates.
  assert.equal((html.match(/\btruncate\b/g) ?? []).length, 1);
  assert.match(html, /<span class="truncate">@maxi<\/span>/);
  assert.doesNotMatch(html, /text-ellipsis|line-clamp/);
  assert.deepEqual(rankSplit('#1,204 of 3,500 builders'), { lead: '#1,204', rest: 'of 3,500 builders' });
  assert.deepEqual(rankSplit('Top 4% of builders'), { lead: 'Top 4%', rest: 'of builders' });
});

test('R17: benchRows gives each row its Shipping points (builder_live.score) and its rank line', db, async () => {
  const a = await rankedBuilder('pts', 'Points', 'points', 7101);
  await sql()`UPDATE builder_live SET score = 72 WHERE builder_id = ${a.id}`;
  const { rows } = await benchRows({ chain: null, weekly: false }, { only: [a.id] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].points, 72);
  assert.equal(rows[0].line, '#1 of 1 builder');
});

// ---- Final follow-ups 1 and 2: the streak is the grid's, and one rank pool ----------------------

test('Final follow-ups 1: the profile streak is read off the grid (commit weeks), never a stale stored streak', db, async () => {
  const a = await rankedBuilder('stk', 'Streak', 'streak', 7103);
  const now = new Date();
  const wk = (ago: number) => isoWeekOf(new Date(now.getTime() - ago * 7 * 86_400_000));
  await sql()`UPDATE builder_projects SET commit_weeks = ${[wk(1), wk(2), wk(4)]}, streak = 9 WHERE builder_id = ${a.id} AND lower(project_key) = ${a.key}`;
  const d = (await profileData(a.id, now))!;
  const on = d.grid.filter((g) => g.on).map((g) => g.week);
  assert.ok([wk(1), wk(2), wk(4)].every((w) => on.includes(w)), 'the grid shows the commit weeks');
  assert.equal(d.streak, 2, 'two filled squares in a row, as the grid shows');
});

test('Final follow-ups 2: "#N of M" counts the leaderboard\'s own pool (a ranked builder off the leaderboard is not in M)', db, async () => {
  const a = await rankedBuilder('one', 'One', 'pool', 7104);
  const b = await rankedBuilder('two', 'Two', 'pool', 7105);
  await sql()`UPDATE builder_live SET score = 72 WHERE builder_id = ${a.id}`;
  // b is still ranked from its last rescore, but its one project no longer counts as confirmed: not on the leaderboard.
  await sql()`UPDATE builder_live SET score = 80 WHERE builder_id = ${b.id}`;
  await sql()`UPDATE builder_profiles SET main_project_key = ${`elsewhere${RUN}/nope`} WHERE builder_id = ${b.id}`;
  const only = [a.id, b.id];
  const board = await benchRows({ chain: null, weekly: false }, { only });
  assert.deepEqual([board.count, board.rows.map((r) => r.handle)], [1, [`one${RUN}`.slice(0, 15)]]);
  const s = await standingOf(a.id, { only });
  assert.deepEqual([s.rank, s.total], [1, board.count], 'the profile and reply rank matches the leaderboard header');
  // v3.1 F3: one on the leaderboard, under RANK_MIN_POOL: the score line alone.
  const lines = await rankLines(a.id, { only });
  assert.deepEqual([lines.bench, lines.line, lines.listed], [null, 'Shipping 72', true]);
  const pads = await padPool(9);
  assert.equal((await rankLines(a.id, { only: [...only, ...pads] })).bench, '#1 of 10 builders');
});

// ---- R10: one status line, one next step, never a rank beside "not counted" ----------------------

test('R10: signed out while ranked (an anonymous ranked row): "not on the leaderboard yet" and no rank_lines', db, async () => {
  const a = await agent();
  await mcpCall(a.ctx, 'find', {});
  await sql()`
    INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
    VALUES (${a.id}, 30, '{}'::jsonb, true, 0, 0, ${FORMULA_V2}, ${LIVE_CALIBRATION_V2}, now(), now())
    ON CONFLICT (builder_id) DO UPDATE SET score = 30, ranked = true, calibration = ${LIVE_CALIBRATION_V2}, pending = NULL, read_at = now()`;
  const r = (await mcpCall(a.ctx, 'find', {})).reply;
  const s = oneStatusOneStep(r);
  assert.ok(s.startsWith(INTRO_LINE), s);
  assert.doesNotMatch(s, RANKED);
  assert.deepEqual(r?.rank_lines, []);
  const score = (await mcpCall(a.ctx, 'score', {})).reply;
  oneStatusOneStep(score);
  assert.deepEqual(score?.rank_lines, []);
});

test('R10: ranked, the move-up news shows with the rank; once the project is not counted (a stale ranked row) no rank, no news, anywhere', db, async () => {
  const a = await rankedBuilder('nws', 'Newsy', 'newsy', 7102);
  // v3.1 F3: the news names a rank only from RANK_MIN_POOL ranked builders.
  await padPool(9);
  const seen = (rank: number) => sql()`
    UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('rank', ${rank}::int, 'at', '2026-01-01T00:00:00Z'::text) WHERE builder_id = ${a.id}`;
  // Ranked: the news and the rank agree.
  await seen(5);
  const ranked = (await mcpCall(a.ctx, 'find', {})).reply;
  const r1 = oneStatusOneStep(ranked);
  assert.match(r1, /Since you last checked: You moved up to (#[1-4] of \d+ builders|Top [\d.]+% of builders)\./, r1);
  assert.match(r1, /^Newsy (· |is on the leaderboard: )(#[1-4] of \d+ builders|Top [\d.]+% of builders)/m);
  assert.ok((ranked?.rank_lines as string[]).length >= 1);

  // The repo's proof goes; builder_live.ranked stays true until the next rescore (read_at now: no refresh).
  await sql()`UPDATE builder_sources SET state = 'rejected' WHERE builder_id = ${a.id} AND kind = 'repo'`;
  await sql()`UPDATE builder_live SET read_at = now() WHERE builder_id = ${a.id}`;
  const [live] = await sql()<{ ranked: boolean }[]>`SELECT ranked FROM builder_live WHERE builder_id = ${a.id}`;
  assert.equal(live.ranked, true, 'the stale row this test is about');
  await seen(5);
  const stale = (await mcpCall(a.ctx, 'find', {})).reply;
  const s = oneStatusOneStep(stale);
  // Task 16 step 2: a named repo not counted gets its install link ("You're in").
  // GTM W2: the open grant's line before the step (value before the ask).
  assert.match(s, /^You're in, @\S+\.\n(?:[^\n]+ pays up to \$[\d,]+ for apps(?: on [^\n]+)?\.\n)?Step 2 of 2: /);
  assert.doesNotMatch(s, RANKED, s);
  assert.doesNotMatch(s, /You moved up/, s);
  assert.deepEqual(stale?.rank_lines, []);
  const score = (await mcpCall(a.ctx, 'score', {})).reply;
  assert.doesNotMatch(oneStatusOneStep(score), RANKED);
  assert.deepEqual(score?.rank_lines, []);

  // The profile and the card: no rank while the project isn't counted.
  const d = (await profileData(a.id, new Date()))!;
  assert.equal(d.bench, null);
  assert.equal(d.line, null);
  assert.deepEqual(d.chainLines, []);
  assert.equal(d.score, null);
  assert.equal((await benchCardFacts(a.id))!.bench, null);
  const staleData = { ...d, bench: 'Top 4% of builders', line: 'Shipping 62 · Top 4% of builders' };
  const html = renderToStaticMarkup(React.createElement(BenchProfileView, { data: staleData, site: await profileSite(a.id, staleData, new Date()), page: 1 }));
  assert.ok(d.project && !d.project.confirmed, 'confirming');
  assert.ok(html.includes(confirmingCardLine(d.name, d.project.name)), html);
  assert.doesNotMatch(html, /Top 4%|data-ek-standing/, 'never a rank beside the confirming card, even from a stale line');
});

// ---- R11: names never cut ------------------------------------------------------------------------

test('R11: a long project name is whole in the reply and on the leaderboard', db, async () => {
  const name = 'The Recipe Planner For Busy Families Who Cook Every Night';
  const a = await rankedBuilder('lng', name, 'recipes', 7103);
  const s = oneStatusOneStep((await mcpCall(a.ctx, 'find', {})).reply);
  assert.match(s, new RegExp(`^${name} (· |is on)`, 'm'), s);
  const { rows } = await benchRows({ chain: null, weekly: false }, { only: [a.id] });
  assert.equal(rows[0].project, name);
});

test('R11: names keep whole words: wholeWords, and an over-long identity name never ends mid-word', () => {
  assert.equal(wholeWords('EarnKit', 10), 'EarnKit');
  assert.equal(wholeWords('The Recipe Planner', 14), 'The Recipe');
  assert.equal(wholeWords('Supercalifragilistic', 10), 'Supercalif', 'one word longer than the limit: the only cut');
  // Task 4 (Task 3 carry): a cut never ends on trailing punctuation.
  assert.equal(wholeWords('Recipes, meals and more', 10), 'Recipes');
  assert.equal(wholeWords('Recipes - meals and more', 10), 'Recipes');
  assert.equal(wholeWords('Recipes: meals and more', 10), 'Recipes');
  assert.equal(wholeWords('Done, fully.', 20), 'Done, fully.', 'text that fits is kept as it is');
  const long = `${'Recipe Planner '.repeat(5)}Deluxe`;
  const p = projectOf({ name: long, repo: 'https://github.com/a/recipes' });
  assert.ok(p && p.name.length <= 60 && long.startsWith(p.name) && long[p.name.length] === ' ', p?.name);
});
