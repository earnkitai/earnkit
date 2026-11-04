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
  const r: R = { since: NO_SINCE, ready: [], gaps: [], ledger: LEDGER0, ask_outcome: [], as_reported: false, ...over };
  return { ...r, ...numbered(r.ready, r.gaps) };
};

const MONDAY = base({
  ready: [
    ready({
      title: 'Alliance ALL19', money: '$400K at admission', closes_in: 'in 14 days', filled: 3, facts_from_repo: 2,
      needs: ["the first founder's email"],
    }),
    ready({ title: 'Arc Builders Fund', money: 'investment from Circle Ventures', long_shot: 'an investment program with no stated amount' }),
  ],
  gaps: [gap({ title: 'Circle Developer Grants', money: '$5,000 to $100,000 USDC grants' })],
  ledger: { ...LEDGER0, applied: 1, asked_usd: 5000, pending: 1 },
});

test('the Monday text: two ready, one gap, a ledger with one applied', () => {
  assert.equal(
    replyText(MONDAY, false),
    [
      'Ready to apply, 2:',
      "1. Alliance ALL19, $400K at admission, closes in 14 days. Drafted: 2 facts from the repo. Needs your first founder's email.",
      '2. Arc Builders Fund, investment from Circle Ventures, a long shot: an investment program with no stated amount. Your agent fills it on the page.',
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
    ready: [ready({ program_id: 'd', title: 'Alliance ALL19', money: '$400K at admission', closes_in: 'in 3 days', filled: 1, facts_from_repo: 1 })],
    ledger: { ...LEDGER0, applied: 2, asked_usd: 115000, won: 1, pending: 1, closing_soon: [{ program_id: 'x', title: 'X', closes_at: '' }] },
  });
  assert.equal(
    replyText(r, false),
    [
      'Since Nov 2: 2 new programs you fit; Circle Developer Grants: deadline moved to Nov 20; Alliance ALL19 closes in 3 days.',
      '',
      'Ready to apply, 1:',
      '1. Alliance ALL19, $400K at admission, closes in 3 days. Drafted: 1 fact from the repo.',
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
  assert.match(replyText(setup, false), /^1\. S, \$1K\. Your agent fills it on the page\. Needs your Loom product demo\. First: sign in to the Builder Hub\.$/m);
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
      "1. Alliance ALL19, $400K at admission, closes in 14 days. Drafted: 2 facts from the repo. Needs your first founder's email.",
      '2. Arc Builders Fund, investment from Circle Ventures, a long shot: an investment program with no stated amount. Your agent fills it on the page.',
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

test('a reported-only program with passed links reads "Your agent fills it on the page."', () => {
  assert.match(replyText(base({ ready: [ready({ title: 'R', filled: 3, facts_from_repo: 0 })] }), false), /^1\. R, \$1K\. Your agent fills it on the page\.$/m);
});
