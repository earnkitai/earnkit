import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD_CHAT_ONLY,
  PUBLIC_TEST_WALLETS,
  buildCheck,
  buildKit,
  buildingLine,
  contextLine,
  freshLeadLine,
  freshPick,
  publicTestWallet,
  twistQuestion,
  type FreshPick,
} from './fresh-build';
import { freshLead, presentFirstMessage, type Card, type FirstMessage } from './present';
import { STARTERS } from './starters';
import { FRESH_ON, TESTED_STARTERS, fileCards, withFreshBuild, withoutFreshBuild } from './fixtures/fresh-build';
import type { Verdict } from './match';

// v2.11 T7 (spec 1): the no-repo lead. A builder with no repo that leads, nothing waiting on
// submission and no users question sees one context line and one small program to build.

const NOW = new Date('2026-10-10T12:00:00Z');
const ARC = 'arc-microgrants';
const CONTEXT = '$1.1M+ in prizes is open right now across 7 programs.';
const ARC_LEAD = 'Arc Microgrants pays 500 USDC and closes in 4 days. A USDC tip page on Arc takes about an hour. Want me to build it?';
const ARC_PLAN =
  'Arc Microgrants pays 500 USDC and closes in 4 days. A coding agent builds the USDC tip page in about an hour. Want the plan?';

const none = { hidden: new Set<string>(), entered: new Set<string>() };
const on = { ...none, deployOn: () => true, hostOn: true, starters: TESTED_STARTERS };
/** Today's catalogue with Arc tagged for the fresh build (programs/arc-microgrants.json carries it since the T6 follow-up). */
const tagged = () => withFreshBuild(fileCards(), [ARC]);
/** The short first reply (v2.10 item 2). */
const short = (m: Partial<FirstMessage>): FirstMessage => ({
  alerts: [], campaigns: [], cards: [], repos: null, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more: false, ...m,
});
const oneQuestion = (s: string) => assert.equal(s.split('?').length - 1, 1, `one question: ${s}`);
const plainCopy = (s: string) => {
  assert.doesNotMatch(s, /—/, 'no em dash');
  assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, 'no emoji');
  assert.doesNotMatch(s, /\b(coin|vault|Clanker)\b/i);
};

test('7.1 today\'s files at 2026-10-10T12:00Z, deploys and hosting on, Arc tagged: the pick is Arc and the reply is exactly the context line and the lead', () => {
  const cards = tagged();
  const pick = freshPick(cards, NOW, on);
  assert.equal(pick?.card.id, ARC);
  assert.equal(pick?.starter.id, 'arc-tipjar');
  assert.equal(contextLine(cards, NOW), CONTEXT);
  assert.equal(freshLeadLine(pick!, NOW, true), ARC_LEAD);
  const reply = presentFirstMessage(short({ cards, fresh: FRESH_ON }));
  assert.equal(reply, `${CONTEXT}\n${ARC_LEAD}`);
  // Repos that fit nothing: the same two lines (no "No repo fits yet").
  assert.equal(presentFirstMessage(short({ cards, repos: { checked: 2, fits: [] }, fresh: FRESH_ON })), `${CONTEXT}\n${ARC_LEAD}`);
  // At most 2 lines, one question, plain copy.
  assert.equal(reply.split('\n').length, 2);
  oneQuestion(reply);
  plainCopy(reply);
  assert.deepEqual(freshLead(short({ cards, fresh: FRESH_ON })), { card: pick!.card, starter: pick!.starter, canBuild: true });
});

