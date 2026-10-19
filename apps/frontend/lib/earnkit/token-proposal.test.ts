import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONOGRAM_PALETTE,
  cleanTokenName,
  initialsCandidates,
  monogramFor,
  nameCandidates,
  proposeToken,
  repoNameOf,
  type TickerCheck,
  tickerCandidates,
  tickerProblem,
  tokenNameProblem,
  tokensFunTickerCheck,
  unbranded,
} from './token-proposal';

test('ticker candidates (R11): the whole first word up to 10 letters, else initials, then numbered; never a cut word', () => {
  assert.equal(tickerCandidates('EarnKit')[0], 'EARNKIT', 'EarnKit gives $EARNKIT, never $EARNKI');
  assert.deepEqual(tickerCandidates('Chain Kits Bridge').slice(0, 3), ['CHAIN', 'CKB', 'CHAIN2']);
  assert.deepEqual(tickerCandidates('Agentpay').slice(0, 2), ['AGENTPAY', 'AGENTPAY2']);
  assert.equal(tickerCandidates('Agentpay').length, 9); // AGENTPAY + AGENTPAY2..AGENTPAY9
  // Task 4 (Task 3 review carry): a first word over 10 letters gives its first 10 letters, never 3-letter initials first.
  assert.deepEqual(tickerCandidates('Recipeplanner').slice(0, 2), ['RECIPEPLAN', 'RECIPEPLA2'], 'a first word over 10 letters: its first 10');
  assert.deepEqual(tickerCandidates('Supercalifragilistic Recipe Planner').slice(0, 2), ['SUPERCALIF', 'SRP'], 'over 10 letters: the first 10, then initials');
  assert.deepEqual(tickerCandidates('Recipeplan').slice(0, 2), ['RECIPEPLAN', 'RECIPEPLA2'], '10 letters is whole; its variants stay within 10');
  assert.deepEqual(tickerCandidates('Go Kit').slice(0, 1), ['GOKIT']); // first word too short: letters of the name
  assert.deepEqual(tickerCandidates('🚀🚀'), []);
  for (const c of tickerCandidates('My Super-Long Project Name 2')) assert.match(c, /^[A-Z0-9]{3,10}$/);
  assert.equal(tickerProblem('RECIPEPLAN'), null, '10 letters pass');
  assert.match(String(tickerProblem('RECIPEPLANS')), /3 to 10/, '11 do not (tokens.fun allows 10)');
});

test('R11: EarnKit is $EARNKIT in full: reserved as a brand, but refused whole, never shortened to a cut ticker', async () => {
  assert.match(String(tickerProblem('EARNKIT')), /brand/);
  const p = await proposeToken('Recipekit', async () => true);
  assert.deepEqual(p, { name: 'Recipekit', symbol: 'RECIPEKIT' });
});

test('Task 4 (fix round 1): EarnKit\'s brand only with a verified ownEarnkit; a link alone never; every other brand stays reserved', async () => {
  const own = { ownEarnkit: true };
  assert.equal(tickerProblem('EARNKIT', own), null);
  assert.equal(tokenNameProblem('EarnKit', own), null);
  assert.match(String(tickerProblem('BASE', own)), /brand/, 'another brand stays reserved for the owner too');
  assert.match(String(tickerProblem('EARNKIT', { ownEarnkit: false })), /brand/);
  assert.deepEqual(await proposeToken('EarnKit', async () => true, 'https://github.com/earnkitai/earnkit', own), { name: 'EarnKit', symbol: 'EARNKIT' });
  // The earnkitai link without the verified flag: never $EARNKIT.
  const link = await proposeToken('EarnKit', async () => true, 'https://github.com/earnkitai/earnkit');
  assert.notEqual(link.symbol, 'EARNKIT');
  assert.notEqual(link.name, 'EarnKit');
});

test('R11: a project name over the 50-character limit is never cut into a token name', async () => {
  const long = 'Recipe planner for busy families who cook every night';
  const p = await proposeToken(long, async () => true, 'https://github.com/a/recipes');
  assert.equal(p.name, 'Recipes', 'the repo name, not a cut project name');
  assert.ok(!nameCandidates(long, null).some((n) => n.endsWith(' Token') && !long.startsWith(n.slice(0, -6))), 'no cut "<name> Token"');
  assert.equal(nameCandidates(long, null).length, 1);
});

test('tickers: brand symbols and brand names are refused', () => {
  for (const s of ['BASE', 'USDC', 'ETH', 'WETH', 'MINI', 'EARN', 'CBBTC', 'COINBASE'])
    assert.ok(tickerProblem(s), s);
  assert.equal(tickerProblem('CKB'), null);
  assert.ok(tickerProblem('ab')); // too short
  assert.ok(tickerProblem('TOOLONGTICK')); // 11: over tokens.fun's 10
});

test('v2.7 §4 fix round 1 (Minor): CLANKER is refused with a generic reason, never echoing the word', () => {
  const problem = tickerProblem('CLANKER');
  assert.ok(problem);
  assert.doesNotMatch(problem!, /clanker/i);
  assert.equal(problem, 'symbol: that ticker is reserved; pick another.');
});

