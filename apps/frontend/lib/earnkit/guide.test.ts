import { test } from 'node:test';
import assert from 'node:assert/strict';
import { difficultyLabel, difficultyOf, guideSourceList, guideSources, guideText, programGuide, wonHeading, type GuideFacts } from './guide';
import type { PastRound } from './program-file';

const base: GuideFacts = {
  past_rounds: [], focus: null, best_bet: null, difficulty_override: null,
  winners_per_round: null, tag: null, each_time: [], submission_requirements: [], rules: [], chains: ['arc'],
};
/** A round of the program's own (Ruling C4: `own: true`). */
const round = (submissions?: number | null, winners?: number | null, label = 'Arc Microgrants R2'): PastRound =>
  ({ label, source_url: 'https://e/r', own: true, submissions, winners });
/** A predecessor event (Ruling C2): `own` left out. */
const pre = (submissions: number | null, winners: number | null, label: string): PastRound =>
  ({ label, source_url: 'https://e/p', submissions, winners });

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

test('Rulings C2, C4: a predecessor event is named, never "last round", whatever its label', () => {
  assert.deepEqual(difficultyOf({ ...base, past_rounds: [pre(155, 4, "Arc's HackMoney 2026 track")] }),
    { level: 'Hard', estimate: false, basis: "4 of ~155 entries won in Arc's HackMoney 2026 track" });
  assert.equal(difficultyOf({ ...base, past_rounds: [pre(null, 11, 'Rebel in Paradise AI Hackathon')] }).basis,
    '11 winners in Rebel in Paradise AI Hackathon; entry count not published');
  // A label that starts like the program's title is still a predecessor unless `own: true`.
  assert.equal(difficultyOf({ ...base, past_rounds: [pre(null, 5, 'Arc Microgrants Blitz')] }).basis,
    '5 winners in Arc Microgrants Blitz; entry count not published');
  assert.equal(difficultyOf({ ...base, past_rounds: [{ ...round(160, 20), own: false }] }).basis,
    '20 of ~160 entries won in Arc Microgrants R2');
});

test('Ruling 4 (review Finding 2): with past rounds, never "no past results yet"', () => {
  const themed = { ...pre(null, null, 'Base Batches 003'), themes: [{ theme: 'Onchain payments', count: 3 }] };
  assert.deepEqual(difficultyOf({ ...base, past_rounds: [themed] }),
    { level: 'Medium', estimate: true, basis: 'winners not published' });
  assert.deepEqual(difficultyOf({ ...base, past_rounds: [themed], winners_per_round: 10 }),
    { level: 'Medium', estimate: true, basis: '10 winners per round; past counts not published' });
  for (const w of [null, 2, 10])
    assert.doesNotMatch(difficultyOf({ ...base, past_rounds: [themed], winners_per_round: w }).basis, /no past results/);
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
  title: 'Arc Microgrants',
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
      label: "Arc's HackMoney 2026 track", source_url: 'https://e/h',
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

test('final review M3: themes counted over only the described winners (themes_of) show no denominator', () => {
  const r: PastRound = {
    ...pre(2857, 28, "Colosseum's 2026 Solana Frontier Hackathon"),
    themes_of: 26,
    themes: [{ theme: 'Prediction markets', count: 4 }, { theme: 'Stablecoin payments', count: 4 }],
  };
  assert.deepEqual(programGuide({ ...arc, past_rounds: [r] }, null, NOW).won?.lines, ['Prediction markets (4 winners)', 'Stablecoin payments (4)']);
  // themes_of equal to winners keeps "of N"; the difficulty still uses every winner.
  const all = programGuide({ ...arc, past_rounds: [{ ...r, themes_of: 28 }] }, null, NOW);
  assert.deepEqual(all.won?.lines, ['Prediction markets (4 of 28 winners)', 'Stablecoin payments (4 of 28)']);
  assert.match(programGuide({ ...arc, past_rounds: [r] }, null, NOW).difficulty.basis, /28 of ~2857/);
});

test('final review M3: the committed Colosseum file shows its themes without a denominator', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ProgramFile } = await import('./program-file');
  const raw = readFileSync(join(import.meta.dirname, '../../../../programs/colosseum-worlds-fair.json'), 'utf8');
  const p = ProgramFile.parse(JSON.parse(raw));
  const text = guideText(programGuide({ ...p, ends_at: p.ends_at ? new Date(p.ends_at) : null } as never, null, NOW));
  assert.match(text, /- Prediction markets \(4 winners\)/);
  assert.doesNotMatch(text, /of 28\)|of 28 winners/);
});

test('Ruling C3: a predecessor (or older) round reads "What won before"; the newest own round "What won last time"', () => {
  assert.match(guideText(programGuide(arc, null, NOW)), /\nWhat won last time\n/);
  const predecessor = programGuide({ ...arc, past_rounds: [{ ...arc.past_rounds[0], own: undefined }] }, null, NOW);
  assert.equal(predecessor.won?.own, false);
  assert.match(guideText(predecessor), /\nWhat won before\n/);
  assert.doesNotMatch(guideText(predecessor), /last (time|round)/);
  // The newest round is own but has no themes: the shown (older) round is not "last time".
  const older = programGuide({ ...arc, past_rounds: [round(undefined, 20, 'Arc Microgrants R3'), arc.past_rounds[0]] }, null, NOW);
  assert.match(guideText(older), /\nWhat won before\n/);
});

