import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { profileData, type ProfileData } from './bench-data';
import { DATA } from './fixtures/profile-data';
import BenchProfileView, { BENCH_SOURCES_LINE, LOG_EMPTY, TAB_LOG, TAB_PROJECT, confirmingCardLine, streakWords } from '../../app/[handle]/BenchProfileView';
import Avatar from '../../app/[handle]/Avatar';
import UpdateCard from '../../app/components/ui/UpdateCard';

/** v2.13 T11 (spec "Profile", R10, R11, R12): the page at earnkit.com/<x-handle> under the Bench flag. */

// The components are compiled with the classic JSX runtime here (as feed.test.ts).
(globalThis as { React?: typeof React }).React = React;
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const RUN = randomBytes(3).toString('hex');
const made: number[] = [];
// No test leaves shared state behind: every row this file wrote goes, children first.
after(async () => {
  if (!process.env.DATABASE_URL) return;
  if (made.length) {
    const db = sql();
    await db`DELETE FROM project_updates WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM source_live WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id IN ${db(made)})`;
    await db`DELETE FROM builder_sources WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_projects WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_live WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_profiles WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM installations WHERE id IN ${db(made)}`;
  }
  await sql().end();
});
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");


test('11.1 the header: photo, name, @handle, pill, the score line (R16c) then each chain line with its logo', () => {
  const h = html(React.createElement(BenchProfileView, { data: DATA, tab: 'log' }));
  for (const s of ['Maya Chen', '@maya_makes', 'Community round $RECIPE', 'Shipping 62 · Top 4% of builders this week', 'Top 4%', 'of builders this week', 'Top 1% of builders on Base this week']) assert.ok(h.includes(s), s);
  assert.ok(h.indexOf('Top 4%') < h.indexOf('Top 1% of builders on Base'));
  assert.match(h, /alt="Base"/);
});

