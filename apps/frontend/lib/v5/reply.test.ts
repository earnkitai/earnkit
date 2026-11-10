import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentNote, attendRuleGap, gapAction, gapLine, notFitLine, numbered, replyText, stepRuleOf } from './reply';
import type { FindReply, GapProgram, ReadyProgram } from './find';
import type { Ledger } from './ledger';

type R = Omit<FindReply, 'show_to_builder' | 'agent_note'>;

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
const LEDGER0: Ledger = { applied: 0, asked_usd: 0, won: 0, won_usd: 0, pending: 0, rejected: 0, skipped: 0, closing_soon: [] };
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
});

test('the Monday text: two ready, one gap, a ledger with one applied', () => {
  assert.equal(
    replyText(MONDAY, false),
    [
      'Ready to apply (2):',
      "1. Alliance ALL19, $400K at admission, closes in 14 days. Drafted: 2 of 9 answers from the repo, 6 more by your agent. Needs your first founder's email.",
      '2. Arc Builders Fund, investment from Circle Ventures. Long odds: an investment program with no stated amount. Your agent drafts all 5 answers.',
      '',
      'One step away (1):',
      '3. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc.',
      '',
      'Ledger: 1 applied, 0 won, 1 pending.',
      '',
      'Say yes and I apply to all 2. Or say the numbers to skip.',
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
      'Since Nov 2: 2 new programs you fit; Circle Developer Grants: deadline moved to Nov 20; Alliance ALL19 closes in 3 days.',
      '',
      'Ready to apply (1):',
      "1. Alliance ALL19, $400K at admission, closes in 3 days. Drafted: 1 of 4 answers from the repo, the rest by your agent.",
      '',
      'Ledger: 2 applied, 1 won, 1 pending, 1 closing soon.',
      '',
      'Say yes and I apply.',
    ].join('\n'),
  );
  assert.ok(!replyText(r, true).includes('Since'));
  // A win shows what was won, never what was asked (3.6).
  assert.match(replyText({ ...r, ledger: { ...r.ledger, won_usd: 25000 } }, false), /^Ledger: 2 applied, 1 won \(\$25,000\), 1 pending, 1 closing soon\.$/m);
});

