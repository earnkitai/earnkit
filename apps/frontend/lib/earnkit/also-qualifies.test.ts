import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProgramFile, type FieldKind, type SubmissionRequirement } from './program-file';
import type { Chain } from './match';
import type { Difficulty } from './guide';
import { MAX_ALSO, alsoQualifies, alsoText, type AlsoProgram, type AlsoRow } from './also-qualifies';
import { repoCanWin, type FitRepo, type NewProgram } from './alerts';

const req = (key: string, kind: FieldKind, o: Partial<SubmissionRequirement> = {}): SubmissionRequirement => ({
  key,
  label: key.replace(/_/g, ' '),
  type: 'text',
  required: true,
  from: 'builder',
  kind,
  ...o,
});

const NOW = new Date('2026-10-07T00:00:00Z');
const DAY = 86_400_000;

const EASY: Difficulty = { level: 'Easy', estimate: false, rated: true, basis: 'x' };
const HARD: Difficulty = { level: 'Hard', estimate: false, rated: false, basis: 'x' };

const prog = (id: string, o: Partial<AlsoProgram> = {}): AlsoProgram => ({
  id,
  title: id,
  summary: 'up to $5,000 · rolling',
  chains: ['base'],
  any_chain: false,
  existing_work: 'allowed',
  tag: null,
  ends_at: null,
  status: 'active',
  campaign: false,
  source: 'file',
  investment: false,
  max_award_usd: null,
  difficulty: null,
  requirements: [req(`${id}_field`, 'other', { required: false })],
  ...o,
});

const base = {
  enteredProgramId: 'entered',
  chains: ['base'] as Chain[],
  enteredIds: new Set<string>(),
  bank: new Map<FieldKind, string>(),
  answers: {},
  hasLiveProduct: true,
  now: NOW,
};

test('alsoQualifies: a Base-chain program is eligible', () => {
  const rows = alsoQualifies({ ...base, programs: [prog('base-mini')] });
  assert.deepEqual(rows.map((r) => r.id), ['base-mini']);
});

test('alsoQualifies: an any_chain program is eligible regardless of chains', () => {
  const rows = alsoQualifies({ ...base, chains: ['monad'], programs: [prog('speedrun', { any_chain: true, chains: [] })] });
  assert.deepEqual(rows.map((r) => r.id), ['speedrun']);
});

test('alsoQualifies: never the program just entered', () => {
  const rows = alsoQualifies({ ...base, enteredProgramId: 'base-mini', programs: [prog('base-mini')] });
  assert.deepEqual(rows, []);
});

test('alsoQualifies: never a program already entered (enteredIds), including a confirmed-but-unsubmitted one (Task 8 carry)', () => {
  const rows = alsoQualifies({ ...base, enteredIds: new Set(['base-mini']), programs: [prog('base-mini')] });
  assert.deepEqual(rows, []);
});

test('alsoQualifies: never new_work_only, a campaign, a sponsor program, or a closed one', () => {
  const rows = alsoQualifies({
    ...base,
    programs: [
      prog('new-work-only', { existing_work: 'new_work_only' }),
      prog('a-campaign', { campaign: true }),
      prog('a-sponsor', { source: 'sponsor' }),
      prog('a-closed-one', { status: 'closed' }),
    ],
  });
  assert.deepEqual(rows, []);
});

test('alsoQualifies: never a chain mismatch', () => {
  const rows = alsoQualifies({ ...base, chains: ['arc'], programs: [prog('base-mini', { chains: ['base'] })] });
  assert.deepEqual(rows, []);
});

test('alsoQualifies: ends within 2 days is out; 3 days out is in; rolling (null) is always in', () => {
  const rows = alsoQualifies({
    ...base,
    programs: [
      prog('ends-soon', { ends_at: new Date(NOW.getTime() + 1 * DAY) }),
      prog('ends-exactly-2', { ends_at: new Date(NOW.getTime() + 2 * DAY) }),
      prog('ends-3-days', { ends_at: new Date(NOW.getTime() + 3 * DAY) }),
      prog('rolling'),
    ],
  });
  assert.deepEqual(new Set(rows.map((r) => r.id)), new Set(['ends-exactly-2', 'ends-3-days', 'rolling']));
});