test('7.2 fail closed: deploys off, hosting off for a starter with no Pages fallback, an untested starter, an unknown starter or no program carrying fresh_build gives no pick, and the reply is the v2.10 line byte for byte', () => {
  const cards = tagged();
  const v210 = presentFirstMessage(short({ cards }));
  assert.equal(v210, '$1.1M+ is open. Want the 3 easiest?');
  const v210Repos = presentFirstMessage(short({ cards, repos: { checked: 2, fits: [] } }));
  assert.equal(v210Repos, 'No repo fits yet. $1.1M+ is open; want the 3 easiest?');
  const cases: [string, Card[], FirstMessage['fresh']][] = [
    ['deploys off', cards, { ...FRESH_ON, deployOn: () => false }],
    ['deploys off on Arc only', cards, { ...FRESH_ON, deployOn: (c) => c !== 'arc' }],
    ['hosting off, no Pages fallback', cards, { ...FRESH_ON, hostOn: false, starters: { 'arc-tipjar': { ...TESTED_STARTERS['arc-tipjar'], pages_fallback: false } } }],
    ['an untested starter', cards, { ...FRESH_ON, starters: { 'arc-tipjar': { ...STARTERS['arc-tipjar'], tested_at: null } } }],
    ['an unknown starter', withFreshBuild(fileCards(), [ARC], 'nope'), FRESH_ON],
    ['a prototype key as the starter', withFreshBuild(fileCards(), [ARC], 'toString'), FRESH_ON],
    ['no program carrying fresh_build', withoutFreshBuild(fileCards()), FRESH_ON],
    ['no fresh settings at all', cards, undefined],
  ];
  for (const [label, c, fresh] of cases) {
    assert.equal(freshLead(short({ cards: c, fresh })), undefined, label);
    assert.equal(presentFirstMessage(short({ cards: c, fresh })), v210, label);
    assert.equal(presentFirstMessage(short({ cards: c, repos: { checked: 2, fits: [] }, fresh })), v210Repos, label);
  }
  assert.equal(freshPick(cards, NOW, { ...on, deployOn: () => false }), undefined);
  const noPages = { 'arc-tipjar': { ...TESTED_STARTERS['arc-tipjar'], pages_fallback: false } };
  assert.equal(freshPick(cards, NOW, { ...on, hostOn: false, starters: noPages }), undefined);
  // v2.11 T9 (plan S10): with hosting off, a starter whose site can go on GitHub Pages is still picked.
  assert.equal(TESTED_STARTERS['arc-tipjar'].pages_fallback, true);
  assert.equal(freshPick(cards, NOW, { ...on, hostOn: false })?.card.id, ARC, 'hosting off: the Pages fallback');
  // T6 follow-up: the real registry is tested (2026-10-11), so the switches alone keep it closed.
  assert.equal(STARTERS['arc-tipjar'].tested_at, '2026-10-11');
  assert.equal(freshPick(cards, NOW, { ...none, deployOn: () => false, hostOn: true }), undefined, 'STARTERS by default, deploys off');
  assert.equal(freshPick(cards, NOW, { ...none, deployOn: () => true, hostOn: false })?.starter.id, 'arc-tipjar', 'STARTERS by default, hosting off: the Pages fallback');
  // Review M6: a test more than 30 days old offers nothing (tested 2026-09-10: 30 days at Oct 10).
  const aged = (tested_at: string) => ({ ...on, starters: { 'arc-tipjar': { ...TESTED_STARTERS['arc-tipjar'], tested_at } } });
  assert.equal(freshPick(cards, NOW, aged('2026-09-10'))?.card.id, ARC, 'exactly 30 days');
  assert.equal(freshPick(cards, NOW, aged('2026-09-09')), undefined, '31 days');
  // Review M1: a repo read error or a repo EarnKit can't see keeps today's reply.
  for (const repos of [{ error: 'rate limited' }, { checked: 1, fits: [], unseen: [{ name: 'secret', full_name: 'alice/secret' }] }] as FirstMessage['repos'][]) {
    assert.equal(freshLead(short({ cards, repos, fresh: FRESH_ON })), undefined, JSON.stringify(repos));
    assert.equal(presentFirstMessage(short({ cards, repos, fresh: FRESH_ON })), presentFirstMessage(short({ cards, repos })));
  }
});

