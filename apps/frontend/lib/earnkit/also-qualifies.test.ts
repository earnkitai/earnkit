import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldKind, SubmissionRequirement } from './program-file';
import type { Chain } from './match';
import { MAX_ALSO, alsoQualifies, alsoText, type AlsoProgram, type AlsoRow } from './also-qualifies';

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

const prog = (id: string, o: Partial<AlsoProgram> = {}): AlsoProgram => ({
  id,
  title: id,
  summary: 'up to $5,000 · rolling',
  chains: ['base'],
  any_chain: false,
  existing_work: 'allowed',
  ends_at: null,
  status: 'active',
  campaign: false,
  source: 'file',
  pool_usd: null,
  requirements: [req(`${id}_field`, 'other', { required: false })],
  ...o,
});

const base = {
  enteredProgramId: 'entered',
  chains: ['base'] as Chain[],
  enteredIds: new Set<string>(),
  bank: new Map<FieldKind, string>(),
  answers: {},
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

test('alsoQualifies: order is fewest left, then larger pool_usd, then sooner deadline; capped at MAX_ALSO', () => {
  const filled: SubmissionRequirement[] = [req('a', 'other', { required: false })];
  const oneLeft: SubmissionRequirement[] = [req('a', 'other', { required: false }), req('b', 'traction')];
  const rows = alsoQualifies({
    ...base,
    programs: [
      prog('p-more-left', { requirements: oneLeft, pool_usd: 999999 }),
      prog('p-small-pool', { requirements: filled, pool_usd: 100 }),
      prog('p-big-pool', { requirements: filled, pool_usd: 100000 }),
      prog('p-soon', { requirements: filled, pool_usd: 100000, ends_at: new Date(NOW.getTime() + 10 * DAY) }),
      prog('p-later', { requirements: filled, pool_usd: 100000, ends_at: new Date(NOW.getTime() + 20 * DAY) }),
    ],
  });
  assert.equal(rows.length, MAX_ALSO);
  assert.deepEqual(rows.map((r) => r.id), ['p-soon', 'p-later', 'p-big-pool']);
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

test('alsoText: the table, "Still needed", and the builder bonus sentence with coinIn; without coinIn the sentence is dropped; no rows is null', () => {
  const rows: AlsoRow[] = [
    { id: 'base-builder-grants', title: 'Base Builder Grant Program', prize: 'up to $5,000', ends: 'rolling', left: 1 },
    { id: 'avalanche-team1-mini-grants', title: 'Avalanche Team1 Mini Grants', prize: 'up to $10,000', ends: 'rolling', left: 0 },
  ];
  assert.equal(
    alsoText(rows, 'Arc Microgrants'),
    [
      'You also qualify for:',
      '| Program | Prize | Ends | Still needed |',
      '|---|---|---|---|',
      '| Base Builder Grant Program | up to $5,000 | rolling | 1 answer |',
      '| Avalanche Team1 Mini Grants | up to $10,000 | rolling | nothing |',
      'Say "enter it here too" for any of them. Builder bonus counts in Arc Microgrants.',
    ].join('\n'),
  );
  assert.equal(
    alsoText(rows, null),
    [
      'You also qualify for:',
      '| Program | Prize | Ends | Still needed |',
      '|---|---|---|---|',
      '| Base Builder Grant Program | up to $5,000 | rolling | 1 answer |',
      '| Avalanche Team1 Mini Grants | up to $10,000 | rolling | nothing |',
      'Say "enter it here too" for any of them.',
    ].join('\n'),
  );
  assert.equal(alsoText([], 'Arc Microgrants'), null);
});

test('alsoText: "N answers" plural for left > 1', () => {
  const rows: AlsoRow[] = [{ id: 'p', title: 'P', prize: 'up to $1,000', ends: 'rolling', left: 3 }];
  assert.match(alsoText(rows, null)!, /\| 3 answers \|/);
});
