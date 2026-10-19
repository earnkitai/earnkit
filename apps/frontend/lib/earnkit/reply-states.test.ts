import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannedInBench } from './fixtures/banned-words';
import {
  NOT_ON_BENCH, STATE_COPY, VARIANT_COPY, benchReply, nextStepAsk, replyState, stateAsk, type BenchProject, type BenchView,
} from './bench-reply';

process.env.EARNKIT_URL = 'https://earnkit.com';
const P: BenchProject = { key: 'maya/recipes', name: 'Recipes', confirmed: true, live: true, weeks: 3 };
const fund = [{ kind: 'needs' as const, title: 'Base Builder Grants', prize: 'up to $5K', needs: 'for a Base app' }];
const view = (v: Partial<BenchView>): BenchView => {
  const base: BenchView = { state: 'proven', variant: null, project: P, rank: '#1 of 1 builder', streak: 0, handle: 'maya_makes', link: null, fund, due: [], ask: { kind: 'suggest', project_key: P.key, line: 'Want me to suggest one small thing to ship in Recipes this week?' }, held: null, ...v };
  return { ...base, ask: stateAsk(base) ?? base.ask };
};
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const oneLinkOneQuestion = (s: string) => {
  assert.equal(links(s).length, 1, s);
  assert.equal((s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length, 1, s);
  assert.ok(s.trimEnd().endsWith('?'), s);
};

test('9.1 which state', () => {
  assert.equal(replyState({ signedIn: false, project: P, counted: true, streak: 9 }), 'signed_out');
  assert.equal(replyState({ signedIn: true, project: null, counted: false, streak: 0 }), 'no_project');
  assert.equal(replyState({ signedIn: true, project: { ...P, confirmed: false }, counted: false, streak: 0 }), 'not_counted');
  assert.equal(replyState({ signedIn: true, project: P, counted: true, streak: 1 }), 'proven');
  assert.equal(replyState({ signedIn: true, project: P, counted: true, streak: 2 }), 'shipping');
});

test('9.2 the five replies, word for word', () => {
  const out = benchReply(view({ state: 'signed_out', project: null, handle: null, link: 'https://earnkit.com/signin/AAAAAAAAAAAAAAAAAAAAAA' }));
  assert.equal(out, [
    'Where you stand', NOT_ON_BENCH, '',
    'Ways to get funded', 'Base Builder Grants: up to $5K for a Base app.', '',
    'How to move up', "Sign in with X to get your page (one click): https://earnkit.com/signin/AAAAAAAAAAAAAAAAAAAAAA\nWant me to put your work on the Bench once you're in?",
  ].join('\n'));
  oneLinkOneQuestion(out);
  const none = benchReply(view({ state: 'no_project', project: null }));
  assert.ok(none.startsWith(`Where you stand\n${NOT_ON_BENCH}\nYour page: https://earnkit.com/maya_makes`));
  assert.ok(none.endsWith("What's your GitHub, or a link to something you've made?"));
  oneLinkOneQuestion(none);
  const unc = benchReply(view({ state: 'not_counted', project: { ...P, confirmed: false }, link: 'https://earnkit.com/github/verify?n=abc' }));
  assert.ok(unc.includes("Recipes isn't counted yet.\nYour page: earnkit.com/maya_makes"));
  assert.ok(unc.endsWith("Install the read-only EarnKit app on it (one click): https://earnkit.com/github/verify?n=abc\nWant me to count it once that's done?"));
  oneLinkOneQuestion(unc);
  const proven = benchReply(view({ state: 'proven' }));
  assert.ok(proven.includes('Recipes is on the Bench: #1 of 1 builder.\nYour page: https://earnkit.com/maya_makes'));
  oneLinkOneQuestion(proven);
  const ship = benchReply(view({ state: 'shipping', streak: 3 }));
  assert.ok(ship.includes('Recipes is on the Bench: #1 of 1 builder. 3 weeks in a row.'));
  oneLinkOneQuestion(ship);
  assert.ok(benchReply(view({ state: 'proven', rank: null })).includes('Recipes is on the Bench.\n'));
});

test('9.3 variants of not counted: taken, copy, a link only, the App off', () => {
  const p = { ...P, confirmed: false };
  for (const [variant, stand, question] of [
    ['taken', 'Recipes is already on the Bench under another account.', 'Want to use a different project?'],
    ['copy', "Recipes is a copy of someone else's project. Use your own.", 'Want to use a different project?'],
    ['no_repo', "Recipes isn't counted yet.", 'Where does Recipes live on GitHub?'],
    ['app_off', "Recipes isn't counted yet.", 'Want me to suggest one small thing to ship in Recipes this week?'],
  ] as const) {
    const out = benchReply(view({ state: 'not_counted', variant, project: p }));
    assert.ok(out.includes(`${stand}\nYour page: https://earnkit.com/maya_makes`), variant);
    assert.ok(out.endsWith(question), variant);
    oneLinkOneQuestion(out);
  }
});

test('9.4 money always shows; with nothing open it says so', () => {
  assert.match(benchReply(view({ state: 'proven', fund: [] })), /Ways to get funded\nNo program is open right now\. I'll look again next week\./);
});

test('9.5 a held question replaces the state question (still one)', () => {
  const out = benchReply(view({ state: 'proven', held: 'Did Recipes win anything in Base Builder Grants?' }));
  assert.ok(out.endsWith('Did Recipes win anything in Base Builder Grants?'));
  oneLinkOneQuestion(out);
});

test('9.6 the next step: the best fit, then a community round, then online, then one small thing (never kept away)', () => {
  const enter = { kind: 'enter' as const, project_key: P.key, program_id: 'base', line: 'Want me to prepare an entry for Base Builder Grants?' };
  const coin = { kind: 'coin' as const, project_key: P.key, line: 'Want to open a community round for Recipes? I\'ll launch $RCP on tokens.fun and you get 40% of its trading fees.' };
  assert.equal(nextStepAsk({ project: P, enter, coin, canHost: true, declined: [] }), enter);
  assert.equal(nextStepAsk({ project: P, enter, coin, canHost: true, declined: ['enter:maya/recipes'] }), coin);
  assert.equal(nextStepAsk({ project: { ...P, live: false }, enter: null, coin: null, canHost: true, declined: [] }).kind, 'go_live');
  assert.equal(nextStepAsk({ project: P, enter: null, coin: null, canHost: false, declined: ['suggest:maya/recipes'] }).kind, 'suggest');
});

test('9.7 the copy table: plain words, no em dash, no raise', () => {
  const lines = [
    STATE_COPY.signed_out.stand(), STATE_COPY.signed_out.ask('https://x'), STATE_COPY.signed_out.retry(), STATE_COPY.no_project.ask(), STATE_COPY.not_counted.stand('A'),
    STATE_COPY.not_counted.ask('https://x'), STATE_COPY.proven.stand('A', '#1 of 2 builders'), STATE_COPY.shipping.stand('A', null, 4),
    ...Object.values(VARIANT_COPY).flatMap((v) => [v.stand('A'), v.ask('A')]),
  ];
  for (const l of lines) {
    assert.doesNotMatch(l, /\u2013/, l);
    assert.doesNotMatch(l, /\u2014/, l);
    assert.deepEqual(bannedInBench(l, ['EarnKit', 'GitHub']), [], l);
  }
});

test('9.7b D6: a taken project still names the open programs (never "No program is open" while some are)', () => {
  const out = benchReply(view({ state: 'not_counted', variant: 'taken', project: { ...P, confirmed: false } }));
  assert.ok(out.includes('Ways to get funded\nBase Builder Grants: up to $5K for a Base app.'), out);
  assert.doesNotMatch(out, /No program is open/);
});

test('9.7c D5: no page to name (X off): the money and one question, no link at all', () => {
  const out = benchReply(view({ state: 'no_project', project: null, handle: null }));
  assert.equal(links(out).length, 0, out);
  assert.match(out, /Ways to get funded/);
  assert.ok(out.endsWith("What's your GitHub, or a link to something you've made?"));
});

test('9.5b a held question in place of the install question: the page is then the one link', () => {
  const out = benchReply(view({ state: 'not_counted', project: { ...P, confirmed: false }, link: 'https://earnkit.com/github/verify?n=abc', held: 'Did Recipes win anything in Base Builder Grants?' }));
  assert.ok(out.includes('Your page: https://earnkit.com/maya_makes'), out);
  oneLinkOneQuestion(out);
});

test('9.5c fix round 1: signed out, the sign-in question wins over a held one', () => {
  const out = benchReply(view({ state: 'signed_out', project: null, handle: null, link: 'https://earnkit.com/signin/AAAAAAAAAAAAAAAAAAAAAA', held: 'Did Recipes win anything in Base Builder Grants?' }));
  assert.ok(out.endsWith("Want me to put your work on the Bench once you're in?"), out);
  assert.doesNotMatch(out, /Did Recipes win/);
  oneLinkOneQuestion(out);
});
