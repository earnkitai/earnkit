import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHER_PROJECT_ASK, SUGGEST_ASK, UPDATES_ASK_JOINING, grantsAsk,
  NO_OFFER_LINE, START_ASK, benchBuildAsk, buildingNowLine, pageLine, showsClaimLink, CONFIRMED_LINE, claimAsk, claimAskLine, claimQuestion,
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
    'Want me to post what you ship here every week, to keep your streak going on the Bench?',
  ].join('\n'));
});

test('8.2 spec 2a while confirming, and with the X claim still to do', () => {
  assert.equal(confirmingLine('Recipe planner'), "Recipe planner joins the Bench as soon as I've confirmed it's yours (a minute or two).");
  const link = 'earnkit.com/claim/abcdefghijkl';
  const claim = { kind: 'claim' as const, project_key: null, line: claimAsk(link, 'Recipe planner') };
  const v: BenchView = { project: { ...RECIPE, confirmed: false }, rank: null, claimed: false, handle: null, claimLink: link, fund: [], ask: claim };
  // v2.13.4 (spec 2): the X claim is the one ask, last: the link, then one yes or no.
  assert.equal(benchReply(v), ['Where you stand', confirmingLine('Recipe planner'), '', 'How to move up', claimAskLine(link), claimQuestion('Recipe planner')].join('\n'));
  // v2.13.1 O1: the proof branch, then (never showed in the hour) the plain line.
  assert.equal(benchReply({ ...v, branch: 'checking' }).split('\n')[1], checkingBranchLine('Recipe planner'));
  assert.equal(benchReply({ ...v, branch: 'failed' }).split('\n')[1], cantShowLine('Recipe planner'));
  const unclaimed = benchReply({ ...v, project: RECIPE });
  assert.equal(unclaimed.split('\n')[1], CONFIRMED_LINE('Recipe planner'));
  assert.ok(unclaimed.endsWith(claimAsk(link, 'Recipe planner')));
  // No claim ask (a held question, or declined): no claim link at all.
  assert.doesNotMatch(benchReply({ ...v, ask: null }), /claim/);
});