test('7.3 under 24 hours left never qualifies; 1 to 2 days reads "closes tomorrow"; exactly 24 hours and exactly 14 days qualify', () => {
  const cards = tagged();
  assert.equal(freshPick(cards, new Date('2026-10-14T05:00:00Z'), on), undefined);
  const tomorrow = new Date('2026-10-13T05:00:00Z');
  const pick = freshPick(cards, tomorrow, on)!;
  assert.equal(
    freshLeadLine(pick, tomorrow, true),
    'Arc Microgrants pays 500 USDC and closes tomorrow. A USDC tip page on Arc takes about an hour. Want me to build it?',
  );
  const ends = new Date('2026-10-15T03:59:00Z').getTime();
  const DAY = 24 * 60 * 60 * 1000;
  assert.equal(freshPick(cards, new Date(ends - DAY), on)?.card.id, ARC, 'exactly 24 hours');
  assert.equal(freshPick(cards, new Date(ends - DAY + 1), on), undefined, 'a millisecond under');
  assert.equal(freshPick(cards, new Date(ends - 14 * DAY), on)?.card.id, ARC, 'exactly 14 days');
  assert.equal(freshPick(cards, new Date(ends - 14 * DAY - 1), on), undefined, 'over 14 days');
  assert.match(freshLeadLine(freshPick(cards, new Date(ends - 14 * DAY), on)!, new Date(ends - 14 * DAY), true), /closes in 14 days/);
  // After it closes: nothing, and the reply is the v2.10 line.
  const after = new Date('2026-10-16T00:00:00Z');
  assert.equal(freshPick(cards, after, on), undefined);
});

test('7.4 never a long shot, a "needs a live product" program, an investment, a Hard program, a prize over $5,000 or a starter on another chain, even with fresh_build in a fixture', () => {
  const others = ['colosseum-worlds-fair', 'monad-metropolis', 'a16z-speedrun', 'base-builder-grants', 'circle-developer-grants', 'avalanche-team1-mini-grants'];
  const cards = withFreshBuild(withoutFreshBuild(fileCards()), others);
  assert.equal(freshPick(cards, NOW, on), undefined);
  // With Arc tagged too, Arc is still the pick.
  assert.equal(freshPick(withFreshBuild(cards, [ARC]), NOW, on)?.card.id, ARC);
  // One rule at a time, on an Arc copy that otherwise qualifies.
  const arc = tagged().find((c) => c.id === ARC)!;
  const only = (c: Partial<Card>) => freshPick([{ ...arc, ...c }], NOW, on);
  assert.equal(only({})?.card.id, ARC);
  assert.equal(only({ tag: 'long shot' }), undefined, 'long shot');
  assert.equal(only({ tag: 'needs a live product' }), undefined, 'needs a live product');
  assert.equal(only({ investment: true }), undefined, 'investment');
  assert.equal(only({ sponsored: true }), undefined, 'sponsored');
  assert.equal(only({ earnkit_campaign: true }), undefined, 'EarnKit campaign');
  assert.equal(only({ difficulty: { ...arc.difficulty!, level: 'Hard' } }), undefined, 'Hard');
  assert.equal(only({ difficulty: null }), undefined, 'unknown difficulty');
  assert.equal(only({ difficulty: { ...arc.difficulty!, level: 'Medium' } })?.card.id, ARC, 'Medium qualifies');
  assert.equal(only({ max_award_usd: 5001 }), undefined, 'over $5,000');
  assert.equal(only({ max_award_usd: 5000 })?.card.id, ARC, '$5,000 qualifies');
  assert.equal(only({ max_award_usd: null }), undefined, 'unknown prize');
  assert.equal(only({ chains: ['base'] }), undefined, 'an Arc starter on a Base program');
  assert.equal(only({ any_chain: true, chains: [] }), undefined, 'any chain names no chain');
  assert.equal(only({ fresh_build: null }), undefined, 'no starter');
  assert.equal(freshPick([{ ...arc, starts_at: new Date('2026-10-11T00:00:00Z') } as Card], NOW, on), undefined, 'not started');
});

