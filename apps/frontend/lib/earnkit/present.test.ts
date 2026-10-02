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
      "Pick one and I'll start. I build, deploy, and submit; you approve before anything is sent, and I'll say up front if it needs something only you can give, like a pitch video.",
    ].join('\n\n'),
  );
  assert.ok(!text.includes('Me:'));
});

test('chat-only agent is honest about who builds', () => {
  const text = presentPrograms(cards, false);
  assert.match(text, /can't build or deploy from here/);
  assert.match(text, /coding agent/);
});

const v = (
  program_id: string,
  status: Verdict['status'],
  note: string,
  effort: Verdict['effort'] = 'none',
): Verdict => ({
  program_id,
  program: program_id === 'micro' ? 'Micro' : program_id,
  status,
  missing: [],
  effort,
  note,
});

const tipjar = {
  checked: 1,
  fits: [
    {
      repo: 'tipjar',
      repo_url: 'https://github.com/dev/tipjar',
      verdicts: [
        v(
          'grant',
          'after_step',
          'needs a live product with real users',
          'weeks',
        ),
        v('micro', 'after_step', 'needs a live link', 'minutes'),
      ],
    },
  ],
};

test('repo fits: money headline with the fastest, repo linked, one offer, nothing repeated', () => {
  const text = presentPrograms(cards, true, tipjar);
  assert.equal(
    text,
    [
      'Your repos can enter 2 programs. Fastest: **Micro** with tipjar (needs a live link).',
      '**[tipjar](https://github.com/dev/tipjar)**\n' +
        '- **Micro** · 500 USDC × 20 · closes Oct 14 · needs a live link\n' +
        '- **Grant** · up to $5K · rolling · needs a live product with real users',
      '**Also open**\n- **Big Hack** · $100K · closes Oct 12 · long shot',
      "Want me to start on Micro? I build, deploy, and submit; you approve before anything is sent, and I'll say up front if it needs something only you can give, like a pitch video.",
    ].join('\n\n'),
  );
});

test('working on: shown first with its note, not repeated, and the offer is to keep going', () => {
  const text = presentPrograms(cards, true, tipjar, ['grant']);
  assert.match(
    text,
    /\n\n\*\*You're working on\*\*\n- \*\*Grant\*\* · up to \$5K · rolling · needs a live product with real users\n\n/,
  );
  assert.equal(text.match(/\*\*Grant\*\*/g)!.length, 1);
  assert.match(text, /Want me to keep going on Grant\?/);
  const onFastest = presentPrograms(cards, true, tipjar, ['micro']);
  assert.match(
    onFastest,
    /^Your repos can enter 2 programs\.\n\n\*\*You're working on\*\*/,
  );
});

test('no repo fits, or GitHub failed: say so in one line, then the programs', () => {
  const none = presentPrograms(cards, true, { checked: 3, fits: [] });
  assert.match(
    none,
    /^None of your 3 repos fits an open program yet\.\n\n- \*\*Micro\*\*/,
  );
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
    {
      id: 'f',
      title: 'Fresh',
      summary: 's',
      tag: null,
      each_time: [],
      is_new: true,
    },
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

test('repos that only fit programs already shown are named in one line, not hidden', () => {
  const twin = (repo: string) => ({
    repo,
    repo_url: `https://github.com/dev/${repo}`,
    verdicts: [v('micro', 'after_step', 'needs a live link', 'minutes')],
  });
  const text = presentPrograms(cards, true, {
    checked: 5,
    fits: [twin('a'), twin('b'), twin('c'), twin('d'), twin('e')],
  });
  assert.equal(text.match(/\*\*Micro\*\*/g)!.length, 2); // headline + one line
  assert.match(
    text,
    /More of your repos fit too: b, c, d, \+1 more\. Name one/,
  );
});

test('reported (private) repos have no link', () => {
  const text = presentPrograms(cards, true, {
    checked: 1,
    fits: [
      {
        repo: 'secret',
        repo_url: null,
        verdicts: [v('micro', 'likely', 'looks eligible')],
      },
    ],
  });
  assert.match(text, /\n\n\*\*secret\*\*\n- \*\*Micro\*\*/);
});

test('equally quick fits: the larger known per-winner award is "Fastest" and listed first', () => {
  const priced: Card[] = [
    { ...cards[2], max_award_usd: 500 },
    { ...cards[1], tag: null, max_award_usd: 5000 },
    {
      id: 'unknown',
      title: 'Unknown',
      summary: 'rolling',
      tag: null,
      each_time: [],
    },
  ];
  const repo = (order: string[]) => ({
    checked: 1,
    fits: [
      {
        repo: 'app',
        repo_url: null,
        verdicts: order.map((id) => ({
          ...v(id, 'likely', `ready for ${id}`),
          program: id,
        })),
      },
    ],
  });
  for (const order of [
    ['micro', 'grant', 'unknown'],
    ['unknown', 'micro', 'grant'],
  ]) {
    const text = presentPrograms(priced, true, repo(order));
    assert.match(text, /Fastest: \*\*grant\*\* with app \(ready for grant\)/);
    const lines = text.split('\n').filter((l) => l.startsWith('- **'));
    assert.deepEqual(
      lines.map((l) => l.split('**')[1]),
      ['Grant', 'Micro', 'Unknown'],
    );
  }
  // A quicker fit still wins over a bigger prize.
  const quicker = presentPrograms(priced, true, {
    checked: 1,
    fits: [
      {
        repo: 'app',
        repo_url: null,
        verdicts: [
          {
            ...v('grant', 'after_step', 'deploy to mainnet', 'hours'),
            program: 'grant',
          },
          { ...v('micro', 'likely', 'ready'), program: 'micro' },
        ],
      },
    ],
  });
  assert.match(quicker, /Fastest: \*\*micro\*\*/);
});
