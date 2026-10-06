import { test } from 'node:test';
import assert from 'node:assert/strict';
import { difficultyLabel, difficultyOf, guideSources, guideText, programGuide, type GuideFacts } from './guide';
import type { PastRound } from './program-file';

const base: GuideFacts = {
  title: 'Arc Microgrants', past_rounds: [], focus: null, best_bet: null, difficulty_override: null,
  winners_per_round: null, tag: null, each_time: [], submission_requirements: [], rules: [], chains: ['arc'],
};
/** A round of the program's own (its label starts with the program's title). */
const round = (submissions?: number | null, winners?: number | null, label = 'Arc Microgrants R2'): PastRound =>
  ({ label, source_url: 'https://e/r', submissions, winners });

test('v2.7 §2: odds bands, boundaries included (Ruling 2)', () => {
  const d = (s: number, w: number) => difficultyOf({ ...base, past_rounds: [round(s, w)] });
  assert.deepEqual(d(160, 20), { level: 'Medium', estimate: false, basis: '20 of ~160 entries won last round' });
  assert.equal(d(160, 40).level, 'Easy'); // exactly 25%
  assert.equal(d(100, 8).level, 'Medium'); // exactly 8%
  assert.equal(d(100, 7).level, 'Hard');
});

test('Ruling 2: the newest round with both counts; an older one is named', () => {
  const g = difficultyOf({ ...base, past_rounds: [round(undefined, 20, 'Arc Microgrants Q3'), round(200, 10, 'Arc Microgrants Q2')] });
  assert.deepEqual(g, { level: 'Hard', estimate: false, basis: '10 of ~200 entries won in Arc Microgrants Q2' });
});

test('Ruling C2: a predecessor event is named, never "last round"', () => {
  const pre = round(155, 4, 'Arc track, HackMoney 2026');
  assert.deepEqual(difficultyOf({ ...base, past_rounds: [pre] }),
    { level: 'Hard', estimate: false, basis: '4 of ~155 entries won in Arc track, HackMoney 2026' });
  assert.equal(difficultyOf({ ...base, past_rounds: [round(null, 11, 'Rebel in Paradise AI Hackathon')] }).basis,
    '11 winners in Rebel in Paradise AI Hackathon; entry count not published');
});

test('Rulings 3-4: estimates, never Easy', () => {
  assert.deepEqual(difficultyOf(base), { level: 'Medium', estimate: true, basis: 'no past results yet' });
  assert.deepEqual(difficultyOf({ ...base, past_rounds: [round(undefined, 20)] }),
    { level: 'Medium', estimate: true, basis: '20 winners last round; entry count not published' });
  assert.equal(difficultyOf({ ...base, tag: 'long shot' }).level, 'Hard');
  assert.equal(difficultyOf({ ...base, winners_per_round: 2 }).level, 'Hard');
  assert.equal(difficultyOf({ ...base, winners_per_round: 20 }).basis, '20 winners per round; no past results yet');
  for (const w of [1, 5, 20, 500]) assert.notEqual(difficultyOf({ ...base, winners_per_round: w }).level, 'Easy');
  // Every barrier and many winners: still an estimate, still not Easy.
  const barriers = {
    ...base, winners_per_round: 500, each_time: ['a demo video', 'a form'], rules: ['deploy on mainnet'],
  };
  assert.deepEqual(difficultyOf(barriers), { level: 'Medium', estimate: true, basis: '500 winners per round; no past results yet' });
  // Barriers lift a 3-winner program (−1) back to Medium.
  assert.equal(difficultyOf({ ...barriers, winners_per_round: 3 }).level, 'Medium');
  assert.equal(difficultyOf({ ...base, winners_per_round: 3 }).level, 'Hard');
});

test('Ruling 5: an override wins and is not an estimate', () => {
  const o = { level: 'Easy' as const, basis: 'every complete entry is funded', source_url: 'https://e' };
  assert.deepEqual(difficultyOf({ ...base, difficulty_override: o, past_rounds: [round(1000, 1)] }),
    { level: 'Easy', estimate: false, basis: 'every complete entry is funded' });
});

test('difficultyLabel', () => {
  assert.equal(difficultyLabel({ level: 'Medium', estimate: false, basis: '' }), 'Medium');
  assert.equal(difficultyLabel({ level: 'Hard', estimate: true, basis: '' }), 'Hard (estimate)');
});

