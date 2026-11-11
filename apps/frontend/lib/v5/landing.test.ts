import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { featuredTiles, landingFrom, landingTiles, logoOf, orgKey, readLanding } from './landing';
import { programFixture } from './fixtures/program';
import { upsertProgram, type ProgramRow } from './programs';
import type { Stats } from './stats';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
const rowOf = (over: Parameters<typeof programFixture>[0]): ProgramRow => {
  const file = programFixture(over);
  return { id: file.id, file, source: 'file', created_at: NOW, updated_at: NOW, verified_at: null, stale_since: null };
};
const STATS: Stats = { programs_open: 3, open_money_usd: 105_000, installs: 0, installs_active_7d: 0, finds_7d: 0, applications: 0, applications_7d: 0, won: 0, won_usd: 0 };

test('the tiles: Base first, then any chain, then the rest; open before upcoming', () => {
  const rows = [
    rowOf({ id: 'z-other', chains: ['tempo'], ends_at: '2026-11-10T00:00:00Z' }),
    rowOf({ id: 'z-soon', status: 'upcoming', opens_note: 'Opens in January', submission_requirements: [], ends_at: null }),
    rowOf({ id: 'z-any', chains: [], any_chain: true, ends_at: '2026-11-09T00:00:00Z' }),
    rowOf({ id: 'z-base-late', chains: ['base'], ends_at: '2026-12-09T00:00:00Z' }),
    rowOf({ id: 'z-base-roll', chains: ['base'], ends_at: null }),
    rowOf({ id: 'z-base-soon', chains: ['base'], ends_at: '2026-11-20T00:00:00Z' }),
  ];
  const tiles = landingTiles(rows, NOW);
  assert.deepEqual(tiles.map((t) => t.id), ['z-base-soon', 'z-base-late', 'z-base-roll', 'z-any', 'z-other', 'z-soon']);
});

test('every program is a tile: no cap, money, closes, kind', () => {
  const rows = Array.from({ length: 9 }, (_, i) => rowOf({ id: `n-${i}`, ends_at: i === 0 ? '2026-12-01T20:00:00Z' : null, summary: 'Up to $5,000 · 11:59 PM PT', max_award_usd: 5000 }));
  const tiles = landingTiles(rows, NOW);
  assert.equal(tiles.length, 9);
  const dated = tiles.find((t) => t.id === 'n-0')!;
  assert.equal(dated.money, 'Up to $5,000');
  assert.equal(dated.when, 'Closes Dec 1');
  assert.equal(dated.big, true);
  assert.equal(dated.kind, 'grant');
  assert.equal(tiles.find((t) => t.id === 'n-1')!.when, 'Rolling');
});

test('a tile with a pool and a per-winner award shows the pool, and a pool tile is not big (v6.1.6)', () => {
  // Fix round 2 (v6.1.15): a summary with no figure falls back to the pool, before the per-winner award.
  const [t] = landingTiles([rowOf({ id: 'meta-vr', title: 'Meta Horizon VR Competition', summary: 'Prizes for VR apps · rolling', max_award_usd: 100_000, pool_usd: 1_000_000 })], NOW);
  assert.equal(t.money, '$1,000,000 in prizes');
  assert.equal(t.big, false);
});

test('Review Focus 4 (v6.1.14, lane 22 v6.1.15): a featured range tile keeps its low in full figures, not big; a threshold is never its money', () => {
  const rows = [
    rowOf({ id: 'otf', title: 'OTF Internet Freedom Fund', organizer: 'Open Technology Fund', summary: '$10,000 to $900,000 · rolling', max_award_usd: 900_000, min_award_usd: 10_000, ends_at: null }),
    rowOf({ id: 'circle', title: 'Circle Developer Grants', organizer: 'Circle', summary: '$5,000 to $100,000 USDC grants · rolling', reward: 'USDC grants from $5,000 to $100,000', max_award_usd: 100_000, min_award_usd: 5000, ends_at: null }),
    rowOf({ id: 'floss', title: 'FLOSS/fund', organizer: 'FLOSS/fund (Zerodha)', summary: '$10,000 to $100,000 · rolling', max_award_usd: 100_000, min_award_usd: 10_000, ends_at: null }),
  ];
  const six = featuredTiles(rows, NOW);
  assert.deepEqual(six.map((t) => [t.id, t.money, t.big]), [['otf', '$10,000 to $900,000', false], ['circle', '$5,000 to $100,000 USDC grants', false], ['floss', '$10,000 to $100,000', false]]);
  const [arb] = landingTiles([rowOf({ id: 'arb', title: 'Arbitrum Stablecoin Growth Program', summary: 'incentives + 200K ARB at $10M USDG TVL · no deadline stated', ends_at: null })], NOW);
  assert.equal(arb.money, 'Incentives + 200K ARB');
  assert.doesNotMatch(arb.money, /\$10M/);
  assert.equal(arb.big, false);
});

