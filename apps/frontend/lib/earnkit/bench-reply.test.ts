import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHER_PROJECT_ASK, SUGGEST_ASK, grantsAsk,
  NO_OFFER_LINE, START_ASK, benchBuildAsk, buildingNowLine, pageLine, CONFIRMED_LINE,
  NO_PROJECT_LINE, benchReply, buildAsk, chooseAsk, copyLine, enterAsk, privateLine, takenLine, goLiveAsk, onBenchLine, type BenchAsk, type BenchView,
} from './bench-reply';

const RECIPE = { key: 'maya/recipes', name: 'Recipe planner', confirmed: true, live: true, weeks: 6 };

test('8.1 spec 2a, word for word', () => {
  const v: BenchView = {
    project: RECIPE, rank: 'top 18% of builders', claimed: true, handle: 'maya_makes',
    fund: [{ kind: 'fits', title: 'Avalanche Team1 Mini Grants', prize: 'up to $10K', when: 'open all year' }],
    ask: { kind: 'grants', project_key: 'maya/recipes', line: grantsAsk('Recipe planner') },
  };
  assert.equal(benchReply(v), [
    'Where you stand',
    'Recipe planner is on the Bench: top 18% of builders, 6 weeks shipping.',
    '',
    'Ways to get funded',
    "Avalanche Team1 Mini Grants pays up to $10K and fits Recipe planner; it's open all year.",
    '',
    'How to move up',
    'Want me to find grants that fit Recipe planner?',
  ].join('\n'));
});

test('8.2 spec 2a not counted yet (v2.14 T7: no claim ask)', () => {
  // v2.14 spec 2: a project not counted yet says so (the App's install is how it counts).
  assert.equal(privateLine('Recipe planner'), "Recipe planner isn't counted yet.");
  const v: BenchView = { project: { ...RECIPE, confirmed: false }, rank: null, claimed: false, handle: null, fund: [], ask: null };
  assert.equal(benchReply(v), ['Where you stand', privateLine('Recipe planner')].join('\n'));
  assert.equal(benchReply({ ...v, branch: 'private' }).split('\n')[1], privateLine('Recipe planner'));
  assert.equal(benchReply({ ...v, branch: 'taken' }).split('\n')[1], takenLine('Recipe planner'));
  assert.equal(benchReply({ ...v, branch: 'copy' }).split('\n')[1], copyLine('Recipe planner'));
  const unsigned = benchReply({ ...v, project: RECIPE });
  assert.equal(unsigned.split('\n')[1], CONFIRMED_LINE('Recipe planner'));
  assert.doesNotMatch(unsigned, /claim/i);
});

test('8.3 spec 2b, word for word', () => {
  const v: BenchView = {
    project: null, rank: null, claimed: false, handle: null,
    fund: [{ kind: 'idea', who: 'Arc', prize: 'up to $10K', for: 'payment apps' }, { kind: 'idea', who: 'Base', prize: 'up to $5K', for: 'a live app' }],
    ask: { kind: 'build', project_key: null, line: buildAsk('a tip jar on Arc') },
  };
  assert.equal(benchReply(v), [
    'Where you stand',
    "You're not on the Bench yet.",
    '',
    'Ways to get funded',
    'Arc pays up to $10K for payment apps. Base pays up to $5K for a live app.',
    '',
    'How to move up',
    "It takes a few minutes and I'll ask you one or two things. Want me to build a tip jar on Arc and put it online?",
  ].join('\n'));
  // v2.13.3 (3): the stand line alone; the ask leads with existing work (bench-find).
  assert.equal(NO_PROJECT_LINE, "You're not on the Bench yet.");
});

test('8.4 the stand line without a rank, without weeks, with one week', () => {
  assert.equal(onBenchLine('A', null, 6), 'A is on the Bench, 6 weeks shipping.');
  assert.equal(onBenchLine('A', '#3 of 12 builders', 0), 'A is on the Bench: #3 of 12 builders.');
  assert.equal(onBenchLine('A', null, 0), 'A is on the Bench.');
  assert.equal(onBenchLine('A', 'top 4% of builders', 1), 'A is on the Bench: top 4% of builders, 1 week shipping.');
});

test('8.5 the last line asks the first that applies, in the spec\'s order', () => {
  const coin: BenchAsk = { kind: 'coin', project_key: 'k', line: 'raise?' };
  const enter: BenchAsk = { kind: 'enter', project_key: 'k', program_id: 'p', line: enterAsk('Base Builder Grants') };
  const base = { project: RECIPE, canHost: true, coin, enter, declined: [] as string[] };
  assert.equal(chooseAsk({ ...base, project: null })?.kind, 'start', '1. no project: existing work (v2.14 A18: never a build)');
  // v2.13.3 owner ruling A: the best fit's entry, else a community round (the coin), before the Bench's own steps.
  assert.equal(chooseAsk({ ...base, project: { ...RECIPE, live: false } })?.kind, 'enter', 'A: the best fit first');
  assert.equal(chooseAsk({ ...base, project: { ...RECIPE, live: false }, enter: null })?.kind, 'coin', 'A: else a community round');
  const none = { ...base, coin: null, enter: null };
  assert.deepEqual(chooseAsk({ ...none, project: { ...RECIPE, live: false } }), { kind: 'go_live', project_key: 'maya/recipes', line: goLiveAsk('Recipe planner') }, '2. not live');
  // v2.14 spec 3: the ship log writes itself: no posting yes and no week's-post ask, ever.
  assert.equal(chooseAsk(none)?.kind, 'grants', 'nothing pending: the fallback');
  assert.equal(chooseAsk({ ...none, project: { ...RECIPE, confirmed: false } })?.kind, 'grants');
  assert.equal(chooseAsk({ ...base, enter: null })?.kind, 'coin');
  assert.equal(chooseAsk({ ...base, declined: ['enter:maya/recipes'] })?.kind, 'coin', 'a no keeps the entry away 30 days');
});