test('7.4b rank: Easy before Medium, then more winners (unknown is 1), then the sooner close, then the higher prize; a rolling program only when no dated one qualifies', () => {
  const arc = tagged().find((c) => c.id === ARC)!;
  const DAY = 24 * 60 * 60 * 1000;
  const mk = (id: string, o: Partial<Card>): Card => ({ ...arc, id, title: id, ...o });
  const medium = { ...arc.difficulty!, level: 'Medium' as const };
  const pick = (cards: Card[]) => freshPick(cards, NOW, on)?.card.id;
  assert.equal(pick([mk('m', { difficulty: medium, winners_per_round: 100 }), mk('e', { winners_per_round: 1 })]), 'e');
  assert.equal(pick([mk('few', { winners_per_round: 2 }), mk('many', { winners_per_round: 20 })]), 'many');
  assert.equal(pick([mk('unknown', { winners_per_round: null }), mk('two', { winners_per_round: 2 })]), 'two');
  assert.equal(pick([mk('late', { ends_at: new Date(NOW.getTime() + 9 * DAY) }), mk('soon', { ends_at: new Date(NOW.getTime() + 3 * DAY) })]), 'soon');
  assert.equal(pick([mk('small', { max_award_usd: 200 }), mk('big', { max_award_usd: 800 })]), 'big');
  // Rolling only when no dated program qualifies.
  const rolling = mk('rolling', { ends_at: null, summary: 'up to $5,000 · rolling', max_award_usd: 5000, winners_per_round: 500 });
  assert.equal(pick([rolling, mk('dated', { difficulty: medium })]), 'dated');
  assert.equal(pick([rolling, mk('far', { ends_at: new Date(NOW.getTime() + 30 * DAY) })]), 'rolling');
  const r = freshPick([rolling], NOW, on)!;
  assert.equal(freshLeadLine(r, NOW, true), 'rolling pays up to $5,000 with no deadline. A USDC tip page on Arc takes about an hour. Want me to build it?');
});

test('7.5 a chat-only client gets the chat-only lead ending in "Want the plan?"', () => {
  const cards = tagged();
  const pick = freshPick(cards, NOW, on)!;
  assert.equal(freshLeadLine(pick, NOW, false), ARC_PLAN);
  const reply = presentFirstMessage(short({ cards, fresh: { ...FRESH_ON, canBuild: false } }));
  assert.equal(reply, `${CONTEXT}\n${ARC_PLAN}`);
  oneQuestion(reply);
  plainCopy(reply);
  assert.equal(freshLead(short({ cards, fresh: { ...FRESH_ON, canBuild: false } }))?.canBuild, false);
});

const v = (program_id: string, missing: Verdict['missing'] = []): Verdict => ({ program_id, program: program_id, status: 'likely', missing, effort: 'none', note: '' });
const GOOD = { score: 6, tier: 'product' as const, missing: [], traction: 8, odds: 'good' as const, low_reason: null };

test('7.6 existing leads keep priority: a good-odds row, an entry awaiting submission, a users question, an entry in preparation, a held question and "show more" never get the fresh lead', () => {
  const cards = tagged();
  const arcCard = cards.find((c) => c.id === ARC)!;
  const good = { checked: 1, fits: [{ repo: 'TipJar', repo_url: null, verdicts: [v(ARC)], product: GOOD }] };
  const lead = presentFirstMessage(short({ cards, repos: good, fresh: FRESH_ON }));
  assert.equal(lead, presentFirstMessage(short({ cards, repos: good })));
  assert.equal(lead, 'Your TipJar can win 500 USDC on Arc by Oct 14. Want me to finish it?');
  // An entry not submitted yet: the submit step.
  const entries = [{ program_id: ARC, title: arcCard.title, name: 'tipjar', submitted: false }];
  const step = presentFirstMessage(short({ cards, entries, fresh: FRESH_ON }));
  assert.equal(step, presentFirstMessage(short({ cards, entries })));
  assert.match(step, /The only step left: submit it on DoraHacks by Oct 14\. Did you submit it\?$/);
  // A product EarnKit can't measure, waiting only on real users: the users question.
  const base = cards.find((c) => c.id === 'base-builder-grants')!;
  const unknown = {
    checked: 1,
    fits: [{ repo: 'tokens.fun', repo_url: null, key: 'minidevai/tokens.fun', verdicts: [v(base.id, ['real_users'])], product: GOOD, facts: { chains: {}, claims: [] } }],
  } as unknown as FirstMessage['repos'];
  const ask = presentFirstMessage(short({ cards, repos: unknown, fresh: FRESH_ON }));
  assert.equal(ask, presentFirstMessage(short({ cards, repos: unknown })));
  assert.match(ask, /^tokens\.fun could win up to \$5,000 on Base with real users\. Does it have real users or revenue\? \(yes\/no\)$/);
  // An entry the builder's agent is preparing (working_on): today's reply.
  assert.equal(presentFirstMessage(short({ cards, workingOn: [ARC], fresh: FRESH_ON })), presentFirstMessage(short({ cards, workingOn: [ARC] })));
  assert.equal(freshLead(short({ cards, workingOn: [ARC], fresh: FRESH_ON })), undefined);
  // A higher question this reply (pickup, outcome): no lead at all.
  assert.equal(freshLead(short({ cards, holdQuestion: true, fresh: FRESH_ON })), undefined);
  assert.equal(presentFirstMessage(short({ cards, holdQuestion: true, fresh: FRESH_ON })), presentFirstMessage(short({ cards, holdQuestion: true })));
  // "Show more": the v2.9 tables, unchanged.
  assert.equal(presentFirstMessage(short({ cards, more: true, fresh: FRESH_ON })), presentFirstMessage(short({ cards, more: true })));
  assert.equal(freshLead(short({ cards, more: true, fresh: FRESH_ON })), undefined);
  for (const m of [good, unknown]) assert.equal(freshLead(short({ cards, repos: m, fresh: FRESH_ON })), undefined);
  assert.equal(freshLead(short({ cards, entries, fresh: FRESH_ON })), undefined);
  // A submitted entry elsewhere leaves the fresh lead (after "Your entries").
  const submitted = [{ program_id: base.id, title: base.title, name: 'payapp', submitted: true }];
  assert.equal(
    presentFirstMessage(short({ cards, entries: submitted, fresh: FRESH_ON })),
    `Your entries: ${base.title} (payapp, submitted).\n${CONTEXT}\n${ARC_LEAD}`,
  );
});

