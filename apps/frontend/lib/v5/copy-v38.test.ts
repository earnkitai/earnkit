/**
 * v3.8 E15 (plan 23.3 to 23.7): the new copy behind `copy_v38`. Each of the 15 delegable asks (an ask for something
 * EarnKit or the builder's agent can find or decide) has its own test: main's line asked it, the new line does not, and
 * the new line passes builderRules v2. Main's table stays live with the flag off (the frozen-string tests pin it).
 */
import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { COPY_V37, COPY_V38, copy, type CopyTable } from './copy';
import { BANNED_V2, DELEGABLE, builderRulesV2 } from './fixtures/builder-rules';
import { programFixture } from './fixtures/program';
import { upsertProgram } from './programs';
import { track } from './track';
import { find } from './find';
import { DOCS_DELETE, DOCS_NEXT, DOCS_SEES } from './site-copy';
import { INSTALL_PAGES } from '../v6/install-consent';

after(() => sql().end());
afterEach(() => {
  delete process.env.EARNKIT_FLAGS;
});

const NOW = new Date('2026-11-04T12:00:00Z');
const LINK = 'https://earnkit.com/link/abc';
async function ctx() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'cv38-' + Math.random()}) RETURNING id`;
  return { installationId: r.id as number, builderId: null, now: NOW, gh: (async () => new Response('', { status: 404 })) as typeof fetch, linkUrl: async () => LINK };
}

/** One delegable ask: main's line (it asks), the new line (it does not), and whether the new line still needs the builder. */
type Ask = { before: string; after: string; needsBuilder: boolean };
const pick = (t: CopyTable): Record<string, string> => ({
  openAsk: t.openAsk,
  describeName: t.describeName('Lumen'),
  noProjectOne: t.noProjectOne,
  closedOne: t.closedOne,
  sayWhichRepo: t.sayWhichRepo,
  usersSignedIn: `Nothing is ready yet. ${t.usersApply}`,
  usersSignedOut: `Nothing is ready yet. ${t.usersUnlinkedApply}`,
  demoClosing: t.demoClosing,
  startedClosing: t.startedClosing,
  outcomeAsk: t.outcomeAsk('One Grant', 'yesterday'),
  nothingFits: t.nothingFits('Lumen'),
  joinRepoAsk: t.joinRepoAsk,
  whichChangeOn: t.whichChangeOn('Rule Only Grant'),
  tellWhenLive: t.tellWhenLive,
  wholeDollars: t.wholeDollars,
  amountUnread: t.amountUnread,
  tellAmount: t.tellAmount,
  underADollar: t.underADollar('USD'),
});
const OLD = pick(COPY_V37);
const NEW = pick(COPY_V38);
const ask = (key: string, needsBuilder = false): Ask => ({ before: OLD[key], after: NEW[key], needsBuilder });

/** The 15 delegable asks, numbered as in the PR. */
const ASKS: [number, string, string, Ask][] = [
  [1, 'what you build, or its repo link (the open list)', 'find.ts OPEN_ASK', ask('openAsk', true)],
  [2, 'what a named project does, or its repo link', 'find.ts openList', ask('describeName')],
  [3, 'what you build, on one program with no project', 'find.ts NO_PROJECT_ONE', ask('noProjectOne')],
  [4, 'say its name again when it reopens', 'find.ts CLOSED_ONE, CLOSED_PROJECT_ONE', ask('closedOne')],
  [5, 'which repo is yours', 'find.ts SAY_WHICH_REPO', ask('sayWhichRepo')],
  [6, 'do real people use it, signed in', 'reply.ts closing, usersLookup, doUsersClosing', ask('usersSignedIn')],
  [7, 'do real people use it, signed out (sign-in is the one ask)', 'reply.ts USERS_UNLINKED*', ask('usersSignedOut', true)],
  [8, 'the demo video link', 'reply.ts DEMO_CLOSING', ask('demoClosing')],
  [9, 'when you started', 'reply.ts STARTED_CLOSING', ask('startedClosing')],
  [10, 'did you hear back', 'reply.ts outcomeLines', ask('outcomeAsk')],
  [11, 'more about it, or its repo link (nothing fits)', 'reply.ts nothingFits', ask('nothingFits')],
  [12, 'the repo link to join a project', 'track.ts joinProject', ask('joinRepoAsk')],
  [13, 'which change did you finish', 'track.ts WHICH_CHANGE_ON, ledger.ts WHICH_CHANGE', ask('whichChangeOn')],
  [14, 'tell me when it is live', 'track.ts gap_done on code', ask('tellWhenLive')],
  [15, 'how much you won', 'ledger.ts WHOLE_DOLLARS', ask('wholeDollars')],
];
/** Ask 15's other forms: the amount the agent passed could not be read, or is under a dollar. */
const AMOUNT_FORMS = [ask('amountUnread'), ask('tellAmount'), ask('underADollar')];

const isAsk = (t: string) => DELEGABLE.test(t) || BANNED_V2.some((b) => t.toLowerCase().includes(b.toLowerCase()));

for (const [n, what, where, a] of ASKS)
  test(`delegable ask ${n} (${where}): ${what}: main asks it, the new line does not and passes builderRules v2`, () => {
    assert.ok(isAsk(a.before), `main's line should be the ask: ${a.before}`);
    assert.ok(!isAsk(a.after), a.after);
    builderRulesV2(a.after, { needsBuilder: a.needsBuilder, maxSentences: 3 });
  });