const NOW = new Date('2026-10-06T12:00:00Z');
const arc = {
  ...base,
  summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET',
  ends_at: new Date('2026-10-15T03:59:00Z'),
  status: 'active' as const,
  past_rounds: [{
    ...round(160, 20),
    themes: [{ theme: 'Agent wallets paying for APIs', count: 2 }, { theme: 'USDC payroll and payouts', count: 3 }],
    examples: [{ name: 'PayStream', what: 'streamed salaries in USDC', why: 'live mainnet demo', source_url: 'https://e/x' }],
  }],
  focus: { areas: ['Stablecoin payments', 'FX', 'Agentic commerce'], source_url: 'https://e/f' },
  best_bet: 'A USDC payout tool with a live mainnet demo',
};
const BONUS = { cell: '0.18 ETH so far', board: 'earnkit.com/bonus/arc-microgrants-2026-09-16' };

test('v2.7 §2: the full guide, exactly', () => {
  assert.equal(guideText(programGuide(arc, BONUS, NOW)), [
    'Arc Microgrants · 500 USDC × 20 grants · ends Oct 14',
    'Difficulty: Medium — 20 of ~160 entries won last round',
    '',
    'What won last time',
    '- USDC payroll and payouts (3 of 20 winners)',
    '- Agent wallets paying for APIs (2 of 20)',
    '- Example: PayStream — streamed salaries in USDC; cited for live mainnet demo',
    '',
    'What Arc wants now',
    '- Stablecoin payments · FX · Agentic commerce',
    '',
    'Your best bet',
    '- A USDC payout tool with a live mainnet demo',
    '',
    'Builder bonus: 0.18 ETH so far · earnkit.com/bonus/arc-microgrants-2026-09-16',
  ].join('\n'));
  assert.deepEqual(guideSources(arc), ['https://e/r', 'https://e/x', 'https://e/f']);
});

test('Review Focus 5: partial data — no round winners, no why', () => {
  const g = programGuide({
    ...arc,
    past_rounds: [{
      label: 'Arc track, HackMoney 2026', source_url: 'https://e/h',
      themes: [{ theme: 'USDC payroll and payouts', count: 3 }, { theme: 'Agent wallets paying for APIs', count: 2 }],
      examples: [{ name: 'ArcFlow', what: 'agent payouts in USDC', source_url: 'https://e/a' }],
    }],
  }, null, NOW);
  assert.deepEqual(g.won?.lines, [
    'USDC payroll and payouts (3 winners)',
    'Agent wallets paying for APIs (2)',
    'Example: ArcFlow — agent payouts in USDC',
  ]);
  assert.equal(g.won?.source_url, 'https://e/h');
  assert.ok(!guideText(g).includes('cited for'));
});

test('empty data: the header and the estimate only, no empty headings, no bonus line', () => {
  const text = guideText(programGuide({ ...base, summary: arc.summary, ends_at: arc.ends_at, status: 'active' }, null, NOW));
  assert.equal(text, 'Arc Microgrants · 500 USDC × 20 grants · ends Oct 14\nDifficulty: Medium (estimate) — no past results yet');
});

test('Ruling 7: focus.ecosystem names the heading', () => {
  const g = programGuide({ ...arc, focus: { ...arc.focus, ecosystem: 'Circle' } }, null, NOW);
  assert.match(guideText(g), /\nWhat Circle wants now\n/);
});

test('Ruling 9: closed and rolling headers', () => {
  assert.match(programGuide({ ...arc, status: 'closed' }, null, NOW).header, / · closed$/);
  assert.match(programGuide(arc, null, new Date('2026-10-16T00:00:00Z')).header, / · closed$/, 'past the deadline');
  assert.equal(
    programGuide({ ...base, title: 'Base Builder Grant Program', chains: ['base'], summary: 'up to $5,000 · rolling', ends_at: null, status: 'active' }, null, NOW).header,
    'Base Builder Grant Program · up to $5,000 · rolling',
  );
});

test('builder text: no tool or field names, no "coin", no "Clanker"', () => {
  const text = guideText(programGuide(arc, BONUS, NOW));
  assert.doesNotMatch(text, /\bcoins?\b|clanker|_[a-z]|get_program|guide\.text/i);
});
