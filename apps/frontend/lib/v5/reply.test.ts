import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_CLOSING, FULL_RULE_SAY, alsoSentence, closingAfterOpening, countedLines, needWords, openingSentence, paragraphs, plainClosing, defaultRows, moreInFull, agentNote, replyParts, attendGap, closingLine, doUsersOf, gapAction, gapActionStep, gapLine, notFitLine, numbered, replyText as renderReply, firstStepOf, singleStepClosing, stepClause, stepRuleOf } from './reply';
import { LICENSE_FILE, NEEDS_CODE, PUBLIC_REPO } from './eligibility';
import type { FindReply, GapProgram, ReadyProgram } from './find';
import type { Ledger } from './ledger';
import { DELETED_NOTICE, shortTitle } from '../v6/reply-words';

type R = Omit<FindReply, 'show_to_builder' | 'agent_note'>;

/**
 * v6.1.17 Task 5 (v6.1.16 Task 9 N6): every reply this file renders, kept so the tonight and one-Say walkers replay the
 * fixtures through replyText (the last test), not only the literals on assert lines.
 */
const rendered: string[] = [];
const replyText: typeof renderReply = (...a) => {
  const t = renderReply(...a);
  rendered.push(t);
  return t;
};

const ready = (over: Partial<ReadyProgram> & { title: string }): ReadyProgram => ({
  program_id: over.title.toLowerCase().replace(/\W+/g, '-'),
  money: '$1K',
  max_award_usd: 1000,
  category: 'grant',
  closes_at: null,
  closes_in: null,
  long_shot: null,
  in_person: false,
  submission_url: 'https://example.com/apply',
  fields: [],
  filled: 0,
  facts_from_repo: 0,
  repo_required: 0,
  from_record: 0,
  need_you: [],
  total: 1,
  needs: [],
  setup: [],
  rules: [],
  n: 0,
  ...over,
});
const gap = (over: Partial<GapProgram> & { title: string }): GapProgram => ({
  program_id: over.title.toLowerCase().replace(/\W+/g, '-'),
  money: '$1K',
  max_award_usd: 1000,
  category: 'grant',
  closes_at: null,
  gap: { kind: 'chain', item: 'chain:arc', what: 'deploy the contract on Arc', effort: 'hours', agent_can: false },
  also: [],
  rules: [],
  in_person: false,
  setup: [],
  n: 0,
  ...over,
});
const LEDGER0: Ledger = { applied: 0, asked_usd: 0, won: 0, won_usd: 0, won_other: [], won_no_amount: 0, pending: 0, rejected: 0, skipped: 0, closing_soon: [] };
const NO_SINCE = { from: null, new: [], changed: [], closing: [] };
/** A reply with its lists numbered as find numbers them. */
const base = (over: Partial<R> = {}): R => {
  const r: R = {
    since: NO_SINCE, ready: [], gaps: [], ledger: LEDGER0, ask_outcome: [], as_reported: false,
    linked: false, record_missing: [], blockers: [], evidence_summary: null, applied_overnight: [], released: [], auto_apply: false, linked_notice: null,
    ...over,
  };
  return { ...r, ...numbered(r.ready, r.gaps, attendGap) };
};

const MONDAY = base({
  ready: [
    ready({
      title: 'Alliance ALL19', money: '$400K at admission', closes_in: 'in 14 days', filled: 3, facts_from_repo: 2, repo_required: 2, total: 9,
      needs: ["the first founder's email"],
    }),
    ready({ title: 'Arc Builders Fund', money: 'investment from Circle Ventures', long_shot: 'an investment program with no stated amount', total: 5 }),
  ],
  gaps: [gap({ title: 'Circle Developer Grants', money: '$5,000 to $100,000 USDC grants' })],
  ledger: { ...LEDGER0, applied: 1, asked_usd: 5000, pending: 1 },
  applications: [{ program_id: 'x-grant', title: 'X Grant', status: 'waiting', sent_at: '2026-11-03T10:00:00.000Z', result_at: null, amount: null }],
});
const MON = new Date('2026-11-09T12:00:00Z');

// Re-pinned by L29-1, L29-18, L29-26 and L29-27 (v6.1.16 Task 15): one line each, the applications by name, You give, one Say.
test('the Monday text: two ready, one gap, the applications by name', () => {
  assert.equal(
    replyText(MONDAY, false, MON),
    [
      '2 programs are ready to send now.',
      '',
      '1. Alliance ALL19 ($400K at admission, closes in 14 days). Once you give the first founder\'s email, I apply on your yes.',
      '2. Arc Builders Fund (investment from Circle Ventures). I apply once you say yes.',
      '3. Circle Developer Grants ($5,000 to $100,000 USDC grants) needs you to deploy the contract on Arc first.',
      '',
      'Your applications: X Grant (sent Nov 3, waiting).',
      '',
      'Say yes and I apply to all 2.',
    ].join('\n'),
  );
});

test('the since line: only when something changed, never on the first find', () => {
  const r = base({
    since: {
      from: '2026-11-02T09:00:00.000Z',
      new: [{ program_id: 'a', title: 'A' }, { program_id: 'b', title: 'B' }],
      changed: [{ program_id: 'c', title: 'Circle Developer Grants', what: 'deadline moved to Nov 20' }],
      closing: [{ program_id: 'd', title: 'Alliance ALL19', closes_at: '2026-11-07T00:00:00.000Z' }],
    },
    ready: [ready({ program_id: 'd', title: 'Alliance ALL19', money: '$400K at admission', closes_in: 'in 3 days', filled: 1, facts_from_repo: 1, repo_required: 1, total: 4 })],
    ledger: { ...LEDGER0, applied: 2, asked_usd: 115000, won: 1, pending: 1, closing_soon: [{ program_id: 'x', title: 'X', closes_at: '' }] },
  });
  assert.equal(
    replyText(r, false),
    [
      '1 program is ready to send now.',
      '',
      '1. Alliance ALL19 ($400K at admission, closes in 3 days). I apply once you say yes.',
      '',
      'Since Nov 2: 2 new programs you fit; Circle Developer Grants: deadline moved to Nov 20.',
      '',
      'Say yes and I apply to Alliance ALL19.',
    ].join('\n'),
  );
  assert.ok(!replyText(r, true).includes('Since'));
  // L13-17: a close that is on no shown line keeps its date; with nothing else moved and every close shown, no since line.
  const away = { ...r, since: { ...r.since, closing: [...r.since.closing, { program_id: 'e', title: 'Elsewhere Grant', closes_at: '2026-11-09T00:00:00.000Z' }] } };
  // L23-9, L23-11 (v6.1.16): the one closes wording, never an ISO date.
  assert.match(replyText(away, false, new Date('2026-11-04T12:00:00Z')), /^Since Nov 2: 2 new programs you fit; Circle Developer Grants: deadline moved to Nov 20; Elsewhere Grant closes in 5 days\.$/m);
  const onlyShown = { ...r, since: { ...r.since, new: [], changed: [] } };
  assert.doesNotMatch(replyText(onlyShown, false), /Since/);
});

// Re-pinned by L29-1 (v6.1.16 Task 15, ruling 29): the line names the applications; the counts are /me's and the JSON's.
test('L29-1: the applications line names up to five, each with its state, then "and {n} more"', () => {
  const app = (title: string, status: 'waiting' | 'won' | 'rejected' | 'no_result' | 'held', sent: string | null, amount: string | null = null) =>
    ({ program_id: title.toLowerCase().replace(/\W+/g, '-'), title, status, sent_at: sent, result_at: null, amount });
  const line = (apps: ReturnType<typeof app>[]) => replyText(base({ applications: apps, ready: [ready({ title: 'R' })] }), false, MON).split('\n').find((b) => b.startsWith('Your applications'));
  assert.equal(line([app('PayPal AI Hackathon', 'waiting', '2026-11-03T10:00:00Z'), app('Thiel Fellowship', 'won', '2026-10-30T10:00:00Z', '$10,000')]),
    'Your applications: PayPal AI Hackathon (sent Nov 3, waiting), Thiel Fellowship (sent Oct 30, won $10,000).');
  assert.equal(line([app('A', 'rejected', '2026-11-01T10:00:00Z'), app('B', 'no_result', '2026-11-01T10:00:00Z'), app('D', 'held', null)]),
    // L38-26 (v6.1.18): a held row says how to lift it.
    'Your applications: A (sent Nov 1, rejected), B (sent Nov 1, no result), D (on hold, say go to send).');
  const seven = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((t) => app(t, 'waiting', '2026-11-01T10:00:00Z'));
  assert.equal(line(seven), 'Your applications: A (sent Nov 1, waiting), B (sent Nov 1, waiting), C (sent Nov 1, waiting), D (sent Nov 1, waiting), E (sent Nov 1, waiting) and 2 more.');
  assert.equal(line([]), undefined);
  // L23-6 (v6.1.16): results due soon is its own line.
  assert.ok(replyText(base({ ledger: { ...LEDGER0, applied: 1, pending: 1, results_soon: [{ program_id: 'x', title: 'X Grant', results_at: '' }] }, ready: [ready({ title: 'R' })] }), false).includes('\nResults due soon: X Grant.\n'));
});

