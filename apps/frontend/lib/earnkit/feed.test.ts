import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { CAROUSEL_MAX, FEED_WEEK_MAX, carouselCards, feedRankStep, feedWeeks, pointsOf, rankFeed, setFeedFlag } from './feed';
import FeedView, { FEED_TITLE } from '../../app/feed/FeedView';
import UpdateCard from '../../app/components/ui/UpdateCard';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
(globalThis as { React?: typeof React }).React = React;
const RUN = randomBytes(3).toString('hex');
const NOW = new Date('2026-10-21T12:00:00Z'); // a Wednesday; the last finished week is 2026-10-12

test('6.1 the points table, exactly (R16b: shipping facts only)', () => {
  assert.equal(pointsOf({ went_live: true }), 40);
  assert.equal(pointsOf({ won: [{ title: 'A' }, { title: 'B' }] }), 40, 'a win is 40, however many');
  // R16b: an old row's people and money count nothing.
  assert.equal(pointsOf({ users_up: { n: 31 } }), 0);
  assert.equal(pointsOf({ earned: { usd: 150 } }), 0);
  assert.equal(pointsOf({ shipped_code: { n: 12 } }), 10);
  assert.equal(pointsOf({ streak: { w: 6 } }), 6);
  assert.equal(pointsOf({ streak: { w: 14 } }), 10);
  assert.equal(pointsOf({ started: { live: true, weeks: 6, people: 31 } }), 0, 'the start is not progress');
  assert.equal(pointsOf({ went_live: true, users_up: { n: 31 }, shipped_code: { n: 1 }, streak: { w: 3 } }), 53);
});

/** A listed person (claimed, ranked, shown) with one confirmed main project and rows by week. */
async function listed(score: number, weeks: { monday: string; text: string | null; facts: Record<string, unknown> }[]): Promise<{ id: number; key: string; rowIds: number[] }> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-feed-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = `f${RUN}/p${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, x_name) VALUES (${id}, ${`v213f-${id}`}, ${key}, ${`fx${id}`}, ${`f${RUN}${id}`}, 'Maya')`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, ${score}, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${key}, 'Recipe planner', 'app', true, true)`;
  // Final fix M1: the feed reads the Bench gate (the repo's own proof) now.
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  const rowIds: number[] = [];
  for (const w of weeks) {
    const [{ rid }] = await sql()<{ rid: number }[]>`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES (${id}, ${key}, ${w.monday}, ${w.text}, ${sql().json(w.facts as never)}) RETURNING id::int AS rid`;
    rowIds.push(rid);
  }
  return { id, key, rowIds };
}

test('6.2 the feed ranks a finished week by points, ties by the Bench score; no facts never reaches it; a hidden update leaves it', dbTest, async () => {
  const a = await listed(40, [{ monday: '2026-10-12', text: 'Went live today.', facts: { went_live: true } }]);
  const b = await listed(90, [{ monday: '2026-10-12', text: 'Pushed code.', facts: { shipped_code: { n: 3 } } }]);
  const c = await listed(10, [{ monday: '2026-10-12', text: 'Also went live.', facts: { went_live: true } }]);
  const d = await listed(99, [{ monday: '2026-10-12', text: 'Thinking about it.', facts: {} }]);
  const e = await listed(99, [{ monday: '2026-10-12', text: 'Hidden one.', facts: { went_live: true } }]);
  await sql()`UPDATE project_updates SET hidden = true WHERE id = ${e.rowIds[0]}`;
  const only = [a.id, b.id, c.id, d.id, e.id];
  await rankFeed(NOW);
  const [week] = await feedWeeks(NOW, { only });
  assert.equal(week.monday, '2026-10-12');
  assert.equal(week.label, 'Week of Oct 12');
  assert.deepEqual(week.cards.map((x) => x.text), ['Went live today.', 'Also went live.', 'Pushed code.'], 'a 40 before a 10; the tie by score (40 over 10)');
  assert.deepEqual(week.cards[0].chips, ['Went live']);
});

test('6.3 the owner\'s pin leads its week; the owner\'s hide leaves the feed and stays on the profile; facts-only weeks show their chips', dbTest, async () => {
  const a = await listed(10, [{ monday: '2026-10-12', text: 'Small thing.', facts: { shipped_code: { n: 1 } } }]);
  const b = await listed(90, [{ monday: '2026-10-12', text: 'Big thing.', facts: { went_live: true, users_up: { n: 31 } } }]);
  const c = await listed(50, [{ monday: '2026-10-12', text: null, facts: { shipped_code: { n: 9 } } }]);
  await rankFeed(NOW);
  assert.equal(await setFeedFlag(a.rowIds[0], 'pin', true), true);
  assert.equal(await setFeedFlag(b.rowIds[0], 'hide', true), true);
  assert.equal(await setFeedFlag(999_999_999, 'pin', true), false);
  const [week] = await feedWeeks(NOW, { only: [a.id, b.id, c.id] });
  assert.deepEqual(week.cards.map((x) => [x.text, x.pinned]), [['Small thing.', true], [null, false]]);
  const [row] = await sql()<{ hidden: boolean; feed_hidden: boolean }[]>`SELECT hidden, feed_hidden FROM project_updates WHERE id = ${b.rowIds[0]}`;
  assert.deepEqual(row, { hidden: false, feed_hidden: true });
});

test('6.4 the last finished week first, at most 20, then older weeks; the carousel is the top 12', dbTest, async () => {
  const people = [];
  for (let i = 0; i < FEED_WEEK_MAX + 2; i++)
    people.push(await listed(i, [{ monday: '2026-10-12', text: `Update ${i}.`, facts: { shipped_code: { n: 1 }, streak: { w: (i % 9) + 2 } } }, { monday: '2026-10-05', text: `Older ${i}.`, facts: { shipped_code: { n: 1 } } }]));
  const only = people.map((p) => p.id);
  await rankFeed(NOW);
  const weeks = await feedWeeks(NOW, { only });
  assert.deepEqual(weeks.map((w) => w.monday), ['2026-10-12', '2026-10-05']);
  assert.equal(weeks[0].cards.length, FEED_WEEK_MAX);
  assert.equal((await carouselCards(NOW, { only })).length, CAROUSEL_MAX);
  // The current week (not finished) is never in the feed.
  await listed(100, [{ monday: '2026-10-19', text: 'This week.', facts: { went_live: true } }]);
  assert.ok(!(await feedWeeks(NOW)).some((w) => w.monday === '2026-10-19'));
});

test('6.5 a person who is not listed (unclaimed, hidden or held) or a project not confirmed never reaches the feed', dbTest, async () => {
  const a = await listed(50, [{ monday: '2026-10-12', text: 'Hidden page.', facts: { went_live: true } }]);
  await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${a.id}`;
  const b = await listed(50, [{ monday: '2026-10-12', text: 'Not mine.', facts: { went_live: true } }]);
  await sql()`UPDATE builder_projects SET confirmed = false WHERE builder_id = ${b.id}`;
  await rankFeed(NOW);
  const weeks = await feedWeeks(NOW, { only: [a.id, b.id] });
  assert.deepEqual(weeks, []);
});