test('an upcoming program reads Not open yet', () => {
  const [t] = landingTiles([rowOf({ id: 'u-1', status: 'upcoming', opens_note: 'Opens in January', submission_requirements: [] })], NOW);
  assert.equal(t.when, 'Not open yet');
  assert.equal(t.status, 'upcoming');
});

test('a logo file that is missing is no logo; one that exists is its path', () => {
  assert.equal(logoOf(programFixture({ id: 'no-file', logo: { path: 'programs/no-file.svg', source_url: 'https://example.com/l' } })), null);
  assert.equal(logoOf(programFixture({ id: 'no-logo' })), null);
  assert.equal(
    logoOf(programFixture({ id: 'base-builder-grants', logo: { path: 'programs/base-builder-grants.svg', source_url: 'https://example.com/l' } })),
    '/programs/base-builder-grants.svg',
  );
});

test('landingFrom: the chip is the stats money; none at zero', () => {
  const l = landingFrom([rowOf({ id: 'c-1' })], STATS, NOW);
  assert.equal(l.chip, '$105,000 in grants and prizes open now');
  assert.equal(l.tiles.length, 1);
  assert.deepEqual(l.featured.map((t) => t.id), []);
  assert.equal(l.total, 1);
  assert.equal(landingFrom([], { ...STATS, open_money_usd: 0 }, NOW).chip, null);
});

const DAY = 86_400_000;
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString();

const DATED = 'Up to $1,000 · 11:59 PM UTC';
/** A dated summary whose money matches the award (fix round 2: the tile reads the summary's money phrase). */
const dated = (usd: number) => `Up to $${usd.toLocaleString('en-US')} · 11:59 PM UTC`;

test('featuredTiles: six by the rule (v6.2.0)', () => {
  const rows = [
    rowOf({ id: 'f-big-pool', organizer: 'Cee Labs', title: 'C Grants', pool_usd: 1_000_000, max_award_usd: 10_000, summary: '$1,000,000 in grants · rolling' }),
    rowOf({ id: 'f-soon-later', organizer: 'Bee Org', max_award_usd: 30_000, ends_at: inDays(10), summary: dated(30_000) }),
    rowOf({ id: 'f-soon-tiny', organizer: 'Tiny Org', title: 'Tiny Hack', in_person: true, pool_usd: 4600, ends_at: inDays(1), summary: DATED }),
    rowOf({ id: 'f-soon-small', organizer: 'Small Org', max_award_usd: 12_000, ends_at: inDays(2), summary: dated(12_000) }),
    rowOf({ id: 'f-invest', organizer: 'Inv Org', investment: true, max_award_usd: 500_000 }),
    rowOf({ id: 'f-big-award', organizer: 'Dee Org', max_award_usd: 100_000, ends_at: inDays(40), summary: dated(100_000) }),
    rowOf({ id: 'f-upcoming', organizer: 'Up Org', status: 'upcoming', opens_note: 'Opens in January', submission_requirements: [], max_award_usd: 900_000 }),
    rowOf({ id: 'f-c-hack', organizer: '  cee Labs ', title: 'C Hackathon', in_person: true, pool_usd: 500_000 }),
    rowOf({ id: 'f-prose', organizer: 'Prose Org', summary: 'Credits and support · rolling' }),
    rowOf({ id: 'f-soon-first', organizer: 'Ay Org', max_award_usd: 25_000, ends_at: inDays(5), summary: dated(25_000) }),
    rowOf({ id: 'f-mid-pool', organizer: 'Eff Org', pool_usd: 20_000, summary: '$20,000 in grants · rolling' }),
    rowOf({ id: 'f-small', organizer: 'Gee Org', max_award_usd: 10_000 }),
  ];
  const six = featuredTiles(rows, NOW);
  assert.deepEqual(six.map((t) => t.id), ['f-soon-first', 'f-soon-later', 'f-big-pool', 'f-big-award', 'f-mid-pool', 'f-soon-small']);
  assert.deepEqual(six.map((t) => t.money), ['Up to $25,000', 'Up to $30,000', '$1,000,000 in grants', 'Up to $100,000', '$20,000 in grants', 'Up to $12,000']);
  assert.equal(six[0].when, 'Closes Nov 9');
  assert.ok(six.every((t) => t.status === 'active' && t.kind !== 'investment'));
  const l = landingFrom(rows, STATS, NOW);
  assert.equal(l.total, 12);
  assert.equal(l.tiles.length, 12);
  assert.deepEqual(l.featured, six);
});

test('featuredTiles: a $4,600 program never features, even alone and closing tomorrow', () => {
  const rows = [rowOf({ id: 'h-tiny', title: 'Blitz Hack', in_person: true, pool_usd: 4600, ends_at: inDays(1), summary: DATED })];
  assert.deepEqual(featuredTiles(rows, NOW), []);
});

