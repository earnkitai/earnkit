import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONOGRAM_PALETTE,
  monogramFor,
  proposeToken,
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

test('proposeToken: a brand name falls back to "<name> Token", else no proposal', async () => {
  const free = async () => true;
  const none = await proposeToken('Coinbase', free);
  assert.equal(none.name, null);
  assert.match((none as { reason: string }).reason, /pick a name/);
  const emoji = await proposeToken('🚀🚀', free);
  assert.equal(emoji.name, null);
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
