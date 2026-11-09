import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentNote, numbered, replyText } from './reply';
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
  n: 0,
  ...over,
});
const LEDGER0: Ledger = { applied: 0, asked_usd: 0, won: 0, won_usd: 0, pending: 0, rejected: 0, skipped: 0, closing_soon: [] };
const NO_SINCE = { from: null, new: [], changed: [], closing: [] };
/** A reply with its lists numbered as find numbers them. */
const base = (over: Partial<R> = {}): R => {
  const r: R = {
    since: NO_SINCE, ready: [], gaps: [], ledger: LEDGER0, ask_outcome: [], as_reported: false,
    linked: false, record_missing: [], blockers: [], evidence_summary: null, applied_overnight: [], released: [], auto_apply: false,
    ...over,
  };
  return { ...r, ...numbered(r.ready, r.gaps) };
};

const MONDAY = base({
  ready: [
    ready({
      title: 'Alliance ALL19', money: '$400K at admission', closes_in: 'in 14 days', filled: 3, facts_from_repo: 2, total: 9,
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
      'Ready to apply, 2:',
      "1. Alliance ALL19, $400K at admission, closes in 14 days. Drafted: 2 of 9 answers from the repo, the rest your agent asks you once. Needs your first founder's email.",
      '2. Arc Builders Fund, investment from Circle Ventures, a long shot: an investment program with no stated amount. Your agent fills all 5 answers on the page.',
      '',
      'One change away, 1:',
      '3. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc.',
      '',
      'Ledger: 1 applied ($5K asked), 0 won, 1 pending.',
      '',
      'Say yes to apply to all 2, numbers to skip, or "do 3" and I\'ll make the change first.',
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
    ready: [ready({ program_id: 'd', title: 'Alliance ALL19', money: '$400K at admission', closes_in: 'in 3 days', filled: 1, facts_from_repo: 1, total: 4 })],
    ledger: { ...LEDGER0, applied: 2, asked_usd: 115000, won: 1, pending: 1, closing_soon: [{ program_id: 'x', title: 'X', closes_at: '' }] },
  });
  assert.equal(
    replyText(r, false),
    [
      'Since Nov 2: 2 new programs you fit; Circle Developer Grants: deadline moved to Nov 20; Alliance ALL19 closes in 3 days.',
      '',
      'Ready to apply, 1:',
      "1. Alliance ALL19, $400K at admission, closes in 3 days. Drafted: 1 of 4 answers from the repo, the rest your agent asks you once.",
      '',
      'Ledger: 2 applied ($115K asked), 1 won, 1 pending, 1 closing soon.',
      '',
      'Say yes to apply, or skip it.',
    ].join('\n'),
  );
  assert.ok(!replyText(r, true).includes('Since'));
});

test('gaps only, the agent can do it, and the needs list is cut at three', () => {
  const r = base({
    gaps: [gap({ title: 'Base Batches', money: '$100K', gap: { kind: 'builder_codes', item: 'builder_codes', what: 'add Base Builder Codes to the app', effort: 'minutes', agent_can: true } })],
  });
  assert.equal(
    replyText(r, false),
    ['One change away, 1:', '1. Base Batches, $100K: add Base Builder Codes to the app (I can do this).', '', 'Say "do 1" and I\'ll make the change first.'].join('\n'),
  );
  const two = base({ gaps: [gap({ title: 'G', money: '$1K', also: [{ kind: 'live_product', item: 'live_product', what: 'put a live link up', effort: 'hours', agent_can: false }] })] });
  assert.match(replyText(two, false), /^1\. G, \$1K: deploy the contract on Arc and put a live link up\.$/m);
  const many = base({ ready: [ready({ title: 'B', needs: ['your full name', 'your email', 'a Loom product demo', 'your X handle', 'an investor deck file'] })] });
  assert.match(replyText(many, false), /Needs your full name, email, Loom product demo and 2 more\.$/m);
  const setup = base({ ready: [ready({ title: 'S', setup: ['sign in to the Builder Hub'], needs: ['sign in to the Builder Hub', 'a Loom product demo'] })] });
  assert.match(replyText(setup, false), /^1\. S, \$1K\. Your agent fills the one answer on the page\. Needs your Loom product demo\. First: sign in to the Builder Hub\.$/m);
});

test('one ready program: no "all 1"', () => {
  const one = base({ ready: [MONDAY.ready[0]] });
  assert.match(replyText(one, false), /\n\nSay yes to apply, or skip it\.$/);
  const withGap = base({ ready: [MONDAY.ready[0]], gaps: MONDAY.gaps });
  assert.match(replyText(withGap, false), /\n\nSay yes to apply, skip it, or "do 2" and I'll make the change first\.$/);
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
      'Ready to apply, 2:',
      "1. Alliance ALL19, $400K at admission, closes in 14 days. Drafted: 2 of 9 answers from the repo, the rest your agent asks you once. Needs your first founder's email.",
      '2. Arc Builders Fund, investment from Circle Ventures, a long shot: an investment program with no stated amount. Your agent fills all 5 answers on the page.',
      '',
      'One change away, 1:',
      '3. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc.',
      '',
      'In person, apply to attend first:',
      '4. ETHGlobal Mumbai, up to $15K per partner prize, closes in 2 days. Apply to attend by Nov 3 and get accepted; stake a small amount of ETH; be in Mumbai Nov 5 to 7.',
      '',
      'Say yes to apply to all 2, numbers to skip, or "do 3" and I\'ll make the change first.',
    ].join('\n'),
  );
  const only = replyText(base({ ready: [mumbai] }), false);
  assert.ok(only.startsWith('In person, apply to attend first:\n1. ETHGlobal Mumbai'), only);
  assert.doesNotMatch(only, /Say yes to apply/);
  assert.match(agentNote(r, { more: 0 }), /In-person programs .* draft nothing for one until the builder says yes to attending it/);
  assert.doesNotMatch(agentNote(MONDAY, { more: 0 }), /In-person/);
});