test('11.2 one Shipping ring (no per-part rings) with the why sentence; the grid has 52 squares and the streak beside it', () => {
  const h = html(React.createElement(BenchProfileView, { data: DATA, tab: 'log' }));
  for (const s of ['aria-label="Shipping 62 of 100"', 'Code in 7 of the last 12 weeks, 3 of the last 4. Ship code this week to add up to 14 points.', '6 weeks in a row']) assert.ok(h.includes(s), s);
  for (const re of [/Shipped \d+ of/, /Used \d+ of/, /Earned \d+ of/, /Consistency \d+ of/]) assert.doesNotMatch(h, re);
  assert.equal((h.match(/role="img" aria-label="Shipping/g) ?? []).length, 1, 'one ring');
  assert.equal((h.match(/data-week=/g) ?? []).length, 52);
  assert.equal((h.match(/data-on="true"/g) ?? []).length, 6);
  assert.equal(streakWords(1), '1 week in a row');
  assert.equal(streakWords(0), null);
});

test('11.3 the Ship log tab is the default: long cards newest first, chips alone for a facts-only week, the Started card last', () => {
  const h = html(React.createElement(BenchProfileView, { data: DATA, tab: 'log' }));
  assert.ok(h.includes(TAB_LOG) && h.includes(TAB_PROJECT));
  assert.match(h, /aria-current="page"[^>]*>Ship log/);
  // The grid's squares carry week titles too: read the order inside the log only.
  const log = h.slice(h.indexOf('data-shape="long"'));
  const order = ['Week of Oct 12', 'Week of Oct 5', 'Started tracking Recipe planner.'].map((s) => log.indexOf(s));
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], order.join(','));
  assert.equal((h.match(/data-shape="long"/g) ?? []).length, 3);
  assert.ok(h.includes(BENCH_SOURCES_LINE));
  assert.doesNotMatch(h.replace(/<[^>]+>/g, ' '), /written by|agent/i, 'R6'); // text only: the Docs link's #connect-an-agent anchor is not copy
  assert.ok(html(React.createElement(BenchProfileView, { data: { ...DATA, log: [] }, tab: 'log' })).includes(LOG_EMPTY));
});

test('11.4 the Project tab: name, what, links, chains, the coin, programs entered and won, ways to get funded; never people or money', () => {
  const h = html(React.createElement(BenchProfileView, { data: DATA, tab: 'project' }));
  for (const s of ['Recipe planner', 'a recipe planner', 'https://recipes.app', 'https://github.com/maya/recipes', '$RECIPE on tokens.fun', 'Won Base Builder Grants', 'Ways to get funded', 'Avalanche Team1 Mini Grants pays up to $10K'])
    assert.ok(h.includes(s), s);
  assert.doesNotMatch(h, /people use it| earned/);
  assert.match(h, /aria-current="page"[^>]*>Project/);
});

test('11.5 the photo falls back to the initials when it fails to load', async () => {
  const h = renderToStaticMarkup(React.createElement(Avatar, { src: 'https://pbs.twimg.com/x.jpg', handle: 'maya_makes' }));
  assert.match(h, /<img[^>]+src="https:\/\/pbs\.twimg\.com\/x\.jpg"/);
  assert.match(renderToStaticMarkup(React.createElement(Avatar, { src: null, handle: 'maya_makes' })), />M</);
  const src = (await import('node:fs')).readFileSync(new URL('../../app/[handle]/Avatar.tsx', import.meta.url), 'utf8');
  assert.match(src, /'use client'/);
  assert.match(src, /onError=/);
});

/** A claimed person whose one project is `key`; `proof`: the repo's own proof line, so the Bench counts it confirmed. */
async function person(key: string, o: { proof?: boolean; named?: string } = {}): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-prof-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  made.push(id);
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, x_name) VALUES (${id}, ${`v213p-${id}`}, ${key}, ${`px${id}`}, ${`pr${RUN}${id}`.slice(0, 15)}, 'Maya Chen')`;
  // The agent's own name for the project (identity): shown even while the repo can't be read as public.
  if (o.named) await sql()`UPDATE builder_profiles SET identity = ${sql().json({ projects: [{ name: o.named }] } as never)} WHERE builder_id = ${id}`;
  if (o.proof ?? true)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  return id;
}

test('11.6 profileData reads the page from stored rows: hidden updates never, the Started card from facts.started', dbTest, async () => {
  const key = `pr${RUN}/recipes`;
  const id = await person(key, { named: 'Recipe planner' });
  // The repo reads as public today: it is named and linked.
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) SELECT id, '{"private": false}'::jsonb, true, now() FROM builder_sources WHERE builder_id = ${id}`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at)
    VALUES (${id}, 62, ${sql().json({ shipping: { points: 62, raw: { mask: 0b1010101110, weeks: 6, recent: 3, live_ships: 1 } }, used: { points: 24 }, earned: { points: 8 } } as never)}, true, 1, 0, 'v2', 'v2-shipping', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, what, kind, confirmed, shipped, streak, ship_weeks, commit_weeks) VALUES (${id}, ${key}, 'Recipe planner', 'a recipe planner', 'app', true, true, 2, ${['2026-W30', '2026-W41', '2026-W42']}, ${['2026-W41', '2026-W42']})`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES
    (${id}, ${key}, '2026-10-12', 'Shipped.', ${sql().json({ shipped_code: { n: 2 } } as never)}),
    (${id}, ${key}, '2026-10-05', 'Hidden.', '{}'::jsonb),
    (${id}, ${key}, '2026-09-28', NULL, ${sql().json({ started: { live: true, weeks: 1, people: 0 } } as never)}),
    (${id}, ${key}, '2026-09-21', NULL, '{}'::jsonb)`;
  await sql()`UPDATE project_updates SET hidden = true WHERE project_key = ${key} AND week = '2026-10-05'`;
  const d = (await profileData(id, new Date('2026-10-14T00:00:00Z')))!;
  assert.deepEqual(d.log.map((c) => c.week), ['2026-10-12', '2026-09-28'], 'hidden and empty weeks never show');
  assert.equal(d.log[1].started, 'Started tracking Recipe planner.');
  assert.deepEqual(d.log[1].chips, ['Live', '1 week shipping']);
  assert.deepEqual(d.log[0].chips, ['2 commits']);
  // Shipping and its why from the stored parts; the old used and earned keys are ignored.
  assert.equal(d.score, 62);
  assert.equal(d.why, 'Code in 6 of the last 12 weeks, 3 of the last 4. Ship code this week to add up to 14 points.');
  assert.equal(d.line, 'Shipping 62 · #1 of 1 builder this week');
  assert.equal(d.grid.length, 52);
  // R18 fix 1: commit weeks only; W30 (a deploy week, in ship_weeks) is not a square.
  assert.equal(d.grid.filter((g) => g.on).length, 2);
  assert.deepEqual(d.grid.slice(-2), [{ week: '2026-W41', on: true }, { week: '2026-W42', on: true }]);
  assert.equal(d.streak, 2);
  assert.equal(d.name, 'Maya Chen');
  assert.equal(d.initials, 'P');
  assert.equal(d.project?.name, 'Recipe planner');
  assert.equal(d.project?.repo, `https://github.com/${key}`);
  assert.equal(d.project?.confirmed, true);
});

