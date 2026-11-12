import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_CLOSING, FULL_RULE_SAY, defaultRows, moreInFull, agentNote, replyParts, attendRuleGap, closingLine, gapAction, gapActionStep, gapLine, notFitLine, numbered, replyText as renderReply, firstStepOf, singleStepClosing, stepClause, stepRuleOf } from './reply';
import { NEEDS_CODE, PUBLIC_REPO } from './eligibility';
import type { FindReply, GapProgram, ReadyProgram } from './find';
import type { Ledger } from './ledger';
import { DELETED_NOTICE } from '../v6/reply-words';

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
  return { ...r, ...numbered(r.ready, r.gaps, attendRuleGap) };
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
      'Ready to apply (2):',
      "1. Alliance ALL19, $400K at admission, closes in 14 days. You give: the first founder's email.",
      '2. Arc Builders Fund, investment from Circle Ventures. Long odds: an investment program with no stated amount.',
      'One step away (1):',
      '3. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc.',
      'Your applications: X Grant (sent Nov 3, waiting).',
      'Say yes and I apply to all 2 ready.',
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
      'Ready to apply (1):',
      '1. Alliance ALL19, $400K at admission, closes in 3 days.',
      // L13-17 (v6.1.14): Alliance's close is on its ready line, so the since line does not repeat it. L29-26 (v6.1.16
      // Task 15): Task 9's lines follow the money lines.
      'Since Nov 2: 2 new programs you fit; Circle Developer Grants: deadline moved to Nov 20.',
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
    'Your applications: A (sent Nov 1, rejected), B (sent Nov 1, no result), D (held).');
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
    ['One step away (1):', '1. Base Batches, $100K: add Base Builder Codes to the app.', 'Nothing is ready yet. Say "do 1" and I add the codes.'].join('\n'),
  );
  // "do n" by the gap's kind, only when EarnKit can make every real gap (1a, 3.7).
  const one = (g: GapProgram['gap'], also: GapProgram['also'] = []) => replyText(base({ gaps: [gap({ title: 'G', gap: g, also })] }), false).split('\n')[1];
  const ARC = { kind: 'contract_on' as const, item: 'contract_on:arc', what: 'a contract on Arc', effort: 'hours' as const, agent_can: false };
  const SW = { kind: 'integration' as const, item: 'integration:smart_wallet', what: 'add Smart Wallet', effort: 'days' as const, agent_can: true };
  const DEMO = { kind: 'demo_video' as const, item: 'demo_video', what: 'a demo video', effort: 'hours' as const, agent_can: false };
  // A contract deploy is never EarnKit's change (fix round 1): the line ends after the gap.
  assert.equal(one(ARC), '1. G, $1K: a contract on Arc.');
  assert.ok(!agentNote(base({ gaps: [gap({ title: 'G', gap: ARC })] }), { more: 0 }).includes('On "do <n>"'));
  // L24-8 (v6.1.16 Task 11): the line carries no "do n"; the closing offers it.
  assert.equal(one(SW), '1. G, $1K: add Smart Wallet.');
  assert.equal(replyText(base({ gaps: [gap({ title: 'G', gap: SW })] }), true).split('\n').at(-1), 'Nothing is ready yet. Say "do 1" and I add Smart Wallet.');
  assert.equal(one(ARC, [SW]), '1. G, $1K: a contract on Arc and add Smart Wallet.');
  assert.equal(one(SW, [{ ...SW, item: 'integration:x', what: 'add X' }]), '1. G, $1K: add Smart Wallet and add X.');
  assert.equal(one(ARC, [DEMO]), '1. G, $1K: a contract on Arc and a demo video.');
  // v6.1.14 (was C57): the unlinked proof is a gap after the colon; its sign-in is asked once, in the closing.
  const TIER = { kind: 'tier' as const, item: 'tier:used', what: 'proof that real people use it', effort: 'weeks' as const, agent_can: false };
  assert.equal(one(TIER), '1. G, $1K: proof that real people use it.');
  assert.equal(one(TIER, [DEMO]), '1. G, $1K: proof that real people use it and a demo video.');
  const two = base({ gaps: [gap({ title: 'G', money: '$1K', also: [{ kind: 'live_product', item: 'live_product', what: 'put a live link up', effort: 'hours', agent_can: false }] })] });
  assert.match(replyText(two, false), /^1\. G, \$1K: deploy the contract on Arc and put a live link up\.$/m);
  const many = base({ ready: [ready({ title: 'B', needs: ['your full name', 'your email', 'a Loom product demo', 'your X handle', 'an investor deck file'] })] });
  // L29-18 (v6.1.16 Task 15): "You give:", the words as the form names them, at most three and the count.
  assert.match(replyText(many, false), /You give: your full name, your email, a Loom product demo and 2 more\.$/m);
  const setup = base({ ready: [ready({ title: 'S', setup: ['sign in to the Builder Hub'], needs: ['sign in to the Builder Hub', 'a Loom product demo'] })] });
  // R2c: the one answer is the builder's, so the agent drafts none of it.
  assert.match(replyText(setup, false), /^1\. S, \$1K\. You give: a Loom product demo\. First: sign in to the Builder Hub\.$/m);
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
      'Ready to apply (2):',
      "1. Alliance ALL19, $400K at admission, closes in 14 days. You give: the first founder's email.",
      '2. Arc Builders Fund, investment from Circle Ventures. Long odds: an investment program with no stated amount.',
      'One step away (1):',
      '3. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc.',
      // L1j-3 (v6.1.17): the in-person row left out is counted.
      'And 1 more in the full list.',
      'Say yes and I apply to all 2 ready.',
    ].join('\n'),
  );
  const parts = replyParts(r, false);
  assert.deepEqual(parts.hidden, ['4. ETHGlobal Mumbai, up to $15K per partner prize, closes in 2 days. First: apply to attend by Nov 3 and get accepted; stake a small amount of ETH; be in Mumbai Nov 5 to 7.']);
  assert.match(agentNote(r, { more: 0, hidden: parts.hidden }), /^Not shown to the builder:\n4\. ETHGlobal Mumbai/m);
  assert.equal(replyText(r, false, new Date(), null, { all: true }).split('\n').slice(0, 7).join('\n'),
    // L1i-6 (v6.1.16.1): the full view keeps the close and in person. L35-9 (v6.1.17): under the default's headings.
    ['Ready to apply (2):', '1. Alliance ALL19, $400K at admission, closes in 14 days.', '2. Arc Builders Fund, investment from Circle Ventures.', 'One step away (1):', '3. Circle Developer Grants, $5,000 to $100,000 USDC grants.', 'In person (1):', '4. ETHGlobal Mumbai, up to $15K per partner prize, closes in 2 days, in person.'].join('\n'));
  const only = replyText(base({ ready: [mumbai] }), false);
  assert.ok(only.startsWith('In person (1):\n1. ETHGlobal Mumbai'), only);
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
  assert.equal(replyText(base(), false), 'Nothing fits yet. Ask again any time and I show what is new.');
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
  for (const s of ["'earnkit'", "'agent'", "'builder'", 'sources', 'form_id', 'track', 'won', 'Zeta Grant', '2 more programs are left out. When the builder says more, call find with filter.all.'])
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
  assert.match(replyText(base({ ready: [ready({ title: 'R', filled: 3, facts_from_repo: 0 })] }), false), /^1\. R, \$1K\.$/m);
});

test('#3 (v6.1.15): one Drafted shape (R2c): n of the required m, all but the builder\'s, which are named, never above total', () => {
  const line = (over: Partial<ReadyProgram>) => replyText(base({ ready: [ready({ title: 'Z Fellows', money: '$10K', ...over })] }), false).split('\n')[1];
  assert.equal(line({ repo_required: 2, total: 9, needs: ['your email'] }), '1. Z Fellows, $10K. You give: your email.');
  assert.equal(line({ repo_required: 2, total: 23 }), '1. Z Fellows, $10K.');
  assert.equal(line({ repo_required: 1, total: 2, needs: ['your birthday'] }), '1. Z Fellows, $10K. You give: your birthday.');
  assert.equal(line({ repo_required: 0, total: 23, needs: ['your birthday', 'your phone number'] }), '1. Z Fellows, $10K. You give: your birthday and your phone number.');
  assert.equal(line({ total: 2, needs: ['your birthday'] }), '1. Z Fellows, $10K. You give: your birthday.');
  assert.equal(line({ total: 23 }), '1. Z Fellows, $10K.');
  assert.equal(line({ total: 1, needs: ['your birthday'] }), '1. Z Fellows, $10K. You give: your birthday.');
  assert.equal(line({ repo_required: 4, total: 4 }), '1. Z Fellows, $10K.');
  assert.equal(line({ total: 0 }), '1. Z Fellows, $10K.');
  // Never above total; optional fields read from the repo (facts_from_repo) are not in the count.
  assert.equal(line({ repo_required: 6, facts_from_repo: 9, total: 4 }), '1. Z Fellows, $10K.');
  assert.equal(
    line({ total: 3, setup: ['sign in to the Hub'], needs: ['sign in to the Hub', 'your birthday'] }),
    '1. Z Fellows, $10K. You give: your birthday. First: sign in to the Hub.',
  );
});

test('one required answer reads in the singular', () => {
  const line = (repo_required: number) => replyText(base({ ready: [ready({ title: 'One', money: '$1K', repo_required, total: 1 })] }), false).split('\n')[1];
  assert.equal(line(1), '1. One, $1K.');
  assert.equal(line(0), '1. One, $1K.');
});

const BANNED = /—|\p{Extended_Pictographic}|\b(score|rank|grade|points|coin|token|streak)s?\b/iu;

