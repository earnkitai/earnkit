import test from 'node:test';
import assert from 'node:assert/strict';
import { builderOnly, mustGive, type GapGrant, type InvestorProgram, type MoveCtx, type MoveProgram } from './conversation';
import { committedProgram } from './fixtures/program-file';
import { longShotWorth, readySet, worthUpTo, type ReadyProgram } from './ready-set';
import { READY_AGAIN_ASK, READY_ASK, contactPhrase, needsList, needsPhrase, readyAgain, readyLine, readyNeedsAsk, readyNeedsLater, readyNoLine, readyOpener, readySentAgain, readyStillNeeds, readyYesReply, shortName, skipReply, worthClause } from './ready-copy';
import { READY_NEED_MAX, readyNeeds } from './bench-find';
import type { SubmissionRequirement } from './program-file';
import { gateFailures, lazyNext, type Reply } from './fixtures/converse';

/*
 * v4.10 Task 2 (R2, R3): the ready set, from the owner's shape on 2026-11-01: Base one step away, a16z closing in 19
 * hours, Circle a long shot.
 */
const NOW = new Date('2026-11-01T10:31:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const prog = (o: Partial<MoveProgram> & { id: string }): MoveProgram => ({
  title: o.id, amount: null, when: 'rolling', ends_at: null, zone: 'UTC', investment: false, max_usd: null, ...o,
});
const BASE: GapGrant = {
  ...prog({ id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: 'up to $5,000', max_usd: 5_000 }),
  gaps: ['codes'], gap: 'EarnKit is one step away: add Builder Codes.', passed: false, doable: true,
};
const CIRCLE: GapGrant = {
  ...prog({ id: 'circle-developer-grants', title: 'Circle Developer Grants', amount: '$5K to $100K', max_usd: 100_000, longShot: true, why: 'they look for apps on Arc' }),
  gaps: [], gap: '', passed: false, doable: false,
};
const A16Z: InvestorProgram = {
  ...prog({ id: 'a16z-speedrun', title: 'a16z speedrun SR008', amount: 'up to $1M', ends_at: at(19 * 3_600_000), investment: true, max_usd: 1_000_000 }),
  odds: null,
};
const gap = (id: string, gaps: string[], o: Partial<GapGrant> = {}): GapGrant => ({ ...prog({ id }), gaps, gap: 'x', passed: false, doable: false, ...o });
const ctx = (o: Partial<MoveCtx> = {}): MoveCtx & { now: Date } => ({ now: NOW, fits: [], grants: [], investors: [], skip: new Set(), raised: new Set(), path: null, ...o });
const OWNER = { grants: [CIRCLE, BASE], investors: [A16Z] };

test('the owner shape gives Base, a16z, Circle, worth up to $1M plus a $100K long shot', () => {
  const set = readySet(ctx(OWNER));
  assert.deepEqual(set.map((p) => [p.id, p.kind]), [['base-builder-grants', 'one_step'], ['a16z-speedrun', 'investor'], ['circle-developer-grants', 'long_shot']]);
  assert.equal(set[0].step, 'codes');
  // v4.10 Task 4 (f): `needs` is a short phrase find derives from a form field, never the gap sentence.
  assert.equal(set[0].needs, null);
  assert.equal(set[2].why, 'they look for apps on Arc');
  // v4.10.1 Task 2 (R3): the long shot is said apart, never summed into the worth; the investor program stays in it.
  assert.equal(worthUpTo(set), '$1M');
  assert.deepEqual(longShotWorth(set), { usd: '$100K', n: 1 });
});

test('an investor program closing in 8 days is left out', () => {
  const week = { ...A16Z, ends_at: at(8 * DAY) };
  assert.deepEqual(readySet(ctx({ ...OWNER, investors: [week] })).map((p) => p.id), ['base-builder-grants', 'circle-developer-grants']);
  assert.equal(readySet(ctx({ ...OWNER, investors: [{ ...A16Z, ends_at: at(6 * DAY) }] })).length, 3);
});

test('a declined, applied-to or recently drafted program is left out (skip)', () => {
  for (const id of ['base-builder-grants', 'a16z-speedrun', 'circle-developer-grants']) {
    const set = readySet(ctx({ ...OWNER, skip: new Set([id]) }));
    assert.equal(set.length, 2);
    assert.ok(!set.some((p) => p.id === id));
  }
});

test('a program already closed is left out', () => {
  assert.deepEqual(readySet(ctx({ ...OWNER, investors: [{ ...A16Z, ends_at: at(-1000) }] })).map((p) => p.id), ['base-builder-grants', 'circle-developer-grants']);
});