// ---- v2.13.1 O2

test('O2.1 B1: "Pick something to build" only with the offer that follows; the starter build with no program; no ask, the plain line', () => {
  const none: BenchView = { project: null, rank: null, claimed: true, handle: 'maya', fund: [], ask: null };
  assert.equal(benchReply(none), ['Where you stand', NO_OFFER_LINE].join('\n'));
  assert.doesNotMatch(benchReply(none), /Pick something/);
  assert.equal(benchBuildAsk('a tip jar'), "Want me to build a tip jar and put it online, so you're on the Bench today?");
  const offer = benchReply({ ...none, ask: { kind: 'build', project_key: null, program_id: 'earnkit-bench', line: benchBuildAsk('a tip jar') } });
  assert.equal(offer, ['Where you stand', NO_PROJECT_LINE, '', 'How to move up', benchBuildAsk('a tip jar')].join('\n'));
});

test('O2.3 B4: while a build is in progress the reply is only the building line (no funding, no ask)', () => {
  const v: BenchView = {
    project: null, rank: null, claimed: true, handle: 'maya', building: 'Podcast Tips',
    fund: [{ kind: 'idea', who: 'Arc', prize: 'up to $500', for: 'payment apps' }], ask: { kind: 'build', project_key: null, line: buildAsk('a tip jar on Arc') },
  };
  assert.equal(buildingNowLine('Podcast Tips'), "Building Podcast Tips. I'll be back with the live link.");
  assert.equal(benchReply(v), ['Where you stand', buildingNowLine('Podcast Tips')].join('\n'));
});

test('O2.5 once claimed, the page link right after the stand line', () => {
  const v: BenchView = { project: RECIPE, rank: null, claimed: true, handle: 'maya_makes', page: 'https://earnkit.com/maya_makes', fund: [], ask: null };
  assert.deepEqual(benchReply(v).split('\n').slice(1, 3), [onBenchLine('Recipe planner', null, 6), 'Your page: https://earnkit.com/maya_makes']);
  assert.equal(pageLine('https://earnkit.com/x'), 'Your page: https://earnkit.com/x');
  assert.match(benchReply({ ...v, project: { ...RECIPE, confirmed: false }, branch: 'private' }), /^Your page: https:\/\/earnkit\.com\/maya_makes$/m);
  assert.match(benchReply({ ...v, project: null }), /^Your page: https:\/\/earnkit\.com\/maya_makes$/m);
});

test('O2.8 honest build copy: never "you won\'t have to do anything"', () => {
  for (const line of [buildAsk('a tip jar on Arc'), goLiveAsk('Recipe planner'), benchBuildAsk('a tip jar')]) assert.doesNotMatch(line, /won't have to do anything/);
  assert.equal(buildAsk('a tip jar on Arc'), "It takes a few minutes and I'll ask you one or two things. Want me to build a tip jar on Arc and put it online?");
});

test('O2.9 a project being checked is asked the fallback, never nothing (v2.14 spec 3: no updates yes)', () => {
  const base = { canHost: false, coin: null, enter: null, declined: [] as string[] };
  const p = { ...RECIPE, confirmed: false };
  assert.equal(chooseAsk({ ...base, project: p })?.kind, 'grants', 'the fallback, never nothing');
});

test('O2 fix round 1 (ruling 3): every reply ends with one question, in each state', () => {
  const base = { canHost: false, coin: null, enter: null, declined: [] as string[] };
  // A confirmed project with nothing pending: grants that fit.
  assert.deepEqual(chooseAsk({ ...base, project: RECIPE }), { kind: 'grants', project_key: 'maya/recipes', line: grantsAsk('Recipe planner') });
  assert.equal(grantsAsk('Recipe planner'), 'Want me to find grants that fit Recipe planner?');
  // The coin step still comes first when nothing earlier applies (the fallback is left out for that check).
  assert.equal(chooseAsk({ ...base, project: RECIPE, fallback: false }), null);
  // No project and nothing to build: v2.13.3 ruling A, existing work and money it can win (the owner's line, no question mark).
  const none = chooseAsk({ ...base, project: null });
  assert.deepEqual(none, { kind: 'start', project_key: null, line: START_ASK });
  assert.equal(benchReply({ project: null, rank: null, claimed: true, handle: 'm', fund: [], ask: none }), ['Where you stand', NO_OFFER_LINE, '', 'How to move up', START_ASK].join('\n'));
  assert.equal(SUGGEST_ASK, 'Want me to suggest something small you could build this week?');
  // The branch never showed, or another person holds it: a different project (never an entry).
  const p = { ...RECIPE, confirmed: false };
  const enter: BenchAsk = { kind: 'enter', project_key: 'maya/recipes', program_id: 'p', line: enterAsk('X') };
  assert.deepEqual(chooseAsk({ ...base, project: p, other: true, enter, canHost: true }), { kind: 'other_project', project_key: 'maya/recipes', line: OTHER_PROJECT_ASK });
  assert.equal(OTHER_PROJECT_ASK, 'Want to use a different project?');
});