test('gaps only, the agent can do it, and the needs list is cut at three', () => {
  const r = base({
    gaps: [gap({ title: 'Base Batches', money: '$100K', gap: { kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes', agent_can: true } })],
  });
  assert.equal(
    replyText(r, false),
    // M1 (v6.1.9): the line already offers "do 1", so the closing names no second action.
    ['One step away (1):', '1. Base Batches, $100K: add Base Builder Codes to the app. Say "do 1" and I add them.', '', 'Nothing is ready yet.'].join('\n'),
  );
  // "do n" by the gap's kind, only when EarnKit can make every real gap (1a, 3.7).
  const one = (g: GapProgram['gap'], also: GapProgram['also'] = []) => replyText(base({ gaps: [gap({ title: 'G', gap: g, also })] }), false).split('\n')[1];
  const ARC = { kind: 'contract_on' as const, item: 'contract_on:arc', what: 'a contract on Arc', effort: 'hours' as const, agent_can: false };
  const SW = { kind: 'integration' as const, item: 'integration:smart_wallet', what: 'add Smart Wallet', effort: 'days' as const, agent_can: true };
  const DEMO = { kind: 'demo_video' as const, item: 'demo_video', what: 'a demo video', effort: 'hours' as const, agent_can: false };
  // A contract deploy is never EarnKit's change (fix round 1): the line ends after the gap.
  assert.equal(one(ARC), '1. G, $1K: a contract on Arc.');
  assert.ok(!agentNote(base({ gaps: [gap({ title: 'G', gap: ARC })] }), { more: 0 }).includes('On "do <n>"'));
  assert.equal(one(SW), '1. G, $1K: add Smart Wallet. Say "do 1" and I add it.');
  assert.equal(one(ARC, [SW]), '1. G, $1K: a contract on Arc and add Smart Wallet.');
  assert.equal(one(SW, [{ ...SW, item: 'integration:x', what: 'add X' }]), '1. G, $1K: add Smart Wallet and add X. Say "do 1" and I make both changes.');
  assert.equal(one(ARC, [DEMO]), '1. G, $1K: a contract on Arc and a demo video.');
  // C57: the unlinked tier gate is its own sentence after the gaps, never after a colon.
  const TIER = { kind: 'tier' as const, item: 'tier:used', what: 'Sign in once so EarnKit can confirm real people use it', effort: 'weeks' as const, agent_can: false };
  assert.equal(one(TIER), '1. G, $1K. Sign in once so EarnKit can confirm real people use it.');
  assert.equal(one(TIER, [DEMO]), '1. G, $1K: a demo video. Sign in once so EarnKit can confirm real people use it.');
  const two = base({ gaps: [gap({ title: 'G', money: '$1K', also: [{ kind: 'live_product', item: 'live_product', what: 'put a live link up', effort: 'hours', agent_can: false }] })] });
  assert.match(replyText(two, false), /^1\. G, \$1K: deploy the contract on Arc and put a live link up\.$/m);
  const many = base({ ready: [ready({ title: 'B', needs: ['your full name', 'your email', 'a Loom product demo', 'your X handle', 'an investor deck file'] })] });
  assert.match(replyText(many, false), /Needs your full name, email, Loom product demo and 2 more\.$/m);
  const setup = base({ ready: [ready({ title: 'S', setup: ['sign in to the Builder Hub'], needs: ['sign in to the Builder Hub', 'a Loom product demo'] })] });
  // R2c: the one answer is the builder's, so the agent drafts none of it.
  assert.match(replyText(setup, false), /^1\. S, \$1K\. Needs your Loom product demo\. First: sign in to the Builder Hub\.$/m);
});

test('one ready program: no "all 1"', () => {
  const one = base({ ready: [MONDAY.ready[0]] });
  assert.match(replyText(one, false), /\n\nSay yes and I apply\.$/);
  const withGap = base({ ready: [MONDAY.ready[0]], gaps: MONDAY.gaps });
  assert.match(replyText(withGap, false), /\n\nSay yes and I apply\.$/);
});

test('in person: its own block after ready and gaps, with the setup, and never in the count to apply to', () => {
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
      "1. Alliance ALL19, $400K at admission, closes in 14 days. Drafted: 2 of 9 answers from the repo, 6 more by your agent. Needs your first founder's email.",
      '2. Arc Builders Fund, investment from Circle Ventures. Long odds: an investment program with no stated amount. Your agent drafts all 5 answers.',
      '',
      'One step away (1):',
      '3. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc.',
      '',
      'In person (1):',
      '4. ETHGlobal Mumbai, up to $15K per partner prize, closes in 2 days. First: apply to attend by Nov 3 and get accepted; stake a small amount of ETH; be in Mumbai Nov 5 to 7.',
      '',
      'Say yes and I apply to all 2. Or say the numbers to skip.',
    ].join('\n'),
  );
  const only = replyText(base({ ready: [mumbai] }), false);
  assert.ok(only.startsWith('In person (1):\n1. ETHGlobal Mumbai'), only);
  assert.doesNotMatch(only, /Say yes to apply/);
  assert.match(agentNote(r, { more: 0 }), /In-person programs .* draft nothing for one until the builder says yes to attending it/);
  assert.doesNotMatch(agentNote(MONDAY, { more: 0 }), /In-person/);
});

test('a ledger never names an asked amount (3.6)', () => {
  const r = base({ ledger: { ...LEDGER0, applied: 1, asked_usd: 0, pending: 1 } });
  assert.match(replyText(r, false), /^Ledger: 1 applied, 0 won, 1 pending\.$/m);
});

test('nothing fits', () => {
  assert.equal(replyText(base(), false), "Nothing fits yet. I'll say when something opens.");
});

test('every closing line, and the copy rules', () => {
  const texts = [replyText(MONDAY, false), replyText(base({ ready: MONDAY.ready }), false), replyText(base({ gaps: MONDAY.gaps }), false), replyText(base(), false)];
  for (const t of texts) {
    assert.doesNotMatch(t, /—|\p{Extended_Pictographic}/u);
    assert.doesNotMatch(t, /\b(coin|points|score|rank|streak|token)s?\b/i);
  }
});

test('agentNote: fields, yes only, track after each, the counts left out, ask once', () => {
  const n = agentNote({ ...MONDAY, ask_outcome: [{ program_id: 'z', title: 'Zeta Grant' }] }, { more: 2 });
  for (const s of ["'earnkit'", "'agent'", "'builder'", 'sources', 'form_id', 'track', 'won', 'Zeta Grant', '2 more left out: ready past the cap, gaps and in-person programs. Ask with filter.all for the full list.'])
    assert.ok(n.includes(s), s);
  assert.ok(!agentNote(MONDAY, { more: 0 }).includes('more: gaps'));
  assert.ok(n.includes('Pass users and live_url in the project whenever you know them; never invent them.'));
  // 3.34: who reported what, said plainly.
  assert.ok(agentNote(base({ as_reported: true }), { more: 0 }).includes('tell the builder the match used what they reported, not a repo read.'));
  assert.ok(!agentNote(base({ as_reported: true }), { more: 0 }).includes('as reported by you'));
});

test('repo reads paused: its own agent line, never "send them corrected"', () => {
  const paused = agentNote(base({ problems: ['repo reads paused until tomorrow'] }), { more: 0 });
  assert.ok(paused.includes('Repo reads are paused for this installation until tomorrow; the match used what you reported.'));
  assert.ok(!paused.includes('Send them corrected'));
  const both = agentNote(base({ problems: ['live_url dropped: not a web link', 'repo reads paused until tomorrow'] }), { more: 0 });
  assert.ok(both.includes('Some project facts were dropped: live_url dropped: not a web link. Send them corrected next time.'));
});

test('a reported-only program with passed links reads "Your agent drafts the one answer."', () => {
  assert.match(replyText(base({ ready: [ready({ title: 'R', filled: 3, facts_from_repo: 0 })] }), false), /^1\. R, \$1K\. Your agent drafts the one answer\.$/m);
});

test('the ready line is honest about the answers (R2c): n from the repo, k by the agent, the builder\'s named, never above total', () => {
  const line = (over: Partial<ReadyProgram>) => replyText(base({ ready: [ready({ title: 'Z Fellows', money: '$10K', ...over })] }), false).split('\n')[1];
  assert.equal(line({ repo_required: 2, total: 9, needs: ['your email'] }), '1. Z Fellows, $10K. Drafted: 2 of 9 answers from the repo, 6 more by your agent. Needs your email.');
  assert.equal(line({ repo_required: 2, total: 23 }), '1. Z Fellows, $10K. Drafted: 2 of 23 answers from the repo, the rest by your agent.');
  assert.equal(line({ repo_required: 1, total: 2, needs: ['your birthday'] }), '1. Z Fellows, $10K. Drafted: 1 of 2 answers from the repo. Needs your birthday.');
  assert.equal(line({ repo_required: 0, total: 23, needs: ['your birthday', 'your phone number'] }), '1. Z Fellows, $10K. Your agent drafts 21 answers. Needs your birthday and phone number.');
  assert.equal(line({ total: 2, needs: ['your birthday'] }), '1. Z Fellows, $10K. Your agent drafts 1 answer. Needs your birthday.');
  assert.equal(line({ total: 23 }), '1. Z Fellows, $10K. Your agent drafts all 23 answers.');
  assert.equal(line({ total: 1, needs: ['your birthday'] }), '1. Z Fellows, $10K. Needs your birthday.');
  assert.equal(line({ repo_required: 4, total: 4 }), '1. Z Fellows, $10K. Drafted: all 4 answers from the repo.');
  // Never above total; optional fields read from the repo (facts_from_repo) are not in the count.
  assert.equal(line({ repo_required: 6, facts_from_repo: 9, total: 4 }), '1. Z Fellows, $10K. Drafted: all 4 answers from the repo.');
  assert.equal(
    line({ total: 3, setup: ['sign in to the Hub'], needs: ['sign in to the Hub', 'your birthday'] }),
    '1. Z Fellows, $10K. Your agent drafts 2 answers. Needs your birthday. First: sign in to the Hub.',
  );
});

test('one required answer reads in the singular', () => {
  const line = (repo_required: number) => replyText(base({ ready: [ready({ title: 'One', money: '$1K', repo_required, total: 1 })] }), false).split('\n')[1];
  assert.equal(line(1), '1. One, $1K. Drafted: the one answer from the repo.');
  assert.equal(line(0), '1. One, $1K. Your agent drafts the one answer.');
});

const BANNED = /—|\p{Extended_Pictographic}|\b(score|rank|grade|points|coin|token|streak)s?\b/iu;

test('linked: the ready line names what the record and the repo give and who else is needed', () => {
  const r = base({
    linked: true,
    // facts_from_repo counts optional fields too (v5's count); the linked line reads the required ones only.
    ready: [ready({ title: 'Z Fellows', money: '$10K', from_record: 3, facts_from_repo: 4, repo_required: 2, total: 6, need_you: ['your Telegram username'], needs: ['your Telegram username'] })],
  });
  assert.equal(replyText(r, false).split('\n')[1], '1. Z Fellows, $10K. 3 from your record, 2 from the repo, 1 needs you: your Telegram username.');
  const none = base({ linked: true, ready: [ready({ title: 'A', from_record: 2, facts_from_repo: 1, repo_required: 1, total: 3 })] });
  assert.equal(replyText(none, false).split('\n')[1], '1. A, $1K. 2 from your record, 1 from the repo.');
  const four = base({ linked: true, ready: [ready({ title: 'B', from_record: 1, total: 6, need_you: ['your phone', 'your birthday', 'where you are based', 'your Telegram username'] })] });
  assert.equal(replyText(four, false).split('\n')[1], '1. B, $1K. 1 from your record, 0 from the repo, 4 need you: your phone, your birthday, where you are based and 1 more.');
  const zero = base({ linked: true, ready: [ready({ title: 'C', total: 4 })] });
  assert.equal(replyText(zero, false).split('\n')[1], '1. C, $1K. Your agent drafts all 4 answers.');
  // Unlinked: the repo's count only, whatever the record counts say.
  const unlinked = base({ ready: [ready({ title: 'Z Fellows', money: '$10K', from_record: 3, facts_from_repo: 2, repo_required: 2, total: 6, need_you: ['x'] })] });
  assert.equal(replyText(unlinked, false).split('\n')[1], '1. Z Fellows, $10K. Drafted: 2 of 6 answers from the repo, the rest by your agent.');
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
  evidence_summary: { tier: 'live', line: 'Your project is live, with no verified usage yet. Next: 25 funded wallets on mainnet in 90 days; you have 4.' },
});

test('the "Before applying" paragraph groups the sign-ins, names the clicks and the first three missing; "Before tonight" only when the agent sends tonight (R5b)', () => {
  const text = replyText(LINKED, false);
  const before = text.split('\n\n').find((b) => b.startsWith('Before applying: '))!;
  assert.equal(
    before,
    "Before applying: you sign in to Google on your agent's computer for Base Builder Grant and Google Two; you sign in to Avalanche Builder Hub for Avalanche Team1; you sign in by email and press submit yourself on Click Grant. Still missing for these programs: your founder video link, an approved answer on the problem, your deck link and 1 more.",
  );
  const blocks = text.split('\n\n');
  assert.deepEqual(blocks.slice(-4), [
    before,
    'Applied under your standing approval: Alliance ALL19, Arc Builders Fund.',
    'Your project is live, with no verified usage yet. Next: 25 funded wallets on mainnet in 90 days; you have 4.',
    'Say yes and I apply to all 4. Or say the numbers to skip.',
  ]);
  assert.doesNotMatch(text.replace(/Click Grant/g, ''), /click/i);
  assert.doesNotMatch(text, /Before tonight/);
  // Standing approval with nothing an agent can send alone (every program blocked): nothing goes tonight.
  assert.match(replyText({ ...LINKED, auto_apply: true, max_per_night: 5 }, false), /\n\nBefore applying: you sign in to Google/);
  // Standing approval and one program free to send: the agent applies tonight.
  const free = base({ ...LINKED, ready: [...LINKED.ready, ready({ program_id: 'f1', title: 'Free', from_record: 1, total: 1 })], auto_apply: true, max_per_night: 5 });
  const tonight = replyText(free, false);
  // N4 (v6.1.9): tonight waits on none of the builder's steps; they would add more.
  assert.ok(tonight.split('\n\n').includes(
    "Tonight's send goes ahead. These would add 4 more: you sign in to Google on your agent's computer for Base Builder Grant and Google Two; you sign in to Avalanche Builder Hub for Avalanche Team1; you sign in by email and press submit yourself on Click Grant. Still missing for these programs: your founder video link, an approved answer on the problem, your deck link and 1 more.",
  ), tonight);
  assert.doesNotMatch(tonight, /Before tonight|nothing is sent until/);
  assert.match(tonight, /\n\nApplying tonight to Free\. Say stop to hold any\.$/);
  // N1 (v6.1.9): the sends already made in the last 24 hours leave less room; none left, no tonight list.
  const two = base({ ...free, ready: [...free.ready, ready({ program_id: 'f2', title: 'Free Two', from_record: 1, total: 1 })], max_per_night: 2 });
  assert.match(replyText({ ...two, auto_sent_today: 0 }, false), /\n\nApplying tonight to Free and Free Two\. Say stop to hold any\.$/);
  assert.match(replyText({ ...two, auto_sent_today: 1 }, false), /\n\nApplying tonight to Free\. Say stop to hold any\.$/);
  const used = replyText({ ...two, auto_sent_today: 2 }, false);
  assert.equal(used.split('\n\n').at(-1), "Tonight's limit is used; the next sends wait until tomorrow. Say yes and I apply to all 6. Or say the numbers to skip.");
  assert.doesNotMatch(used, /Applying tonight|Tonight's send/);
  assert.match(used, /\n\nBefore applying: you sign in to Google/);
  assert.ok(agentNote({ ...two, auto_sent_today: 2 }, { more: 0 }).includes("Tonight's limit is used: send nothing alone until 24 hours after the last send under standing approval."));
  // An outside-approval program reads as a step that would add one more.
  const out = base({ ...free, record_missing: [], blockers: [{ program_id: 'av', sign_in: null, needs_click: false, needs: [], outside_approval: true }] });
  assert.ok(replyText(out, false).split('\n\n').includes("Tonight's sends go ahead. These would add 1 more: you say yes yourself to Avalanche Team1."));
  const note = agentNote(LINKED, { more: 0 });
  assert.ok(note.includes('Fit approved answers by cutting, never by adding; the style contract travels on each field.'));
  // The Before block names the sign-ins and the submits; the note does not repeat them, nor the submit rule (v6.1.8).
  assert.ok(!note.includes('blockers; name them once'));
  assert.ok(!note.includes('Submit only'));
  assert.ok(note.includes('Ask for the missing record items once, all together, and save each with record.'));
  assert.ok(!note.includes('Standing approval is on'));
  assert.ok(!agentNote(MONDAY, { more: 0 }).includes('Fit approved answers'));
});

test('standing approval: the closing line counts what an agent can send alone, and the agent note', () => {
  const free = (id: string) => ready({ program_id: id, title: id.toUpperCase(), from_record: 1, total: 1 });
  const r = base({
    ...LINKED,
    ready: [...LINKED.ready, free('f1'), free('f2'), free('f3'), ready({ program_id: 'held', title: 'Held', claimed_since: '2026-11-04T10:00:00.000Z' })],
    auto_apply: true,
    max_per_night: 2,
  });
  // Four have a sign-in or a click, one is claimed: three are free, capped at two.
  assert.match(replyText(r, false), /\n\nApplying tonight to F1 and F2\. Say stop to hold any\.$/);
  assert.doesNotMatch(replyText(r, false), /Say yes/);
  assert.match(replyText({ ...r, max_per_night: 9 }, false), /Applying tonight to F1, F2 and F3\. Say stop to hold any\.$/);
  // Nothing an agent can send alone: the usual closing.
  assert.match(replyText({ ...LINKED, auto_apply: true, max_per_night: 5 }, false), /Say yes and I apply to all 4\. Or say the numbers to skip\.$/);
  const note = agentNote(r, { more: 0 });
  assert.ok(note.includes(
    'Standing approval is on: for each ready program within the limits, call track started, fill from fields, submit where the program allows an agent, then track applied with submitted_by agent and fields_used (the field keys). Stop at max_per_night. Never submit where blockers say needs_click, outside_approval or a sign-in you do not have.',
  ));
  assert.ok(!note.includes('Submit only'));
  assert.ok(note.includes("Draft each ready program from its fields: 'record' and 'earnkit' values as given, except a field marked fit 'cut', which you cut to its max_chars as its fit_note says;"));
  // The submit rule lives in the server instructions only (v6.1.8).
  assert.ok(!agentNote(LINKED, { more: 0 }).includes('Submit only'));
  assert.ok(agentNote(MONDAY, { more: 0 }).includes("Draft each ready program from its fields: 'earnkit' values as given;"));
});

test('unlinked with a sign-in link: saying yes is the one action, the sign-in its second sentence (R5a); linked never shows it', () => {
  const link = 'https://earnkit.test/link/abcdefghijklmnop';
  const text = replyText({ ...MONDAY, sign_in: link }, false);
  const blocks = text.split('\n\n');
  assert.equal(
    blocks.at(-1),
    `Say yes and I apply to all 2. Or say the numbers to skip. Sign in once at ${link} and I read your repo for proof and remember you.`,
  );
  assert.equal(blocks.at(-2), 'Ledger: 1 applied, 0 won, 1 pending.');
  assert.equal(text.match(/Sign in once at/g)!.length, 1);
  // Without a link the closing line stays alone.
  assert.match(replyText(MONDAY, false), /\n\nSay yes and I apply to all 2\. Or say the numbers to skip\.$/);
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
  'A "Their rule" gap is a program rule EarnKit cannot check. If the builder says it fits, call track gap_done with that gap\'s item, then find again. Their yes stands: when the program comes back ready, draft and submit it without asking again.';
const ruleGap = (what: string, item = 'rule:0000000a') => ({ kind: 'rule' as const, item, what, effort: 'hours' as const, agent_can: false });
const VIDEO = { kind: 'demo_video' as const, item: 'demo_video', what: 'a demo video', effort: 'hours' as const, agent_can: false };

test('rules (R18a): ready and in-person lines show none; a gap line shows its rules after the change; a rule-only line asks its own "yes n" (v6.1.8, 1a)', () => {
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
      'Ready to apply (1):',
      '1. Base Ecosystem Fund, pre-seed and seed investment. Long odds: an investment program with no stated amount. Your agent drafts all 2 answers. First: sign in to the portal.',
      '',
      'One step away (2):',
      '2. Goose Grants, $10K. Their rule: a project built with or for goose. Their rule: work not already funded by an employer or client. Say "yes 2" if that is you.',
      '3. Colosseum, $25K: a demo video. Their rule: the team has not raised venture capital.',
      '',
      'In person (1):',
      '4. Meetup, $5K. First: be in Lisbon.',
      '',
      'Say yes and I apply.',
    ].join('\n'),
  );
  // One "yes n" per reply: on its line while something is ready, never repeated in the closing.
  assert.equal(replyText(r, true).match(/"yes 2"/g)?.length, 1);
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
  assert.equal(nothingReady.split('\n').at(-1), 'Nothing is ready yet. Say "yes 1" if that rule fits you.');
  // Said once: the line the closing names does not ask it again.
  assert.equal(nothingReady.match(/"yes 1"/g)?.length, 1, nothingReady);
  assert.equal(end(base({ ready: MONDAY.ready, gaps: [rulesOnly] })), 'Say yes and I apply to all 2. Or say the numbers to skip.');
  assert.match(replyText(base({ ready: MONDAY.ready, gaps: [rulesOnly] }), true), /^3\. R, \$1K\. Their rule: x\. Say "yes 3" if that is you\.$/m);
  assert.equal(end(base({ gaps: [rulesOnly, MONDAY.gaps[0]] })), 'Nothing is ready yet. Say "yes 1" if that rule fits you.');
  // M1 (v6.1.9): with no rule-only program shown, the closing offers the first step.
  assert.equal(end(base({ gaps: [MONDAY.gaps[0]] })), 'Nothing is ready yet. First: deploy the contract on Arc. Tell me when it is done and I look again.');
  // C44: the builder presses submit on every ready one, so the agent drafts.
  const clicks = MONDAY.ready.map((p) => ({ program_id: p.program_id, sign_in: null, needs_click: true, needs: [] }));
  assert.equal(end({ ...MONDAY, blockers: clicks }), 'Say yes and I draft all 2 for you to send. Or say the numbers to skip.');
  assert.equal(end(base({ ready: [MONDAY.ready[0]], blockers: [clicks[0]] })), 'Say yes and I draft it for you to send.');
  assert.equal(end({ ...MONDAY, blockers: [clicks[0]] }), 'Say yes and I apply to all 2. Or say the numbers to skip.');
  assert.doesNotMatch(agentNote(base({ gaps: [rulesOnly] }), { more: 0 }), /On "do <n>"/);
  assert.ok(agentNote(base({ gaps: [rulesOnly] }), { more: 0 }).includes(RULE_NOTE));
});

test('R18d, O2 (v6.1.10, Review Focus 5): an in-person gap line says what attending takes, after its rules; a rule-only one is in the In person block with its yes', () => {
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
      'One step away (1):',
      '1. Camp, $10K: a demo video. Their rule: a team of two. First: work 3 months from the office.',
      '',
      'In person (1):',
      '2. Residency, $500K. Their rule: a co-founder with US work authorization. First: work 3 months from the office. Say "yes 2" if that is you.',
      '',
      'Nothing remote is ready yet. Say yes and I start the in-person applications.',
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
      'One step away (2):',
      '1. FLOSS/fund, $10,000 to $100,000: tell me if real people use it.',
      '2. OTF, $900K. Their rule: advances internet freedom.',
      '',
      'In person (2):',
      '3. Y Combinator, $500K investment. Needs a YC account.',
      '4. Antler, $250K. Their rule: a co-founder with US work authorization. Attend in person. Say "yes 4" if that is you.',
      '',
      // Fix round 1: remote steps shown, so the closing uses the first remote one (here its rule-only yes).
      'Nothing is ready yet. Say "yes 2" if that rule fits you.',
    ].join('\n'),
  );
  // In person alone, or rule-only in person alone: the in-person closing.
  assert.equal(replyText(base({ ready: [yc] }), true).split('\n').at(-1), 'Nothing remote is ready yet. Say yes and I start the in-person applications.');
  assert.equal(replyText(base({ gaps: [antler] }), true).split('\n').at(-1), 'Nothing remote is ready yet. Say yes and I start the in-person applications.');
  // A remote step shown: its step closes the reply, in-person programs listed or not.
  assert.equal(replyText(base({ gaps: [floss] }), true).split('\n').at(-1), 'Nothing is ready yet. Do real people use it? Say yes and I apply.');
  assert.equal(replyText(base({ ready: [yc], gaps: [floss] }), true).split('\n').at(-1), 'Nothing is ready yet. Do real people use it? Say yes and I apply.');
  assert.equal(replyText(base({ ready: [yc], gaps: [gap({ title: 'Circle' })] }), true).split('\n').at(-1), 'Nothing is ready yet. First: deploy the contract on Arc. Tell me when it is done and I look again.');
  // A remote step that names its own action ("do n") and in-person programs: never the bare line.
  const codes = gap({ title: 'Base Batches', gap: { kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes', agent_can: true } });
  assert.equal(replyText(base({ gaps: [codes] }), true).split('\n').at(-1), 'Nothing is ready yet.');
  assert.equal(replyText(base({ ready: [yc], gaps: [codes] }), true).split('\n').at(-1), 'Nothing remote is ready yet. Say yes and I start the in-person applications.');
  // Something remote ready: its yes, never the in-person closing.
  assert.equal(replyText(base({ ready: [ready({ title: 'Grant' }), yc], gaps: [antler] }), true).split('\n').at(-1), 'Say yes and I apply.');
  assert.match(agentNote(r, { more: 0 }), /closes on starting the in-person applications/);
});

test('O1 (v6.1.10): a step closing within 7 days says so after its money', () => {
  const paypal = gap({ title: 'PayPal AI Hackathon', money: '$67,500 in prizes', closes_in: 'in 2 days', gap: VIDEO, also: [ruleGap('uses a PayPal API')] });
  assert.equal(replyText(base({ gaps: [paypal] }), true).split('\n')[1], '1. PayPal AI Hackathon, $67,500 in prizes, closes in 2 days: a demo video. Their rule: uses a PayPal API.');
  const rule = gap({ title: 'Kiroween', money: '$100K', closes_in: 'in 5 days', gap: ruleGap('built with Kiro') });
  assert.equal(replyText(base({ gaps: [paypal, rule] }), true).split('\n')[2], '2. Kiroween, $100K, closes in 5 days. Their rule: built with Kiro.');
});

test('R20/R21: an in-person line says its odds, then what attending takes, then what it needs from you (v6.1.6)', () => {
  const yc = ready({
    title: 'Y Combinator Winter 2027 Batch', money: '$500K investment', in_person: true, long_shot: 'many apply, few are taken',
    setup: ['a YC account'], needs: ['a YC account', 'your application answers', 'the batch you want'],
  });
  const alliance = ready({
    title: 'Alliance ALL19', money: '$400K at admission', closes_in: 'in 14 days', in_person: true,
    setup: ["start the application with the first founder's email", 'your passport'], needs: ["start the application with the first founder's email", 'your passport'],
  });
  const bare = ready({ title: 'Bare Summit', money: '$5K', in_person: true });
  const text = replyText(base({ ready: [yc, alliance, bare] }), true);
  assert.equal(
    text.split('\n\n')[0],
    [
      'In person (3):',
      '1. Y Combinator Winter 2027 Batch, $500K investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and the batch you want.',
      "2. Alliance ALL19, $400K at admission, closes in 14 days. First: start the application with the first founder's email; your passport.",
      '3. Bare Summit, $5K. Attend in person.',
    ].join('\n'),
  );
});

test('R21: an in-person gap with no setup reads "Attend in person." after its rules (v6.1.6)', () => {
  const g = gap({ title: 'Residency', money: '$1M', in_person: true, gap: ruleGap('a US co-founder'), rules: ['a US co-founder'] });
  assert.equal(
    replyText(base({ gaps: [g] }), true).split('\n')[1],
    '1. Residency, $1M. Their rule: a US co-founder. Attend in person. Say "yes 1" if that is you.',
  );
  const withSetup = { ...g, setup: ['the right to work in the US'] };
  assert.equal(
    replyText(base({ gaps: [withSetup] }), true).split('\n')[1],
    '1. Residency, $1M. Their rule: a US co-founder. Needs the right to work in the US. Say "yes 1" if that is you.',
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
  const before = replyText(r, true).split('\n\n').find((b) => b.startsWith('Before applying: '));
  assert.equal(before, 'Before applying: you sign in by email and press submit yourself on Click Grant.');
  // C46: an in-person program is never in the outside-approval list.
  const outside = base({ ...r, blockers: r.blockers.map((b) => ({ ...b, needs_click: false, outside_approval: true as const })) });
  assert.equal(
    replyText(outside, true).split('\n\n').find((b) => b.startsWith('Before applying: ')),
    'Before applying: you sign in by email for Click Grant. Outside your standing approval, you say yes yourself: Click Grant.',
  );
  const onlyYc = base({ ready: r.ready.filter((p) => p.in_person), blockers: [r.blockers[0]] });
  assert.ok(!replyText(onlyYc, true).includes('Before applying'), replyText(onlyYc, true));
});

test('R19: with no repo read the sign-in sentence only promises to remember (v6.1.6)', () => {
  const link = 'https://earnkit.test/link/abcdefghijklmnop';
  const text = replyText({ ...MONDAY, sign_in: link, as_reported: true }, false);
  assert.ok(text.endsWith(` Sign in once at ${link} and I remember you across agents.`), text);
  assert.doesNotMatch(text, /read your repo/);
});

test('R26: the left-out count says what was left out (v6.1.6)', () => {
  assert.ok(agentNote(MONDAY, { more: 4 }).split('\n').includes('4 more left out: ready past the cap, gaps and in-person programs. Ask with filter.all for the full list.'));
});

test('a linked notice is the last sentence of the closing block', () => {
  const notice = 'This agent is now linked to GitHub account ada. Unlink any time at earnkit.com/me.';
  assert.equal(replyText(base({ linked: true, linked_notice: notice }), false), `Nothing fits yet. I'll say when something opens. ${notice}`);
  assert.ok(!replyText(base({ linked: true }), false).includes('now linked'));
});

test('a program another agent of the builder holds says so on its line and leaves the count to say yes to (v6.1.7, C37)', () => {
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
  assert.ok(lines.includes('Ready to apply (4):'), text);
  assert.ok(lines.some((l) => /^2\. Held One, \$1K\. .* Being handled by your other agent since 10:00 UTC\.$/.test(l)), text);
  assert.ok(lines.some((l) => /^4\. Held Two, \$1K\. .* Being handled by your other agent since Nov 3, 22:10 UTC\.$/.test(l)), text);
  assert.ok(!/^1\. Free One.*Being handled/m.test(text), text);
  assert.match(text, /\n\nSay yes and I apply to all 2\. Or say the numbers to skip\.$/);
  // One free: the singular; none free: no yes at all, and nothing claims "nothing fits".
  const one = base({ linked: true, ready: [ready({ title: 'Free One' }), ready({ title: 'Held One', claimed_since: '2026-11-04T10:00:00.000Z' })] });
  assert.match(replyText(one, false, NOW), /\n\nSay yes and I apply\.$/);
  const none = base({ linked: true, ready: [ready({ title: 'Held One', claimed_since: '2026-11-04T10:00:00.000Z' })] });
  const t = replyText(none, false, NOW);
  assert.doesNotMatch(t, /Say yes|Nothing fits/);
  assert.match(t, /\n\nYour other agent is handling these; I'll say when something new opens\.$/);
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
  assert.match(t, /^Ready to apply \(1\):/m, t);
  assert.match(t, /^One step away \(1\):/m, t);
  assert.doesNotMatch(t, /Nothing is ready yet/, t);
  assert.match(t, /\n\nYour other agent is handling these; I'll say when something new opens\.$/, t);
  // The closing names no rule, so the rule's own line keeps its "yes n".
  assert.match(t, /^2\. Rule Grant, \$1K\. Their rule: a public good\. Say "yes 2" if that is you\.$/m, t);
});

test('the one-program reply (v6.1.8, 1b): the gap line without its number or "do n", and one action by what the gap is', () => {
  const BC = { kind: 'builder_codes' as const, item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'hours' as const, agent_can: true };
  const USERS = { kind: 'users' as const, item: 'users', what: 'tell me if real people use it', effort: 'hours' as const, agent_can: false };
  const codes = gap({ title: 'Base Grant', n: 3, gap: BC });
  assert.equal(gapLine(codes, null, true), 'Base Grant, $1K: add Base Builder Codes to the app.');
  assert.equal(gapLine(codes), '3. Base Grant, $1K: add Base Builder Codes to the app. Say "do 3" and I add them.');
  assert.equal(gapAction(codes), 'Say "do" and I add Base Builder Codes to the app first.');
  assert.equal(gapAction(gap({ title: 'Two', gap: BC, also: [{ ...BC, kind: 'integration', item: 'integration:x', what: 'add X' }] })), 'Say "do" and I make both changes first.');
  // A contract deploy is the builder's (keys and gas).
  assert.equal(gapAction(gap({ title: 'Arc Grant' })), 'Tell me when that is done and I apply.');
  assert.equal(gapAction(gap({ title: 'Video', gap: VIDEO, also: [ruleGap('a team')] })), 'Tell me when that is done and I apply.');
  assert.equal(gapAction(gap({ title: 'Used', gap: USERS })), 'Say yes if they do and I draft it.');
  const rule = gap({ title: 'Fund', n: 2, gap: ruleGap('a seed stage startup') });
  assert.equal(gapLine(rule, null, true), 'Fund, $1K. Their rule: a seed stage startup.');
  assert.equal(gapAction(rule), 'Say yes if that is you and I draft it.');
  // In person: the line says to attend; no action line.
  const attend = gap({ title: 'Residency', in_person: true, gap: ruleGap('a US co-founder') });
  assert.equal(gapLine(attend, null, true), 'Residency, $1K. Their rule: a US co-founder. Attend in person.');
  assert.equal(gapAction(attend), null);
  assert.equal(notFitLine('Base Grant', '$1K', 'needs a contract on Base'), 'Base Grant, $1K. Not a fit: needs a contract on Base.');
});

test('M1 (v6.1.9): nothing ready and no rule-only program shown: the closing offers the first step, the users question as a yes', () => {
  const end = (r: R) => replyText(r, true).split('\n').at(-1);
  const USERS = { kind: 'users' as const, item: 'users', what: 'tell me if real people use it', effort: 'hours' as const, agent_can: false };
  const floss = gap({ title: 'FLOSS/fund', gap: USERS });
  assert.equal(end(base({ gaps: [floss] })), 'Nothing is ready yet. Do real people use it? Say yes and I apply.');
  // A demo video (with a rule beside it) first: tell me when it is done.
  const vr = gap({ title: 'Meta VR', gap: VIDEO, also: [ruleGap('hands first')], rules: ['hands first'] });
  assert.equal(end(base({ gaps: [vr, floss] })), 'Nothing is ready yet. First: a demo video. Tell me when it is done and I look again.');
  // I2 (v6.1.9 final): the only step program shown carries a rule: the rule is asked first, once.
  const vrAlone = replyText(base({ gaps: [vr] }), true);
  assert.equal(vrAlone.split('\n').at(-1), 'Nothing is ready yet. Say "yes 1" if its rule fits you.');
  assert.equal(vrAlone.match(/"yes 1"/g)?.length, 1, vrAlone);
  assert.equal(stepRuleOf([{ ...vr, n: 3 }]), 3);
  assert.equal(stepRuleOf([vr, floss]), null);
  assert.equal(stepRuleOf([floss]), null);
  assert.equal(stepRuleOf([{ ...vr, in_person: true }]), null);
  // Something ready keeps the yes to apply.
  assert.equal(end(base({ ready: [MONDAY.ready[0]], gaps: [vr] })), 'Say yes and I apply.');
  // A program EarnKit makes ("do n" on its line) or a sign-in step is passed over for the next program's step.
  const codes = gap({ title: 'Base Batches', gap: { kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes', agent_can: true } });
  const signIn = gap({ title: 'Live Grant', gap: { kind: 'tier', item: 'tier:live', what: 'Sign in once so EarnKit can confirm your product is live', effort: 'weeks', agent_can: false } });
  assert.equal(end(base({ gaps: [codes, signIn, floss] })), 'Nothing is ready yet. Do real people use it? Say yes and I apply.');
  assert.equal(end(base({ gaps: [codes, signIn] })), 'Nothing is ready yet.');
  // A rule-only program shown keeps its "yes n"; something ready keeps the yes to apply.
  const rule = gap({ title: 'R', gap: ruleGap('x'), rules: ['x'] });
  assert.equal(end(base({ gaps: [floss, rule] })), 'Nothing is ready yet. Say "yes 2" if that rule fits you.');
  assert.equal(end(base({ ready: [MONDAY.ready[0]], gaps: [floss] })), 'Say yes and I apply.');
  for (const t of [end(base({ gaps: [floss] })), end(base({ gaps: [vr] }))]) assert.doesNotMatch(t!, /—|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
});

test('v6.1.9: after the builder\'s yes on a rule, the program it made ready is applied to without a second yes', () => {
  const one = base({ ready: [ready({ title: 'Solana Foundation Grants', rule_yes: true, rules: ['a public good'] })] });
  assert.equal(replyText(one, true).split('\n\n').at(-1), 'Your yes stands for Solana Foundation Grants: I apply now.');
  const two = base({ ready: [ready({ title: 'Solana Foundation Grants', rule_yes: true }), ready({ title: 'Other Grant' })] });
  assert.equal(replyText(two, true).split('\n\n').at(-1), 'Your yes stands for Solana Foundation Grants: I apply now. Say yes and I apply.');
  // The builder presses submit on it: no "I apply now".
  const click = base({ ready: [ready({ title: 'Click Grant', rule_yes: true })], blockers: [{ program_id: 'click-grant', sign_in: null, needs_click: true, needs: [] }] });
  assert.equal(replyText(click, true).split('\n\n').at(-1), 'Say yes and I draft it for you to send.');
  // A sign-in the agent does not have: no "I apply now" either (final review M2).
  const signIn = base({ ready: [ready({ title: 'Mail Grant', rule_yes: true })], blockers: [{ program_id: 'mail-grant', sign_in: 'email', needs_click: false, needs: [] }] });
  assert.doesNotMatch(replyText(signIn, true), /I apply now/);
});

test('v6.1.9: the standing note asks for every required answer; record_missing is told apart from record get', () => {
  const note = agentNote(base({ auto_apply: true, linked: true, record_missing: ['your email'] }), { more: 0 });
  assert.ok(note.includes('Under standing approval, send only when every required answer is filled; otherwise wait for the builder.'));
  assert.ok(note.includes('record_missing names only what these programs need; record get names everything the record lacks.'));
  assert.match(replyText(base({ linked: true, record_missing: ['your email'], ready: [ready({ title: 'A' })] }), true), /Before applying: Still missing for these programs: your email\./);
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
  const blocks = replyText(r, true).split('\n\n');
  assert.equal(blocks.at(-1), 'Applying tonight to Full Grant. Say stop to hold any.');
  assert.ok(blocks.includes('Before tonight (nothing is sent until these are in): your problem for Short Grant.'), blocks.join('\n\n'));
  // Nothing can go tonight: no tonight line, the wait is named, and the builder can still say yes.
  const none = base({ auto_apply: true, max_per_night: 5, auto_sent_today: 0, linked: true, ready: [ready({ title: 'Short Grant', needs: ['the problem'] })] });
  const show = replyText(none, true);
  assert.doesNotMatch(show, /Applying tonight|Tonight's send/);
  assert.match(show, /Before tonight \(nothing is sent until these are in\): your problem for Short Grant\.\n\nSay yes and I apply\.$/);
});

test('fix round 1 (v6.1.9): a contract the read still does not find tells the agent to pass its address', () => {
  const g = gap({ title: 'Arc Fund', gap: { kind: 'chain', item: 'chain:arc', what: 'deploy the contract on Arc', effort: 'hours', agent_can: false }, looked_again: ['the contract on Arc'] });
  assert.ok(agentNote(base({ gaps: [g] }), { more: 0 }).split('\n').includes('Pass the contract address if it is on chain.'));
  assert.ok(!agentNote(base({ gaps: [gap({ title: 'Arc Fund' })] }), { more: 0 }).includes('Pass the contract address'));
});
