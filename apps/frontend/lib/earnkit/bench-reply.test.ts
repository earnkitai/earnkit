import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHER_PROJECT_ASK, STATE_COPY, benchReply, enterAsk, goLiveAsk, nextStepAsk, shipAsk, type BenchAsk, type BenchView,
} from './bench-reply';

// v2.14 T9: the five states' replies and their copy are pinned in reply-states.test.ts; these keep the
// v2.13 money lines and the order of the next step.
process.env.EARNKIT_URL = 'https://earnkit.com';
const RECIPE = { key: 'maya/recipes', name: 'Recipe planner', confirmed: true, live: true, weeks: 6 };

test('8.1 spec 2a, word for word (v2.14: proven, the page the one link)', () => {
  const v: BenchView = {
    state: 'proven', variant: null, project: RECIPE, rank: 'Top 18% of builders this week', streak: 1, handle: 'maya_makes', link: null,
    score: 62, why: 'Code in 7 of the last 12 weeks, 3 of the last 4. Ship code this week to add up to 14 points.',
    fund: [{ kind: 'fits', title: 'Avalanche Team1 Mini Grants', prize: 'up to $10K', when: 'open all year' }], due: [],
    ask: { kind: 'enter', project_key: 'maya/recipes', program_id: 'avax', line: enterAsk('Avalanche Team1 Mini Grants') }, held: null,
  };
  assert.equal(benchReply(v), [
    'Where you stand',
    'Recipe planner: Shipping 62 · Top 18% of builders this week.',
    'Code in 7 of the last 12 weeks, 3 of the last 4. Ship code this week to add up to 14 points.',
    'Your page: https://earnkit.com/maya_makes',
    '',
    'Ways to get funded',
    "Avalanche Team1 Mini Grants pays up to $10K and fits Recipe planner; it's open all year.",
    '',
    'How to move up',
    'Want me to prepare an entry for Avalanche Team1 Mini Grants?',
  ].join('\n'));
});

test('8.4 the stand line is the score line (R16c), with and without a rank, and with a streak', () => {
  assert.equal(STATE_COPY.proven.stand('A', 0, null), 'A: Shipping 0.');
  assert.equal(STATE_COPY.proven.stand('A', 40, '#3 of 12 builders this week'), 'A: Shipping 40 · #3 of 12 builders this week.');
  assert.equal(STATE_COPY.shipping.stand('A', 72, 'Top 4% of builders this week', 5), 'A: Shipping 72 · Top 4% of builders this week. 5 weeks in a row.');
});

test('8.5 the last line asks the first that applies, in the spec\'s order', () => {
  const coin: BenchAsk = { kind: 'coin', project_key: 'k', line: 'community round?' };
  const enter: BenchAsk = { kind: 'enter', project_key: 'k', program_id: 'p', line: enterAsk('Base Builder Grants') };
  const base = { project: RECIPE, canHost: true, coin, enter, declined: [] as string[] };
  // v2.13.3 owner ruling A: the best fit's entry, else a community round (the coin), before the Bench's own steps.
  assert.equal(nextStepAsk({ ...base, project: { ...RECIPE, live: false } }).kind, 'enter', 'A: the best fit first');
  assert.equal(nextStepAsk({ ...base, project: { ...RECIPE, live: false }, enter: null }).kind, 'coin', 'A: else a community round');
  const none = { ...base, coin: null, enter: null };
  assert.deepEqual(nextStepAsk({ ...none, project: { ...RECIPE, live: false } }), { kind: 'go_live', project_key: 'maya/recipes', line: goLiveAsk('Recipe planner') }, 'not live');
  // v2.14 A16: one small thing to ship is the last fallback, never kept away.
  assert.deepEqual(nextStepAsk(none), { kind: 'suggest', project_key: 'maya/recipes', line: shipAsk('Recipe planner') });
  assert.equal(nextStepAsk({ ...none, declined: ['suggest:maya/recipes', 'go_live:maya/recipes'], project: { ...RECIPE, live: false } }).kind, 'suggest');
  assert.equal(nextStepAsk({ ...base, declined: ['enter:maya/recipes'] }).kind, 'coin', 'a no keeps the entry away 30 days');
});

test('O2.8 honest copy: never "you won\'t have to do anything"; a different project, in plain words', () => {
  assert.doesNotMatch(goLiveAsk('Recipe planner'), /won't have to do anything/);
  assert.equal(OTHER_PROJECT_ASK, 'Want to use a different project?');
  assert.equal(shipAsk('Recipe planner'), 'Want me to suggest one small thing to ship in Recipe planner this week?');
});
