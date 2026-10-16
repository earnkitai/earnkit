process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_PROJECT_LINE, POST_UPDATE_ASK, UPDATES_ASK, benchReply, buildAsk, cantShowLine, checkingBranchLine, chooseAsk, confirmingLine, enterAsk, goLiveAsk, onBenchLine, type BenchAsk, type BenchView,
} from './bench-reply';

const RECIPE = { key: 'maya/recipes', name: 'Recipe planner', confirmed: true, live: true, weeks: 6 };

test('8.1 spec 2a, word for word', () => {
  const v: BenchView = {
    project: RECIPE, rank: 'top 18% of builders', claimed: true, handle: 'maya_makes', claimLink: null,
    fund: [{ kind: 'fits', title: 'Avalanche Team1 Mini Grants', prize: 'up to $10K', when: 'open all year' }],
    ask: { kind: 'updates', project_key: 'maya/recipes', line: UPDATES_ASK },
  };
  assert.equal(benchReply(v), [
    'Where you stand',
    'Recipe planner is on the Bench: top 18% of builders, 6 weeks shipping.',
    '',
    'Ways to get funded',
    "Avalanche Team1 Mini Grants pays up to $10K and fits Recipe planner; it's open all year.",
    '',
    'How to move up',
    'Want me to post what you ship here every week? It keeps your streak going on the Bench.',
  ].join('\n'));
});

test('8.2 spec 2a while confirming, and with the X claim still to do', () => {
  assert.equal(confirmingLine('Recipe planner'), "Recipe planner joins the Bench as soon as I've confirmed it's yours (a minute or two).");
  const v: BenchView = { project: { ...RECIPE, confirmed: false }, rank: null, claimed: false, handle: null, claimLink: 'earnkit.com/claim/abcdefghijkl', fund: [], ask: null };
  assert.equal(benchReply(v), ['Where you stand', confirmingLine('Recipe planner'), 'Claim your page with X: earnkit.com/claim/abcdefghijkl'].join('\n'));
  // v2.13.1 O1: the proof branch, then (never showed in the hour) the plain line.
  assert.equal(benchReply({ ...v, branch: 'checking' }).split('\n')[1], checkingBranchLine('Recipe planner'));
  assert.equal(benchReply({ ...v, branch: 'failed' }).split('\n')[1], cantShowLine('Recipe planner'));
  const unclaimed = benchReply({ ...v, project: RECIPE });
  assert.match(unclaimed, /Recipe planner goes on the Bench once you claim your page with X: earnkit\.com\/claim\/abcdefghijkl$/m);
});

test('8.3 spec 2b, word for word', () => {
  const v: BenchView = {
    project: null, rank: null, claimed: false, handle: null, claimLink: null,
    fund: [{ kind: 'idea', who: 'Arc', prize: 'up to $10K', for: 'payment apps' }, { kind: 'idea', who: 'Base', prize: 'up to $5K', for: 'a live app' }],
    ask: { kind: 'build', project_key: null, line: buildAsk('a tip jar on Arc') },
  };
  assert.equal(benchReply(v), [
    'Where you stand',
    "You're not on the Bench yet. Pick something to build and you're on it today.",
    '',
    'Ways to get funded',
    'Arc pays up to $10K for payment apps. Base pays up to $5K for a live app.',
    '',
    'How to move up',
    "Want me to build a tip jar on Arc and put it online? It takes a few minutes and you won't have to do anything.",
  ].join('\n'));
  assert.equal(NO_PROJECT_LINE, "You're not on the Bench yet. Pick something to build and you're on it today.");
});

test('8.4 the stand line without a rank, without weeks, with one week', () => {
  assert.equal(onBenchLine('A', null, 6), 'A is on the Bench, 6 weeks shipping.');
  assert.equal(onBenchLine('A', '#3 of 12 builders', 0), 'A is on the Bench: #3 of 12 builders.');
  assert.equal(onBenchLine('A', null, 0), 'A is on the Bench.');
  assert.equal(onBenchLine('A', 'top 4% of builders', 1), 'A is on the Bench: top 4% of builders, 1 week shipping.');
});

test('8.5 the last line asks the first that applies, in the spec\'s order', () => {
  const coin: BenchAsk = { kind: 'coin', project_key: 'k', line: 'raise?' };
  const build: BenchAsk = { kind: 'build', project_key: null, line: buildAsk('a tip jar on Arc') };
  const enter: BenchAsk = { kind: 'enter', project_key: 'k', program_id: 'p', line: enterAsk('Base Builder Grants') };
  const base = { project: RECIPE, canHost: true, updatesOn: true, postedThisWeek: true, scheduled: true, coin, build, enter, declined: [] as string[] };
  assert.equal(chooseAsk({ ...base, project: null })?.kind, 'build', '1. no project');
  assert.equal(chooseAsk({ ...base, project: null, build: null }), null);
  assert.deepEqual(chooseAsk({ ...base, project: { ...RECIPE, live: false } }), { kind: 'go_live', project_key: 'maya/recipes', line: goLiveAsk('Recipe planner') }, '2. not live');
  assert.equal(chooseAsk({ ...base, project: { ...RECIPE, live: false }, canHost: false })?.kind, 'coin', 'not live but nothing can host it');
  assert.deepEqual(chooseAsk({ ...base, updatesOn: false }), { kind: 'updates', project_key: 'maya/recipes', line: UPDATES_ASK }, '3. updates not on');
  assert.equal(chooseAsk({ ...base, updatesOn: false, project: { ...RECIPE, confirmed: false } })?.kind, 'coin', 'asked only once confirmed');
  assert.deepEqual(chooseAsk({ ...base, postedThisWeek: false, scheduled: false }), { kind: 'post_update', project_key: 'maya/recipes', line: POST_UPDATE_ASK }, '4.');
  assert.equal(chooseAsk({ ...base, postedThisWeek: false, scheduled: true })?.kind, 'coin', 'an agent that schedules is not asked');
  assert.equal(chooseAsk(base)?.kind, 'coin', '5. a coin moment');
  assert.equal(chooseAsk({ ...base, coin: null })?.kind, 'enter', '6. the best program');
  assert.equal(chooseAsk({ ...base, updatesOn: false, declined: ['updates:maya/recipes'] })?.kind, 'coin', 'a no keeps it away 30 days');
});
