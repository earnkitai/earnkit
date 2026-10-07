import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_KINDS, type FieldKind, type SubmissionRequirement } from './program-file';
import {
  DEFAULT_GUIDANCE,
  MAX_FIXES,
  QUESTION_ORDER,
  bankEntries,
  bankFill,
  coachIntro,
  draftTable,
  fixesLine,
  guidanceFor,
  preSubmitCheck,
  questionsFor,
} from './coach';

const req = (key: string, kind: FieldKind | undefined, o: Partial<SubmissionRequirement> = {}): SubmissionRequirement => ({
  key,
  label: o.label ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
  type: 'text',
  required: true,
  from: 'builder',
  ...(kind && { kind }),
  ...o,
});
const SRC = 'https://community.arc.io/x';

/** Arc-like: a name, the agent's how-it-works, and three fields only the builder can answer. */
const arcLike = [
  req('name', 'name', { from: 'project' }),
  req('how_it_works', 'how_it_works', { from: 'project' }),
  req('use_of_funds', 'use_of_funds'),
  req('why_you', 'why_you'),
  req('traction', 'traction'),
];

test('9.1 defaults: every kind has judges and a pattern, at most 2 questions; the three named questions', () => {
  for (const k of FIELD_KINDS) {
    const g = DEFAULT_GUIDANCE[k];
    assert.ok(g, k);
    assert.ok(g.judges.trim() && g.pattern.trim(), k);
    assert.ok(g.questions.length <= 2, k);
    for (const t of [g.judges, g.pattern, ...g.questions]) assert.doesNotMatch(t, /—/, k);
  }
  assert.equal(DEFAULT_GUIDANCE.traction.questions[0], 'Who has used it so far?');
  assert.equal(DEFAULT_GUIDANCE.why_you.questions[0], 'Why are you the one to build this?');
  assert.equal(DEFAULT_GUIDANCE.use_of_funds.questions[0], 'What would you build next with the grant?');
  assert.equal(DEFAULT_GUIDANCE.traction.limit_words, 60);
  assert.equal(DEFAULT_GUIDANCE.one_liner.limit_words, 20);
  assert.equal(DEFAULT_GUIDANCE.how_it_works.limit_words, 80);
  for (const k of ['name', 'links', 'demo_video', 'contact', 'other'] as const) assert.equal(DEFAULT_GUIDANCE[k].limit_words, null, k);
});

test('9.2 override: a program judges line over the default pattern; without a kind, other', () => {
  const g = guidanceFor(req('t', 'traction', { guidance: { judges: 'Arc relevance', source_url: SRC } }));
  assert.equal(g.judges, 'Arc relevance');
  assert.equal(g.pattern, DEFAULT_GUIDANCE.traction.pattern);
  assert.deepEqual(g.questions, DEFAULT_GUIDANCE.traction.questions);
  assert.equal(g.source_url, SRC);
  assert.equal(g.kind, 'traction');
  const none = guidanceFor(req('x', undefined));
  assert.equal(none.kind, 'other');
  assert.equal(none.judges, DEFAULT_GUIDANCE.other.judges);
  assert.equal(none.source_url, null);
});

test('9.3 first program: three questions in QUESTION_ORDER; how_it_works is never asked', () => {
  const q = questionsFor({ reqs: arcLike, answers: { name: 'TipJar' }, first: true });
  assert.deepEqual(q.map((x) => x.kind), ['traction', 'why_you', 'use_of_funds']);
  const order = q.map((x) => QUESTION_ORDER.indexOf(x.kind));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(!q.some((x) => x.keys.includes('how_it_works')));
  assert.deepEqual(q[0].keys, ['traction']);
  // A filled field is never asked.
  assert.deepEqual(questionsFor({ reqs: arcLike, answers: { name: 'TipJar', traction: '40 users' }, first: true }).map((x) => x.kind), ['why_you', 'use_of_funds']);
  // An optional field is never asked.
  assert.deepEqual(questionsFor({ reqs: [req('traction', 'traction', { required: false })], answers: {}, first: true }), []);
});

test('9.4 later program: one question', () => {
  const q = questionsFor({ reqs: arcLike, answers: {}, first: false });
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, 'traction');
});

test('9.5 contact folds into one question with every key; at most 3 still holds', () => {
  const reqs = [
    req('full_name', 'contact', { label: 'Full name' }),
    req('email', 'contact', { label: 'Email', type: 'email' }),
    req('x_handle', 'contact', { label: 'X (Twitter) handle' }),
    req('traction', 'traction'),
  ];
  const q = questionsFor({ reqs, answers: {}, first: true });
  assert.deepEqual(q.map((x) => x.kind), ['traction', 'contact']);
  assert.equal(q[1].text, 'Your full name, email and X (Twitter) handle?');
  assert.deepEqual(q[1].keys, ['full_name', 'email', 'x_handle']);
  const many = questionsFor({ reqs: [...arcLike, ...reqs.slice(0, 3), req('team', 'team'), req('m', 'milestones')], answers: {}, first: true });
  assert.equal(many.length, 3);
  // One contact field: the label reads naturally.
  assert.equal(
    questionsFor({ reqs: [req('builder_profile', 'contact', { label: 'Public builder profile' })], answers: {}, first: true })[0].text,
    'Your public builder profile?',
  );
});

