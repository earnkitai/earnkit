import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FIELD_KINDS, ProgramFile, type FieldKind, type SubmissionRequirement } from './program-file';
import {
  DEFAULT_GUIDANCE,
  MAX_BULLETS,
  MAX_FIRST_QUESTIONS,
  MAX_FIXES,
  MAX_QUESTION_WORDS,
  PLAIN_FIX,
  PLAIN_LENGTH_FIX,
  QUESTION_ORDER,
  bankEntries,
  bankFill,
  coachIntro,
  derivedDescription,
  derivedProfile,
  draftTable,
  fixesLine,
  guidanceFor,
  plainProblem,
  preSubmitCheck,
  questionsFor,
  WALLET_KEY,
  walletAsk,
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

test('9.4 C17 later program: one round as short bullets (at most 4); a single question stays numbered', () => {
  const q = questionsFor({ reqs: arcLike, answers: {}, first: false, project: 'TipJar' });
  assert.equal(q.length, 3);
  assert.ok(q.every((x) => x.bullet));
  assert.equal(
    coachIntro('Arc Microgrants', q),
    [
      "Arc Microgrants: a few things only you know, then I'll write it.",
      '- Who has used TipJar so far?',
      '- Why are you the one to build this?',
      '- What would you build next with the grant?',
    ].join('\n'),
  );
  const one = questionsFor({ reqs: arcLike.slice(0, 3), answers: {}, first: false });
  assert.equal(one.length, 1);
  assert.ok(!one[0].bullet);
  assert.equal(coachIntro('Arc Microgrants', one), "Arc Microgrants: 1 quick question, then I'll write your application.\n1. What would you build next with the grant?");
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
  assert.equal(q[1].text, 'Your full name, email and X?');
  assert.deepEqual(q[1].keys, ['full_name', 'email', 'x_handle']);
  // More than 3 groups on a first program: 3 numbered questions and one short folded bullet.
  const many = questionsFor({ reqs: [...arcLike, ...reqs.slice(0, 3), req('team', 'team'), req('m', 'milestones')], answers: {}, first: true });
  assert.deepEqual(many.map((x) => Boolean(x.bullet)), [false, false, false, true]);
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
  assert.ok(!bankEntries([req('track', 'other')], { track: 'Consumer' }).has('other'));
});

test('C16: banked contact details are never filled silently; the contact question offers them as a yes/no', () => {
  const contact = [req('full_name', 'contact', { label: 'Full name' }), req('email', 'contact', { label: 'Email' }), req('x_handle', 'contact', { label: 'X (Twitter) handle' })];
  const banked = bankEntries(contact, { full_name: 'Alice Doe', email: 'a@b.co', x_handle: '@alice' });
  const later = [req('contact_email', 'contact', { label: 'Contact email' }), req('x_profile', 'contact', { label: 'X Profile' }), req('telegram', 'contact', { label: 'Telegram' })];
  const f = bankFill(later, {}, banked);
  assert.deepEqual(f.answers, {});
  assert.deepEqual(f.from_bank, {});
  assert.deepEqual(f.suggested, { contact_email: 'a@b.co', x_profile: '@alice' });
  const q = questionsFor({ reqs: later, answers: f.answers, first: false, suggested: f.suggested });
  assert.equal(q.length, 1);
  assert.equal(q[0].text, 'Use a@b.co and @alice again? Plus your Telegram?');
  assert.deepEqual(q[0].suggested, { contact_email: 'a@b.co', x_profile: '@alice' });
  assert.equal(questionsFor({ reqs: later.slice(0, 2), answers: {}, first: false, suggested: f.suggested })[0].text, 'Use a@b.co and @alice again?');
  // Final fix wave (M4): on a hosted agent the yes/no names the kind, never the saved value.
  const hosted = questionsFor({ reqs: later, answers: f.answers, first: false, suggested: f.suggested, shared: true });
  assert.equal(hosted[0].text, 'Use your saved contact email and X profile? Plus your Telegram?');
  assert.doesNotMatch(hosted[0].text, /a@b\.co|@alice/);
  assert.equal(questionsFor({ reqs: later.slice(0, 2), answers: {}, first: false, suggested: f.suggested, shared: true })[0].text.includes('a@b.co'), false);
  // A later program's new slot merges with what was banked.
  const merged = bankEntries([req('telegram', 'contact', { label: 'Telegram' })], { telegram: '@alice_tg' }, banked);
  assert.deepEqual(JSON.parse(merged.get('contact')!), { name: 'Alice Doe', email: 'a@b.co', x: '@alice', telegram: '@alice_tg' });
});

test('Reuse: the live link only from a field that says live, website or product; two fields of one kind never get one answer', () => {
  // Avalanche: "Project URL" and "Additional Link" (a deck) never become the live link.
  const avalanche = [
    req('project_url', 'links', { label: 'Project URL', type: 'url' }),
    req('additional_url', 'links', { label: 'Additional Link', type: 'url' }),
  ];
  const fromAvalanche = bankEntries(avalanche, { project_url: 'https://tipjar.example', additional_url: 'https://deck.example' });
  const base = [req('live_product_url', 'links', { label: 'Link to your live product', type: 'url' })];
  assert.deepEqual(bankFill(base, {}, fromAvalanche).answers, {});
  // Arc's live deployment does fill Base's live product link.
  const fromArc = bankEntries([req('live_deployment_url', 'links', { label: 'Live deployment on Arc mainnet', type: 'url' })], { live_deployment_url: 'https://tipjar.example' });
  assert.deepEqual(bankFill(base, {}, fromArc).answers, { live_product_url: 'https://tipjar.example' });
  // Circle: "Product roadmap" and "Proposed grant milestones" share a kind: only the first is filled.
  const circle = [req('roadmap', 'milestones', { label: 'Product roadmap' }), req('milestones', 'milestones', { label: 'Proposed grant milestones' })];
  const bank = new Map<FieldKind, string>([['milestones', 'Recurring tips by March']]);
  const f = bankFill(circle, {}, bank);
  assert.deepEqual(f.answers, { roadmap: 'Recurring tips by March' });
  // And two fields of one kind bank only the first answer, never both joined.
  assert.equal(bankEntries(circle, { roadmap: 'A', milestones: 'B' }).get('milestones'), 'A');
});

test('C15/C17: every builder-only field is asked; first program 3 numbered plus one folded bullet, a later one short bullets', () => {
  const b = (key: string, kind: FieldKind, label: string, todo: string) => req(key, kind, { label, todo });
  const baseForm = [
    b('full_name', 'contact', 'Full name', 'your full name'),
    b('email', 'contact', 'Email', 'your email'),
    b('x_handle', 'contact', 'X (Twitter) handle', 'your X handle'),
    b('telegram', 'contact', 'Telegram username', 'your Telegram username'),
    req('project_name_description', 'one_liner', { from: 'project' }),
    b('founding_team', 'team', 'Tell us about the founding team', 'a note on the founding team'),
    b('usage_numbers', 'traction', 'Share your key usage numbers', 'your key usage numbers'),
    b('revenue', 'other', 'How does your product make money today?', 'how it makes money today'),
    b('gtm_plan', 'milestones', "What's your GTM plan for the next 3 months?", 'your GTM plan for the next 3 months'),
    b('primary_challenge', 'other', 'What is the primary challenge?', 'your main challenge right now'),
    b('credits', 'other', 'Which credits?', 'the credits you want'),
    req('builder_code', 'other', { from: 'project' }),
  ];
  const draft = { project_name_description: 'TipJar: tips in USDC.', builder_code: 'abc' };
  const builderKeys = baseForm.filter((r) => r.from === 'builder').map((r) => r.key);
  // First program: 3 numbered questions, then the leftovers as one short bullet.
  const q = questionsFor({ reqs: baseForm, answers: draft, first: true, project: 'TipJar' });
  assert.equal(
    coachIntro('Base Builder Grants', q),
    [
      "Base Builder Grants: 4 quick questions, then I'll write your application.", // Ruling C25: the bullet counts.
      '1. Who has used TipJar so far?',
      '2. What will you ship in the next 3 months? And who is building TipJar with you?',
      '3. Your full name, email, X and Telegram?',
      '- How it makes money today, your main challenge right now and the credits you want?',
    ].join('\n'),
  );
  assert.deepEqual(new Set(q.flatMap((x) => x.keys)), new Set(builderKeys));
  assert.ok(!q.flatMap((x) => x.keys).includes('builder_code'), 'the agent drafts project fields');
  // A later program (usage numbers banked), with saved contact details: the C17 example.
  const later = questionsFor({
    reqs: baseForm,
    answers: { ...draft, usage_numbers: '120 users' },
    first: false,
    project: 'TipJar',
    suggested: { full_name: 'Alice Doe', email: 'alice@example.com', x_handle: '@alice', telegram: '@alice_tg' },
  });
  assert.equal(
    coachIntro('Base Builder Grants', later),
    [
      "Base Builder Grants: a few things only you know, then I'll write it.",
      '- What will you ship in the next 3 months?',
      '- Who is building TipJar with you?',
      '- Use Alice Doe, alice@example.com, @alice and @alice_tg again?',
      '- How it makes money today, your main challenge right now and the credits you want?',
    ].join('\n'),
  );
  assert.deepEqual(new Set(later.flatMap((x) => x.keys)), new Set(builderKeys.filter((k) => k !== 'usage_numbers')));
  // More than 4 groups on a later program: still 4 bullets, the rest folded into the 4th.
  const five = questionsFor({ reqs: baseForm, answers: draft, first: false, project: 'TipJar' });
  assert.equal(five.length, MAX_BULLETS);
  assert.deepEqual(new Set(five.flatMap((x) => x.keys)), new Set(builderKeys));
  // Avalanche: consent and the amount are asked, never drafted.
  const avalanche = [
    b('consent_team1', 'other', 'I consent to the sharing of my data with Team1.', 'your consent to share data with Team1'),
    b('requested_amount_usd', 'other', 'Requested Amount (USD)', 'the amount you request in USD'),
    b('x_profile', 'contact', 'X Profile', 'your X profile'),
  ];
  assert.deepEqual(
    questionsFor({ reqs: avalanche, answers: {}, first: false }).map((x) => x.text),
    ['Your X profile?', 'Your consent to share data with Team1 and the amount you request in USD?'],
  );
  // A program's own question never gets the project's name.
  const own = req('os', 'team', { guidance: { questions: ['Is it open source?'], source_url: SRC } });
  assert.equal(questionsFor({ reqs: [own], answers: {}, first: true, project: 'TipJar' })[0].text, 'Is it open source?');
});

test('Round 3: contact is its own bullet naming what the form wants; money never joins it; Base from saved speedrun or Avalanche data in one round', () => {
  const dir = join(import.meta.dirname, '../../../../programs');
  const prog = (id: string) => ProgramFile.parse(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')));
  const base = prog('base-builder-grants');
  const draft = Object.fromEntries(base.submission_requirements.filter((r) => r.from === 'project').map((r) => [r.key, 'x']));
  const builderKeys = base.submission_requirements.filter((r) => r.required && r.from === 'builder').map((r) => r.key);
  // What a builder banked on speedrun (an email) or Avalanche (X profile, Telegram), as Base's fill offers it.
  for (const [from, saved] of [
    ['a16z-speedrun', bankEntries(prog('a16z-speedrun').submission_requirements, { email: 'alice@example.com' })],
    ['avalanche-team1-mini-grants', bankEntries(prog('avalanche-team1-mini-grants').submission_requirements, { x_profile: '@alice', telegram: '@alice_tg' })],
  ] as const) {
    const fill = bankFill(base.submission_requirements, draft, saved);
    assert.ok(Object.keys(fill.suggested).length > 0, from);
    const q = questionsFor({ reqs: base.submission_requirements, answers: fill.answers, first: false, project: 'TipJar', suggested: fill.suggested });
    const screen = coachIntro('Base Builder Grants', q)!;
    assert.ok(q.length <= MAX_BULLETS, `${from}: ${screen}`);
    assert.ok(q.every((x) => x.bullet), from);
    for (const x of q) assert.ok(x.text.split(/\s+/).length <= MAX_QUESTION_WORDS, `${from}: ${x.text}`);
    // One round: every builder-only field is under some bullet.
    assert.deepEqual(new Set(q.flatMap((x) => x.keys)), new Set(builderKeys), from);
    const contact = q.filter((x) => x.kind === 'contact');
    assert.equal(contact.length, 1, from);
    assert.ok(contact[0].keys.every((k) => base.submission_requirements.find((r) => r.key === k)!.kind === 'contact'), `${from}: money joined contact`);
    if (from === 'a16z-speedrun') assert.equal(contact[0].text, 'Use alice@example.com again? Plus your full name, X and Telegram?');
    else assert.equal(contact[0].text, 'Use @alice and @alice_tg again? Plus your full name and email?');
  }
});

test('C17, round 3: on every committed program, first and later: at most 4 items, 25 words each, never "contact details", contact never shares a bullet', () => {
  const dir = join(import.meta.dirname, '../../../../programs');
  const contact = { full_name: 'Alice Doe', email: 'alice@example.com', x_handle: '@alice', telegram: '@alice_tg', x_profile: '@alice', builder_profile: 'https://github.com/alice' };
  let screens = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const p = ProgramFile.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    const kindOfKey = new Map(p.submission_requirements.map((r) => [r.key, r.kind ?? 'other']));
    for (const first of [true, false])
      for (const suggested of [{}, contact]) {
        const q = questionsFor({ reqs: p.submission_requirements, answers: {}, first, project: 'A Long Project Name', suggested });
        screens++;
        assert.ok(q.length <= MAX_BULLETS, f);
        assert.ok(q.filter((x) => !x.bullet).length <= MAX_FIRST_QUESTIONS, f);
        for (const x of q) {
          assert.ok(x.text.split(/\s+/).length <= MAX_QUESTION_WORDS, `${f}: ${x.text}`);
          assert.doesNotMatch(x.text, /contact details/i, f);
          const kinds = new Set(x.keys.map((k) => kindOfKey.get(k)));
          if (kinds.has('contact')) assert.equal(kinds.size, 1, `${f}: contact shares a bullet: ${x.text}`);
        }
      }
  }
  assert.ok(screens >= 16);
});

test('v4.8.3: a Title Case contact label reads mid-sentence, proper names keep their case, a "Founder 1:" prefix goes', () => {
  const c = (key: string, label: string) => req(key, 'contact', { label, from: 'builder' });
  const z = [c('email', 'Email'), c('first_name', 'First Name'), c('last_name', 'Last Name'), c('phone', 'Phone Number')];
  assert.equal(questionsFor({ reqs: z, answers: {}, first: true })[0].text, 'Your email, first name, last name and phone number?');
  const bef = [c('n', 'Founder 1: Name'), c('t', 'Founder 1: Telegram'), c('x', 'Founder 1: X'), c('l', 'Founder 1: LinkedIn'), c('loc', 'Location')];
  assert.equal(questionsFor({ reqs: bef, answers: {}, first: true })[0].text, 'Your name, Telegram, X, LinkedIn and location?');
  assert.equal(questionsFor({ reqs: [c('x', 'X Profile'), c('t', 'Telegram username')], answers: {}, first: true })[0].text, 'Your X profile and Telegram?');
});

/** C14: every builder fix reads "<Field>: <the exact thing to add>." and names its field. */
const FIX_FORMAT = /^[^:\n]{1,41}: [a-z][^\n]*\.$/;

test('9.8 C14 check rules: each fix names its field and the exact thing to add; stated limits only, for the agent', () => {
  const link = { live: 'https://tipjar.example' };
  const withLink = (r: SubmissionRequirement[]) => [req('live', 'links', { type: 'url', label: 'Live app' }), ...r];
  const check = (reqs: SubmissionRequirement[], answers: Record<string, string>, o: Partial<Parameters<typeof preSubmitCheck>[0]> = {}) =>
    preSubmitCheck({ reqs, answers, judging: null, ...o });
  // empty (the stored snapshot)
  assert.deepEqual(check(withLink([req('name', 'name', { label: 'Name' })]), { ...link, name: ' ' }), [
    { key: 'name', rule: 'empty', for: 'builder', text: 'Name: add the answer.' },
  ]);
  // traction without a number
  assert.deepEqual(check(withLink([req('traction', 'traction', { label: 'Traction' })]), { ...link, traction: 'Lots of people love it' }), [
    { key: 'traction', rule: 'no_number', for: 'builder', text: 'Traction: add how many people used it (e.g. 120 users, 900 payments).' },
  ]);
  // milestones and the grant's use need a date, not users
  assert.deepEqual(check(withLink([req('funds', 'use_of_funds', { label: 'What the grant funds' })]), { ...link, funds: 'Recurring tips' }), [
    { key: 'funds', rule: 'no_date', for: 'builder', text: 'What the grant funds: name one milestone and a date.' },
  ]);
  assert.deepEqual(check(withLink([req('ms', 'milestones', { label: 'Milestones' })]), { ...link, ms: 'Recurring tips in 6 weeks' }), []);
  assert.deepEqual(check(withLink([req('ms', 'milestones', { label: 'Milestones' })]), { ...link, ms: 'Recurring tips by March' }), []);
  // a user claim in another prose field
  assert.deepEqual(check(withLink([req('sol', 'solution', { label: 'What it does' })]), { ...link, sol: 'Tips for creators, loved by users' }), [
    { key: 'sol', rule: 'no_number', for: 'builder', text: 'What it does: put the number next to "users".' },
  ]);
  assert.deepEqual(check(withLink([req('sol', 'solution', { label: 'What it does' })]), { ...link, sol: 'Tips for 120 users' }), []);
  // A choice-like `other` answer is never a claim.
  assert.deepEqual(check(withLink([req('ch', 'other', { label: 'Challenge' })]), { ...link, ch: 'User acquisition' }), []);
  // no proof link: names the first links, demo_video or how_it_works field; the agent's when it knows one
  const noLink = [req('sol', 'solution'), req('how', 'how_it_works', { label: 'How it works' }), req('demo', 'demo_video')];
  const answers = { sol: 'Tips', how: 'A contract', demo: 'soon' };
  assert.deepEqual(check(noLink, answers), [
    { key: 'how', rule: 'no_proof_link', for: 'builder', text: 'How it works: link the live app or the contract on the explorer.' },
  ]);
  assert.deepEqual(check(noLink, answers, { knownLinks: ['https://github.com/a/b'] }).map((f) => f.for), ['agent']);
  // Length: only a limit the program states, and only for the agent (never the default 50 words).
  const long = Array.from({ length: 120 }, (_, i) => `w${i}`).join(' ');
  assert.deepEqual(check(withLink([req('why', 'why_you', { label: 'Why you', max_chars: 4000 })]), { ...link, why: long }), []);
  assert.deepEqual(check(withLink([req('bio', 'other', { label: 'Bio', max_chars: 100 })]), { ...link, bio: 'x'.repeat(120) }), [
    { key: 'bio', rule: 'over_limit', for: 'agent', text: 'Bio: trim it to 100 characters (now 120).' },
  ]);
  assert.deepEqual(check(withLink([req('pitch', 'other', { label: 'Pitch', guidance: { limit_words: 20, source_url: SRC } })]), { ...link, pitch: long }), [
    { key: 'pitch', rule: 'over_limit', for: 'agent', text: 'Pitch: trim it to 20 words (now 120).' },
  ]);
  // C13: no keyword criterion fixes; only a hand-written one, on its field.
  const plain = { criteria: [{ text: 'Technical credibility' }], source_url: SRC };
  assert.deepEqual(check(withLink([req('sol', 'solution')]), { ...link, sol: 'Tips' }, { judging: plain }), []);
  const curated = { criteria: [{ text: 'Technical credibility', fix: { kind: 'solution' as const, needs: 'link' as const, add: 'link the contract on the Arc explorer' } }], source_url: SRC };
  assert.deepEqual(check(withLink([req('sol', 'solution', { label: 'Short description' })]), { ...link, sol: 'Tips' }, { judging: curated }), [
    { key: 'sol', rule: 'criterion', for: 'builder', text: 'Short description: link the contract on the Arc explorer.' },
  ]);
  assert.deepEqual(check(withLink([req('sol', 'solution')]), { ...link, sol: 'Tips at https://arcscan.app/x' }, { judging: curated }), []);
  // Five problems: at most 3 builder fixes, in rule order; the agent's come after.
  const five = check(
    [
      req('name', 'name', { label: 'Name' }),
      req('traction', 'traction', { label: 'Traction' }),
      req('ms', 'milestones', { label: 'Milestones' }),
      req('sol', 'solution', { label: 'What it does', max_chars: 10 }),
      req('how', 'how_it_works'),
    ],
    { traction: 'Lots of people', ms: 'More features', sol: 'Loved by users everywhere', how: 'magic' },
  );
  assert.deepEqual(five.filter((f) => f.for === 'builder').map((f) => f.rule), ['empty', 'no_number', 'no_date']);
  assert.equal(five.filter((f) => f.for === 'builder').length, MAX_FIXES);
  // v2.10 item 11: a description field over its limit is a not_plain fix (it replaces over_limit).
  assert.deepEqual(five.filter((f) => f.for === 'agent').map((f) => f.rule), ['not_plain']);
});

test('5.1 plainProblem flags addresses, hashes, hex runs, key: value lists, number dumps, links and length', () => {
  const addr = `0x${'ab12'.repeat(10)}`;
  const hash = `0x${'cd34'.repeat(16)}`;
  assert.ok(plainProblem(`Tip Jar, contract ${addr}.`, 'one_liner'));
  assert.ok(plainProblem(`Deployed in tx ${hash}.`, 'solution'));
  assert.ok(plainProblem('Token id deadbeefdeadbeef on Base.', 'problem'));
  assert.ok(plainProblem('TVL: 1, tx: 2, users: 3', 'one_liner'));
  assert.ok(plainProblem('We have 120 users, 900 payments, 14 countries and 3 chains.', 'solution'));
  assert.ok(plainProblem('Tip Jar, see https://tipjar.xyz for more.', 'one_liner'));
  assert.equal(plainProblem('Tip Jar lets fans tip creators in USDC on Base.', 'one_liner'), null);
  assert.equal(plainProblem('Tip Jar lets fans tip creators in USDC on Base.', 'name'), null);
  // how_it_works keeps one proof link, never a raw address in it.
  assert.ok(plainProblem(`Fans tip through the contract https://basescan.org/address/${addr}.`, 'how_it_works'));
  assert.equal(plainProblem('Fans tip through the contract, see https://tipjar.xyz/how for the flow.', 'how_it_works'), null);
  assert.ok(plainProblem('See https://tipjar.xyz/how and https://tipjar.xyz/faq.', 'how_it_works'));
  // Length: the form's max_chars, else its limit_words.
  const line = 'Tip Jar lets fans tip creators in USDC on Base.';
  assert.ok(plainProblem(line, 'one_liner', { max_chars: 20 }));
  assert.equal(plainProblem(line, 'one_liner', { max_chars: 200, limit_words: 3 }), null);
  assert.ok(plainProblem(line, 'one_liner', { limit_words: 5 }));
  assert.equal(plainProblem(line, 'one_liner', { limit_words: 20 }), null);
  assert.equal(plainProblem('   ', 'one_liner'), null);
});

test('5.2 preSubmitCheck: an unplain description field is an agent fix, never a builder one', () => {
  const addr = `0x${'ab12'.repeat(10)}`;
  const reqs = [
    req('live', 'links', { type: 'url', label: 'Live app' }),
    req('name', 'name', { label: 'Project name' }),
    req('one', 'one_liner', { label: 'One-sentence description', max_chars: 80 }),
    req('prob', 'problem', { label: 'Problem' }),
    req('sol', 'solution', { label: 'Solution' }),
    req('how', 'how_it_works', { label: 'How it works' }),
    req('bio', 'other', { label: 'Bio' }),
  ];
  const answers = {
    live: 'https://tipjar.xyz',
    name: 'Tip Jar',
    one: `Tip Jar, contract ${addr}, TVL: 1, tx: 2`,
    prob: 'Creators have no easy way to take tips in USDC.',
    sol: 'We have 120 users, 900 payments, 14 countries and 3 chains.',
    how: `Fans tip through https://basescan.org/address/${addr}.`,
    bio: `Built ${addr}`,
  };
  const fixes = preSubmitCheck({ reqs, answers, judging: null });
  const plain = fixes.filter((f) => f.rule === 'not_plain');
  assert.deepEqual(plain, [
    { key: 'one', rule: 'not_plain', for: 'agent', text: PLAIN_FIX('One-sentence description') },
    { key: 'sol', rule: 'not_plain', for: 'agent', text: PLAIN_FIX('Solution') },
    { key: 'how', rule: 'not_plain', for: 'agent', text: PLAIN_FIX('How it works') },
  ]);
  assert.equal(PLAIN_FIX('One-sentence description'), 'One-sentence description: rewrite in plain words, no addresses or numbers lists.');
  assert.ok(!fixes.some((f) => f.for === 'builder' && /plain words/.test(f.text)));
  // A field outside the description kinds (bio) is never checked.
  assert.ok(!fixes.some((f) => f.key === 'bio'));
  // Over the form's limit: one not_plain fix, no over_limit beside it.
  const long = preSubmitCheck({ reqs, answers: { ...answers, one: 'Tip Jar lets fans tip creators in USDC on Base, with recurring tips soon.' + ' More.'.repeat(5) }, judging: null });
  assert.deepEqual(long.filter((f) => f.key === 'one').map((f) => f.rule), ['not_plain']);
  // Fix round 1: length alone names the limit.
  assert.deepEqual(long.filter((f) => f.key === 'one').map((f) => f.text), ['One-sentence description: keep it under 80 characters, in plain words.']);
  assert.equal(PLAIN_LENGTH_FIX('Pitch', 20, 'words'), 'Pitch: keep it under 20 words, in plain words.');
  const words = preSubmitCheck({ reqs: [req('one', 'one_liner', { label: 'Pitch', guidance: { limit_words: 3, source_url: SRC } })], answers: { one: 'Tips for creators in USDC.' }, judging: null });
  assert.deepEqual(words.map((f) => f.text), ['Pitch: keep it under 3 words, in plain words.']);
  // Length plus an address: the plain-words fix.
  const both = preSubmitCheck({ reqs, answers: { ...answers, one: `${'Tips for creators. '.repeat(6)}${addr}` }, judging: null });
  assert.deepEqual(both.filter((f) => f.key === 'one').map((f) => f.text), [PLAIN_FIX('One-sentence description')]);
});

test('5.2 fix round 1: a field a criterion asks to link may hold an explorer link with an address; a bare address still fails', () => {
  const addr = `0x${'ab12'.repeat(10)}`;
  const reqs = [req('sol', 'solution', { label: 'Short description' })];
  const judging = { criteria: [{ text: 'Technical credibility', fix: { kind: 'solution' as const, needs: 'link' as const, add: 'link the contract on the Arc explorer' } }], source_url: SRC };
  const check = (sol: string) => preSubmitCheck({ reqs, answers: { sol }, judging }).filter((f) => f.rule === 'not_plain');
  assert.deepEqual(check(`Tips for creators, contract at https://basescan.org/address/${addr}`), []);
  assert.deepEqual(check(`Tips for creators, contract ${addr}`), [{ key: 'sol', rule: 'not_plain', for: 'agent', text: PLAIN_FIX('Short description') }]);
  // Without the criterion, the same link is flagged (no link in a solution field).
  assert.equal(preSubmitCheck({ reqs, answers: { sol: `Tips, https://basescan.org/address/${addr}` }, judging: null }).filter((f) => f.rule === 'not_plain').length, 1);
});

test('C14: every fix any rule can produce reads "<Field>: <thing to add>." with a key', () => {
  const reqs = [
    req('name', 'name', { label: 'Project name' }),
    req('traction', 'traction', { label: 'Share your key usage numbers' }),
    req('funds', 'use_of_funds', { label: 'What the grant funds' }),
    req('ms', 'milestones', { label: 'Proposed grant milestones' }),
    req('sol', 'solution', { label: 'Short description of what your project does and what it uses Arc for', max_chars: 5 }),
    req('how', 'how_it_works', { label: 'How it works', guidance: { limit_words: 1, source_url: SRC } }),
  ];
  const judging = { criteria: [{ text: 'Technical credibility', fix: { kind: 'solution' as const, needs: 'link' as const, add: 'link the contract on the Arc explorer' } }], source_url: SRC };
  const sets: Record<string, string>[] = [
    { traction: 'Many', funds: 'More', ms: 'Stuff', sol: 'Loved by users', how: 'two words' },
    { name: 'TipJar', traction: 'Many', funds: 'More', ms: 'Stuff', sol: 'Loved by users', how: 'two words' },
    { name: 'TipJar', traction: '1', funds: 'May', ms: 'May', sol: 'Loved by users', how: 'two words' },
    { name: 'TipJar', traction: '1', funds: 'May', ms: 'May', sol: 'Tips', how: 'two words' },
  ];
  let n = 0;
  for (const answers of sets)
    for (const knownLinks of [[], ['https://x.example']])
      for (const f of preSubmitCheck({ reqs, answers, judging, knownLinks })) {
        n++;
        assert.match(f.text, FIX_FORMAT, f.text);
        assert.ok(f.key, f.text);
      }
  assert.ok(n >= 8, `expected many fixes, got ${n}`);
});

test('9.9 never blocking: the check never throws on odd input', () => {
  assert.doesNotThrow(() => preSubmitCheck({ reqs: [], answers: {}, judging: null }));
  assert.doesNotThrow(() =>
    preSubmitCheck({ reqs: arcLike, answers: { traction: undefined as unknown as string, name: 42 as unknown as string }, judging: { criteria: [{ text: 'X' }], source_url: SRC } }),
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

test("9.11 fixesLine: numbered builder fixes, never the agent's; null for none", () => {
  const name = { key: 'a', rule: 'empty' as const, for: 'builder' as const, text: 'Name: add the answer.' };
  const ms = { key: 'm', rule: 'no_date' as const, for: 'builder' as const, text: 'Milestones: name one milestone and a date.' };
  const trim = { key: 'b', rule: 'over_limit' as const, for: 'agent' as const, text: 'Bio: trim it to 100 characters (now 120).' };
  assert.equal(
    fixesLine([name, ms, trim]),
    'Before you submit, 2 quick fixes would make it stronger:\n1. Name: add the answer.\n2. Milestones: name one milestone and a date.',
  );
  assert.equal(fixesLine([name]), 'Before you submit, 1 quick fix would make it stronger:\n1. Name: add the answer.');
  assert.equal(fixesLine([trim]), null);
  assert.equal(fixesLine([]), null);
});

test('v2.8.1 §C11: the wallet joins the round: with contact, its own item, or the last one; never a round of its own', () => {
  const contact = [req('email', 'contact', { label: 'Email' })];
  // Joined to the contact item (personal details), with the no-wallet hint while it fits.
  const joined = questionsFor({ reqs: contact, answers: {}, first: true, wallet: true });
  assert.equal(joined.length, 1);
  assert.deepEqual(joined[0].keys, ['email', WALLET_KEY]);
  assert.equal(joined[0].text, "Your email? And the wallet for your token's fees (0x…)? No wallet yet? Make one at keys.coinbase.com.");
  // No contact item: its own numbered item while there is room.
  const prose = [req('traction', 'traction')];
  const own = questionsFor({ reqs: prose, answers: {}, first: true, wallet: true });
  assert.deepEqual(own.map((q) => q.keys), [['traction'], [WALLET_KEY]]);
  assert.equal(own[1].text, `${walletAsk()} No wallet yet? Make one at keys.coinbase.com.`);
  assert.equal(coachIntro('P', own), "P: 2 quick questions, then I'll write your application.\n1. Who has used it so far?\n2. The wallet for your token's fees (0x…)? No wallet yet? Make one at keys.coinbase.com.");
  // A later program's single question becomes two short bullets.
  const later = questionsFor({ reqs: prose, answers: {}, first: false, wallet: true });
  assert.ok(later.length === 2 && later.every((q) => q.bullet));
  // No questions at all: no round just for the wallet (the offer's wallet line asks it).
  assert.deepEqual(questionsFor({ reqs: prose, answers: { traction: '120 users' }, first: true, wallet: true }), []);
  // Every committed program, first and later: still at most 4 items of at most 25 words, the wallet asked once.
  const dir = join(import.meta.dirname, '../../../../programs');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const p = ProgramFile.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    for (const first of [true, false]) {
      const q = questionsFor({ reqs: p.submission_requirements, answers: {}, first, project: 'A Long Project Name', wallet: true });
      if (q.length === 0) continue;
      assert.ok(q.length <= MAX_BULLETS, f);
      assert.equal(q.filter((x) => x.keys.includes(WALLET_KEY)).length, 1, f);
      for (const x of q) assert.ok(x.text.split(/\s+/).length <= MAX_QUESTION_WORDS, `${f}: ${x.text}`);
    }
  }
});

test('v2.8.1 §C15: no proof-link fix on a form without a proof field (a16z speedrun: the email only)', () => {
  const dir = join(import.meta.dirname, '../../../../programs');
  const speedrun = ProgramFile.parse(JSON.parse(readFileSync(join(dir, 'a16z-speedrun.json'), 'utf8')));
  const fixes = preSubmitCheck({ reqs: speedrun.submission_requirements, answers: { email: 'erin@example.com' }, judging: null, knownLinks: ['https://github.com/erin/ethapp'] });
  assert.deepEqual(fixes, []);
  // A form with a proof field still gets it, on that field.
  const withLink = [req('email', 'contact', { label: 'Email' }), req('demo', 'demo_video', { label: 'Demo video' })];
  const f = preSubmitCheck({ reqs: withLink, answers: { email: 'a@b.co', demo: 'soon' }, judging: null });
  assert.deepEqual(f.map((x) => [x.key, x.rule]), [['demo', 'no_proof_link']]);
});

test('v2.8.1 §E17: on a hosted agent nothing is filled silently; each saved answer is a yes/no that names it', () => {
  const reqs = [
    req('traction', 'traction'),
    req('why', 'why_you'),
    req('how', 'how_it_works', { from: 'project' }),
    req('email', 'contact', { label: 'Email' }),
  ];
  const bank = new Map<FieldKind, string>([
    ['traction', '120 users in the first month, mostly from the Arc Discord, with 40 paying.'],
    ['why_you', 'Built two tipping apps before'],
    ['how_it_works', 'Banked how it works'],
    ['contact', JSON.stringify({ email: 'a@b.co' })],
  ]);
  // Without the flag: unchanged (traction, why_you and how_it_works filled; contact suggested).
  const plain = bankFill(reqs, {}, bank);
  assert.deepEqual(Object.keys(plain.from_bank).sort(), ['how', 'traction', 'why']);
  // Hosted: nothing filled; what the coach asks about comes back suggested; what the agent drafts is left out.
  const f = bankFill(reqs, {}, bank, { confirmAll: true });
  assert.deepEqual(f.answers, {});
  assert.deepEqual(f.from_bank, {});
  assert.deepEqual(f.suggested, {
    traction: '120 users in the first month, mostly from the Arc Discord, with 40 paying.',
    why: 'Built two tipping apps before',
    email: 'a@b.co',
  });
  // An answer the builder or agent gave is never replaced, and never suggested over.
  assert.ok(!('why' in bankFill(reqs, { why: 'Mine' }, bank, { confirmAll: true }).suggested));
  const q = questionsFor({ reqs, answers: f.answers, first: false, suggested: f.suggested });
  const texts = q.map((x) => x.text);
  assert.ok(texts.includes('Use "120 users in the first month, mostly from the Arc Discord, with 40 paying." again?'), texts.join(' | '));
  assert.ok(texts.includes('Use "Built two tipping apps before" again?'), texts.join(' | '));
  assert.ok(texts.includes('Use a@b.co again?'), texts.join(' | '));
  for (const x of q.filter((y) => y.kind !== 'contact')) assert.ok(x.suggested, x.text);
  for (const t of texts) assert.doesNotMatch(t, /—/);
  // A long saved answer is cut at a word.
  const long = bankFill([req('traction', 'traction')], {}, new Map([['traction', 'word '.repeat(40).trim()]]), { confirmAll: true });
  const lq = questionsFor({ reqs: [req('traction', 'traction')], answers: {}, first: false, suggested: long.suggested });
  assert.match(lq[0].text, /^Use "(word ){7,}word\.\.\." again\?$/);
});

test('6.10 v2.9 B11: questionsFor never asks an optional field, even empty and builder-only (expected PASS before T6, P34)', () => {
  const optional = [
    req('traction', 'traction', { required: false, from: 'builder' }),
    req('x', 'contact', { required: false, from: 'builder', label: 'X handle' }),
    req('why', 'why_you', { required: false }),
  ];
  for (const first of [true, false])
    assert.deepEqual(questionsFor({ reqs: optional, answers: {}, first, wallet: false }), [], `first: ${first}`);
  // Required ones next to them: only the required field is asked.
  const asked = questionsFor({ reqs: [...optional, req('use', 'use_of_funds', { from: 'builder' })], answers: {}, first: true });
  assert.deepEqual(asked.flatMap((q) => q.keys), ['use']);
});

test('10.1 (v2.11 T10) derivedProfile: Arc\'s required profile link is the proven login\'s GitHub URL; never without a login, never over an answer, never a field that does not take GitHub', () => {
  const dir = join(import.meta.dirname, '../../../../programs');
  const arc = ProgramFile.parse(JSON.parse(readFileSync(join(dir, 'arc-microgrants.json'), 'utf8'))).submission_requirements;
  assert.deepEqual(derivedProfile(arc, {}, 'Jenil04'), { builder_profile: 'https://github.com/jenil04' });
  // No proven login: nothing is made up (the coach asks).
  assert.deepEqual(derivedProfile(arc, {}, null), {});
  // The builder's own answer stands.
  assert.deepEqual(derivedProfile(arc, { builder_profile: 'https://x.com/jenil' }, 'jenil04'), {});
  // Only a required link field that takes a GitHub profile.
  const xOnly = req('x_profile', 'contact', { label: 'X profile', type: 'url', description: 'Your X account.' });
  const optional = req('gh', 'contact', { label: 'GitHub profile', type: 'url', required: false });
  const email = req('email', 'contact', { label: 'Email', type: 'email' });
  assert.deepEqual(derivedProfile([xOnly, optional, email], {}, 'jenil04'), {});
  // Never a login that is not a GitHub login.
  assert.deepEqual(derivedProfile(arc, {}, 'not a login'), {});
  // derivedDescription: the build's description fills Arc's description, never over an answer.
  const desc = 'Podcast listeners tip the show in USDC on Arc.';
  assert.deepEqual(derivedDescription(arc, {}, desc), { description: desc });
  assert.deepEqual(derivedDescription(arc, { description: 'Mine.' }, desc), {});
  assert.deepEqual(derivedDescription(arc, {}, '  '), {});
  // Every required field of Arc is then derived on the build path: no coach question.
  const answers = { live_deployment_url: 'https://podtips-jenil04.earnkit.com', repo_url: 'https://github.com/jenil04/podtips', ...derivedDescription(arc, {}, desc) };
  assert.deepEqual(questionsFor({ reqs: arc, answers: { ...answers, ...derivedProfile(arc, answers, 'jenil04') }, first: true }), []);
});