test('7.7 a hidden ("not interested", applied outside) or entered Arc gives no pick', () => {
  const cards = tagged();
  assert.equal(freshPick(cards, NOW, { ...on, hidden: new Set([ARC]) }), undefined);
  assert.equal(freshPick(cards, NOW, { ...on, entered: new Set([ARC]) }), undefined);
  for (const hidden of [{ notInterested: new Set([ARC]), applied: new Set<string>() }, { notInterested: new Set<string>(), applied: new Set([ARC]) }]) {
    assert.equal(freshLead(short({ cards, hidden, fresh: FRESH_ON })), undefined);
    assert.equal(presentFirstMessage(short({ cards, hidden, fresh: FRESH_ON })), presentFirstMessage(short({ cards, hidden })));
  }
  const entered = [{ program_id: ARC, title: 'Arc Microgrants', name: 'tipjar', submitted: true }];
  assert.equal(freshLead(short({ cards, entries: entered, fresh: FRESH_ON })), undefined);
});

test('contextLine: counts the programs openMoneyUsd sums (S1), singular at 1; null with nothing open', () => {
  const cards = tagged();
  const arc = cards.find((c) => c.id === ARC)!;
  assert.equal(contextLine([arc], NOW), '$500 in prizes is open right now across 1 program.');
  assert.equal(contextLine([], NOW), null);
  // Sponsored and closed programs are neither summed nor counted.
  assert.equal(contextLine([arc, { ...arc, id: 's', sponsored: true }, { ...arc, id: 'gone', ends_at: new Date('2026-10-01T00:00:00Z') }], NOW), '$500 in prizes is open right now across 1 program.');
});

test('freshLeadLine copy: the prize cut at " × ", the "what" from the registry, one question, plain', () => {
  const pick = freshPick(tagged(), NOW, on) as FreshPick;
  for (const canBuild of [true, false]) {
    const line = freshLeadLine(pick, NOW, canBuild);
    oneQuestion(line);
    plainCopy(line);
    assert.ok(!line.includes('×'));
  }
  // The "what" is the starter's, never the program's.
  const other = { ...pick, starter: { ...pick.starter, what: 'a tiny thing on Arc' } };
  assert.match(freshLeadLine(other, NOW, true), / A tiny thing on Arc takes about an hour\./);
  assert.match(freshLeadLine(other, NOW, false), / builds the tiny thing in about an hour\./);
});

// ---- v2.11 T8 (spec 3): the twist question, the build checks, the building line and the kit ----

const TIPJAR = STARTERS['arc-tipjar'];
const WALLET = '0x12ab34cd56ef7890a1b2c3d4e5f6a7b8c9d09f3e';
/** The spec's example: the twist baked into the name, the description and the feature. */
const POD = {
  twist: 'tips for my podcast listeners',
  name: 'PodTips',
  description: 'Podcast listeners tip the show in USDC on Arc.',
  feature: 'Each tip can carry a question for the podcast to answer on air.',
  for_whom: 'for your podcast listeners',
};

