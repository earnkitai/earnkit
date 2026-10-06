import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONOGRAM_PALETTE,
  cleanTokenName,
  initialsCandidates,
  monogramFor,
  proposeToken,
  repoNameOf,
  type TickerCheck,
  tickerCandidates,
  tickerProblem,
  tokenNameProblem,
  tokensFunTickerCheck,
} from './token-proposal';

test('ticker candidates: initials for 3+ words, then the first word, then numbered', () => {
  assert.deepEqual(tickerCandidates('Chain Kits Bridge').slice(0, 3), ['CKB', 'CHAIN', 'CHAIN2']);
  assert.deepEqual(tickerCandidates('Agentpay').slice(0, 2), ['AGENTP', 'AGENT2']);
  assert.equal(tickerCandidates('Agentpay').length, 9); // AGENTP + AGENT2..AGENT9
  assert.deepEqual(tickerCandidates('Go Kit').slice(0, 1), ['GOKIT']); // first word too short: letters of the name
  assert.deepEqual(tickerCandidates('🚀🚀'), []);
  for (const c of tickerCandidates('My Super-Long Project Name 2')) assert.match(c, /^[A-Z0-9]{3,6}$/);
});

test('tickers: brand symbols and brand names are refused', () => {
  for (const s of ['BASE', 'USDC', 'ETH', 'WETH', 'MINI', 'EARN', 'CBBTC', 'COINBASE'])
    assert.ok(tickerProblem(s), s);
  assert.equal(tickerProblem('CKB'), null);
  assert.ok(tickerProblem('ab')); // too short
  assert.ok(tickerProblem('TOOLONG7'));
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
  assert.equal(p.symbol, 'CKB');
  assert.match((p as { note: string }).note, /not checked for duplicates/);
});

test('proposeToken: when an earlier candidate is taken, a later unreachable check proposes that later candidate, not the first (fix round 1, item 1)', async () => {
  const p = await proposeToken('Chain Kits Bridge', async (s) => (s === 'CKB' ? false : s === 'CHAIN' ? null : true));
  assert.equal(p.symbol, 'CHAIN');
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
  const free = await proposeToken('Chain Kits Bridge', async (sym) => sym !== 'CKB');
  assert.equal(free.symbol, 'CHAIN');
});
