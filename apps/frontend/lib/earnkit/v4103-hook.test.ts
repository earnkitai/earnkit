import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateFailures, type Reply } from './fixtures/converse';
import { ALSO_START_ASK, alsoAgainAsk, alsoLeadLine, alsoMoneyLine, grantMoney } from './ready-copy';
import { INVESTOR_NAME_MS, grantTotal, namedInvestor, worthUpTo } from './ready-set';

/*
 * v4.10.3 Task 1 (R1, R2, R3; owner answers 1 and 3, 2026-11-03): the also-open lead's money line and its listed asks,
 * from the CTO's dogfood of OWN=27 (Base needing 11 answers, Circle not eligible, Alliance ALL19 closing in 15 days).
 */
const NOW = new Date('2026-11-03T12:00:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const ALLIANCE = { id: 'alliance-all19', title: 'Alliance ALL19', investment: true, max_usd: 400_000, ends_at: at(15 * DAY + 3_600_000) };
const ROUND = { asks: ['your team list', 'your usage numbers', 'your demo video', 'your contract address on Base'], n: 4 };

test('v4.10.3 (R1, R2): the money line says the grant total, then Alliance with its own amount, kind and close', () => {
  assert.equal(alsoMoneyLine(5_000, ALLIANCE, NOW), 'Open for you now: up to $5,000 in grants plus a $400K accelerator. Alliance closes in 15 days.');
  assert.equal(alsoMoneyLine(5_000, null, NOW), 'Open for you now: up to $5,000 in grants.');
  // Under 48 hours: the hours, never days.
  assert.equal(alsoMoneyLine(5_000, { ...ALLIANCE, ends_at: at(20 * 3_600_000 + 60_000) }, NOW), 'Open for you now: up to $5,000 in grants plus a $400K accelerator. Alliance closes in 20 hours.');
  // No amount stated: the kind alone.
  assert.equal(alsoMoneyLine(5_000, { ...ALLIANCE, max_usd: null }, NOW), 'Open for you now: up to $5,000 in grants plus an accelerator. Alliance closes in 15 days.');
  // A big total is said compactly, rounded down.
  assert.equal(grantMoney(105_500), '$105.5K');
  assert.equal(grantMoney(25_000), '$25,000');
});

test('v4.10.3 (R2): with no grant open, the investor clause alone or no money line; never "$0"', () => {
  assert.equal(alsoMoneyLine(0, ALLIANCE, NOW), 'Open for you now: a $400K accelerator. Alliance closes in 15 days.');
  assert.equal(alsoMoneyLine(0, null, NOW), null);
  // An investor program already closed is never named.
  assert.equal(alsoMoneyLine(0, { ...ALLIANCE, ends_at: at(-1000) }, NOW), null);
  for (const usd of [0, 5_000]) assert.doesNotMatch(alsoMoneyLine(usd, ALLIANCE, NOW) ?? '', /\$0\b/);
});

test('v4.10.3 (R1): the investor money is never in the grant total or the worth', () => {
  const set = [
    { kind: 'fit' as const, max_usd: 5_000 },
    { kind: 'investor' as const, max_usd: 400_000 },
    { kind: 'long_shot' as const, max_usd: 100_000 },
  ];
  assert.equal(grantTotal(set), 5_000);
  assert.equal(worthUpTo(set), '$5K');
  assert.equal(grantTotal([{ kind: 'investor', max_usd: 400_000 }]), 0);
  assert.equal(worthUpTo([{ kind: 'investor', max_usd: 400_000 }]), null);
});

test('v4.10.3 (R1): an investor program is named within 30 days of its close, the soonest one only', () => {
  const skip = new Set<string>();
  assert.equal(INVESTOR_NAME_MS, 30 * DAY);
  assert.equal(namedInvestor([ALLIANCE], NOW, skip)?.id, 'alliance-all19');
  assert.equal(namedInvestor([{ ...ALLIANCE, ends_at: at(30 * DAY) }], NOW, skip)?.id, 'alliance-all19');
  assert.equal(namedInvestor([{ ...ALLIANCE, ends_at: at(31 * DAY) }], NOW, skip), null);
  assert.equal(namedInvestor([{ ...ALLIANCE, ends_at: null }], NOW, skip), null, 'a rolling one never');
  assert.equal(namedInvestor([ALLIANCE], NOW, new Set(['alliance-all19'])), null, 'never one skipped or said no to');
  assert.equal(namedInvestor([{ ...ALLIANCE, investment: false }], NOW, skip), null, 'never a grant');
  const soon = { ...ALLIANCE, id: 'a16z', title: 'a16z speedrun SR008', ends_at: at(5 * DAY) };
  assert.equal(namedInvestor([ALLIANCE, soon], NOW, skip)?.id, 'a16z');
});

test('v4.10.3 (R3, owner answer 3): the lead names the first 4 asks and "and 7 more"; the repeat names them too', () => {
  assert.equal(
    alsoLeadLine('Base Builder Grant', 'up to $5,000', 11, ROUND),
    'Base Builder Grant pays up to $5,000 and needs 11 answers from you. The first 4: your team list, usage numbers, demo video and contract address on Base, and 7 more after these.',
  );
  // All in the first round: the list alone.
  assert.equal(alsoLeadLine('Some Grant', 'up to $1,000', 2, { asks: ['your team list', 'your demo video'], n: 2 }), 'Some Grant pays up to $1,000 and needs 2 answers from you: your team list and demo video.');
  // A lead stored before v4.10.3 (no round): the count, as it was.
  assert.equal(alsoLeadLine('Base Builder Grant', 'up to $5,000', 11), 'Base Builder Grant pays up to $5,000 and needs 11 answers from you.');
  assert.equal(
    alsoAgainAsk('Base Builder Grant', 'up to $5,000', 11, ROUND),
    'Want me to start Base Builder Grant (up to $5,000, 11 answers from you, starting with your team list, usage numbers, demo video and contract address on Base)?',
  );
  assert.equal(alsoAgainAsk('Base Builder Grant', 'up to $5,000', 11), 'Want me to start Base Builder Grant (up to $5,000, 11 answers from you)?');
});

test('v4.10.3 fix round 1 (6): a round phrase that reads as an open question falls back to the count in the repeat', () => {
  const open = { asks: ['how it makes money today', 'your 3-month plan in one line', 'your Base Builder Code (from base.dev)', 'your main challenge right now'], n: 4 };
  const again = alsoAgainAsk('Base Builder Grant', 'up to $5,000', 8, open);
  assert.equal(again, 'Want me to start Base Builder Grant (up to $5,000, 4 answers to start)?');
  assert.equal(alsoAgainAsk('Base Builder Grant', null, 8, { asks: ['your team or your company'], n: 1 }), 'Want me to start Base Builder Grant (1 answer to start)?');
  assert.equal(alsoAgainAsk('Base Builder Grant', 'up to $5,000', 8, { asks: ['what you shipped'], n: 1 }), 'Want me to start Base Builder Grant (up to $5,000, 1 answer to start)?');
  // The lead itself keeps the list (a statement, not the question).
  assert.match(alsoLeadLine('Base Builder Grant', 'up to $5,000', 8, open), /The first 4: how it makes money today, /);
  const r = { turn: 0, session: 0, first: false, hook: false, tool: 'find', input: {}, show: again, said: [], reply: { move_up: { kind: 'apply', project_key: 'a/b' } } } as Reply;
  assert.deepEqual(gateFailures([r, { ...r, turn: 1 }]), []);
});

test('v4.10.3: the lead (money first, the asks, one yes/no last) and its repeats pass the gate', () => {
  const reply = (show: string, o: Partial<Reply> = {}): Reply =>
    ({ turn: 0, session: 0, first: true, hook: false, tool: 'find', input: {}, show, said: ['proof:streak=7'], reply: { move_up: { kind: 'apply', project_key: 'a/b' } }, ...o }) as Reply;
  const lead = reply([
    alsoMoneyLine(5_000, ALLIANCE, NOW)!, "You've shipped 7 weeks in a row.", alsoLeadLine('Base Builder Grant', 'up to $5,000', 11, ROUND), ALSO_START_ASK,
  ].join('\n\n'));
  const lines = lead.show.split('\n\n');
  assert.match(lines[0], /^Open for you now: /);
  assert.equal(lines.at(-1), 'Want me to start it?');
  const again = alsoAgainAsk('Base Builder Grant', 'up to $5,000', 11, ROUND);
  const replies = [lead, ...[1, 2].map((turn) => reply(again, { turn, first: false, said: [] }))];
  assert.deepEqual(gateFailures(replies), []);
  for (const r of replies) assert.doesNotMatch(r.show, /—|\bcoins?\b|\bpoints?\b/i);
});
