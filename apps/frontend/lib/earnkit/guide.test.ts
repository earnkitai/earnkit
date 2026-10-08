import { test } from 'node:test';
import assert from 'node:assert/strict';
import { difficultyLabel, difficultyOf, harder, rowDifficulty, guideSourceList, guideSources, guideText, programGuide, wonHeading, type GuideFacts } from './guide';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchRepo, type ProgramFacts, type RepoFacts, type Verdict } from './match';
import { ProgramFile, type PastRound } from './program-file';

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
  assert.deepEqual(d(160, 20), { level: 'Medium', estimate: false, rated: false, basis: '20 of ~160 entries won last round' });
  assert.equal(d(160, 40).level, 'Easy'); // exactly 25%
  assert.equal(d(100, 8).level, 'Medium'); // exactly 8%
  assert.equal(d(100, 7).level, 'Hard');
});

test('Ruling 2: the newest round with both counts; an older one is named', () => {
  const g = difficultyOf({ ...base, past_rounds: [round(undefined, 20, 'Arc Microgrants Q3'), round(200, 10, 'Arc Microgrants Q2')] });
  assert.deepEqual(g, { level: 'Hard', estimate: false, rated: false, basis: '10 of ~200 entries won in Arc Microgrants Q2' });
});

test('Rulings C2, C4: a predecessor event is named, never "last round", whatever its label', () => {
  assert.deepEqual(difficultyOf({ ...base, past_rounds: [pre(155, 4, "Arc's HackMoney 2026 track")] }),
    { level: 'Hard', estimate: false, rated: false, basis: "4 of ~155 entries won in Arc's HackMoney 2026 track" });
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
    { level: 'Medium', estimate: true, rated: false, basis: 'winners not published' });
  assert.deepEqual(difficultyOf({ ...base, past_rounds: [themed], winners_per_round: 10 }),
    { level: 'Medium', estimate: true, rated: false, basis: '10 winners per round; past counts not published' });
  for (const w of [null, 2, 10])
    assert.doesNotMatch(difficultyOf({ ...base, past_rounds: [themed], winners_per_round: w }).basis, /no past results/);
});

test('Rulings 3-4: estimates, never Easy', () => {
  assert.deepEqual(difficultyOf(base), { level: 'Medium', estimate: true, rated: false, basis: 'no past results yet' });
  assert.deepEqual(difficultyOf({ ...base, past_rounds: [round(undefined, 20)] }),
    { level: 'Medium', estimate: true, rated: false, basis: '20 winners last round; entry count not published' });
  assert.equal(difficultyOf({ ...base, tag: 'long shot' }).level, 'Hard');
  assert.equal(difficultyOf({ ...base, winners_per_round: 2 }).level, 'Hard');
  assert.equal(difficultyOf({ ...base, winners_per_round: 20 }).basis, '20 winners per round; no past results yet');
  for (const w of [1, 5, 20, 500]) assert.notEqual(difficultyOf({ ...base, winners_per_round: w }).level, 'Easy');
  // Every barrier and many winners: still an estimate, still not Easy.
  const barriers = {
    ...base, winners_per_round: 500, each_time: ['a demo video', 'a form'], rules: ['deploy on mainnet'],
  };
  assert.deepEqual(difficultyOf(barriers), { level: 'Medium', estimate: true, rated: false, basis: '500 winners per round; no past results yet' });
  // Barriers lift a 3-winner program (−1) back to Medium.
  assert.equal(difficultyOf({ ...barriers, winners_per_round: 3 }).level, 'Medium');
  assert.equal(difficultyOf({ ...base, winners_per_round: 3 }).level, 'Hard');
});

test('Ruling 5: an override wins and is not an estimate', () => {
  const o = { level: 'Easy' as const, basis: 'every complete entry is funded', source_url: 'https://e' };
  assert.deepEqual(difficultyOf({ ...base, difficulty_override: o, past_rounds: [round(1000, 1)] }),
    { level: 'Easy', estimate: false, rated: false, basis: 'every complete entry is funded' });
});