test('a ledger of investments only names no asked amount', () => {
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
  for (const s of ["'earnkit'", "'agent'", "'builder'", 'sources', 'yes', 'own browser', 'track', 'applied', 'Zeta Grant', '2 more fit; ask with filter.all for the full list.'])
    assert.ok(n.includes(s), s);
  assert.ok(!agentNote(MONDAY, { more: 0 }).includes('more fit'));
  assert.ok(n.includes('Pass users and live_url in the project whenever you know them; never invent them.'));
});

test('repo reads paused: its own agent line, never "send them corrected"', () => {
  const paused = agentNote(base({ problems: ['repo reads paused until tomorrow'] }), { more: 0 });
  assert.ok(paused.includes('Repo reads are paused for this installation until tomorrow; the match used what you reported.'));
  assert.ok(!paused.includes('Send them corrected'));
  const both = agentNote(base({ problems: ['live_url dropped: not a web link', 'repo reads paused until tomorrow'] }), { more: 0 });
  assert.ok(both.includes('Some project facts were dropped: live_url dropped: not a web link. Send them corrected next time.'));
});

test('a reported-only program with passed links reads "Your agent fills the one answer on the page."', () => {
  assert.match(replyText(base({ ready: [ready({ title: 'R', filled: 3, facts_from_repo: 0 })] }), false), /^1\. R, \$1K\. Your agent fills the one answer on the page\.$/m);
});

test('the ready line is honest about the answers: n of total, never above total, or all of them by the agent', () => {
  const line = (over: Partial<ReadyProgram>) => replyText(base({ ready: [ready({ title: 'Z Fellows', money: '$10K', ...over })] }), false).split('\n')[1];
  assert.equal(line({ facts_from_repo: 2, total: 23 }), "1. Z Fellows, $10K. Drafted: 2 of 23 answers from the repo, the rest your agent asks you once.");
  assert.equal(line({ facts_from_repo: 6, total: 4 }), "1. Z Fellows, $10K. Drafted: 4 of 4 answers from the repo, the rest your agent asks you once.");
  assert.equal(line({ facts_from_repo: 0, total: 23 }), '1. Z Fellows, $10K. Your agent fills all 23 answers on the page.');
});