test('gaps only, the agent can do it, and the needs list is cut at three', () => {
  const r = base({
    gaps: [gap({ title: 'Base Batches', money: '$100K', gap: { kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes', agent_can: true } })],
  });
  assert.equal(
    replyText(r, false),
    // M1 (v6.1.9): the line already offers "do 1", so the closing names no second action.
    [
      'Nothing is ready to send yet. The closest:',
      '',
      '1. Base Batches ($100K) needs you to add Base Builder Codes to the app first.',
      '',
      'Say do 1 and I add the codes.',
    ].join('\n'),
  );
  // "do n" by the gap's kind, only when EarnKit can make every real gap (1a, 3.7).
  // L38 big 3 (v6.1.18 Task 10): the whole gap line (the one-program reply's, and a one-step row's); a row of two or
  // more steps reads "{first}, then {k} more steps." under More to do first.
  const one = (g: GapProgram['gap'], also: GapProgram['also'] = []) => gapLine({ ...gap({ title: 'G', gap: g, also }), n: 1 });
  const ARC = { kind: 'contract_on' as const, item: 'contract_on:arc', what: 'a contract on Arc', effort: 'hours' as const, agent_can: false };
  const SW = { kind: 'integration' as const, item: 'integration:smart_wallet', what: 'add Smart Wallet', effort: 'days' as const, agent_can: true };
  const DEMO = { kind: 'demo_video' as const, item: 'demo_video', what: 'a demo video link (a short screen recording of it working)', effort: 'hours' as const, agent_can: false };
  // A contract deploy is never EarnKit's change (fix round 1): the line ends after the gap.
  assert.equal(one(ARC), '1. G, $1K: a contract on Arc.');
  assert.ok(!agentNote(base({ gaps: [gap({ title: 'G', gap: ARC })] }), { more: 0 }).includes('On "do <n>"'));
  // L24-8 (v6.1.16 Task 11): the line carries no "do n"; the closing offers it.
  assert.equal(one(SW), '1. G, $1K: add Smart Wallet.');
  assert.equal(replyText(base({ gaps: [gap({ title: 'G', gap: SW })] }), true).split('\n').at(-1), 'Say do 1 and I add Smart Wallet.');
  assert.equal(one(ARC, [SW]), '1. G, $1K: a contract on Arc and add Smart Wallet.');
  assert.equal(one(SW, [{ ...SW, item: 'integration:x', what: 'add X' }]), '1. G, $1K: add Smart Wallet and add X.');
  assert.equal(one(ARC, [DEMO]), '1. G, $1K: a contract on Arc and a demo video link (a short screen recording of it working).');
  assert.equal(replyText(base({ gaps: [gap({ title: 'G', gap: ARC, also: [DEMO] })] }), false).split('\n').slice(0, 2).join('\n'), 'Nothing is ready to send yet. The closest:\n');
  // v6.1.14 (was C57): the unlinked proof is a gap after the colon; its sign-in is asked once, in the closing.
  const TIER = { kind: 'tier' as const, item: 'tier:used', what: 'proof of real users', effort: 'weeks' as const, agent_can: false };
  assert.equal(one(TIER), '1. G, $1K: proof of real users.');
  assert.equal(one(TIER, [DEMO]), '1. G, $1K: proof of real users and a demo video link (a short screen recording of it working).');
  const two = base({ gaps: [gap({ title: 'G', money: '$1K', also: [{ kind: 'live_product', item: 'live_product', what: 'put a live link up', effort: 'hours', agent_can: false }] })] });
  // L1l-2 (v6.1.19): the row names the deploy too.
  assert.equal(replyText(two, false), 'Nothing is ready to send yet. The closest:\n\n1. G ($1K) needs you to deploy the contract on Arc, then 1 more step.\n\nTell me when the contract is on Arc and I look again.');
  assert.equal(gapLine(two.gaps[0]), '1. G, $1K: deploy the contract on Arc and put a live link up.');
  const many = base({ ready: [ready({ title: 'B', needs: ['your full name', 'your email', 'a Loom product demo', 'your X handle', 'an investor deck file'] })] });
  // L29-18 (v6.1.16 Task 15): "You give:", the words as the form names them, at most three and the count.
  assert.match(replyText(many, false), /^1\. B \(\$1K\)\. Once you give your full name and your email, I apply on your yes\.$/m);
  const setup = base({ ready: [ready({ title: 'S', setup: ['sign in to the Builder Hub'], needs: ['sign in to the Builder Hub', 'a Loom product demo'] })] });
  // R2c: the one answer is the builder's, so the agent drafts none of it.
  // L38-30 (v6.1.18): the builder's own setup step is said in the closing, first, and there only.
  assert.equal(replyText(setup, false), '1 program is ready to send now.\n\n1. S ($1K). Once you give a Loom product demo, I apply on your yes.\n\nSign in to the Builder Hub first, then say yes and I apply.');
});

test('one ready program: no "all 1"', () => {
  const one = base({ ready: [MONDAY.ready[0]] });
  assert.match(replyText(one, false), /\nSay yes and I apply to Alliance ALL19\.$/);
  const withGap = base({ ready: [MONDAY.ready[0]], gaps: MONDAY.gaps });
  assert.match(replyText(withGap, false), /\nSay yes and I apply to Alliance ALL19\.$/);
});

// Re-pinned by L29-26 (v6.1.16 Task 15): the default view shows the ready block; the in-person ones are the agent's to
// mention (Not shown) and the full view's.
test('in person: its own block, with the setup, never in the count to apply to; behind "say more" when something is ready', () => {
  const mumbai = ready({
    title: 'ETHGlobal Mumbai', money: 'up to $15K per partner prize', closes_in: 'in 2 days', in_person: true, facts_from_repo: 3,
    setup: ['apply to attend by Nov 3 and get accepted', 'stake a small amount of ETH', 'be in Mumbai Nov 5 to 7'],
    needs: ['apply to attend by Nov 3 and get accepted', 'stake a small amount of ETH', 'be in Mumbai Nov 5 to 7'],
  });
  const r = base({ ready: [MONDAY.ready[0], mumbai, MONDAY.ready[1]], gaps: MONDAY.gaps });
  assert.equal(
    replyText(r, false),
    [
      '2 programs are ready to send now.',
      '',
      '1. Alliance ALL19 ($400K at admission, closes in 14 days). Once you give the first founder\'s email, I apply on your yes.',
      '2. Arc Builders Fund (investment from Circle Ventures). I apply once you say yes.',
      '3. Circle Developer Grants ($5,000 to $100,000 USDC grants) needs you to deploy the contract on Arc first.',
      '',
      'Also open: ETHGlobal Mumbai (up to $15K, closes in 2 days), in person.',
      '',
      'Say yes and I apply to all 2.',
    ].join('\n'),
  );
  const parts = replyParts(r, false);
  assert.deepEqual(parts.hidden, ['4. ETHGlobal Mumbai, up to $15K per partner prize, closes in 2 days. First: apply to attend by Nov 3 and get accepted; stake a small amount of ETH; be in Mumbai Nov 5 to 7.']);
  assert.match(agentNote(r, { more: 0, hidden: parts.hidden }), /^Not shown to the builder:\n4\. ETHGlobal Mumbai/m);
  assert.equal(replyText(r, false, new Date(), null, { all: true }).split('\n').slice(0, 7).join('\n'),
    // L1i-6 (v6.1.16.1): the full view keeps the close. L35-9 (v6.1.17): under the default's headings. L1k-3 (v6.1.18):
    // the In person heading says in person, so its rows do not.
    // L38 big 3 (v6.1.18 Task 10): the full list heads every row not ready "Not ready yet".
    [
      'Everything open, nearest first:',
      '',
      'Ready:',
      '1. Alliance ALL19 ($400K at admission, closes in 14 days).',
      '2. Arc Builders Fund (investment from Circle Ventures).',
      '',
      'Not ready yet:',
    ].join('\n'));
  // L38 big 2 (v6.1.18 Task 10): alone, the In person block is one line; its setup is the agent's (hidden) line.
  const only = replyText(base({ ready: [mumbai] }), false);
  assert.equal(only, 'Nothing remote is ready yet.\n\nAlso open: ETHGlobal Mumbai (up to $15K, closes in 2 days), in person.\n\nSay yes and I start the in-person applications.');
  assert.deepEqual(replyParts(base({ ready: [mumbai] }), false).hidden, ['1. ETHGlobal Mumbai, up to $15K per partner prize, closes in 2 days. First: apply to attend by Nov 3 and get accepted; stake a small amount of ETH; be in Mumbai Nov 5 to 7.']);
  assert.doesNotMatch(only, /Say yes to apply/);
  assert.match(agentNote(r, { more: 0 }), /In-person programs .* draft nothing for one until the builder says yes to attending it/);
  assert.doesNotMatch(agentNote(MONDAY, { more: 0 }), /In-person/);
});

test('a ledger never names an asked amount (3.6)', () => {
  const r = base({ ledger: { ...LEDGER0, applied: 1, asked_usd: 25000, pending: 1 }, ready: [ready({ title: 'R' })], applications: [{ program_id: 'a', title: 'A', status: 'waiting', sent_at: '2026-11-03T10:00:00.000Z', result_at: null, amount: null }] });
  assert.match(replyText(r, false, MON), /^Your applications: A \(sent Nov 3, waiting\)\.$/m);
  assert.doesNotMatch(replyText(r, false, MON), /25,000/);
});

test('nothing fits', () => {
  assert.equal(replyText(base(), false), 'Nothing fits yet. Tell me more about it, or its repo link, and I look again.');
});

test('every closing line, and the copy rules', () => {
  const texts = [replyText(MONDAY, false), replyText(base({ ready: MONDAY.ready }), false), replyText(base({ gaps: MONDAY.gaps }), false), replyText(base(), false)];
  for (const t of texts) {
    assert.doesNotMatch(t, /—|\p{Extended_Pictographic}/u);
    assert.doesNotMatch(t, /\b(coin|points|score|rank|streak|token)s?\b/i);
  }
});

test('agentNote: fields, yes only, track after each, the counts left out, ask once', () => {
  const n = agentNote({ ...MONDAY, ask_outcome: [{ program_id: 'z', title: 'Zeta Grant', due_at: '2026-11-01T00:00:00Z' }] }, { more: 2 });
  for (const s of ["'earnkit'", "'agent'", "'builder'", 'sources', 'form_id', 'track', 'won', 'Zeta Grant', 'The full list holds 2 more; show it when the builder asks for all, more or the full list. Call find with filter.all for it.'])
    assert.ok(n.includes(s), s);
  assert.ok(!agentNote(MONDAY, { more: 0 }).includes('more: gaps'));
  // L29-27 (v6.1.16 Task 15): a number skips through the note.
  assert.ok(n.includes('A number skips that program: call track skipped with its id.'));
  // 3.34: who reported what, said plainly.
  const reported = base({ as_reported: true, ready: [ready({ title: 'R' })] });
  assert.ok(agentNote(reported, { more: 0 }).includes('tell the builder the match used what they reported, not a repo read.'));
  assert.ok(!agentNote(reported, { more: 0 }).includes('as reported by you'));
  // L29-29 (v6.1.16 Task 15): an empty reply has a one-line note.
  assert.equal(agentNote(base({ as_reported: true }), { more: 0 }).split('\n').length, 1);
});

test('repo reads paused: its own agent line, never "send them corrected"', () => {
  const paused = agentNote(base({ problems: ['repo reads paused until tomorrow'], ready: [ready({ title: 'R' })] }), { more: 0 });
  assert.ok(paused.includes('Repo reads are paused for this installation until tomorrow; the match used what you reported.'));
  assert.ok(!paused.includes('Send them corrected'));
  const both = agentNote(base({ problems: ['live_url dropped: not a web link', 'repo reads paused until tomorrow'], ready: [ready({ title: 'R' })] }), { more: 0 });
  assert.ok(both.includes('Some project facts were dropped: live_url dropped: not a web link. Send them corrected next time.'));
});

// Re-pinned by L29-18 (v6.1.16 Task 15): the counts stay in the JSON; a line with nothing for the builder ends at the money.
test('a reported-only program with passed links reads its money alone', () => {
  assert.match(replyText(base({ ready: [ready({ title: 'R', filled: 3, facts_from_repo: 0 })] }), false), /^1\. R \(\$1K\)\. I apply once you say yes\.$/m);
});

test('#3 (v6.1.15): one Drafted shape (R2c): n of the required m, all but the builder\'s, which are named, never above total', () => {
  const line = (over: Partial<ReadyProgram>) => replyText(base({ ready: [ready({ title: 'Z Fellows', money: '$10K', ...over })] }), false).split('\n')[2];
  assert.equal(line({ repo_required: 2, total: 9, needs: ['your email'] }), '1. Z Fellows ($10K). Once you give your email, I apply on your yes.');
  assert.equal(line({ repo_required: 2, total: 23 }), '1. Z Fellows ($10K). I apply once you say yes.');
  assert.equal(line({ repo_required: 1, total: 2, needs: ['your birthday'] }), '1. Z Fellows ($10K). Once you give your birthday, I apply on your yes.');
  assert.equal(line({ repo_required: 0, total: 23, needs: ['your birthday', 'your phone number'] }), '1. Z Fellows ($10K). Once you give your birthday and your phone number, I apply on your yes.');
  assert.equal(line({ total: 2, needs: ['your birthday'] }), '1. Z Fellows ($10K). Once you give your birthday, I apply on your yes.');
  assert.equal(line({ total: 23 }), '1. Z Fellows ($10K). I apply once you say yes.');
  assert.equal(line({ total: 1, needs: ['your birthday'] }), '1. Z Fellows ($10K). Once you give your birthday, I apply on your yes.');
  assert.equal(line({ repo_required: 4, total: 4 }), '1. Z Fellows ($10K). I apply once you say yes.');
  assert.equal(line({ total: 0 }), '1. Z Fellows ($10K). I apply once you say yes.');
  // Never above total; optional fields read from the repo (facts_from_repo) are not in the count.
  assert.equal(line({ repo_required: 6, facts_from_repo: 9, total: 4 }), '1. Z Fellows ($10K). I apply once you say yes.');
  // L38-30 (v6.1.18): the setup step goes to the closing.
  assert.equal(line({ total: 3, setup: ['sign in to the Hub'], needs: ['sign in to the Hub', 'your birthday'] }), '1. Z Fellows ($10K). Once you give your birthday, I apply on your yes.');
});

test('one required answer reads in the singular', () => {
  const line = (repo_required: number) => replyText(base({ ready: [ready({ title: 'One', money: '$1K', repo_required, total: 1 })] }), false).split('\n')[2];
  assert.equal(line(1), '1. One ($1K). I apply once you say yes.');
  assert.equal(line(0), '1. One ($1K). I apply once you say yes.');
});

const BANNED = /—|\p{Extended_Pictographic}|\b(score|rank|grade|points|coin|token|streak)s?\b/iu;

test('#3 (v6.1.15) linked: the same Drafted shape, the builder\'s own answers named', () => {
  const r = base({
    linked: true,
    // facts_from_repo counts optional fields too (v5's count); the linked line reads the required ones only.
    ready: [ready({ title: 'Z Fellows', money: '$10K', from_record: 3, facts_from_repo: 4, repo_required: 2, total: 6, need_you: ['your Telegram username'], needs: ['your Telegram username'] })],
  });
  assert.equal(replyText(r, false).split('\n')[2], '1. Z Fellows ($10K). I apply once you say yes.');
  const none = base({ linked: true, ready: [ready({ title: 'A', from_record: 2, facts_from_repo: 1, repo_required: 1, total: 3 })] });
  assert.equal(replyText(none, false).split('\n')[2], '1. A ($1K). I apply once you say yes.');
  const four = base({ linked: true, ready: [ready({ title: 'B', from_record: 1, total: 6, need_you: ['your phone', 'your birthday', 'where you are based', 'your Telegram username'] })] });
  assert.equal(replyText(four, false).split('\n')[2], '1. B ($1K). I apply once you say yes.');
  // F2 (v6.1.10): the name and tagline the agent passed are its drafts, never the builder's.
  const told = base({ linked: true, ready: [ready({ title: 'N', from_record: 1, total: 4, need_you: ['the problem'], needs: ['the problem'] })] });
  assert.equal(replyText(told, false).split('\n')[2], '1. N ($1K). I apply once you say yes.');
  const zero = base({ linked: true, ready: [ready({ title: 'C', total: 4 })] });
  assert.equal(replyText(zero, false).split('\n')[2], '1. C ($1K). I apply once you say yes.');
  // Unlinked: the builder's answers are the non-setup needs, whatever need_you holds.
  const unlinked = base({ ready: [ready({ title: 'Z Fellows', money: '$10K', from_record: 3, facts_from_repo: 2, repo_required: 2, total: 6, need_you: ['x'] })] });
  assert.equal(replyText(unlinked, false).split('\n')[2], '1. Z Fellows ($10K). I apply once you say yes.');
});

const LINKED = base({
  linked: true,
  ready: [
    ready({ program_id: 'g1', title: 'Base Builder Grant', from_record: 2, facts_from_repo: 1, total: 3 }),
    ready({ program_id: 'g2', title: 'Google Two', from_record: 2, total: 2 }),
    ready({ program_id: 'av', title: 'Avalanche Team1', from_record: 1, total: 2 }),
    ready({ program_id: 'cl', title: 'Click Grant', from_record: 1, total: 1 }),
  ],
  blockers: [
    { program_id: 'g1', sign_in: 'google', needs_click: false, needs: [] },
    { program_id: 'g2', sign_in: 'google', needs_click: false, needs: [] },
    { program_id: 'av', sign_in: 'Avalanche Builder Hub', needs_click: false, needs: [] },
    { program_id: 'cl', sign_in: 'email', needs_click: true, needs: ['founder_video'] },
  ],
  record_missing: ['your founder video link', 'an approved answer on the problem', 'your deck link', 'your resume link'],
  applied_overnight: [{ program_id: 'x', title: 'Alliance ALL19' }, { program_id: 'y', title: 'Arc Builders Fund' }],
  evidence_summary: { tier: 'live', line: 'Your project is live, with no verified usage yet. Next: about 25 outside users in 90 days; I count 4.' },
});

// Re-pinned by L29-18, L29-26, L29-27 and L29-22 (v6.1.16 Task 15): one line each, "Before applying:" the one label,
// "Applying now to", no second Say.
test('the "Before applying" line groups the sign-ins, names the clicks and the first three missing; the standing line only when the agent sends', () => {
  const text = replyText(LINKED, false);
  const before = text.split('\n').find((b) => b.startsWith('Before applying: '))!;
  assert.equal(
    before,
    'Before applying: you sign in to Google in your agent\'s browser for Base Builder Grant and Google Two; you sign in to Avalanche Builder Hub for Avalanche Team1; you sign in by email and press submit yourself on Click Grant; your founder video link and an approved answer on the problem.',
  );
  const lines = text.split('\n');
  assert.ok(lines.filter((l) => l.trim() !== '').length <= 10, text);
  // L1j-3 (v6.1.17): the row left out is counted once. L1k-5 (v6.1.18): on the line after the rows.
  assert.deepEqual(lines.filter((l) => l !== '').slice(-3), [
    before,
    'Your project is live, with no verified usage yet. Next: about 25 outside users in 90 days; I count 4.',
    'Say yes and I apply to 3 and draft Click Grant for you to send.',
  ]);
  const moreAt = lines.indexOf('Also: 1 more in the full list.');
  assert.ok(moreAt > 0 && lines[moreAt - 1] === '' && /^\d+\. /.test(lines[moreAt - 2]), text);
  assert.doesNotMatch(text.replace(/Click Grant/g, ''), /click/i);
  assert.doesNotMatch(text, /Before I send/);
  // Standing approval with nothing an agent can send alone (every program blocked): no standing line.
  assert.match(replyText({ ...LINKED, auto_apply: true, max_per_night: 5 }, false), /\nBefore applying: you sign in to Google/);
  // Standing approval and one program free to send: the agent applies now.
  const free = base({ ...LINKED, ready: [...LINKED.ready, ready({ program_id: 'f1', title: 'Free', from_record: 1, total: 1 })], auto_apply: true, max_per_night: 5 });
  const tonight = replyText(free, false);
  assert.doesNotMatch(tonight, /Before I send|nothing is sent until|goes ahead|go ahead|tonight/);
  assert.match(tonight, /\nApplying now to Free under your standing approval\. Say stop and I hold any of them\.$/);
  // N1 (v6.1.9): the sends already made in the last 24 hours leave less room; none left, no standing line.
  const two = base({ ...free, ready: [...free.ready, ready({ program_id: 'f2', title: 'Free Two', from_record: 1, total: 1 })], max_per_night: 2 });
  assert.match(replyText({ ...two, auto_sent_today: 0 }, false), /\nApplying now to Free and Free Two under your standing approval\. Say stop and I hold any of them\.$/);
  assert.match(replyText({ ...two, auto_sent_today: 1 }, false), /\nApplying now to Free under your standing approval\. Say stop and I hold any of them\.$/);
  const used = replyText({ ...two, auto_sent_today: 2 }, false);
  assert.equal(used.split('\n').at(-1), 'Your daily limit is used; the next sends wait until 24 hours have passed. Say yes and I apply to 5 and draft Click Grant for you to send.');
  assert.doesNotMatch(used, /Applying now to|The sends? goes? ahead/);
  assert.ok(agentNote({ ...two, auto_sent_today: 2 }, { more: 0 }).includes('The daily limit is used: send nothing alone until 24 hours after the last send under standing approval.'));
  // L24-11 (v6.1.16 Task 11): a ready program outside the approval takes the standing line's yes; the hold is the note's.
  const out = base({ ...free, record_missing: [], blockers: [{ program_id: 'av', sign_in: null, needs_click: false, needs: [], outside_approval: true }] });
  assert.equal(replyText(out, false).split('\n').at(-1), 'Applying now to Base Builder Grant, Google Two, Click Grant and Free under your standing approval. Say yes and I also apply to Avalanche Team1.');
  assert.ok(agentNote(out, { more: 0 }).includes('On stop, call track with status held for each program named.'));
  const note = agentNote(LINKED, { more: 0 });
  assert.ok(note.includes('Fit approved answers by cutting, never by adding; the style contract travels on each field.'));
  assert.ok(!note.includes('Submit only'));
  assert.ok(note.includes('Ask for the missing record items once, all together, and save each with record.'));
  assert.ok(!note.includes('Standing approval is on'));
  assert.ok(!agentNote(MONDAY, { more: 0 }).includes('Fit approved answers'));
});

// L29-6 (v6.1.16 Task 15): the note names the programs the approval covers, and only these.
test('standing approval: the closing line counts what an agent can send alone, and the note names only those', () => {
  const free = (id: string) => ready({ program_id: id, title: id.toUpperCase(), from_record: 1, total: 1 });
  const r = base({
    ...LINKED,
    ready: [...LINKED.ready, free('f1'), free('f2'), free('f3'), ready({ program_id: 'held', title: 'Held', claimed_since: '2026-11-04T10:00:00.000Z' })],
    auto_apply: true,
    max_per_night: 2,
  });
  // Four have a sign-in or a click, one is claimed: three are free, capped at two.
  assert.match(replyText(r, false), /\nApplying now to F1 and F2 under your standing approval\. Say stop and I hold any of them\.$/);
  assert.doesNotMatch(replyText(r, false), /Say yes/);
  assert.match(replyText({ ...r, max_per_night: 9 }, false), /Applying now to F1, F2 and F3 under your standing approval\. Say stop and I hold any of them\.$/);
  // Nothing an agent can send alone: the usual closing.
  assert.match(replyText({ ...LINKED, auto_apply: true, max_per_night: 5 }, false), /Say yes and I apply to 3 and draft Click Grant for you to send\.$/);
  const note = agentNote(r, { more: 0 });
  assert.ok(note.includes('On stop, call track with status held for each program named.'));
  assert.ok(note.includes('Standing approval is on for only these: f1, f2. For each, call track started,'), note);
  assert.ok(!note.includes('Submit only'));
  assert.ok(note.includes("Draft each ready program from its fields: 'record' and 'earnkit' values as given, except a field marked fit 'cut', which you cut to its max_chars as its fit_note says;"));
  assert.ok(agentNote(MONDAY, { more: 0 }).includes("Draft each ready program from its fields: 'earnkit' values as given;"));
});

// L38 big 1 (v6.1.18 Task 10): a sign-in is said only when the action needs it; a yes to send needs none here (find
// gates a send with a repo), so no sign-in line, and the link stays in the JSON.
test('L38 big 1 (v6.1.18 Task 10): unlinked with a sign-in link and a yes that needs no sign-in: no sign-in line; linked never shows it', () => {
  const link = 'https://earnkit.test/link/abcdefghijklmnop';
  const text = replyText({ ...MONDAY, sign_in: link }, false, MON);
  const lines = text.split('\n');
  assert.equal(lines.at(-1), 'Say yes and I apply to all 2.');
  assert.equal(lines.at(-2), '');
  assert.doesNotMatch(text, /Sign in|remember you/);
  assert.match(replyText(MONDAY, false), /\n\nSay yes and I apply to all 2\.$/);
  assert.doesNotMatch(replyText({ ...LINKED, sign_in: link }, false), /Sign in once at/);
});

test('every linked line ends with a full stop and has no banned word', () => {
  for (const r of [LINKED, { ...LINKED, auto_apply: true, max_per_night: 5 }, { ...MONDAY, sign_in: 'https://earnkit.test/link/x' }]) {
    const text = replyText(r, false);
    assert.doesNotMatch(text, BANNED, text);
    assert.doesNotMatch(text, /\b(find|track|show_to_builder|agent_note|program_id|need_you|blockers)\b|\.json\b/, text);
    for (const line of text.split('\n').filter((l) => l.length > 0 && !l.endsWith(':'))) assert.ok(line.endsWith('.'), line);
  }
});

const RULE_NOTE =
  'A "Their rule" gap is a program rule EarnKit cannot check. If the builder says it fits, call track gap_done with that gap\'s item, then find again; with several rules on one row, one gap_done with the first rule item confirms every rule that row listed. Draft it and show the builder; submit only on a yes to the draft.';
const ruleGap = (what: string, item = 'rule:0000000a') => ({ kind: 'rule' as const, item, what, effort: 'hours' as const, agent_can: false });
const VIDEO = { kind: 'demo_video' as const, item: 'demo_video', what: 'a demo video link (a short screen recording of it working)', effort: 'hours' as const, agent_can: false };

test('rules (R18a): ready and in-person lines show none; a gap line shows its rules after the change, as one sentence (L1e-6, v6.1.13); with something ready no rule line asks its own "yes n" (L1e-2)', () => {
  const r = base({
    ready: [
      ready({
        title: 'Base Ecosystem Fund', money: 'pre-seed and seed investment', long_shot: 'an investment program with no stated amount', total: 2,
        rules: ['a pre-seed or seed stage startup that chooses Base as its home'], setup: ['sign in to the portal'], needs: ['sign in to the portal'],
      }),
      ready({ title: 'Meetup', money: '$5K', in_person: true, setup: ['be in Lisbon'], needs: ['be in Lisbon'], rules: ['a team of two or more'] }),
    ],
    gaps: [
      gap({ title: 'Goose Grants', money: '$10K', gap: ruleGap('a project built with or for goose'), also: [ruleGap('work not already funded by an employer or client', 'rule:0000000b')], rules: ['a project built with or for goose', 'work not already funded by an employer or client'] }),
      gap({ title: 'Colosseum', money: '$25K', gap: VIDEO, also: [ruleGap('the team has not raised venture capital')], rules: ['the team has not raised venture capital'] }),
    ],
  });
  assert.equal(
    replyText(r, true),
    [
      '1 program is ready to send now.',
      '',
      '1. Base Ecosystem Fund (pre-seed and seed investment). I apply once you say yes.',
      '2. Goose Grants ($10K) needs one yes from you: a project built with or for goose; work not already funded by an employer or client.',
      '3. Colosseum ($25K) needs a demo video link (a short screen recording of it working), then 1 more step.',
      '',
      'Also open: Meetup ($5K), in person.',
      '',
      'Sign in to the portal first, then say yes and I apply to Base Ecosystem Fund.',
    ].join('\n'),
  );
  // L1e-2 (v6.1.13): one yes per reply: something ready takes the closing, so the rule line asks no "yes n".
  assert.equal(replyText(r, true).match(/"yes 2"/g), null);
  assert.equal(replyText(r, true).match(/\bSay\b|, then say\b/g)?.length, 1);
  const lines = agentNote(r, { more: 0 }).split('\n');
  const at = lines.indexOf(RULE_NOTE);
  assert.ok(at > 0, lines.join('\n'));
  assert.match(lines[at - 1], /^Draft each ready program from its fields/);
  assert.ok(!agentNote(MONDAY, { more: 0 }).includes('Their rule'));
});

test('the closing line is one action (v6.1.8, 1a): yes to the ready ones, else "Nothing is ready yet." and the first rule\'s yes', () => {
  const rulesOnly = gap({ title: 'R', gap: ruleGap('x'), rules: ['x'] });
  const end = (r: R) => replyText(r, true).split('\n').at(-1);
  const nothingReady = replyText(base({ gaps: [rulesOnly] }), true);
  assert.equal(nothingReady.split('\n').at(-1), 'Say 1 if the R rule fits you and I draft it.');
  // Said once: the line the closing names does not ask it again.
  assert.equal(nothingReady.match(/\bSay 1\b/g)?.length, 1, nothingReady);
  assert.equal(end(base({ ready: MONDAY.ready, gaps: [rulesOnly] })), 'Say yes and I apply to all 2.');
  // L1e-2 (v6.1.13): with something ready, the rule reads as a plain sentence; "yes 3" still works in track.
  assert.match(replyText(base({ ready: MONDAY.ready, gaps: [rulesOnly] }), true), /^3\. R \(\$1K\) needs one yes from you: x\.$/m);
  assert.equal(end(base({ gaps: [rulesOnly, MONDAY.gaps[0]] })), 'Say 1 if the R rule fits you and I draft it.');
  // M1 (v6.1.9): with no rule-only program shown, the closing offers the first step.
  assert.equal(end(base({ gaps: [MONDAY.gaps[0]] })), 'Tell me when the contract is on Arc and I look again.');
  // C44: the builder presses submit on every ready one, so the agent drafts.
  const clicks = MONDAY.ready.map((p) => ({ program_id: p.program_id, sign_in: null, needs_click: true, needs: [] }));
  assert.equal(end({ ...MONDAY, blockers: clicks }), 'Say yes and I draft all 2 for you to send.');
  assert.equal(end(base({ ready: [MONDAY.ready[0]], blockers: [clicks[0]] })), 'Say yes and I draft it for you to send.');
  assert.equal(end({ ...MONDAY, blockers: [clicks[0]] }), 'Say yes and I apply to Arc Builders Fund and draft Alliance ALL19 for you to send.');
  assert.doesNotMatch(agentNote(base({ gaps: [rulesOnly] }), { more: 0 }), /On "do <n>"/);
  assert.ok(agentNote(base({ gaps: [rulesOnly] }), { more: 0 }).includes(RULE_NOTE));
});

test('R18d, O2 (v6.1.10, Review Focus 5), L38 big 3 (v6.1.18 Task 10): an in-person gap line says what attending takes, after its rules; every in-person one with gaps is in the In person block (T3-R5: with no yes of its own)', () => {
  const attend = { in_person: true, setup: ['work 3 months from the office'] };
  const r = base({
    gaps: [
      gap({ title: 'Residency', money: '$500K', gap: ruleGap('a co-founder with US work authorization'), rules: ['a co-founder with US work authorization'], ...attend }),
      gap({ title: 'Camp', money: '$10K', gap: VIDEO, also: [ruleGap('a team of two')], rules: ['a team of two'], ...attend }),
    ],
  });
  // L38 big 3: Camp has a real gap and still lists under In person (the Monad Blitz bug), never under a step heading.
  assert.equal(
    replyText(r, true),
    [
      'Nothing remote is ready yet.',
      '',
      'Also open: Residency ($500K, one yes from you: a co-founder with US work authorization) and Camp ($10K), in person.',
      '',
      'Say yes and I start the in-person applications.',
    ].join('\n'),
  );
  // The attend sentence after the rules is the agent's line (and the one-program reply's).
  assert.deepEqual(replyParts(r, true).hidden, [
    "1. Residency, $500K. Their rule: a co-founder with US work authorization. First: work 3 months from the office.",
    "2. Camp, $10K: a demo video link (a short screen recording of it working). Their rule: a team of two. First: work 3 months from the office.",
  ]);
  assert.equal(replyText(r, true, new Date(), null, { all: true }).split('\n').slice(0, 3).join('\n'), [
    'Everything open, nearest first:',
    '',
    'In person:',
  ].join('\n'));
});

test('O2 (v6.1.10, Review Focus 5): a reply that lists in-person programs never ends on "Nothing is ready yet"; rule-only ones follow the ready ones in the block', () => {
  const yc = ready({ title: 'Y Combinator', money: '$500K investment', in_person: true, setup: ['a YC account'], needs: ['a YC account'] });
  const antler = gap({ title: 'Antler', money: '$250K', in_person: true, gap: ruleGap('a co-founder with US work authorization'), rules: ['a co-founder with US work authorization'] });
  const floss = gap({ title: 'FLOSS/fund', money: '$10,000 to $100,000', gap: { kind: 'users', item: 'users', what: 'real users', effort: 'hours', agent_can: false } });
  const otf = gap({ title: 'OTF', money: '$900K', gap: ruleGap('advances internet freedom') });
  const r = base({ ready: [yc], gaps: [floss, otf, antler] });
  assert.equal(
    replyText(r, true),
    [
      'Nothing is ready to send yet. The closest:',
      '',
      '1. FLOSS/fund ($10,000 to $100,000) needs real users first.',
      '2. OTF ($900K) needs one yes from you: advances internet freedom.',
      '',
      'Also open: Y Combinator ($500K) and Antler ($250K, one yes from you: a co-founder with US work authorization), in person.',
      '',
      'Say 2 if the OTF rule fits you and I draft it.',
    ].join('\n'),
  );
  // In person alone, or rule-only in person alone: the in-person closing.
  assert.equal(replyText(base({ ready: [yc] }), true).split('\n').at(-1), 'Say yes and I start the in-person applications.');
  assert.equal(replyText(base({ gaps: [antler] }), true).split('\n').at(-1), 'Say yes and I start the in-person applications.');
  // T3-R5 (v6.1.13): the closing is the only Say, beside a rule-only in-person line and a remote rule alike.
  for (const gaps of [[antler], [gap({ title: 'Open', gap: ruleGap('an open licence'), rules: ['an open licence'] }), antler]]) {
    const t = replyText(base({ gaps }), true);
    assert.equal(t.match(/\bSay\b/g)?.length, 1, t);
  }
  // A remote step shown: its step closes the reply, in-person programs listed or not.
  // L29-34 (v6.1.16 Task 15): unlinked, the one ask holds the sign-in; linked, the yes applies.
  assert.equal(replyText(base({ gaps: [floss] }), true).split('\n').at(-1), 'Do real people use it? Say yes, sign in, and I check.');
  assert.equal(replyText(base({ ready: [yc], gaps: [floss] }), true).split('\n').at(-1), 'Do real people use it? Say yes, sign in, and I check.');
  assert.equal(replyText(base({ linked: true, gaps: [floss] }), true).split('\n').at(-1), 'Do real people use it? Say yes and I check.');
  assert.equal(replyText(base({ ready: [yc], gaps: [gap({ title: 'Circle' })] }), true).split('\n').at(-1), 'Say 2 and I draft Y Combinator for you to send.');
  // A remote step that names its own action ("do n") and in-person programs: never the bare line.
  const codes = gap({ title: 'Base Batches', gap: { kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes', agent_can: true } });
  assert.equal(replyText(base({ gaps: [codes] }), true).split('\n').at(-1), 'Say do 1 and I add the codes.');
  // v6.1.20: a change EarnKit makes on a remote program comes before the in-person applications' long odds.
  assert.equal(replyText(base({ ready: [yc], gaps: [codes] }), true).split('\n').at(-1), 'Say do 1 and I add the codes.');
  // Something remote ready: its yes, never the in-person closing.
  assert.equal(replyText(base({ ready: [ready({ title: 'Grant' }), yc], gaps: [antler] }), true).split('\n').at(-1), 'Say yes and I apply to Grant.');
  assert.match(agentNote(r, { more: 0 }), /closes on starting the in-person applications/);
});

test('O1 (v6.1.10): a step closing within 7 days says so after its money', () => {
  const paypal = gap({ title: 'PayPal AI Hackathon', money: '$67,500 in prizes', closes_in: 'in 2 days', gap: VIDEO, also: [ruleGap('uses a PayPal API')] });
  assert.equal(replyText(base({ gaps: [paypal] }), true).split('\n')[2], '1. PayPal AI Hackathon ($67,500 in prizes, closes in 2 days) needs a demo video link (a short screen recording of it working) first, and one yes from you: uses a PayPal API.');
  const rule = gap({ title: 'Kiroween', money: '$100K', closes_in: 'in 5 days', gap: ruleGap('built with Kiro') });
  // L38 big 3 (v6.1.18 Task 10): the one-step row heads the list, so it is number 1; PayPal (a change and a rule) is more.
  const both = replyText(base({ gaps: [paypal, rule] }), true).split('\n');
  assert.equal(both.at(-1), 'Say 1 if the Kiroween rule fits you and I draft it.');
  assert.deepEqual(both.slice(0, 4), [
    'Nothing is ready to send yet. The closest:',
    '',
    '1. Kiroween ($100K, closes in 5 days) needs one yes from you: built with Kiro.',
    '2. PayPal AI Hackathon ($67,500 in prizes, closes in 2 days) needs a demo video link (a short screen recording of it working), then 1 more step.',
  ]);
});

test('R20/R21: an in-person line says its odds, then what attending takes, then what it needs from you (v6.1.6)', () => {
  const yc = ready({
    title: 'Y Combinator Winter 2027 Batch', money: '$500K investment', in_person: true, long_shot: 'many apply, few are taken',
    setup: ['a YC account'], needs: ['a YC account', 'your application answers', 'batch preference'],
  });
  const alliance = ready({
    title: 'Alliance ALL19', money: '$400K at admission', closes_in: 'in 14 days', in_person: true,
    setup: ["start the application with the first founder's email", 'your passport'], needs: ["start the application with the first founder's email", 'your passport'],
  });
  const bare = ready({ title: 'Bare Summit', money: '$5K', in_person: true });
  // L38 big 2 (v6.1.18 Task 10): the default view's one line names number, name, money and close; the full line (the
  // one-program reply's and the agent's) keeps the odds, what attending takes and the needs.
  const r = base({ ready: [yc, alliance, bare] });
  assert.equal(replyText(r, true).split('\n')[2], 'Also open: Y Combinator Winter 2027 Batch ($500K), Alliance ALL19 ($400K, closes in 14 days) and Bare Summit ($5K), in person.');
  assert.deepEqual(
    replyParts(r, true).hidden,
    [
      '1. Y Combinator Winter 2027 Batch, $500K investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and batch preference.',
      "2. Alliance ALL19, $400K at admission, closes in 14 days. First: start the application with the first founder's email; your passport.",
      '3. Bare Summit, $5K. Attend in person.',
    ],
  );
  // Every row with long odds: the head says so once.
  assert.equal(replyText(base({ ready: [yc, { ...alliance, long_shot: 'many apply, few are taken' }] }), true).split('\n')[0],
    'Nothing remote is ready yet.');
});

test('R21: an in-person gap with no setup reads "Attend in person." after its rules (v6.1.6); L38 big 2: the agent\'s line', () => {
  const g = gap({ title: 'Residency', money: '$1M', in_person: true, gap: ruleGap('a US co-founder'), rules: ['a US co-founder'] });
  assert.equal(
    replyParts(base({ gaps: [g] }), true).hidden[0],
    '1. Residency, $1M. Their rule: a US co-founder. Attend in person.',
  );
  const withSetup = { ...g, setup: ['the right to work in the US'] };
  assert.equal(
    replyParts(base({ gaps: [withSetup] }), true).hidden[0],
    '1. Residency, $1M. Their rule: a US co-founder. Needs the right to work in the US.',
  );
});

test('R21: the Before block never names an in-person program\'s sign-in or click; others unchanged (v6.1.6)', () => {
  const r = base({
    ready: [
      ready({ program_id: 'yc', title: 'Y Combinator', in_person: true, setup: ['a YC account'], needs: ['a YC account'] }),
      ready({ program_id: 'cl', title: 'Click Grant' }),
    ],
    blockers: [
      { program_id: 'yc', sign_in: 'Y Combinator', needs_click: true, needs: [] },
      { program_id: 'cl', sign_in: 'email', needs_click: true, needs: [] },
    ],
  });
  const before = replyText(r, true).split('\n').find((b) => b.startsWith('Before applying: '));
  assert.equal(before, 'Before applying: you sign in by email and press submit yourself on Click Grant.');
  // C46: an in-person program is never in the outside-approval list.
  const outside = base({ ...r, blockers: r.blockers.map((b) => ({ ...b, needs_click: false, outside_approval: true as const })) });
  assert.equal(
    replyText(outside, true).split('\n').find((b) => b.startsWith('Before applying: ')),
    'Before applying: you sign in by email for Click Grant.',
  );
  const onlyYc = base({ ready: r.ready.filter((p) => p.in_person), blockers: [r.blockers[0]] });
  assert.ok(!replyText(onlyYc, true).includes('Before applying'), replyText(onlyYc, true));
});

test('L38 big 1 (v6.1.18 Task 10): with no repo read, no sentence promises to remember the builder', () => {
  const link = 'https://earnkit.test/link/abcdefghijklmnop';
  const text = replyText({ ...MONDAY, sign_in: link, as_reported: true }, false);
  assert.doesNotMatch(text, /remember you|Sign in/);
});

test('R26, L29-26: the left-out count and the lines the default view left out go to the agent', () => {
  assert.ok(agentNote(MONDAY, { more: 4 }).split('\n').includes('The full list holds 4 more; show it when the builder asks for all, more or the full list. Call find with filter.all for it.'));
  const n = agentNote(MONDAY, { more: 0, hidden: ['5. Hidden Grant, $1K.'] }).split('\n');
  assert.ok(n.includes('Not shown to the builder:') && n.includes('5. Hidden Grant, $1K.'));
  assert.ok(n.includes('When the builder says more, call find with filter.all.'));
});

// L29-33 (v6.1.16 Task 15): the notice comes before the Say; L1j-6 (v6.1.17): before a closing with no Say too.
test('a linked notice is its own line: before the Say, or before a closing that asks nothing', () => {
  const notice = 'This agent is now linked to GitHub account ada. Unlink any time at earnkit.com/me.';
  assert.equal(replyText(base({ linked: true, linked_notice: notice }), false), `Nothing fits yet. Tell me more about it, or its repo link, and I look again.\n\n${notice}`);
  assert.equal(replyText(base({ linked: true, linked_notice: notice, ready: [ready({ title: 'A' })] }), false).split('\n\n').slice(-2).join('\n\n'), `${notice}\n\nSay yes and I apply to A.`);
  assert.ok(!replyText(base({ linked: true }), false).includes('now linked'));
});

test('a program another agent of the builder holds goes in its own block after Ready and leaves the count to say yes to (v6.1.7, C37; L17-6 v6.1.16)', () => {
  const NOW = new Date('2026-11-04T12:00:00Z');
  const r = base({
    linked: true,
    ready: [
      ready({ title: 'Free One' }),
      ready({ title: 'Held One', claimed_since: '2026-11-04T10:00:00.000Z' }),
      ready({ title: 'Free Two' }),
      ready({ title: 'Held Two', claimed_since: '2026-11-03T22:10:00.000Z' }),
    ],
  });
  const text = replyText(r, false, NOW);
  const lines = text.split('\n');
  // L17-6 (v6.1.16): Ready lists what this agent can send. L29-26 (v6.1.16 Task 15): the held ones are the agent's
  // (Not shown) and the full view's, numbered on, with no held sentence.
  // L1j-3 (v6.1.17): the held rows left out are counted.
  assert.equal(text, [
    '2 programs are ready to send now.',
    '',
    '1. Free One ($1K). I apply once you say yes.',
    '2. Free Two ($1K). I apply once you say yes.',
    '',
    'Also: 2 more in the full list.',
    '',
    'Say yes and I apply to all 2.',
  ].join('\n'));
  assert.deepEqual(replyParts(r, false, NOW).hidden, ['3. Held One, $1K.', '4. Held Two, $1K.']);
  assert.ok(!lines.some((l) => /^\d+\. .*Being handled/.test(l)), text);
  // One free: the singular; none free: no yes at all, and nothing claims "nothing fits".
  const one = base({ linked: true, ready: [ready({ title: 'Free One' }), ready({ title: 'Held One', claimed_since: '2026-11-04T10:00:00.000Z' })] });
  assert.match(replyText(one, false, NOW), /\nSay yes and I apply to Free One\.$/);
  const none = base({ linked: true, ready: [ready({ title: 'Held One', claimed_since: '2026-11-04T10:00:00.000Z' })] });
  const t = replyText(none, false, NOW);
  assert.doesNotMatch(t, /Say yes|Nothing fits/);
  assert.match(t, /\nYour other agent is handling these\.$/);
});

test('C1 (v6.1.13), ruling 12 (v6.1.16): a program held for another project never names it; remote it goes in the held block, in person its line says it is held; the count to say yes to leaves it', () => {
  const NOW = new Date('2026-11-04T12:00:00Z');
  const r = base({
    linked: true,
    ready: [
      ready({ title: 'Free One' }),
      ready({ title: 'Held One', claimed_since: '2026-11-04T10:00:00.000Z' }),
      ready({ title: 'Free Two' }),
      ready({ title: 'Held Away', in_person: true, claimed_since: '2026-11-04T10:00:00.000Z' }),
    ],
  });
  const text = replyText(r, false, NOW);
  const lines = text.split('\n');
  assert.doesNotMatch(text, /Rent Split/);
  const hidden = replyParts(r, false, NOW).hidden;
  assert.ok(hidden.includes('4. Held One, $1K.'), hidden.join('|'));
  assert.ok(hidden.some((l) => /^3\. Held Away, \$1K\..* Being handled by your other agent\.$/.test(l)), hidden.join('|'));
  assert.doesNotMatch(JSON.stringify(hidden), /Rent Split/);
  assert.equal(lines.at(-1), 'Say yes and I apply to all 2.');
});

test('C1 fix round 1 (I2): one held in-person program and nothing else ready never ends in the in-person closing', async () => {
  const { IN_PERSON_CLOSING } = await import('./reply');
  const NOW = new Date('2026-11-04T12:00:00Z');
  const r = base({ linked: true, ready: [ready({ title: 'Held Away', in_person: true, claimed_since: '2026-11-04T10:00:00.000Z' })] });
  const text = replyText(r, false, NOW);
  // L38 big 2 (v6.1.18 Task 10): the one In person line says it.
  assert.match(text, /^Also open: Held Away \(\$1K, started by your other agent\), in person\.$/m);
  assert.doesNotMatch(text, /Rent Split/);
  assert.notEqual(text.split('\n').at(-1), IN_PERSON_CLOSING);
  assert.doesNotMatch(text, /Say yes/);
});

test('I1 (v6.1.8 final fix): one ready program held by another agent and one gap shown never closes "Nothing is ready yet."', () => {
  const NOW = new Date('2026-11-04T12:00:00Z');
  const RULE = { kind: 'rule' as const, item: 'rule:abcd1234', what: 'a public good', effort: 'hours' as const, agent_can: false };
  const r = base({
    linked: true,
    ready: [ready({ n: 1, title: 'Held One', claimed_since: '2026-11-04T10:00:00.000Z' })],
    gaps: [gap({ n: 2, title: 'Rule Grant', gap: RULE })],
  });
  const t = replyText(r, false, NOW);
  // L17-6 (v6.1.16): the held one has its own block; nothing is under Ready.
  assert.match(t, /^1 program is ready, started by your other agent\.\n\n1\. Held One \(\$1K\), started by your other agent\.$/m, t);
  assert.doesNotMatch(t, /Ready to apply/, t);
  assert.match(t, /^2\. Rule Grant \(\$1K\) needs one yes from you: a public good\.$/m, t);
  assert.doesNotMatch(t, /Nothing is ready yet/, t);
  assert.match(t, /\nYour other agent is handling these\.$/, t);
  // T3-R5 (v6.1.13): no rule line asks its own yes, whatever the closing; "yes 2" still works in track.
  // (the line pinned above)
  assert.match(t, /^2\. Rule Grant \(\$1K\) needs one yes from you: a public good\.$/m, t);
});

test('the one-program reply (v6.1.8, 1b): the gap line without its number or "do n", and one action by what the gap is', () => {
  const BC = { kind: 'builder_codes' as const, item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'hours' as const, agent_can: true };
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users', effort: 'hours' as const, agent_can: false };
  const codes = gap({ title: 'Base Grant', n: 3, gap: BC });
  assert.equal(gapLine(codes, true), 'Base Grant, $1K: add Base Builder Codes to the app.');
  assert.equal(gapLine(codes), '3. Base Grant, $1K: add Base Builder Codes to the app.');
  assert.equal(gapAction(codes), 'Say do and I add Base Builder Codes to the app first.');
  assert.equal(gapAction(gap({ title: 'Two', gap: BC, also: [{ ...BC, kind: 'integration', item: 'integration:x', what: 'add X' }] })), 'Say do and I make both changes first.');
  // A contract deploy is the builder's (keys and gas).
  assert.equal(gapAction(gap({ title: 'Arc Grant' })), 'Tell me when the contract is on Arc and I look again.');
  assert.equal(gapAction(gap({ title: 'Video', gap: VIDEO, also: [ruleGap('a team')] })), 'Send me the demo video link and I fill it in.');
  assert.equal(gapAction(gap({ title: 'Used', gap: USERS })), 'Say yes if they do and I draft it.');
  const rule = gap({ title: 'Fund', n: 2, gap: ruleGap('a seed stage startup') });
  assert.equal(gapLine(rule, true), 'Fund, $1K. Their rule: a seed stage startup.');
  assert.equal(gapAction(rule), 'Say yes if that is you and I draft it.');
  // In person: the line says to attend; no action line.
  const attend = gap({ title: 'Residency', in_person: true, gap: ruleGap('a US co-founder') });
  assert.equal(gapLine(attend, true), 'Residency, $1K. Their rule: a US co-founder. Attend in person.');
  assert.equal(gapAction(attend), null);
  assert.equal(notFitLine('Base Grant', '$1K', 'needs a contract on Base'), 'Base Grant ($1K). Not a fit: needs a contract on Base.');
});

test('M1 (v6.1.9): nothing ready and no rule-only program shown: the closing offers the first step, the users question as a yes', () => {
  const end = (r: R) => replyText(r, true).split('\n').at(-1);
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users', effort: 'hours' as const, agent_can: false };
  const floss = gap({ title: 'FLOSS/fund', gap: USERS });
  assert.equal(end(base({ gaps: [floss] })), 'Do real people use it? Say yes, sign in, and I check.');
  // A demo video (with a rule beside it) listed first: the cheaper users question still closes (fix round 1, v6.1.12).
  const vr = gap({ title: 'Meta VR', gap: VIDEO, also: [ruleGap('hands first')], rules: ['hands first'] });
  assert.equal(end(base({ gaps: [vr, floss] })), 'Do real people use it? Say yes, sign in, and I check.');
  // I2 (v6.1.9 final): the only step program shown carries a rule: the rule is asked first, once.
  const vrAlone = replyText(base({ gaps: [vr] }), true);
  assert.equal(vrAlone.split('\n').at(-1), 'Say 1 if the Meta VR rule fits you and I draft it.');
  assert.equal(vrAlone.match(/\bSay 1\b/g)?.length, 1, vrAlone);
  assert.equal(stepRuleOf([{ ...vr, n: 3 }]), 3);
  assert.equal(stepRuleOf([vr, floss]), null);
  assert.equal(stepRuleOf([floss]), null);
  assert.equal(stepRuleOf([{ ...vr, in_person: true }]), null);
  // Something ready keeps the yes to apply.
  assert.equal(end(base({ ready: [MONDAY.ready[0]], gaps: [vr] })), 'Say yes and I apply to Alliance ALL19.');
  // A program EarnKit makes ("do n" on its line) or a sign-in step is passed over for the next program's step.
  const codes = gap({ title: 'Base Batches', gap: { kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes', agent_can: true } });
  const signIn = gap({ title: 'Live Grant', gap: { kind: 'tier', item: 'tier:live', what: 'proof that your product is live', effort: 'weeks', agent_can: false } });
  // F2 (fix round 1, v6.1.14): the proof gap shown with no link: the linkless sign-in follows the closing.
  assert.equal(end(base({ gaps: [codes, signIn, floss] })), 'Do real people use it? Say yes, sign in, and I check.');
  assert.equal(end(base({ gaps: [codes, signIn] })), 'Say do 1 and I add the codes.');
  // A rule-only program shown keeps its "yes n"; something ready keeps the yes to apply.
  const rule = gap({ title: 'R', gap: ruleGap('x'), rules: ['x'] });
  assert.equal(end(base({ gaps: [floss, rule] })), 'Say 2 if the R rule fits you and I draft it.');
  assert.equal(end(base({ ready: [MONDAY.ready[0]], gaps: [floss] })), 'Say yes and I apply to Alliance ALL19.');
  for (const t of [end(base({ gaps: [floss] })), end(base({ gaps: [vr] }))]) assert.doesNotMatch(t!, /—|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
});

test('L1e-5 and L1e-2 (v6.1.13, Review Focus 7): the closing asks a keyword-hit rule first; a ready program leaves exactly one "Say"', () => {
  const a = gap({ program_id: 'a', title: 'Open Rule', money: '$9K', gap: ruleGap('an open licence'), rules: ['an open licence'] });
  const hit = gap({ program_id: 'b', title: 'Student Rule', money: '$5K', gap: ruleGap('a student', 'rule:0000000c'), rules: ['a student'], keyword_hit: true });
  const all = replyText(base({ gaps: [a, hit] }), true);
  assert.equal(all.split('\n').at(-1), 'Say 2 if the Student Rule rule fits you and I draft it.');
  // T3-R5: the closing is the only Say; the other rule line reads its rule alone.
  // L1i-2 (v6.1.16.1): both rows fit, numbered as shown; only the closing asks.
  assert.match(all, /^1\. Open Rule \(\$9K\) needs one yes from you: an open licence\.$/m);
  assert.equal(all.match(/\bSay\b/g)?.length, 1, all);
  // No hit: the first in list order, as before.
  assert.equal(replyText(base({ gaps: [a, { ...hit, keyword_hit: undefined }] }), true).split('\n').at(-1), 'Say 1 if the Open Rule rule fits you and I draft it.');
  // A ready FLOSS/fund with Thiel on line 2: one Say in the whole reply.
  const floss = ready({ program_id: 'floss-fund-zerodha', title: 'FLOSS/fund', money: '$10,000 to $100,000' });
  const thiel = gap({ program_id: 'thiel-fellowship', title: 'Thiel Fellowship', money: '$250,000 over two years', gap: ruleGap('applicant aged 22 or younger'), rules: ['applicant aged 22 or younger'], keyword_hit: true });
  const text = replyText(base({ ready: [floss], gaps: [thiel] }), true);
  assert.equal(text.match(/\bSay\b/g)?.length, 1, text);
  assert.match(text, /^2\. Thiel Fellowship \(\$250,000 over two years\) needs one yes from you: applicant aged 22 or younger\.$/m);
  assert.equal(text.split('\n').at(-1), 'Say yes and I apply to FLOSS/fund.');
});

/** L24-2 (v6.1.16 Task 11): "Your yes stands" pins read after an apply offer. */
const afterApply = (r: R, first: boolean) => replyText(r, first, new Date(), 'apply');

test('L24-2 (v6.1.16 Task 11): after a question (look again, a rule, a draft) a rule yes never stands: the apply offer is made afresh', () => {
  const one = base({ ready: [ready({ title: 'Users Grant', rule_yes: true })], gaps: [gap({ title: 'Other', gap: VIDEO })] });
  for (const last of [null, 'look_again', 'rule', 'draft', 'do', 'stop'] as const) {
    const t = replyText(one, true, new Date(), last);
    assert.doesNotMatch(t, /Your yes stands/, String(last));
    assert.equal(t.split('\n\n').at(-1), 'Say yes and I apply to Users Grant.', String(last));
  }
  assert.equal(replyText(one, true, new Date(), 'apply').split('\n\n').at(-1), 'Your yes stands for Users Grant: I apply now.');
  // The offer kind of each closing.
  assert.equal(replyParts(one, true, new Date(), null).offer, 'apply');
  assert.equal(replyParts(base({ gaps: [gap({ title: 'R', gap: ruleGap('x'), rules: ['x'] })] }), true).offer, 'rule');
  const users = gap({ title: 'U', gap: { kind: 'users', item: 'users', what: 'real users', effort: 'hours', agent_can: false }, setup: ['sign in'] });
  assert.equal(replyParts(base({ gaps: [users] }), true).text.split('\n').at(-1), 'Do real people use it? Say yes, sign in, and I check.');
  assert.equal(replyParts(base({ gaps: [users] }), true).offer, 'look_again');
  // No agent note says to submit without asking again.
  assert.doesNotMatch(RULE_NOTE, /without asking/);
  assert.match(RULE_NOTE, /Draft it and show the builder; submit only on a yes to the draft\.$/);
});

test('v6.1.9: after the builder\'s yes on a rule, the program it made ready is applied to without a second yes', () => {
  const one = base({ ready: [ready({ title: 'Solana Foundation Grants', rule_yes: true, rules: ['a public good'] })] });
  assert.equal(afterApply(one, true).split('\n\n').at(-1), 'Your yes stands for Solana Foundation Grants: I apply now.');
  const two = base({ ready: [ready({ title: 'Solana Foundation Grants', rule_yes: true }), ready({ title: 'Other Grant' })] });
  assert.equal(afterApply(two, true).split('\n\n').at(-1), 'Your yes stands for Solana Foundation Grants: I apply now. Say yes and I apply to Other Grant.');
  // The builder presses submit on it: no "I apply now"; L1e-3 (v6.1.13): the yes stands, in the draft wording.
  const click = base({ ready: [ready({ title: 'Click Grant', rule_yes: true })], blockers: [{ program_id: 'click-grant', sign_in: null, needs_click: true, needs: [] }] });
  assert.equal(afterApply(click, true).split('\n\n').at(-1), 'Your yes stands for Click Grant: I draft it for you to send.');
  // Review Focus 8 (L1e-3): with answers missing, the closing names them and never asks for yes again.
  const thiel = base({
    ready: [ready({ program_id: 'thiel-fellowship', title: 'Thiel Fellowship', rule_yes: true, need_you: ['the online application answers'], needs: ['the online application answers'] })],
    blockers: [{ program_id: 'thiel-fellowship', sign_in: null, needs_click: true, needs: [] }],
  });
  const end = afterApply(thiel, true).split('\n\n').at(-1);
  assert.equal(end, 'Thiel Fellowship needs your online application answers; then I draft it for you to send.');
  assert.doesNotMatch(afterApply(thiel, true), /Say yes/);
  // A sign-in the agent does not have: no "I apply now" either (final review M2).
  const signIn = base({ ready: [ready({ title: 'Mail Grant', rule_yes: true })], blockers: [{ program_id: 'mail-grant', sign_in: 'email', needs_click: false, needs: [] }] });
  assert.doesNotMatch(afterApply(signIn, true), /I apply now/);
});

test('v6.1.9: the standing note asks for every required answer; record_missing is told apart from record get', () => {
  const note = agentNote(base({ auto_apply: true, linked: true, record_missing: ['your email'] }), { more: 0 });
  // L29-29 (v6.1.16 Task 15): the standing note shows only when the approval covers a program; with nothing listed, one line.
  const covered = agentNote(base({ auto_apply: true, max_per_night: 5, linked: true, ready: [ready({ title: 'Full', from_record: 1, total: 1 })], record_missing: ['your email'] }), { more: 0 });
  assert.ok(covered.includes('send only when every required answer is filled.'), covered);
  assert.equal(note.split('\n').length, 1);
  assert.ok(covered.includes('record_missing names only what these programs need; record get names everything the record lacks.'));
  // Fix round 1 (M2): one label.
  assert.match(replyText(base({ linked: true, record_missing: ['your email'], ready: [ready({ title: 'A' })] }), true), /\nBefore applying: your email\.\n/);
});

test('v6.1.9: Builder Codes reported but not in the code read is said once', () => {
  const show = replyText(base({ repo_notes: ['no_builder_codes', 'no_builder_codes'] }), true);
  assert.equal(show.split('The repo does not send Builder Codes yet.').length, 2);
});

test('v6.1.9: an in-person need the setup step already names is said once', () => {
  const r = base({ ready: [ready({ title: 'Alliance ALL19', in_person: true, setup: ["open the application with the first founder's email"], needs: ["open the application with the first founder's email", "the first founder's email"] })] });
  // L38 big 2 (v6.1.18 Task 10): the full in-person line is the agent's (and the one-program reply's).
  const line = replyParts(r, true).hidden.find((l) => l.includes('Alliance'))!;
  assert.equal(line, "1. Alliance ALL19, $1K. First: open the application with the first founder's email.");
});

test('S6 fix round 1 (v6.1.9): tonight names only sends with every required answer; the others wait, named', () => {
  const r = base({
    auto_apply: true, max_per_night: 5, auto_sent_today: 0, linked: true,
    ready: [ready({ title: 'Full Grant' }), ready({ title: 'Short Grant', needs: ['the problem'] })],
  });
  // L29-18 (v6.1.16 Task 15): one label, "Before applying:".
  assert.equal(replyText(r, true), '2 programs are ready to send now.\n\n1. Full Grant ($1K). I send it under your standing approval.\n2. Short Grant ($1K). I apply once you say yes.\n\nBefore applying: your problem for Short Grant.\n\nApplying now to Full Grant under your standing approval. Say stop and I hold any of them.');
  // Nothing can go tonight: no tonight line, the wait is named, and the builder can still say yes.
  const none = base({ auto_apply: true, max_per_night: 5, auto_sent_today: 0, linked: true, ready: [ready({ title: 'Short Grant', needs: ['the problem'] })] });
  const show = replyText(none, true);
  assert.doesNotMatch(show, /Under your standing approval|The sends? goes? ahead/);
  assert.match(show, /Before applying: your problem for Short Grant\.\n\nSay yes and I apply to Short Grant\.$/);
});

test('fix round 1 (v6.1.9): a contract the read still does not find tells the agent to pass its address', () => {
  const g = gap({ title: 'Arc Fund', gap: { kind: 'chain', item: 'chain:arc', what: 'deploy the contract on Arc', effort: 'hours', agent_can: false }, looked_again: ['the contract on Arc'] });
  assert.ok(agentNote(base({ gaps: [g] }), { more: 0 }).split('\n').includes('Pass the contract address if it is on chain.'));
  assert.ok(!agentNote(base({ gaps: [gap({ title: 'Arc Fund' })] }), { more: 0 }).includes('Pass the contract address'));
});

test('O3 (v6.1.10): the started question is asked as one: its line, its one action and the closing', () => {
  const STARTED = { kind: 'new_work_after' as const, item: 'new_work_after:2026-10-22T09:00:00-07:00', what: 'tell me when you started this', effort: 'minutes' as const, agent_can: false };
  const g = gap({ title: 'UGREEN Hackathon 2026 on AI NAS', money: '$46,000 in prizes', gap: STARTED, n: 1 });
  assert.equal(gapLine(g), '1. UGREEN Hackathon 2026 on AI NAS, $46,000 in prizes: tell me when you started this.');
  assert.equal(gapAction(g), 'Tell me when you started and I check it.');
  const show = replyText(base({ gaps: [g] }), true);
  assert.equal(show.split('\n').at(-1), 'Tell me when you started and I check it.');
  assert.match(agentNote(base({ gaps: [g] }), { more: 0 }), /"Tell me when you started this" is a question, not work: ask the builder once; pass first_commit_at/);
  assert.doesNotMatch(show, /—|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
});

test('L1d-2 (v6.1.11, Review Focus 2): a gap line names its setup steps as "First:" after its gaps and before its rules', () => {
  const setup = ['sign up for a Colosseum account', 'start the four-week sprint in the Eternal dashboard'];
  const vc = 'the team has not raised venture capital for the startup it submits';
  const g = gap({ title: 'Colosseum Eternal', money: '$25,000 award', gap: VIDEO, also: [ruleGap(vc)], rules: [vc], setup });
  const line = 'Colosseum Eternal, $25,000 award: a demo video link (a short screen recording of it working). First: sign up for a Colosseum account; start the four-week sprint in the Eternal dashboard. Their rule: the team has not raised venture capital for the startup it submits.';
  assert.equal(gapLine({ ...g, n: 2 }), `2. ${line}`);
  assert.equal(gapLine({ ...g, n: 2 }, true), line);
  assert.doesNotMatch(gapLine({ ...g, n: 2 }), /: a demo video\. Their rule/);
  // Rules only: the steps come before the rules and the "yes n" ask.
  const ruled = gap({ title: 'Sprint', money: '$5K', gap: ruleGap('a crypto product'), rules: ['a crypto product'], setup: ['sign up for an account'] });
  assert.equal(gapLine({ ...ruled, n: 1 }), '1. Sprint, $5K. First: sign up for an account. Their rule: a crypto product.');
  // With "do n" and the sign-in sentence, the steps follow every gap sentence.
  const codes = { kind: 'builder_codes' as const, item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes' as const, agent_can: true };
  const done = gap({ title: 'Base', money: '$5K', gap: codes, setup: ['sign in to the portal'] });
  assert.equal(gapLine({ ...done, n: 3 }), '3. Base, $5K: add Base Builder Codes to the app. First: sign in to the portal.');
  // No setup: unchanged.
  assert.equal(gapLine({ ...gap({ title: 'C', money: '$1K', gap: VIDEO }), n: 1 }), '1. C, $1K: a demo video link (a short screen recording of it working).');
});

test('L1d-2 (v6.1.11): an in-person gap line keeps its one attend sentence, never a second "First:"', () => {
  const g = gap({ title: 'Blitz', money: '$1K', in_person: true, gap: ruleGap('a team of two'), rules: ['a team of two'], setup: ['be in Eugene, Oregon on November 15'] });
  const line = gapLine({ ...g, n: 1 });
  assert.equal(line, '1. Blitz, $1K. Their rule: a team of two. First: be in Eugene, Oregon on November 15.');
  assert.equal(line.match(/First:/g)!.length, 1);
});

test('N3 (v6.1.12, Review Focus 2): after a rule yes or a users yes on a program that still needs answers, the closing names them and never asks for yes again', () => {
  const sol = ready({ title: 'Solana Foundation Grants', rule_yes: true, need_you: ['your website link', 'the requested amount'], needs: ['your website link', 'the requested amount'] });
  const end = (r: R) => afterApply(r, true).split('\n\n').at(-1)!;
  assert.equal(end(base({ ready: [sol] })), 'Solana Foundation Grants needs your website link and requested amount; then I apply.');
  // Three needs read "a, b and c".
  const three = ready({ title: 'FLOSS/fund', rule_yes: true, need_you: ['your funding manifest link', 'the problem', 'a demo video'], needs: ['your funding manifest link', 'the problem', 'a demo video'] });
  assert.equal(end(base({ ready: [three] })), 'FLOSS/fund needs your funding manifest link and problem; then I apply.');
  // Beside another ready program: that one is asked for its yes, this one is not counted again.
  assert.equal(end(base({ ready: [sol, ready({ title: 'Other Grant' })] })), 'Solana Foundation Grants needs your website link and requested amount; then I apply. Say yes and I apply to Other Grant.');
  assert.equal(
    end(base({ ready: [sol, ready({ title: 'Other Grant' }), ready({ title: 'Third Grant' })] })),
    'Solana Foundation Grants needs your website link and requested amount; then I apply. Say yes and I apply to all 2.',
  );
  // Beside one fully ready with its yes: both said, no yes asked.
  assert.equal(
    end(base({ ready: [ready({ title: 'Users Grant', rule_yes: true }), sol] })),
    'Your yes stands for Users Grant: I apply now. Solana Foundation Grants needs your website link and requested amount; then I apply.',
  );
  // Alone, no yes is asked at all.
  assert.doesNotMatch(afterApply(base({ ready: [sol] }), true), /Say yes|—|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
  // No yes given: the plain closing, as before.
  assert.equal(end(base({ ready: [{ ...sol, rule_yes: undefined }] })), 'Say yes and tell me your website link and the requested amount, and I apply to Solana Foundation Grants.');
});

test('F5 (v6.1.12), fix round 1 M1: the missing email is named once per reply: the Say names it, the Before line and the ready line drop it', () => {
  const p = ready({ title: 'Prose Grant', total: 4, from_record: 1, repo_required: 0, need_you: ['the problem', 'your email'], needs: ['the problem', 'your email'] });
  const show = replyText(base({ linked: true, record_missing: ['your email'], ready: [p] }), true);
  assert.equal(show.match(/email/g)!.length, 1, show);
  // L29-17 (v6.1.16 Task 15): the Say names what the yes needs; the line leaves it.
  assert.match(show, /^1\. Prose Grant \(\$1K\)\. I apply once you say yes\.$/m);
  // Fix round 1 (M1, L29-17 over F5): the Say names every need of the yes, the email too; the Before line drops it.
  assert.match(show, /\nSay yes and tell me the problem and your email, and I apply to Prose Grant\.$/);
  assert.doesNotMatch(show, /Before applying/);
  // With standing approval, the wait names the problem only.
  const auto = replyText(base({ linked: true, auto_apply: true, max_per_night: 5, auto_sent_today: 0, record_missing: ['your email'], ready: [p] }), true);
  assert.equal(auto.match(/email/g)!.length, 1, auto);
  // Fix round 1 (M1): nothing can go alone, so the Say asks for both; the Before line names neither.
  assert.doesNotMatch(auto, /Before applying/);
  assert.match(auto, /\nSay yes and tell me the problem and your email, and I apply to Prose Grant\.$/);
  // Fix round 1 (M2): one label, each clause its own.
  const two = replyText(base({ linked: true, auto_apply: true, max_per_night: 5, auto_sent_today: 0, record_missing: ['your email', 'your deck link'],
    ready: [p, ready({ title: 'Free Grant' })] }), true);
  assert.match(two, /\nBefore applying: your problem for Prose Grant; your email and your deck link\.\n/);
  // Only the email missing: the drafted line ends at the counts.
  const only = ready({ title: 'Mail Grant', total: 2, from_record: 1, need_you: ['your email'], needs: ['your email'] });
  const one = replyText(base({ linked: true, record_missing: ['your email'], ready: [only] }), true);
  assert.equal(one.match(/email/g)!.length, 1, one);
  assert.match(one, /^1\. Mail Grant \(\$1K\)\. I apply once you say yes\.$/m);
  // The record holds the email (not in the Before block): the Say names both (L29-17, v6.1.16 Task 15).
  assert.match(replyText(base({ linked: true, ready: [p] }), true), /\nSay yes and tell me the problem and your email, and I apply to Prose Grant\.$/);
});

test('#3 (v6.1.15): reply.ts holds no other Drafted wording', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./reply.ts', import.meta.url), 'utf8');
  for (const old of ['from the repo', 'by your agent', 'Your agent drafts', 'need you:']) assert.ok(!src.includes(old), old);
});

test('F9 (v6.1.12): the empty-repo note and the Builder Codes note are one sentence', () => {
  const show = replyText(base({ repo_notes: ['empty', 'no_builder_codes'] }), true);
  assert.ok(show.split('\n').includes('The repo is empty and does not send Builder Codes yet, so this is from what you told me.'), show);
  assert.doesNotMatch(show, /The repo does not send Builder Codes yet\./);
  // Each alone: its own sentence, as before.
  assert.ok(replyText(base({ repo_notes: ['empty'] }), true).split('\n').includes('The repo is empty, so this is from what you told me.'));
  assert.ok(replyText(base({ repo_notes: ['no_builder_codes'] }), true).split('\n').includes('The repo does not send Builder Codes yet.'));
});

test('fix round 1 (v6.1.12): the nothing-ready closing picks the cheapest step shown, a question before a change, whatever the line order', () => {
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users', effort: 'hours' as const, agent_can: false };
  const STARTED = { kind: 'new_work_after' as const, item: 'new_work_after:2026-10-22', what: 'tell me when you started this', effort: 'minutes' as const, agent_can: false };
  const vr = gap({ title: 'Meta VR', gap: VIDEO, also: [ruleGap('a hands-first experience')] });
  const floss = gap({ title: 'FLOSS/fund', gap: USERS });
  const end = (gaps: GapProgram[]) => replyText(base({ gaps }), true).split('\n').at(-1);
  assert.equal(end([vr, floss]), 'Do real people use it? Say yes, sign in, and I check.');
  assert.equal(end([vr, gap({ title: 'UGREEN', gap: STARTED })]), 'Tell me when you started and I check it.');
  // Changes only: the first one, as before.
  assert.equal(end([vr, gap({ title: 'Arc Fund' })]), 'Send me the demo video link and I fill it in.');
});

test('fix round 1 (v6.1.12): the N3 closing lists at most three needs, then "and n more"', () => {
  const needs = ['your website link', 'the requested amount', 'the problem', 'your team', 'a demo video'];
  const r = base({ ready: [ready({ title: 'Solana Foundation Grants', rule_yes: true, need_you: needs, needs })] });
  assert.equal(afterApply(r, true).split('\n\n').at(-1), 'Solana Foundation Grants needs your website link and requested amount; then I apply.');
});

test('final fix (v6.1.12, I1): the users-question closing promises a send only when the yes makes the program ready', () => {
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users', effort: 'hours' as const, agent_can: false };
  const end = (gaps: GapProgram[]) => replyText(base({ gaps }), true).split('\n').at(-1);
  // The users question is the whole step: the yes applies.
  assert.equal(end([gap({ title: 'Used Grant', gap: USERS })]), 'Do real people use it? Say yes, sign in, and I check.');
  assert.deepEqual(firstStepOf([gap({ title: 'Used Grant', gap: USERS })]), { users: true, program_id: 'used-grant' });
  // A setup step left after the yes: I look again.
  const floss = gap({ title: 'FLOSS/fund', gap: USERS, setup: ['publish a funding manifest on your site or repo'] });
  assert.equal(end([floss]), 'Do real people use it? Say yes, sign in, and I check.');
  assert.equal(replyText(base({ linked: true, gaps: [floss] }), true).split('\n').at(-1), 'Do real people use it? Say yes and I check.');
  assert.deepEqual(firstStepOf([floss]), { users: true, more: true, program_id: 'floss-fund' });
  // A rule left beside it (shown beside a change, so the rule is not asked first): I look again.
  const hero = gap({ title: 'HeroDevs', gap: USERS, also: [ruleGap('an OSI-approved open source license')], rules: ['an OSI-approved open source license'] });
  assert.equal(replyText(base({ linked: true, gaps: [gap({ title: 'Arc Fund' }), hero] }), true).split('\n').at(-1), 'Do real people use it? Say yes and I check.');
  for (const t of [end([floss]), end([gap({ title: 'Arc Fund' }), hero])]) assert.doesNotMatch(t!, /I apply|—|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
});

test('v6.1.14: the ledger line reads "Your applications"; nothing fits promises nothing that is never pushed', () => {
  const r = base({ ready: [ready({ title: 'A' })], ledger: { ...LEDGER0, applied: 2, won: 1, won_usd: 5000, pending: 1 },
    applications: [{ program_id: 'w', title: 'W Grant', status: 'won', sent_at: '2026-11-01T10:00:00.000Z', result_at: '2026-11-05T10:00:00.000Z', amount: '$5,000' }] });
  assert.match(replyText(r, false, MON), /^Your applications: W Grant \(sent Nov 1, won \$5,000\)\.$/m);
  assert.doesNotMatch(replyText(r, false), /Ledger/);
  assert.equal(replyText(base(), false), 'Nothing fits yet. Tell me more about it, or its repo link, and I look again.');
});

test('Review Focus 1 (v6.1.14): a reply whose closing names the needs never repeats them on line 1', () => {
  const sol = ready({ title: 'Solana Foundation Grants', rule_yes: true, need_you: ['your website link', 'the requested amount'], needs: ['your website link', 'the requested amount'] });
  const show = afterApply(base({ ready: [sol] }), true);
  assert.equal(show, [
    '1 program is ready to send now.',
    '',
    '1. Solana Foundation Grants ($1K). Your yes stands.',
    '',
    'Solana Foundation Grants needs your website link and requested amount; then I apply.',
  ].join('\n'));
  assert.equal(show.match(/website link/g)!.length, 1, show);
  // Linked: the drafted counts stay, the needs go to the closing.
  const linked = afterApply(base({ linked: true, ready: [{ ...sol, total: 3, from_record: 1 }] }), true);
  assert.match(linked, /^1\. Solana Foundation Grants \(\$1K\)\. Your yes stands\.$/m);
  assert.equal(linked.match(/website link/g)!.length, 1, linked);
  // No yes given: the closing asks the yes, so the line keeps its needs.
  const other = ready({ title: 'Other Grant', needs: ['your website link'] });
  assert.match(afterApply(base({ ready: [other] }), true), /^1\. Other Grant \(\$1K\)\. Once you give your website link, I apply on your yes\.$/m);
});

test('Review Focus 2 (v6.1.14): an unlinked builder reads the sign-in ask once per reply, in the closing', () => {
  const TIER = { kind: 'tier' as const, item: 'tier:used', what: 'proof of real users', effort: 'weeks' as const, agent_can: false };
  const DEMO = { kind: 'demo_video' as const, item: 'demo_video', what: 'a demo video link (a short screen recording of it working)', effort: 'hours' as const, agent_can: false };
  const link = 'https://earnkit.com/link?c=abc';
  const show = replyText(base({ sign_in: link, gaps: [gap({ title: 'Sign Grant', money: 'Up to $5,000', gap: TIER })] }), true);
  // L38 big 1 (v6.1.18 Task 10): the proof is the only action, so the sign-in is in the Say line, first.
  assert.equal(show, ['Nothing is ready to send yet. The closest:', '', '1. Sign Grant (Up to $5,000) needs proof of real users first.', '', `Sign in at ${link} so I can check the repo, then I look again.`].join('\n'));
  assert.equal(show.match(/Sign in/g)!.length, 1, show);
  assert.equal(gapLine({ ...gap({ title: 'G', gap: TIER, also: [DEMO] }), n: 1 }), '1. G, $1K: proof of real users and a demo video link (a short screen recording of it working).');
  // No proof gap shown: the yes needs no sign-in, so none is said.
  assert.equal(replyText(base({ sign_in: link, ready: [ready({ title: 'A' })] }), true), '1 program is ready to send now.\n\n1. A ($1K). I apply once you say yes.\n\nSay yes and I apply to A.');
});

test('fix round 1 (v6.1.14, F1 and F2), L38 big 1 (v6.1.18 Task 10): the proof sign-in is one sentence in the Say line, read or not, and is said without a link when none can be made', () => {
  const TIER = { kind: 'tier' as const, item: 'tier:used', what: 'proof of real users', effort: 'weeks' as const, agent_can: false };
  const link = 'https://earnkit.com/link?c=abc';
  const end = (over: Partial<R>) => replyText(base({ gaps: [gap({ title: 'Sign Grant', money: 'Up to $5,000', gap: TIER })], ...over }), true).split('\n').at(-1);
  // F1: nothing read: the same one sentence, no promise to remember.
  assert.equal(end({ sign_in: link, as_reported: true }), `Sign in at ${link} so I can check the repo, then I look again.`);
  assert.equal(end({ sign_in: link, repo_notes: ['empty'] }), `Sign in at ${link} so I can check the repo, then I look again.`);
  // F2: no link (linkOf failed).
  assert.equal(end({}), 'Sign in so I can check the repo, then I look again.');
  assert.equal(end({ as_reported: true }), 'Sign in so I can check the repo, then I look again.');
  // F2: after the account was deleted, no link is given, the sign-in is still said once, in the Say, after the notice.
  const del = replyText(base({ gaps: [gap({ title: 'Sign Grant', money: 'Up to $5,000', gap: TIER })], linked_notice: DELETED_NOTICE }), true);
  assert.equal(del.split('\n\n').slice(-2).join('\n\n'), `${DELETED_NOTICE}\n\nSign in so I can check the repo, then I look again.`);
  assert.equal(del.match(/Sign in/g)!.length, 1, del);
  // No proof gap and no link: no sign-in sentence, as before.
  assert.equal(replyText(base({ ready: [ready({ title: 'A' })] }), true).split('\n').at(-1), 'Say yes and I apply to A.');
});

test('L1f-2 (v6.1.14): a step program whose only change is code in a repo closes on that, never a rule yes before the code exists', () => {
  const end = (r: R) => replyText(r, true).split('\n').at(-1);
  const CODE = { kind: 'repo' as const, item: 'repo', what: 'code in a repo', effort: 'days' as const, agent_can: false };
  const RULE = { kind: 'rule' as const, item: 'rule:abcd1234', what: 'open source software', effort: 'hours' as const, agent_can: false };
  const futo = gap({ title: 'FUTO Microgrants', gap: CODE, also: [RULE], rules: ['open source software'], n: 1 });
  assert.equal(stepRuleOf([futo]), null);
  assert.equal(end(base({ gaps: [futo] })), 'Tell me when the code is in a repo and I look again.');
  assert.equal(end(base({ gaps: [{ ...futo, also: [] }] })), 'Tell me when the code is in a repo and I look again.');
  assert.equal(gapAction(futo), 'Tell me when the code is in a repo and I look again.');
});

test('L1f-1, L1f-3 (v6.1.14): the public repo and archive gaps read as gaps, their step after "First:" and in the closing', () => {
  const end = (r: R) => replyText(r, true).split('\n').at(-1);
  const PUBLIC = { kind: 'repo' as const, item: 'repo:public', what: 'a public repo', setup: 'make the repo public', effort: 'minutes' as const, agent_can: false };
  const ARCHIVED = { kind: 'repo' as const, item: 'repo:archived', what: 'a live repo', setup: 'tell me the live repo', effort: 'minutes' as const, agent_can: false };
  const MANIFEST = 'publish a funding manifest on your site or repo';
  const floss = gap({ title: 'FLOSS/fund', gap: PUBLIC, setup: [MANIFEST], n: 1 });
  const RULE = { kind: 'rule' as const, item: 'rule:abcd1234', what: 'an OSI-approved open source license', effort: 'hours' as const, agent_can: false };
  const hero = gap({ title: 'HeroDevs', gap: PUBLIC, also: [RULE], rules: [RULE.what], n: 2 });
  // The one-program line (no closing step) and a line the closing does not name keep the gap's step after "First:".
  assert.equal(gapLine(floss), '1. FLOSS/fund, $1K: a public repo. First: make the repo public; publish a funding manifest on your site or repo.');
  assert.equal(gapLine(floss, true), 'FLOSS/fund, $1K: a public repo. First: make the repo public; publish a funding manifest on your site or repo.');
  // Fix round 1 (I1): the closing names the step, so the lines leave it out: said once.
  const both = replyText(base({ gaps: [floss, hero] }), true);
  // L1i-2 (v6.1.16.1): both gap lines; the step once, in the closing.
  // L38 big 3 (v6.1.18 Task 10): each row has more than one step: the first, then the count.
  assert.equal(both, [
    'Nothing is ready to send yet. The closest:',
    '',
    '1. FLOSS/fund ($1K) needs a public repo, then 1 more step.',
    '2. HeroDevs ($1K) needs a public repo, then 1 more step.',
    '',
    'Tell me when the repo is public and I look again.',
  ].join('\n'));
  // L1g-5 (v6.1.16): the closing names the step as "the repo is public", the lines leave it out: said once.
  assert.equal(both.match(/make the repo public|the repo is public/g)?.length, 1);
  assert.doesNotMatch(both, /Say yes and I apply/);
  assert.equal(gapAction(floss), 'Tell me when the repo is public and I look again.');
  const atom = gap({ title: 'FLOSS/fund', gap: ARCHIVED, setup: [MANIFEST], n: 1 });
  assert.equal(gapLine(atom, true), 'FLOSS/fund, $1K: a live repo. First: tell me the live repo; publish a funding manifest on your site or repo.');
  const archived = replyText(base({ gaps: [atom] }), true);
  // L38 big 3 (v6.1.18 Task 10): a live repo and the manifest are two steps.
  assert.equal(archived, [
    'Nothing is ready to send yet. The closest:',
    '',
    '1. FLOSS/fund ($1K) needs a live repo, then 1 more step.',
    '',
    'Tell me the live repo and I look again.',
  ].join('\n'));
  assert.equal(end(base({ gaps: [atom] })), 'Tell me the live repo and I look again.');
  assert.equal(gapAction({ ...atom, setup: [] }), 'Tell me the live repo and I look again.');
  // M3: the code closing is picked by the gap's kind.
  assert.equal(firstStepOf([gap({ title: 'FUTO', gap: { kind: 'repo', item: 'repo', what: 'any words', effort: 'days', agent_can: false } })])?.users === false, true);
  assert.equal(end(base({ gaps: [gap({ title: 'FUTO', gap: { kind: 'repo', item: 'repo', what: 'any words', effort: 'days', agent_can: false }, n: 1 })] })), 'Tell me when the code is in a repo and I look again.');
  assert.match(agentNote(base({ gaps: [floss, atom] }), { more: 0 }), /pass private: false[^\n]*live repo_url/);
});

test('L1g-5 (v6.1.16): one closing shape for every single step, the step said once', () => {
  const chain = (what: string) => ({ kind: 'chain' as const, item: 'chain:base', what, effort: 'hours' as const, agent_can: false, details: { chain: 'base' } });
  const MANIFEST = 'publish a funding manifest on your site or repo';
  const own = { kind: 'feature' as const, item: 'feature:manifest', what: 'a funding manifest', setup: MANIFEST, effort: 'hours' as const, agent_can: false };
  const ARCHIVED = { kind: 'repo' as const, item: 'repo:archived', what: 'a live repo', setup: 'tell me the live repo', effort: 'minutes' as const, agent_can: false };
  assert.equal(stepClause(NEEDS_CODE), 'the code is in a repo');
  assert.equal(stepClause(PUBLIC_REPO), 'the repo is public');
  assert.equal(stepClause(chain('deploy the contract on Base')), 'the contract is on Base');
  assert.equal(stepClause(chain('deploy the contract on Base mainnet')), 'the contract is on Base mainnet');
  assert.equal(stepClause({ ...chain('a contract on Base'), kind: 'contract_on', item: 'contract_on:base' }), 'the contract is on Base');
  assert.equal(stepClause({ kind: 'live_product', item: 'live_product', what: 'put a live link up', effort: 'hours', agent_can: false }), 'the live link is up');
  assert.equal(stepClause(VIDEO), 'the demo video is ready');
  assert.equal(stepClause(own), `you ${MANIFEST}`);
  assert.equal(stepClause(ARCHIVED), null);
  assert.equal(stepClause(ruleGap('a team')), null);
  assert.equal(CODE_CLOSING, singleStepClosing(NEEDS_CODE));
  assert.equal(singleStepClosing(ARCHIVED), 'Tell me the live repo and I look again.');
  assert.equal(singleStepClosing(own), 'Tell me when you publish a funding manifest on your site or repo and I look again.');
  assert.equal(singleStepClosing(ruleGap('a team')), 'Tell me when that is done and I look again.');
  // The one-program action and the list closing read the same, and the line leaves the named step out.
  const g = gap({ title: 'Manifest Fund', gap: own, n: 1 });
  assert.equal(gapAction(g), 'Tell me when you publish a funding manifest on your site or repo and I look again.');
  assert.equal(gapActionStep(g), MANIFEST);
  assert.equal(gapLine(g, true, gapActionStep(g)), 'Manifest Fund, $1K: a funding manifest.');
  assert.equal(replyText(base({ gaps: [g] }), true), [
    'Nothing is ready to send yet. The closest:',
    '',
    '1. Manifest Fund ($1K) needs a funding manifest first.',
    '',
    'Tell me when you publish a funding manifest on your site or repo and I look again.',
  ].join('\n'));
  assert.equal(gapAction(gap({ title: 'S', gap: { kind: 'new_work_after', item: 'new_work_after:2026-01-01', what: 'tell me when you started this', effort: 'minutes', agent_can: false } })), 'Tell me when you started and I check it.');
  // Persona 12: the line reads the archive, so the archived note is left out; with no such line it stays.
  const atom = gap({ title: 'FLOSS/fund', gap: ARCHIVED, n: 1 });
  assert.equal(replyText(base({ gaps: [atom], repo_notes: ['archived'] }), true), [
    'Nothing is ready to send yet. The closest:',
    '',
    '1. FLOSS/fund ($1K) needs a live repo first.',
    '',
    'Tell me the live repo and I look again.',
  ].join('\n'));
  assert.match(replyText(base({ gaps: [gap({ title: 'Arc', n: 1 })], repo_notes: ['archived'] }), true), /This repo is archived; programs want active work\./);
});

test('L1g-8b (v6.1.16, Review Focus 1): a program not ready for this repo never lends its rule; an unlikely rule waits behind a shown step', () => {
  const PUB = { ...PUBLIC_REPO };
  const floss = gap({ title: 'FLOSS/fund', gap: PUB, setup: ['publish a funding manifest on your site or repo'], public_first: true, n: 1 });
  const vr = gap({ title: 'Meta VR', gap: ruleGap('a hands-first experience for Meta VR devices'), unlikely: true, n: 2 });
  const hero = gap({ title: 'HeroDevs', gap: PUB, also: [ruleGap('an OSI-approved open source license', 'rule:0000000b')], public_first: true, n: 3 });
  const end = (gaps: GapProgram[]) => replyText(base({ gaps }), true).split('\n').at(-1)!;
  assert.equal(end([floss, vr, hero]), 'Tell me when the repo is public and I look again.');
  assert.doesNotMatch(replyText(base({ gaps: [floss, vr, hero] }), true), /Say "yes/);
  // The only step program shown is not ready for this repo: its rule is no step yet.
  assert.equal(stepRuleOf([hero]), null);
  assert.equal(end([hero]), 'Tell me when the repo is public and I look again.');
  // With no step shown, an unlikely rule is still asked; a likely one (no flag) is asked whatever is shown.
  assert.equal(end([vr]), 'Say 1 if the Meta VR rule fits you and I draft it.');
  // L38 big 3 (v6.1.18 Task 10): the rule-only row is one step, so it heads the list as number 1.
  assert.equal(end([floss, { ...vr, unlikely: undefined }]), 'Say 1 if the Meta VR rule fits you and I draft it.');
});

test('L16-11 (v6.1.16): one ready program is named in the yes; several are "all n"', () => {
  const o = { draftOnly: false, gaps: 0, firstRule: null, inPerson: 0, held: 0 };
  assert.equal(closingLine({ ...o, ready: 1, title: 'L16 Need Grant' }).text, 'Say yes and I apply to L16 Need Grant.');
  assert.equal(closingLine({ ...o, ready: 1 }).text, 'Say yes and I apply.');
  assert.equal(closingLine({ ...o, ready: 1, draftOnly: true, title: 'X' }).text, 'Say yes and I draft it for you to send.');
  assert.equal(closingLine({ ...o, ready: 2, title: 'X' }).text, 'Say yes and I apply to all 2.');
  // Lane 16's N48: a yes that waits on an answer, then the one program left, by name.
  assert.equal(
    closingLine({ ...o, ready: 2, yesWaits: [{ title: 'L16 Rule Grant', needs: ['your demo video'] }], title: 'L16 Need Grant' }).text,
    'L16 Rule Grant needs your demo video; then I apply. Say yes and I apply to L16 Need Grant.',
  );
});

test('L1g-5 fix round 1 (v6.1.16, I1): a below-bar tier gap, a feature and a users gap of weeks each name their step in a list closing', () => {
  const TIER_GAP = { kind: 'tier' as const, item: 'tier:used', what: 'about 25 outside users in 90 days; I count 4', effort: 'weeks' as const, agent_can: false, details: { tier: 'live', min_tier: 'used' } };
  const FEATURE = { kind: 'feature' as const, item: 'feature:kiro', what: 'a Kiro folder in the repo', effort: 'days' as const, agent_can: false };
  const USERS_WEEKS = { kind: 'users' as const, item: 'users', what: 'live for 4 weeks with real users', effort: 'weeks' as const, agent_can: false };
  const USERS_FIRST = { kind: 'users' as const, item: 'users', what: 'real users first', effort: 'weeks' as const, agent_can: false };
  // A second line shown: a change EarnKit makes ("do 2"), so the closing still names the first program's step.
  const codes = gap({ title: 'Base Batches', gap: { kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes', agent_can: true }, n: 2 });
  const list = (first: GapProgram) => replyText(base({ gaps: [first, codes] }), true).split('\n');
  const tier = list(gap({ title: 'Used Grant', gap: TIER_GAP, n: 1 }));
  assert.equal(tier[1], '');
  assert.equal(tier.at(-1), 'Say do 2 and I add the codes.');
  // L1i-2 (v6.1.16.1): both step rows are shown.
  assert.equal(tier.length, 6);
  const feature = list(gap({ title: 'Kiro Prize', gap: FEATURE, n: 1 }));
  assert.equal(feature[1], '');
  assert.equal(feature.at(-1), 'Say do 2 and I add the codes.');
  const weeks = list(gap({ title: 'Live Grant', gap: USERS_WEEKS, n: 1 }));
  assert.equal(weeks.at(-1), 'Say do 2 and I add the codes.');
  // No number of weeks given: the step is still named.
  assert.equal(list(gap({ title: 'Users Grant', gap: USERS_FIRST, n: 1 })).at(-1), 'Say do 2 and I add the codes.');
  for (const x of [TIER_GAP, FEATURE, USERS_WEEKS, USERS_FIRST]) assert.notEqual(stepClause(x), null);
  // The one-program action reads the same.
  assert.equal(gapAction(gap({ title: 'Kiro Prize', gap: FEATURE })), 'Tell me when a Kiro folder in the repo is in and I look again.');
  // The unlinked proof and the proof being read keep their own sentences: no clause.
  assert.equal(stepClause({ ...TIER_GAP, what: 'proof of real users' }), null);
});

test('R38 (L17-6, v6.1.16): 25 programs held by agent A; agent B reads its own under Ready and the 25 in the held block, numbered on', () => {
  const NOW = new Date('2026-11-04T12:00:00Z');
  const held = Array.from({ length: 25 }, (_, k) => ready({ title: `Held ${k + 1}`, claimed_since: '2026-11-04T10:00:00.000Z' }));
  const r = base({ linked: true, ready: [...held.slice(0, 12), ready({ title: 'Mine A' }), ...held.slice(12), ready({ title: 'Mine B' })] });
  const lines = replyText(r, false, NOW).split('\n');
  assert.deepEqual(lines.map((l) => l.split(',')[0]), [
    '2 programs are ready to send now.',
    '',
    '1. Mine A ($1K). I apply once you say yes.',
    '2. Mine B ($1K). I apply once you say yes.',
    '',
    'Also: 25 more in the full list.',
    '',
    'Say yes and I apply to all 2.',
  ]);
  // L29-26 (v6.1.16 Task 15): the 25 held ones are the agent's (Not shown) and the full view's, numbered on.
  const hidden = replyParts(r, false, NOW).hidden;
  assert.equal(hidden.length, 25);
  assert.deepEqual(hidden.map((l) => Number(l.split('.')[0])), Array.from({ length: 25 }, (_, k) => k + 3));
  const full = replyText(r, false, NOW, null, { all: true }).split('\n');
  // v6.1.20: one Ready run, the held ones saying so on their rows.
  assert.equal(full.length, 32);
  assert.deepEqual(full.slice(2, 6), ['Ready:', '1. Mine A ($1K).', '2. Mine B ($1K).', '3. Held 1 ($1K), started by your other agent.']);
});

test('L1h-3 (v6.1.16): two gap phrases join with ", and" when one holds " and"; the feature reads its note, the closing its name', () => {
  const MWA = { kind: 'feature' as const, item: 'feature:Mobile Wallet Adapter and Seed Vault in an Android app', what: 'use Mobile Wallet Adapter and Seed Vault in an Android app', effort: 'days' as const, agent_can: false };
  const SOL = { kind: 'chain' as const, item: 'chain:solana', what: 'deploy the contract on Solana', effort: 'hours' as const, agent_can: false };
  const title = 'Solana Mobile Builder Grants';
  const money = 'milestone grants, requests of $10,000 to $50,000';
  assert.equal(gapLine(gap({ title, money, gap: SOL, also: [MWA] }), true), `${title}, ${money}: deploy the contract on Solana, and use Mobile Wallet Adapter and Seed Vault in an Android app.`);
  assert.equal(gapLine(gap({ title, money, gap: MWA }), true), `${title}, ${money}: use Mobile Wallet Adapter and Seed Vault in an Android app.`);
  assert.doesNotMatch(gapLine(gap({ title, money, gap: SOL, also: [MWA] }), true), /on Solana and Mobile Wallet Adapter/);
  // Without " and" in either phrase the join is as before.
  assert.equal(gapLine(gap({ title: 'Two', gap: SOL, also: [{ ...SOL, item: 'chain:base', what: 'deploy the contract on Base' }] }), true), 'Two, $1K: deploy the contract on Solana and deploy the contract on Base.');
  assert.equal(singleStepClosing(MWA), 'Tell me when Mobile Wallet Adapter and Seed Vault in an Android app is in and I look again.');
});

test('v6.1.16 Task 9 (lane 23): nothing new, not sent since yes, started not sent, results due and the results question; one Say in all', () => {
  const NOW = new Date('2026-11-06T12:00:00Z');
  const one = base({ ready: [ready({ title: 'Alpha Grant', filled: 1, facts_from_repo: 1, repo_required: 1, total: 1 })] });
  // L23-16: the same list as last time leads with Nothing new, then the money lines.
  assert.equal(replyText({ ...one, nothing_new_since: '2026-11-05T09:00:00.000Z' }, false, NOW),
    '1 program is ready to send now.\n\n1. Alpha Grant ($1K). I apply once you say yes.\n\nNothing new since Nov 5.\n\nSay yes and I apply to Alpha Grant.');
  // Never on a first find, and never beside a since line.
  assert.doesNotMatch(replyText({ ...one, nothing_new_since: '2026-11-05T09:00:00.000Z' }, true, NOW), /Nothing new/);
  // L23-7: the started-not-sent lines (three, then the count); ONE_SAY_ORDER keeps the first Say only.
  const released = ['A', 'B', 'C', 'D', 'E'].map((t, i) => ({ program_id: t, title: `${t} Grant`, started_at: `2026-11-0${i + 1}T10:00:00.000Z` }));
  const started = replyText({ ...one, released }, false, NOW);
  // L29-26, L29-33 (v6.1.16 Task 15): Task 9's lines follow the money lines; the Say ONE_SAY_ORDER keeps goes last.
  assert.equal(started, [
    '1 program is ready to send now.',
    '',
    '1. Alpha Grant ($1K). I apply once you say yes.',
    '',
    'B Grant: started Nov 2, nothing sent.',
    'C Grant: started Nov 3, nothing sent.',
    'And 2 more started, nothing sent.',
    '',
    'A Grant: started Nov 1, nothing sent. Say yes to apply or say skip.',
  ].join('\n'));
  assert.equal(started.match(/\bSay\b/g)?.length, 1, started);
  // L23-1 first, then L23-7; a date 370 days back has its year (L23-11).
  const both = replyText({ ...one, released: released.slice(0, 1), not_sent: { programs: [{ program_id: 'x', title: 'X Grant' }], since: '2025-11-01T00:00:00.000Z' } }, false, NOW);
  assert.ok(both.endsWith('\nA Grant: started Nov 1, nothing sent.\n\nNothing was sent for X Grant since you said yes on Nov 1, 2025. Say yes again and I apply now.'), both);
  assert.equal(both.match(/\bSay\b/g)?.length, 1, both);
  // L23-6 and L23-4: results due soon on its own line; the results question once per program.
  const sent = replyText({ ...one, ledger: { ...LEDGER0, applied: 2, pending: 2, results_soon: [{ program_id: 'r', title: 'R Grant', results_at: '2026-11-09T00:00:00.000Z' }] },
    ask_outcome: [{ program_id: 'q', title: 'Q Grant', due_at: '2026-11-01T00:00:00.000Z' }] }, false, NOW);
  assert.ok(sent.includes('\nResults for Q Grant were due Nov 1. Did you hear back?\nResults due soon: R Grant.\n'), sent);
  assert.match(agentNote({ ...one, ask_outcome: [{ program_id: 'q', title: 'Q Grant', due_at: '2026-11-01T00:00:00.000Z' }] }, { more: 0 }), /The reply asks how each went: Q Grant\./);
  assert.match(agentNote({ ...one, released: released.slice(0, 2) }, { more: 0 }), /Claims left unsent for 24 hours were released: A Grant, B Grant\./);
});

test('Task 9 fix round 1 (N2): the since line says a close in the program zone, as its tile does, near midnight', () => {
  const at = new Date('2026-11-04T09:00:00Z'); // Nov 4, 01:00 in Los Angeles
  const r = base({ since: { from: '2026-11-02T09:00:00.000Z', new: [], changed: [], closing: [{ program_id: 'z', title: 'Zone Grant', closes_at: '2026-11-05T07:30:00.000Z', zone: 'America/Los_Angeles' }] } });
  assert.match(replyText(r, false, at), /^Since Nov 2: Zone Grant closes today\.$/m);
});

// v6.1.16 Task 11 (lane 24): one Say, naming what a yes covers.

const CODES_GAP = { kind: 'builder_codes' as const, item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes' as const, agent_can: true };

test('L24-8 (J3-8): one closing Say; the do-gap line loses its own', () => {
  const t = replyText(base({ ready: [ready({ title: 'Alpha' }), ready({ title: 'Beta' })], gaps: [gap({ title: 'Codes Grant', gap: CODES_GAP })] }), true);
  assert.equal(t.split('\n\n').at(-1), 'Say yes and I apply to all 2, or say do 3 and I add the codes first.');
  assert.match(t, /^3\. Codes Grant \(\$1K\) needs you to add Base Builder Codes to the app first\.$/m);
  assert.equal(t.match(/\bSay\b/g)?.length, 1, t);
});

test('L24-9 (J1-39): a yes names the program whenever other blocks are listed', () => {
  const inPerson = ready({ title: 'Meetup', in_person: true });
  const t = replyText(base({ ready: [ready({ title: 'Text Grant' }), inPerson], gaps: [gap({ title: 'Step', gap: VIDEO })] }), true);
  assert.equal(t.split('\n\n').at(-1), 'Say yes and I apply to Text Grant.');
  const two = replyText(base({ ready: [ready({ title: 'A' }), ready({ title: 'B' }), inPerson] }), true);
  assert.equal(two.split('\n\n').at(-1), 'Say yes and I apply to all 2.');
});

test('L24-10 (J3-3): some ready the builder submits: apply to the rest and draft those', () => {
  const r = base({
    ready: [ready({ title: 'Alpha' }), ready({ title: 'Beta' }), ready({ title: 'Gamma' })],
    blockers: [{ program_id: 'gamma', sign_in: null, needs_click: true, needs: [] }],
  });
  assert.equal(replyText(r, true).split('\n\n').at(-1), 'Say yes and I apply to 2 and draft Gamma for you to send.');
});

test('L24-28 (J4-19): the one ready program over the limit is named in the closing; no Before clause', () => {
  const r = base({
    linked: true, auto_apply: true, max_per_night: 1,
    ready: [ready({ title: 'Screen Grant' })],
    blockers: [{ program_id: 'screen-grant', sign_in: null, needs_click: false, needs: [], outside_approval: true, over_limit_usd: 4500 }],
  });
  const t = replyText(r, true);
  assert.equal(t.split('\n\n').at(-1), 'Screen Grant is over your limit. Say yes and I apply.');
  assert.doesNotMatch(t, /Before applying|Outside your standing approval/);
});

test('L24-4: a program the builder held is in its own block, out of the yes and the standing list', () => {
  const r = base({
    linked: true, auto_apply: true, max_per_night: 5,
    ready: [ready({ title: 'Alpha', from_record: 1, total: 1 }), ready({ title: 'Beta', from_record: 1, total: 1, held: true })],
  });
  const { ready: shown } = numbered(r.ready, []);
  const t = replyText({ ...r, ready: shown }, true);
  assert.ok(replyParts({ ...r, ready: shown }, true).hidden.includes('2. Beta, $1K.'));
  assert.match(replyText({ ...r, ready: shown }, true, new Date(), null, { all: true }), /\n2\. Beta \(\$1K\), on hold until you say go\.\n/);
  assert.equal(t.split('\n').at(-1), 'Applying now to Alpha under your standing approval. Say stop and I hold any of them.');
  assert.ok(agentNote(r, { more: 0 }).includes('A ready program with held: true is held by the builder'));
});

test('L24-1, ruling 12: a held line never names a project or a time', () => {
  const r = base({ ready: [ready({ title: 'In', in_person: true, claimed_since: '2026-11-04T10:00:00.000Z' })] });
  assert.match(replyParts(r, true).hidden[0], /^1\. In, \$1K\. Attend in person\. Being handled by your other agent\.$/);
  // L38 big 2 (v6.1.18 Task 10): the default view's one line.
  assert.match(replyText(r, true), /^Also open: In \(\$1K, started by your other agent\), in person\.$/m);
});

test('L24-6: the agent note names an EarnKit cut once', () => {
  const field = { key: 'tagline', label: 'Tagline', type: 'text' as const, required: true, kind: 'one_liner' as const, value: 'A', from: 'earnkit' as const, fit: 'cut' as const, fit_note: 'x', max_chars: 1 };
  const note = agentNote(base({ ready: [ready({ title: 'A', fields: [field] }), ready({ title: 'B', fields: [field] })] }), { more: 0 });
  assert.equal(note.split('Use EarnKit values as given; where a cut is named, read the full text in your draft.').length, 2);
  assert.doesNotMatch(agentNote(base({ ready: [ready({ title: 'A' })] }), { more: 0 }), /where a cut is named/);
});

// L1h-8 (v6.1.16 Task 15): a needs line never carries two "and"s; the catalog's need words read "with".
test('L1h-8: the needs line for a builder missing a company start date, the stage, active users and four more', () => {
  const solana = ready({
    title: 'Solana Incubator Cohort 6', money: 'NYC incubator with relocation stipend, amount not stated', in_person: true,
    setup: [], needs: ['the company start date', 'the stage', 'active users with 6-month growth', 'revenue with its growth', 'the amount raised', 'your runway in months', 'the answer on moving to NYC'],
  });
  const line = replyParts(base({ ready: [solana] }), true).hidden[0];
  assert.equal(line, '1. Solana Incubator Cohort 6, NYC incubator with relocation stipend, amount not stated. Attend in person. Needs your company start date, stage, active users with 6-month growth and 4 more.');
  assert.equal(line.split('Needs your')[1].match(/ and /g)?.length, 1);
});

test('Task 11 fix round 1 (M1): every ready program held: the reply closes on the hold, one Say, last', () => {
  const r = base({
    linked: true, auto_apply: true, max_per_night: 5,
    ready: [ready({ title: 'Alpha', held: true }), ready({ title: 'Beta', held: true })],
    gaps: [gap({ title: 'Step', gap: VIDEO })],
  });
  const { ready: shown, gaps } = numbered(r.ready, r.gaps);
  const parts = replyParts({ ...r, ready: shown, gaps }, true);
  // L38-14 (v6.1.18): the heading says it is on hold; the closing is the Say alone.
  assert.equal(parts.text.split('\n').at(-1), 'Say go and I apply.');
  assert.equal(parts.offer, 'apply');
  assert.equal(parts.text.match(/\bSay\b/g)?.length, 1, parts.text);
  assert.doesNotMatch(parts.text, /Nothing is ready yet|Nothing fits yet/);
});

// v6.1.16 Task 15 fix round 1 (M3, Task 1's nits): one week is singular; the rare kinds name their step.
test('M3: one week reads "1 week"; the rare step kinds close on their own clause, never "that is done"', () => {
  const g = (over: Partial<GapProgram['gap']>) => ({ kind: 'users', item: 'users', what: 'live for 1 week', effort: 'weeks', agent_can: false, ...over }) as GapProgram['gap'];
  assert.equal(stepClause(g({})), 'it has been live for 1 week');
  assert.equal(stepClause(g({ what: 'live for 4 weeks' })), 'it has been live for 4 weeks');
  assert.equal(stepClause(g({ effort: 'days', what: 'real users first' })), 'real people use it');
  assert.equal(stepClause(g({ kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'hours' })), 'the app sends Base Builder Codes');
  assert.equal(stepClause(g({ kind: 'integration', item: 'integration:smart_wallet', what: 'add Smart Wallet', effort: 'days' })), 'Smart Wallet is in');
  assert.equal(stepClause(g({ kind: 'new_work_after', item: 'new_work_after:2026-01-01', what: 'real users first', effort: 'weeks' })), 'the new work has started');
  // Mixed with a change EarnKit cannot make, a do-able kind closes on its step.
  const CODES = g({ kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'hours', agent_can: true });
  const mixed = gap({ title: 'Mixed', gap: CODES, also: [{ kind: 'chain', item: 'chain:arc', what: 'deploy the contract on Arc', effort: 'hours', agent_can: false }] });
  assert.doesNotMatch(replyText(base({ gaps: [mixed] }), true), /that is done/);
  for (const x of [CODES, g({ kind: 'integration', item: 'integration:x', what: 'add X', effort: 'days' })]) assert.doesNotMatch(singleStepClosing(x), /that is done/);
});

test('L1i-2 (v6.1.16.1, Review Focus 1): the default view shows every step row the budget allows, numbered as shown, the more line naming the rest', () => {
  // L1j-3 (v6.1.17): the ready and step rows shown and hidden, from the ids the view numbers.
  assert.deepEqual(defaultRows(['a', 'b'], ['c', 'd', 'e'], ['a', 'c']), { readyShown: 1, readyHidden: 1, stepShown: 1, stepHidden: 2 });
  assert.deepEqual(defaultRows(['a', 'b', 'c'], [], ['a']), { readyShown: 1, readyHidden: 2, stepShown: 0, stepHidden: 0 });
  assert.equal(moreInFull(2), 'And 2 more in the full list.');
  const yc = ready({ title: 'Y Combinator', money: '$500K investment', in_person: true, setup: ['a YC account'], needs: ['a YC account'] });
  const alliance = ready({ title: 'Alliance', money: '$400K', in_person: true, setup: ['a passport'], needs: ['a passport'] });
  const steps = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].map((t) => gap({ title: `${t} Grant` }));
  // The rule the closing asks sits fifth: it is shown first among the rows kept, and the Say names its shown number.
  steps[4] = gap({ title: 'Five Grant', gap: ruleGap('a rule'), rules: ['a rule'] });
  // L38 big 2 (v6.1.18 Task 10): the In person line takes one line, so two more steps than before fit the budget.
  steps.push(gap({ title: 'Eight Grant' }), gap({ title: 'Nine Grant' }));
  const r = base({ ready: [yc, alliance], gaps: steps });
  const p = replyParts(r, true);
  const lines = p.text.split('\n');
  assert.equal(lines.filter((l) => l !== '').length, 10, p.text);
  assert.equal(lines[0], 'Nothing is ready to send yet. The closest:');
  const rows = lines.filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.split('.')[0]));
  assert.deepEqual(rows, rows.map((_, i) => i + 1), p.text);
  // L1j-3 (v6.1.17): every row left out, step or in person, is counted on the line before the Say.
  assert.equal(lines.at(-3), 'Also open: Y Combinator ($500K) and Alliance ($400K), in person; and 2 more in the full list.', p.text);
  const five = lines.find((l) => l.includes('Five Grant'))!;
  assert.equal(lines.at(-1), `Say ${five.split('.')[0]} if the Five Grant rule fits you and I draft it.`);
  // Every program the default leaves out is in the full view, and the full view asks no rule.
  const full = replyText(r, true, new Date(), null, { all: true });
  for (const g of steps) assert.ok(full.includes(`. ${g.title} ($1K).`), g.title);
  assert.doesNotMatch(full, /Say \d+ if/);
  assert.equal(full.split('\n').at(-1), FULL_RULE_SAY);
  // `shown` names the rows by their shown number, in order (the In person line's two too).
  assert.equal(p.shown.length, rows.length + 2);
  assert.ok(p.text.split('\n').includes('Also open: Y Combinator ($500K) and Alliance ($400K), in person; and 2 more in the full list.'), p.text);
});

test('L1i-6 (v6.1.16.1): the full view carries closes and in person; a hidden ready row leaves no gap in the shown numbers', () => {
  const rs = ['A', 'B', 'C', 'D', 'E'].map((t) => ready({ title: `${t} Grant`, closes_in: t === 'A' ? 'Dec 6' : null }));
  const r = base({ ready: rs, gaps: [gap({ title: 'Step Grant' })] });
  const text = replyText(r, true);
  assert.match(text, /^4\. Step Grant \(\$1K\) needs you to deploy the contract on Arc first\.$/m);
  assert.match(replyText(r, true, new Date(), null, { all: true }), /^1\. A Grant \(\$1K, closes Dec 6\)\.$/m);
});

test('Fix round 1 (I1, v6.1.16.1): the line carrying the only link outranks every line but the Say; since, results, then extra rows give way', async () => {
  const { unlinkedNoticeLine } = await import('../v6/reply-words');
  const link = 'https://earnkit.com/link/abc';
  const yc = ready({ title: 'Y Combinator', money: '$500K investment', in_person: true, setup: ['a YC account'], needs: ['a YC account'] });
  const alliance = ready({ title: 'Alliance', money: '$400K', in_person: true, setup: ['a passport'], needs: ['a passport'] });
  // L38 big 2 (v6.1.18 Task 10): the In person line is one line, so three more steps keep the budget tight.
  const steps = [gap({ title: 'Rule Grant', gap: ruleGap('a rule'), rules: ['a rule'] }), ...['Two', 'Three', 'Four', 'Five', 'Six'].map((t) => gap({ title: `${t} Grant` }))];
  const busy = {
    ready: [yc, alliance], gaps: steps, sign_in: link,
    applications: [{ program_id: 'a', title: 'A Grant', status: 'waiting' as const, sent_at: '2026-11-03T10:00:00.000Z', result_at: null, amount: null }],
    ask_outcome: [{ program_id: 'z', title: 'Zeta Grant', due_at: '2026-11-01T00:00:00Z' }],
    nothing_new_since: '2026-11-03T10:00:00.000Z',
  };
  // L46-5 (v6.1.20): signed out, the rule yes carries the sign-in and its link, once; the unlink notice drops its own.
  for (const over of [{}, { linked_notice: unlinkedNoticeLine(link) }]) {
    const p = replyParts(base({ ...busy, ...over }), false, MON);
    const lines = p.text.split('\n');
    assert.ok(lines.filter((l) => l.trim() !== '').length <= 10, p.text);
    assert.equal(p.text.split(link).length, 2, p.text);
    assert.ok(!p.hidden.some((h) => h.includes(link)), p.hidden.join('\n'));
    assert.equal(lines.at(-1)!, `Sign in at ${link}, then say 1 if the Rule Grant rule fits you and I draft it.`);
    // The since line gives way first, then the results question; the extra step rows last.
    assert.ok(!lines.some((l) => l.startsWith('Nothing new since')), p.text);
  }
});

test('L35-8 (v6.1.17, lane 35 C.2 and C.3): a ready row closing within a day is shown first; the yes says what it covers', () => {
  const NOW = new Date('2026-11-12T08:00:00Z');
  const later = ['Dec One', 'Dec Two', 'Dec Three', 'Dec Four'].map((t) => ready({ title: t, closes_at: '2026-12-12T23:59:00Z', closes_in: 'Dec 12' }));
  const minutes = ready({ title: 'L35 Closes In 2 Min', closes_at: '2026-11-12T08:02:00Z', closes_in: 'today' });
  const soon = ready({ title: 'L35 Closing Soon', closes_at: '2026-11-12T08:40:00Z', closes_in: 'today' });
  const r = base({ ready: [...later, minutes, soon] });
  const p = replyParts(r, true, NOW);
  assert.equal(p.text, [
    '6 programs are ready to send now.',
    '',
    '1. L35 Closes In 2 Min ($1K, closes today). I apply once you say yes.',
    '2. L35 Closing Soon ($1K, closes today). I apply once you say yes.',
    '3. Dec One ($1K, closes Dec 12). I apply once you say yes.',
    '',
    'Also: 3 more in the full list.',
    '',
    'Say yes and I apply to all 6.',
  ].join('\n'));
  const full = replyText(r, true, NOW, null, { all: true, defaultSay: p.say });
  assert.equal(full.split('\n')[0], 'Everything open, nearest first:');
  assert.equal(full.split('\n').at(-1), 'Say yes and I apply to all 6.');
});

test('L35-8 (v6.1.17 fix round 1 I1): a capped ready block draft-only says the count once too', () => {
  const r = base({
    ready: ['A', 'B', 'C', 'D', 'E'].map((t) => ready({ title: t })),
    blockers: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ program_id: id, sign_in: null, needs_click: true, needs: [] })),
  });
  const p = replyParts(r, true, new Date('2026-11-12T08:00:00Z'));
  // L1k-5 (v6.1.18): the more line follows the rows; the Before line follows it.
  assert.deepEqual(p.text.split('\n').slice(-4), [
    '',
    'Before applying: you press submit yourself on A, B, C, D and E.',
    '',
    'Say yes and I draft all 5 for you to send.',
  ]);
  assert.doesNotMatch(p.text, /not shown/);
});

test('v6.1.16 Task 11 N2 (v6.1.17): with every ready program under "Your yes stands", a do gap still closes the reply', () => {
  const CODES = { kind: 'builder_codes' as const, item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'hours' as const, agent_can: true };
  assert.equal(closingLine({ ready: 1, draftOnly: false, gaps: 1, firstRule: null, inPerson: 0, held: 0, yesStands: ['Alpha'], doOffer: { n: 2, verb: 'add them' } }).text,
    'Your yes stands for Alpha: I apply now, or say do 2 and I add them first.');
  const r = base({ ready: [ready({ title: 'Alpha', rule_yes: true })], gaps: [gap({ title: 'Codes Grant', gap: CODES })] });
  assert.equal(replyText(r, false, new Date(), 'apply').split('\n').at(-1), 'Your yes stands for Alpha: I apply now, or say do 2 and I add the codes first.');
});

test('v6.1.16 Task 9 N4 (v6.1.17): a program the not-sent line names gets no started line', () => {
  const NOW = new Date('2026-11-06T12:00:00Z');
  const r = base({
    ready: [ready({ title: 'Alpha Grant' })],
    not_sent: { programs: [{ program_id: 'beta', title: 'Beta Grant' }], since: '2026-11-04T10:00:00.000Z' },
    released: [{ program_id: 'beta', title: 'Beta Grant', started_at: '2026-11-04T10:00:00.000Z' }, { program_id: 'gamma', title: 'Gamma Grant', started_at: '2026-11-04T10:00:00.000Z' }],
  });
  const text = replyText(r, false, NOW);
  assert.equal(text.match(/Beta Grant/g)?.length, 1, text);
  assert.match(text, /^Gamma Grant: started Nov 4, nothing sent\.$/m);
});

test('L35-21 (v6.1.17): the same list again the same day reads "your last look"; a later day keeps the date', () => {
  const one = base({ ready: [ready({ title: 'Alpha Grant' })] });
  const NOW = new Date('2026-11-12T15:00:00Z');
  assert.equal(replyText({ ...one, nothing_new_since: '2026-11-12T09:00:00.000Z' }, false, NOW).split('\n').at(-2), '');
  assert.equal(replyText({ ...one, nothing_new_since: '2026-11-11T09:00:00.000Z' }, false, NOW).split('\n').at(-2), '');
});

test('L1j-1, L1j-6 (v6.1.17): one sentence mentions signing in, and the action is the last line', () => {
  const TIER = { kind: 'tier' as const, item: 'tier:used', what: 'proof of real users', effort: 'weeks' as const, agent_can: false };
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users first', effort: 'hours' as const, agent_can: false };
  const link = 'https://earnkit.com/link/abc';
  // The users question carries the sign-in: no proof line beside it.
  const users = replyText(base({ sign_in: link, gaps: [gap({ title: 'FLOSS', gap: USERS })] }), true);
  assert.equal(users.split(/(?<=[.?!])\s+/).filter((x) => /sign in/i.test(x)).length, 1, users);
  assert.equal(users.split('\n').at(-1), `Do real people use it? Say yes, sign in at ${link}, and I check.`);
  // L38 big 1 (v6.1.18 Task 10): a closing whose action needs no sign-in (the code step of another program) has no
  // sign-in line; the link stays in the JSON.
  const code = replyText(base({ sign_in: link, gaps: [gap({ title: 'Sign Grant', gap: TIER }), gap({ title: 'Code Grant', gap: NEEDS_CODE })] }), true);
  assert.doesNotMatch(code, /Sign in/, code);
  assert.equal(code.split('\n').at(-1), 'Tell me when the code is in a repo and I look again.', code);
  // The only step program's change is the proof, with a rule: the rule Say carries the sign-in, first.
  const ruled = replyText(base({ sign_in: link, gaps: [gap({ title: 'Thiel Fellowship', gap: TIER, also: [ruleGap('a student')], rules: ['a student'] })] }), true);
  assert.equal(ruled.split('\n').at(-1), `Sign in at ${link} so I can check the repo, then say 1 if the Thiel Fellowship rule fits you and I draft it.`, ruled);
  assert.equal(ruled.split(/(?<=[.?!])\s+/).filter((x) => /sign in/i.test(x)).length, 1, ruled);
  assert.doesNotMatch(ruled, /remember you/);
});

test('L38 big 2 (v6.1.18 Task 10): the default In person block is one line, numbers kept; the setup and needs go to the agent', async () => {
  const { moneyFigure, inPersonShort } = await import('./reply');
  assert.equal(moneyFigure('$500,000 investment'), '$500,000');
  assert.equal(moneyFigure('$400,000 at admission'), '$400,000');
  assert.equal(moneyFigure('up to $250,000 investment or $10,000 grant'), 'up to $250,000');
  assert.equal(moneyFigure('$500,000 to $1,000,000 investment'), '$500,000 to $1,000,000');
  assert.equal(moneyFigure('NYC incubator with relocation stipend'), 'NYC incubator with relocation stipend');
  assert.equal(inPersonShort({ n: 4, title: 'Y', money: '$1K prize' }), '4. Y, $1K.');
  const odds = 'many apply, few are taken';
  const yc = ready({ title: 'Y Combinator Winter 2027 Batch', money: '$500,000 investment', in_person: true, long_shot: odds, setup: ['a YC account'], needs: ['a YC account', 'your answers'] });
  const alliance = ready({ title: 'Alliance ALL19', money: '$400,000 at admission', closes_in: 'in 6 days', in_person: true, long_shot: odds, setup: ['your email'], needs: ['your email'] });
  const steps = ['Colosseum Eternal', 'FLOSS/fund', 'Solana Foundation Grants'].map((t) => gap({ title: t }));
  const p = replyParts(base({ ready: [yc, alliance], gaps: steps }), true);
  const lines = p.text.split('\n');
  assert.ok(lines.filter((l) => l.trim() !== '').length <= 10, p.text);
  assert.ok(lines.includes('Also open: Y Combinator Winter 2027 Batch ($500,000) and Alliance ALL19 ($400,000, closes in 6 days), in person with long odds.'), p.text);
  assert.doesNotMatch(p.text, /Long odds: many|Needs a YC account|your email/);
  assert.ok(p.hidden.some((h) => h.startsWith('4. Y Combinator Winter 2027 Batch, $500,000 investment. Long odds: many apply, few are taken. Needs a YC account')), p.hidden.join('\n'));
  assert.deepEqual(p.shown.slice(-2), [yc.program_id, alliance.program_id]);
});

test('L1l-3 (v6.1.19): a setup step plus a rule is More to do first', async () => {
  const { oneStep } = await import('./reply');
  const essp = gap({
    title: 'Ethereum Security Subsidy Program', money: 'up to 30% of audit cost', gap: ruleGap('a defined audit scope: lines of code and contract count'),
    setup: ['set aside a security budget to co-fund the audit'], rules: ['a defined audit scope: lines of code and contract count'],
  });
  assert.equal(oneStep(essp), false);
  assert.equal(oneStep({ ...essp, setup: [] }), true);
  const text = replyText(base({ linked: true, gaps: [essp] }), true);
  const lines = text.split('\n');
  assert.equal(lines[0], 'Nothing is ready to send yet. The closest:', text);
  assert.doesNotMatch(text, /One step away/);
  assert.ok(lines.filter((l) => l.trim() !== '').length <= 10 && /^(Nothing|Say)/.test(lines.at(-1)!), text);
});

test('L38 big 3 (v6.1.18 Task 10): one step means one step; the rest go under More to do first as the first step and the count', async () => {
  const { stepItems, oneStep, moreStepsLine } = await import('./reply');
  const colosseum = gap({
    title: 'Colosseum Eternal', money: '$25,000 award', gap: { ...VIDEO, what: 'a demo video' },
    setup: ['sign up for a Colosseum account', 'start the four-week sprint in the Eternal dashboard'],
    also: [ruleGap('a crypto product, new in the sprint'), ruleGap('the team has not raised venture capital', 'rule:0000000b')],
    rules: ['a crypto product, new in the sprint', 'the team has not raised venture capital'],
  });
  assert.equal(stepItems(colosseum).length, 5);
  assert.equal(oneStep(colosseum), false);
  assert.equal(moreStepsLine({ ...colosseum, n: 2 }), '2. Colosseum Eternal, $25,000 award: a demo video, then 4 more steps.');
  // L1l-2 (v6.1.19): the row always names its first step, even when the closing repeats it.
  assert.equal(moreStepsLine({ ...colosseum, gap: VIDEO, n: 2 }), '2. Colosseum Eternal, $25,000 award: a demo video link (a short screen recording of it working), then 4 more steps.');
  // One real gap alone is one step; a rule-only row is one yes (every rule in one ask), so one step too.
  const solana = gap({ title: 'Solana Foundation Grants', money: 'milestone grants', gap: ruleGap('a public good'), also: [ruleGap('open source', 'rule:0000000b')] });
  assert.equal(oneStep(solana), true);
  assert.equal(oneStep(gap({ title: 'Circle' })), true);
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users', effort: 'hours' as const, agent_can: false };
  const floss = gap({ title: 'FLOSS/fund', money: '$10,000 to $100,000', gap: USERS, setup: ['publish a funding manifest on your site or repo'] });
  assert.equal(moreStepsLine({ ...floss, n: 3 }), '3. FLOSS/fund, $10,000 to $100,000: real users, then 1 more step.');
  // The default view: One step away first, then More to do first, numbered as shown, within 10 lines.
  const p = replyParts(base({ linked: true, gaps: [colosseum, floss, solana] }), true);
  assert.deepEqual(p.text.split('\n'), [
    'Nothing is ready to send yet. The closest:',
    '',
    '1. Solana Foundation Grants (milestone grants) needs one yes from you: a public good; open source.',
    '2. Colosseum Eternal ($25,000 award) needs a demo video, then 4 more steps.',
    '3. FLOSS/fund ($10,000 to $100,000) needs real users, then 1 more step.',
    '',
    'Say 1 if the Solana Foundation Grants rules fit you and I draft it.',
  ]);
  // The full list heads every row not ready as one block.
  const full = replyText(base({ linked: true, gaps: [colosseum, floss, solana] }), true, new Date(), null, { all: true });
  assert.match(full, /^Not ready yet:$/m);
  assert.doesNotMatch(full, /One step away|More to do first/);
  // The more line counts what both headings leave out, once, and the default keeps to 10 lines.
  const many = [...Array.from({ length: 6 }, (_, k) => gap({ title: `Rule ${k}`, gap: ruleGap(`rule ${k}`) })), ...Array.from({ length: 6 }, (_, k) => ({ ...floss, title: `Floss ${k}`, program_id: `floss-${k}` }))];
  const tight = replyParts(base({ linked: true, gaps: many }), true);
  const lines = tight.text.split('\n');
  assert.ok(lines.filter((l) => l.trim() !== '').length <= 10, tight.text);
  const rows = lines.filter((l) => /^\d+\. /.test(l)).length;
  assert.equal(lines.at(-3), `Also: ${12 - rows} more in the full list.`, tight.text);
  assert.equal(tight.more, 12 - rows);
});

test('L38-27 (v6.1.18 Task 11): the license file gap reads "a license file" and its do offer adds an MIT license file', () => {
  const hero = gap({ title: 'HeroDevs Open Source Sustainability Fund', money: '$2,500 to $15,000', gap: LICENSE_FILE, n: 1 });
  assert.equal(gapLine(hero, true), 'HeroDevs Open Source Sustainability Fund, $2,500 to $15,000: a license file.');
  assert.equal(gapAction(hero), 'Say do and I add an MIT license file first.');
  const list = replyText(base({ gaps: [hero] }), true);
  assert.equal(list, [
    'Nothing is ready to send yet. The closest:',
    '',
    '1. HeroDevs Open Source Sustainability Fund ($2,500 to $15,000) needs a license file first.',
    '',
    'Say do 1 and I add an MIT license file.',
  ].join('\n'));
  assert.doesNotMatch(list, /\u2014|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
});

test('v6.1.18 final fix (I2): the users-plus-change closing says a change with its own verb, never "I a license file"', () => {
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users', effort: 'hours' as const, agent_can: false };
  const hero = gap({ title: 'HeroDevs Open Source Sustainability Fund', money: '$2,500 to $15,000', gap: USERS, also: [LICENSE_FILE] });
  assert.deepEqual(doUsersOf([hero])?.verb, 'add an MIT license file');
  const end = replyText(base({ linked: true, gaps: [hero] }), true).split('\n').at(-1)!;
  assert.equal(end, 'Do real people use it? Say yes and I add an MIT license file, then apply to HeroDevs Open Source Sustainability Fund.');
  assert.doesNotMatch(end, /I a license file|\u2014/);
});

test('Task 10 fix round 1 (I1, M3, M6): a proof sign-in only when the closing keeps the Say; step blocks leave room; the check names the bar with no repo', () => {
  const TIER = { kind: 'tier' as const, item: 'tier:used', what: 'proof of real users', effort: 'weeks' as const, agent_can: false };
  const link = 'https://earnkit.com/link/abc';
  const sign = gap({ title: 'Sign Grant', gap: TIER });
  // I1: an earlier line keeps the Say (a yes not yet sent): the closing stays a fact and says no sign-in.
  const early = replyText(base({ sign_in: link, gaps: [sign], not_sent: { programs: [{ program_id: 'x', title: 'X Grant' }], since: '2026-11-03T10:00:00.000Z' } }), true, MON);
  assert.doesNotMatch(early, /Sign in/, early);
  assert.match(early.split('\n').at(-1)!, /^Nothing was sent for X Grant since you said yes on .*\. Say yes again and I apply now\.$/, early);
  assert.equal(early.match(/\bSay\b/g)?.length, 1, early);
  // Without it the proof is the action, signed in first.
  assert.equal(replyText(base({ sign_in: link, gaps: [sign] }), true).split('\n').at(-1), `Sign in at ${link} so I can check the repo, then I look again.`);
  // M6: no repo link: the check is the proof's bar.
  assert.equal(replyParts(base({ sign_in: link, gaps: [sign] }), true, new Date(), null, { repo: false }).text.split('\n').at(-1), `Sign in at ${link} so I can check your users, then I look again.`);
  // FR-3 (v6.1.17 deferred): the live and building bars read as a check that it is, not an order to check.
  for (const [bar, what, check] of [['live', 'proof that your product is live', 'that your product is live'], ['building', 'proof that your project has code', 'that your project has code']] as const) {
    const g = gap({ title: 'Sign Grant', gap: { ...TIER, item: `tier:${bar}`, what } });
    const end = replyParts(base({ sign_in: link, gaps: [g] }), true, new Date(), null, { repo: false }).text.split('\n').at(-1)!;
    assert.equal(end, `Sign in at ${link} so I can check ${check}, then I look again.`);
    assert.doesNotMatch(end, /\u2014|check your (product|project)/, end);
  }
  // M3: a ready block, a one-step row and a More row the closing names: the applications line still fits.
  const r = base({
    linked: true,
    ready: [ready({ title: 'A' }), ready({ title: 'B' }), ready({ title: 'C' })],
    gaps: [gap({ title: 'Rule Grant', gap: ruleGap('a rule') }), gap({ title: 'Two Grant', gap: VIDEO, also: [ruleGap('x')] })],
    applications: [{ program_id: 'z', title: 'Z Grant', status: 'waiting' as const, sent_at: '2026-11-03T10:00:00.000Z', result_at: null, amount: null }],
  });
  const t = replyText(r, false, MON);
  assert.ok(t.split('\n').filter((l) => l.trim() !== '').length <= 10, t);
  assert.match(t, /^Your applications: Z Grant \(sent Nov 3, waiting\)\.$/m);
});

test('Task 10 fix round 1 (I2): a rule-only in-person row keeps its rule on the one In person line', () => {
  const antler = gap({ title: 'Antler', money: '$250K', in_person: true, gap: ruleGap('a co-founder with US work authorization') });
  const t = replyText(base({ gaps: [antler] }), true);
  assert.equal(t, 'Nothing remote is ready yet.\n\nAlso open: Antler ($250K, one yes from you: a co-founder with US work authorization), in person.\n\nSay yes and I start the in-person applications.');
});

// v6.1.20: the reply reads like a person. One pinned reply per state: the opening sentence, the program sentences, the
// Also sentence, the closing; blocks apart by blank lines, one Say and it is last, at most one sign-in sentence, at most
// 10 lines that are not blank, and none of the banned words.
const V20_LINK = 'https://earnkit.com/link/abc';
const V20 = {
  floss: ready({ title: 'FLOSS/fund', money: '$10,000 to $100,000' }),
  yc: ready({ title: 'Y Combinator Winter 2027 Batch', money: '$500,000 investment', in_person: true, long_shot: 'many apply, few are taken', setup: ['a YC account'], needs: ['a YC account'] }),
  alliance: ready({ title: 'Alliance ALL19', money: '$400,000 at admission', in_person: true, closes_in: 'in 5 days', long_shot: 'many apply', setup: ['a passport'], needs: ['a passport'] }),
  rule: gap({ title: 'Base Ecosystem Fund', money: 'pre-seed and seed investment', gap: { kind: 'rule', item: 'rule:abcd1234', what: 'a pre-seed or seed stage startup that chooses Base as its home', effort: 'minutes', agent_can: false } }),
  users: gap({ title: 'FLOSS/fund', money: '$10,000 to $100,000', gap: { kind: 'users', item: 'users', what: 'real users', effort: 'hours', agent_can: false } }),
  code: gap({ title: 'FUTO Microgrants', money: '$1,000 to $5,000', gap: NEEDS_CODE }),
  colosseum: gap({ title: 'Colosseum Eternal', money: '$25,000 award', gap: { kind: 'demo_video', item: 'demo_video', what: 'a demo video link (a short screen recording of it working)', effort: 'hours', agent_can: false }, setup: ['join the sprint', 'register on Arena'] }),
};
const V20_NOW = new Date('2026-11-13T10:00:00Z');
const v20 = (r: R, o: Parameters<typeof replyText>[4] = {}) => replyText(r, true, V20_NOW, null, { name: 'Invoicely', ...o });
/** Every v6.1.20 rule a builder reply obeys. */
const v20Rules = (t: string) => {
  const lines = t.split('\n');
  assert.ok(lines.filter((l) => l !== '').length <= 10, t);
  assert.ok(!/\n\n\n/.test(t) && lines[0] !== '' && lines.at(-1) !== '', t);
  assert.ok((t.match(/\bSay\b/g) ?? []).length <= 1, t);
  if (/\bSay\b/.test(t)) assert.ok(/\bSay\b/.test(lines.at(-1)!), t);
  assert.ok(t.split(/(?<=[.?!:])\s+/).filter((x) => /^Sign in\b/.test(x)).length <= 1, t);
  assert.doesNotMatch(t, /—|\p{Extended_Pictographic}|\b(score|rank|grade|points|coin|token|streak)s?\b|"|You give:|Their rule|First:|One step away|More to do first|\(\d+\):/iu);
  for (const l of lines.filter((x) => x !== '')) assert.match(l, /[.?:]$/, l);
};
const V20_STATES: [string, R, Parameters<typeof replyText>[4], string][] = [
  ['ready, linked', base({ ready: [V20.floss], gaps: [V20.rule], linked: true }), {}, [
    'For Invoicely, 1 program is ready to send now.',
    '',
    '1. FLOSS/fund ($10,000 to $100,000). I apply once you say yes.',
    '2. Base Ecosystem Fund (pre-seed and seed investment) needs one yes from you: a pre-seed or seed stage startup that chooses Base as its home.',
    '',
    'Say yes and I apply to FLOSS/fund.',
  ].join('\n')],
  ['rule yes, with in person and the long tail', base({ gaps: [V20.rule, V20.users, V20.colosseum], ready: [V20.yc, V20.alliance], linked: true }),
    { hidden: { count: 29, closing: [{ program_id: 'meta', title: 'Meta VR Start Developer Competition 2026', closes_at: '2026-11-19T10:00:00Z', closes_in: 'in 6 days' }] } }, [
    'Nothing is ready to send for Invoicely yet. The closest:',
    '',
    '1. Base Ecosystem Fund (pre-seed and seed investment) needs one yes from you: a pre-seed or seed stage startup that chooses Base as its home.',
    '2. FLOSS/fund ($10,000 to $100,000) needs real users first.',
    '3. Colosseum Eternal ($25,000 award) needs a demo video link (a short screen recording of it working), then 2 more steps.',
    '',
    'Also open: Y Combinator Winter 2027 Batch ($500,000) and Alliance ALL19 ($400,000, closes in 5 days), in person with long odds; and 29 more in the full list; Meta VR Start Developer Competition 2026 closes in 6 days.',
    '',
    'Say 1 if the Base Ecosystem Fund rule fits you and I draft it.',
  ].join('\n')],
  ['rule yes, signed out (L46-5)', base({ gaps: [V20.rule, V20.users], sign_in: V20_LINK }), {}, [
    'Nothing is ready to send for Invoicely yet. The closest:',
    '',
    '1. Base Ecosystem Fund (pre-seed and seed investment) needs one yes from you: a pre-seed or seed stage startup that chooses Base as its home.',
    '2. FLOSS/fund ($10,000 to $100,000) needs real users first.',
    '',
    `Sign in at ${V20_LINK}, then say 1 if the Base Ecosystem Fund rule fits you and I draft it.`,
  ].join('\n')],
  ['users question, signed out', base({ gaps: [V20.users], ready: [V20.yc, V20.alliance], sign_in: V20_LINK }), { hidden: { count: 21, closing: [] } }, [
    'Nothing is ready to send for Invoicely yet. The closest:',
    '',
    '1. FLOSS/fund ($10,000 to $100,000) needs real users first.',
    '',
    'Also open: Y Combinator Winter 2027 Batch ($500,000) and Alliance ALL19 ($400,000, closes in 5 days), in person with long odds; and 21 more in the full list.',
    '',
    `Do real people use it? Say yes, sign in at ${V20_LINK}, and I check.`,
  ].join('\n')],
  ['users question, linked', base({ gaps: [V20.users], linked: true }), {}, [
    'Nothing is ready to send for Invoicely yet. The closest:',
    '',
    '1. FLOSS/fund ($10,000 to $100,000) needs real users first.',
    '',
    'Do real people use it? Say yes and I check.',
  ].join('\n')],
  ['a step the builder makes', base({ gaps: [V20.code], linked: true }), {}, [
    'Nothing is ready to send for Invoicely yet. The closest:',
    '',
    '1. FUTO Microgrants ($1,000 to $5,000) needs the code in a repo first.',
    '',
    'Tell me when the code is in a repo and I look again.',
  ].join('\n')],
  ['a step, with an in-person program to draft (L46-2)', base({ gaps: [V20.code], ready: [V20.yc], linked: true }), {}, [
    'Nothing is ready to send for Invoicely yet. The closest:',
    '',
    '1. FUTO Microgrants ($1,000 to $5,000) needs the code in a repo first.',
    '',
    'Also open: Y Combinator Winter 2027 Batch ($500,000), in person with long odds.',
    '',
    'Say 2 and I draft Y Combinator Winter 2027 Batch for you to send.',
  ].join('\n')],
  ['in person only', base({ ready: [V20.yc, V20.alliance], linked: true }), {}, [
    'Nothing remote is ready for Invoicely yet.',
    '',
    'Also open: Y Combinator Winter 2027 Batch ($500,000) and Alliance ALL19 ($400,000, closes in 5 days), in person with long odds.',
    '',
    'Say yes and I start the in-person applications.',
  ].join('\n')],
  ['the sent ask is the one Say (L46-9)', base({ gaps: [V20.code], ask_sent: [{ program_id: 'y', title: 'Y Combinator Winter 2027 Batch', started_at: '2026-11-12T08:00:00Z', project_id: null, project: null }], linked: true }), {}, [
    'Nothing is ready to send for Invoicely yet. The closest:',
    '',
    '1. FUTO Microgrants ($1,000 to $5,000) needs the code in a repo first.',
    '',
    'When the code is in a repo, I look again.',
    '',
    'Did you send Y Combinator Winter 2027 Batch? Say sent and I note it.',
  ].join('\n')],
  ['held by the builder', base({ ready: [{ ...V20.floss, held: true }], linked: true }), {}, [
    'For Invoicely, 1 program is ready, on hold until you say go.',
    '',
    '1. FLOSS/fund ($10,000 to $100,000), on hold until you say go.',
    '',
    'Say go and I apply.',
  ].join('\n')],
  ['standing approval', base({ ready: [V20.floss], linked: true, auto_apply: true, max_per_night: 3, auto_sent_today: 0 }), {}, [
    'For Invoicely, 1 program is ready to send now.',
    '',
    '1. FLOSS/fund ($10,000 to $100,000). I send it under your standing approval.',
    '',
    'Applying now to FLOSS/fund under your standing approval. Say stop and I hold any of them.',
  ].join('\n')],
  ['nothing fits', base({ linked: true }), {}, 'Nothing fits Invoicely yet. Tell me more about it, or its repo link, and I look again.'],
];
for (const [name, r, o, want] of V20_STATES)
  test(`v6.1.20: ${name}`, () => {
    const t = v20(r, o);
    assert.equal(t, want);
    v20Rules(t);
  });

test('v6.1.20: ready, signed out with a repo: the gate takes the row\'s apply away and the sign-in leads the one Say', async () => {
  const { applyOfferOf, gatedRow } = await import('./find');
  const { signInFirst } = await import('./ledger');
  const t = v20(base({ ready: [V20.floss], gaps: [V20.rule], sign_in: V20_LINK }));
  const gated = [...t.split('\n').slice(0, -1).map((l) => gatedRow(l, 'strip')), signInFirst(V20_LINK, applyOfferOf(t))].join('\n');
  assert.equal(gated, [
    'For Invoicely, 1 program is ready to send now.',
    '',
    '1. FLOSS/fund ($10,000 to $100,000).',
    '2. Base Ecosystem Fund (pre-seed and seed investment) needs one yes from you: a pre-seed or seed stage startup that chooses Base as its home.',
    '',
    `Sign in at ${V20_LINK} so I know the repo is yours, then say yes and I apply to FLOSS/fund.`,
  ].join('\n'));
  v20Rules(gated);
  // An unconfirmed repo: the row and the yes draft for the builder to send.
  assert.equal(gatedRow('1. FLOSS/fund ($10,000 to $100,000). I apply once you say yes.', 'draft'), '1. FLOSS/fund ($10,000 to $100,000). I draft it for you to send.');
  assert.equal(gatedRow('FLOSS/fund ($10,000 to $100,000). It is ready: I apply once you say yes.', 'strip'), 'FLOSS/fund ($10,000 to $100,000). It is ready.');
});

test('v6.1.20: the opening, the program sentences and the Also sentence as pure functions', () => {
  assert.equal(openingSentence({ name: null, ready: 3, steps: 0, inPerson: 0 }), '3 programs are ready to send now.');
  assert.equal(openingSentence({ name: 'Invoicely', ready: 0, steps: 2, inPerson: 1 }), 'Nothing is ready to send for Invoicely yet. The closest:');
  assert.equal(openingSentence({ name: null, ready: 0, steps: 0, inPerson: 0 }), 'Nothing fits yet. Tell me more about it, or its repo link, and I look again.');
  assert.equal(needWords('code in a public repo'), 'the code in a public repo');
  assert.equal(needWords('deploy the contract on Arc'), 'you to deploy the contract on Arc');
  assert.equal(needWords('Base Builder Codes in the app'), 'Base Builder Codes in the app');
  assert.equal(alsoSentence([], 19), 'Also: 19 more in the full list.');
  assert.equal(alsoSentence([], 0), null);
  assert.equal(closingAfterOpening('Nothing is ready yet. Say 1 if the X rule fits you and I draft it.'), 'Say 1 if the X rule fits you and I draft it.');
  assert.equal(plainClosing('Tell me when the repo is public and I look again.'), 'When the repo is public, I look again.');
  assert.equal(plainClosing('Do real people use it? Say yes and I check.'), '');
  assert.equal(countedLines('a\n\nb\n'), 2);
  assert.equal(paragraphs('a', ['b', 'c'], null, [], 'd'), 'a\n\nb\nc\n\nd');
});

test('v6.1.20: shortTitle cuts the organiser\'s suffix at the first colon or " - ", for every catalog file', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(import.meta.dirname, '..', '..', '..', '..', 'programs');
  const want: Record<string, string> = {
    'Arbitrum Mentorship Program: Cohort 2': 'Arbitrum Mentorship Program',
    'Arbitrum Open House São Paulo: Online Buildathon': 'Arbitrum Open House São Paulo',
    'Arc Microgrants: Built with Arc Studio': 'Arc Microgrants: Built with Arc Studio',
    'EarnKit Campaign #1: Base apps with real users': 'EarnKit Campaign #1',
    'LEGO: Lido Ecosystem Grants Organization': 'Lido Ecosystem Grants Organization',
    "PayPal AI Hackathon: Build What's Next with PayPal and AI": 'PayPal AI Hackathon',
  };
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 52);
  const shorts = new Map<string, string>();
  for (const f of files) {
    const p = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { title: string; short_title?: string };
    const s = shortTitle(p.title, p.short_title);
    assert.equal(s, want[p.title] ?? p.title, f);
    assert.ok(s.length <= 48 || s === p.title, f);
    assert.ok(!shorts.has(s), `${f} shares "${s}" with ${shorts.get(s)}`);
    shorts.set(s, f);
  }
  assert.equal(shortTitle('Uniswap Foundation Security Fund (UFSF) Audit Subsidies'), 'Uniswap Foundation Security Fund (UFSF) Audit Subsidies');
  assert.equal(shortTitle('Some Hackathon - a very long organiser suffix'), 'Some Hackathon');
});

// Registered last, so it reads every reply the tests above rendered.
test('Review Focus 12, ONE_SAY_ORDER (v6.1.17 Task 5, v6.1.16 Task 9 N6): every reply fixture rendered through replyText promises no send tonight and carries at most one Say', () => {
  assert.ok(rendered.length >= 100, `${rendered.length}`);
  for (const t of rendered) {
    assert.doesNotMatch(t, /\btonight\b|by tomorrow morning/i, t);
    assert.ok((t.match(/\bSay\b/g) ?? []).length <= 1, t);
  }
});

// L18-1 (v6.1.18): the rows the rank cap left out of the default view are counted on the more line, which names at
// most two of them that close this week, in closing order.
const L18_NOW = new Date('2026-11-12T08:00:00Z');
const plusDays = (now: Date, d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const l18Rows = () => {
  const yc = ready({ title: 'Y Combinator', money: '$500K investment', in_person: true, setup: ['a YC account'], needs: ['a YC account'] });
  const alliance = ready({ title: 'Alliance', money: '$400K', in_person: true, setup: ['a passport'], needs: ['a passport'] });
  return base({ ready: [yc, alliance], gaps: ['One', 'Two', 'Three'].map((t) => gap({ title: `${t} Grant` })) });
};
const UGREEN = { program_id: 'ugreen-hackathon-2026-on-ai-nas', title: 'UGREEN Hackathon 2026 on AI NAS', closes_at: plusDays(L18_NOW, 3) };
const META_VR = { program_id: 'meta-vr-start-developer-competition-2026', title: 'Meta VR Start Developer Competition 2026', closes_at: plusDays(L18_NOW, 6) };

test('L18-1: the more line counts the rows the rank cap hid and names what closes this week', () => {
  const text = renderReply(l18Rows(), true, L18_NOW, null, { hidden: { count: 18, closing: [UGREEN, META_VR] } });
  const lines = text.split('\n');
  assert.ok(lines.includes('Also open: Y Combinator ($500K) and Alliance ($400K), in person; and 18 more in the full list; UGREEN Hackathon 2026 on AI NAS closes in 3 days; Meta VR Start Developer Competition 2026 closes in 6 days.'), text);
  assert.ok(lines.filter((l) => l.trim() !== '').length <= 10, text);
  assert.equal(lines.at(-3)!.startsWith('Also open: '), true, text);
  assert.ok(/^(Nothing is ready yet\.|Say |Tell me )/.test(lines.at(-1)!), text);
  // The closing order is the closes_at order, whatever order they came in; never more than two are named.
  const third = { program_id: 'third-grant', title: 'Third Grant', closes_at: plusDays(L18_NOW, 1) };
  assert.equal(moreInFull(5, [META_VR, UGREEN, third], L18_NOW), 'And 5 more in the full list; closing this week: Third Grant (tomorrow) and UGREEN Hackathon 2026 on AI NAS (3 days).');
  assert.equal(moreInFull(5, [UGREEN], L18_NOW), 'And 5 more in the full list; closing this week: UGREEN Hackathon 2026 on AI NAS (3 days).');
  // Words given by find (in the program's own zone) are used as given.
  assert.equal(moreInFull(5, [{ ...UGREEN, closes_in: 'today' }], L18_NOW), 'And 5 more in the full list; closing this week: UGREEN Hackathon 2026 on AI NAS (today).');
});

test('L18-1b: the more line with nothing closing this week keeps the old shape', () => {
  const text = renderReply(l18Rows(), true, L18_NOW, null, { hidden: { count: 18, closing: [] } });
  assert.equal(text.split('\n').at(-3), 'Also open: Y Combinator ($500K) and Alliance ($400K), in person; and 18 more in the full list.', text);
  assert.equal(moreInFull(18), 'And 18 more in the full list.');
  // Without a hidden count, nothing changes: no rows hidden, no more line.
  assert.doesNotMatch(renderReply(l18Rows(), true, L18_NOW), /more in the full list/);
});

test('L18-1c: budget-hidden and cap-hidden rows are summed once', () => {
  // Seven step rows and two in person: the 10-line budget leaves some out (the L1i-2 fixture).
  const yc = ready({ title: 'Y Combinator', money: '$500K investment', in_person: true, setup: ['a YC account'], needs: ['a YC account'] });
  const alliance = ready({ title: 'Alliance', money: '$400K', in_person: true, setup: ['a passport'], needs: ['a passport'] });
  // L38 big 2 (v6.1.18 Task 10): nine, since the In person line takes one line.
  const r = base({ ready: [yc, alliance], gaps: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'].map((t) => gap({ title: `${t} Grant` })) });
  const budget = replyParts(r, true, L18_NOW);
  const left = Number(/and (\d+) more in the full list\.$/.exec(budget.text.split('\n').at(-3)!)![1]);
  assert.ok(left > 0, budget.text);
  assert.equal(budget.more, left);
  const p = replyParts(r, true, L18_NOW, null, { hidden: { count: 18, closing: [] } });
  const lines = p.text.split('\n');
  assert.equal(lines.at(-3), `Also open: Y Combinator ($500K) and Alliance ($400K), in person; and ${left + 18} more in the full list.`, p.text);
  assert.equal(p.more, left + 18);
  assert.equal(lines.filter((l) => /more in the full list/.test(l)).length, 1, p.text);
  assert.ok(lines.filter((l) => l.trim() !== '').length <= 10, p.text);
});

test('L18-1d: a closing program the default view shows is not named on the more line', () => {
  const r = base({ gaps: [gap({ title: UGREEN.title, closes_at: UGREEN.closes_at, closes_in: 'in 3 days' }), gap({ title: 'Two Grant' })] });
  const text = renderReply(r, true, L18_NOW, null, { hidden: { count: 4, closing: [UGREEN, META_VR] } });
  assert.ok(text.split('\n').includes('Also: 4 more in the full list; Meta VR Start Developer Competition 2026 closes in 6 days.'), text);
  // When every closing one is shown, the line keeps the old shape.
  assert.ok(renderReply(r, true, L18_NOW, null, { hidden: { count: 4, closing: [UGREEN] } }).split('\n').includes('Also: 4 more in the full list.'));
});

test('L18-1e: the agent note says how many more the full list holds', () => {
  const note = agentNote(l18Rows(), { more: 18 });
  assert.ok(note.split('\n').includes('The full list holds 18 more; show it when the builder asks for all, more or the full list. Call find with filter.all for it.'), note);
  assert.doesNotMatch(agentNote(l18Rows(), { more: 0 }), /full list holds/);
});

// L18-3 (v6.1.18): Kiroween is a Devpost hackathon the builder submits, so its one-program closing never says apply.
const KIRO_GAPS = (): GapProgram => gap({
  title: 'Kiroween 2026',
  money: '$100K',
  gap: VIDEO,
  also: [
    { kind: 'feature', item: 'feature:kiro', what: 'a Kiro folder in the repo', effort: 'days', agent_can: false },
    { kind: 'chain', item: 'chain:arc', what: 'deploy the contract on Arc', effort: 'hours', agent_can: false },
    ruleGap('built with Kiro'),
  ],
});

test('L18-3: Kiroween (builder submits) with three real gaps closes "Tell me when that is done and I draft it for you to send."', () => {
  const g = KIRO_GAPS();
  assert.equal(gapAction(g, null, true), 'Tell me when that is done and I draft it for you to send.');
  assert.equal(gapActionStep(g, null, true), null);
  // The rule-only and users closings stay as they were for a builder-sent program.
  assert.equal(gapAction(gap({ title: 'Fund', gap: ruleGap('a seed stage startup') }), null, true), 'Say yes if that is you and I draft it.');
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users', effort: 'hours' as const, agent_can: false };
  assert.equal(gapAction(gap({ title: 'Used', gap: USERS }), null, true), 'Say yes if they do and I draft it.');
  // A single step still closes on the step.
  assert.equal(gapAction(gap({ title: 'Video', gap: VIDEO }), null, true), 'Send me the demo video link and I fill it in.');
});

test('L18-3b: the same gaps on an agent-sent program still close "Tell me when that is done and I apply."', () => {
  assert.equal(gapAction(KIRO_GAPS()), 'Tell me when that is done and I apply.');
  assert.equal(gapAction(KIRO_GAPS(), null, false), 'Tell me when that is done and I apply.');
});

// ---- v6.1.18 Task 7 (lane 1k) ----

test('L1k-3: an in-person row under its heading has no in-person suffix', () => {
  const summit = ready({ title: 'Bare Summit', money: '$5K', in_person: true, closes_in: 'in 3 days' });
  const residency = gap({ title: 'Residency', money: '$1M', in_person: true, gap: ruleGap('a US co-founder'), rules: ['a US co-founder'] });
  // L38 big 3 (v6.1.18 Task 10): an in-person program one real step away lists under In person too (the Monad Blitz
  // bug), never under a step heading.
  const camp = gap({ title: 'Build Camp', money: '$2K', in_person: true });
  const text = replyText(base({ ready: [MONDAY.ready[0], summit], gaps: [camp, residency] }), false, new Date(), null, { all: true });
  const lines = text.split('\n');
  const ip = lines.indexOf('In person:');
  assert.ok(ip > 0, text);
  // The ready one first, then those with gaps, in list order.
  assert.equal(lines[ip + 1], '2. Bare Summit ($5K, closes in 3 days).', text);
  assert.equal(lines[ip + 2], '3. Build Camp ($2K).', text);
  assert.equal(lines[ip + 3], '4. Residency ($1M).', text);
  assert.ok(!lines.some((l) => /^(One step away|More to do first|Not ready yet) /.test(l)), text);
  for (const l of lines.slice(ip + 1).filter((x) => /^\d+\. /.test(x))) assert.doesNotMatch(l, /in person/, l);
});

test('L1k-5: the And-more line is the line after its block; the repo note follows it', () => {
  const rs = Array.from({ length: 5 }, (_, k) => ready({ title: `Fund ${k + 1}` }));
  const r = base({ ready: rs, gaps: [gap({ title: 'Circle Developer Grants' })], repo_notes: ['other_host'] });
  const lines = replyText(r, false).split('\n');
  const more = lines.findIndex((l) => l.startsWith('Also: '));
  assert.ok(more > 0, lines.join('\n'));
  // v6.1.20: the Also sentence is the block after the rows; the repo note comes after it, then the Say.
  assert.match(lines[more - 2], /^\d+\. /, lines.join('\n'));
  // L38-7 (v6.1.18).
  assert.equal(lines[more + 2], 'I read GitHub repos only, so this is from what you told me.', lines.join('\n'));
  assert.ok(lines.filter((l) => l.trim() !== '').length <= 10);
  // With hidden rank-capped rows and an applications line, the more line still follows the rows.
  const apps = base({ ready: rs.slice(0, 1), repo_notes: ['other_host'], applications: [{ program_id: 'a', title: 'A', status: 'waiting', sent_at: '2026-11-03T10:00:00.000Z', result_at: null, amount: null }] });
  const t = replyParts(apps, false, MON, null, { hidden: { count: 3, closing: [] } }).text.split('\n');
  assert.deepEqual(t.slice(0, 7), ['1 program is ready to send now.', '', '1. Fund 1 ($1K). I apply once you say yes.', '', 'Also: 3 more in the full list.', '', 'Your applications: A (sent Nov 3, waiting).'], t.join('\n'));
});

test('Task 7 (Task 1 review minors): the more line drops a shown program by id, not title, and names two of what is left', () => {
  const shown = gap({ title: 'Twin Grant', program_id: 'twin-a', closes_at: plusDays(L18_NOW, 1), closes_in: 'tomorrow' });
  const r = base({ gaps: [shown, gap({ title: 'Two Grant' })] });
  // A hidden program with the shown one's title but another id is still named; the shown one (by id) is not. The cut
  // to two comes after that filter, so the shown one never takes a slot.
  const twin = { program_id: 'twin-b', title: 'Twin Grant', closes_at: plusDays(L18_NOW, 2) };
  const text = renderReply(r, true, L18_NOW, null, { hidden: { count: 4, closing: [{ program_id: 'twin-a', title: 'Twin Grant', closes_at: plusDays(L18_NOW, 1) }, twin, UGREEN, META_VR] } });
  assert.ok(text.split('\n').includes('Also: 4 more in the full list; Twin Grant closes in 2 days; UGREEN Hackathon 2026 on AI NAS closes in 3 days.'), text);
});

// ---- v6.1.18 Task 8: more sends per session (lane 36) ----

test('L36-5 (v6.1.18): a row with several rules shows them all and its one ask covers all of them', () => {
  const two = gap({ title: 'GitHub Fund', money: '$10,000 per project', gap: ruleGap('an OSI-approved open source license', 'rule:0000000a'), also: [ruleGap('maintainer lives in a region supported by GitHub Sponsors', 'rule:0000000b')] });
  assert.equal(gapLine({ ...two, n: 1 }), '1. GitHub Fund, $10,000 per project. Their rules: an OSI-approved open source license; maintainer lives in a region supported by GitHub Sponsors.');
  assert.equal(gapAction(two), 'Say yes if all of that is you and I draft it.');
  assert.equal(replyText(base({ gaps: [two] }), true).split('\n').at(-1), 'Say 1 if the GitHub Fund rules fit you and I draft it.');
  // One rule keeps its own words.
  const one = gap({ title: 'One Fund', gap: ruleGap('a team of two') });
  assert.equal(gapAction(one), 'Say yes if that is you and I draft it.');
  assert.equal(replyText(base({ gaps: [one] }), true).split('\n').at(-1), 'Say 1 if the One Fund rule fits you and I draft it.');
});

test('L36-11 (v6.1.18): a program another agent of the builder holds is left out of the Before line', () => {
  const r = base({
    ready: [ready({ title: 'FUTO Microgrants', claimed_since: '2026-11-12T00:00:00Z' }), ready({ title: 'FLOSS/fund' })],
    blockers: [{ program_id: 'futo-microgrants', sign_in: null, needs_click: true, needs: [] }, { program_id: 'floss-fund', sign_in: null, needs_click: true, needs: [] }],
  });
  const text = replyText(r, true);
  assert.ok(text.split('\n').includes('Before applying: you press submit yourself on FLOSS/fund.'), text);
  assert.doesNotMatch(text, /press submit yourself on FUTO/);
});

test('L36-13 (v6.1.18): the demo video gap is a link the builder sends; the agent passes it as project.demo_url', () => {
  const video = gap({ title: 'PayPal AI Hackathon', money: '$67,500 in prizes', gap: VIDEO });
  assert.equal(gapLine({ ...video, n: 1 }), '1. PayPal AI Hackathon, $67,500 in prizes: a demo video link (a short screen recording of it working).');
  assert.equal(gapAction(video), 'Send me the demo video link and I fill it in.');
  assert.equal(singleStepClosing(VIDEO), 'Send me the demo video link and I fill it in.');
  const r = base({ gaps: [video] });
  assert.equal(replyText(r, true).split('\n').at(-1), 'Send me the demo video link and I fill it in.');
  assert.ok(agentNote(r, { more: 0 }).split('\n').includes('A demo video gap takes a link: when the builder sends it, pass it as project.demo_url and call find again.'));
});

// v6.1.18 Task 9: lane 38 wording.
test('L38-2 (v6.1.18): the rule Say names the program its yes drafts', () => {
  const thiel = gap({ title: 'Thiel Fellowship', gap: ruleGap('a founder under 23') });
  assert.equal(replyText(base({ gaps: [thiel] }), true).split('\n').at(-1), 'Say 1 if the Thiel Fellowship rule fits you and I draft it.');
});

test('L38-3 (v6.1.18): the users answer and EarnKit\'s change in one yes close ahead of a rule with no stated amount', () => {
  const CODES = { kind: 'builder_codes' as const, item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes' as const, agent_can: true };
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users', effort: 'hours' as const, agent_can: false };
  const grant = gap({ title: 'Base Builder Grant Program', money: 'up to $5,000', max_award_usd: 5000, gap: CODES, also: [USERS] });
  const fund = gap({ title: 'Base Ecosystem Fund', money: 'pre-seed and seed investment', max_award_usd: null, gap: ruleGap('a pre-seed or seed stage startup') });
  const text = replyText(base({ linked: true, gaps: [grant, fund] }), true);
  const lines = text.split('\n');
  assert.equal(lines.at(-1), 'Do real people use it? Say yes and I add Base Builder Codes, then apply to Base Builder Grant Program.');
  // L38 big 3 (v6.1.18 Task 10): two steps: the change first, then the count.
  assert.ok(lines.includes('2. Base Builder Grant Program (up to $5,000) needs you to add Base Builder Codes to the app, then 1 more step.'), text);
  assert.equal(text.match(/\bSay\b/g)?.length, 1, text);
  // Alone, it closes on the same yes, never "Tell me when the app sends Base Builder Codes".
  assert.equal(replyText(base({ linked: true, gaps: [grant] }), true).split('\n').at(-1), 'Do real people use it? Say yes and I add Base Builder Codes, then apply to Base Builder Grant Program.');
  // A rule of a program with a stated amount keeps its yes.
  const stated = { ...fund, money: '$10K', max_award_usd: 10000 };
  assert.equal(replyText(base({ linked: true, gaps: [grant, stated] }), true).split('\n').at(-1), 'Say 1 if the Base Ecosystem Fund rule fits you and I draft it.');
  // The agent hears what the yes covers, only when the closing is that Say (fix round 1, M3).
  const linkedSay = replyParts(base({ linked: true, gaps: [grant, fund] }), true).say;
  assert.match(agentNote(base({ linked: true, gaps: [grant, fund] }), { more: 0, say: linkedSay }), /When the closing offers a change with the users question, a yes is both: make that change, push, call track with gap_done and the gap's item, then call find again with users: true\./);
  assert.doesNotMatch(agentNote(base({ linked: true, gaps: [grant, stated] }), { more: 0, say: replyParts(base({ linked: true, gaps: [grant, stated] }), true).say }), /When the closing offers a change/);
  // Fix round 1 (I1): signed out, no apply is promised: the users question asks for the sign-in, with its link.
  assert.equal(replyText(base({ gaps: [grant, fund] }), true).split('\n').at(-1), 'Do real people use it? Say yes, sign in, and I check.');
  assert.equal(replyText(base({ gaps: [grant, fund], sign_in: 'https://earnkit.com/link/x' }), true).split('\n').at(-1), 'Do real people use it? Say yes, sign in at https://earnkit.com/link/x, and I check.');
});

test('L38-4 (v6.1.18): the users gap reads "real users"; the closing keeps "Do real people use it?"', () => {
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users', effort: 'hours' as const, agent_can: false };
  const text = replyText(base({ linked: true, gaps: [gap({ title: 'FLOSS/fund', money: '$10,000 to $100,000', gap: USERS })] }), true);
  assert.equal(text, 'Nothing is ready to send yet. The closest:\n\n1. FLOSS/fund ($10,000 to $100,000) needs real users first.\n\nDo real people use it? Say yes and I check.');
});

test('L38-6 (v6.1.18): the private and empty notes are left out when a shown gap names them', () => {
  const pub = gap({ title: 'Open Fund', gap: PUBLIC_REPO });
  const priv = replyText(base({ gaps: [pub], repo_notes: ['private'] }), true);
  assert.doesNotMatch(priv, /The repo is private/, priv);
  assert.ok(replyText(base({ gaps: [gap({ title: 'Chain Fund' })], repo_notes: ['private'] }), true).split('\n').includes('The repo is private, so this is from what you told me.'));
  const code = gap({ title: 'Code Fund', gap: NEEDS_CODE });
  const empty = replyText(base({ gaps: [code], repo_notes: ['empty'] }), true);
  assert.doesNotMatch(empty, /The repo is empty/, empty);
  assert.ok(replyText(base({ gaps: [gap({ title: 'Chain Fund' })], repo_notes: ['empty'] }), true).split('\n').includes('The repo is empty, so this is from what you told me.'));
});

test('L38-7, L38-8 (v6.1.18): the read notes end "so this is from what you told me."; the fork says why it matters', () => {
  const note = (n: Parameters<typeof base>[0]) => replyText(base({ gaps: [gap({ title: 'Chain Fund' })], ...n }), true).split('\n');
  assert.ok(note({ repo_notes: ['other_host'] }).includes('I read GitHub repos only, so this is from what you told me.'));
  assert.ok(note({ repo_notes: ['unread'] }).includes('I could not read the repo, so this is from what you told me.'));
  assert.ok(note({ repo_notes: ['slow'] }).includes('GitHub was slow, so this is from what you told me. I read it again next time.'));
  assert.ok(note({ repo_notes: ['paused'] }).includes('Repo reads are paused until tomorrow, so this is from what you told me.'));
  assert.ok(note({ repo_notes: ['fork'] }).includes('This repo is a fork, and programs fund the original.'));
});

test('L38-25 (v6.1.18): the answers waiting again say the builder changed them', () => {
  const lines = (n: number) => replyText(base({ ready: [ready({ title: 'R' })], approvals_again: n }), false).split('\n');
  assert.ok(lines(1).includes('One answer you changed waits for your approval at earnkit.com/me.'));
  assert.ok(lines(2).includes('2 answers you changed wait for your approval at earnkit.com/me.'));
});

test('L38-28 (v6.1.18): an in-person Needs list reads each field\'s to-do, never its need word', () => {
  const yc = ready({ title: 'Y Combinator', money: '$500,000 investment', in_person: true, setup: ['a YC account'], need_you: ['your answers', 'batch preference'], todos: ['your answers', 'the batch you want'], needs: ['a YC account', 'your answers', 'batch preference'] });
  assert.ok(replyParts(base({ ready: [yc] }), true).hidden.includes('1. Y Combinator, $500,000 investment. Needs a YC account, your answers and the batch you want.'));
});

test('L38-30 (v6.1.18): a ready program whose setup step is the builder\'s own closes on that step first', () => {
  const floss = ready({ title: 'FLOSS/fund', money: '$10,000 to $100,000', setup: ['publish the funding manifest'], needs: ['publish the funding manifest'] });
  const text = replyText(base({ ready: [floss] }), true);
  assert.equal(text, '1 program is ready to send now.\n\n1. FLOSS/fund ($10,000 to $100,000). I apply once you say yes.\n\nPublish the funding manifest first, then say yes and I apply.');
  // A thing to have ("your email") is no step.
  const mail = ready({ title: 'Mail Fund', setup: ['your email'], needs: ['your email'] });
  assert.match(replyText(base({ ready: [mail] }), true), /\nSay yes and I apply to Mail Fund\.$/);
});

test('L18-4c: the sent line reads "Did you send Kiroween 2026? Say sent and I note it." and sits before the Say (or is it, last)', async () => {
  const { sentLines, replyParts: parts } = await import('./reply');
  const NOW = new Date('2026-11-12T12:00:00Z');
  const kiro = { program_id: 'kiro', title: 'Kiroween 2026', started_at: '2026-11-12T10:00:00.000Z', project_id: null, project: null };
  assert.deepEqual(sentLines({ ask_sent: [kiro] }), ['Did you send Kiroween 2026? Say sent and I note it.']);
  const one = base({ ready: [ready({ title: 'Alpha Grant', filled: 1, facts_from_repo: 1, repo_required: 1, total: 1 })] });
  // ONE_SAY_ORDER: after the started lines, before the closing; alone, the sent question is the reply's one Say, last.
  const p = parts({ ...one, ask_sent: [kiro] }, false, NOW);
  assert.equal(p.text, '1 program is ready to send now.\n\n1. Alpha Grant ($1K). I apply once you say yes.\n\nDid you send Kiroween 2026? Say sent and I note it.');
  assert.equal(p.offer, null);
  // Beside a started line's Say, the question sits before it, its own Say left out.
  const started = { program_id: 'a', title: 'A Grant', started_at: '2026-11-10T10:00:00.000Z' };
  const t = renderReply({ ...one, ask_sent: [kiro], released: [started] }, false, NOW);
  assert.ok(t.endsWith('\nDid you send Kiroween 2026?\n\nA Grant: started Nov 10, nothing sent. Say yes to apply or say skip.'), t);
  assert.equal(t.match(/\bSay\b/g)?.length, 1, t);
  // L41-11 (v6.1.19): two asks are one line, one Say for both.
  const two = renderReply({ ...one, ask_sent: [kiro, { ...kiro, program_id: 'b', title: 'Beta Jam' }] }, false, NOW);
  assert.ok(two.endsWith('\n1. Alpha Grant ($1K). I apply once you say yes.\n\nDid you send Kiroween 2026 and Beta Jam? Say which you sent and I note them.'), two);
  // The agent note says how to record each answer, also when nothing is listed.
  const note = 'The reply asks whether each was sent: Kiroween 2026. "sent" is track applied with submitted_by builder; "not yet" needs no call.';
  assert.ok(agentNote({ ...one, ask_sent: [kiro] }, { more: 0 }).split('\n').includes(note));
  assert.ok(agentNote(base({ ask_sent: [kiro] }), { more: 0 }).split('\n').includes(note));
  assert.equal(renderReply(base({ ask_sent: [kiro] }), false, NOW).split('\n').at(-1), 'Did you send Kiroween 2026? Say sent and I note it.');
});

test('L41-11 (v6.1.19): every sent question in a reply is one line; a released row that asks has no line of its own', async () => {
  const { sentLines } = await import('./reply');
  const NOW = new Date('2026-11-12T12:00:00Z');
  const ask = (id: string, title: string) => ({ program_id: id, title, started_at: '2026-11-12T10:00:00.000Z', project_id: null, project: null });
  const kiro = { program_id: 'kiro', title: 'Kiroween 2026', started_at: '2026-11-11T09:00:00.000Z', ask: true as const };
  const one = base({ ready: [ready({ title: 'Alpha Grant', filled: 1, facts_from_repo: 1, repo_required: 1, total: 1 })] });
  const t = renderReply({ ...one, ask_sent: [ask('code', 'Codegeist 2026')], released: [kiro] }, false, NOW);
  assert.equal(t.split('\n').at(-1), 'Did you send Codegeist 2026 and Kiroween 2026? Say which you sent and I note them.');
  assert.doesNotMatch(t, /started Nov 11/);
  assert.equal(t.match(/Did you send/g)?.length, 1, t);
  assert.ok(t.split('\n').filter((l) => l.trim() !== '').length <= 10);
  // Three named, then the count.
  const five = ['A', 'B', 'C', 'D', 'E'].map((x) => ask(x, `${x} Jam`));
  assert.deepEqual(sentLines({ ask_sent: five }), ['Did you send A Jam, B Jam, C Jam and 2 more? Say which you sent and I note them.']);
  // A sent question offers nothing to apply.
  assert.equal(replyParts({ ...base({}), ask_sent: five.slice(0, 2) }, false, NOW).offer, null);
});

test('fix round 1 (v6.1.19 Task 3, M2): sentAskOf names exactly the programs the one question names, never by a title inside another', async () => {
  const { sentAskOf } = await import('./reply');
  const ask = (id: string, title: string) => ({ program_id: id, title, started_at: '2026-11-12T10:00:00.000Z', project_id: null, project: null });
  const r = { ask_sent: [ask('a', 'Kiroween 2026'), ask('b', 'Codegeist'), ask('c', 'QNX Jam'), ask('d', 'Kiroween')], released: [], not_sent: undefined };
  const got = sentAskOf(r);
  assert.equal(got.question, 'Did you send Kiroween 2026, Codegeist, QNX Jam and 1 more?');
  // "Kiroween" sits inside "Kiroween 2026" but is counted, not named: it is not marked.
  assert.deepEqual(got.named, ['a', 'b', 'c']);
  assert.deepEqual(sentAskOf({ ask_sent: [], released: [], not_sent: undefined }), { question: null, named: [] });
});

test('L36-2: a builder-sent claim past 24 hours asks instead of saying nothing sent; its agent note is the sent note', () => {
  const NOW = new Date('2026-11-12T12:00:00Z');
  const one = base({ ready: [ready({ title: 'Alpha Grant', filled: 1, facts_from_repo: 1, repo_required: 1, total: 1 })] });
  const futo = { program_id: 'futo', title: 'FUTO Microgrants', started_at: '2026-11-11T09:00:00.000Z', ask: true as const };
  const t = renderReply({ ...one, released: [futo] }, false, NOW);
  // L41-11 (v6.1.19): asked in the one sent question.
  assert.equal(t.split('\n').at(-1), 'Did you send FUTO Microgrants? Say sent and I note it.');
  assert.doesNotMatch(t, /nothing sent/);
  const n = agentNote({ ...one, released: [futo] }, { more: 0 });
  assert.match(n, /The reply asks whether each was sent: FUTO Microgrants\./);
  assert.doesNotMatch(n, /were released/);
});
