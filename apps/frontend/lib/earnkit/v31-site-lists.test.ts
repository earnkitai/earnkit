import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { benchRows } from './bench-data';
import { carouselCards, feedWeeks, rankFeed } from './feed';
import { LANDING_PROGRAMS, landingFrom, landingPrograms, readLanding, type Tile } from './landing';
import type { Card } from './present';
import type { PublicStats } from './stats';
import { feedWeekStats } from './site-data';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';

/** v3.1 site Task 4: the list reads (leaderboard streak, feed score and commits, landing chip and Activity, feed week stats). */

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});

const RUN = randomBytes(3).toString('hex');
const NOW = new Date('2026-10-21T12:00:00Z');

/** A listed person (claimed, ranked, shown) with one confirmed main project and rows by week. */
async function listed(score: number, o: { streak?: number; weeks?: { monday: string; facts: Record<string, unknown>; feedHidden?: boolean }[] } = {}): Promise<{ id: number; key: string }> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v31l-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = `l${RUN}/p${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, x_name) VALUES (${id}, ${`v31l-${id}`}, ${key}, ${`lx${id}`}, ${`l${RUN}${id}`}, 'Maya')`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, ${score}, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, streak) VALUES (${id}, ${key}, 'Recipe planner', 'app', true, true, ${o.streak ?? 0})`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  for (const w of o.weeks ?? [])
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts, feed_hidden) VALUES (${id}, ${key}, ${w.monday}, 'note', ${sql().json(w.facts as never)}, ${w.feedHidden ?? false})`;
  return { id, key };
}

test('(a) benchRows rows carry streak equal to builder_projects.streak', db, async () => {
  const a = await listed(80, { streak: 7 });
  const b = await listed(60, { streak: 0 });
  const { rows } = await benchRows({ chain: null, weekly: false }, { only: [a.id, b.id] });
  assert.deepEqual(rows.map((r) => r.streak), [7, 0]);
});

test('(b) feedWeeks cards carry score (the live score) and commits (facts.shipped_code.n, 0 without)', db, async () => {
  const a = await listed(72, { weeks: [{ monday: '2026-10-12', facts: { shipped_code: { n: 14 } } }] });
  const b = await listed(30, { weeks: [{ monday: '2026-10-12', facts: { went_live: true } }] });
  await rankFeed(NOW);
  const [week] = await feedWeeks(NOW, { only: [a.id, b.id] });
  const byHandle = new Map(week.cards.map((c) => [c.handle, c]));
  const ca = byHandle.get(`l${RUN}${a.id}`)!;
  const cb = byHandle.get(`l${RUN}${b.id}`)!;
  assert.equal(ca.score, 72);
  assert.equal(ca.commits, 14);
  assert.equal(cb.score, 30);
  assert.equal(cb.commits, 0);
});

const card = (id: string, o: Partial<Card> = {}): Card => ({
  id, title: id, summary: '', tag: null, each_time: [], ends_at: null, max_award_usd: 0, difficulty: null, logo: null, chains: ['base'], ...o,
});
const stats = { installs: 0, builders_won_usd: 0 } as PublicStats;

test('(c) landingFrom: the chip, and the tiles\' kind, big and when', () => {
  const base = card('base-builder-grants', { max_award_usd: 5000, reward: 'up to $5,000' });
  const circle = card('circle-developer-grants', { max_award_usd: 100000, chains: ['arc'], reward: 'milestone-based USDC grants' });
  assert.equal(landingFrom([base, circle], stats, NOW).open_chip, '$105K in grants open now');
  const inPerson = card('hack', { max_award_usd: 20000, in_person: true });
  assert.equal(landingFrom([base, circle, inPerson], stats, NOW).open_chip, '$125K in grants and prizes open now');
  assert.equal(landingFrom([], stats, NOW).open_chip, null);
  assert.equal(landingFrom([card('upcoming-one', { max_award_usd: 5000, status: 'upcoming' })], stats, NOW).open_chip, null);
  // An unlisted program is neither a tile nor in the chip.
  const hidden = landingFrom([base, card('gone', { max_award_usd: 90000, in_person: true, status: 'unlisted' })], stats, NOW);
  assert.deepEqual(hidden.tiles.map((t) => t.id), ['base-builder-grants']);
  assert.equal(hidden.open_chip, '$5K in grants open now');
  const l = landingFrom([
    base,
    card('colosseum', { max_award_usd: 400000, ends_at: new Date('2026-11-18T23:59:00Z'), chains: ['base'] }),
    card('a16z', { max_award_usd: 1000000, investment: true, ends_at: new Date('2026-11-02T23:59:00Z'), chains: ['base'] }),
    circle,
  ], stats, NOW);
  const t = (id: string) => l.tiles.find((x) => x.id === id)!;
  assert.deepEqual([t('base-builder-grants'), t('colosseum'), t('a16z'), t('circle-developer-grants')].map((x) => [x.big, x.when]), [
    ['$5K', 'Rolling'], ['$400K', 'Closes Nov 18'], ['$1M', 'Closes Nov 2'], ['$100K', 'Rolling'],
  ]);
  assert.equal(t('a16z').kind, 'investment');
  assert.equal(t('base-builder-grants').kind, 'grant');
  assert.equal(t('circle-developer-grants').kind, 'grant, in USDC');
  assert.equal(landingFrom([card('none')], stats, NOW).tiles[0].big, null);
  assert.equal(landingFrom([card('up', { status: 'upcoming' })], stats, NOW).tiles[0].when, 'Not open yet');
});