test('one required answer reads in the singular', () => {
  const line = (facts_from_repo: number) => replyText(base({ ready: [ready({ title: 'One', money: '$1K', facts_from_repo, total: 1 })] }), false).split('\n')[1];
  assert.equal(line(1), '1. One, $1K. Drafted: the one answer from the repo.');
  assert.equal(line(0), '1. One, $1K. Your agent fills the one answer on the page.');
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
  assert.equal(replyText(zero, false).split('\n')[1], '1. C, $1K. Your agent fills all 4 answers on the page.');
  // Unlinked: v5's words, whatever the counts say.
  const unlinked = base({ ready: [ready({ title: 'Z Fellows', money: '$10K', from_record: 3, facts_from_repo: 2, total: 6, need_you: ['x'] })] });
  assert.equal(replyText(unlinked, false).split('\n')[1], "1. Z Fellows, $10K. Drafted: 2 of 6 answers from the repo, the rest your agent asks you once.");
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
  evidence_summary: { tier: 'live', line: 'Your project reads as live, no verified usage yet. Next: 25 funded wallets on mainnet in 90 days; you have 4.' },
});

test('the "Before tonight" paragraph groups the sign-ins, names the clicks and the first three missing', () => {
  const text = replyText(LINKED, false);
  const before = text.split('\n\n').find((b) => b.startsWith('Before tonight: '))!;
  assert.equal(
    before,
    "Before tonight: Sign in once to Google on your agent's computer for 2 of them. Sign in once to Avalanche Builder Hub for 1 of them. Sign in once by email for 1 of them. Needs your click: Click Grant. Still missing from your record: your founder video link, an approved answer on the problem, your deck link and 1 more.",
  );
  const blocks = text.split('\n\n');
  assert.deepEqual(blocks.slice(-4), [
    before,
    'Applied under your standing approval: Alliance ALL19, Arc Builders Fund.',
    'Your project reads as live, no verified usage yet. Next: 25 funded wallets on mainnet in 90 days; you have 4.',
    'Say yes to apply to all 4, or numbers to skip.',
  ]);
  const note = agentNote(LINKED, { more: 0 });
  assert.ok(note.includes('Fit approved answers by cutting, never by adding; the style contract travels on each field.'));
  assert.ok(note.includes('Sign-ins and clicks the builder must do are in blockers; name them once, together.'));
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
  assert.match(replyText(r, false), /\n\nApplying tonight to 2; say stop to hold any\.$/);
  assert.doesNotMatch(replyText(r, false), /Say yes/);
  assert.match(replyText({ ...r, max_per_night: 9 }, false), /Applying tonight to 3; say stop to hold any\.$/);
  // Nothing an agent can send alone: the usual closing.
  assert.match(replyText({ ...LINKED, auto_apply: true, max_per_night: 5 }, false), /Say yes to apply to all 4, or numbers to skip\.$/);
  const note = agentNote(r, { more: 0 });
  assert.ok(note.includes(
    'Standing approval is on: for each ready program within the limits, call track started, fill from fields, submit where the program allows an agent, then track applied with submitted_by agent and fields_used. Stop at max_per_night. Never submit where blockers say needs_click, outside_approval or a sign-in you do not have.',
  ));
  assert.ok(!note.includes('Submit only when the builder says yes'));
  assert.ok(note.includes("Draft each ready program from its fields: 'record' and 'earnkit' values as given;"));
  assert.ok(agentNote(LINKED, { more: 0 }).includes('Submit only when the builder says yes'));
  assert.ok(agentNote(MONDAY, { more: 0 }).includes("Draft each ready program from its fields: 'earnkit' values as given;"));
});

test('unlinked with a sign-in link: the link is the last line; linked never shows it', () => {
  const link = 'https://earnkit.test/link/abcdefghijklmnop';
  const text = replyText({ ...MONDAY, sign_in: link }, false);
  assert.equal(text.split('\n').at(-1), `Sign in once at ${link} so I remember you across agents.`);
  assert.match(text, /Say yes to apply to all 2, numbers to skip, or "do 3" and I'll make the change first\.\n\nSign in once at /);
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