test('9.6 coachIntro: the spec block for 3 questions, the 1-question line, null for none', () => {
  const q = questionsFor({ reqs: arcLike, answers: { name: 'TipJar' }, first: true, project: 'TipJar' });
  assert.equal(
    coachIntro('Arc Microgrants', q),
    [
      "Arc Microgrants: 3 quick questions, then I'll write your application.",
      '1. Who has used TipJar so far?',
      '2. Why are you the one to build this?',
      '3. What would you build next with the grant?',
    ].join('\n'),
  );
  assert.equal(
    coachIntro('Arc Microgrants', q.slice(0, 1)),
    "Arc Microgrants: 1 quick question, then I'll write your application.\n1. Who has used TipJar so far?",
  );
  assert.equal(coachIntro('Arc Microgrants', []), null);
});

test('9.7 bankFill: fills an empty field and lists it; never overwrites; never fills other', () => {
  const reqs = [req('traction', 'traction'), req('why', 'why_you'), req('track', 'other')];
  const bank = new Map<FieldKind, string>([['traction', '120 users'], ['why_you', 'Banked why'], ['other', 'Consumer']]);
  const r = bankFill(reqs, { why: 'My own why' }, bank);
  assert.equal(r.answers.traction, '120 users');
  assert.deepEqual(r.from_bank, { traction: '120 users' });
  assert.equal(r.answers.why, 'My own why');
  assert.ok(!('track' in r.answers));
  // Contact details and links are banked per slot: an email fills the email, an X handle the X field.
  const contact = [req('full_name', 'contact', { label: 'Full name' }), req('email', 'contact', { label: 'Email' }), req('x_handle', 'contact', { label: 'X (Twitter) handle' })];
  const banked = bankEntries(contact, { full_name: 'Alice Doe', email: 'a@b.co', x_handle: '@alice' });
  const later = bankFill(
    [req('contact_email', 'contact', { label: 'Contact email' }), req('x_profile', 'contact', { label: 'X Profile' })],
    {},
    banked,
  );
  assert.deepEqual(later.answers, { contact_email: 'a@b.co', x_profile: '@alice' });
  // A later program's new slot merges with what was banked.
  const merged = bankEntries([req('telegram', 'contact', { label: 'Telegram' })], { telegram: '@alice_tg' }, banked);
  assert.deepEqual(JSON.parse(merged.get('contact')!), { name: 'Alice Doe', email: 'a@b.co', x: '@alice', telegram: '@alice_tg' });
  assert.ok(!bankEntries([req('track', 'other')], { track: 'Consumer' }).has('other'));
});

test('9.8 check rules, one each, and the cap of 3 in rule order', () => {
  const link = { live: 'https://tipjar.example' };
  const withLink = (r: SubmissionRequirement[]) => [req('live', 'links', { type: 'url' }), ...r];
  const check = (reqs: SubmissionRequirement[], answers: Record<string, string>, judging = null as Parameters<typeof preSubmitCheck>[0]['judging']) =>
    preSubmitCheck({ reqs, answers, judging });
  // empty
  assert.deepEqual(check(withLink([req('name', 'name', { label: 'Name' })]), { ...link, name: ' ' }), [
    { key: 'name', rule: 'empty', text: 'Name: still empty.' },
  ]);
  // over_limit by words and by characters
  const words25 = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ');
  assert.deepEqual(check(withLink([req('pitch', 'other', { label: 'Pitch', guidance: { limit_words: 20, source_url: SRC } })]), { ...link, pitch: words25 }), [
    { key: 'pitch', rule: 'over_limit', text: 'Pitch: 25 words; keep it to 20.' },
  ]);
  assert.deepEqual(check(withLink([req('bio', 'other', { label: 'Bio', max_chars: 100 })]), { ...link, bio: 'x'.repeat(120) }), [
    { key: 'bio', rule: 'over_limit', text: 'Bio: 120 characters; keep it to 100.' },
  ]);
  // no_number: a traction answer, and another kind making a user claim
  assert.deepEqual(check(withLink([req('traction', 'traction', { label: 'Traction' })]), { ...link, traction: 'Lots of people love it' }), [
    { key: 'traction', rule: 'no_number', text: 'Traction: add a number (users, volume or revenue).' },
  ]);
  assert.deepEqual(check(withLink([req('sol', 'solution', { label: 'What it does' })]), { ...link, sol: 'Tips for creators, loved by users' }), [
    { key: 'sol', rule: 'no_number', text: 'What it does: add a number (users, volume or revenue).' },
  ]);
  assert.deepEqual(check(withLink([req('sol', 'solution', { label: 'What it does' })]), { ...link, sol: 'Tips for 120 users' }), []);
  // no_proof_link: keyed to the first links, demo_video or how_it_works field
  assert.deepEqual(
    check([req('sol', 'solution'), req('how', 'how_it_works', { label: 'How it works' }), req('demo', 'demo_video')], { sol: 'Tips', how: 'A contract', demo: 'soon' }),
    [{ key: 'how', rule: 'no_proof_link', text: 'Add one proof link (live app, demo or contract).' }],
  );
  // criterion
  const judging = { criteria: [{ text: 'Technical credibility', words: ['contract', 'tested', 'audit'] }], source_url: SRC };
  assert.deepEqual(check(withLink([req('sol', 'solution')]), { ...link, sol: 'Tips' }, judging), [
    { key: '', rule: 'criterion', text: 'No answer shows technical credibility yet.' },
  ]);
  assert.deepEqual(check(withLink([req('sol', 'solution')]), { ...link, sol: 'Tips via audited Contracts' }, judging), []);
  // Five problems: exactly 3 fixes, in rule order.
  const five = check(
    [
      req('name', 'name', { label: 'Name' }),
      req('pitch', 'one_liner', { label: 'Pitch' }),
      req('traction', 'traction', { label: 'Traction' }),
      req('how', 'how_it_works'),
    ],
    { pitch: words25, traction: 'Lots of people', how: 'magic' },
    judging,
  );
  assert.equal(five.length, MAX_FIXES);
  assert.deepEqual(five.map((f) => f.rule), ['empty', 'over_limit', 'no_number']);
});