test('11.6b (v2.13.1 O3) a week with an update and the start is one card with a Started tracking chip; a repo that does not read as public is never named or linked', dbTest, async () => {
  const key = `pr${RUN}/fresh`;
  const id = await person(key);
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${key}, 'Fresh app', 'app', true, true)`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES
    (${id}, ${key}, '2026-10-12', 'First week.', ${sql().json({ shipped_code: { n: 1 }, started: { live: false, weeks: 0, people: 0 } } as never)})`;
  const d = (await profileData(id, new Date('2026-10-14T00:00:00Z')))!;
  // v2.13.1 O3: the Started card merges into its week's card as a chip (never two cards with one week heading).
  assert.deepEqual(d.log.map((c) => [c.week, c.text, c.started ?? null, c.chips]), [['2026-10-12', 'First week.', null, ['Started tracking', '1 commit']]]);
  assert.equal(d.project?.name, 'Private project', 'v2.12.1 shownProjects: no public reading, not the agent\'s own name');
  assert.equal(d.project?.repo, null);
  assert.equal(d.score, null, 'no rank line: never a bare ring');
  assert.equal(d.bench, null);
  // Final follow-ups 1: the streak is the grid's (this week's checked commits fill its square): one week in a row.
  assert.equal(d.streak, 1);
});

test('11.8 (v2.13.1 O3) a one project not yet confirmed by its repo: one calm card for everyone, no ring, no grid, no log, no numbers', dbTest, async () => {
  const key = `pr${RUN}/notmine`;
  const id = await person(key, { proof: false });
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people, money_usd) VALUES (${id}, ${key}, 'Not mine', 'app', true, true, 40, 500)`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES (${id}, ${key}, '2026-10-12', 'Claimed.', ${sql().json({ shipped_code: { n: 3 } } as never)})`;
  const d = (await profileData(id, new Date('2026-10-14T00:00:00Z')))!;
  assert.equal(d.project?.confirmed, false);
  assert.deepEqual(d.log, []);
  assert.ok(!('people' in d.project!) && !('money' in d.project!), 'people and money are never on the profile');
  const h = html(React.createElement(BenchProfileView, { data: d, tab: 'log' }));
  assert.ok(h.includes(confirmingCardLine('Maya Chen', 'Private project')), h);
  assert.equal(confirmingCardLine('Maya Chen', 'Recipe planner'), 'Maya Chen is getting Recipe planner on the leaderboard.');
  assert.doesNotMatch(h, /Claimed\./);
  assert.doesNotMatch(h, /data-week=/, 'no grid');
  assert.doesNotMatch(h, /Code in \d+ of|Shipped \d+ of/, 'no grid title, no score parts');
  assert.doesNotMatch(h, /of 100/, 'no ring');
  assert.doesNotMatch(h, /Code in \d+ of the last 12/, 'no why');
  assert.doesNotMatch(h, /confirmed as theirs/, 'one neutral line: the owner is not detected');
  assert.ok(h.includes(LOG_EMPTY));
});

test('11.8b (v2.13.1 O3) Confirming hides the ring and the grid even when a score and shipping weeks exist', () => {
  const d: ProfileData = { ...DATA, project: { ...DATA.project!, confirmed: false } };
  const h = html(React.createElement(BenchProfileView, { data: d, tab: 'log' }));
  assert.ok(h.includes(confirmingCardLine('Maya Chen', 'Recipe planner')));
  for (const re of [/data-week=/, /Code in \d+ of/, /Shipped \d+ of/, /6 weeks in a row/, /Added fridge photo import/]) assert.doesNotMatch(h, re);
  // Once confirmed: the full profile as built in v2.13.
  const full = html(React.createElement(BenchProfileView, { data: DATA, tab: 'log' }));
  assert.ok(!full.includes(confirmingCardLine('Maya Chen', 'Recipe planner')));
  assert.equal((full.match(/data-week=/g) ?? []).length, 52);
});