test('8.1 twistQuestion: the spec\'s two exact strings; the wallet sentence is a statement, so one question either way', () => {
  const q = 'What should it do for you or your users? One line is enough, like "tips for my podcast listeners".';
  assert.equal(twistQuestion(true), q);
  assert.equal(twistQuestion(false), `${q} Add the wallet that should own it. If you don't have one, I'll help you make a free one on your computer.`);
  for (const t of [twistQuestion(true), twistQuestion(false)]) {
    oneQuestion(t);
    plainCopy(t);
  }
});

test('8.2 buildingLine: "Building <name>: <what> <for whom>. I\'ll be back with the live link."', () => {
  assert.equal(
    buildingLine('PodTips', TIPJAR, 'for my podcast listeners'),
    "Building PodTips: a USDC tip page for your podcast listeners. I'll be back with the live link.",
  );
  const line = buildingLine(POD.name, TIPJAR, POD.for_whom);
  assert.doesNotMatch(line, /\?/);
  plainCopy(line);
});

test('8.2 buildCheck passes the twist baked into the name, the description and the feature (no LLM: shared words)', () => {
  assert.equal(buildCheck(POD, TIPJAR), null);
  assert.equal(buildCheck({ ...POD, wallet: WALLET }, TIPJAR), null);
  // Another twist, other words: a camelCase name part counts ("Lib" in "LibFund" for "library").
  const lib = {
    twist: 'a tip jar for my open-source library',
    name: 'LibFund',
    description: 'Back the library with a USDC tip on Arc.',
    feature: 'A goal bar shows how close the library is to its next release.',
    for_whom: 'for your library',
  };
  assert.equal(buildCheck(lib, TIPJAR), null);
});