test('featuredTiles: a fourth hackathon is skipped for the next grant', () => {
  const hack = (id: string, usd: number) => rowOf({ id, organizer: `${id} Org`, title: `${id} Hackathon`, in_person: true, pool_usd: usd });
  const rows = [hack('h1', 900_000), hack('h2', 800_000), hack('h3', 700_000), hack('h4', 600_000), rowOf({ id: 'g1', organizer: 'Grant Org', max_award_usd: 50_000 })];
  const six = featuredTiles(rows, NOW);
  assert.deepEqual(six.map((t) => t.id), ['h1', 'h2', 'h3', 'g1']);
  assert.equal(six.filter((t) => t.kind === 'hackathon').length, 3);
});

test('featuredTiles: the Monad pair counts once (organizer first word)', () => {
  const rows = [
    rowOf({ id: 'm-oregon', organizer: 'Monad Foundation and Oregon Blockchain Group', in_person: true, pool_usd: 40_000 }),
    rowOf({ id: 'm-gz', organizer: 'Monad Foundation, OpenBuild and Box', in_person: true, pool_usd: 30_000 }),
  ];
  assert.deepEqual(featuredTiles(rows, NOW).map((t) => t.id), ['m-oregon']);
});

test('featuredTiles: the organizer key skips "the", "open" and "foundation" before the first word', () => {
  assert.equal(orgKey('Open Technology Fund'), 'technology');
  assert.equal(orgKey('The Graph Foundation'), 'graph');
  assert.equal(orgKey('  Thiel Foundation '), 'thiel');
  assert.equal(orgKey('Open'), 'open');
  const rows = [
    rowOf({ id: 'o-otf', organizer: 'Open Technology Fund', max_award_usd: 900_000 }),
    rowOf({ id: 'o-oc', organizer: 'Open Collective', max_award_usd: 50_000 }),
    rowOf({ id: 't-graph', organizer: 'The Graph Foundation', max_award_usd: 40_000 }),
    rowOf({ id: 't-gitcoin', organizer: 'The Gitcoin Foundation', max_award_usd: 30_000 }),
  ];
  assert.deepEqual(featuredTiles(rows, NOW).map((t) => t.id), ['o-otf', 'o-oc', 't-graph', 't-gitcoin']);
});

test('featuredTiles: an empty organizer is its title; equal money goes by id; a rolling summary is not closing soon', () => {
  const rows = [
    rowOf({ id: 'g-b', organizer: ' ', title: 'Same Grants', max_award_usd: 50_000 }),
    rowOf({ id: 'g-a', organizer: ' ', title: 'Same Grants', max_award_usd: 50_000 }),
    rowOf({ id: 'g-c', organizer: ' ', title: 'Other Grants', max_award_usd: 50_000 }),
    rowOf({ id: 'g-roll', organizer: 'Roll Org', max_award_usd: 30_000, ends_at: inDays(3), summary: 'Up to $30,000 · rolling' }),
  ];
  assert.deepEqual(featuredTiles(rows, NOW).map((t) => t.id), ['g-a', 'g-c', 'g-roll']);
});

test('readLanding lists the open and upcoming programs of the database', async () => {
  await upsertProgram(programFixture({ id: 'zz-landing-open', title: 'Landing Open', ends_at: '2027-01-01T00:00:00Z' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'zz-landing-soon', title: 'Landing Soon', status: 'upcoming', opens_note: 'Opens in January', submission_requirements: [] }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'zz-landing-shut', title: 'Landing Shut', status: 'closed' }), 'file', NOW);
  const l = await readLanding(NOW);
  const ids = l.tiles.map((t) => t.id);
  assert.ok(ids.includes('zz-landing-open') && ids.includes('zz-landing-soon'));
  assert.ok(!ids.includes('zz-landing-shut'));
  assert.ok(l.chip === null || l.chip.endsWith(' in grants and prizes open now'));
});

test('lane 22 (v6.1.15): a lone full figure is big, "Up to" draws small above it; never K or M on a tile', () => {
  const [one, upTo, range] = landingTiles([
    rowOf({ id: 'b-1', summary: '$1,000,000 · rolling', max_award_usd: 1_000_000, ends_at: null }),
    rowOf({ id: 'b-2', summary: 'up to $100,000 · rolling', max_award_usd: 100_000, ends_at: null }),
    rowOf({ id: 'b-3', summary: '$1,000 to $5,000 · rolling', max_award_usd: 5000, min_award_usd: 1000, ends_at: null }),
  ], NOW).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual([one.money, one.big], ['$1,000,000', true]);
  assert.deepEqual([upTo.money, upTo.big], ['Up to $100,000', true]);
  assert.deepEqual([range.money, range.big], ['$1,000 to $5,000', false]);
  for (const t of [one, upTo, range]) assert.doesNotMatch(t.money, /\d[KM]\b/);
  // Fix round 2: the summary's phrase leads; a phrase longer than a figure is a small tile.
  const [phrase] = landingTiles([rowOf({ id: 'b-4', summary: '$1,000,000 per team · rolling', max_award_usd: 1_000_000, ends_at: null })], NOW);
  assert.deepEqual([phrase.money, phrase.big], ['$1,000,000 per team', false]);
});