test('11.9 the grid titles each square with its week\'s Monday (week keys go through mondayOfWeek)', () => {
  const h = html(React.createElement(BenchProfileView, { data: { ...DATA, grid: [{ week: '2026-W42', on: true }] }, tab: 'log' }));
  assert.match(h, /data-week="2026-W42" data-on="true" title="Week of Oct 12"/);
});

test('11.10 a new profile: no ring without a rank line, no raising, no chain lines; the Project tab without a project says so', () => {
  const fresh: ProfileData = { ...DATA, raising: null, bench: null, chainLines: [], score: null, streak: 0, log: [DATA.log[2]], line: null, why: null, project: { ...DATA.project!, coin: null, programs: [], funds: [] } };
  const h = html(React.createElement(BenchProfileView, { data: fresh, tab: 'log' }));
  assert.doesNotMatch(h, /Shipping \d+ of 100/);
  assert.doesNotMatch(h, /Raising|Community round/);
  assert.doesNotMatch(h, /in a row/);
  assert.ok(h.includes('Started tracking Recipe planner.'));
  const none = html(React.createElement(BenchProfileView, { data: { ...fresh, project: null, log: [] }, tab: 'project' }));
  assert.doesNotMatch(none, /Ways to get funded/);
});

test('11.12 scoring and clarity: no Community round chip on any card (the header carries the pill)', async () => {
  const { logCards } = await import('./bench-data');
  const cards = logCards([
    { week: '2026-10-12', text: 'A', facts: { shipped_code: { n: 1 } } },
    { week: '2026-10-05', text: 'B', facts: { shipped_code: { n: 2 } } },
  ], 'Recipe planner');
  assert.deepEqual(cards.map((c) => c.chips), [['1 commit'], ['2 commits']]);
});

test('11.14 (fix round 1) the share post\'s words: the Bench line, else the confirmed project and streak, else the page', async () => {
  const { benchShareText } = await import('./bench-data');
  assert.equal(benchShareText({ handle: 'maya_makes', bench: 'Shipping 62 · Top 4% of builders this week', project: 'Recipe planner', streak: 6 }), 'Shipping 62 · Top 4% of builders this week at EarnKit.');
  assert.equal(benchShareText({ handle: 'maya_makes', bench: null, project: 'Recipe planner', streak: 6 }), 'Shipping Recipe planner, 6 weeks in a row, on EarnKit.');
  assert.equal(benchShareText({ handle: 'maya_makes', bench: null, project: 'Recipe planner', streak: 0 }), 'Shipping Recipe planner on EarnKit.');
  assert.equal(benchShareText({ handle: 'maya_makes', bench: null, project: null, streak: 0 }), '@maya_makes on EarnKit.');
});

test('11.15 (fix round 1, v2.13.1 O3) the Project tab of a project not yet confirmed: its name and what it is, plainly; no links, no numbers', () => {
  const h = html(React.createElement(BenchProfileView, { data: { ...DATA, project: { ...DATA.project!, confirmed: false } }, tab: 'project' }));
  const tab = h.slice(h.indexOf('aria-label="Tabs"'));
  assert.ok(tab.includes('Recipe planner') && tab.includes('a recipe planner'), tab);
  assert.doesNotMatch(h, /confirmed as theirs/);
  for (const s of ['https://recipes.app', 'https://github.com/maya/recipes', 'Live site', '31 people use it', 'Won Base Builder Grants', 'Ways to get funded'])
    assert.ok(!h.includes(s), s);
});

test('11.16 (fix round 1) Avatar remembers which photo failed: a new src gets its own try', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../../app/[handle]/Avatar.tsx', import.meta.url), 'utf8');
  assert.match(src, /failedSrc === src/);
  assert.match(src, /onError=\{\(\) => setFailedSrc\(src\)\}/);
});

