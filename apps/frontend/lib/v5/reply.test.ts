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
  return { ...r, ...numbered(r.ready, r.gaps) };
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
      'Ready to apply, 2:',
      "1. Alliance ALL19, $400K at admission, closes in 14 days. Drafted: 2 of 9 answers from the repo, 6 more by your agent. Needs your first founder's email.",
      '2. Arc Builders Fund, investment from Circle Ventures. Long odds: an investment program with no stated amount. Your agent drafts all 5 answers.',
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
    ready: [ready({ program_id: 'd', title: 'Alliance ALL19', money: '$400K at admission', closes_in: 'in 3 days', filled: 1, facts_from_repo: 1, repo_required: 1, total: 4 })],
    ledger: { ...LEDGER0, applied: 2, asked_usd: 115000, won: 1, pending: 1, closing_soon: [{ program_id: 'x', title: 'X', closes_at: '' }] },
  });
  assert.equal(
    replyText(r, false),
    [
      'Since Nov 2: 2 new programs you fit; Circle Developer Grants: deadline moved to Nov 20; Alliance ALL19 closes in 3 days.',
      '',
      'Ready to apply, 1:',
      "1. Alliance ALL19, $400K at admission, closes in 3 days. Drafted: 1 of 4 answers from the repo, the rest by your agent.",
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
  // R2c: the one answer is the builder's, so the agent drafts none of it.
  assert.match(replyText(setup, false), /^1\. S, \$1K\. Needs your Loom product demo\. First: sign in to the Builder Hub\.$/m);
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
      "1. Alliance ALL19, $400K at admission, closes in 14 days. Drafted: 2 of 9 answers from the repo, 6 more by your agent. Needs your first founder's email.",
      '2. Arc Builders Fund, investment from Circle Ventures. Long odds: an investment program with no stated amount. Your agent drafts all 5 answers.',
      '',
      'One change away, 1:',
      '3. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc.',
      '',
      'In person, apply to attend first:',
      '4. ETHGlobal Mumbai, up to $15K per partner prize, closes in 2 days. First: apply to attend by Nov 3 and get accepted; stake a small amount of ETH; be in Mumbai Nov 5 to 7.',
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
  for (const s of ["'earnkit'", "'agent'", "'builder'", 'sources', 'yes', 'own browser', 'track', 'applied', 'Zeta Grant', '2 more left out: ready past the cap, gaps and in-person programs. Ask with filter.all for the full list.'])
    assert.ok(n.includes(s), s);
  assert.ok(!agentNote(MONDAY, { more: 0 }).includes('more: gaps'));
  assert.ok(n.includes('Pass users and live_url in the project whenever you know them; never invent them.'));
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
  evidence_summary: { tier: 'live', line: 'Your project reads as live, no verified usage yet. Next: 25 funded wallets on mainnet in 90 days; you have 4.' },
});

