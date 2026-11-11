import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { amountsText, lowerFirst, moneyAt, moneyOf, moneyText, totalText, upperFirst, programsListGet, usdFull, readListedPrograms, revalidateCatalog, watchCatalogRevalidation, type ListedProgram } from './programs-read';

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
    programFixture({ id: 't-read-pool', title: 'Test Hackathon', reward: '$50,000 in prizes', pool_usd: 50_000, summary: '$50,000 in prizes', category: 'hackathon' }),
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
    money: 'Up to $5,000',
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
  assert.equal(pool?.money, '$50,000 in prizes');
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

test('moneyOf (fix round 2, v6.1.15): the summary\'s money phrase whenever it has a figure; else the pool, then the award', () => {
  const base = { title: 'Meta Horizon VR Competition', summary: 'Prizes for VR apps · rolling', investment: false };
  assert.equal(moneyOf({ ...base, max_award_usd: 100_000, pool_usd: 1_000_000 }), '$1,000,000 in prizes');
  assert.equal(moneyOf({ ...base, title: 'Arc Builder Grants', max_award_usd: 25_000, pool_usd: 250_000 }), '$250,000 in grants');
  assert.equal(moneyOf({ ...base, max_award_usd: 100_000, pool_usd: undefined }), '$100,000');
  assert.equal(moneyOf({ ...base, max_award_usd: 900_000, min_award_usd: 10_000 }), '$10,000 to $900,000');
  // The phrase wins over the figures, so no word of it is lost.
  assert.equal(moneyOf({ ...base, summary: '$1,000,000 in prizes · Dec 1', max_award_usd: 100_000, pool_usd: 1_000_000 }), '$1,000,000 in prizes');
  assert.equal(moneyOf({ title: 'PayPal AI Hackathon', summary: '$67,500 in prizes · Dec 1', investment: false, pool_usd: 67_500 }), '$67,500 in prizes');
  assert.equal(moneyOf({ title: 'Lido', summary: 'Up to $100,000 by tier, more by DAO vote · no deadline stated', investment: false, max_award_usd: 100_000 }), 'Up to $100,000 by tier, more by DAO vote');
  assert.equal(moneyOf({ title: 'Thiel Fellowship', summary: '$250,000 over two years · rolling', investment: false, max_award_usd: 250_000 }), '$250,000 over two years');
  assert.equal(moneyOf({ title: 'Alliance', summary: '$400,000 at admission · Nov 18', investment: true, max_award_usd: 400_000 }), '$400,000 at admission');
  assert.equal(moneyOf({ title: 'Y Combinator', summary: '$500,000 investment · rolling', investment: true, max_award_usd: 500_000 }), '$500,000 investment');
  // An investment's bare figure names the kind.
  assert.equal(moneyOf({ title: 'Fund', summary: '$500,000 · rolling', investment: true, max_award_usd: 0, pool_usd: undefined }), '$500,000 investment');
  assert.equal(moneyOf({ title: 'Base Builder Grants', summary: 'up to $5,000 · rolling', investment: false, max_award_usd: 5000 }), 'Up to $5,000');
  assert.equal(moneyOf({ title: 'OTF Internet Freedom Fund', summary: '$10,000 to $900,000 · rolling', investment: false, max_award_usd: 900_000, min_award_usd: 10_000 }), '$10,000 to $900,000');
  // The Arbitrum Stablecoin tile: the award, never the TVL the builder must reach, with a capital (#12).
  assert.equal(moneyOf({ title: 'Arbitrum Stablecoin Growth Program', summary: 'incentives + 200,000 ARB at $10M USDG TVL · no deadline stated', investment: false }), 'Incentives + 200,000 ARB');
  assert.equal(moneyOf({ title: 'Sovereign Tech Fund', summary: 'funds work from EUR 50,000 · rolling', investment: false }), 'Funds work from EUR 50,000');
});

