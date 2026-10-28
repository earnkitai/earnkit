import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitGate, type FitRepo, type NewProgram } from './alerts';
import { checkFitsAsk, setupDoneReply } from './bench-reply';
import { eligibilityLine } from './tools';

/** v4.2 Task 10: fixes found by re-running the simulated builder journeys (pure parts). */
const rows = [{ program: 'Base Builder Grant Program', upTo: '$5,000', closes: 'Rolling' }];

test('G1: fits not known yet: the fit-check question; known and none: the table alone, no question', () => {
  const asked = setupDoneReply('Dev', 'skipped', rows, 'x', { check: 'VaultPilot' });
  assert.ok(asked.endsWith('Want me to check which of these fits VaultPilot?'), asked);
  assert.equal(checkFitsAsk('Kit'), 'Want me to check which of these fits Kit?');
  const none = setupDoneReply('Dev', 'skipped', rows, 'x', { noAsk: true });
  assert.ok(none.endsWith('| Base Builder Grant Program | $5,000 | Rolling |'), none);
  assert.doesNotMatch(none, /\?|closest/);
});

test('G1: a told "has users" on a verified live link overrides a stored "no users yet"; without it the repo stays low', () => {
  const program = { id: 'p', title: 'P', chains: ['base'], any_chain: true, investment: false, min_product_score: 0, existing_work: 'allowed', tag: null, starts_at: null } as unknown as NewProgram;
  const repo = {
    key: 'a/b', name: 'b', url: 'https://github.com/a/b', homepage: null, created_at: '2026-01-01T00:00:00Z', live_verified: true, tx_count: null,
    chains: { base: { mainnet: true, testnet: false, evidence: 'deployed', basis: 'deployed' } },
    product: { odds: 'low', tier: 'product', score: 5, missing: [], traction: 3, low_reason: 'no users yet' },
    said: null,
  } as unknown as FitRepo;
  assert.equal(fitGate(program, repo, { apply: true }), 'odds');
  const told = { ...repo, said: { mainnet: [], testnet: [], live_url: null, has_users: true, not_mine: false } } as FitRepo;
  assert.notEqual(fitGate(program, told, { apply: true }), 'odds');
});

test('G3: a told users claim reads "confirm users", not "needs real users"', () => {
  assert.equal(eligibilityLine('a/b', { status: 'after_step', missing: [], effort: null, note: 'confirm: users.' }), 'a/b fits after one step: confirm users.');
});
