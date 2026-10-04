import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertLines, sinceLine, type AlertFacts } from './alerts';

const empty: AlertFacts = { newCampaigns: [], standings: [], prizes: [], fees: null };
const t = (h: number) => new Date(Date.UTC(2026, 9, 10, h));

test('a prize paid since the last check, with its amount and transaction link; not again', () => {
  const f: AlertFacts = { ...empty, prizes: [{ project_id: 1, name: 'Tip Jar', won: '$100 in MINI', prize_tx: '0xabc', paid_at: t(5) }] };
  assert.deepEqual(alertLines({ checkedAt: t(4), state: null, feeAlertedUsd: null }, f).lines, [
    'you won $100 in MINI with Tip Jar (basescan.org/tx/0xabc)',
  ]);
  assert.deepEqual(alertLines({ checkedAt: t(6), state: null, feeAlertedUsd: null }, f).lines, []);
});

test('rank changes into and out of the top N, only for scored entries and only against what was seen', () => {
  const s = (inTop: boolean, scored = true) => ({ project_id: 7, name: 'Tip Jar', campaign_title: 'C1', winners: 5, scored, inTop });
  const prev = { checkedAt: t(1), feeAlertedUsd: null };
  assert.deepEqual(alertLines({ ...prev, state: { top: { 7: false } } }, { ...empty, standings: [s(true)] }).lines, ['Tip Jar moved into the top 5 of C1']);
  assert.deepEqual(alertLines({ ...prev, state: { top: { 7: true } } }, { ...empty, standings: [s(false)] }).lines, ['Tip Jar dropped out of the top 5 of C1']);
  assert.deepEqual(alertLines({ ...prev, state: { top: { 7: true } } }, { ...empty, standings: [s(true)] }).lines, []);
  // First score straight into the top: news. First-ever check (no state): silent.
  assert.deepEqual(alertLines({ ...prev, state: { top: {} } }, { ...empty, standings: [s(true)] }).lines, ['Tip Jar moved into the top 5 of C1']);
  assert.deepEqual(alertLines({ checkedAt: null, state: null, feeAlertedUsd: null }, { ...empty, standings: [s(true)] }).lines, []);
  assert.deepEqual(alertLines({ ...prev, state: { top: {} } }, { ...empty, standings: [s(true, false)] }).state, { top: {} });
});

test('a campaign opened since the last check is news (opened_at, not created_at)', () => {
  const f: AlertFacts = { ...empty, newCampaigns: [{ id: 'c1', title: 'EarnKit Campaign #1', prize: '$100 each to top 5 (in MINI)', opened_at: t(5) }] };
  assert.deepEqual(alertLines({ checkedAt: t(4), state: null, feeAlertedUsd: null }, f).lines, ['new: EarnKit Campaign #1 ($100 each to top 5 (in MINI))']);
  assert.deepEqual(alertLines({ checkedAt: t(6), state: null, feeAlertedUsd: null }, f).lines, []);
  assert.deepEqual(alertLines({ checkedAt: null, state: null, feeAlertedUsd: null }, f).lines, []);
});

test('token fees from $100, once per crossing; money lines first', () => {
  const f: AlertFacts = {
    ...empty,
    fees: { usd: 138, tokens: [{ url: 'https://tokens.fun/coin/0xabc', symbol: 'TIP' }] },
    prizes: [{ project_id: 1, name: 'Tip Jar', won: '$100 in MINI', prize_tx: '0x1', paid_at: t(5) }],
    newCampaigns: [{ id: 'c2', title: 'C2', prize: '$50 each to top 3 (in MINI)', opened_at: t(5) }],
  };
  const r = alertLines({ checkedAt: t(4), state: null, feeAlertedUsd: null }, f);
  assert.deepEqual(r.lines, [
    'you won $100 in MINI with Tip Jar (basescan.org/tx/0x1)',
    'your token $TIP has $138 in fees to claim (tokens.fun/coin/0xabc)',
    'new: C2 ($50 each to top 3 (in MINI))',
  ]);
  assert.equal(r.feeAlertedUsd, 138);
  assert.deepEqual(alertLines({ checkedAt: t(6), state: null, feeAlertedUsd: 138 }, f).lines, []);
  const two = { ...f, fees: { usd: 250, tokens: [{ url: 'https://tokens.fun/coin/0xa', symbol: 'A' }, { url: 'https://tokens.fun/coin/0xb', symbol: 'B' }] } };
  assert.match(alertLines({ checkedAt: t(6), state: null, feeAlertedUsd: null }, two).lines[0], /^your tokens have \$250 in fees to claim \(tokens\.fun\/coin\/0xa\)$/);
});

test('sinceLine', () => {
  assert.equal(sinceLine([]), null);
  assert.equal(sinceLine(['a', 'b']), 'Since you last checked: a; b.');
});
