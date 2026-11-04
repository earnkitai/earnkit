import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { programsListGet, readListedPrograms, type ListedProgram } from './programs-read';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');

const listed = (over: Partial<ListedProgram> & { id: string }): ListedProgram => ({
  title: over.id,
  organizer: 'Org',
  category: 'grant',
  chains: ['base'],
  any_chain: false,
  money: '$5K',
  status: 'active',
  closes_at: null,
  closes_in: null,
  source_url: 'https://example.com/grants',
  submission_url: 'https://example.com/apply',
  source: 'file',
  max_award_usd: 5000,
  ...over,
});

const get = async (query: string, rows: ListedProgram[]) => {
  const res = await programsListGet(new Request(`https://earnkit.com/api/programs${query}`), async () => rows, NOW);
  return { status: res.status, body: (await res.json()) as { ok: boolean; programs: Record<string, unknown>[]; problems?: string[] } };
};

const ROWS = [
  listed({ id: 'g-rolling-big', max_award_usd: 100_000 }),
  listed({ id: 'g-rolling-small', max_award_usd: 1_000 }),
  listed({ id: 'g-soon', closes_at: '2026-11-06T00:00:00Z' }),
  listed({ id: 'g-later', closes_at: '2026-12-01T00:00:00Z' }),
  listed({ id: 'g-closed-since', closes_at: '2026-11-04T11:00:00Z' }),
  listed({ id: 'h-soon', category: 'hackathon', closes_at: '2026-11-05T00:00:00Z' }),
  listed({ id: 'i-one', category: 'investment' }),
  listed({ id: 'u-up', status: 'upcoming' }),
];

test('order: category, then soonest close, rolling last, then the larger award', async () => {
  const { status, body } = await get('', ROWS);
  assert.equal(status, 200);
  assert.deepEqual(
    body.programs.map((p) => p.id),
    ['g-soon', 'g-later', 'g-rolling-big', 'u-up', 'g-rolling-small', 'h-soon', 'i-one'],
  );
});

test('shape: the v4.9 keys, closes_in from the clock, no sort-only field', async () => {
  const { body } = await get('', ROWS);
  const soon = body.programs.find((p) => p.id === 'g-soon')!;
  assert.deepEqual(Object.keys(soon).sort(), [
    'any_chain', 'category', 'chains', 'closes_at', 'closes_in', 'id', 'money', 'organizer', 'source', 'source_url', 'status',
    'submission_url', 'title',
  ]);
  assert.equal(soon.closes_in, 'in 36 hours');
  assert.equal(body.programs.find((p) => p.id === 'g-rolling-big')!.closes_in, 'rolling');
  assert.equal(body.programs.find((p) => p.id === 'u-up')!.closes_in, null);
});

test('filters: category and status; a bad value is 400', async () => {
  assert.deepEqual((await get('?category=hackathon', ROWS)).body.programs.map((p) => p.id), ['h-soon']);
  assert.deepEqual((await get('?status=upcoming', ROWS)).body.programs.map((p) => p.id), ['u-up']);
  const bad = await get('?category=nft', ROWS);
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.problems, ['category: one of grant, hackathon, investment, bounty']);
});

test('a failed read is 503', async () => {
  const res = await programsListGet(new Request('https://earnkit.com/api/programs'), async () => {
    throw new Error('db down');
  }, NOW);
  assert.equal(res.status, 503);
});

test('readListedPrograms: listed programs from the table, with money and links', async () => {
  await upsertProgram(
    programFixture({
      id: 't-read-api',
      organizer: 'Read Org',
      chains: ['solana'],
      max_award_usd: 5000,
      ends_at: '2026-11-20T12:00:00Z',
      summary: 'Up to $5,000 · closes Nov 20',
      verified_at: '2026-11-03',
    }),
    'api',
    NOW,
  );
  await upsertProgram(
    programFixture({ id: 't-read-pool', title: 'Test Hackathon', reward: '$50,000 in prizes', pool_usd: 50_000, summary: '$50K in prizes', category: 'hackathon' }),
    'file',
    NOW,
  );
  await upsertProgram(programFixture({ id: 't-read-closed', status: 'closed' }), 'file', NOW);
  const all = await readListedPrograms(NOW);
  const api = all.find((p) => p.id === 't-read-api');
  assert.deepEqual(api, {
    id: 't-read-api',
    title: 'Test Grants',
    organizer: 'Read Org',
    category: 'grant',
    chains: ['solana'],
    any_chain: false,
    money: '$5K',
    status: 'active',
    closes_at: '2026-11-20T12:00:00.000Z',
    closes_in: 'in 16 days',
    source_url: 'https://example.com/grants',
    submission_url: 'https://example.com/apply',
    source: 'api',
    max_award_usd: 5000,
  });
  const pool = all.find((p) => p.id === 't-read-pool');
  assert.equal(pool?.money, '$50K in prizes');
  assert.equal(pool?.category, 'hackathon');
  assert.equal(pool?.closes_in, 'rolling');
  assert.ok(!all.some((p) => p.id === 't-read-closed'));
});