test('the "Before applying" paragraph groups the sign-ins, names the clicks and the first three missing; "Before tonight" only when the agent sends tonight (R5b)', () => {
  const text = replyText(LINKED, false);
  const before = text.split('\n\n').find((b) => b.startsWith('Before applying: '))!;
  assert.equal(
    before,
    "Before applying: Sign in once to Google on your agent's computer for 2 of them. Sign in once to Avalanche Builder Hub for 1 of them. Sign in once by email for 1 of them. Needs your click: Click Grant. Still missing from your record: your founder video link, an approved answer on the problem, your deck link and 1 more.",
  );
  const blocks = text.split('\n\n');
  assert.deepEqual(blocks.slice(-4), [
    before,
    'Applied under your standing approval: Alliance ALL19, Arc Builders Fund.',
    'Your project reads as live, no verified usage yet. Next: 25 funded wallets on mainnet in 90 days; you have 4.',
    'Say yes to apply to all 4, or numbers to skip.',
  ]);
  assert.doesNotMatch(text, /Before tonight/);
  // Standing approval with nothing an agent can send alone (every program blocked): nothing goes tonight.
  assert.match(replyText({ ...LINKED, auto_apply: true, max_per_night: 5 }, false), /\n\nBefore applying: Sign in once to Google/);
  // Standing approval and one program free to send: the agent applies tonight.
  const free = base({ ...LINKED, ready: [...LINKED.ready, ready({ program_id: 'f1', title: 'Free', from_record: 1, total: 1 })], auto_apply: true, max_per_night: 5 });
  const tonight = replyText(free, false);
  assert.match(tonight, /\n\nBefore tonight: Sign in once to Google/);
  assert.match(tonight, /\n\nApplying tonight to 1; say stop to hold any\.$/);
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

test('unlinked with a sign-in link: saying yes is the one action, the sign-in its second sentence (R5a); linked never shows it', () => {
  const link = 'https://earnkit.test/link/abcdefghijklmnop';
  const text = replyText({ ...MONDAY, sign_in: link }, false);
  const blocks = text.split('\n\n');
  assert.equal(
    blocks.at(-1),
    `Say yes to apply to all 2, numbers to skip, or "do 3" and I'll make the change first. Sign in once at ${link} and I read your repo for proof and remember you.`,
  );
  assert.equal(blocks.at(-2), 'Ledger: 1 applied ($5K asked), 0 won, 1 pending.');
  assert.equal(text.match(/Sign in once at/g)!.length, 1);
  // Without a link the closing line stays alone.
  assert.match(replyText(MONDAY, false), /\n\nSay yes to apply to all 2, numbers to skip, or "do 3" and I'll make the change first\.$/);
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

test('rules (R18a): ready and in-person lines show none; a gap line shows its rules after the change; only the closing asks "yes n" (v6.1.6, v6.1.7 m1)', () => {
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
      'Ready to apply, 1:',
      '1. Base Ecosystem Fund, pre-seed and seed investment. Long odds: an investment program with no stated amount. Your agent drafts all 2 answers. First: sign in to the portal.',
      '',
      'One change away, 2:',
      '2. Goose Grants, $10K. Their rule: a project built with or for goose. Their rule: work not already funded by an employer or client.',
      '3. Colosseum, $25K: a demo video. Their rule: the team has not raised venture capital.',
      '',
      'In person, apply to attend first:',
      '4. Meetup, $5K. First: be in Lisbon.',
      '',
      'Say yes to apply, skip it, "yes 2" if its rule fits you, or "do 3" and I\'ll make the change first.',
    ].join('\n'),
  );
  // m1 (v6.1.7): one "yes n" per reply, in the closing line only.
  assert.equal(replyText(r, true).match(/"yes 2"/g)?.length, 1);
  const lines = agentNote(r, { more: 0 }).split('\n');
  const at = lines.indexOf(RULE_NOTE);
  assert.ok(at > 0, lines.join('\n'));
  assert.match(lines[at - 1], /^Draft each ready program from its fields/);
  assert.ok(!agentNote(MONDAY, { more: 0 }).includes('Their rule'));
});

test('the closing line names "yes r" only when a rule-only gap exists, "do g" only when a change does (v6.1.6)', () => {
  const rulesOnly = gap({ title: 'R', gap: ruleGap('x'), rules: ['x'] });
  const end = (r: R) => replyText(r, true).split('\n').at(-1);
  assert.equal(end(base({ gaps: [rulesOnly] })), 'Say "yes 1" if its rule fits you.');
  assert.equal(end(base({ ready: MONDAY.ready, gaps: [rulesOnly] })), 'Say yes to apply to all 2, numbers to skip, or "yes 3" if its rule fits you.');
  assert.equal(end(base({ gaps: [rulesOnly, MONDAY.gaps[0]] })), 'Say "yes 1" if its rule fits you, or "do 2" and I\'ll make the change first.');
  assert.doesNotMatch(agentNote(base({ gaps: [rulesOnly] }), { more: 0 }), /On "do <n>"/);
  assert.ok(agentNote(base({ gaps: [rulesOnly] }), { more: 0 }).includes(RULE_NOTE));
});

test('R18d: an in-person gap line says what attending takes, after its rules (rule-only and with a real gap)', () => {
  const attend = { in_person: true, setup: ['work 3 months from the office'] };
  const r = base({
    gaps: [
      gap({ title: 'Residency', money: '$500K', gap: ruleGap('a co-founder with US work authorization'), rules: ['a co-founder with US work authorization'], ...attend }),
      gap({ title: 'Camp', money: '$10K', gap: VIDEO, also: [ruleGap('a team of two')], rules: ['a team of two'], ...attend }),
    ],
  });
  const lines = replyText(r, true).split('\n');
  assert.ok(lines.includes('1. Residency, $500K. Their rule: a co-founder with US work authorization. First: work 3 months from the office.'), lines.join('\n'));
  assert.ok(lines.includes('2. Camp, $10K: a demo video. Their rule: a team of two. First: work 3 months from the office.'), lines.join('\n'));
});

test('R20/R21: an in-person line says its odds, then what attending takes, then what it needs from you (v6.1.6)', () => {
  const yc = ready({
    title: 'Y Combinator Winter 2027 Batch', money: '$500K investment', in_person: true, long_shot: 'many apply, few are taken',
    setup: ['a YC account to start the application'], needs: ['a YC account to start the application', 'your email', 'a Loom product demo'],
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
      'In person, apply to attend first:',
      '1. Y Combinator Winter 2027 Batch, $500K investment. Long odds: many apply, few are taken. Needs a YC account to start the application. Needs your email and Loom product demo.',
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
  const before = replyText(r, true).split('\n\n').find((b) => b.startsWith('Before applying: '));
  assert.equal(before, 'Before applying: Sign in once by email for 1 of them. Needs your click: Click Grant.');
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
  assert.ok(lines.includes('Ready to apply, 4:'), text);
  assert.ok(lines.some((l) => /^2\. Held One, \$1K\. .* Being handled by your other agent since 10:00 UTC\.$/.test(l)), text);
  assert.ok(lines.some((l) => /^4\. Held Two, \$1K\. .* Being handled by your other agent since Nov 3, 22:10 UTC\.$/.test(l)), text);
  assert.ok(!/^1\. Free One.*Being handled/m.test(text), text);
  assert.match(text, /\n\nSay yes to apply to all 2, or numbers to skip\.$/);
  // One free: the singular; none free: no yes at all, and nothing claims "nothing fits".
  const one = base({ linked: true, ready: [ready({ title: 'Free One' }), ready({ title: 'Held One', claimed_since: '2026-11-04T10:00:00.000Z' })] });
  assert.match(replyText(one, false, NOW), /\n\nSay yes to apply, or skip it\.$/);
  const none = base({ linked: true, ready: [ready({ title: 'Held One', claimed_since: '2026-11-04T10:00:00.000Z' })] });
  const t = replyText(none, false, NOW);
  assert.doesNotMatch(t, /Say yes|Nothing fits/);
  assert.match(t, /\n\nYour other agent is handling these; I'll say when something new opens\.$/);
});
