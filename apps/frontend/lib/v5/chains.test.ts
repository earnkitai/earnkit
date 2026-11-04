import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN_REGISTRY, chainName, chainOfId, isKnownChain } from './chains';

test('chainOfId: 8453 is base mainnet, 84532 base testnet, unknown is null', () => {
  assert.deepEqual(chainOfId(8453), { chain: 'base', mainnet: true });
  assert.deepEqual(chainOfId(84532), { chain: 'base', mainnet: false });
  assert.equal(chainOfId(999_999_999), null);
});

test('isKnownChain: registered slugs only, solana included', () => {
  assert.equal(isKnownChain('solana'), true);
  assert.equal(isKnownChain('base'), true);
  assert.equal(isKnownChain('foo'), false);
  assert.equal(isKnownChain('toString'), false);
});

test('chainName: the display name, or the slug when unknown', () => {
  assert.equal(chainName('robinhood'), 'Robinhood Chain');
  assert.equal(chainName('foo'), 'foo');
});

test('the registry: the seven v4 chains plus four, solana not EVM', () => {
  for (const c of ['base', 'arc', 'tempo', 'monad', 'robinhood', 'avalanche', 'arbitrum', 'ethereum', 'optimism', 'polygon', 'solana'])
    assert.ok(isKnownChain(c), c);
  assert.equal(CHAIN_REGISTRY.solana.evm, false);
  assert.deepEqual(CHAIN_REGISTRY.solana.mainnet.ids, []);
  assert.equal(CHAIN_REGISTRY.base.evm, true);
});