test('Base gives way to a later grant when it closes before its step can be done', () => {
  const later = gap('later', ['codes'], { doable: true, max_usd: 2_000, ends_at: at(20 * DAY) });
  const early = { ...BASE, doable: false, ends_at: at(20 * 3_600_000) };
  assert.deepEqual(readySet(ctx({ grants: [early, later] })).map((p) => p.id), ['later']);
  // a step the agent can do is still one step away at that close
  assert.deepEqual(readySet(ctx({ grants: [{ ...BASE, ends_at: at(20 * 3_600_000) }, later] })).map((p) => p.id), ['base-builder-grants', 'later']);
});

test('four eligible fits give 3, by money and then by close', () => {
  const fit = (id: string, max_usd: number | null, ends: number | null) => prog({ id, max_usd, ends_at: ends === null ? null : at(ends * DAY) });
  const set = readySet(ctx({ fits: [fit('small', 1_000, 1), fit('big-late', 10_000, 20), fit('big-soon', 10_000, 5), fit('mid', 5_000, 2)] }));
  assert.deepEqual(set.map((p) => p.id), ['big-soon', 'big-late', 'mid']);
  assert.equal(worthUpTo(set), '$25K');
});

test('fits come before one-step grants, and a long-shot fit goes last', () => {
  const set = readySet(ctx({ fits: [prog({ id: 'fit', max_usd: 100 }), prog({ id: 'ls', max_usd: 9_999_999, longShot: true })], grants: [BASE] }));
  assert.deepEqual(set.map((p) => [p.id, p.kind]), [['fit', 'fit'], ['base-builder-grants', 'one_step'], ['ls', 'long_shot']]);
});

test('no programs gives []; no amounts gives a null total', () => {
  assert.deepEqual(readySet(ctx()), []);
  assert.equal(worthUpTo([]), null);
  const set = readySet(ctx({ fits: [prog({ id: 'a' }), prog({ id: 'b' })] }));
  assert.equal(set.length, 2);
  assert.equal(worthUpTo(set), null);
});

test('worthUpTo formats like the money line', () => {
  const p = (max_usd: number | null) => ({ ...readySet(ctx({ fits: [prog({ id: 'x', max_usd })] }))[0] });
  assert.equal(worthUpTo([p(5_000), p(100_500)]), '$105.5K');
  assert.equal(worthUpTo([p(500), p(null)]), '$500');
});

/*
 * v4.10 Task 3 (R5, R6, R7): the ready copy and the gate.
 */
const OWNER_SET = readySet(ctx(OWNER));
const opener = (o: { set?: ReadyProgram[]; hosted?: boolean } = {}) =>
  readyOpener({ name: 'Jenil', set: o.set ?? OWNER_SET, worth: worthUpTo(o.set ?? OWNER_SET), page: 'earnkit.com/jenilt', hosted: o.hosted ?? false, now: NOW });
const reply = (show: string, o: Partial<Reply> = {}): Reply => ({
  turn: 0, session: 0, first: false, hook: false, tool: 'find', input: {}, show, said: [], reply: null, ...o,
});

test('shortName is the first word of the program name', () => {
  assert.equal(shortName('Base Builder Grant Program'), 'Base');
  assert.equal(shortName('a16z speedrun SR008'), 'a16z');
  assert.equal(shortName('Circle Developer Grants'), 'Circle');
  assert.equal(shortName('Arc Microgrants'), 'Arc');
});

test('the owner shape opens with the approved section A text', () => {
  assert.equal(opener(), [
    "Jenil, I've got 3 applications ready for you, worth up to $1M, plus a $100K long shot:",
    '',
    "1. Base Builder Grant: up to $5,000. Ready once I add Builder Codes (10 minutes, I'll do it).",
    '2. a16z speedrun SR008: up to $1M investment, closes in 19 hours. Ready.',
    "3. Circle Developer Grants: $5K to $100K. Ready, but Circle looks for apps on Arc, so it's a long shot.",
    '',
    'Every answer is filled from your commits and your profile at earnkit.com/jenilt.',
    READY_ASK,
  ].join('\n'));
  assert.equal(READY_ASK, "Reply yes and I'll finish and open each one for you to submit, or tell me the numbers to skip.");
});