test('delegable ask 15, its other forms (track amount_usd unreadable, malformed, under a dollar): never "tell me the amount"', () => {
  for (const a of AMOUNT_FORMS) {
    assert.ok(isAsk(a.before), a.before);
    assert.ok(!isAsk(a.after), a.after);
    builderRulesV2(a.after, { needsBuilder: false, maxSentences: 2 });
  }
});

test('every new line passes builderRules v2: short, no semicolons, dashes, exclamation marks, rank or token talk', () => {
  const all = (t: CopyTable) => [
    ...Object.values(pick(t)), t.openAskLinked, t.closedProjectOne, t.rulesAction, t.doUsersClosing('add an MIT license file', 'One Grant'),
    t.usersUnlinked, t.usersUnlinkedAt(LINK, 'check'), t.usersUnlinkedAt(LINK, 'apply'), t.usersCheck,
    t.usersLookup({ rule: null, linked: true, link: null, then: 'apply' }), t.usersLookup({ rule: null, linked: false, link: LINK, then: 'check' }),
    t.usersLookup({ rule: 'is it open source', linked: true, link: null, then: 'apply' }), `Did you send One Grant? ${t.sentSay}`,
    `Did you send One Grant and Two Grant? ${t.sentManySay}`, t.whichChange, t.alreadySkipped, t.won('$3,000', 'One Grant'), t.nextNoted,
    t.nextLacks({ title: 'Base Builder Grants', needs: ['your country'] }), t.notSavedSignIn(LINK),
    t.screenQueued('3 applicants', 'One Grant', 0, 'Results come once a day, within 24 hours.'),
  ];
  for (const line of all(COPY_V38)) builderRulesV2(line, { needsBuilder: true, maxSentences: 3 });
  // The lines that need nothing from the builder end on what EarnKit did or will do.
  for (const line of [COPY_V38.openAskLinked, COPY_V38.openAskUnlinked, COPY_V38.usersCheck, COPY_V38.whichChange, COPY_V38.won('$3,000', 'One Grant'), COPY_V38.nextNoted])
    builderRulesV2(line, { needsBuilder: false, maxSentences: 2 });
});

test('plan 23.4 before and after: the new lines', () => {
  assert.equal(COPY_V38.openAsk, "Sign in and I'll look at what you build and show you what you can apply to.");
  assert.equal(COPY_V38.alreadySkipped, "That one's already skipped. Say unskip if you want it back.");
  assert.equal(COPY_V38.nextNoted, 'Got it. Sending it now.');
  assert.equal(COPY_V38.rulesAction, "If all of that's true for you, say yes and I'll draft it.");
  assert.equal(COPY_V38.nextLacks({ title: 'Base Builder Grants', needs: ['your country'] }), 'Base Builder Grants is next. It still needs your country from you.');
  assert.equal(COPY_V38.notSavedSignIn(LINK), `I couldn't save that yet. Sign in once here: ${LINK}. Then tell me again and it'll stick.`);
  // The win never claims an announcement EarnKit did not fetch (rule 9).
  assert.equal(COPY_V38.won('$3,000', 'One Grant'), "One Grant paid $3,000. It's on your record.");
});