test('names: single-line text rules and brands', () => {
  assert.equal(tokenNameProblem('Chain Kits'), null);
  assert.ok(tokenNameProblem('Coinbase Pay'));
  assert.ok(tokenNameProblem('DM @acme'));
  assert.ok(tokenNameProblem('x'.repeat(51)));
});

test('names: a name that cleans to nothing is refused (fix round 1, item 3)', () => {
  // Math symbols aren't letters, digits, allowlisted punctuation, or pictographic; the allowlist
  // drops them all, leaving an empty name.
  assert.ok(tokenNameProblem('∀∑∂'));
});

test('names: the same impersonation rules as a sponsor name (fix round 1, item 4)', () => {
  // Cyrillic "а" (U+0430) mixed with Latin letters in one word.
  assert.ok(tokenNameProblem('Chаin Kits'));
});

test('proposeToken: skips taken tickers', async () => {
  const taken = new Set(['CKB']);
  const p = await proposeToken('Chain Kits Bridge', async (s) => !taken.has(s));
  assert.deepEqual(p, { name: 'Chain Kits Bridge', symbol: 'CHAIN' });
});

test('proposeToken: an unreachable ticker check still proposes, with a note', async () => {
  const p = await proposeToken('Chain Kits Bridge', async () => null);
  assert.equal(p.symbol, 'CHAIN');
  assert.match((p as { note: string }).note, /not checked for duplicates/);
});

test('proposeToken: when an earlier candidate is taken, a later unreachable check proposes that later candidate, not the first (fix round 1, item 1)', async () => {
  const p = await proposeToken('Chain Kits Bridge', async (s) => (s === 'CHAIN' ? false : s === 'CKB' ? null : true));
  assert.equal(p.symbol, 'CKB');
  assert.match((p as { note: string }).note, /not checked for duplicates/);
});

test('proposeToken: the proposed name is cleaned/normalized, not the raw input (fix round 1, item 2)', async () => {
  const free = async () => true;
  const p = await proposeToken('Chain   Kits’ Bridge', free);
  assert.equal((p as { name: string }).name, "Chain Kits' Bridge");
});

test('v2.7 Ruling 16 (plan): a brand name or an emoji-only name still gets a proposal', async () => {
  const free = async () => true;
  const brand = await proposeToken('Coinbase', free);
  assert.ok(brand.name && brand.symbol);
  assert.equal(tokenNameProblem(brand.name), null);
  assert.equal(tickerProblem(brand.symbol), null);
  const emoji = await proposeToken('🚀🚀', free);
  assert.deepEqual(emoji, { name: '🚀🚀', symbol: 'ENTRY' });
});

test('tokensFunTickerCheck: no key means no fetch, returns null (fix round 1, item 5)', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOKENSFUN_DEPLOY_API_KEY;
  delete process.env.TOKENSFUN_DEPLOY_API_KEY;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error('fetch should not be called without a key');
  }) as typeof fetch;
  try {
    const result = await tokensFunTickerCheck('ABC');
    assert.equal(result, null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = originalKey;
  }
});

test('tokensFunTickerCheck: a non-OK response returns null', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOKENSFUN_DEPLOY_API_KEY;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
  try {
    assert.equal(await tokensFunTickerCheck('ABC'), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = originalKey;
  }
});

test('tokensFunTickerCheck: malformed JSON returns null', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOKENSFUN_DEPLOY_API_KEY;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  globalThis.fetch = (async () =>
    new Response('not json', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    assert.equal(await tokensFunTickerCheck('ABC'), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = originalKey;
  }
});

test('tokensFunTickerCheck: a throwing fetch returns null, and the key never appears in the result', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const key = 'super-secret-deploy-key';
  process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  globalThis.fetch = (async () => {
    throw new Error(`network down (key=${key})`);
  }) as typeof fetch;
  try {
    const result = await tokensFunTickerCheck('ABC');
    assert.equal(result, null);
    assert.ok(!JSON.stringify(result ?? null).includes(key));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = originalKey;
  }
});