test('9.9 never blocking: the check never throws on odd input', () => {
  assert.doesNotThrow(() => preSubmitCheck({ reqs: [], answers: {}, judging: null }));
  assert.doesNotThrow(() =>
    preSubmitCheck({ reqs: arcLike, answers: { traction: undefined as unknown as string, name: 42 as unknown as string }, judging: { criteria: [{ text: 'X', words: ['abc'] }], source_url: SRC } }),
  );
});

test('9.10 draftTable: Field | Answer, cut to 60 characters, "show all" only when something was cut', () => {
  const reqs = [req('name', 'name', { label: 'Project name' }), req('desc', 'solution', { label: 'Short description of what your project does and what it uses Arc for' }), req('opt', 'other', { required: false })];
  const long = 'Tips for creators, paid in USDC on Arc, with one tap and no sign up at all for fans';
  const t = draftTable(reqs, { name: 'TipJar', desc: long });
  assert.equal(
    t,
    [
      '| Field | Answer |',
      '|---|---|',
      '| Project name | TipJar |',
      `| Short description of what your project… | ${long.slice(0, 60).trimEnd()}… |`,
      '',
      'Say "show all" for the full text.',
    ].join('\n'),
  );
  assert.equal(draftTable(reqs.slice(0, 1), { name: 'TipJar' }), '| Field | Answer |\n|---|---|\n| Project name | TipJar |');
  // A long form: at most 8 rows, the written answers first (contact details last), in the form's order.
  const long12 = [
    ...['full_name', 'email', 'x_handle', 'telegram'].map((k) => req(k, 'contact', { label: k })),
    req('pitch', 'one_liner', { label: 'Pitch' }),
    ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => req(k, 'links', { label: `Link ${k}` })),
  ];
  const big = draftTable(long12, Object.fromEntries(long12.map((r) => [r.key, `${r.key} answer`])));
  assert.equal(big.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Field')).length, 8);
  assert.match(big, /\| Pitch \| pitch answer \|/);
  assert.match(big, /\| Link g \| g answer \|/);
  assert.doesNotMatch(big, /full_name|telegram/);
  assert.ok(big.endsWith('\n\n4 more answers. Say "show all" for the full text.'), big);
  // A pipe or a newline never breaks the table.
  assert.equal(draftTable(reqs.slice(0, 1), { name: 'Tip|Jar\nPro' }).split('\n')[2], '| Project name | Tip/Jar Pro |');
});

test('9.11 fixesLine: numbered, null for none', () => {
  assert.equal(
    fixesLine([
      { key: 'a', rule: 'empty', text: 'Name: still empty.' },
      { key: '', rule: 'criterion', text: 'No answer shows technical credibility yet.' },
    ]),
    'Before you submit, 2 quick fixes would make it stronger:\n1. Name: still empty.\n2. No answer shows technical credibility yet.',
  );
  assert.equal(fixesLine([{ key: 'a', rule: 'empty', text: 'Name: still empty.' }]), 'Before you submit, 1 quick fix would make it stronger:\n1. Name: still empty.');
  assert.equal(fixesLine([]), null);
});