// Review fix round 1, item 1 (C4): Easy first, then the larger top prize per winner, then fewest
// answers still needed. Capped at MAX_ALSO.
test('alsoQualifies: order is Easy first, then larger max_award_usd, then fewest left; capped at MAX_ALSO', () => {
  const filled: SubmissionRequirement[] = [req('a', 'other', { required: false })];
  const oneLeft: SubmissionRequirement[] = [req('a', 'other', { required: false }), req('b', 'traction')];
  const rows = alsoQualifies({
    ...base,
    programs: [
      prog('p-hard-big-prize', { requirements: filled, difficulty: HARD, max_award_usd: 999999 }),
      prog('p-easy-small-prize', { requirements: filled, difficulty: EASY, max_award_usd: 100 }),
      prog('p-easy-big-prize-more-left', { requirements: oneLeft, difficulty: EASY, max_award_usd: 100000 }),
      prog('p-easy-big-prize-filled', { requirements: filled, difficulty: EASY, max_award_usd: 100000 }),
      prog('p-no-difficulty', { requirements: filled, difficulty: null, max_award_usd: 5000000 }),
    ],
  });
  assert.equal(rows.length, MAX_ALSO);
  // Easy-rated programs sort above the Hard one and the undifferentiated one, regardless of prize;
  // among the Easy ones the larger prize wins; among equal prizes, fewer answers left wins.
  assert.deepEqual(rows.map((r) => r.id), ['p-easy-big-prize-filled', 'p-easy-big-prize-more-left', 'p-easy-small-prize']);
});

// Review fix round 1, item 1: the brief's own worked example, fixed. Both are rated Easy; the
// bigger prize per winner (Avalanche, $10,000) now sorts above the smaller one (Base, $5,000).
test('alsoQualifies: the brief\'s example order, fixed (C4) — Avalanche $10K above Base $5K, both Easy', () => {
  const rows = alsoQualifies({
    ...base,
    programs: [
      prog('base-builder-grants', { title: 'Base Builder Grant Program', difficulty: EASY, max_award_usd: 5000 }),
      prog('avalanche-team1-mini-grants', { title: 'Avalanche Team1 Mini Grants', difficulty: EASY, max_award_usd: 10000 }),
    ],
  });
  assert.deepEqual(rows.map((r) => r.id), ['avalanche-team1-mini-grants', 'base-builder-grants']);
});

test('alsoQualifies: left counts only required fields the bank cannot fill; contact fields count once in total', () => {
  const reqs: SubmissionRequirement[] = [
    req('traction', 'traction'),
    req('full_name', 'contact', { label: 'Full name' }),
    req('email', 'contact', { label: 'Email' }),
    req('optional', 'other', { required: false }),
  ];
  const noBank = alsoQualifies({ ...base, bank: new Map(), programs: [prog('p', { requirements: reqs })] });
  assert.equal(noBank[0].left, 2, 'traction + one contact group');
  const withBank = alsoQualifies({ ...base, bank: new Map([['traction', '120 users']]), programs: [prog('p', { requirements: reqs })] });
  assert.equal(withBank[0].left, 1, 'only the contact group is left (contact is never bank-filled)');
});

// Review fix round 1, item 3: matchRepo's "needs a live product" gate, applied to Also-qualifies.
const liveField = req('live_product_url', 'links', { project_field: 'live_url' });
const otherField = req('traction', 'traction');

test('alsoQualifies: a "needs a live product" program is excluded without a live product when other answers are also missing', () => {
  const rows = alsoQualifies({
    ...base,
    hasLiveProduct: false,
    programs: [prog('base-mini', { tag: 'needs a live product', requirements: [liveField, otherField] })],
  });
  assert.deepEqual(rows, []);
});

test('alsoQualifies: a "needs a live product" program shows when the live link is the only thing left; "Still needed" names it', () => {
  const rows = alsoQualifies({
    ...base,
    hasLiveProduct: false,
    answers: { traction: '120 users' },
    programs: [prog('base-mini', { title: 'Base Builder Grant Program', tag: 'needs a live product', requirements: [liveField, otherField] })],
  });
  assert.deepEqual(rows, [{ id: 'base-mini', title: 'Base Builder Grant Program', prize: 'up to $5,000', ends: 'rolling', left: 1, needsLive: true }]);
  assert.match(alsoText(rows)!, /\| Base Builder Grant Program \| up to \$5,000 \| rolling \| a live link \|/);
});

test('alsoQualifies: a "needs a live product" program shows normally once the project has a live product', () => {
  const rows = alsoQualifies({
    ...base,
    hasLiveProduct: true,
    programs: [prog('base-mini', { tag: 'needs a live product', requirements: [liveField, otherField] })],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].needsLive, undefined);
});

test('7.6 alsoText: the table and "Still needed", with no bonus sentence (v2.10 item 1); no rows is null', () => {
  const rows: AlsoRow[] = [
    { id: 'base-builder-grants', title: 'Base Builder Grant Program', prize: 'up to $5,000', ends: 'rolling', left: 1 },
    { id: 'avalanche-team1-mini-grants', title: 'Avalanche Team1 Mini Grants', prize: 'up to $10,000', ends: 'rolling', left: 0 },
  ];
  const text = alsoText(rows)!;
  assert.equal(
    text,
    [
      'You also qualify for:',
      '| Program | Prize | Ends | Still needed |',
      '|---|---|---|---|',
      '| Base Builder Grant Program | up to $5,000 | rolling | 1 answer |',
      '| Avalanche Team1 Mini Grants | up to $10,000 | rolling | nothing |',
      'Say "enter it here too" for any of them.',
    ].join('\n'),
  );
  assert.doesNotMatch(text, /rides on|moves to|builder bonus|\u2014|\bcoin/i);
  assert.equal(alsoText([]), null);
});

