import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentPrograms, type Card } from './present';

const cards: Card[] = [
  {
    title: 'Big Hack',
    summary: '$100K · closes Oct 12',
    tag: 'long shot',
    each_time: ['a pitch video'],
  },
  {
    title: 'Grant',
    summary: 'up to $5K · rolling',
    tag: 'needs a live product',
    each_time: [],
  },
  {
    title: 'Micro',
    summary: '500 USDC × 20 · closes Oct 14',
    tag: null,
    each_time: [],
  },
];

test('coding agent: approve-only programs first, one-time setup never listed per program', () => {
  const text = presentPrograms(cards, true);
  assert.ok(
    text.startsWith(
      '**Micro**: 500 USDC × 20 · closes Oct 14\nMe: build, deploy, submit · You: approve\n',
    ),
  );
  assert.match(
    text,
    /\*\*Big Hack\*\*: \$100K · closes Oct 12 · long shot\nMe: build, deploy, submit · You: approve, plus a pitch video/,
  );
  assert.ok(!text.includes('DoraHacks'));
  assert.match(
    text,
    /\*\*Grant\*\*.*\nMe: fill in and submit the application · You: approve/,
  );
  assert.match(text, /one quick setup/);
});

test('chat-only agent is honest about who builds', () => {
  const text = presentPrograms(cards, false);
  assert.match(
    text,
    /Me: the plan and every answer · You: build, deploy, submit/,
  );
  assert.ok(!text.includes('Me: build, deploy, submit'));
  assert.match(text, /coding agent/);
  assert.match(
    text,
    /\*\*Grant\*\*.*\nMe: every answer · You: paste and submit/,
  );
});

test('empty list', () => {
  assert.equal(
    presentPrograms([], true),
    'No open programs right now. Check back soon.',
  );
});
