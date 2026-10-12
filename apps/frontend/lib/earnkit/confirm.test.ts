import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANT_PUSH, READY_TO_SUBMIT, SKIP_TOKEN, TOKEN_PITCH_MIN_SCORE, confirmDecision, confirmLine, confirmOffer, proofLineWaiting, signInLine } from './confirm';

const W = '0x12Ab' + '0'.repeat(32) + '9F3E';
const TIP = { name: 'Tip Jar', symbol: 'TIP' };
const base = { hasBonus: true, coinIn: null, canPush: true, wallet: W, proposal: TIP };

test('7.4 v2.10 item 5: the offer is the one confirm line, the wallet short', () => {
  assert.equal(
    confirmOffer(base),
    'Yes submits your entry and launches $TIP (Tip Jar): 40% of its fees to you, plus the builder bonus. Wallet: 0x12ab…9f3e. yes / skip the token',
  );
  assert.equal(
    confirmOffer({ ...base, hasBonus: false }),
    'Yes submits your entry and launches $TIP (Tip Jar): 40% of its fees to you. Wallet: 0x12ab…9f3e. yes / skip the token',
  );
  assert.equal(
    confirmOffer({ ...base, wallet: null }),
    'Yes submits your entry and launches $TIP (Tip Jar): 40% of its fees to you, plus the builder bonus. Say yes with your wallet address / skip the token',
  );
  assert.equal(
    confirmOffer({ ...base, wallet: null, proposal: { name: 'Tip Jar', symbol: 'NEW' }, again: true }),
    'Yes submits your entry and launches $NEW (Tip Jar). Say yes with your wallet address / skip the token',
  );
  assert.equal(
    confirmLine({ proposal: { name: 'Tip Jar', symbol: 'NEW' }, hasBonus: true, wallet: null, walletKnown: true, again: true }),
    'Yes submits your entry and launches $NEW (Tip Jar). yes / skip the token',
  );
  assert.equal(SKIP_TOKEN, 'skip the token');
  // No proposal yet: "your token".
  assert.match(confirmOffer({ ...base, proposal: null }), /^Yes submits your entry and launches your token: 40%/);
});

test('7.5 v2.10 item 5: one line, no fine print; a token elsewhere or tokens off: Ready to submit?', () => {
  for (const o of [base, { ...base, hasBonus: false }, { ...base, wallet: null }, { ...base, again: true }, { ...base, signIn: true, canPush: false }]) {
    const t = confirmOffer(o);
    assert.ok(!t.includes('\n'), t);
    assert.doesNotMatch(t, /WETH|gas|tokens\.fun|Terms|Risks/, t);
    assert.ok((t.match(/40%/g)?.length ?? 0) <= 1, t);
    // "skip" only as "skip the token".
    assert.equal(t.match(/skip/g)?.length, 1, t);
    assert.ok(t.endsWith('/ skip the token'), t);
  }
  assert.equal(confirmOffer({ ...base, coinIn: 'Arc Microgrants' }), 'Ready to submit?');
  assert.equal(confirmOffer({ ...base, tokensOff: true }), 'Ready to submit?');
});

test("Ruling 7 (plan): an agent that can't push: one line, then Ready to submit?; no skip", () => {
  const t = confirmOffer({ ...base, canPush: false });
  assert.equal(t, `${CANT_PUSH}\nReady to submit?`);
  assert.equal(CANT_PUSH, 'To launch your token, open this in Claude Code or Cursor.');
  assert.doesNotMatch(t, /skip/);
});

test('Ruling 4 (plan): confirmDecision', () => {
  const ok = { confirmed: true, decision: 'go' as const, coinIn: null, canPush: true, hasRepo: true, policyOff: false, available: true };
  assert.deepEqual(confirmDecision({ ...ok, confirmed: false }), { kind: 'offer' });
  assert.deepEqual(confirmDecision({ ...ok, decision: undefined }), { kind: 'offer' });
  assert.deepEqual(confirmDecision({ ...ok, decision: 'skip' }), { kind: 'skip' });
  // skip wins over every lasting reason.
  assert.deepEqual(confirmDecision({ ...ok, decision: 'skip', canPush: false, coinIn: 'Arc Microgrants' }), { kind: 'skip' });
  assert.deepEqual(confirmDecision({ ...ok, coinIn: 'Arc Microgrants' }), { kind: 'record_only', note: '' });
  assert.deepEqual(confirmDecision({ ...ok, canPush: false }), { kind: 'record_only', note: CANT_PUSH });
  assert.deepEqual(confirmDecision({ ...ok, hasRepo: false }), { kind: 'record_only', note: 'Your token needs a public repo.' });
  assert.equal(confirmDecision({ ...ok, policyOff: true }).kind, 'record_only');
  assert.equal(confirmDecision({ ...ok, available: false }).kind, 'record_only');
  assert.deepEqual(confirmDecision(ok), { kind: 'launch' });
});

