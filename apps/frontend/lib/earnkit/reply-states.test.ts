import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannedInBench } from './fixtures/banned-words';
import {
  INTRO_LINE, MOMENT_ASK, SHIP_ASK, STATE_COPY, VARIANT_COPY, applyAsk, benchReply, connectAsk, introWhat, momentHead, pickRepoAsk, replyState, stateAsk,
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
  assert.equal(out, [INTRO_LINE, introWhat(null), '', `Step 1 of 2: sign in with X (one click): ${link}`, 'Done?'].join('\n'));
  oneQuestion(out);
  const none = benchReply(view({ state: 'no_project', project: null }));
  assert.equal(none, "You're in, @maya_makes.\nWhat's your GitHub, or a link to something you've made?");
  oneQuestion(none, false);
  const verify = 'https://earnkit.com/github/verify?n=abc';
  const unc = benchReply(view({ state: 'not_counted', project: { ...P, confirmed: false }, link: verify }));
  assert.equal(unc, `You're in, @maya_makes.\n${pickRepoAsk(verify)}`);
  oneQuestion(unc);
  const ranked = benchReply(view({ state: 'ranked', fund: [{ kind: 'fits', title: 'Base Builder Grants', amount: '$5,000', when: 'rolling' }] }));
  assert.equal(ranked, ['Recipes · #1 of 10 builders · 2 weeks in a row', 'You qualify for the Base Builder Grants, up to $5,000.', SHIP_ASK, 'Ship code this week: up to +100 points'].join('\n'));
  oneQuestion(ranked, false);
  // Under RANK_MIN_POOL no rank phrase is given.
  assert.ok(benchReply(view({ state: 'ranked', rank: null })).startsWith('Recipes · 2 weeks in a row\n'));
});

test('9.3 variants of not counted: taken, copy, a link only, the App off', () => {
  const p = { ...P, confirmed: false };
  for (const [variant, stand, question] of [
    ['taken', 'Recipes is already on the leaderboard under another account.', 'Want to use a different project?'],
    ['copy', "Recipes is a copy of someone else's project. If you made it from a template, make a copy in your own account, then connect that.", 'Want to use a different project?'],
    ['no_repo', "Recipes isn't counted yet.", 'Where does Recipes live on GitHub?'],
    ['app_off', "Recipes isn't counted yet.", 'Want me to suggest one small thing to ship in Recipes this week?'],
  ] as const) {
    const out = benchReply(view({ state: 'not_counted', variant, project: p }));
    assert.equal(out, `${stand}\n${question}`, variant);
    oneQuestion(out, false);
  }
});

test('9.4 a ranked project with no fit has no money line (Task 16: no "Ways to get funded")', () => {
  assert.equal(benchReply(view({ state: 'ranked', fund: [] })), `Recipes · #1 of 10 builders · 2 weeks in a row\n${SHIP_ASK}\nShip code this week: up to +100 points`);
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

test('9.6b v3.1 spec 3.2: the apply step comes before backing; the Best fit shows only when ranked', () => {
  const best = { program_id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling', why: 'You deployed on Base.', codes: null };
  const apply = { program_id: best.program_id, title: best.title, amount: '$5,000', when: null };
  const out = benchReply({ ...view({ state: 'ranked' }), best, ask: stateAsk({ state: 'ranked', variant: null, project: P, link: null, apply, backing: 'Want to open backing for Recipes?' }) });
  assert.ok(out.includes(applyAsk(best.title, '$5,000', null)), 'apply before backing: ' + out);
  oneQuestion(out, false);
  for (const state of ['signed_out', 'no_project', 'not_counted'] as const) assert.doesNotMatch(benchReply({ ...view({ state }), best }), /Base Builder Grant Program/, state);
});

test('9.7 the copy table: plain words, no em dash, no raise', () => {
  const lines = [
    STATE_COPY.signed_out.ask('https://x'), STATE_COPY.signed_out.retry(), STATE_COPY.no_project.noApp(), STATE_COPY.no_project.ask('https://x'), STATE_COPY.not_counted.stand('A'),
    STATE_COPY.not_counted.ask('https://x'), SHIP_ASK, MOMENT_ASK, INTRO_LINE, introWhat({ org: 'Base', amount: '$5,000', chain: 'Base' }), connectAsk(3, 'earnkit.com/a'),
    momentHead({ week: 2, place: 'now', rank: 3, points: 70 }), applyAsk('A', '$5,000', null),
    ...Object.values(VARIANT_COPY).flatMap((v) => [v.stand('A'), v.ask('A')]),
  ];
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
  assert.equal(out, "Recipes isn't counted yet.\nDid Recipes win anything in Base Builder Grants?");
});

test('9.5c fix round 1: signed out, the sign-in question wins over a held one', () => {
  const out = benchReply(view({ state: 'signed_out', project: null, handle: null, link: 'https://earnkit.com/signin/AAAAAAAAAAAAAAAAAAAAAA', held: 'Did Recipes win anything in Base Builder Grants?' }));
  assert.ok(out.endsWith('Done?'), out);
  assert.doesNotMatch(out, /Did Recipes win/);
  oneQuestion(out);
});