test('6.6 the feed page: long cards, plain words, no "written by", no all-caps labels', () => {
  const card = { id: 1, handle: 'maya_makes', name: 'Maya Chen', avatar: null, project: 'Recipe planner', week: '2026-10-12', text: 'Added fridge photo import.', summary: 'Fixed the timer and added the shopping list.', chips: ['Went live', '+31 people'], pinned: false };
  const html = renderToStaticMarkup(React.createElement(FeedView, { weeks: [{ monday: '2026-10-12', label: 'Week of Oct 12', cards: [card] }] }));
  for (const s of [FEED_TITLE, 'Week of Oct 12', 'Maya Chen', '@maya_makes', 'Recipe planner', 'Added fridge photo import.', 'Went live', '+31 people', 'Fixed the timer and added the shopping list.'])
    assert.ok(html.includes(s.replace(/'/g, '&#x27;')), s);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, ' '), /written by|agent/i); // text only: the Docs link's anchor is not copy
  assert.match(html, /href="\/maya_makes"/);
  const square = renderToStaticMarkup(React.createElement(UpdateCard, { card, shape: 'square' }));
  assert.match(square, /data-shape="square"/);
  // Weekly updates: the square card shows the summary; the builder's note is on the long card, as a quote.
  assert.ok(square.includes('Fixed the timer') && !square.includes('fridge photo'));
  assert.match(html, /<blockquote data-ek-note=""[^>]*><p[^>]*>Added fridge photo import\.<\/p><\/blockquote>/);
  assert.equal(renderToStaticMarkup(React.createElement(FeedView, { weeks: [] })).includes('No updates yet'), true);
});

test('6.7b weekly updates: a summary is plain text, never markup or a link', () => {
  const html = renderToStaticMarkup(React.createElement(UpdateCard, { card: { week: '2026-10-12', chips: [], text: null, summary: '<b>x</b> https://evil.example' }, shape: 'long', showPerson: false }));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.doesNotMatch(html, /<a /);
});

test('6.7 the card renders stored text as plain text: markup is escaped, only own https links become links', () => {
  const base = { week: '2026-10-12', chips: [] as string[] };
  const evil = renderToStaticMarkup(React.createElement(UpdateCard, { card: { ...base, text: '<script>alert(1)</script> <img src=x onerror=alert(1)> **bold** [x](https://evil.example)' }, shape: 'long', showPerson: false }));
  assert.ok(!evil.includes('<script>') && !evil.includes('<img'), evil);
  assert.ok(evil.includes('&lt;script&gt;') && evil.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!evil.includes('<strong'), 'no markdown');
  const link = renderToStaticMarkup(React.createElement(UpdateCard, { card: { ...base, text: 'Live at https://recipe.app/new. Fixed bugs.' }, shape: 'long', showPerson: false }));
  assert.match(link, /<a href="https:\/\/recipe\.app\/new" rel="nofollow noopener ugc"/);
  assert.ok(link.includes('</a>. Fixed bugs.'));
  assert.doesNotMatch(link, /@|avatar/, 'no person row without showPerson');
  assert.equal(renderToStaticMarkup(React.createElement(UpdateCard, { card: { ...base, text: 'Not a link: http://a.b and www.c.d' }, shape: 'long', showPerson: false })).includes('<a '), false);
});

test('6.8 the rank step takes its slot only from 15:00 UTC, once a UTC day', dbTest, async () => {
  const day = `${2100 + Math.floor(Math.random() * 900)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
  assert.deepEqual(await feedRankStep(new Date(`${day}T14:59:00Z`)), { step: 'skipped' });
  const first = await feedRankStep(new Date(`${day}T15:00:00Z`));
  assert.ok('rows' in first, 'the 14:59 run did not take the slot');
  assert.deepEqual(await feedRankStep(new Date(`${day}T16:00:00Z`)), { step: 'skipped' });
});
