import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOMENT_ASK, OTHER_PROJECT_ASK, POST_ASK, SHIP_ASK, applyAsk, eventHead, awardAmount, benchReply, fitBar, upcomingShown, connectStanding, namesAccount, qualifyLine, replyState, shipAsk, standingLine, stateAsk,
  type ApplyPick, type BenchView, type BestFit, type EventPost,
} from './bench-reply';

// v3.1 Task 16: the owner-approved copy (2026-10-21), word for word, for each reply benchReply writes (steps 1, 2, 3, 5
// and 7; step 4 is the connect yes, v31-reply-copy.test.ts; step 6 the draft, v31-draft.test.ts). Each has at most one
// https link and exactly one question.
process.env.EARNKIT_URL = 'https://earnkit.com';
const RECIPE = { key: 'maya/recipes', name: 'Recipe planner', confirmed: true, live: true, weeks: 6 };
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const oneAsk = (s: string) => {
  assert.ok(links(s).length <= 1, s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(s, /—/);
};
const BASE: BestFit = { program_id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling', why: 'You deployed on Base.', codes: null };
const ranked = (o: Partial<BenchView> = {}): BenchView => ({
  state: 'ranked', variant: null, project: RECIPE, rank: '#3 of 40 builders', streak: 4, target: null, handle: 'maya', link: null,
  fund: [], due: [], ask: { kind: 'ship', project_key: RECIPE.key, line: SHIP_ASK }, held: null, ...o,
});

test('Task 16 step 1: signed out, the first reply after install', () => {
  const link = 'https://earnkit.com/signin/abc';
  const v: BenchView = {
    state: 'signed_out', variant: null, project: null, rank: null, streak: 0, target: null, handle: null, link, fund: [], due: [], held: null,
    ask: stateAsk({ state: 'signed_out', variant: null, project: null, link }), open: { org: 'Base', amount: '$5,000', chain: 'Base' },
  };
  const out = benchReply(v);
  assert.equal(out, [
    'EarnKit gets you paid for building.',
    'I read your commits every week, rank you against other builders, and find grants you qualify for. Base pays up to $5,000 for apps on Base.',
    '',
    `Step 1 of 2: sign in with X (one click): ${link}`,
    'Done?',
  ].join('\n'));
  oneAsk(out);
  // With no open grant to name, the sentence is dropped.
  assert.match(benchReply({ ...v, open: null }), /grants you qualify for\.\n\n/);
  // The link couldn't be made: the retry question, no points line.
  const retry = benchReply({ ...v, link: null, ask: stateAsk({ state: 'signed_out', variant: null, project: null, link: null }) });
  assert.ok(retry.endsWith("I couldn't make your sign-in link just now. Want me to try again?"), retry);
  oneAsk(retry);
});

test('Task 16 step 2: signed in with no repo (the picker), and a named repo not counted (its install link)', () => {
  const link = 'https://earnkit.com/github/verify?n=abc';
  const pick: BenchView = {
    state: 'no_project', variant: null, project: null, rank: null, streak: 0, target: null, handle: 'maya', link, fund: [], due: [], held: null,
    ask: stateAsk({ state: 'no_project', variant: null, project: null, link }), welcome: true,
  };
  const want = [
    "You're in, @maya. I find grants your app qualifies for and write the applications.",
    `Connect your app's code on GitHub so I can match it (read-only, one click): ${link}`,
    'Built it in Lovable or Bolt: connect GitHub there first (Lovable: Project settings, Git. Bolt: GitHub icon, top right).',
    'Done?',
  ].join('\n');
  assert.doesNotMatch(want, /points/, '2026-10-22: no points in the first two replies');
  assert.equal(benchReply(pick), want);
  oneAsk(benchReply(pick));
  assert.equal(pick.ask.kind, 'pick_repo');
  const project = { ...RECIPE, confirmed: false };
  const named: BenchView = { ...pick, state: 'not_counted', project, ask: stateAsk({ state: 'not_counted', variant: null, project, link }) };
  assert.equal(named.ask.kind, 'install_app');
  assert.equal(benchReply(named), want);
  // The reply names the account, so find adds no "Signed in as" line above it.
  assert.ok(namesAccount(pick) && namesAccount(named));
  assert.ok(!namesAccount({ ...named, held: 'Did it win?' }));
  // v3.1 cold read: "You're in" only on the first reply after sign-in; later the same step without it.
  const later = { ...pick, welcome: false };
  assert.equal(benchReply(later), want.split('\n').slice(1).join('\n'));
  assert.ok(!namesAccount(later));
});

test('Task 16 step 3: the first ranked reply with weeks to post (connect)', () => {
  const v = ranked({ rank: '#1 of 13 builders', best: BASE, connect: { weeks: 3, points: 90 } });
  v.ask = stateAsk({ ...v, connect: v.connect });
  assert.equal(v.ask.kind, 'connect');
  const out = benchReply(v);
  assert.equal(out, [
    'Recipe planner is on the leaderboard: #1 of 13 builders, 4 weeks in a row.',
    'You qualify for the Base Builder Grant Program, up to $5,000.',
    '',
    'Make your shipping log public on https://earnkit.com/maya so grant teams can see it?',
    '+90 points',
  ].join('\n'));
  oneAsk(out);
  // Under RANK_MIN_POOL (no rank phrase), and with no Best fit.
  assert.equal(benchReply({ ...v, rank: null, best: null }).split('\n\n')[0], 'Recipe planner is on EarnKit: 4 weeks in a row.');
  assert.equal(connectStanding('Kit', null, 1), 'Kit is on EarnKit: 1 week in a row.');
  assert.equal(stateAsk({ ...v, connect: { weeks: 1, points: 30 } }).line, 'Make your shipping log public on https://earnkit.com/maya so grant teams can see it?');
});

test('Task 16 step 5: ranked, no connect pending: the apply step', () => {
  const apply: ApplyPick = { program_id: BASE.program_id, title: BASE.title, amount: '$5,000', when: null };
  const v = ranked({ rank: '#1 of 13 builders', best: BASE });
  v.ask = stateAsk({ ...v, apply });
  const out = benchReply(v);
  assert.equal(out, [
    'Recipe planner · #1 of 13 builders · 4 weeks in a row',
    'Base Builder Grant Program is still open, up to $5,000. I can draft it in a minute.',
    'Want me to?',
    'Ship code this week: up to +100 points',
  ].join('\n'));
  oneAsk(out);
  // A dated program says when it closes; under RANK_MIN_POOL the standing has no rank.
  assert.equal(applyAsk('Apply X', '$5,000', 'Nov 18'), 'Apply X closes Nov 18, up to $5,000. I can draft it in a minute.\nWant me to?');
  assert.equal(benchReply({ ...v, rank: null }).split('\n')[0], 'Recipe planner · 4 weeks in a row');
});

test('Task 16: the ship, backing and held steps keep the layout: standing, money, the one question, the points line', () => {
  const ship = benchReply(ranked({ best: BASE, target: 'Ship code this week to pass #2.' }));
  assert.equal(ship, [
    'Recipe planner · #3 of 40 builders · 4 weeks in a row',
    'You qualify for the Base Builder Grant Program, up to $5,000.',
    SHIP_ASK,
    'Ship code this week to pass #2: up to +100 points',
  ].join('\n'));
  oneAsk(ship);
  // Done this week: the plain points line; no fit: the upcoming program, else no money line.
  const done = benchReply(ranked({ target: 'Done this week.', fund: [{ kind: 'upcoming', title: 'Base Batches 005', prize: 'up to $100K', note: 'Opens in 2027.' }] }));
  assert.equal(done.split('\n').slice(1).join('\n'), `Base Batches 005: up to $100K, not open yet. Opens in 2027.\n${SHIP_ASK}\nShip code this week: up to +100 points`);
  // The Best fit hides the upcoming line; a fit that isn't the Best fit (dated, later) is named instead.
  assert.doesNotMatch(benchReply(ranked({ best: BASE, fund: [{ kind: 'upcoming', title: 'Base Batches 005', prize: 'up to $100K', note: 'x' }] })), /Base Batches/);
  assert.match(benchReply(ranked({ fund: [{ kind: 'fits', title: 'Later Grant', amount: '$10,000', when: 'closes Dec 30' }] })), /\nYou qualify for the Later Grant, up to \$10,000, closes Dec 30\.\n/);
  // Backing: the offer is the question, no points line.
  const offer = 'People can back Recipe planner onchain. Want to open backing for Recipe planner?';
  const backing = benchReply(ranked({ ask: { kind: 'backing', project_key: RECIPE.key, line: offer } }));
  assert.equal(backing, `Recipe planner · #3 of 40 builders · 4 weeks in a row\n${offer}`);
  oneAsk(backing);
  // A held question takes the step's place; no points line.
  const held = benchReply(ranked({ held: 'Did Apply X come back on Recipe planner? applied / accepted / funded / rejected.' }));
  assert.ok(held.endsWith('applied / accepted / funded / rejected.'), held);
  // Earned from $1 on the standing line.
  assert.equal(standingLine('Kit', '#3 of 40 builders', 2, 340.4), 'Kit · #3 of 40 builders · 2 weeks in a row · $340 earned');
  assert.equal(standingLine('Kit', null, 0), 'Kit is on EarnKit.');
});

test('Task 16 step 7, v3.1 one-tap posts: the weekly moment with last week\'s post and its one-tap link; with none, the page; no points', () => {
  const link = 'https://earnkit.com/maya/post/abcdefghij';
  const v = ranked({ moment: { week: 6, place: 'now', rank: 3, post: { text: 'Recipe planner, week 6: added offline mode and fixed several sync bugs.', link } } });
  v.ask = stateAsk({ ...v, share: true });
  assert.deepEqual(v.ask, { kind: 'share', project_key: RECIPE.key, line: MOMENT_ASK });
  const out = benchReply(v);
  assert.equal(out, [
    "Week 6 done:",
    'Your post for X:',
    '"Recipe planner, week 6: added offline mode and fixed several sync bugs."',
    `Post it in one tap: ${link}`,
    'Look right?',
  ].join('\n'));
  oneAsk(out);
  assert.doesNotMatch(out, /points|intent/);
  // Nothing new to say: the page is the one link.
  const none = benchReply({ ...v, moment: { week: 4, place: 'still', rank: 3, post: null } });
  assert.equal(none, "Week 4 done:\nYour page: https://earnkit.com/maya\nLook right?");
  oneAsk(none);
  assert.match(benchReply({ ...v, moment: { week: 0, place: null, rank: 1, post: null } }), /^Last week done:\n/);
});

test('v3.1 one-tap posts: an event\'s post (went live, won, the builder\'s news): its head, the post, the one-tap link, "Want a different version?"', () => {
  const link = 'https://earnkit.com/maya/post/abcdefghij';
  const post: EventPost = { head: 'Recipe planner went live this week.', text: 'Recipe planner is live. 9 weeks from first commit.', link };
  const v = ranked({ post });
  v.ask = stateAsk({ ...v, post, apply: { program_id: 'p', title: 'P', amount: null, when: null } });
  assert.deepEqual(v.ask, { kind: 'post', project_key: RECIPE.key, line: POST_ASK }, 'ahead of apply when benchView offers it');
  const out = benchReply(v);
  assert.equal(out, [
    'Recipe planner went live this week.',
    'Your post for X:',
    '"Recipe planner is live. 9 weeks from first commit."',
    `Post it in one tap: ${link}`,
    'Want a different version?',
  ].join('\n'));
  oneAsk(out);
  const now = new Date('2026-10-22T12:00:00Z');
  assert.equal(eventHead({ moment: 'went_live', input: { name: 'Tally' }, card: { live_at: '2026-10-18T00:00:00Z' } }, now), 'Tally went live this week.');
  assert.equal(eventHead({ moment: 'went_live', input: { name: 'Tally' }, card: { live_at: '2026-10-10T00:00:00Z' } }, now), 'Tally is live.', 'never "this week" when it was not');
  assert.equal(eventHead({ moment: 'won', input: { name: 'Ledgerline', program: 'Base Builder Grant' } }, now), 'Ledgerline won the Base Builder Grant.');
  // Fix round: the profile doesn't show an acceptance or funding; the news is on the page as the update.
  for (const moment of ['accepted', 'funded']) assert.equal(eventHead({ moment, input: { name: 'Kit', program: 'X' } }, now), '', 'no head: the reply starts at "Your post for X"');
  assert.equal(eventHead({ moment: 'news', input: { note: 'x' } }, now), 'Added to your page.');
  assert.equal(eventHead({ moment: 'coin_intro', input: { name: 'Kit' } }, now), 'Backing is open on your page.');
});

test('Task 16, GTM W2: the ranked order is connect, backing, apply, share, ship', () => {
  const backing = 'People can back Recipe planner onchain. Want to open backing for Recipe planner?';
  const apply: ApplyPick = { program_id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: '$5,000', when: null };
  const all = { state: 'ranked' as const, variant: null, project: RECIPE, link: null, share: true, handle: 'maya', connect: { weeks: 3, points: 90 }, backing, apply };
  assert.equal(stateAsk(all).kind, 'connect');
  // GTM W2 (owner: no coin launched is the biggest revenue failure): backing right after connect, above the apply step.
  assert.equal(stateAsk({ ...all, connect: null }).kind, 'backing');
  assert.equal(stateAsk({ ...all, connect: null, backing: null }).kind, 'apply');
  assert.equal(stateAsk({ ...all, connect: null, apply: null, backing: null }).kind, 'share');
  assert.deepEqual(stateAsk({ ...all, connect: null, apply: null, backing: null, share: false }), { kind: 'ship', project_key: RECIPE.key, line: SHIP_ASK });
  assert.equal(replyState({ signedIn: true, project: RECIPE, counted: true }), 'ranked');
});

test('Task 16: an award as the copy names it; the qualify line', () => {
  assert.equal(awardAmount({ max_award_usd: 5000 }), '$5,000');
  assert.equal(awardAmount({ max_award_usd: 500000, investment: true }), '$500,000 investment');
  assert.equal(awardAmount({ max_award_usd: null }), null);
  assert.equal(qualifyLine({ title: 'Open Grants', amount: null, when: 'rolling' }), 'You qualify for the Open Grants.');
});

test('O2.8 honest copy: a different project, in plain words', () => {
  assert.equal(OTHER_PROJECT_ASK, 'Want to use a different project?');
  assert.equal(shipAsk('Recipe planner'), 'Want me to suggest one small thing to ship in Recipe planner this week?');
});

test('GTM W3 never "You qualify" past a condition the builder does not show', () => {
  const a16z = { title: 'a16z speedrun SR008', amount: '$1,000,000 investment', when: 'closes Nov 1' };
  assert.equal(fitBar({ investment: true, tag: 'long shot' }, { live: true }), 'company');
  assert.equal(qualifyLine({ ...a16z, bar: 'company' }), 'Long shot: a16z speedrun SR008, up to $1,000,000 investment, closes Nov 1. It takes a company with a full-time team.');
  assert.equal(fitBar({ tag: 'long shot' }, { live: true }), 'long_shot');
  assert.equal(qualifyLine({ title: 'Monad Metropolis', amount: '$50,000', when: 'rolling', bar: 'long_shot' }), 'Long shot: Monad Metropolis, up to $50,000.');
  assert.equal(fitBar({ tag: 'needs a live product' }, { live: false }), 'needs_live');
  assert.equal(fitBar({ tag: 'needs a live product' }, { live: true }), 'qualify');
  assert.equal(qualifyLine({ ...BASE, bar: 'needs_live' }), 'Base Builder Grant Program, up to $5,000, once your app is live.');
  assert.equal(fitBar({}, { live: true, noUsers: true }), 'needs_users');
  assert.equal(qualifyLine({ ...BASE, bar: 'needs_users' }), 'Base Builder Grant Program, up to $5,000, once you have real users.');
  assert.equal(qualifyLine({ ...BASE, bar: 'qualify' }), 'You qualify for the Base Builder Grant Program, up to $5,000.');
  const reply = benchReply(ranked({ rank: '#1 of 13 builders', best: { ...BASE, ...a16z, program_id: 'a16z-speedrun', bar: 'company' }, connect: { weeks: 2, points: 60 },
    ask: { kind: 'connect', project_key: RECIPE.key, line: 'Post your 2 weeks?' } }));
  assert.doesNotMatch(reply, /You qualify/);
  assert.match(reply, /full-time team/);
});

test('GTM W3 the upcoming line is claimed only where the reply says it', () => {
  const v = ranked({ fund: [{ kind: 'upcoming', title: 'Base Batches 005', prize: 'up to $100K investment', note: 'Opens in November.' }] });
  assert.equal(upcomingShown(v), true);
  assert.match(benchReply(v), /Base Batches 005: up to \$100K investment, not open yet\./);
  assert.equal(upcomingShown({ ...v, ask: { kind: 'apply', project_key: RECIPE.key, line: 'x?' } }), false);
  assert.equal(upcomingShown({ ...v, ask: { kind: 'wallet', project_key: RECIPE.key, line: 'x?' } }), false);
  assert.equal(upcomingShown({ ...v, ask: { kind: 'qualify', project_key: RECIPE.key, line: 'x?' }, qualify: { program_id: 'b', grant: { org: 'Base', amount: '$5,000', chain: 'Base' }, missing: [], steps: ['codes'] } }), false);
  assert.equal(upcomingShown({ ...v, held: 'Did you hear back?' }), true);
});