test('alsoText: "N answers" plural for left > 1', () => {
  const rows: AlsoRow[] = [{ id: 'p', title: 'P', prize: 'up to $1,000', ends: 'rolling', left: 3 }];
  assert.match(alsoText(rows)!, /\| 3 answers \|/);
});

// Final review I1: "Still needed" counts a field the project info fills (repo, live link, name) as
// filled, the same check as the coach (prepareSubmission). Real program files.
const fileProgram = (id: string): AlsoProgram => {
  const f = ProgramFile.parse(JSON.parse(readFileSync(join(__dirname, '../../../../programs', `${id}.json`), 'utf8')));
  return prog(id, { title: f.title, chains: f.chains, tag: f.tag ?? null, requirements: f.submission_requirements });
};

test('alsoQualifies (I1): Base "Still needed" drops by one when the project gives its live link', () => {
  const programs = [fileProgram('base-builder-grants')];
  const repo = { name: 'TipJar', repo_url: 'https://github.com/alice/tipjar' };
  const [without] = alsoQualifies({ ...base, programs, project: repo });
  const [withLive] = alsoQualifies({ ...base, programs, project: { ...repo, live_url: 'https://tipjar.xyz' } });
  assert.equal(withLive.left, without.left - 1);
});

test('alsoQualifies (I1): Avalanche never counts its name, one-liner or project link when the project gives them', () => {
  const programs = [fileProgram('avalanche-team1-mini-grants')];
  const chains: Chain[] = ['avalanche'];
  const [bare] = alsoQualifies({ ...base, chains, programs });
  const [known] = alsoQualifies({
    ...base,
    chains,
    programs,
    project: { name: 'TipJar', description: 'Tips for creators in USDC.', live_url: 'https://tipjar.xyz' },
  });
  assert.equal(known.left, bare.left - 3);
});

test('alsoQualifies (C23): an investment program never shows, even when it fits any chain', () => {
  const rows = alsoQualifies({
    ...base,
    programs: [prog('a16z-speedrun', { any_chain: true, chains: [], investment: true, summary: 'up to $1M · rolling' })],
  });
  assert.deepEqual(rows, []);
});

test('3.8 a program the builder applied to outside EarnKit, or is not interested in, is never in Also qualifies', () => {
  const programs = [prog('base-mini'), prog('arc-micro'), prog('avax')];
  const rows = alsoQualifies({
    ...base,
    programs,
    hidden: { notInterested: new Set(['base-mini']), applied: new Set(['arc-micro']) },
  });
  assert.deepEqual(rows.map((r) => r.id), ['avax']);
});

test('v2.9 T12 (G15 M1): canWin drops a program the repo could not really win; absent, nothing is dropped', () => {
  const programs = [prog('base-a', { chains: ['base'] }), prog('base-b', { chains: ['base'] })];
  const all = alsoQualifies({ ...base, programs }).map((r) => r.id).sort();
  assert.deepEqual(all, ['base-a', 'base-b']);
  const kept = alsoQualifies({ ...base, programs, canWin: (p) => p.id !== 'base-b' }).map((r) => r.id);
  assert.deepEqual(kept, ['base-a']);
});

test('3.11 (v2.10 item 6) a low-odds remembered repo adds no Also qualifies row (repoCanWin, as tools.ts alsoCanWin)', () => {
  const programs = [prog('base-a', { chains: ['base'], max_award_usd: 5000 })];
  const asNew = (a: AlsoProgram): NewProgram => ({
    id: a.id, title: a.title, prize: a.summary, chains: a.chains, any_chain: a.any_chain, opened_at: NOW, ends_at: a.ends_at,
    max_award_usd: a.max_award_usd, investment: a.investment, min_product_score: 0, tag: a.tag, existing_work: a.existing_work,
    starts_at: null, difficulty: { level: 'Easy', estimate: false, rated: true, basis: '' }, past_rounds: [], match_floor: null, match_precision: null,
  });
  const repo = (odds: 'good' | 'low'): FitRepo => ({
    key: 'alice/tipjar', name: 'tipjar', url: 'https://github.com/alice/tipjar', homepage: 'https://tipjar.xyz', created_at: '2026-01-01T00:00:00Z',
    chains: { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deployed' } },
    product: { score: 6, tier: 'product', missing: [], traction: odds === 'good' ? 8 : 0, odds, low_reason: odds === 'good' ? null : 'no users yet' },
    live_verified: true, said: null,
  });
  const rows = (odds: 'good' | 'low') => alsoQualifies({ ...base, programs, canWin: (p) => repoCanWin(asNew(p), repo(odds)) }).map((r) => r.id);
  assert.deepEqual(rows('good'), ['base-a']);
  assert.deepEqual(rows('low'), []);
});