test('line wording: hosted step, builder-only field, singular, long shot without a reason', () => {
  const [base, , circle] = OWNER_SET;
  assert.equal(readyLine(base, 1, true, NOW), '1. Base Builder Grant: up to $5,000. Ready once you add Builder Codes (https://docs.base.org/base-chain/builder-codes/builder-codes).');
  assert.equal(readyLine({ ...base, step: null, needs: 'your pitch video' }, 1, false, NOW), '1. Base Builder Grant: up to $5,000. Needs your pitch video first.');
  assert.match(opener({ set: [base] }), /^Jenil, I've got 1 application ready for you, worth up to \$5K:/);
  assert.equal(readyLine({ ...circle, why: null }, 3, false, NOW), "3. Circle Developer Grants: $5K to $100K. Ready, but it's a long shot.");
  assert.equal(readyLine({ ...base, kind: 'fit', step: null }, 1, false, NOW), '1. Base Builder Grant: up to $5,000. Ready.');
});

test('skip and yes replies', () => {
  assert.equal(skipReply(['Circle'], ['Base', 'a16z']), 'Done, Circle is skipped. I\'ll finish Base and a16z now.');
  assert.equal(skipReply(['Circle', 'a16z'], ['Base']), 'Done, Circle and a16z are skipped. I\'ll finish Base now.');
  assert.equal(readyYesReply({ set: OWNER_SET, opened: [], waiting: ['Builder Codes'] }), "Adding Builder Codes now, then I'll open all three.");
  const opened = [
    { title: 'Base Builder Grant Program', link: 'https://docs.base.org/apply' },
    { title: 'a16z speedrun SR008', link: 'https://speedrun.a16z.com/apply' },
    { title: 'Circle Developer Grants', link: 'https://circle.questbook.app/' },
  ];
  assert.equal(readyYesReply({ set: OWNER_SET, opened, waiting: [] }), [
    'All three are open with every answer in place:',
    '- Base: https://docs.base.org/apply',
    '- a16z: https://speedrun.a16z.com/apply',
    '- Circle: https://circle.questbook.app/',
    '',
    'Reply "sent" once they\'re in, and I\'ll track them for you.',
  ].join('\n'));
});

test('the gate passes the ready replies, still fails a plain ask, and the copy is clean', () => {
  const opened = [{ title: 'Base Builder Grant Program', link: 'https://docs.base.org/apply' }];
  const texts = [opener(), opener({ hosted: true }), readyYesReply({ set: OWNER_SET, opened: [], waiting: ['Builder Codes'] }),
    readyYesReply({ set: OWNER_SET.slice(0, 1), opened, waiting: [] }), skipReply(['Circle'], ['Base', 'a16z'])];
  for (const t of texts) {
    assert.doesNotMatch(t, /—|\bcoins?\b|\bpoints?\b|sent it|submitted|applied for you/i, t);
  }
  // v4.10 Task 4 (c): only while the stored ask is the ready one.
  const ready = { reply: { move_up: { kind: 'ready', project_key: null } } };
  assert.deepEqual(gateFailures([reply(opener(), { said: ['opener'], ...ready })]).filter((f) => f.rule === 'easy_reply'), []);
  assert.deepEqual(gateFailures([reply(opener(), { said: ['opener'] })]).map((f) => f.rule), ['easy_reply']);
  assert.deepEqual(gateFailures([reply(texts[3])]).filter((f) => f.rule === 'easy_reply' || f.rule === 'copy' || f.rule === 'claim'), []);
  assert.deepEqual(gateFailures([reply('Jenil, here is Circle.\n\nReply yes or no.')]).map((f) => f.rule), ['easy_reply']);
});

test('lazyNext answers a ready ask with yes, or with the numbers the walk skips', () => {
  const asked = reply(opener(), { reply: { move_up: { kind: 'ready', project_key: null } } });
  const o = { blanks: 'just me', pushed: 'PUSHED' };
  assert.deepEqual(lazyNext(asked, o), { says: 'yes', tell: { move_up: { kind: 'ready', project_key: null, answer: 'yes' } } });
  assert.deepEqual(lazyNext(asked, { ...o, skip: [3] }), { says: 'skip 3', tell: { move_up: { kind: 'ready', project_key: null, answer: 'skip', skip: [3] } } });
  // v4.10 Task 4: once the pages are open the ready ask is "sent", never another yes.
  const opened = reply(readyYesReply({ set: OWNER_SET, opened: [{ title: 'Circle Developer Grants', link: 'https://circle.questbook.app/' }], waiting: [] }), { reply: { move_up: { kind: 'ready', project_key: null } } });
  assert.deepEqual(lazyNext(opened, o), { says: 'sent', tell: { move_up: { kind: 'ready', project_key: null, answer: 'sent' } } });
});

/*
 * v4.10 Task 4: the copy find and tell add (decisions d, f, g) and the gate's ready-status ask.
 */
test('a long shot one doable codes gap away carries step codes, and its line says the step', () => {
  const ls: GapGrant = { ...BASE, id: 'ls-codes', title: 'Circle Developer Grants', amount: '$5K to $100K', max_usd: 100_000, longShot: true, why: 'they look for apps on Arc' };
  const [p] = readySet(ctx({ grants: [ls] }));
  assert.deepEqual([p.kind, p.step], ['long_shot', 'codes']);
  assert.equal(readyLine(p, 1, false, NOW), "1. Circle Developer Grants: $5K to $100K. Ready once I add Builder Codes (10 minutes, I'll do it), but Circle looks for apps on Arc, so it's a long shot.");
  // a long shot with a gap the agent can't do keeps no step
  assert.equal(readySet(ctx({ grants: [{ ...ls, gaps: ['on Arc mainnet'], doable: false }] }))[0].step, null);
});

test('an investor program with no amount reads "investment program"', () => {
  const [a] = readySet(ctx({ investors: [{ ...A16Z, amount: null }] }));
  assert.equal(readyLine(a, 1, false, NOW), '1. a16z speedrun SR008: investment program, closes in 19 hours. Ready.');
});

test('needsPhrase: a short noun phrase from the field kind, else its label', () => {
  assert.equal(needsPhrase({ key: 'founding_team', label: 'Tell us about the founding team', kind: 'team', todo: 'a note on the founding team' }), 'your team list');
  assert.equal(needsPhrase({ key: 'demo_loom', label: 'Link to a Product Demo (Loom)', kind: 'demo_video', todo: 'a Loom product demo' }), 'your demo video');
  assert.equal(needsPhrase({ key: 'pitch', label: 'Pitch video', kind: 'pitch_video' }), 'your pitch video');
  assert.equal(needsPhrase({ key: 'usage_numbers', label: 'Share your key usage numbers', kind: 'traction', todo: 'your key usage numbers' }), 'your usage numbers');
  assert.equal(needsPhrase({ key: 'entity', label: 'Legal entity', kind: 'other', todo: 'your legal entity' }), 'your legal entity');
  assert.equal(needsPhrase({ key: 'loc', label: 'Location', kind: 'other' }), 'your location');
  const [base] = OWNER_SET;
  assert.equal(readyLine({ ...base, step: null, needs: 'your team list' }, 1, false, NOW), '1. Base Builder Grant: up to $5,000. Needs your team list first.');
});

test('the ready status, the no line, and a partial open list', () => {
  const ready = OWNER_SET.map((p) => ({ ...p, step: null, kind: p.kind === 'long_shot' ? ('fit' as const) : p.kind }));
  assert.equal(readyAgain(ready, NOW), [
    'Your 3 applications are still ready:',
    '- Base: up to $5,000. Ready.',
    '- a16z: up to $1M investment, closes in 19 hours. Ready.',
    '- Circle: $5K to $100K. Ready.',
    '',
    READY_AGAIN_ASK,
  ].join('\n'));
  assert.equal(READY_AGAIN_ASK, "Reply yes and I'll finish them.");
  assert.equal(readyAgain(ready.slice(0, 1), NOW), "Your application is still ready:\n- Base: up to $5,000. Ready.\n\nReply yes and I'll finish it.");
  assert.equal(readyNoLine(['Base', 'a16z', 'Circle']), "No problem, I'll set Base, a16z and Circle aside.");
  const two = OWNER_SET.slice(0, 2);
  assert.match(readyYesReply({ set: two, opened: [{ title: 'a16z speedrun SR008', link: 'https://speedrun.a16z.com/apply' }], waiting: [] }), /^1 of 2 is open with every answer in place:\n- a16z: /);
  const asked = { reply: { move_up: { kind: 'ready', project_key: null } } };
  assert.deepEqual(gateFailures([reply(readyAgain(ready, NOW), asked)]), []);
  assert.deepEqual(gateFailures([reply(readyAgain(ready, NOW))]).map((f) => f.rule), ['easy_reply']);
  assert.match(readyOpener({ name: null, set: OWNER_SET, worth: '$1M', page: 'earnkit.com/j', hosted: false, now: NOW }), /^I've got 3 applications ready for you, worth up to \$1M, plus a \$100K long shot:\n/);
});

test('v4.10.1 Task 2 (5): the repeat reply names each program, its money and its hours left, and is honest about needs', () => {
  const [base, a16z, circle] = OWNER_SET;
  const set = [
    { ...base, needs: 'your contact details (name, email and Telegram), how it makes money today, main challenge right now and 1 more' },
    { ...a16z, needs: 'your email' },
    { ...circle, needs: 'your Circle and Arc integrations, product roadmap and proposed grant milestones' },
  ];
  const again = readyAgain(set, NOW);
  assert.equal(again, [
    "Here's where your 3 applications stand:",
    '- Base: up to $5,000. Needs your contact details (name, email and Telegram), how it makes money today, main challenge right now and 1 more first.',
    '- a16z: up to $1M investment, closes in 19 hours. Needs your email first.',
    '- Circle: $5K to $100K. Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first.',
    '',
    READY_AGAIN_ASK,
  ].join('\n'));
  // Never "still ready" while one program needs something; one per line, ending on the one easy reply.
  const mixed = readyAgain([{ ...base, needs: null }, set[1]], NOW);
  assert.doesNotMatch(mixed, /still ready/);
  assert.match(mixed, /^Here's where your 2 applications stand:\n- Base: up to \$5,000\. Ready once I add Builder Codes \(10 minutes, I'll do it\)\.\n- a16z: .* Needs your email first\.\n\nReply yes and I'll finish them\.$/);
  assert.match(readyAgain([{ ...base, needs: null }], NOW, true), /Ready once you add Builder Codes \(https:/);
  assert.equal(readyAgain([set[1]], NOW), "Here's where your application stands:\n- a16z: up to $1M investment, closes in 19 hours. Needs your email first.\n\nReply yes and I'll finish it.");
  // The hours only under 48; a close further out, or none, says no time.
  const later = { ...a16z, ends_at: at(3 * DAY), needs: null };
  assert.match(readyAgain([later], NOW), /\n- a16z: up to \$1M investment\. Ready\.\n/);
  assert.match(readyAgain([{ ...base, step: null, ends_at: at(5 * 3_600_000) }], NOW), /\n- Base: up to \$5,000, closes in 5 hours\. Ready\.\n/);
  assert.match(readyAgain([{ ...base, step: null, amount: null }], NOW), /\n- Base\. Ready\.\n/);
  assert.match(readyAgain([{ ...a16z, amount: null, needs: null }], NOW), /\n- a16z: investment program, closes in 19 hours\. Ready\.\n/);
});

test('v4.10.1 Task 2 (5): the "sent" repeat names each open page with its money and hours left', () => {
  const [base, a16z] = OWNER_SET;
  assert.equal(readySentAgain([base, a16z], NOW), [
    'Your 2 applications are open with every answer in place:',
    '- Base: up to $5,000.',
    '- a16z: up to $1M investment, closes in 19 hours.',
    '',
    'Reply "sent" once they\'re in, and I\'ll track them for you.',
  ].join('\n'));
  assert.equal(readySentAgain([base], NOW), 'Your application is open with every answer in place:\n- Base: up to $5,000.\n\nReply "sent" once it\'s in, and I\'ll track it for you.');
});

test('v4.10.1 Task 2 (R3): the worth leaves long shots out and says them apart; never "$0"', () => {
  const [base, a16z, circle] = OWNER_SET;
  assert.equal(worthClause(OWNER_SET, worthUpTo(OWNER_SET)), ', worth up to $1M, plus a $100K long shot');
  assert.equal(worthClause([base, circle], worthUpTo([base, circle])), ', worth up to $5K, plus a $100K long shot');
  assert.equal(worthClause([base, a16z], worthUpTo([base, a16z])), ', worth up to $1M');
  // All long shots: the head still reads honestly, with no "worth up to $0".
  const two = [circle, { ...circle, id: 'arc', title: 'Arc Fund', max_usd: 50_000 }];
  assert.equal(worthUpTo([circle]), null);
  assert.equal(worthClause([circle], worthUpTo([circle])), ', a $100K long shot');
  assert.equal(worthClause(two, worthUpTo(two)), ', $150K in long shots');
  assert.match(opener({ set: [circle] }), /^Jenil, I've got 1 application ready for you, a \$100K long shot:\n/);
  assert.doesNotMatch(opener({ set: two }), /\$0/);
  // A long shot with no number adds nothing; a fit with none and a long shot with one: "including".
  assert.equal(worthClause([{ ...circle, max_usd: null }], null), '');
  assert.equal(worthClause([{ ...base, max_usd: null }, circle], null), ', including a $100K long shot');
  assert.equal(longShotWorth([base]), null);
});

test('fix 1 (M3): a long shot that needs a builder-only answer keeps its label; two founder blanks ask for both', () => {
  const circle = OWNER_SET[2];
  assert.equal(readyLine({ ...circle, needs: 'your team list' }, 3, false, NOW), "3. Circle Developer Grants: $5K to $100K. Needs your team list first, and Circle looks for apps on Arc, so it's a long shot.");
  assert.equal(readyLine({ ...circle, why: null, needs: 'your team list' }, 3, false, NOW), "3. Circle Developer Grants: $5K to $100K. Needs your team list first, and it's a long shot.");
  assert.equal(needsPhrase({ key: 'money_raised', label: "Any money you've raised", kind: 'raised' }), "any money you've raised");
  assert.equal(readyNeedsAsk('a16z speedrun SR008', "your team list and any money you've raised", 2), "a16z needs your team list and any money you've raised first. Reply with both and I'll finish it.");
  assert.deepEqual(gateFailures([reply(readyNeedsAsk('a16z speedrun SR008', 'x', 2), { reply: { move_up: { kind: 'ready', project_key: null } } })]).filter((f) => f.rule === 'easy_reply'), []);
});

// ---------------------------------------------------------------------------------------------------------------------
// v4.10 final fix (I1, M1, M2): one ask for the whole set.

const req = (key: string, kind: string, o: Partial<SubmissionRequirement> = {}) =>
  ({ key, label: key, type: 'text', required: true, from: 'builder', kind, ...o }) as SubmissionRequirement;
const BASE_ONLY = [req('founding_team', 'team'), req('usage_numbers', 'traction'), req('demo_loom', 'demo_video', { type: 'url' })];
const A16Z_ONLY = [req('founding_team', 'team'), req('money_raised', 'raised')];

test('final fix (I1): a program\'s needs name up to 3, then "and N more"', () => {
  assert.equal(needsList(BASE_ONLY.map(needsPhrase)), 'your team list, usage numbers and demo video');
  assert.equal(needsList(A16Z_ONLY.map(needsPhrase)), "your team list and any money you've raised");
  assert.equal(needsList([...BASE_ONLY, req('pitch', 'pitch_video'), req('x', 'other', { todo: 'legal entity' })].map(needsPhrase)), 'your team list, usage numbers, demo video and 2 more');
  const line = readyLine({ ...OWNER_SET[0], needs: needsList(BASE_ONLY.map(needsPhrase)) }, 1, false, NOW);
  assert.equal(line, '1. Base Builder Grant: up to $5,000. Needs your team list, usage numbers and demo video first.');
});

test('final fix (I1): readyNeeds asks every field once, soonest close first, at most 4; past it a program waits', () => {
  const soon = new Date(NOW.getTime() + 4 * 3_600_000).toISOString();
  const base = { id: 'base', title: 'Base Builder Grant Program', ends_at: null, only: BASE_ONLY };
  const a16z = { id: 'a16z', title: 'a16z speedrun SR008', ends_at: soon, only: A16Z_ONLY };
  const n = readyNeeds([base, a16z, { id: 'circle', title: 'Circle Developer Grants', ends_at: null, only: [] }])!;
  assert.deepEqual(n.programs, ['a16z', 'base']);
  assert.deepEqual(n.items.map((i) => i.kind), ['team', 'raised', 'traction', 'demo_video']);
  // The team list both ask is one item, with both programs' fields.
  assert.deepEqual(n.items[0].fields.map((f) => f.program_id), ['a16z', 'base']);
  assert.equal(n.later.length, 0);
  assert.equal(readyNeedsAsk(n.titles, n.phrase, n.items.length),
    "a16z and Base need your team list, any money you've raised, usage numbers and demo video first. Reply with them and I'll finish them.");
  // A fifth field: the program adding it waits, named; the first program always goes.
  const colosseum = { id: 'col', title: 'Colosseum Worlds Fair', ends_at: null, only: [req('team_location', 'other', { todo: 'team location' })] };
  const capped = readyNeeds([base, a16z, colosseum])!;
  assert.equal(READY_NEED_MAX, 4);
  assert.deepEqual([capped.programs, capped.later.map((w) => w.program_id)], [['a16z', 'base'], ['col']]);
  assert.equal(readyNeedsLater(capped.later), "Colosseum also needs your team location. I'll ask for it next.");
  const big = readyNeeds([{ ...colosseum, only: [...BASE_ONLY, ...A16Z_ONLY.slice(1), req('team_location', 'other')] }])!;
  assert.deepEqual([big.programs, big.items.length], [['col'], 4]);
  assert.equal(readyNeeds([{ ...base, only: [] }]), null);
});

test('final fix (I1, M1, M2): the plural asks, "every other answer" and the adding line naming what the codes open', () => {
  assert.equal(readyNeedsAsk('Base Builder Grant Program', 'your team list'), "Base needs your team list first. Reply with it and I'll finish it.");
  assert.equal(readyNeedsAsk(['a16z speedrun SR008'], "your team list and any money you've raised", 2), "a16z needs your team list and any money you've raised first. Reply with both and I'll finish it.");
  assert.equal(readyNeedsAsk(['Base Builder Grant Program'], 'your team list, usage numbers and demo video', 3), "Base needs your team list, usage numbers and demo video first. Reply with them and I'll finish it.");
  assert.equal(readyStillNeeds(['Base Builder Grant Program', 'a16z speedrun SR008'], 'your team list and demo video', 2), "Still waiting on your team list and demo video for Base and a16z. Reply with both and I'll finish them.");
  const needs = opener({ set: [{ ...OWNER_SET[0], needs: 'your team list' }, ...OWNER_SET.slice(1)] });
  assert.match(needs, /\n\nEvery other answer is filled from your commits and your profile at earnkit\.com\/jenilt\.\n/);
  assert.match(opener(), /\n\nEvery answer is filled from/);
  assert.equal(readyYesReply({ set: OWNER_SET, opened: [], waiting: ['Builder Codes'], codes: ['Base Builder Grant Program'] }), "Adding Builder Codes now, then I'll open Base.");
  // The gate takes each as the one easy reply.
  const ready = { reply: { move_up: { kind: 'ready', project_key: null } } };
  for (const t of ["a16z and Base need your team list first. Reply with them and I'll finish them.", readyStillNeeds(['a', 'b'], 'x', 3)])
    assert.deepEqual(gateFailures([reply(t, ready)]).filter((f) => f.rule === 'easy_reply' || f.rule === 'copy'), [], t);
});

// ---------------------------------------------------------------------------------------------------------------------
// v4.10.1 Task 1: honest needs (pure).

test('v4.10.1 (1): what the agent can\'t truthfully draft is a need, whatever `from` says; a GTM plan and an optional field are not', () => {
  const circle = committedProgram('circle-developer-grants');
  assert.deepEqual(builderOnly(circle, {}).map((r) => r.key), ['integrations', 'roadmap', 'milestones']);
  const base = { ...committedProgram('base-builder-grants'), investment: false };
  // R1: the GTM plan stays drafted; revenue, the main challenge (multi_choice) and the credits are the builder's.
  assert.deepEqual(builderOnly(base, {}).map((r) => r.key), ['founding_team', 'usage_numbers', 'demo_loom', 'contract_address', 'revenue', 'builder_code', 'primary_challenge', 'credits']);
  // Fix round 1: a contract address EarnKit doesn't hold is the builder's (from the project or not); held, it isn't.
  assert.ok(!builderOnly(base, { contract_address: '0xabc' }).some((r) => r.key === 'contract_address'));
  assert.equal(mustGive({ key: 'contracts', label: 'Base contract addresses to score', from: 'project', kind: 'other', required: true }), true);
  assert.equal(mustGive(base.submission_requirements.find((r: { key: string }) => r.key === 'gtm_plan')!), false);
  // Verified revenue held: never asked.
  assert.ok(!builderOnly(base, { revenue: '$120 paid into its contracts' }).some((r) => r.key === 'revenue'));
  // A program whose only field the agent can't draft is optional is still ready (nothing to ask).
  const optional = { investment: false, submission_requirements: [
    { key: 'what', label: 'What it does', type: 'text', required: true, from: 'project', kind: 'one_liner' },
    { key: 'what_changed', label: 'What changed since last time?', type: 'text', required: false, from: 'builder', kind: 'other' },
  ] as SubmissionRequirement[] };
  assert.deepEqual(builderOnly(optional, {}), []);
  // A project field the record shows (a one-liner, how it works) stays the agent's; a plan from the project is not.
  assert.equal(mustGive({ key: 'how', label: 'How it works', from: 'project', kind: 'how_it_works', required: true }), false);
  assert.equal(mustGive({ key: 'funds', label: 'Use of funds', from: 'project', kind: 'use_of_funds', required: true }), true);
});

test('v4.10.1 (2): the contact item names each detail once, in the slots\' order; phrases read as written', () => {
  assert.equal(contactPhrase([{ slot: 'email', label: 'Email' }]), 'your email');
  assert.equal(contactPhrase([{ slot: 'email', label: 'Email' }, { slot: 'telegram', label: 'Telegram username' }, { slot: 'name', label: 'Full name' }, { slot: 'email', label: 'Email' }]),
    'your contact details (name, email and Telegram)');
  assert.equal(contactPhrase([{ slot: 'key:wechat', label: 'WeChat ID' }, { slot: 'name', label: 'Full name' }]), 'your contact details (name and wechat id)');
  assert.equal(needsPhrase({ key: 'revenue', label: 'How does your product make money today?', kind: 'other', todo: 'how it makes money today' }), 'how it makes money today');
  assert.equal(needsPhrase({ key: 'credits', label: 'Which credits?', kind: 'other', todo: 'the credits you want' }), 'the credits you want');
  assert.equal(needsPhrase({ key: 'integrations', label: 'Your Circle and Arc integrations', kind: 'other', todo: 'your Circle and Arc integrations' }), 'your Circle and Arc integrations');
});

test('v4.10.1 (2): readyNeeds asks the contact details as one item, two fields of one kind apart, and names the first program\'s rest', () => {
  const contact = (key: string, label: string) => req(key, 'contact', { label });
  const base = { id: 'base', title: 'Base Builder Grant Program', ends_at: null, only: [contact('full_name', 'Full name'), contact('email', 'Email'), contact('telegram', 'Telegram username'), req('revenue', 'other', { todo: 'how it makes money today' }), req('primary_challenge', 'other', { todo: 'your main challenge right now' }), req('credits', 'other', { todo: 'the credits you want' })] };
  const a16z = { id: 'a16z', title: 'a16z speedrun SR008', ends_at: at(4 * 3_600_000), only: [contact('email', 'Email')] };
  const circle = { id: 'circle', title: 'Circle Developer Grants', ends_at: null, only: [req('roadmap', 'milestones', { todo: 'a product roadmap' }), req('milestones', 'milestones', { todo: 'proposed grant milestones' })] };
  const n = readyNeeds([base, a16z, circle])!;
  assert.deepEqual(n.items.map((i) => i.kind), ['contact', 'other:revenue', 'other:primary_challenge', 'other:credits']);
  // One item for a16z's email and Base's three, named together.
  assert.deepEqual(n.items[0].fields.map((f) => `${f.program_id}.${f.req.key}`), ['a16z.email', 'base.full_name', 'base.email', 'base.telegram']);
  assert.equal(n.items[0].phrase, 'your contact details (name, email and Telegram)');
  assert.equal(n.phrase, 'your contact details (name, email and Telegram), how it makes money today, main challenge right now and the credits you want');
  // Circle's roadmap and milestones (one kind) are two items, each its own answer; they wait for the next ask.
  assert.deepEqual(n.later, [{ program_id: 'circle', title: 'Circle Developer Grants', phrase: 'your product roadmap and proposed grant milestones' }]);
  const alone = readyNeeds([circle])!;
  assert.deepEqual(alone.items.map((i) => i.kind), ['other:roadmap', 'other:milestones']);
  // The first program's fields past the cap are named for next, never dropped silently.
  const big = readyNeeds([{ ...base, only: [...base.only, req('team', 'team'), req('usage', 'traction')] }])!;
  assert.equal(big.items.length, 4);
  assert.deepEqual(big.later, [{ program_id: 'base', title: 'Base Builder Grant Program', phrase: 'your team list and usage numbers' }]);
  assert.equal(readyNeedsLater(big.later), "Base also needs your team list and usage numbers. I'll ask for them next.");
});

test('v4.10.1 (2): "every other answer is filled" only when one ask covers every field the builder owes', () => {
  const needs = [{ ...OWNER_SET[0], needs: 'your team list' }, ...OWNER_SET.slice(1)];
  assert.match(opener({ set: needs }), /\n\nEvery other answer is filled from/);
  const rest = readyOpener({ name: 'Jenil', set: needs, worth: null, page: 'earnkit.com/jenilt', hosted: false, now: NOW, rest: true });
  assert.match(rest, /\n\nI've filled what I can from your commits and your profile at earnkit\.com\/jenilt\.\n/);
  assert.doesNotMatch(rest, /Every (?:other )?answer|—/);
});

test('v4.10.1 (2): the replay\'s lazy agent answers the contact item one value per slot, the rest by ask key', () => {
  const ask = readyNeedsAsk(['Base Builder Grant Program'], 'your contact details (name and email) and how it makes money today', 2);
  const r = reply(ask, { reply: { move_up: { kind: 'ready', project_key: 'o/r' }, ready: { need: { asks: [{ kind: 'contact', slots: ['name', 'email'] }, { kind: 'other:revenue' }] } } } });
  const next = lazyNext(r, { blanks: 'none', pushed: 'PUSHED', answers: { 'contact.name': 'Jenil T', 'other:revenue': 'no revenue yet' } });
  assert.deepEqual(next, {
    says: 'Jenil T, none, no revenue yet',
    tell: { move_up: { kind: 'ready', project_key: 'o/r', answer: 'yes', answers: { contact: { name: 'Jenil T', email: 'none' }, 'other:revenue': 'no revenue yet' } } },
  });
});

test('v4.10.1 (2): tell\'s answers take a kind or other:<field key>, contact as slots only, at most 8', async () => {
  const { READY_ANSWERS } = await import('./program-file');
  assert.ok(READY_ANSWERS.safeParse({ team: 'me', 'other:revenue': 'none', contact: { name: 'Jenil', email: 'j@e.co' } }).success);
  assert.ok(READY_ANSWERS.safeParse({ contact: 'j@e.co' }).success);
  assert.ok(!READY_ANSWERS.safeParse({ team: { name: 'x' } }).success);
  assert.ok(!READY_ANSWERS.safeParse({ 'other:Revenue!': 'x' }).success);
  assert.ok(!READY_ANSWERS.safeParse({ pitch: 'x' }).success);
  assert.ok(!READY_ANSWERS.safeParse(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`other:f${i}`, 'x']))).success);
});