test('(d) landingPrograms drops upcoming tiles and keeps 4 in byRelevance order', () => {
  const l = landingFrom([
    card('p1', { max_award_usd: 1000 }), card('up', { status: 'upcoming', max_award_usd: 9000 }), card('p2', { max_award_usd: 2000 }),
    card('p3', { max_award_usd: 3000 }), card('p4', { max_award_usd: 4000 }), card('p5', { max_award_usd: 5000 }),
  ], stats, NOW);
  assert.equal(LANDING_PROGRAMS, 4);
  const shown = landingPrograms(l.tiles);
  assert.equal(shown.length, 4);
  assert.ok(shown.every((t: Tile) => t.status === 'active'));
  assert.deepEqual(shown.map((t) => t.id), l.tiles.filter((t) => t.status === 'active').slice(0, 4).map((t) => t.id));
  assert.deepEqual(landingPrograms([]), []);
});

test('(e) readLanding.activity is carouselCards\' first 3; an empty feed gives []', db, async () => {
  const l = await readLanding(NOW);
  assert.deepEqual(l.activity, (await carouselCards(NOW)).slice(0, 3));
  assert.ok(l.activity.length <= 3);
  // Nothing in the feed (a week with no rows): [] (carouselCards of an empty pool).
  assert.deepEqual((await carouselCards(new Date('2031-03-12T12:00:00Z'))).slice(0, 3), []);
  const empty = await readLanding(new Date('2031-03-12T12:00:00Z'));
  assert.deepEqual(empty.activity, []);
});

test('(f) feedWeekStats on a seeded week: shipped rows, one went live, one feed_hidden; applications entered or told in the week', db, async () => {
  const monday = '2030-01-07';
  const inWeek = new Date('2030-01-09T10:00:00Z');
  const a = await listed(60, { weeks: [{ monday, facts: { shipped_code: { n: 12 } } }] });
  const b = await listed(55, { weeks: [{ monday, facts: { shipped_code: { n: 30 }, went_live: true } }] });
  const c = await listed(50, { weeks: [{ monday, facts: { shipped_code: { n: 0 } } }] });
  const d = await listed(45, { weeks: [{ monday, facts: { shipped_code: { n: 50 } }, feedHidden: true }] });
  const only = [a.id, b.id, c.id, d.id];
  // Programs: one entered by a, one told by b in the week, one told outside the week.
  const mk = async (name: string) => {
    const id = `v31-lists-${process.pid}-${name}`;
    await upsertProgram(ProgramFile.parse({ ...committedProgram('alliance-all19'), id, title: `Lists ${name} ${RUN}` }));
    return id;
  };
  const [pe, pt, po] = [await mk('entry'), await mk('told'), await mk('outside')];
  await sql()`INSERT INTO projects (program_id, name, repo_url, repo_key, installation_id, submitted_at) VALUES (${pe}, 'Kit', ${`https://github.com/${a.key}`}, ${a.key}, ${a.id}, ${inWeek})`;
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', ${pt}, 'applied', ${inWeek})`;
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', ${po}, 'applied', '2030-01-20T10:00:00Z')`;
  assert.deepEqual(await feedWeekStats(monday, { only }), { builders: 2, commits: 42, went_live: 1, applications: 2 });
  // An empty week is all zeros.
  assert.deepEqual(await feedWeekStats('2030-02-04', { only }), { builders: 0, commits: 0, went_live: 0, applications: 0 });
});
