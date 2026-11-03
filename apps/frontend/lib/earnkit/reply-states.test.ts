import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mondayOpener } from './weekly-moment';
import { bannedInBench } from './fixtures/banned-words';
import {
  INTRO_LINE, MOMENT_ADDED, SHIP_ASK, STATE_COPY, VARIANT_COPY, applyAsk, benchReply, connectAsk, introWhat, pickRepoAsk, replyState, stateAsk,
  type BenchProject, type BenchView,
} from './bench-reply';

process.env.EARNKIT_URL = 'https://earnkit.com';
const P: BenchProject = { key: 'maya/recipes', name: 'Recipes', confirmed: true, live: true, weeks: 3 };
const view = (v: Partial<BenchView>): BenchView => {
  const base: BenchView = { state: 'ranked', variant: null, project: P, rank: '#1 of 10 builders', streak: 2, target: null, handle: 'maya_makes', link: null, fund: [], due: [], ask: { kind: 'suggest', project_key: P.key, line: '' }, held: null, ...v };
  return { ...base, ask: stateAsk(base) };
};
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
/** Task 16: at most one https link and exactly one question in every reply. */
const oneQuestion = (s: string, link = true) => {
  assert.equal(links(s).length, link ? 1 : 0, s);
  assert.equal(questions(s), 1, s);
};

test('9.1 which state (R16a: four states; proven and shipping are one, ranked)', () => {
  assert.equal(replyState({ signedIn: false, project: P, counted: true }), 'signed_out');
  assert.equal(replyState({ signedIn: true, project: null, counted: false }), 'no_project');
  assert.equal(replyState({ signedIn: true, project: { ...P, confirmed: false }, counted: false }), 'not_counted');
  assert.equal(replyState({ signedIn: true, project: P, counted: true }), 'ranked');
});

test('9.2 the four replies (Task 16 copy)', () => {
  const link = 'https://earnkit.com/signin/AAAAAAAAAAAAAAAAAAAAAA';
  const out = benchReply(view({ state: 'signed_out', project: null, handle: null, link }));
  assert.equal(out, [INTRO_LINE, '', introWhat(null), '', 'Setup takes about a minute:', `1. Sign in with X: ${link}`, '2. Connect your code', '3. Add your wallet', '', 'Done with step 1?'].join('\n'));
  oneQuestion(out);
  // v3.1 cold read: "You're in" is the first reply's only (welcome); later replies go straight to the step.
  const none = benchReply({ ...view({ state: 'no_project', project: null }), welcome: true });
  assert.equal(none, "You're in, @maya_makes. Really glad you're here.\n\nWhat's your GitHub, or a link to something you've made?");
  assert.equal(benchReply(view({ state: 'no_project', project: null })), "What's your GitHub, or a link to something you've made?");
  oneQuestion(none, false);
  const verify = 'https://earnkit.com/github/verify?n=abc';
  const unc = benchReply({ ...view({ state: 'not_counted', project: { ...P, confirmed: false }, link: verify }), welcome: true });
  assert.equal(unc, `You're in, @maya_makes. Really glad you're here.\n\n${pickRepoAsk(verify, false)}`);
  oneQuestion(unc);
  const ranked = benchReply(view({ state: 'ranked', fund: [{ kind: 'fits', title: 'Base Builder Grants', amount: '$5,000', when: 'rolling' }] }));
  assert.equal(ranked, ['Recipes · #1 of 10 builders · 2 weeks in a row', 'You qualify for the Base Builder Grants, up to $5,000.', '', 'Shipping this week keeps your 2-week streak and lifts your score.', '', SHIP_ASK].join('\n'));
  oneQuestion(ranked, false);
  // Under RANK_MIN_POOL no rank phrase is given.
  assert.ok(benchReply(view({ state: 'ranked', rank: null })).startsWith('Recipes · 2 weeks in a row\n'));
});

test('9.3 variants of not counted: taken, copy, a link only, the App off', () => {
  const p = { ...P, confirmed: false };
  for (const [variant, stand, question] of [
    ['taken', 'Recipes is already on the leaderboard under another account.', 'Want to use a different project?'],
    ['copy', "Recipes is a copy of someone else's project. If you made it from a template, make a copy in your own account, then connect that.", 'Want to use a different project?'],
    // v3.1 cold read: never "<Project> isn't counted yet.".
    ['no_repo', null, 'Where does Recipes live on GitHub?'],
    ['app_off', null, 'Want me to suggest one small thing to ship in Recipes this week?'],
  ] as const) {
    const out = benchReply(view({ state: 'not_counted', variant, project: p }));
    // v4.7: the suggest ask's why line is its own paragraph just before the question.
    assert.equal(out, variant === 'app_off' ? `Programs fund builders who ship every week.\n\n${question}` : stand ? `${stand}\n${question}` : question, variant);
    oneQuestion(out, false);
  }
});

