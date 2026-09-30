import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closesInDays,
  presentPrograms,
  presentSinceLastCheck,
  type Card,
} from './present';
import type { Verdict } from './match';

const cards: Card[] = [
  {
    id: 'big',
    title: 'Big Hack',
    summary: '$100K · closes Oct 12',
    tag: 'long shot',
    each_time: ['a pitch video'],
  },
  {
    id: 'grant',
    title: 'Grant',
    summary: 'up to $5K · rolling',
    tag: 'needs a live product',
    each_time: [],
  },
  {
    id: 'micro',
    title: 'Micro',
    summary: '500 USDC × 20 · closes Oct 14',
    tag: null,
    each_time: [],
  },
];

test('no repos: one line per program, approve-only first, who-does-what said once', () => {
  const text = presentPrograms(cards, true);
  assert.equal(
    text,
    [
      '- **Micro** · 500 USDC × 20 · closes Oct 14\n' +
        '- **Grant** · up to $5K · rolling · needs a live product\n' +
        '- **Big Hack** · $100K · closes Oct 12 · long shot',
      "Pick one and I'll build, deploy, and submit it. You approve before anything is sent, and I'll say up front if it needs something only you can give, like a pitch video.",
    ].join('\n\n'),
  );
  assert.ok(!text.includes('Me:'));
});

test('chat-only agent is honest about who builds', () => {
  const text = presentPrograms(cards, false);
  assert.match(text, /can't build or deploy from here/);
  assert.match(text, /coding agent/);
});

const v = (program_id: string, status: Verdict['status'], note: string): Verdict => ({
  program_id,
  program: program_id,
  status,
  note,
});

test('repo fits: listed under the repo with what it needs, never repeated under Also open', () => {
  const text = presentPrograms(cards, true, {
    checked: 1,
    fits: [
      {
        repo: 'tipjar',
        verdicts: [
          v('grant', 'after_step', 'needs a live product with real users'),
          v('micro', 'likely', 'looks eligible'),
        ],
      },
    ],
  });
  assert.ok(
    text.startsWith(
      '**Your tipjar fits 2 programs**\n' +
        '- **Micro** · 500 USDC × 20 · closes Oct 14 · looks eligible\n' +
        '- **Grant** · up to $5K · rolling · needs a live product with real users\n\n' +
        '**Also open**\n- **Big Hack** · $100K · closes Oct 12 · long shot\n\n',
    ),
  );
  assert.equal(text.match(/\*\*Grant\*\*/g)!.length, 1);
});

test('no repo fits, or GitHub failed: say so in one line, then the programs', () => {
  const none = presentPrograms(cards, true, { checked: 3, fits: [] });
  assert.match(none, /^None of your 3 public repos fits an open program yet\.\n\n- \*\*Micro\*\*/);
  assert.ok(!none.includes('Also open'));
  const err = presentPrograms(cards, true, { error: 'no such user' });
  assert.match(err, /^Couldn't read your repos: no such user\n\n- /);
});

test('empty list', () => {
  assert.equal(
    presentPrograms([], true),
    'No open programs right now. Check back soon.',
  );
});

test('closing soon: within 3 days only, never negative', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const at = (h: number) => new Date(now.getTime() + h * 3600_000);
  assert.equal(closesInDays(null, now), null);
  assert.equal(closesInDays(at(5), now), 0);
  assert.equal(closesInDays(at(30), now), 1);
  assert.equal(closesInDays(at(80), now), 3);
  assert.equal(closesInDays(at(100), now), null);
  assert.equal(closesInDays(at(-5), now), 0);
});

test('since-last-check line and per-program flags', () => {
  const list: Card[] = [
    { id: 'f', title: 'Fresh', summary: 's', tag: null, each_time: [], is_new: true },
    {
      id: 'u',
      title: 'Urgent',
      summary: 's',
      tag: 'long shot',
      each_time: [],
      closes_in_days: 1,
    },
    { id: 'q', title: 'Quiet', summary: 's', tag: null, each_time: [] },
  ];
  assert.equal(
    presentSinceLastCheck(list),
    'Since you last checked: new: Fresh · Urgent closes in 1 day',
  );
  assert.equal(presentSinceLastCheck([list[2]]), null);
  assert.match(presentSinceLastCheck(list, true)!, /^Heads up: /);
  const text = presentPrograms(list, true);
  assert.match(text, /- \*\*Fresh\*\* · s · new\n/);
  assert.match(text, /- \*\*Urgent\*\* · s · closes in 1 day · long shot/);
});