test('8.3 spec 2b, word for word', () => {
  const v: BenchView = {
    project: null, rank: null, claimed: false, handle: null, claimLink: null,
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
  const base = { project: RECIPE, canHost: true, updatesOn: true, postedThisWeek: true, scheduled: true, coin, enter, declined: [] as string[] };
  assert.equal(chooseAsk({ ...base, project: null })?.kind, 'start', '1. no project: existing work (v2.14 A18: never a build)');
  // v2.13.3 owner ruling A: the best fit's entry, else a community round (the coin), before the Bench's own steps.
  assert.equal(chooseAsk({ ...base, project: { ...RECIPE, live: false } })?.kind, 'enter', 'A: the best fit first');
  assert.equal(chooseAsk({ ...base, project: { ...RECIPE, live: false }, enter: null })?.kind, 'coin', 'A: else a community round');
  const none = { ...base, coin: null, enter: null };
  assert.deepEqual(chooseAsk({ ...none, project: { ...RECIPE, live: false } }), { kind: 'go_live', project_key: 'maya/recipes', line: goLiveAsk('Recipe planner') }, '2. not live');
  assert.deepEqual(chooseAsk({ ...none, updatesOn: false }), { kind: 'updates', project_key: 'maya/recipes', line: UPDATES_ASK }, '3. updates not on');
  assert.equal(chooseAsk({ ...none, updatesOn: false, project: { ...RECIPE, confirmed: false } })?.kind, 'grants', 'asked only once confirmed');
  assert.deepEqual(chooseAsk({ ...none, postedThisWeek: false, scheduled: false }), { kind: 'post_update', project_key: 'maya/recipes', line: POST_UPDATE_ASK }, '4.');
  assert.equal(chooseAsk({ ...none, postedThisWeek: true, scheduled: true })?.kind, 'grants', 'nothing pending: the fallback');
  assert.equal(chooseAsk({ ...base, enter: null, updatesOn: false, declined: ['updates:maya/recipes'] })?.kind, 'coin');
  assert.equal(chooseAsk({ ...base, declined: ['enter:maya/recipes'] })?.kind, 'coin', 'a no keeps the entry away 30 days');
});

// ---- v2.13.1 O2

test('O2.1 B1: "Pick something to build" only with the offer that follows; the starter build with no program; no ask, the plain line', () => {
  const none: BenchView = { project: null, rank: null, claimed: true, handle: 'maya', claimLink: null, fund: [], ask: null };
  assert.equal(benchReply(none), ['Where you stand', NO_OFFER_LINE].join('\n'));
  assert.doesNotMatch(benchReply(none), /Pick something/);
  assert.equal(benchBuildAsk('a tip jar'), "Want me to build a tip jar and put it online, so you're on the Bench today?");
  const offer = benchReply({ ...none, ask: { kind: 'build', project_key: null, program_id: 'earnkit-bench', line: benchBuildAsk('a tip jar') } });
  assert.equal(offer, ['Where you stand', NO_PROJECT_LINE, '', 'How to move up', benchBuildAsk('a tip jar')].join('\n'));
});

test('O2.2 B2 (v2.13.4: the claim is the ask): the claim link shows only as the one ask while unclaimed, project or not', () => {
  const link = 'https://earnkit.com/claim/abcdefghijkl';
  const v: BenchView = { project: null, rank: null, claimed: false, handle: null, claimLink: link, fund: [], ask: { kind: 'claim', project_key: null, line: claimAsk(link, null) } };
  assert.deepEqual(benchReply(v).split('\n').slice(-2), [claimAskLine(link), claimQuestion(null)]);
  assert.equal(showsClaimLink(v), true);
  assert.equal(showsClaimLink({ ...v, ask: null }), false);
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
  assert.equal(buildAsk('a tip jar on Arc'), "It takes a few minutes and I'll ask you one or two things. Want me to build a tip jar on Arc and put it online?");
});

test('O2.9 a project being checked is asked the next Bench step (the updates yes), never a grant last', () => {
  const base = { canHost: false, updatesOn: false, postedThisWeek: false, scheduled: false, coin: null, enter: null, declined: [] as string[] };
  const p = { ...RECIPE, confirmed: false };
  assert.equal(chooseAsk({ ...base, project: p })?.kind, 'grants', 'not joining: the fallback, never nothing');
  assert.deepEqual(chooseAsk({ ...base, project: p, joining: true }), { kind: 'updates', project_key: 'maya/recipes', line: UPDATES_ASK_JOINING });
  assert.equal(chooseAsk({ ...base, project: p, joining: true, updatesOn: true })?.kind, 'grants', 'post_update waits for confirmation');
});

test('O2 fix round 1 (ruling 3): every reply ends with one question, in each state', () => {
  const base = { canHost: false, updatesOn: true, postedThisWeek: true, scheduled: true, coin: null, enter: null, declined: [] as string[] };
  // A confirmed project with nothing pending: the week's update when posting is on, else grants that fit.
  // v2.13.1 O3 (carried from O2's review): this week's update already posted: never offer to post it (that would overwrite it).
  assert.deepEqual(chooseAsk({ ...base, project: RECIPE }), { kind: 'grants', project_key: 'maya/recipes', line: grantsAsk('Recipe planner') });
  assert.deepEqual(chooseAsk({ ...base, project: RECIPE, postedThisWeek: false }), { kind: 'post_update', project_key: 'maya/recipes', line: POST_UPDATE_ASK }, 'scheduled but not posted yet');
  assert.equal(chooseAsk({ ...base, project: RECIPE, postedThisWeek: false, declined: ['post_update:maya/recipes'] })?.kind, 'grants');
  assert.deepEqual(chooseAsk({ ...base, project: RECIPE, updatesOn: false, declined: ['updates:maya/recipes'] }), { kind: 'grants', project_key: 'maya/recipes', line: grantsAsk('Recipe planner') });
  assert.equal(grantsAsk('Recipe planner'), 'Want me to find grants that fit Recipe planner?');
  // The coin step still comes first when nothing earlier applies (the fallback is left out for that check).
  assert.equal(chooseAsk({ ...base, project: RECIPE, fallback: false }), null);
  // No project and nothing to build: v2.13.3 ruling A, existing work and money it can win (the owner's line, no question mark).
  const none = chooseAsk({ ...base, project: null });
  assert.deepEqual(none, { kind: 'start', project_key: null, line: START_ASK });
  assert.equal(benchReply({ project: null, rank: null, claimed: true, handle: 'm', claimLink: null, fund: [], ask: none }), ['Where you stand', NO_OFFER_LINE, '', 'How to move up', START_ASK].join('\n'));
  assert.equal(SUGGEST_ASK, 'Want me to suggest something small you could build this week?');
  // The branch never showed, or another person holds it: a different project (never an entry).
  const p = { ...RECIPE, confirmed: false };
  const enter: BenchAsk = { kind: 'enter', project_key: 'maya/recipes', program_id: 'p', line: enterAsk('X') };
  assert.deepEqual(chooseAsk({ ...base, project: p, other: true, enter, canHost: true }), { kind: 'other_project', project_key: 'maya/recipes', line: OTHER_PROJECT_ASK });
  assert.equal(OTHER_PROJECT_ASK, 'Want to use a different project?');
  // needs_agent is joining: the updates yes, without "on the Bench".
  assert.deepEqual(chooseAsk({ ...base, project: p, updatesOn: false, joining: true }), { kind: 'updates', project_key: 'maya/recipes', line: UPDATES_ASK_JOINING });
  assert.doesNotMatch(UPDATES_ASK_JOINING, /Bench/);
});