test('#3 (v6.1.15) linked: the same Drafted shape, the builder\'s own answers named', () => {
  const r = base({
    linked: true,
    // facts_from_repo counts optional fields too (v5's count); the linked line reads the required ones only.
    ready: [ready({ title: 'Z Fellows', money: '$10K', from_record: 3, facts_from_repo: 4, repo_required: 2, total: 6, need_you: ['your Telegram username'], needs: ['your Telegram username'] })],
  });
  assert.equal(replyText(r, false).split('\n')[1], '1. Z Fellows, $10K.');
  const none = base({ linked: true, ready: [ready({ title: 'A', from_record: 2, facts_from_repo: 1, repo_required: 1, total: 3 })] });
  assert.equal(replyText(none, false).split('\n')[1], '1. A, $1K.');
  const four = base({ linked: true, ready: [ready({ title: 'B', from_record: 1, total: 6, need_you: ['your phone', 'your birthday', 'where you are based', 'your Telegram username'] })] });
  assert.equal(replyText(four, false).split('\n')[1], '1. B, $1K.');
  // F2 (v6.1.10): the name and tagline the agent passed are its drafts, never the builder's.
  const told = base({ linked: true, ready: [ready({ title: 'N', from_record: 1, total: 4, need_you: ['the problem'], needs: ['the problem'] })] });
  assert.equal(replyText(told, false).split('\n')[1], '1. N, $1K.');
  const zero = base({ linked: true, ready: [ready({ title: 'C', total: 4 })] });
  assert.equal(replyText(zero, false).split('\n')[1], '1. C, $1K.');
  // Unlinked: the builder's answers are the non-setup needs, whatever need_you holds.
  const unlinked = base({ ready: [ready({ title: 'Z Fellows', money: '$10K', from_record: 3, facts_from_repo: 2, repo_required: 2, total: 6, need_you: ['x'] })] });
  assert.equal(replyText(unlinked, false).split('\n')[1], '1. Z Fellows, $10K.');
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
    "Before applying: you sign in to Google in your agent's browser for Base Builder Grant and Google Two; you sign in to Avalanche Builder Hub for Avalanche Team1; you sign in by email and press submit yourself on Click Grant; your founder video link, an approved answer on the problem, your deck link and 1 more.",
  );
  const lines = text.split('\n');
  assert.ok(lines.length <= 10, text);
  // L1j-3 (v6.1.17): the row left out is counted before the Say.
  assert.deepEqual(lines.slice(-4), [
    before,
    'Your project is live, with no verified usage yet. Next: about 25 outside users in 90 days; I count 4.',
    'And 1 more in the full list.',
    'Say yes and I apply to 3 and draft Click Grant for you to send.',
  ]);
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

// L29-33 (v6.1.16 Task 15): the sign-in is its own line, before the Say; the Say is last.
test('unlinked with a sign-in link: saying yes is the one action, the sign-in just before it (R5a); linked never shows it', () => {
  const link = 'https://earnkit.test/link/abcdefghijklmnop';
  const text = replyText({ ...MONDAY, sign_in: link }, false, MON);
  const lines = text.split('\n');
  assert.equal(lines.at(-1), 'Say yes and I apply to all 2 ready.');
  assert.equal(lines.at(-2), `Sign in once at ${link} and I read your repo for proof and remember you.`);
  assert.equal(lines.at(-3), 'Your applications: X Grant (sent Nov 3, waiting).');
  assert.equal(text.match(/Sign in once at/g)!.length, 1);
  assert.match(replyText(MONDAY, false), /\nSay yes and I apply to all 2 ready\.$/);
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
  'A "Their rule" gap is a program rule EarnKit cannot check. If the builder says it fits, call track gap_done with that gap\'s item, then find again. Draft it and show the builder; submit only on a yes to the draft.';
const ruleGap = (what: string, item = 'rule:0000000a') => ({ kind: 'rule' as const, item, what, effort: 'hours' as const, agent_can: false });
const VIDEO = { kind: 'demo_video' as const, item: 'demo_video', what: 'a demo video', effort: 'hours' as const, agent_can: false };

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
      "Ready to apply (1):",
      "1. Base Ecosystem Fund, pre-seed and seed investment. Long odds: an investment program with no stated amount. First: sign in to the portal.",
      "One step away (2):",
      // L1i-2 (v6.1.16.1): every step row the budget allows.
      "2. Goose Grants, $10K. Their rules: a project built with or for goose; work not already funded by an employer or client.",
      "3. Colosseum, $25K: a demo video. Their rule: the team has not raised venture capital.",
      // L1j-3 (v6.1.17): the in-person row left out is counted.
      "And 1 more in the full list.",
      "Say yes and I apply to Base Ecosystem Fund.",
    ].join('\n'),
  );
  // L1e-2 (v6.1.13): one yes per reply: something ready takes the closing, so the rule line asks no "yes n".
  assert.equal(replyText(r, true).match(/"yes 2"/g), null);
  assert.equal(replyText(r, true).match(/\bSay\b/g)?.length, 1);
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
  assert.equal(nothingReady.split('\n').at(-1), 'Nothing is ready yet. Say "yes 1" if that rule fits you and I get it ready.');
  // Said once: the line the closing names does not ask it again.
  assert.equal(nothingReady.match(/"yes 1"/g)?.length, 1, nothingReady);
  assert.equal(end(base({ ready: MONDAY.ready, gaps: [rulesOnly] })), 'Say yes and I apply to all 2 ready.');
  // L1e-2 (v6.1.13): with something ready, the rule reads as a plain sentence; "yes 3" still works in track.
  assert.match(replyText(base({ ready: MONDAY.ready, gaps: [rulesOnly] }), true), /^3\. R, \$1K\. Their rule: x\.$/m);
  assert.equal(end(base({ gaps: [rulesOnly, MONDAY.gaps[0]] })), 'Nothing is ready yet. Say "yes 1" if that rule fits you and I get it ready.');
  // M1 (v6.1.9): with no rule-only program shown, the closing offers the first step.
  assert.equal(end(base({ gaps: [MONDAY.gaps[0]] })), 'Nothing is ready yet. Tell me when the contract is on Arc and I look again.');
  // C44: the builder presses submit on every ready one, so the agent drafts.
  const clicks = MONDAY.ready.map((p) => ({ program_id: p.program_id, sign_in: null, needs_click: true, needs: [] }));
  assert.equal(end({ ...MONDAY, blockers: clicks }), 'Say yes and I draft all 2 for you to send.');
  assert.equal(end(base({ ready: [MONDAY.ready[0]], blockers: [clicks[0]] })), 'Say yes and I draft it for you to send.');
  assert.equal(end({ ...MONDAY, blockers: [clicks[0]] }), 'Say yes and I apply to Arc Builders Fund and draft Alliance ALL19 for you to send.');
  assert.doesNotMatch(agentNote(base({ gaps: [rulesOnly] }), { more: 0 }), /On "do <n>"/);
  assert.ok(agentNote(base({ gaps: [rulesOnly] }), { more: 0 }).includes(RULE_NOTE));
});

test('R18d, O2 (v6.1.10, Review Focus 5): an in-person gap line says what attending takes, after its rules; a rule-only one is in the In person block (T3-R5: with no yes of its own)', () => {
  const attend = { in_person: true, setup: ['work 3 months from the office'] };
  const r = base({
    gaps: [
      gap({ title: 'Residency', money: '$500K', gap: ruleGap('a co-founder with US work authorization'), rules: ['a co-founder with US work authorization'], ...attend }),
      gap({ title: 'Camp', money: '$10K', gap: VIDEO, also: [ruleGap('a team of two')], rules: ['a team of two'], ...attend }),
    ],
  });
  assert.equal(
    replyText(r, true),
    [
      "One step away (1):",
      "1. Camp, $10K: a demo video. Their rule: a team of two. First: work 3 months from the office.",
      "In person (1):",
      "2. Residency, $500K. Their rule: a co-founder with US work authorization. First: work 3 months from the office.",
      "Nothing remote is ready yet. Say yes and I start the in-person applications.",
    ].join('\n'),
  );
});

