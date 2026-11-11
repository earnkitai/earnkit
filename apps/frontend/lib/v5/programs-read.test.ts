import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { moneyOf, programsListGet, readListedPrograms, type ListedProgram } from './programs-read';

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
  submit: 'either',
  sign_in: 'none',
  platform_name: null,
  needs: [],
  min_tier: null,
  prefers: [],
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
    'any_chain', 'category', 'chains', 'closes_at', 'closes_in', 'id', 'min_tier', 'money', 'needs', 'organizer', 'platform_name', 'prefers', 'sign_in', 'source', 'source_url', 'status',
    'submission_url', 'submit', 'title',
  ]);
  assert.equal(soon.closes_in, 'in 36 hours');
  assert.equal(body.programs.find((p) => p.id === 'g-rolling-big')!.closes_in, 'rolling');
  assert.equal(body.programs.find((p) => p.id === 'u-up')!.closes_in, null);
});

test('filters: category and status; a bad value is 400', async () => {
  assert.deepEqual((await get('?category=hackathon', ROWS)).body.programs.map((p) => p.id), ['h-soon']);
  assert.deepEqual((await get('?status=upcoming', ROWS)).body.programs.map((p) => p.id), ['u-up']);
  // "open" is the site's word for active (v6.1.7 S2).
  const open = await get('?status=open', ROWS);
  assert.equal(open.status, 200);
  assert.deepEqual(open.body.programs.map((p) => p.id), (await get('?status=active', ROWS)).body.programs.map((p) => p.id));
  assert.ok(open.body.programs.length > 0 && open.body.programs.every((p) => p.status === 'active'));
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
    money: 'Up to $5K',
    status: 'active',
    closes_at: '2026-11-20T12:00:00.000Z',
    closes_in: 'in 16 days',
    source_url: 'https://example.com/grants',
    submission_url: 'https://example.com/apply',
    source: 'api',
    submit: 'either',
    sign_in: 'none',
    platform_name: null,
    needs: [],
    min_tier: null,
    prefers: [],
    max_award_usd: 5000,
  });
  const pool = all.find((p) => p.id === 't-read-pool');
  assert.equal(pool?.money, '$50K in prizes');
  assert.equal(pool?.category, 'hackathon');
  assert.equal(pool?.closes_in, 'rolling');
  assert.ok(!all.some((p) => p.id === 't-read-closed'));
});

test('readListedPrograms carries the catalog fields and never reviewers_contact', async () => {
  await upsertProgram(
    programFixture({
      id: 't-read-cat', sign_in: 'platform', platform_name: 'Hub', needs: ['deck'], min_tier: 'used', prefers: ['viem'],
      submit: 'builder', reviewers_contact: 'reviewer@example.com',
    }),
    'file',
    NOW,
  );
  const p = (await readListedPrograms(NOW)).find((x) => x.id === 't-read-cat')!;
  assert.deepEqual([p.submit, p.sign_in, p.platform_name, p.needs, p.min_tier, p.prefers], ['builder', 'platform', 'Hub', ['deck'], 'used', ['viem']]);
  assert.ok(!JSON.stringify(p).includes('reviewers_contact') && !JSON.stringify(p).includes('reviewer@example.com'));
  const res = await programsListGet(new Request('https://earnkit.com/api/programs'), async () => [p], NOW);
  assert.ok(!(await res.text()).includes('reviewers_contact'));
});

test('moneyOf: the pool first, then the per-winner award, then the summary (v6.1.6, one amount per program)', () => {
  const base = { title: 'Meta Horizon VR Competition', summary: '$100K top prize · $1M in prizes', investment: false };
  assert.equal(moneyOf({ ...base, max_award_usd: 100_000, pool_usd: 1_000_000 }), '$1M in prizes');
  assert.equal(moneyOf({ ...base, title: 'Arc Builder Grants', max_award_usd: 25_000, pool_usd: 250_000 }), '$250K in grants');
  assert.equal(moneyOf({ ...base, max_award_usd: 100_000, pool_usd: undefined }), '$100K');
  assert.equal(moneyOf({ title: 'Fund', summary: '$500K · rolling', investment: true, max_award_usd: 0, pool_usd: undefined }), '$500K investment');
});

test('moneyOf (v6.1.14): a range reads Up to its top; a threshold is never money', () => {
  // A low end in the file, or a summary that says "up to": the top is not the award.
  assert.equal(moneyOf({ title: 'OTF Internet Freedom Fund', summary: '$10,000 to $900,000 · rolling', investment: false, max_award_usd: 900_000, min_award_usd: 10_000 }), 'Up to $900K');
  assert.equal(moneyOf({ title: 'Antler US Residency', summary: '$500K to $1M investment · rolling', investment: true, max_award_usd: 1_000_000, min_award_usd: 500_000 }), 'Up to $1M');
  assert.equal(moneyOf({ title: 'Base Builder Grants', summary: 'up to $5,000 · rolling', investment: false, max_award_usd: 5000 }), 'Up to $5K');
  // One amount is the award.
  assert.equal(moneyOf({ title: 'Thiel Fellowship', summary: '$250,000 over two years · rolling', investment: false, max_award_usd: 250_000 }), '$250K');
  // The Arbitrum Stablecoin tile: the award, never the TVL the builder must reach.
  assert.equal(moneyOf({ title: 'Arbitrum Stablecoin Growth Program', summary: 'incentives + 200K ARB at $10M USDG TVL · no deadline stated', investment: false }), 'incentives + 200K ARB');
});