test('difficultyLabel', () => {
  assert.equal(difficultyLabel({ level: 'Medium', estimate: false, rated: false, basis: '' }), 'Medium');
  assert.equal(difficultyLabel({ level: 'Hard', estimate: true, rated: false, basis: '' }), 'Hard (estimate)');
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
    'Arc Microgrants · 500 USDC × 20 grants · ends Oct 14, 11:59 PM ET',
    'Difficulty: Medium. 20 of ~160 entries won last round.',
    '',
    'What won last time',
    '- USDC payroll and payouts (3 of 20 winners)',
    '- Agent wallets paying for APIs (2 of 20)',
    '- Example: PayStream, streamed salaries in USDC; cited for live mainnet demo',
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
    'Example: ArcFlow, agent payouts in USDC',
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
  assert.match(t, /Difficulty: Hard\. 4 of ~155 entries won in Arc's tracks at ETHGlobal HackMoney 2026\.\n/);
  assert.match(t, /\nWhat won before\nin Arc's tracks at ETHGlobal Cannes 2026\n- Pay-per-use micropayments \(4 winners\)/);
  // An own round that isn't the newest is still named (it's not "last time").
  const older = programGuide({ ...arc, past_rounds: [round(undefined, 20, 'Arc Microgrants R3'), arc.past_rounds[0]] }, null, NOW);
  assert.equal(older.won?.event, `in ${arc.past_rounds[0].label}`);
});

test('empty data: the header and the estimate only, no empty headings, no bonus line', () => {
  const text = guideText(programGuide({ ...base, title: arc.title, summary: arc.summary, ends_at: arc.ends_at, status: 'active' }, null, NOW));
  assert.equal(text, 'Arc Microgrants · 500 USDC × 20 grants · ends Oct 14, 11:59 PM ET\nDifficulty: Medium (estimate). No past results yet.');
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

// ---- v2.8 Task 6: the EarnKit rating and the estimate override ----

test('v2.8 Ruling 12: an EarnKit rating reads just "Easy", with no basis, stat or label', () => {
  const rated = { ...arc, difficulty_override: { level: 'Easy' as const, rated_by: 'earnkit' as const, source_url: 'https://e/program' } };
  assert.deepEqual(difficultyOf(rated), { level: 'Easy', estimate: false, rated: true, basis: '' });
  const text = guideText(programGuide(rated, null, NOW));
  const line = text.split('\n').find((l) => l.startsWith('Difficulty:'));
  assert.equal(line, 'Difficulty: Easy');
  assert.doesNotMatch(line!, /rated|EarnKit|%|\d/i);
  // The rating's source is the program page, still cited (as "difficulty") but never shown as a basis.
  assert.ok(guideSources(rated).includes('https://e/program'));
});

test('v2.8 Ruling 11: an estimate override shows "Hard (estimate)" and its basis (Ruling 17)', () => {
  const o = { level: 'Hard' as const, estimate: true as const, basis: 'a16z publishes no acceptance figures', source_url: 'https://e/faq' };
  const d = difficultyOf({ ...base, difficulty_override: o });
  assert.deepEqual(d, { level: 'Hard', estimate: true, rated: false, basis: 'a16z publishes no acceptance figures' });
  assert.equal(difficultyLabel(d), 'Hard (estimate)');
  const text = guideText(programGuide({ ...arc, past_rounds: [], focus: null, best_bet: null, difficulty_override: o }, null, NOW));
  assert.match(text, /^Difficulty: Hard \(estimate\)\. A16z publishes no acceptance figures\.$/m);
});

// ---- v2.9 A4, A6, A8: row difficulty ----

const easyProgram = { difficulty: { level: 'Easy' as const, estimate: false, rated: true, basis: '' } };
const verdict = (effort: Verdict['effort'], missing: Verdict['missing'] = []) => ({ effort, missing });
const plain = { liveVerified: false, hasUsersClaim: false };

test('4.1 a row is max(program level, distance): none/minutes Easy, hours/days Medium, weeks Hard', () => {
  const row = (e: Verdict['effort']) => rowDifficulty(easyProgram, verdict(e), plain).level;
  assert.equal(row('none'), 'Easy');
  assert.equal(row('minutes'), 'Easy');
  assert.equal(row('hours'), 'Medium');
  assert.equal(row('days'), 'Medium');
  assert.equal(row('weeks'), 'Hard');
  // The program level is a floor: a Medium program never reads Easy.
  const medium = { difficulty: { level: 'Medium' as const, estimate: true, rated: false, basis: 'x' } };
  assert.deepEqual(rowDifficulty(medium, verdict('none'), plain), { level: 'Medium', estimate: true });
  assert.deepEqual(rowDifficulty(medium, verdict('weeks'), plain), { level: 'Hard', estimate: false });
  assert.equal(harder('Easy'), 'Medium');
  assert.equal(harder('Hard'), 'Hard');
});

test('4.2 real_users missing is never Easy: Hard unverified, Medium with a verified link or a users claim (P2: matchRepo output)', () => {
  const program: ProgramFacts = {
    id: 'base', title: 'Base', chains: ['base'], any_chain: false, existing_work: 'allowed', tag: 'needs a live product',
    starts_at: null, investment: false, min_product_score: 0,
  };
  const product = { score: 6, tier: 'product' as const, missing: [] };
  const repo: RepoFacts = {
    name: 'tipjar', url: 'https://github.com/a/tipjar', homepage: 'https://tipjar.xyz', created_at: '2026-01-01',
    chains: { base: { mainnet: true, testnet: false, evidence: 'x' } }, commits_in_window: {}, product,
  };
  const card = { difficulty: difficultyOf({ ...base, tag: 'needs a live product', chains: ['base'] }) };
  const [unverified] = matchRepo({ ...repo, live_verified: false }, [program]);
  assert.ok(unverified.missing.includes('real_users'));
  assert.equal(rowDifficulty(card, unverified, plain).level, 'Hard');
  const [verified] = matchRepo({ ...repo, live_verified: true }, [program]);
  assert.deepEqual(verified.missing, ['real_users']);
  assert.equal(verified.effort, 'weeks');
  assert.equal(rowDifficulty(card, verified, { liveVerified: true, hasUsersClaim: false }).level, 'Medium');
  assert.equal(rowDifficulty(card, unverified, { liveVerified: false, hasUsersClaim: true }).level, 'Medium');
  // Never Easy, even on an Easy program.
  for (const o of [plain, { liveVerified: true, hasUsersClaim: true }])
    assert.notEqual(rowDifficulty(easyProgram, verdict('weeks', ['real_users']), o).level, 'Easy');
});

test('4.3 program level: the live-product floor beats an EarnKit Easy rating; investment and under 1% odds are Hard', () => {
  const rating = { level: 'Easy' as const, rated_by: 'earnkit' as const, source_url: 'https://e/x' };
  assert.equal(difficultyOf({ ...base, difficulty_override: rating }).level, 'Easy');
  assert.equal(difficultyOf({ ...base, tag: 'needs a live product', difficulty_override: rating }).level, 'Medium');
  assert.equal(difficultyOf({ ...base, tag: 'needs a live product', past_rounds: [round(100, 40)] }).level, 'Medium');
  assert.equal(difficultyOf({ ...base, investment: true, difficulty_override: rating }).level, 'Hard');
  assert.equal(difficultyOf({ ...base, investment: true, past_rounds: [round(100, 40)] }).level, 'Hard');
  assert.equal(difficultyOf({ ...base, past_rounds: [round(400, 3)] }).level, 'Hard');
});

test('4.4 match precision under 5% makes a row one step harder; 5% leaves it', () => {
  const at = (match_precision: number | null) => rowDifficulty({ ...easyProgram, match_precision }, verdict('hours'), plain).level;
  assert.equal(at(null), 'Medium');
  assert.equal(at(0.04), 'Hard');
  assert.equal(at(0.05), 'Medium');
});

test('4.5 Base after the file edit is Medium (estimate), not Easy', () => {
  const file = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/base-builder-grants.json'), 'utf8'));
  const p = ProgramFile.parse(file);
  const d = difficultyOf({ ...p, tag: p.tag ?? null, best_bet: p.best_bet ?? null, focus: p.focus ?? null, winners_per_round: p.winners_per_round ?? null });
  assert.equal(d.level, 'Medium');
  assert.equal(d.estimate, true);
  assert.equal(difficultyLabel(d), 'Medium (estimate)');
});
