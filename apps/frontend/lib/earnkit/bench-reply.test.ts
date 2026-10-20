import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHER_PROJECT_ASK, SHIP_STEP, STATE_COPY, benchReply, fitsLine, noFitLine, replyState, shipAsk, stateAsk, type BenchView,
} from './bench-reply';

// v2.14 T9, R16a: the four states' replies and their copy are pinned in reply-states.test.ts; these keep the
// money lines (R12) and the ranked state's one next step (R8).
process.env.EARNKIT_URL = 'https://earnkit.com';
const RECIPE = { key: 'maya/recipes', name: 'Recipe planner', confirmed: true, live: true, weeks: 6 };

test('8.1 spec 2a, word for word (R8, R12, R16a: ranked, the page the one link, fits with deadline and why; L5: the weekly target)', () => {
  const v: BenchView = {
    state: 'ranked', variant: null, project: RECIPE, rank: 'Top 18% of builders this week', handle: 'maya_makes', link: null,
    score: 62, why: 'Code in 7 of the last 12 weeks, 3 of the last 4.', originality: null,
    target: 'Ship code this week: +14 points, enough to pass #2.', share: null,
    fund: [{ kind: 'fits', title: 'Avalanche Team1 Mini Grants', prize: 'up to $10K', when: 'rolling', why: 'You build on Avalanche.' }], due: [],
    ask: { kind: 'ship', project_key: 'maya/recipes', line: 'Ship code this week: +14 points, enough to pass #2.' }, held: null,
  };
  assert.equal(benchReply(v), [
    'Where you stand',
    'Recipe planner: Shipping 62 · Top 18% of builders this week.',
    'Code in 7 of the last 12 weeks, 3 of the last 4.',
    'Your page: https://earnkit.com/maya_makes',
    '',
    'Ways to get funded',
    'Avalanche Team1 Mini Grants: up to $10K, rolling. You build on Avalanche.',
    '',
    'How to move up',
    'Ship code this week: +14 points, enough to pass #2.',
  ].join('\n'));
});

test('8.4 the stand line is the score line (R16c), with and without a rank; no streak words (R16a: it lives in the score)', () => {
  assert.equal(STATE_COPY.ranked.stand('A', 0, null), 'A: Shipping 0.');
  assert.equal(STATE_COPY.ranked.stand('A', 40, '#3 of 12 builders this week'), 'A: Shipping 40 · #3 of 12 builders this week.');
  assert.equal(STATE_COPY.ranked.stand('A', null, null), 'A is counted. Its Shipping score comes with the next read.');
});

test('8.5 R8, L5, L6: the ranked state\'s one next step is the weekly target (else "Ship this week to climb."); the weekly moment\'s share ask replaces it', () => {
  assert.equal(SHIP_STEP, 'Ship this week to climb.');
  assert.equal(replyState({ signedIn: true, project: RECIPE, counted: true }), 'ranked');
  assert.deepEqual(stateAsk({ state: 'ranked', variant: null, project: RECIPE, link: null }), { kind: 'ship', project_key: 'maya/recipes', line: SHIP_STEP });
  assert.equal(STATE_COPY.ranked.ask(), SHIP_STEP);
  const target = 'Ship code this week: +14 points to hold #1.';
  assert.deepEqual(stateAsk({ state: 'ranked', variant: null, project: RECIPE, link: null, target }), { kind: 'ship', project_key: 'maya/recipes', line: target });
  const share = 'https://x.com/intent/post?text=a';
  assert.deepEqual(stateAsk({ state: 'ranked', variant: null, project: RECIPE, link: share, target, share }),
    { kind: 'share', project_key: 'maya/recipes', line: `Share your week on X: ${share}\nDoes last week look right?` });
});

test('8.6 R12: a fit line names the award, the deadline and why; a ranked project with no fit says so', () => {
  assert.equal(fitsLine('Base Builder Grants', 'up to $5K', 'closes Oct 30', 'You deployed on Base.'), 'Base Builder Grants: up to $5K, closes Oct 30. You deployed on Base.');
  const v: BenchView = {
    state: 'ranked', variant: null, project: RECIPE, rank: null, handle: null, link: null, score: 10, why: null, originality: null, target: null, share: null,
    fund: [], due: [], ask: { kind: 'ship', project_key: RECIPE.key, line: SHIP_STEP }, held: null,
  };
  assert.match(benchReply(v), new RegExp(noFitLine('Recipe planner').replace(/[.]/g, '\\.')));
  const four = Array.from({ length: 4 }, (_, i) => ({ kind: 'fits' as const, title: `P${i}`, prize: '$1K', when: 'rolling', why: 'You build on Base.' }));
  assert.equal(benchReply({ ...v, fund: four }).split('\n').filter((l) => /^P\d:/.test(l)).length, 3, 'at most 3 fits');
});

test('O2.8 honest copy: a different project, in plain words', () => {
  assert.equal(OTHER_PROJECT_ASK, 'Want to use a different project?');
  assert.equal(shipAsk('Recipe planner'), 'Want me to suggest one small thing to ship in Recipe planner this week?');
});