test('9.4 a ranked project with no fit has no money line (Task 16: no "Ways to get funded")', () => {
  assert.equal(benchReply(view({ state: 'ranked', fund: [] })), `Recipes · #1 of 10 builders · 2 weeks in a row\n\nShipping this week keeps your 2-week streak and lifts your score.\n\n${SHIP_ASK}`);
  assert.doesNotMatch(benchReply(view({ state: 'no_project', project: null, fund: [] })), /Ways to get funded|No program is open/);
});

test('9.5 a held question replaces the state step (still one, no points line)', () => {
  const out = benchReply(view({ state: 'ranked', held: 'Did Recipes win anything in Base Builder Grants?' }));
  assert.equal(out, 'Recipes · #1 of 10 builders · 2 weeks in a row\nDid Recipes win anything in Base Builder Grants?');
  oneQuestion(out, false);
});

test('9.6 R8: the ranked step is to ship (never an entry, a coin or going live)', () => {
  for (const project of [P, { ...P, live: false }]) assert.deepEqual(stateAsk({ state: 'ranked', variant: null, project, link: null }), { kind: 'ship', project_key: P.key, line: SHIP_ASK });
  const out = benchReply(view({ state: 'ranked', project: { ...P, live: false } }));
  assert.doesNotMatch(out, /coin|token|community round|prepare an entry|online/i);
});

test('9.6b v3.1 spec 3.2, v4.0 Task 11: the apply step (no backing offer); the Best fit shows only when ranked', () => {
  const best = { program_id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling', why: 'You deployed on Base.', codes: null };
  const apply = { program_id: best.program_id, title: best.title, amount: '$5,000', when: null };
  // v4.0 Task 11: no backing step; the apply step is the ranked ask.
  const next = benchReply({ ...view({ state: 'ranked' }), best, ask: stateAsk({ state: 'ranked', variant: null, project: P, link: null, apply }) });
  assert.ok(next.includes(applyAsk(best.title, '$5,000', null)), 'then the apply step: ' + next);
  for (const state of ['signed_out', 'no_project', 'not_counted'] as const) assert.doesNotMatch(benchReply({ ...view({ state }), best }), /Base Builder Grant Program/, state);
});

test('9.7 the copy table: plain words, no em dash, no raise', () => {
  const lines = [
    STATE_COPY.signed_out.ask('https://x'), STATE_COPY.signed_out.retry(), STATE_COPY.no_project.noApp(), STATE_COPY.no_project.ask('https://x', false),
    STATE_COPY.not_counted.ask('https://x', false), SHIP_ASK, MOMENT_ADDED, INTRO_LINE, introWhat({ org: 'Base', amount: '$5,000', chain: 'Base' }), connectAsk('earnkit.com/a'),
    mondayOpener('Maya', null, { shipped: true }), applyAsk('A', '$5,000', null),
    ...Object.values(VARIANT_COPY).flatMap((v) => [v.stand('A'), v.ask('A')]),
  ].filter((l): l is string => l !== null);
  for (const l of lines) {
    assert.doesNotMatch(l, /–/, l);
    assert.doesNotMatch(l, /—/, l);
    assert.deepEqual(bannedInBench(l, ['EarnKit', 'GitHub']), [], l);
  }
});

test('9.7c D5: no page to name (X off): one question, no link at all', () => {
  const out = benchReply(view({ state: 'no_project', project: null, handle: null }));
  assert.equal(out, "What's your GitHub, or a link to something you've made?");
});

test('9.5b a held question in place of the install question: no link, no points line', () => {
  const out = benchReply(view({ state: 'not_counted', project: { ...P, confirmed: false }, link: 'https://earnkit.com/github/verify?n=abc', held: 'Did Recipes win anything in Base Builder Grants?' }));
  assert.equal(out, 'Did Recipes win anything in Base Builder Grants?');
});

test('9.5c fix round 1: signed out, the sign-in question wins over a held one', () => {
  const out = benchReply(view({ state: 'signed_out', project: null, handle: null, link: 'https://earnkit.com/signin/AAAAAAAAAAAAAAAAAAAAAA', held: 'Did Recipes win anything in Base Builder Grants?' }));
  assert.ok(out.endsWith('Done with step 1?'), out);
  assert.doesNotMatch(out, /Did Recipes win/);
  oneQuestion(out);
});
