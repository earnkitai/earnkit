import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANT_PUSH, NO_WALLET_HINT, SKIP_LINE, confirmDecision, confirmOffer, proofLineWaiting, yesLine } from './confirm';
import { COIN_FOOTNOTE } from './entry-text';

const W = '0xAb12' + '0'.repeat(32) + '0123';
const base = { hasBonus: true, coinIn: null, canPush: true, wallet: W, remembered: true };

test('v2.8 Part C: the offer is the spec four lines, the wallet short, then the consent footnote', () => {
  assert.equal(
    confirmOffer(base),
    [
      'Want the builder bonus? It comes with a token.',
      'Yes: your entry gets a token on Base. You earn 40% of its trading fees, plus a shot at the builder bonus.',
      'Skip: no token, no builder bonus.',
      'Wallet for fees and any bonus: 0xab12…0123 (used last time), or tell me another.',
      '',
      COIN_FOOTNOTE,
    ].join('\n'),
  );
  // A wallet given in this exchange is not "from last time".
  assert.match(confirmOffer({ ...base, remembered: false }), /\nWallet for fees and any bonus: 0xab12…0123, or tell me another\.\n/);
});

test('v2.8 Part C: no wallet known: the wallet line carries the no-wallet hint', () => {
  const lines = confirmOffer({ ...base, wallet: null, remembered: false }).split('\n\n')[0].split('\n');
  assert.equal(lines.at(-1), `Wallet for fees and any bonus: none yet. ${NO_WALLET_HINT}`);
  assert.equal(lines.at(-1), 'Wallet for fees and any bonus: none yet. No wallet? Make one at keys.coinbase.com, then send me the address.');
});

test('Ruling 5 (plan): a repo whose token is entered elsewhere: no offer, just where the bonus counts', () => {
  // v2.8.1 §C13: no bonus note in the offer; it is said once, in Also qualifies.
  assert.equal(confirmOffer({ ...base, coinIn: 'Arc Microgrants' }), 'Ready to submit?');
});

test("Ruling 7 (plan): an agent that can't push: one line, then Ready to submit?; no skip line", () => {
  const t = confirmOffer({ ...base, canPush: false });
  assert.equal(t, `${CANT_PUSH}\nReady to submit?`);
  assert.equal(CANT_PUSH, 'To launch your token, open this in Claude Code or Cursor.');
  assert.doesNotMatch(t, /Skip:/);
});

test('Ruling 31 (plan): the no-bonus variant', () => {
  const t = confirmOffer({ ...base, hasBonus: false, remembered: false });
  assert.equal(
    t,
    [
      'Want a token for your entry?',
      'Yes: your entry gets a token on Base. You earn 40% of its trading fees.',
      'Skip: no token.',
      'Wallet for fees: 0xab12…0123, or tell me another.',
      '',
      COIN_FOOTNOTE,
    ].join('\n'),
  );
  assert.ok(!t.includes(SKIP_LINE));
  assert.equal(confirmOffer({ ...base, tokensOff: true }), 'Ready to submit?');
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

test('v2.8.1 §A2: the Yes line names the ticker and the name, and is the only "40%" in the offer', () => {
  const tip = { name: 'TipJar', symbol: 'TIP' };
  assert.equal(yesLine(tip, true), 'Yes: launches $TIP (TipJar) on Base. You earn 40% of its trading fees, plus a shot at the builder bonus.');
  assert.equal(yesLine(tip, false), 'Yes: launches $TIP (TipJar) on Base. You earn 40% of its trading fees.');
  for (const hasBonus of [true, false]) {
    const t = confirmOffer({ ...base, hasBonus, proposal: tip });
    assert.ok(t.split('\n').includes(yesLine(tip, hasBonus)), t);
    assert.equal(t.match(/40%/g)?.length, 1, t);
  }
});

test('v2.8.1 §A3: a second proof-line miss names the branch, keeps the launch open, never another agent', () => {
  assert.equal(
    proofLineWaiting('main'),
    "Your entry is saved. Your token is waiting on a short proof line on your repo's main branch; say go once I've pushed it.",
  );
  assert.match(proofLineWaiting(null), /your repo's default branch;/);
  assert.doesNotMatch(proofLineWaiting('main'), /Claude Code|Cursor|Codex|—/);
});
