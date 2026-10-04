import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MONOGRAM_PALETTE, monogramFor, proposeToken, tickerCandidates, tickerProblem, tokenNameProblem } from './token-proposal';

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

test('proposeToken: a brand name falls back to "<name> Token", else no proposal', async () => {
  const free = async () => true;
  const none = await proposeToken('Coinbase', free);
  assert.equal(none.name, null);
  assert.match((none as { reason: string }).reason, /pick a name/);
  const emoji = await proposeToken('🚀🚀', free);
  assert.equal(emoji.name, null);
});

test('monogram: deterministic letters and a palette colour', () => {
  assert.deepEqual(monogramFor(7, 'CKB'), monogramFor(7, 'CKB'));
  assert.equal(monogramFor(7, 'AGENTP').letters, 'AGE');
  assert.ok(MONOGRAM_PALETTE.includes(monogramFor(7, 'CKB').background));
  assert.equal(MONOGRAM_PALETTE.length, 12);
});
