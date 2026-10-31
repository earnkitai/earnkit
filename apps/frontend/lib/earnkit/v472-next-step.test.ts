import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openNowLine } from './bench-reply';
import { openNowGrants, openNowInvestment } from './bench-find';
import { moneyText, openMoneyUsd } from './pool';
import type { Card } from './present';

/** v4.7.2 Task 1: the open money paragraph carries the total in grants and the soonest open investment. */
const NOW = new Date('2026-10-31T12:00:00Z');
const card = (o: Record<string, unknown>) =>
  ({ id: 'p', title: 'P', summary: '$1,000', reward: '$1,000', tag: 'likely', each_time: [], ends_at: null, status: 'active', max_award_usd: 1000, ...o }) as unknown as Card;
const A16Z = card({
  id: 'a16z', title: 'a16z speedrun SR008', summary: 'up to $1M · priority window Oct 12 to Nov 1', reward: 'Up to $1M in funding and $10M+ in credits',
  investment: true, max_award_usd: 1_000_000, ends_at: new Date('2026-11-01T20:00:00Z'),
});
const ARC = card({ id: 'arc', title: 'Arc Microgrants: Built with Studio', summary: '500 USDC × 8 grants · closes Nov 1', reward: '500 USDC', max_award_usd: 4000, ends_at: new Date('2026-11-01T20:00:00Z') });
const BASE = card({ id: 'base', title: 'Base Builder Grant Program', summary: '$5,000 · rolling', reward: '$5,000', max_award_usd: 5000 });

const GRANTS = [
  { title: 'Arc Microgrants: Built with Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1' },
  { title: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling' },
];
const INVEST = { title: 'a16z speedrun SR008', amount: 'up to $1M', when: 'closes Nov 1' };

test('openNowLine: the owner line, with total and investment', () => {
  assert.equal(
    openNowLine(GRANTS, { total: '$105.5K', invest: INVEST }),
    'Open now: $105.5K in grants. Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Base Builder Grant Program, $5,000, rolling. a16z speedrun SR008, up to $1M investment, closes Nov 1.',
  );
});

test('openNowLine: no total, no "in grants." sentence', () => {
  const t = openNowLine(GRANTS, { total: null, invest: INVEST })!;
  assert.ok(t.startsWith('Open now: Arc Microgrants'), t);
  assert.ok(!t.includes('in grants.'), t);
});

test('openNowLine: no investment, no investment part', () => {
  const t = openNowLine(GRANTS, { total: '$105.5K', invest: null })!;
  assert.ok(!t.includes('investment'), t);
  assert.equal(openNowLine(GRANTS), 'Open now: Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Base Builder Grant Program, $5,000, rolling.');
  assert.equal(openNowLine([]), null);
});

test('openNowInvestment: first open investment, never "up to up to"', () => {
  const i = openNowInvestment([ARC, A16Z], NOW, new Set());
  assert.equal(i?.id, 'a16z');
  assert.equal(openNowLine(GRANTS, { invest: i })!.endsWith('a16z speedrun SR008, up to $1M investment, closes Nov 1.'), true);
  assert.ok(!/up to up to/i.test(openNowLine(GRANTS, { invest: i })!));
});

test('openNowInvestment: skips an applied one, a closed one, and is null with none', () => {
  assert.equal(openNowInvestment([ARC, A16Z], NOW, new Set(['a16z'])), null);
  assert.equal(openNowInvestment([ARC, A16Z], new Date('2026-11-05T00:00:00Z'), new Set()), null);
  assert.equal(openNowInvestment([ARC, BASE], NOW, new Set()), null);
  assert.equal(openNowInvestment([{ ...A16Z, sponsored: true } as Card], NOW, new Set()), null);
  assert.equal(openNowInvestment([{ ...A16Z, agent_completable: false } as Card], NOW, new Set()), null);
});

test('openNowInvestment: soonest closes first, rolling last', () => {
  const rolling = card({ ...A16Z, id: 'r', title: 'Rolling', ends_at: null, summary: 'up to $2M · rolling' });
  const soon = card({ ...A16Z, id: 's', title: 'Soon', ends_at: new Date('2026-11-10T00:00:00Z') });
  assert.equal(openNowInvestment([rolling, soon], NOW, new Set())?.id, 's');
});

test('the total is the landing chip figure and leaves the investment out', () => {
  const cards = [ARC, BASE, A16Z];
  const total = moneyText(openMoneyUsd(cards, NOW));
  assert.equal(total, '$9K');
  assert.equal(openNowGrants(cards, NOW, new Set()).length, 2);
});