test('8.3 buildCheck refuses: an address or a stat dump, a name off 3 to 40 characters, a kit name, a twist over 200 characters, two sentences, a missing twist, a bad or public test wallet', () => {
  const bad: [string, Partial<typeof POD> & { wallet?: string }, RegExp][] = [
    ['an address in the name', { name: `PodTips ${WALLET}` }, /^Fix build\.name/],
    ['a 41-character name', { name: `Pod${'x'.repeat(38)}` }, /^Fix build\.name: 3 to 40 characters/],
    ['a 2-character name', { name: 'Po' }, /^Fix build\.name/],
    ['the kit\'s name', { name: 'Arc kit' }, /^Fix build\.name: .*kit/],
    ['the starter package name', { name: 'earnkit-arc-tipjar-starter' }, /^Fix build\.name/],
    ['the twist slot default', { name: 'Tip Jar' }, /^Fix build\.name/],
    ['a name without the twist', { name: 'Tipster' }, /^Fix build\.name: .*twist/],
    ['a description without the twist', { description: 'Send a tip in USDC on Arc.' }, /^Fix build\.description/],
    ['a description over two lines', { description: 'Podcast listeners tip.\nIn USDC on Arc.' }, /^Fix build\.description/],
    ['a stat dump', { description: 'Podcast tips: 1, 2, 3, 4 and 5 USDC.' }, /^Fix build\.description/],
    ['the kit\'s default feature', { feature: 'Every tip can carry a short note, shown on the page.' }, /^Fix build\.feature: .*kit's default/],
    ['the kit\'s words reworded', { feature: 'A tip can carry a note.' }, /^Fix build\.feature: the builder's own/],
    ['two sentences in the feature', { feature: 'Podcast fans leave notes. The host reads them.' }, /^Fix build\.feature: one sentence/],
    ['a twist over 200 characters', { twist: `tips for my podcast ${'listeners '.repeat(20)}` }, /^Fix build\.twist/],
    ['a twist with an address', { twist: `tips to ${WALLET}` }, /^Fix build\.twist/],
    ['a twist that names nothing of theirs', { twist: 'a tip jar for users' }, /^Fix build\.twist: .*who it is for/],
    ['for_whom without "for"', { for_whom: 'your podcast listeners' }, /^Fix build\.for_whom/],
    ['a bad wallet', { wallet: '0x12ab' }, /^Fix build\.wallet/],
    ['a bad checksum', { wallet: '0x12aB34cd56ef7890a1b2c3d4e5f6a7b8c9d09f3e' }, /^Fix build\.wallet/],
    ['the zero address', { wallet: `0x${'0'.repeat(40)}` }, /^Fix build\.wallet/],
    ['anvil account 0', { wallet: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' }, /^Fix build\.wallet: .*public test/],
  ];
  for (const [label, change, re] of bad) {
    const why = buildCheck({ ...POD, ...change }, TIPJAR);
    assert.ok(why, label);
    assert.match(why!, re, label);
    assert.match(why!, /Don't show this to the builder\.$/, label);
    assert.doesNotMatch(why!, /\u2014/, label);
  }
});

test('8.2 (review I2) the feature only has to be the builder\'s own: BUILD.md\'s example passes, the kit\'s default never does', () => {
  // The starter's own BUILD.md example, for its own twist and for the podcast.
  const lib = { twist: 'a tip jar for my open-source library', name: 'LibFund', description: 'Back the library with a USDC tip on Arc.', for_whom: 'for your library' };
  assert.equal(buildCheck({ ...lib, feature: 'A goal bar shows how close the next release fund is.' }, TIPJAR), null);
  assert.equal(buildCheck({ ...POD, feature: 'A goal bar shows how close the next episode fund is.' }, TIPJAR), null);
  // The kit's default, verbatim or with other case and punctuation: refused.
  assert.match(buildCheck({ ...POD, feature: TIPJAR.kit_twist.feature }, TIPJAR)!, /^Fix build\.feature: .*kit's default/);
  assert.match(buildCheck({ ...POD, feature: 'every tip can carry a short note shown on the page' }, TIPJAR)!, /^Fix build\.feature/);
  // The kit's text plus one twist word is the builder's (the new rule); the kit's words alone are not.
  assert.equal(buildCheck({ ...POD, feature: 'Every tip can carry a short note for the podcast.' }, TIPJAR), null);
  assert.match(buildCheck({ ...POD, feature: 'Every tip can carry a short note.' }, TIPJAR)!, /^Fix build\.feature/);
  // An unchanged clone still fails on the name and the description.
  const clone = { ...POD, ...TIPJAR.kit_twist };
  assert.match(buildCheck(clone, TIPJAR)!, /^Fix build\.name/);
  assert.match(buildCheck({ ...clone, name: 'PodTips' }, TIPJAR)!, /^Fix build\.description/);
});

test('8.3 the public test wallets are anvil and Hardhat accounts 0 to 9 (the starter\'s artifact.mjs list) plus the zero address, any case', () => {
  assert.equal(PUBLIC_TEST_WALLETS.length, 10);
  assert.ok(publicTestWallet('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'));
  assert.ok(publicTestWallet('0xA0EE7A142D267C1F36714E4A8F75612F20A79720'));
  assert.ok(publicTestWallet(`0x${'0'.repeat(40)}`));
  assert.ok(!publicTestWallet(WALLET));
});

test('8.5 BUILD_CHAT_ONLY: "I can\'t build from here", no question, no tool or product name', () => {
  assert.match(BUILD_CHAT_ONLY, /^I can't build from here\./);
  assert.doesNotMatch(BUILD_CHAT_ONLY, /\?/);
  assert.doesNotMatch(BUILD_CHAT_ONLY, /Claude|Cursor|Codex|Grok|ChatGPT/);
  plainCopy(BUILD_CHAT_ONLY);
});

test('9.12 (v2.12.1 T9) buildKit with an attribution line carries it and one rule for the agent; without one, the v2.11 kit', () => {
  const line = { codes: ['ek_x', 'earnkit'], data_suffix: '0xabc' };
  const kit = buildKit(TIPJAR, { ...POD, wallet: WALLET }, { proof: null }, line);
  assert.deepEqual(kit.attribution, line);
  assert.ok(kit.rules.some((r) => r.includes('data_suffix')));
  const plain = buildKit(TIPJAR, { ...POD, wallet: WALLET }, { proof: null });
  assert.ok(!('attribution' in plain));
  assert.ok(!plain.rules.some((r) => r.includes('data_suffix')));
  assert.deepEqual(kit.rules.slice(0, -1), plain.rules);
});