test('copy_v38 off is main\'s table; on is the new one; both have the same keys', () => {
  assert.equal(copy(), COPY_V37);
  process.env.EARNKIT_FLAGS = 'copy_v38';
  assert.equal(copy(), COPY_V38);
  assert.deepEqual(Object.keys(COPY_V38).sort(), Object.keys(COPY_V37).sort());
});

test('rank stays hidden: no copy line, old or new, names a rank, score or position', () => {
  const words = /\b(rank|ranked|ranking|score|position|leaderboard|top \d+|#\d+)\b/i;
  for (const t of [COPY_V37, COPY_V38])
    for (const line of Object.values(pick(t))) assert.doesNotMatch(line, words, line);
});

test('asks 1 and 3 end to end: the open list and a one-program find with no project tell the agent to pass the project', async () => {
  process.env.EARNKIT_FLAGS = 'copy_v38';
  const c = await ctx();
  const open = await find(c, {});
  assert.ok(open.show_to_builder.endsWith(COPY_V38.openAsk), open.show_to_builder);
  assert.ok(open.agent_note.includes(COPY_V38.openNote), open.agent_note);
  await upsertProgram(programFixture({ id: 'cv38-one', title: 'Lone Grant' }), 'file', NOW);
  const one = await find(c, { program_id: 'cv38-one' });
  assert.ok(one.show_to_builder.endsWith(COPY_V38.noProjectOne), one.show_to_builder);
  assert.ok(one.agent_note.includes(COPY_V38.openNote), one.agent_note);
  builderRulesV2(one.show_to_builder, { needsBuilder: false });
});

test('ask 13 end to end: gap_done with no item is matched by the agent, never asked of the builder', async () => {
  process.env.EARNKIT_FLAGS = 'copy_v38';
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'cv38-rule', title: 'Rule Only Grant', eligibility: [{ kind: 'rule', note: 'a first-time founder' }] }), 'file', NOW);
  const r = await track(c, { program_id: 'cv38-rule', status: 'gap_done' });
  assert.equal(r.show_to_builder, "I'll match that to the right step on Rule Only Grant.");
  assert.match(r.agent_note, /^The rule item is rule:[0-9a-f]{8}\./);
});

test('ask 15 and the win line end to end: an unreadable or tiny amount sends the agent to the announcement; a win reads as paid', async () => {
  process.env.EARNKIT_FLAGS = 'copy_v38';
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'cv38-win', title: 'One Grant' }), 'file', NOW);
  await track(c, { program_id: 'cv38-win', status: 'applied' });
  const unread = await track(c, { program_id: 'cv38-win', status: 'won', amount_usd: 0 });
  assert.equal(unread.show_to_builder, COPY_V38.amountUnread);
  const tiny = await track(c, { program_id: 'cv38-win', status: 'won', amount_usd: 0.5 });
  assert.equal(tiny.show_to_builder, COPY_V38.underADollar('USD'));
  assert.ok(tiny.agent_note.includes(COPY_V38.wholeDollarsNote), tiny.agent_note);
  const won = await track(c, { program_id: 'cv38-win', status: 'won', amount_usd: 3000 });
  assert.equal(won.show_to_builder, "One Grant paid $3,000. It's on your record.");
});

test('23.4 dead end end to end: a second skip offers the way back', async () => {
  process.env.EARNKIT_FLAGS = 'copy_v38';
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'cv38-skip', title: 'Skip Two' }), 'file', NOW);
  await track(c, { program_id: 'cv38-skip', status: 'skipped' });
  const again = await track(c, { program_id: 'cv38-skip', status: 'skipped' });
  assert.equal(again.show_to_builder, "That one's already skipped. Say unskip if you want it back.");
});

test('flag off end to end: the same calls give main\'s lines', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'cv38-off', title: 'Off Grant', eligibility: [{ kind: 'rule', note: 'a first-time founder' }] }), 'file', NOW);
  assert.equal((await track(c, { program_id: 'cv38-off', status: 'gap_done' })).show_to_builder, 'Which change did you finish on Off Grant?');
  assert.ok((await find(c, {})).show_to_builder.endsWith(COPY_V37.openAsk));
});

test('E16 install copy (site copy, not flagged) passes builderRules v2', () => {
  for (const t of [...DOCS_NEXT.lines, DOCS_SEES.can, DOCS_SEES.cannot, DOCS_DELETE.text, INSTALL_PAGES.limited.text]) {
    builderRulesV2(t, { needsBuilder: false });
  }
});
