process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHER_PROJECT_ASK, SUGGEST_ASK, UPDATES_ASK_JOINING, grantsAsk,
  NO_OFFER_LINE, benchBuildAsk, buildingNowLine, pageLine, showsClaimLink,
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
    "Want me to build a tip jar on Arc and put it online? It takes a few minutes and I'll ask you one or two things.",
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
  assert.equal(chooseAsk({ ...base, project: null, build: null })?.kind, 'suggest', 'O2 fix round 1: nothing to build, the suggestion');
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

// ---- v2.13.1 O2

test('O2.1 B1: "Pick something to build" only with the offer that follows; the starter build with no program; no ask, the plain line', () => {
  const none: BenchView = { project: null, rank: null, claimed: true, handle: 'maya', claimLink: null, fund: [], ask: null };
  assert.equal(benchReply(none), ['Where you stand', NO_OFFER_LINE].join('\n'));
  assert.doesNotMatch(benchReply(none), /Pick something/);
  assert.equal(benchBuildAsk('a tip jar'), "Want me to build a tip jar and put it online? You'll be on the Bench today.");
  const offer = benchReply({ ...none, ask: { kind: 'build', project_key: null, program_id: 'earnkit-bench', line: benchBuildAsk('a tip jar') } });
  assert.equal(offer, ['Where you stand', NO_PROJECT_LINE, '', 'How to move up', benchBuildAsk('a tip jar')].join('\n'));
});

test('O2.2 B2: the claim link shows on every reply while unclaimed, project or not', () => {
  const link = 'https://earnkit.com/claim/abcdefghijkl';
  const v: BenchView = { project: null, rank: null, claimed: false, handle: null, claimLink: link, fund: [], ask: null };
  assert.equal(benchReply(v).split('\n')[2], `Claim your page with X: ${link}`);
  assert.equal(showsClaimLink(v), true);
  assert.equal(showsClaimLink({ ...v, claimed: true }), false);
  assert.equal((benchReply(v).match(/https:\/\//g) ?? []).length, 1, 'the only link');
});

test('O2.3 B4: while a build is in progress the reply is only the building line (no funding, no ask)', () => {
  const v: BenchView = {
    project: null, rank: null, claimed: true, handle: 'maya', claimLink: null, building: 'Podcast Tips',
    fund: [{ kind: 'idea', who: 'Arc', prize: 'up to $500', for: 'payment apps' }], ask: { kind: 'build', project_key: null, line: buildAsk('a tip jar on Arc') },
  };
  assert.equal(buildingNowLine('Podcast Tips'), "Building Podcast Tips. I'll be back with the live link.");
  assert.equal(benchReply(v), ['Where you stand', buildingNowLine('Podcast Tips')].join('\n'));
});

test('O2.5 once claimed, the page link right after the stand line', () => {
  const v: BenchView = { project: RECIPE, rank: null, claimed: true, handle: 'maya_makes', claimLink: null, page: 'https://earnkit.com/maya_makes', fund: [], ask: null };
  assert.deepEqual(benchReply(v).split('\n').slice(1, 3), [onBenchLine('Recipe planner', null, 6), 'Your page: https://earnkit.com/maya_makes']);
  assert.equal(pageLine('https://earnkit.com/x'), 'Your page: https://earnkit.com/x');
  assert.match(benchReply({ ...v, project: { ...RECIPE, confirmed: false }, branch: 'checking' }), /^Your page: https:\/\/earnkit\.com\/maya_makes$/m);
  assert.match(benchReply({ ...v, project: null }), /^Your page: https:\/\/earnkit\.com\/maya_makes$/m);
});

test('O2.8 honest build copy: never "you won\'t have to do anything"', () => {
  for (const line of [buildAsk('a tip jar on Arc'), goLiveAsk('Recipe planner'), benchBuildAsk('a tip jar')]) assert.doesNotMatch(line, /won't have to do anything/);
  assert.equal(buildAsk('a tip jar on Arc'), "Want me to build a tip jar on Arc and put it online? It takes a few minutes and I'll ask you one or two things.");
});

test('O2.9 a project being checked is asked the next Bench step (the updates yes), never a grant last', () => {
  const base = { canHost: false, updatesOn: false, postedThisWeek: false, scheduled: false, coin: null, build: null, enter: null, declined: [] as string[] };
  const p = { ...RECIPE, confirmed: false };
  assert.equal(chooseAsk({ ...base, project: p })?.kind, 'grants', 'not joining: the fallback, never nothing');
  assert.deepEqual(chooseAsk({ ...base, project: p, joining: true }), { kind: 'updates', project_key: 'maya/recipes', line: UPDATES_ASK_JOINING });
  assert.equal(chooseAsk({ ...base, project: p, joining: true, updatesOn: true })?.kind, 'grants', 'post_update waits for confirmation');
});

test('O2 fix round 1 (ruling 3): every reply ends with one question, in each state', () => {
  const base = { canHost: false, updatesOn: true, postedThisWeek: true, scheduled: true, coin: null, build: null, enter: null, declined: [] as string[] };
  // A confirmed project with nothing pending: the week's update when posting is on, else grants that fit.
  assert.deepEqual(chooseAsk({ ...base, project: RECIPE }), { kind: 'post_update', project_key: 'maya/recipes', line: POST_UPDATE_ASK });
  assert.deepEqual(chooseAsk({ ...base, project: RECIPE, updatesOn: false, declined: ['updates:maya/recipes'] }), { kind: 'grants', project_key: 'maya/recipes', line: grantsAsk('Recipe planner') });
  assert.equal(grantsAsk('Recipe planner'), 'Want me to find grants that fit Recipe planner?');
  // The coin step still comes first when nothing earlier applies (the fallback is left out for that check).
  assert.equal(chooseAsk({ ...base, project: RECIPE, fallback: false }), null);
  // No project and nothing to build: the suggestion, after NO_OFFER_LINE.
  const none = chooseAsk({ ...base, project: null });
  assert.deepEqual(none, { kind: 'suggest', project_key: null, line: SUGGEST_ASK });
  assert.equal(benchReply({ project: null, rank: null, claimed: true, handle: 'm', claimLink: null, fund: [], ask: none }), ['Where you stand', NO_OFFER_LINE, '', 'How to move up', SUGGEST_ASK].join('\n'));
  // The branch never showed, or another person holds it: a different project (never an entry).
  const p = { ...RECIPE, confirmed: false };
  const enter: BenchAsk = { kind: 'enter', project_key: 'maya/recipes', program_id: 'p', line: enterAsk('X') };
  assert.deepEqual(chooseAsk({ ...base, project: p, other: true, enter, canHost: true }), { kind: 'other_project', project_key: 'maya/recipes', line: OTHER_PROJECT_ASK });
  assert.equal(OTHER_PROJECT_ASK, 'Want to use a different project?');
  // needs_agent is joining: the updates yes, without "on the Bench".
  assert.deepEqual(chooseAsk({ ...base, project: p, updatesOn: false, joining: true }), { kind: 'updates', project_key: 'maya/recipes', line: UPDATES_ASK_JOINING });
  assert.doesNotMatch(UPDATES_ASK_JOINING, /Bench/);
});