test('11.17 (v2.13.1 O3) logCards: the start merges into its week\'s card as a chip; a week with only the start keeps its Started card', async () => {
  const { logCards } = await import('./bench-data');
  const cards = logCards([
    { week: '2026-10-12', text: 'Shipped the parser.', facts: { shipped_code: { n: 3 }, started: { live: true, weeks: 2, people: 0 } } },
    { week: '2026-10-05', text: null, facts: { started: { live: false, weeks: 0, people: 0 } } },
  ], 'Recipe planner');
  assert.deepEqual(cards, [
    { week: '2026-10-12', text: 'Shipped the parser.', chips: ['Started tracking', '3 commits', 'Live', '2 weeks shipping'] },
    { week: '2026-10-05', text: null, chips: [], started: 'Started tracking Recipe planner.' },
  ]);
  // Never two cards under one week heading.
  assert.equal(new Set(cards.map((c) => c.week)).size, cards.length);
  const h = html(React.createElement(BenchProfileView, { data: { ...DATA, log: cards }, tab: 'log' }));
  assert.equal((h.match(/Week of Oct 12/g) ?? []).length - (h.match(/title="Week of Oct 12"/g) ?? []).length, 1, 'one card heading for the week');
});

test('11.18 (v2.13.1 O3) the grid counts a week with an update and commits, even before the next rescore', dbTest, async () => {
  const key = `pr${RUN}/agree`;
  const id = await person(key, { named: 'Agree app' });
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, streak, commit_weeks) VALUES (${id}, ${key}, 'Agree app', 'app', true, true, 0, ${[]})`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES
    (${id}, ${key}, '2026-10-12', 'Shipped a new onboarding flow.', ${sql().json({ shipped_code: { n: 4 }, started: { live: false, weeks: 0, people: 0 } } as never)}),
    (${id}, ${key}, '2026-10-05', 'Planned the next step.', '{}'::jsonb)`;
  const d = (await profileData(id, new Date('2026-10-14T00:00:00Z')))!;
  assert.deepEqual(d.grid.filter((g) => g.on).map((g) => g.week), ['2026-W42'], 'the week with commits counts; a week with only words does not');
  assert.deepEqual(d.log.map((c) => [c.week, c.chips]), [['2026-10-12', ['Started tracking', '4 commits']], ['2026-10-05', []]]);
});

test('11.19 (O3 fix round 1) the grid says "Code in N of the last 52 weeks", never "Shipped", so it never contradicts the score part', async () => {
  const { shippedWords } = await import('../../app/[handle]/ShipGrid');
  assert.equal(shippedWords(9), 'Code in 9 of the last 52 weeks');
  const h = html(React.createElement(BenchProfileView, { data: DATA, tab: 'log' }));
  assert.ok(h.includes('Code in 6 of the last 52 weeks'), 'caption');
  assert.match(h, /aria-label="Code in 6 of the last 52 weeks"/);
  assert.doesNotMatch(h, /Shipped \d+ of the last/);
});

test('11.20 (O3 fix round 1) a start week that went live shows one live chip, not "Went live" and "Live"', async () => {
  const { logCards } = await import('./bench-data');
  const [c] = logCards([{ week: '2026-10-12', text: 'Launched.', facts: { went_live: true, started: { live: true, weeks: 1, people: 0 } } }], 'Recipe planner');
  assert.deepEqual(c.chips, ['Started tracking', 'Went live', '1 week shipping']);
});

test('11.21 (O3 fix round 1) the card links an href only when it is its own parsed URL with no dot segment (a pre-O4 stored row)', () => {
  const card = (text: string) => html(React.createElement(UpdateCard, { card: { week: '2026-10-12', text, chips: [] }, shape: 'long', showPerson: false }));
  const old = card('Shipped https://github.com/alice/app/../../mallory/evil today');
  assert.doesNotMatch(old, /<a /, old);
  assert.ok(old.includes('https://github.com/alice/app/../../mallory/evil'), 'shown as plain text');
  for (const t of ['See https://github.com/alice/app/./x now', 'See https://Own.site/x now', 'See https://github.com/alice/app/../x now'])
    assert.doesNotMatch(card(t), /<a /, t);
  const ok = card('Code: https://github.com/alice/app/pull/3.');
  assert.match(ok, /<a href="https:\/\/github\.com\/alice\/app\/pull\/3"/);
  assert.match(card('Live at https://recipes.app/.'), /<a href="https:\/\/recipes\.app\/"/, 'trailing punctuation is not a dot segment');
});