test('tokensFunTickerCheck: { available: false } returns false, and the key never appears in the result', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const key = 'another-secret-deploy-key';
  process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  let sawAuthHeader = '';
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sawAuthHeader = (init?.headers as Record<string, string>)?.Authorization ?? '';
    return new Response(JSON.stringify({ available: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const result = await tokensFunTickerCheck('ABC');
    assert.equal(result, false);
    assert.ok(!JSON.stringify(result).includes(key));
    assert.match(sawAuthHeader, new RegExp(key)); // the key is sent to tokens.fun, just never returned
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = originalKey;
  }
});

test('monogram: deterministic letters and a palette colour', () => {
  assert.deepEqual(monogramFor(7, 'CKB'), monogramFor(7, 'CKB'));
  assert.equal(monogramFor(7, 'AGENTP').letters, 'AGE');
  assert.ok(MONOGRAM_PALETTE.includes(monogramFor(7, 'CKB').background));
  assert.equal(MONOGRAM_PALETTE.length, 12);
});

const free: TickerCheck = async () => true;
test('Ruling 16 (plan): a name and ticker are always proposed', async () => {
  for (const [name, repo] of [['Base Pay', undefined], ['支付应用', 'https://github.com/a/zhifu-app'], ['支付应用', undefined], ['Go', undefined]] as const) {
    const p = await proposeToken(name, free, repo);
    assert.ok(p.name && p.symbol, name);
    assert.equal(tickerProblem(p.symbol), null, name);
    assert.ok('name' in cleanTokenName(p.name), name);
  }
  assert.equal((await proposeToken('支付应用', free, 'https://github.com/a/zhifu-app')).symbol, 'ZHIFU');
  assert.equal((await proposeToken('支付应用', free)).symbol, 'ENTRY');
  assert.equal((await proposeToken('Go', free)).symbol, 'GOX');
});

test('Ruling 16 (plan): at most 12 checks; then an unchecked candidate with a note', async () => {
  let calls = 0;
  const taken: TickerCheck = async () => { calls++; return false; };
  const p = await proposeToken('TipJar', taken, 'https://github.com/a/tipjar');
  assert.equal(calls, 12);
  assert.ok(p.symbol);
  assert.equal(p.note, 'ticker not checked for duplicates');
});

test('repoNameOf and initialsCandidates', () => {
  assert.equal(repoNameOf('https://github.com/acme/tip-jar.git'), 'tip jar');
  assert.equal(repoNameOf('https://gitlab.com/a/b'), null);
  assert.deepEqual(initialsCandidates('My Tip Jar').slice(0, 2), ['MTJ', 'MTJ2']);
});

test('Ruling 16 (plan): the name falls back to the repo name before "<TICKER> Token"', async () => {
  const p = await proposeToken('支付应用', free, 'https://github.com/a/zhifu-app');
  assert.deepEqual(p, { name: '支付应用', symbol: 'ZHIFU' });
  const brand = await proposeToken('Base Pay', free, 'https://github.com/a/tip-jar');
  assert.equal(brand.name, 'Tip Jar', 'the repo name, title-cased (fix round 1, Minor 3)');
});

test('C6: a ticker found taken is never proposed, even when every checked one is taken', async () => {
  const checked = new Set<string>();
  const taken: TickerCheck = async (sym) => { checked.add(sym); return false; };
  for (const [name, repo] of [['支付应用', undefined], ['Go', undefined], ['TipJar', 'https://github.com/a/tipjar'], ['🚀🚀', undefined]] as const) {
    checked.clear();
    const p = await proposeToken(name, taken, repo);
    assert.ok(!checked.has(p.symbol), `${name}: ${p.symbol} was checked and taken`);
    assert.equal(tickerProblem(p.symbol), null);
    assert.equal(p.note, 'ticker not checked for duplicates');
  }
});

test('C6: every group\'s unnumbered ticker is checked before any numbered variant', async () => {
  const seen: string[] = [];
  await proposeToken('TipJar', async (sym) => { seen.push(sym); return false; }, 'https://github.com/a/tip-jar');
  assert.deepEqual(seen.slice(0, 3), ['TIPJAR', 'TIP', 'ENTRY']);
  const free = await proposeToken('Chain Kits Bridge', async (sym) => sym !== 'CHAIN');
  assert.equal(free.symbol, 'CKB');
});

test('v2.8.1 §A2: a brand in the project name falls back to its readable words, and the ticker follows ("ArcPay" is $PAY (Pay Token), never $ARCPA2)', async () => {
  const free = async () => true;
  assert.deepEqual(await proposeToken('ArcPay', free, 'https://github.com/alice/arcpay'), { name: 'Pay Token', symbol: 'PAY' });
  assert.deepEqual(await proposeToken('Base Builder Grants Bot', free), { name: 'Builder Grants Bot', symbol: 'BUILDER' });
  // A readable project name is kept as is.
  assert.deepEqual(await proposeToken('TipJar', free), { name: 'TipJar', symbol: 'TIPJAR' });
  assert.equal(unbranded('ArcPay'), 'Pay');
  assert.equal(unbranded('Arc Pay'), 'Pay');
  assert.equal(unbranded('TipJar'), null, 'no brand word: nothing to drop');
  assert.equal(unbranded('Base'), null, 'every word a brand: nothing left');
  assert.deepEqual(nameCandidates('ArcPay', 'arcpay'), ['ArcPay', 'ArcPay Token', 'Arcpay', 'Pay Token']);
  // "<TICKER> Token" only when no readable name exists.
  assert.match((await proposeToken('Base', free)).name, /^[A-Z0-9]{3,10} Token$/);
});

test('v2.8.1 §A5: ticker checks run in parallel batches; the first free candidate in order wins', async () => {
  let inFlight = 0;
  let most = 0;
  const seen: string[] = [];
  const check = async (s: string) => {
    seen.push(s);
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return !['TIPJAR', 'TIP'].includes(s);
  };
  const p = await proposeToken('TipJar', check);
  assert.equal(p.symbol, seen.find((s) => !['TIPJAR', 'TIP'].includes(s)));
  assert.ok(most > 1 && most <= 4, `at most 4 at once (saw ${most})`);
  assert.ok(seen.length <= 12);
});