test('v2.8.1 §A3: a second proof-line miss names the branch, keeps the launch open, never another agent', () => {
  assert.equal(
    proofLineWaiting('main'),
    "Your entry is saved. Your token is waiting on a short proof line on your repo's main branch; say go once I've pushed it.",
  );
  assert.match(proofLineWaiting(null), /your repo's default branch;/);
  assert.doesNotMatch(proofLineWaiting('main'), /Claude Code|Cursor|Codex|—/);
});

test('5.9 v2.9 B9: with sign-in on, an agent that can\'t push gets sign_in (never record_only) and the normal offer (P9)', () => {
  const base = { confirmed: true, decision: 'go' as const, coinIn: null, canPush: false, hasRepo: true, policyOff: false, available: true };
  assert.deepEqual(confirmDecision({ ...base, signIn: true }), { kind: 'sign_in' });
  assert.deepEqual(confirmDecision({ ...base, signIn: false }), { kind: 'record_only', note: CANT_PUSH });
  assert.deepEqual(confirmDecision(base), { kind: 'record_only', note: CANT_PUSH });
  assert.deepEqual(confirmDecision({ ...base, canPush: true, signIn: true }), { kind: 'launch' });
  // The lasting reasons still come first.
  assert.equal(confirmDecision({ ...base, signIn: true, hasRepo: false }).kind, 'record_only');
  assert.equal(confirmDecision({ ...base, signIn: true, available: false }).kind, 'record_only');
  assert.deepEqual(confirmDecision({ ...base, signIn: true, coinIn: 'Arc' }), { kind: 'record_only', note: '' });
  assert.equal(
    signInLine('TipJar', 'TIP', 'https://earnkit.com/github/verify?n=x'),
    'One click to prove TipJar is yours, then $TIP launches: https://earnkit.com/github/verify?n=x',
  );
  const offer = { hasBonus: true, coinIn: null, canPush: false, wallet: null, proposal: { name: 'TipJar', symbol: 'TIP' } };
  assert.equal(confirmOffer(offer), `${CANT_PUSH}\nReady to submit?`, 'off: as before');
  const on = confirmOffer({ ...offer, signIn: true });
  assert.doesNotMatch(on, /Claude Code|Cursor/);
  assert.match(on, /^Yes submits your entry and launches \$TIP \(TipJar\): 40% of its fees to you, plus the builder bonus\./);
});

test('9.3 below TOKEN_PITCH_MIN_SCORE the confirm line never mentions a token, and a yes records only', () => {
  assert.equal(TOKEN_PITCH_MIN_SCORE, 20);
  const offer = { hasBonus: true, coinIn: null, canPush: true, wallet: '0x' + '1'.repeat(40), proposal: { name: 'Tip Jar', symbol: 'TIP' } };
  assert.equal(confirmOffer({ ...offer, belowScore: true }), READY_TO_SUBMIT);
  assert.equal(confirmOffer({ ...offer, canPush: false, belowScore: true }), READY_TO_SUBMIT, 'no "open this in Claude Code" token line either');
  assert.match(confirmOffer(offer), /launches \$TIP/);
  assert.deepEqual(confirmDecision({ confirmed: true, decision: 'go', coinIn: null, canPush: true, hasRepo: true, policyOff: false, available: true, belowScore: true }), { kind: 'record_only', note: '' });
  assert.deepEqual(confirmDecision({ confirmed: true, decision: 'skip', coinIn: null, canPush: true, hasRepo: true, policyOff: false, available: true, belowScore: true }), { kind: 'skip' });
  assert.deepEqual(confirmDecision({ confirmed: true, decision: 'go', coinIn: null, canPush: true, hasRepo: true, policyOff: false, available: true }), { kind: 'launch' });
});