test('Ruling C12: a round that is not own names its event under the heading; each part names its own round', () => {
  // Own newest round: no event line.
  const own = programGuide(arc, null, NOW);
  assert.equal(own.won?.event, null);
  assert.match(guideText(own), /\nWhat won last time\n- /);
  // A predecessor: the event line follows the heading, before the first item.
  const p1 = programGuide({ ...arc, past_rounds: [{ ...arc.past_rounds[0], own: undefined, label: 'Base Batches 003' }] }, null, NOW);
  assert.equal(p1.won?.event, 'in Base Batches 003');
  assert.match(guideText(p1), /\nWhat won before\nin Base Batches 003\n- /);
  // Difficulty from one round, the won section from another: each names its own.
  const split = programGuide({
    ...arc,
    past_rounds: [
      { label: "Arc's tracks at ETHGlobal Cannes 2026", source_url: 'https://e/c', submissions: null, winners: null,
        themes: [{ theme: 'Pay-per-use micropayments', count: 4 }] },
      pre(155, 4, "Arc's tracks at ETHGlobal HackMoney 2026"),
    ],
  }, null, NOW);
  assert.equal(split.difficulty.basis, "4 of ~155 entries won in Arc's tracks at ETHGlobal HackMoney 2026");
  assert.equal(split.won?.event, "in Arc's tracks at ETHGlobal Cannes 2026");
  const t = guideText(split);
  assert.match(t, /Difficulty: Hard — 4 of ~155 entries won in Arc's tracks at ETHGlobal HackMoney 2026\n/);
  assert.match(t, /\nWhat won before\nin Arc's tracks at ETHGlobal Cannes 2026\n- Pay-per-use micropayments \(4 winners\)/);
  // An own round that isn't the newest is still named (it's not "last time").
  const older = programGuide({ ...arc, past_rounds: [round(undefined, 20, 'Arc Microgrants R3'), arc.past_rounds[0]] }, null, NOW);
  assert.equal(older.won?.event, `in ${arc.past_rounds[0].label}`);
});

test('empty data: the header and the estimate only, no empty headings, no bonus line', () => {
  const text = guideText(programGuide({ ...base, title: arc.title, summary: arc.summary, ends_at: arc.ends_at, status: 'active' }, null, NOW));
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

test('builder text: no tool or field names, no "coin", no "Clanker", in every render', () => {
  const renders = [
    programGuide(arc, BONUS, NOW),
    programGuide({ ...arc, past_rounds: [{ ...pre(null, null, "Arc's HackMoney 2026 track"), examples: [{ name: 'ArcFlow', what: 'agent payouts', source_url: 'https://e/a' }] }] }, null, NOW),
    programGuide({ ...arc, past_rounds: [pre(null, 11, 'Rebel in Paradise AI Hackathon')], focus: null, best_bet: null }, BONUS, NOW),
    programGuide({ ...base, title: arc.title, summary: arc.summary, ends_at: arc.ends_at, status: 'active' }, null, NOW),
  ];
  for (const g of renders) assert.doesNotMatch(guideText(g), /\bcoins?\b|clanker|_[a-z]|get_program|guide\.text/i);
});

test('guideSources follow the basis: the round, or the program for winners_per_round (Ruling 6)', () => {
  assert.deepEqual(guideSources({ ...base, winners_per_round: 20, source_url: 'https://prog' }), ['https://prog']);
  assert.deepEqual(guideSources({ ...base, past_rounds: [pre(null, 11, 'X')], source_url: 'https://prog' }), ['https://e/p']);
  assert.deepEqual(guideSources(base), []);
});

test('fix round 1: sources labelled by what they back, numbered within a role, same URLs as guideSources', () => {
  const list = guideSourceList(arc, [{ label: 'program page', url: 'https://e/p' }]);
  assert.deepEqual(list, [
    { label: 'program page', url: 'https://e/p' },
    { label: 'past winners 1', url: 'https://e/r' },
    { label: 'past winners 2', url: 'https://e/x' },
    { label: 'priorities', url: 'https://e/f' },
  ]);
  assert.deepEqual(new Set(list.slice(1).map((s) => s.url)), new Set(guideSources(arc)));
  // A basis from another round than "What won" shows is cited as "difficulty".
  const other = { ...arc, past_rounds: [arc.past_rounds[0], { ...round(300, 10, 'Arc Microgrants R1'), source_url: 'https://e/o' }] };
  other.past_rounds[0] = { ...arc.past_rounds[0], submissions: null };
  assert.deepEqual(guideSourceList(other).at(-1), { label: 'difficulty', url: 'https://e/o' });
  assert.equal(wonHeading({ own: true }), 'What won last time');
  assert.equal(wonHeading({ own: false }), 'What won before');
});

test('Ruling C12 on the committed files: a shown round that is not own is named in the agent text', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ProgramFile } = await import('./program-file');
  const dir = join(import.meta.dirname, '../../../../programs');
  let named = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const p = ProgramFile.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    const g = programGuide({ ...p, ends_at: p.ends_at ? new Date(p.ends_at) : null } as never, null, NOW);
    if (!g.won) continue;
    const shown = p.past_rounds.find((r) => r.themes?.length || r.examples?.length)!;
    if (shown === p.past_rounds[0] && shown.own) assert.equal(g.won.event, null, f);
    else {
      assert.ok(guideText(g).includes(`\nWhat won before\nin ${shown.label}\n- `), f);
      named++;
    }
  }
  assert.ok(named >= 4, 'the predecessor rounds of the open programs are named');
});
