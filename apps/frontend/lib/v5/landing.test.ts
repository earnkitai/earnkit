import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { landingFrom, landingTiles, logoOf, readLanding } from './landing';
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
  assert.equal(dated.money, '$5K');
  assert.equal(dated.when, 'Closes Dec 1');
  assert.equal(dated.big, true);
  assert.equal(dated.kind, 'grant');
  assert.equal(tiles.find((t) => t.id === 'n-1')!.when, 'Rolling, apply anytime');
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
  assert.equal(l.chip, '$105K in grants and prizes open now');
  assert.equal(l.tiles.length, 1);
  assert.equal(landingFrom([], { ...STATS, open_money_usd: 0 }, NOW).chip, null);
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