test('O2 (v6.1.10, Review Focus 5): a reply that lists in-person programs never ends on "Nothing is ready yet"; rule-only ones follow the ready ones in the block', () => {
  const yc = ready({ title: 'Y Combinator', money: '$500K investment', in_person: true, setup: ['a YC account'], needs: ['a YC account'] });
  const antler = gap({ title: 'Antler', money: '$250K', in_person: true, gap: ruleGap('a co-founder with US work authorization'), rules: ['a co-founder with US work authorization'] });
  const floss = gap({ title: 'FLOSS/fund', money: '$10,000 to $100,000', gap: { kind: 'users', item: 'users', what: 'tell me if real people use it', effort: 'hours', agent_can: false } });
  const otf = gap({ title: 'OTF', money: '$900K', gap: ruleGap('advances internet freedom') });
  const r = base({ ready: [yc], gaps: [floss, otf, antler] });
  assert.equal(
    replyText(r, true),
    [
      "One step away (2):",
      // L1i-2 (v6.1.16.1): every step row the budget allows, numbered as shown.
      "1. FLOSS/fund, $10,000 to $100,000: tell me if real people use it.",
      "2. OTF, $900K. Their rule: advances internet freedom.",
      "In person (2):",
      "3. Y Combinator, $500K investment. Needs a YC account.",
      "4. Antler, $250K. Their rule: a co-founder with US work authorization. Attend in person.",
      "Nothing is ready yet. Say \"yes 2\" if that rule fits you and I get it ready.",
    ].join('\n'),
  );
  // In person alone, or rule-only in person alone: the in-person closing.
  assert.equal(replyText(base({ ready: [yc] }), true).split('\n').at(-1), 'Nothing remote is ready yet. Say yes and I start the in-person applications.');
  assert.equal(replyText(base({ gaps: [antler] }), true).split('\n').at(-1), 'Nothing remote is ready yet. Say yes and I start the in-person applications.');
  // T3-R5 (v6.1.13): the closing is the only Say, beside a rule-only in-person line and a remote rule alike.
  for (const gaps of [[antler], [gap({ title: 'Open', gap: ruleGap('an open licence'), rules: ['an open licence'] }), antler]]) {
    const t = replyText(base({ gaps }), true);
    assert.equal(t.match(/\bSay\b/g)?.length, 1, t);
  }
  // A remote step shown: its step closes the reply, in-person programs listed or not.
  // L29-34 (v6.1.16 Task 15): unlinked, the one ask holds the sign-in; linked, the yes applies.
  assert.equal(replyText(base({ gaps: [floss] }), true).split('\n').at(-1), 'Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.');
  assert.equal(replyText(base({ ready: [yc], gaps: [floss] }), true).split('\n').at(-1), 'Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.');
  assert.equal(replyText(base({ linked: true, gaps: [floss] }), true).split('\n').at(-1), 'Nothing is ready yet. Do real people use it? Say yes and I apply.');
  assert.equal(replyText(base({ ready: [yc], gaps: [gap({ title: 'Circle' })] }), true).split('\n').at(-1), 'Nothing is ready yet. Tell me when the contract is on Arc and I look again.');
  // A remote step that names its own action ("do n") and in-person programs: never the bare line.
  const codes = gap({ title: 'Base Batches', gap: { kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes', agent_can: true } });
  assert.equal(replyText(base({ gaps: [codes] }), true).split('\n').at(-1), 'Nothing is ready yet. Say "do 1" and I add the codes.');
  assert.equal(replyText(base({ ready: [yc], gaps: [codes] }), true).split('\n').at(-1), 'Nothing remote is ready yet. Say yes and I start the in-person applications.');
  // Something remote ready: its yes, never the in-person closing.
  assert.equal(replyText(base({ ready: [ready({ title: 'Grant' }), yc], gaps: [antler] }), true).split('\n').at(-1), 'Say yes and I apply to Grant.');
  assert.match(agentNote(r, { more: 0 }), /closes on starting the in-person applications/);
});

test('O1 (v6.1.10): a step closing within 7 days says so after its money', () => {
  const paypal = gap({ title: 'PayPal AI Hackathon', money: '$67,500 in prizes', closes_in: 'in 2 days', gap: VIDEO, also: [ruleGap('uses a PayPal API')] });
  assert.equal(replyText(base({ gaps: [paypal] }), true).split('\n')[1], '1. PayPal AI Hackathon, $67,500 in prizes, closes in 2 days: a demo video. Their rule: uses a PayPal API.');
  const rule = gap({ title: 'Kiroween', money: '$100K', closes_in: 'in 5 days', gap: ruleGap('built with Kiro') });
  assert.equal(replyText(base({ gaps: [paypal, rule] }), true).split('\n').at(-1), 'Nothing is ready yet. Say "yes 2" if that rule fits you and I get it ready.');
  assert.equal(replyText(base({ gaps: [paypal, rule] }), true).split('\n')[2], '2. Kiroween, $100K, closes in 5 days. Their rule: built with Kiro.');
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
  const text = replyText(base({ ready: [yc, alliance, bare] }), true);
  assert.equal(
    text.split('\n').slice(0, 4).join('\n'),
    [
      'In person (3):',
      '1. Y Combinator Winter 2027 Batch, $500K investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and batch preference.',
      "2. Alliance ALL19, $400K at admission, closes in 14 days. First: start the application with the first founder's email; your passport.",
      '3. Bare Summit, $5K. Attend in person.',
    ].join('\n'),
  );
});

test('R21: an in-person gap with no setup reads "Attend in person." after its rules (v6.1.6)', () => {
  const g = gap({ title: 'Residency', money: '$1M', in_person: true, gap: ruleGap('a US co-founder'), rules: ['a US co-founder'] });
  assert.equal(
    replyText(base({ gaps: [g] }), true).split('\n')[1],
    '1. Residency, $1M. Their rule: a US co-founder. Attend in person.',
  );
  const withSetup = { ...g, setup: ['the right to work in the US'] };
  assert.equal(
    replyText(base({ gaps: [withSetup] }), true).split('\n')[1],
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

test('R19: with no repo read the sign-in sentence only promises to remember (v6.1.6)', () => {
  const link = 'https://earnkit.test/link/abcdefghijklmnop';
  const text = replyText({ ...MONDAY, sign_in: link, as_reported: true }, false);
  assert.ok(text.includes(`\nSign in once at ${link} and I remember you across agents.\n`), text);
  assert.doesNotMatch(text, /read your repo/);
});

test('R26, L29-26: the left-out count and the lines the default view left out go to the agent', () => {
  assert.ok(agentNote(MONDAY, { more: 4 }).split('\n').includes('4 more programs are left out. When the builder says more, call find with filter.all.'));
  const n = agentNote(MONDAY, { more: 0, hidden: ['5. Hidden Grant, $1K.'] }).split('\n');
  assert.ok(n.includes('Not shown to the builder:') && n.includes('5. Hidden Grant, $1K.'));
  assert.ok(n.includes('When the builder says more, call find with filter.all.'));
});

// L29-33 (v6.1.16 Task 15): the notice comes before the Say; L1j-6 (v6.1.17): before a closing with no Say too.
test('a linked notice is its own line: before the Say, or before a closing that asks nothing', () => {
  const notice = 'This agent is now linked to GitHub account ada. Unlink any time at earnkit.com/me.';
  assert.equal(replyText(base({ linked: true, linked_notice: notice }), false), `${notice}\nNothing fits yet. Ask again any time and I show what is new.`);
  assert.equal(replyText(base({ linked: true, linked_notice: notice, ready: [ready({ title: 'A' })] }), false).split('\n').slice(-2).join('\n'), `${notice}\nSay yes and I apply to A.`);
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
  assert.equal(text, ['Ready to apply (2):', '1. Free One, $1K.', '2. Free Two, $1K.', 'And 2 more in the full list.', 'Say yes and I apply to all 2 ready.'].join('\n'));
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
  assert.ok(hidden.includes('3. Held One, $1K.'), hidden.join('|'));
  assert.ok(hidden.some((l) => /^4\. Held Away, \$1K\..* Being handled by your other agent\.$/.test(l)), hidden.join('|'));
  assert.doesNotMatch(JSON.stringify(hidden), /Rent Split/);
  assert.equal(lines.at(-1), 'Say yes and I apply to all 2 ready.');
});

test('C1 fix round 1 (I2): one held in-person program and nothing else ready never ends in the in-person closing', async () => {
  const { IN_PERSON_CLOSING } = await import('./reply');
  const NOW = new Date('2026-11-04T12:00:00Z');
  const r = base({ linked: true, ready: [ready({ title: 'Held Away', in_person: true, claimed_since: '2026-11-04T10:00:00.000Z' })] });
  const text = replyText(r, false, NOW);
  assert.match(text, /In person \(1\):\n1\. Held Away, .* Being handled by your other agent\./);
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
  assert.match(t, /^Being handled by your other agent \(1\):\n1\. Held One/m, t);
  assert.doesNotMatch(t, /Ready to apply/, t);
  assert.match(t, /^One step away \(1\):/m, t);
  assert.doesNotMatch(t, /Nothing is ready yet/, t);
  assert.match(t, /\nYour other agent is handling these\.$/, t);
  // T3-R5 (v6.1.13): no rule line asks its own yes, whatever the closing; "yes 2" still works in track.
  // (the line pinned above)
  assert.match(t, /^2\. Rule Grant, \$1K\. Their rule: a public good\.$/m, t);
});

test('the one-program reply (v6.1.8, 1b): the gap line without its number or "do n", and one action by what the gap is', () => {
  const BC = { kind: 'builder_codes' as const, item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'hours' as const, agent_can: true };
  const USERS = { kind: 'users' as const, item: 'users', what: 'tell me if real people use it', effort: 'hours' as const, agent_can: false };
  const codes = gap({ title: 'Base Grant', n: 3, gap: BC });
  assert.equal(gapLine(codes, true), 'Base Grant, $1K: add Base Builder Codes to the app.');
  assert.equal(gapLine(codes), '3. Base Grant, $1K: add Base Builder Codes to the app.');
  assert.equal(gapAction(codes), 'Say "do" and I add Base Builder Codes to the app first.');
  assert.equal(gapAction(gap({ title: 'Two', gap: BC, also: [{ ...BC, kind: 'integration', item: 'integration:x', what: 'add X' }] })), 'Say "do" and I make both changes first.');
  // A contract deploy is the builder's (keys and gas).
  assert.equal(gapAction(gap({ title: 'Arc Grant' })), 'Tell me when the contract is on Arc and I look again.');
  assert.equal(gapAction(gap({ title: 'Video', gap: VIDEO, also: [ruleGap('a team')] })), 'Tell me when the demo video is ready and I look again.');
  assert.equal(gapAction(gap({ title: 'Used', gap: USERS })), 'Say yes if they do and I draft it.');
  const rule = gap({ title: 'Fund', n: 2, gap: ruleGap('a seed stage startup') });
  assert.equal(gapLine(rule, true), 'Fund, $1K. Their rule: a seed stage startup.');
  assert.equal(gapAction(rule), 'Say yes if that is you and I draft it.');
  // In person: the line says to attend; no action line.
  const attend = gap({ title: 'Residency', in_person: true, gap: ruleGap('a US co-founder') });
  assert.equal(gapLine(attend, true), 'Residency, $1K. Their rule: a US co-founder. Attend in person.');
  assert.equal(gapAction(attend), null);
  assert.equal(notFitLine('Base Grant', '$1K', 'needs a contract on Base'), 'Base Grant, $1K. Not a fit: needs a contract on Base.');
});

test('M1 (v6.1.9): nothing ready and no rule-only program shown: the closing offers the first step, the users question as a yes', () => {
  const end = (r: R) => replyText(r, true).split('\n').at(-1);
  const USERS = { kind: 'users' as const, item: 'users', what: 'tell me if real people use it', effort: 'hours' as const, agent_can: false };
  const floss = gap({ title: 'FLOSS/fund', gap: USERS });
  assert.equal(end(base({ gaps: [floss] })), 'Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.');
  // A demo video (with a rule beside it) listed first: the cheaper users question still closes (fix round 1, v6.1.12).
  const vr = gap({ title: 'Meta VR', gap: VIDEO, also: [ruleGap('hands first')], rules: ['hands first'] });
  assert.equal(end(base({ gaps: [vr, floss] })), 'Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.');
  // I2 (v6.1.9 final): the only step program shown carries a rule: the rule is asked first, once.
  const vrAlone = replyText(base({ gaps: [vr] }), true);
  assert.equal(vrAlone.split('\n').at(-1), 'Nothing is ready yet. Say "yes 1" if that rule fits you and I get it ready.');
  assert.equal(vrAlone.match(/"yes 1"/g)?.length, 1, vrAlone);
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
  assert.equal(end(base({ gaps: [codes, signIn, floss] })), 'Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.');
  assert.equal(end(base({ gaps: [codes, signIn] })), 'Nothing is ready yet. Say "do 1" and I add the codes.');
  // A rule-only program shown keeps its "yes n"; something ready keeps the yes to apply.
  const rule = gap({ title: 'R', gap: ruleGap('x'), rules: ['x'] });
  assert.equal(end(base({ gaps: [floss, rule] })), 'Nothing is ready yet. Say "yes 2" if that rule fits you and I get it ready.');
  assert.equal(end(base({ ready: [MONDAY.ready[0]], gaps: [floss] })), 'Say yes and I apply to Alliance ALL19.');
  for (const t of [end(base({ gaps: [floss] })), end(base({ gaps: [vr] }))]) assert.doesNotMatch(t!, /—|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
});

test('L1e-5 and L1e-2 (v6.1.13, Review Focus 7): the closing asks a keyword-hit rule first; a ready program leaves exactly one "Say"', () => {
  const a = gap({ program_id: 'a', title: 'Open Rule', money: '$9K', gap: ruleGap('an open licence'), rules: ['an open licence'] });
  const hit = gap({ program_id: 'b', title: 'Student Rule', money: '$5K', gap: ruleGap('a student', 'rule:0000000c'), rules: ['a student'], keyword_hit: true });
  const all = replyText(base({ gaps: [a, hit] }), true);
  assert.equal(all.split('\n').at(-1), 'Nothing is ready yet. Say "yes 2" if that rule fits you and I get it ready.');
  // T3-R5: the closing is the only Say; the other rule line reads its rule alone.
  // L1i-2 (v6.1.16.1): both rows fit, numbered as shown; only the closing asks.
  assert.match(all, /^1\. Open Rule, \$9K\. Their rule: an open licence\.$/m);
  assert.equal(all.match(/\bSay\b/g)?.length, 1, all);
  // No hit: the first in list order, as before.
  assert.equal(replyText(base({ gaps: [a, { ...hit, keyword_hit: undefined }] }), true).split('\n').at(-1), 'Nothing is ready yet. Say "yes 1" if that rule fits you and I get it ready.');
  // A ready FLOSS/fund with Thiel on line 2: one Say in the whole reply.
  const floss = ready({ program_id: 'floss-fund-zerodha', title: 'FLOSS/fund', money: '$10,000 to $100,000' });
  const thiel = gap({ program_id: 'thiel-fellowship', title: 'Thiel Fellowship', money: '$250,000 over two years', gap: ruleGap('applicant aged 22 or younger'), rules: ['applicant aged 22 or younger'], keyword_hit: true });
  const text = replyText(base({ ready: [floss], gaps: [thiel] }), true);
  assert.equal(text.match(/\bSay\b/g)?.length, 1, text);
  assert.match(text, /^2\. Thiel Fellowship, \$250,000 over two years\. Their rule: applicant aged 22 or younger\.$/m);
  assert.equal(text.split('\n').at(-1), 'Say yes and I apply to FLOSS/fund.');
});

/** L24-2 (v6.1.16 Task 11): "Your yes stands" pins read after an apply offer. */
const afterApply = (r: R, first: boolean) => replyText(r, first, new Date(), 'apply');

test('L24-2 (v6.1.16 Task 11): after a question (look again, a rule, a draft) a rule yes never stands: the apply offer is made afresh', () => {
  const one = base({ ready: [ready({ title: 'Users Grant', rule_yes: true })], gaps: [gap({ title: 'Other', gap: VIDEO })] });
  for (const last of [null, 'look_again', 'rule', 'draft', 'do', 'stop'] as const) {
    const t = replyText(one, true, new Date(), last);
    assert.doesNotMatch(t, /Your yes stands/, String(last));
    assert.equal(t.split('\n\n').at(-1), "Ready to apply (1):\n1. Users Grant, $1K.\nOne step away (1):\n2. Other, $1K: a demo video.\nSay yes and I apply to Users Grant.", String(last));
  }
  assert.equal(replyText(one, true, new Date(), 'apply').split('\n\n').at(-1), "Ready to apply (1):\n1. Users Grant, $1K.\nOne step away (1):\n2. Other, $1K: a demo video.\nYour yes stands for Users Grant: I apply now.");
  // The offer kind of each closing.
  assert.equal(replyParts(one, true, new Date(), null).offer, 'apply');
  assert.equal(replyParts(base({ gaps: [gap({ title: 'R', gap: ruleGap('x'), rules: ['x'] })] }), true).offer, 'rule');
  const users = gap({ title: 'U', gap: { kind: 'users', item: 'users', what: 'tell me if real people use it', effort: 'hours', agent_can: false }, setup: ['sign in'] });
  assert.equal(replyParts(base({ gaps: [users] }), true).text.split('\n').at(-1), 'Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.');
  assert.equal(replyParts(base({ gaps: [users] }), true).offer, 'look_again');
  // No agent note says to submit without asking again.
  assert.doesNotMatch(RULE_NOTE, /without asking/);
  assert.match(RULE_NOTE, /Draft it and show the builder; submit only on a yes to the draft\.$/);
});

test('v6.1.9: after the builder\'s yes on a rule, the program it made ready is applied to without a second yes', () => {
  const one = base({ ready: [ready({ title: 'Solana Foundation Grants', rule_yes: true, rules: ['a public good'] })] });
  assert.equal(afterApply(one, true).split('\n\n').at(-1), "Ready to apply (1):\n1. Solana Foundation Grants, $1K.\nYour yes stands for Solana Foundation Grants: I apply now.");
  const two = base({ ready: [ready({ title: 'Solana Foundation Grants', rule_yes: true }), ready({ title: 'Other Grant' })] });
  assert.equal(afterApply(two, true).split('\n\n').at(-1), "Ready to apply (2):\n1. Solana Foundation Grants, $1K.\n2. Other Grant, $1K.\nYour yes stands for Solana Foundation Grants: I apply now. Say yes and I apply to Other Grant.");
  // The builder presses submit on it: no "I apply now"; L1e-3 (v6.1.13): the yes stands, in the draft wording.
  const click = base({ ready: [ready({ title: 'Click Grant', rule_yes: true })], blockers: [{ program_id: 'click-grant', sign_in: null, needs_click: true, needs: [] }] });
  assert.equal(afterApply(click, true).split('\n\n').at(-1), "Ready to apply (1):\n1. Click Grant, $1K.\nBefore applying: you press submit yourself on Click Grant.\nYour yes stands for Click Grant: I draft it for you to send.");
  // Review Focus 8 (L1e-3): with answers missing, the closing names them and never asks for yes again.
  const thiel = base({
    ready: [ready({ program_id: 'thiel-fellowship', title: 'Thiel Fellowship', rule_yes: true, need_you: ['the online application answers'], needs: ['the online application answers'] })],
    blockers: [{ program_id: 'thiel-fellowship', sign_in: null, needs_click: true, needs: [] }],
  });
  const end = afterApply(thiel, true).split('\n\n').at(-1);
  assert.equal(end, "Ready to apply (1):\n1. Thiel Fellowship, $1K.\nBefore applying: you press submit yourself on Thiel Fellowship.\nThiel Fellowship needs your online application answers; then I draft it for you to send.");
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
  const line = replyText(r, true).split('\n').find((l) => l.includes('Alliance'))!;
  assert.equal(line, "1. Alliance ALL19, $1K. First: open the application with the first founder's email.");
});

test('S6 fix round 1 (v6.1.9): tonight names only sends with every required answer; the others wait, named', () => {
  const r = base({
    auto_apply: true, max_per_night: 5, auto_sent_today: 0, linked: true,
    ready: [ready({ title: 'Full Grant' }), ready({ title: 'Short Grant', needs: ['the problem'] })],
  });
  // L29-18 (v6.1.16 Task 15): one label, "Before applying:".
  assert.equal(replyText(r, true), "Ready to apply (2):\n1. Full Grant, $1K.\n2. Short Grant, $1K.\nBefore applying: your problem for Short Grant.\nApplying now to Full Grant under your standing approval. Say stop and I hold any of them.");
  // Nothing can go tonight: no tonight line, the wait is named, and the builder can still say yes.
  const none = base({ auto_apply: true, max_per_night: 5, auto_sent_today: 0, linked: true, ready: [ready({ title: 'Short Grant', needs: ['the problem'] })] });
  const show = replyText(none, true);
  assert.doesNotMatch(show, /Under your standing approval|The sends? goes? ahead/);
  assert.match(show, /Before applying: your problem for Short Grant\.\nSay yes and I apply to Short Grant\.$/);
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
  assert.equal(show.split('\n').at(-1), 'Nothing is ready yet. Tell me when you started and I check it.');
  assert.match(agentNote(base({ gaps: [g] }), { more: 0 }), /"Tell me when you started this" is a question, not work: ask the builder once; pass first_commit_at/);
  assert.doesNotMatch(show, /—|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
});

test('L1d-2 (v6.1.11, Review Focus 2): a gap line names its setup steps as "First:" after its gaps and before its rules', () => {
  const setup = ['sign up for a Colosseum account', 'start the four-week sprint in the Eternal dashboard'];
  const vc = 'the team has not raised venture capital for the startup it submits';
  const g = gap({ title: 'Colosseum Eternal', money: '$25,000 award', gap: VIDEO, also: [ruleGap(vc)], rules: [vc], setup });
  const line = 'Colosseum Eternal, $25,000 award: a demo video. First: sign up for a Colosseum account; start the four-week sprint in the Eternal dashboard. Their rule: the team has not raised venture capital for the startup it submits.';
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
  assert.equal(gapLine({ ...gap({ title: 'C', money: '$1K', gap: VIDEO }), n: 1 }), '1. C, $1K: a demo video.');
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
  assert.equal(end(base({ ready: [sol] })), "Ready to apply (1):\n1. Solana Foundation Grants, $1K.\nSolana Foundation Grants needs your website link and requested amount; then I apply.");
  // Three needs read "a, b and c".
  const three = ready({ title: 'FLOSS/fund', rule_yes: true, need_you: ['your funding manifest link', 'the problem', 'a demo video'], needs: ['your funding manifest link', 'the problem', 'a demo video'] });
  assert.equal(end(base({ ready: [three] })), "Ready to apply (1):\n1. FLOSS/fund, $1K.\nFLOSS/fund needs your funding manifest link, problem and demo video; then I apply.");
  // Beside another ready program: that one is asked for its yes, this one is not counted again.
  assert.equal(end(base({ ready: [sol, ready({ title: 'Other Grant' })] })), "Ready to apply (2):\n1. Solana Foundation Grants, $1K.\n2. Other Grant, $1K.\nSolana Foundation Grants needs your website link and requested amount; then I apply. Say yes and I apply to Other Grant.");
  assert.equal(
    end(base({ ready: [sol, ready({ title: 'Other Grant' }), ready({ title: 'Third Grant' })] })),
    "Ready to apply (3):\n1. Solana Foundation Grants, $1K.\n2. Other Grant, $1K.\n3. Third Grant, $1K.\nSolana Foundation Grants needs your website link and requested amount; then I apply. Say yes and I apply to all 2.",
  );
  // Beside one fully ready with its yes: both said, no yes asked.
  assert.equal(
    end(base({ ready: [ready({ title: 'Users Grant', rule_yes: true }), sol] })),
    "Ready to apply (2):\n1. Users Grant, $1K.\n2. Solana Foundation Grants, $1K.\nYour yes stands for Users Grant: I apply now. Solana Foundation Grants needs your website link and requested amount; then I apply.",
  );
  // Alone, no yes is asked at all.
  assert.doesNotMatch(afterApply(base({ ready: [sol] }), true), /Say yes|—|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
  // No yes given: the plain closing, as before.
  assert.equal(end(base({ ready: [{ ...sol, rule_yes: undefined }] })), "Ready to apply (1):\n1. Solana Foundation Grants, $1K.\nSay yes and tell me your website link and the requested amount, and I apply to Solana Foundation Grants.");
});

test('F5 (v6.1.12), fix round 1 M1: the missing email is named once per reply: the Say names it, the Before line and the ready line drop it', () => {
  const p = ready({ title: 'Prose Grant', total: 4, from_record: 1, repo_required: 0, need_you: ['the problem', 'your email'], needs: ['the problem', 'your email'] });
  const show = replyText(base({ linked: true, record_missing: ['your email'], ready: [p] }), true);
  assert.equal(show.match(/email/g)!.length, 1, show);
  // L29-17 (v6.1.16 Task 15): the Say names what the yes needs; the line leaves it.
  assert.match(show, /^1\. Prose Grant, \$1K\.$/m);
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
  assert.match(one, /^1\. Mail Grant, \$1K\.$/m);
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
  assert.ok(show.split('\n').includes('The repo is empty and does not send Builder Codes yet, so I matched on what you told me.'), show);
  assert.doesNotMatch(show, /The repo does not send Builder Codes yet\./);
  // Each alone: its own sentence, as before.
  assert.ok(replyText(base({ repo_notes: ['empty'] }), true).split('\n').includes('The repo is empty, so I matched on what you told me.'));
  assert.ok(replyText(base({ repo_notes: ['no_builder_codes'] }), true).split('\n').includes('The repo does not send Builder Codes yet.'));
});

test('fix round 1 (v6.1.12): the nothing-ready closing picks the cheapest step shown, a question before a change, whatever the line order', () => {
  const USERS = { kind: 'users' as const, item: 'users', what: 'tell me if real people use it', effort: 'hours' as const, agent_can: false };
  const STARTED = { kind: 'new_work_after' as const, item: 'new_work_after:2026-10-22', what: 'tell me when you started this', effort: 'minutes' as const, agent_can: false };
  const vr = gap({ title: 'Meta VR', gap: VIDEO, also: [ruleGap('a hands-first experience')] });
  const floss = gap({ title: 'FLOSS/fund', gap: USERS });
  const end = (gaps: GapProgram[]) => replyText(base({ gaps }), true).split('\n').at(-1);
  assert.equal(end([vr, floss]), 'Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.');
  assert.equal(end([vr, gap({ title: 'UGREEN', gap: STARTED })]), 'Nothing is ready yet. Tell me when you started and I check it.');
  // Changes only: the first one, as before.
  assert.equal(end([vr, gap({ title: 'Arc Fund' })]), 'Nothing is ready yet. Tell me when the demo video is ready and I look again.');
});

test('fix round 1 (v6.1.12): the N3 closing lists at most three needs, then "and n more"', () => {
  const needs = ['your website link', 'the requested amount', 'the problem', 'your team', 'a demo video'];
  const r = base({ ready: [ready({ title: 'Solana Foundation Grants', rule_yes: true, need_you: needs, needs })] });
  assert.equal(afterApply(r, true).split('\n\n').at(-1), "Ready to apply (1):\n1. Solana Foundation Grants, $1K.\nSolana Foundation Grants needs your website link, requested amount, problem and 2 more; then I apply.");
});

test('final fix (v6.1.12, I1): the users-question closing promises a send only when the yes makes the program ready', () => {
  const USERS = { kind: 'users' as const, item: 'users', what: 'tell me if real people use it', effort: 'hours' as const, agent_can: false };
  const end = (gaps: GapProgram[]) => replyText(base({ gaps }), true).split('\n').at(-1);
  // The users question is the whole step: the yes applies.
  assert.equal(end([gap({ title: 'Used Grant', gap: USERS })]), 'Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.');
  assert.deepEqual(firstStepOf([gap({ title: 'Used Grant', gap: USERS })]), { users: true, program_id: 'used-grant' });
  // A setup step left after the yes: I look again.
  const floss = gap({ title: 'FLOSS/fund', gap: USERS, setup: ['publish a funding manifest on your site or repo'] });
  assert.equal(end([floss]), 'Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.');
  assert.equal(replyText(base({ linked: true, gaps: [floss] }), true).split('\n').at(-1), 'Nothing is ready yet. Do real people use it? Say yes and I look again.');
  assert.deepEqual(firstStepOf([floss]), { users: true, more: true, program_id: 'floss-fund' });
  // A rule left beside it (shown beside a change, so the rule is not asked first): I look again.
  const hero = gap({ title: 'HeroDevs', gap: USERS, also: [ruleGap('an OSI-approved open source license')], rules: ['an OSI-approved open source license'] });
  assert.equal(replyText(base({ linked: true, gaps: [gap({ title: 'Arc Fund' }), hero] }), true).split('\n').at(-1), 'Nothing is ready yet. Do real people use it? Say yes and I look again.');
  for (const t of [end([floss]), end([gap({ title: 'Arc Fund' }), hero])]) assert.doesNotMatch(t!, /I apply|—|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
});

test('v6.1.14: the ledger line reads "Your applications"; nothing fits promises nothing that is never pushed', () => {
  const r = base({ ready: [ready({ title: 'A' })], ledger: { ...LEDGER0, applied: 2, won: 1, won_usd: 5000, pending: 1 },
    applications: [{ program_id: 'w', title: 'W Grant', status: 'won', sent_at: '2026-11-01T10:00:00.000Z', result_at: '2026-11-05T10:00:00.000Z', amount: '$5,000' }] });
  assert.match(replyText(r, false, MON), /^Your applications: W Grant \(sent Nov 1, won \$5,000\)\.$/m);
  assert.doesNotMatch(replyText(r, false), /Ledger/);
  assert.equal(replyText(base(), false), 'Nothing fits yet. Ask again any time and I show what is new.');
});

test('Review Focus 1 (v6.1.14): a reply whose closing names the needs never repeats them on line 1', () => {
  const sol = ready({ title: 'Solana Foundation Grants', rule_yes: true, need_you: ['your website link', 'the requested amount'], needs: ['your website link', 'the requested amount'] });
  const show = afterApply(base({ ready: [sol] }), true);
  assert.equal(show, ['Ready to apply (1):', '1. Solana Foundation Grants, $1K.', 'Solana Foundation Grants needs your website link and requested amount; then I apply.'].join('\n'));
  assert.equal(show.match(/website link/g)!.length, 1, show);
  // Linked: the drafted counts stay, the needs go to the closing.
  const linked = afterApply(base({ linked: true, ready: [{ ...sol, total: 3, from_record: 1 }] }), true);
  assert.match(linked, /^1\. Solana Foundation Grants, \$1K\.$/m);
  assert.equal(linked.match(/website link/g)!.length, 1, linked);
  // No yes given: the closing asks the yes, so the line keeps its needs.
  const other = ready({ title: 'Other Grant', needs: ['your website link'] });
  assert.match(afterApply(base({ ready: [other] }), true), /^1\. Other Grant, \$1K\. You give: your website link\.$/m);
});

test('Review Focus 2 (v6.1.14): an unlinked builder reads the sign-in ask once per reply, in the closing', () => {
  const TIER = { kind: 'tier' as const, item: 'tier:used', what: 'proof that real people use it', effort: 'weeks' as const, agent_can: false };
  const DEMO = { kind: 'demo_video' as const, item: 'demo_video', what: 'a demo video', effort: 'hours' as const, agent_can: false };
  const link = 'https://earnkit.com/link?c=abc';
  const show = replyText(base({ sign_in: link, gaps: [gap({ title: 'Sign Grant', money: 'Up to $5,000', gap: TIER })] }), true);
  // L29-33 (v6.1.16 Task 15): its own line; after a bare closing it is the action, last. L1j-6 (v6.1.17): it names what it checks.
  assert.equal(show, ['One step away (1):', '1. Sign Grant, Up to $5,000: proof that real people use it.', 'Nothing is ready yet.', `Sign in once at ${link} and I check your users and remember you.`].join('\n'));
  assert.equal(show.match(/Sign in/g)!.length, 1, show);
  assert.equal(gapLine({ ...gap({ title: 'G', gap: TIER, also: [DEMO] }), n: 1 }), '1. G, $1K: proof that real people use it and a demo video.');
  // No proof gap shown: the closing keeps its repo-read promise.
  assert.match(replyText(base({ sign_in: link, ready: [ready({ title: 'A' })] }), true), /\nSign in once at \S+ and I read your repo for proof and remember you\.\nSay yes and I apply to A\.$/);
});

test('fix round 1 (v6.1.14, F1 and F2): the proof sign-in promises a check only after a repo read, and is said without a link when none can be made', () => {
  const TIER = { kind: 'tier' as const, item: 'tier:used', what: 'proof that real people use it', effort: 'weeks' as const, agent_can: false };
  const link = 'https://earnkit.com/link?c=abc';
  const end = (over: Partial<R>) => replyText(base({ gaps: [gap({ title: 'Sign Grant', money: 'Up to $5,000', gap: TIER })], ...over }), true).split('\n').slice(-2).join(' ');
  // F1: nothing read.
  assert.equal(end({ sign_in: link, as_reported: true }), `Nothing is ready yet. Sign in once at ${link} and I remember you.`);
  assert.equal(end({ sign_in: link, repo_notes: ['empty'] }), `Nothing is ready yet. Sign in once at ${link} and I remember you.`);
  // F2: no link (linkOf failed).
  assert.equal(end({}), 'Nothing is ready yet. Sign in once and I check your users.');
  assert.equal(end({ as_reported: true }), 'Nothing is ready yet. Sign in once and I remember you.');
  // F2: after the account was deleted, no link is given, the sign-in is still said once, the notice last.
  const del = replyText(base({ gaps: [gap({ title: 'Sign Grant', money: 'Up to $5,000', gap: TIER })], linked_notice: DELETED_NOTICE }), true);
  assert.equal(del.split('\n').slice(-3).join('\n'), `Nothing is ready yet.\nSign in once and I check your users.\n${DELETED_NOTICE}`);
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
  assert.equal(end(base({ gaps: [futo] })), 'Nothing is ready yet. Tell me when the code is in a repo and I look again.');
  assert.equal(end(base({ gaps: [{ ...futo, also: [] }] })), 'Nothing is ready yet. Tell me when the code is in a repo and I look again.');
  assert.equal(gapAction(futo), 'Tell me when the code is in a repo and I look again.');
});

test('L1f-1, L1f-3 (v6.1.14): the public repo and archive gaps read as gaps, their step after "First:" and in the closing', () => {
  const end = (r: R) => replyText(r, true).split('\n').at(-1);
  const PUBLIC = { kind: 'repo' as const, item: 'repo:public', what: 'a public repo', setup: 'make the repo public', effort: 'minutes' as const, agent_can: false };
  const ARCHIVED = { kind: 'repo' as const, item: 'repo:archived', what: 'the repo is archived', setup: 'tell me the live repo', effort: 'minutes' as const, agent_can: false };
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
  assert.equal(both, [
    'One step away (2):',
    '1. FLOSS/fund, $1K: a public repo. First: publish a funding manifest on your site or repo.',
    '2. HeroDevs, $1K: a public repo. Their rule: an OSI-approved open source license.',
    'Nothing is ready yet. Tell me when the repo is public and I look again.',
  ].join('\n'));
  // L1g-5 (v6.1.16): the closing names the step as "the repo is public", the lines leave it out: said once.
  assert.equal(both.match(/make the repo public|the repo is public/g)?.length, 1);
  assert.doesNotMatch(both, /Say yes and I apply/);
  assert.equal(gapAction(floss), 'Tell me when the repo is public and I look again.');
  const atom = gap({ title: 'FLOSS/fund', gap: ARCHIVED, setup: [MANIFEST], n: 1 });
  assert.equal(gapLine(atom, true), 'FLOSS/fund, $1K: the repo is archived. First: tell me the live repo; publish a funding manifest on your site or repo.');
  const archived = replyText(base({ gaps: [atom] }), true);
  assert.equal(archived, ['One step away (1):', '1. FLOSS/fund, $1K: the repo is archived. First: publish a funding manifest on your site or repo.', 'Nothing is ready yet. Tell me the live repo and I look again.'].join('\n'));
  assert.equal(end(base({ gaps: [atom] })), 'Nothing is ready yet. Tell me the live repo and I look again.');
  assert.equal(gapAction({ ...atom, setup: [] }), 'Tell me the live repo and I look again.');
  // M3: the code closing is picked by the gap's kind.
  assert.equal(firstStepOf([gap({ title: 'FUTO', gap: { kind: 'repo', item: 'repo', what: 'any words', effort: 'days', agent_can: false } })])?.users === false, true);
  assert.equal(end(base({ gaps: [gap({ title: 'FUTO', gap: { kind: 'repo', item: 'repo', what: 'any words', effort: 'days', agent_can: false }, n: 1 })] })), 'Nothing is ready yet. Tell me when the code is in a repo and I look again.');
  assert.match(agentNote(base({ gaps: [floss, atom] }), { more: 0 }), /pass private: false[^\n]*live repo_url/);
});

test('L1g-5 (v6.1.16): one closing shape for every single step, the step said once', () => {
  const chain = (what: string) => ({ kind: 'chain' as const, item: 'chain:base', what, effort: 'hours' as const, agent_can: false, details: { chain: 'base' } });
  const MANIFEST = 'publish a funding manifest on your site or repo';
  const own = { kind: 'feature' as const, item: 'feature:manifest', what: 'a funding manifest', setup: MANIFEST, effort: 'hours' as const, agent_can: false };
  const ARCHIVED = { kind: 'repo' as const, item: 'repo:archived', what: 'the repo is archived', setup: 'tell me the live repo', effort: 'minutes' as const, agent_can: false };
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
  assert.equal(replyText(base({ gaps: [g] }), true), ['One step away (1):', '1. Manifest Fund, $1K: a funding manifest.', 'Nothing is ready yet. Tell me when you publish a funding manifest on your site or repo and I look again.'].join('\n'));
  assert.equal(gapAction(gap({ title: 'S', gap: { kind: 'new_work_after', item: 'new_work_after:2026-01-01', what: 'tell me when you started this', effort: 'minutes', agent_can: false } })), 'Tell me when you started and I check it.');
  // Persona 12: the line reads the archive, so the archived note is left out; with no such line it stays.
  const atom = gap({ title: 'FLOSS/fund', gap: ARCHIVED, n: 1 });
  assert.equal(replyText(base({ gaps: [atom], repo_notes: ['archived'] }), true), ['One step away (1):', '1. FLOSS/fund, $1K: the repo is archived.', 'Nothing is ready yet. Tell me the live repo and I look again.'].join('\n'));
  assert.match(replyText(base({ gaps: [gap({ title: 'Arc', n: 1 })], repo_notes: ['archived'] }), true), /This repo is archived; programs want active work\./);
});

test('L1g-8b (v6.1.16, Review Focus 1): a program not ready for this repo never lends its rule; an unlikely rule waits behind a shown step', () => {
  const PUB = { ...PUBLIC_REPO };
  const floss = gap({ title: 'FLOSS/fund', gap: PUB, setup: ['publish a funding manifest on your site or repo'], public_first: true, n: 1 });
  const vr = gap({ title: 'Meta VR', gap: ruleGap('a hands-first experience for Meta VR devices'), unlikely: true, n: 2 });
  const hero = gap({ title: 'HeroDevs', gap: PUB, also: [ruleGap('an OSI-approved open source license', 'rule:0000000b')], public_first: true, n: 3 });
  const end = (gaps: GapProgram[]) => replyText(base({ gaps }), true).split('\n').at(-1)!;
  assert.equal(end([floss, vr, hero]), 'Nothing is ready yet. Tell me when the repo is public and I look again.');
  assert.doesNotMatch(replyText(base({ gaps: [floss, vr, hero] }), true), /Say "yes/);
  // The only step program shown is not ready for this repo: its rule is no step yet.
  assert.equal(stepRuleOf([hero]), null);
  assert.equal(end([hero]), 'Nothing is ready yet. Tell me when the repo is public and I look again.');
  // With no step shown, an unlikely rule is still asked; a likely one (no flag) is asked whatever is shown.
  assert.equal(end([vr]), 'Nothing is ready yet. Say "yes 1" if that rule fits you and I get it ready.');
  assert.equal(end([floss, { ...vr, unlikely: undefined }]), 'Nothing is ready yet. Say "yes 2" if that rule fits you and I get it ready.');
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
  assert.equal(tier[1], '1. Used Grant, $1K: about 25 outside users in 90 days; I count 4.');
  assert.equal(tier.at(-1), 'Nothing is ready yet. Tell me when people outside the team use it live and I look again. Say "do 2" and I add the codes.');
  // L1i-2 (v6.1.16.1): both step rows are shown.
  assert.equal(tier.length, 4);
  const feature = list(gap({ title: 'Kiro Prize', gap: FEATURE, n: 1 }));
  assert.equal(feature[1], '1. Kiro Prize, $1K: a Kiro folder in the repo.');
  assert.equal(feature.at(-1), 'Nothing is ready yet. Tell me when a Kiro folder in the repo is in and I look again. Say "do 2" and I add the codes.');
  const weeks = list(gap({ title: 'Live Grant', gap: USERS_WEEKS, n: 1 }));
  assert.equal(weeks.at(-1), 'Nothing is ready yet. Tell me when it has been live for 4 weeks and I look again. Say "do 2" and I add the codes.');
  // No number of weeks given: the step is still named.
  assert.equal(list(gap({ title: 'Users Grant', gap: USERS_FIRST, n: 1 })).at(-1), 'Nothing is ready yet. Tell me when real people use it and I look again. Say "do 2" and I add the codes.');
  for (const x of [TIER_GAP, FEATURE, USERS_WEEKS, USERS_FIRST]) assert.notEqual(stepClause(x), null);
  // The one-program action reads the same.
  assert.equal(gapAction(gap({ title: 'Kiro Prize', gap: FEATURE })), 'Tell me when a Kiro folder in the repo is in and I look again.');
  // The unlinked proof and the proof being read keep their own sentences: no clause.
  assert.equal(stepClause({ ...TIER_GAP, what: 'proof that real people use it' }), null);
});

test('R38 (L17-6, v6.1.16): 25 programs held by agent A; agent B reads its own under Ready and the 25 in the held block, numbered on', () => {
  const NOW = new Date('2026-11-04T12:00:00Z');
  const held = Array.from({ length: 25 }, (_, k) => ready({ title: `Held ${k + 1}`, claimed_since: '2026-11-04T10:00:00.000Z' }));
  const r = base({ linked: true, ready: [...held.slice(0, 12), ready({ title: 'Mine A' }), ...held.slice(12), ready({ title: 'Mine B' })] });
  const lines = replyText(r, false, NOW).split('\n');
  assert.deepEqual(lines.map((l) => l.split(',')[0]), ['Ready to apply (2):', '1. Mine A', '2. Mine B', 'And 25 more in the full list.', 'Say yes and I apply to all 2 ready.']);
  // L29-26 (v6.1.16 Task 15): the 25 held ones are the agent's (Not shown) and the full view's, numbered on.
  const hidden = replyParts(r, false, NOW).hidden;
  assert.equal(hidden.length, 25);
  assert.deepEqual(hidden.map((l) => Number(l.split('.')[0])), Array.from({ length: 25 }, (_, k) => k + 3));
  const full = replyText(r, false, NOW, null, { all: true }).split('\n');
  // L35-9 (v6.1.17): two block headings.
  assert.equal(full.length, 30);
  assert.deepEqual(full.slice(2, 5), ['2. Mine B, $1K.', 'Being handled by your other agent (25):', '3. Held 1, $1K.']);
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
    "Ready to apply (1):\n1. Alpha Grant, $1K.\nNothing new since Nov 5.\nSay yes and I apply to Alpha Grant.");
  // Never on a first find, and never beside a since line.
  assert.doesNotMatch(replyText({ ...one, nothing_new_since: '2026-11-05T09:00:00.000Z' }, true, NOW), /Nothing new/);
  // L23-7: the started-not-sent lines (three, then the count); ONE_SAY_ORDER keeps the first Say only.
  const released = ['A', 'B', 'C', 'D', 'E'].map((t, i) => ({ program_id: t, title: `${t} Grant`, started_at: `2026-11-0${i + 1}T10:00:00.000Z` }));
  const started = replyText({ ...one, released }, false, NOW);
  // L29-26, L29-33 (v6.1.16 Task 15): Task 9's lines follow the money lines; the Say ONE_SAY_ORDER keeps goes last.
  assert.equal(started, [
    'Ready to apply (1):',
    '1. Alpha Grant, $1K.',
    'B Grant: started Nov 2, nothing sent.',
    'C Grant: started Nov 3, nothing sent.',
    'And 2 more started, nothing sent.',
    'A Grant: started Nov 1, nothing sent. Say yes to apply or say skip.',
  ].join('\n'));
  assert.equal(started.match(/\bSay\b/g)?.length, 1, started);
  // L23-1 first, then L23-7; a date 370 days back has its year (L23-11).
  const both = replyText({ ...one, released: released.slice(0, 1), not_sent: { programs: [{ program_id: 'x', title: 'X Grant' }], since: '2025-11-01T00:00:00.000Z' } }, false, NOW);
  assert.ok(both.endsWith('\nA Grant: started Nov 1, nothing sent.\nNothing was sent for X Grant since you said yes on Nov 1, 2025. Say yes again and I apply now.'), both);
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
  assert.equal(t.split('\n\n').at(-1), "Ready to apply (2):\n1. Alpha, $1K.\n2. Beta, $1K.\nOne step away (1):\n3. Codes Grant, $1K: add Base Builder Codes to the app.\nSay yes and I apply to all 2 ready, or \"do 3\" and I add the codes first.");
  assert.match(t, /^3\. Codes Grant, \$1K: add Base Builder Codes to the app\.$/m);
  assert.equal(t.match(/\bSay\b/g)?.length, 1, t);
});

test('L24-9 (J1-39): a yes names the program whenever other blocks are listed', () => {
  const inPerson = ready({ title: 'Meetup', in_person: true });
  const t = replyText(base({ ready: [ready({ title: 'Text Grant' }), inPerson], gaps: [gap({ title: 'Step', gap: VIDEO })] }), true);
  assert.equal(t.split('\n\n').at(-1), "Ready to apply (1):\n1. Text Grant, $1K.\nOne step away (1):\n2. Step, $1K: a demo video.\nAnd 1 more in the full list.\nSay yes and I apply to Text Grant.");
  const two = replyText(base({ ready: [ready({ title: 'A' }), ready({ title: 'B' }), inPerson] }), true);
  assert.equal(two.split('\n\n').at(-1), "Ready to apply (2):\n1. A, $1K.\n2. B, $1K.\nAnd 1 more in the full list.\nSay yes and I apply to all 2 ready.");
});

test('L24-10 (J3-3): some ready the builder submits: apply to the rest and draft those', () => {
  const r = base({
    ready: [ready({ title: 'Alpha' }), ready({ title: 'Beta' }), ready({ title: 'Gamma' })],
    blockers: [{ program_id: 'gamma', sign_in: null, needs_click: true, needs: [] }],
  });
  assert.equal(replyText(r, true).split('\n\n').at(-1), "Ready to apply (3):\n1. Alpha, $1K.\n2. Beta, $1K.\n3. Gamma, $1K.\nBefore applying: you press submit yourself on Gamma.\nSay yes and I apply to 2 and draft Gamma for you to send.");
});

test('L24-28 (J4-19): the one ready program over the limit is named in the closing; no Before clause', () => {
  const r = base({
    linked: true, auto_apply: true, max_per_night: 1,
    ready: [ready({ title: 'Screen Grant' })],
    blockers: [{ program_id: 'screen-grant', sign_in: null, needs_click: false, needs: [], outside_approval: true, over_limit_usd: 4500 }],
  });
  const t = replyText(r, true);
  assert.equal(t.split('\n\n').at(-1), "Ready to apply (1):\n1. Screen Grant, $1K.\nScreen Grant is over your limit. Say yes and I apply.");
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
  assert.match(replyText({ ...r, ready: shown }, true, new Date(), null, { all: true }), /\n2\. Beta, \$1K\.\n/);
  assert.equal(t.split('\n').at(-1), 'Applying now to Alpha under your standing approval. Say stop and I hold any of them.');
  assert.ok(agentNote(r, { more: 0 }).includes('A ready program with held: true is held by the builder'));
});

test('L24-1, ruling 12: a held line never names a project or a time', () => {
  const t = replyText(base({ ready: [ready({ title: 'In', in_person: true, claimed_since: '2026-11-04T10:00:00.000Z' })] }), true);
  assert.match(t, /1\. In, \$1K\. Attend in person\. Being handled by your other agent\.$/m);
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
  const line = replyText(base({ ready: [solana] }), true).split('\n')[1];
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
  assert.equal(parts.text.split('\n').at(-1), 'On hold until you say go. Say go and I apply.');
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
  const r = base({ ready: [yc, alliance], gaps: steps });
  const p = replyParts(r, true);
  const lines = p.text.split('\n');
  assert.equal(lines.length, 10, p.text);
  assert.equal(lines[0], 'One step away (7):');
  const rows = lines.filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.split('.')[0]));
  assert.deepEqual(rows, rows.map((_, i) => i + 1), p.text);
  // L1j-3 (v6.1.17): every row left out, step or in person, is counted on the line before the Say.
  assert.equal(lines.at(-2), moreInFull(9 - rows.length), p.text);
  const five = lines.find((l) => l.includes('Five Grant'))!;
  assert.equal(lines.at(-1), `Nothing is ready yet. Say "yes ${five.split('.')[0]}" if that rule fits you and I get it ready.`);
  // Every program the default leaves out is in the full view, and the full view asks no rule.
  const full = replyText(r, true, new Date(), null, { all: true });
  for (const g of steps) assert.ok(full.includes(`. ${g.title}, $1K.`), g.title);
  assert.doesNotMatch(full, /Say "yes/);
  assert.equal(full.split('\n').at(-1), `Nothing is ready yet. ${FULL_RULE_SAY}`);
  // `shown` names the rows by their shown number, in order.
  assert.equal(p.shown.length, rows.length);
});

test('L1i-6 (v6.1.16.1): the full view carries closes and in person; a hidden ready row leaves no gap in the shown numbers', () => {
  const rs = ['A', 'B', 'C', 'D', 'E'].map((t) => ready({ title: `${t} Grant`, closes_in: t === 'A' ? 'Dec 6' : null }));
  const r = base({ ready: rs, gaps: [gap({ title: 'Step Grant' })] });
  const text = replyText(r, true);
  assert.match(text, /^4\. Step Grant, \$1K: deploy the contract on Arc\.$/m);
  assert.match(replyText(r, true, new Date(), null, { all: true }), /^1\. A Grant, \$1K, closes Dec 6\.$/m);
});

test('Fix round 1 (I1, v6.1.16.1): the line carrying the only link outranks every line but the Say; since, results, then extra rows give way', async () => {
  const { unlinkedNoticeLine } = await import('../v6/reply-words');
  const link = 'https://earnkit.com/link/abc';
  const yc = ready({ title: 'Y Combinator', money: '$500K investment', in_person: true, setup: ['a YC account'], needs: ['a YC account'] });
  const alliance = ready({ title: 'Alliance', money: '$400K', in_person: true, setup: ['a passport'], needs: ['a passport'] });
  const steps = [gap({ title: 'Rule Grant', gap: ruleGap('a rule'), rules: ['a rule'] }), gap({ title: 'Two Grant' }), gap({ title: 'Three Grant' })];
  const busy = {
    ready: [yc, alliance], gaps: steps, sign_in: link,
    applications: [{ program_id: 'a', title: 'A Grant', status: 'waiting' as const, sent_at: '2026-11-03T10:00:00.000Z', result_at: null, amount: null }],
    ask_outcome: [{ program_id: 'z', title: 'Zeta Grant', due_at: '2026-11-01T00:00:00Z' }],
    nothing_new_since: '2026-11-03T10:00:00.000Z',
  };
  for (const over of [{}, { linked_notice: unlinkedNoticeLine(link) }]) {
    const p = replyParts(base({ ...busy, ...over }), false, MON);
    const lines = p.text.split('\n');
    assert.ok(lines.length <= 10, p.text);
    assert.equal(p.text.split(link).length, 2, p.text);
    assert.ok(!p.hidden.some((h) => h.includes(link)), p.hidden.join('\n'));
    assert.match(lines.at(-1)!, /^Nothing is ready yet\. Say "yes 1" if that rule fits you and I get it ready\.$/);
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
    'Ready to apply (6):',
    '1. L35 Closes In 2 Min, $1K, closes today.',
    '2. L35 Closing Soon, $1K, closes today.',
    '3. Dec One, $1K, closes Dec 12.',
    // Fix round 1 (I1): the hidden count is said once, on the And-more line; the yes says "ready".
    'And 3 more in the full list.',
    'Say yes and I apply to all 6 ready.',
  ].join('\n'));
  const full = replyText(r, true, NOW, null, { all: true, defaultSay: p.say });
  assert.equal(full.split('\n')[0], 'Ready to apply (6):');
  assert.equal(full.split('\n').at(-1), 'Say yes and I apply to all 6 ready.');
});

test('L35-8 (v6.1.17 fix round 1 I1): a capped ready block draft-only says the count once too', () => {
  const r = base({
    ready: ['A', 'B', 'C', 'D', 'E'].map((t) => ready({ title: t })),
    blockers: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ program_id: id, sign_in: null, needs_click: true, needs: [] })),
  });
  const p = replyParts(r, true, new Date('2026-11-12T08:00:00Z'));
  assert.deepEqual(p.text.split('\n').slice(-2), ['And 2 more in the full list.', 'Say yes and I draft all 5 for you to send.']);
  assert.doesNotMatch(p.text, /not shown/);
});

test('v6.1.16 Task 11 N2 (v6.1.17): with every ready program under "Your yes stands", a do gap still closes the reply', () => {
  const CODES = { kind: 'builder_codes' as const, item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'hours' as const, agent_can: true };
  assert.equal(closingLine({ ready: 1, draftOnly: false, gaps: 1, firstRule: null, inPerson: 0, held: 0, yesStands: ['Alpha'], doOffer: { n: 2, verb: 'add them' } }).text,
    'Your yes stands for Alpha: I apply now, or "do 2" and I add them first.');
  const r = base({ ready: [ready({ title: 'Alpha', rule_yes: true })], gaps: [gap({ title: 'Codes Grant', gap: CODES })] });
  assert.equal(replyText(r, false, new Date(), 'apply').split('\n').at(-1), 'Your yes stands for Alpha: I apply now, or "do 2" and I add the codes first.');
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
  assert.equal(replyText({ ...one, nothing_new_since: '2026-11-12T09:00:00.000Z' }, false, NOW).split('\n').at(-2), 'Nothing new since your last look.');
  assert.equal(replyText({ ...one, nothing_new_since: '2026-11-11T09:00:00.000Z' }, false, NOW).split('\n').at(-2), 'Nothing new since Nov 11.');
});

test('L1j-1, L1j-6 (v6.1.17): one sentence mentions signing in, and the action is the last line', () => {
  const TIER = { kind: 'tier' as const, item: 'tier:used', what: 'proof that real people use it', effort: 'weeks' as const, agent_can: false };
  const USERS = { kind: 'users' as const, item: 'users', what: 'real users first', effort: 'hours' as const, agent_can: false };
  const link = 'https://earnkit.com/link/abc';
  // The users question carries the sign-in: no proof line beside it.
  const users = replyText(base({ sign_in: link, gaps: [gap({ title: 'FLOSS', gap: USERS })] }), true);
  assert.equal(users.split(/(?<=[.?!])\s+/).filter((x) => /sign in/i.test(x)).length, 1, users);
  assert.equal(users.split('\n').at(-1), `Nothing is ready yet. Do real people use it? Say yes, sign in once at ${link}, and I check.`);
  // A closing that names its action ends the reply, the sign-in before it.
  const code = replyText(base({ sign_in: link, gaps: [gap({ title: 'Sign Grant', gap: TIER }), gap({ title: 'Code Grant', gap: NEEDS_CODE })] }), true);
  assert.equal(code.split('\n').at(-2), `Sign in once at ${link} and I check your users and remember you.`, code);
  assert.match(code.split('\n').at(-1)!, /^Nothing is ready yet\. /);
});

// Registered last, so it reads every reply the tests above rendered.
test('Review Focus 12, ONE_SAY_ORDER (v6.1.17 Task 5, v6.1.16 Task 9 N6): every reply fixture rendered through replyText promises no send tonight and carries at most one Say', () => {
  assert.ok(rendered.length >= 100, `${rendered.length}`);
  for (const t of rendered) {
    assert.doesNotMatch(t, /\btonight\b|by tomorrow morning/i, t);
    assert.ok((t.match(/\bSay\b/g) ?? []).length <= 1, t);
  }
});

test('L18-4c: the sent line reads "Did you send Kiroween 2026? Say sent and I note it." and sits before the Say (or is it, last)', async () => {
  const { sentLines, replyParts: parts } = await import('./reply');
  const NOW = new Date('2026-11-12T12:00:00Z');
  const kiro = { program_id: 'kiro', title: 'Kiroween 2026', started_at: '2026-11-12T10:00:00.000Z', project_id: null };
  assert.deepEqual(sentLines({ ask_sent: [kiro] }), ['Did you send Kiroween 2026? Say sent and I note it.']);
  const one = base({ ready: [ready({ title: 'Alpha Grant', filled: 1, facts_from_repo: 1, repo_required: 1, total: 1 })] });
  // ONE_SAY_ORDER: after the started lines, before the closing; alone, the sent question is the reply's one Say, last.
  const p = parts({ ...one, ask_sent: [kiro] }, false, NOW);
  assert.equal(p.text, 'Ready to apply (1):\n1. Alpha Grant, $1K.\nDid you send Kiroween 2026? Say sent and I note it.');
  assert.equal(p.offer, null);
  // Beside a started line's Say, the question sits before it, its own Say left out.
  const started = { program_id: 'a', title: 'A Grant', started_at: '2026-11-10T10:00:00.000Z' };
  const t = renderReply({ ...one, ask_sent: [kiro], released: [started] }, false, NOW);
  assert.ok(t.endsWith('\nDid you send Kiroween 2026?\nA Grant: started Nov 10, nothing sent. Say yes to apply or say skip.'), t);
  assert.equal(t.match(/\bSay\b/g)?.length, 1, t);
  // Two asks: the first keeps the Say.
  const two = renderReply({ ...one, ask_sent: [kiro, { ...kiro, program_id: 'b', title: 'Beta Jam' }] }, false, NOW);
  assert.ok(two.endsWith('\nDid you send Beta Jam?\nDid you send Kiroween 2026? Say sent and I note it.'), two);
  // The agent note says how to record each answer, also when nothing is listed.
  const note = 'The reply asks whether each was sent: Kiroween 2026. "sent" is track applied with submitted_by builder; "not yet" needs no call.';
  assert.ok(agentNote({ ...one, ask_sent: [kiro] }, { more: 0 }).split('\n').includes(note));
  assert.ok(agentNote(base({ ask_sent: [kiro] }), { more: 0 }).split('\n').includes(note));
  assert.equal(renderReply(base({ ask_sent: [kiro] }), false, NOW).split('\n').at(-1), 'Did you send Kiroween 2026? Say sent and I note it.');
});

test('L36-2: a builder-sent claim past 24 hours asks instead of saying nothing sent; its agent note is the sent note', () => {
  const NOW = new Date('2026-11-12T12:00:00Z');
  const one = base({ ready: [ready({ title: 'Alpha Grant', filled: 1, facts_from_repo: 1, repo_required: 1, total: 1 })] });
  const futo = { program_id: 'futo', title: 'FUTO Microgrants', started_at: '2026-11-11T09:00:00.000Z', ask: true as const };
  const t = renderReply({ ...one, released: [futo] }, false, NOW);
  assert.equal(t.split('\n').at(-1), 'FUTO Microgrants: started Nov 11; did you send it? Say sent and I note it.');
  assert.doesNotMatch(t, /nothing sent/);
  const n = agentNote({ ...one, released: [futo] }, { more: 0 });
  assert.match(n, /The reply asks whether each was sent: FUTO Microgrants\./);
  assert.doesNotMatch(n, /were released/);
});