test('moneyAt (v6.1.15, #12, L1g-4): a capital on a tile, lowercase mid-sentence; EUR, USDC, $, NYC and DeFi stay', () => {
  assert.equal(moneyAt('funds work from EUR 50,000', 'tile'), 'Funds work from EUR 50,000');
  assert.equal(moneyAt('Funds work from EUR 50,000', 'mid'), 'funds work from EUR 50,000');
  for (const [tile, mid] of [
    ['Up to $100,000 by tier, more by DAO vote', 'up to $100,000 by tier, more by DAO vote'],
    ['Amount not stated, set by milestone budget', 'amount not stated, set by milestone budget'],
    ['Incentives, plus 200K ARB for the first 10 teams', 'incentives, plus 200K ARB for the first 10 teams'],
    ['Milestone grants, amount not stated', 'milestone grants, amount not stated'],
    ['Pre-seed and seed investment, amount not stated', 'pre-seed and seed investment, amount not stated'],
    ['From EUR 5,000', 'from EUR 5,000'],
    ['EUR 5,000 to 50,000', 'EUR 5,000 to 50,000'],
    ['USDC 500 × 8 grants', 'USDC 500 × 8 grants'],
    ['$1M investment', '$1M investment'],
    ['NYC incubator with relocation stipend, amount not stated', 'NYC incubator with relocation stipend, amount not stated'],
    ['DeFi grants, amount not stated', 'DeFi grants, amount not stated'],
  ]) {
    assert.equal(moneyAt(mid, 'tile'), tile);
    assert.equal(moneyAt(tile, 'mid'), mid);
  }
});

test('usdFull (v6.1.15, lane 22): whole dollars with en-US grouping, never K or M', () => {
  assert.equal(usdFull(10_000), '$10,000');
  assert.equal(usdFull(67_500), '$67,500');
  assert.equal(usdFull(750), '$750');
  assert.equal(usdFull(1_000_000), '$1,000,000');
});

test('fix round 1 (v6.1.15, M1): one lower-casing rule; a chain name, "I" and a word with a capital second letter never change', () => {
  assert.equal(moneyAt('Ethereum grants', 'mid'), 'Ethereum grants');
  assert.equal(moneyAt('Solana Mobile grants', 'mid'), 'Solana Mobile grants');
  assert.equal(moneyAt('I fund work', 'mid'), 'I fund work');
  assert.equal(moneyAt('iOS app grants', 'tile'), 'iOS app grants');
  assert.equal(moneyAt('iOS app grants', 'mid'), 'iOS app grants');
  assert.equal(moneyAt('DeFi grants', 'tile'), 'DeFi grants');
  assert.equal(moneyAt('DeFi grants', 'mid'), 'DeFi grants');
  assert.equal(upperFirst('up to $5,000'), 'Up to $5,000');
  assert.equal(lowerFirst('Uniswap v4 hooks'), 'uniswap v4 hooks');
  assert.equal(lowerFirst('Uniswap v4 hooks', ['Uniswap']), 'Uniswap v4 hooks');
  assert.equal(lowerFirst('Ethereum liquid staking'), 'Ethereum liquid staking');
});

test('moneyText, totalText (L22-1, L22-14 v6.1.16): one format; cents only when given; another code first, never converted', () => {
  assert.equal(moneyText(5000), '$5,000');
  assert.equal(moneyText(2500.5), '$2,500.50');
  assert.equal(moneyText(2000, 'EUR'), 'EUR 2,000');
  assert.equal(moneyText(115_000, 'usdc'), 'USDC 115,000');
  assert.equal(usdFull(1234.56), moneyText(1234.56));
  assert.equal(totalText({ usd: 3500.5, other: [{ currency: 'EUR', amount: 2000 }], noAmount: 0 }), '$3,500.50 and EUR 2,000');
  assert.equal(totalText({ usd: 5000, other: [], noAmount: 1 }), '$5,000, one amount not given');
  assert.equal(totalText({ usd: 3500.5, other: [{ currency: 'GBP', amount: 10 }, { currency: 'EUR', amount: 2000 }], noAmount: 2 }), '$3,500.50 and EUR 2,000 and GBP 10, 2 amounts not given');
  assert.equal(totalText({ usd: 0, other: [], noAmount: 1 }), 'amount not given');
  assert.equal(totalText({ usd: 0, other: [], noAmount: 0 }), '');
  assert.equal(amountsText({ USD: 1000, EUR: 500 }), '$1,000 and EUR 500');
});

test('L22-13 (v6.1.16): revalidateCatalog runs on every catalog write, outside Next too', () => {
  let n = 0;
  watchCatalogRevalidation(() => n++);
  try {
    revalidateCatalog();
    assert.equal(n, 1);
  } finally {
    watchCatalogRevalidation(null);
  }
});
