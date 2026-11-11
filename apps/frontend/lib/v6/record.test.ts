import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVABLE, BuilderRecord, EMPTY_RECORD, KIND_WORDS, answerFor, approvePath, completeness, isApproved, mergeRecord, parseRecord,
  recordItems, recordMissing, unapprovePath,
} from './record';
import { ANSWER_KINDS } from '../v5/program-file';

const NOW = new Date('2026-11-06T12:00:00Z');
const LATER = new Date('2026-11-07T12:00:00Z');
const merge = (patch: unknown, by: 'builder' | 'agent' = 'agent', cur = EMPTY_RECORD, now = NOW) => mergeRecord(cur, patch, by, now);

test('EMPTY_RECORD has every block and the policy defaults', () => {
  assert.deepEqual(EMPTY_RECORD.policy, {
    auto_apply: false, max_per_night: 5, categories: ['grant', 'hackathon', 'investment', 'bounty'], never: [], agent_may_submit: true,
  });
  assert.deepEqual(EMPTY_RECORD.projects, []);
  assert.deepEqual(EMPTY_RECORD.meta, {});
});

test('an unknown key is dropped, at the top and inside a block', () => {
  const parsed = BuilderRecord.parse({ person: { name: 'Ada', shoe: 42 }, extra: true });
  assert.equal('extra' in parsed, false);
  assert.equal('shoe' in parsed.person, false);
  const { record, problems } = merge({ person: { name: 'Ada', shoe: 42 }, extra: true });
  assert.equal(record.person.name, 'Ada');
  assert.equal('shoe' in record.person, false);
  assert.equal('extra' in record, false);
  assert.ok(problems.includes('person.shoe: not a field'), problems.join('|'));
  assert.ok(problems.includes('extra: not a field'), problems.join('|'));
});

test('a line drops control and format characters on save; tabs and breaks are one plain space (v6.1.7 S4)', () => {
  const start = merge({ person: { name: 'Ada' } }).record;
  const { record, problems, changed } = merge(
    { person: { name: 'Ada\u0007Lovelace', location: 'Lon\tdon  \n town', x: '@ali\u202Eecnarf\u200B' } }, 'agent', start,
  );
  assert.deepEqual(problems, []);
  assert.equal(record.person.name, 'AdaLovelace');
  assert.equal(record.person.location, 'Lon don town');
  assert.equal(record.person.x, '@aliecnarf');
  assert.deepEqual(changed.sort(), ['person.location', 'person.name', 'person.x']);
  // Counted after cleaning: 40 characters plus marks fit a 40-character field.
  assert.equal(merge({ person: { x: `${'a'.repeat(40)}\u200B\u200B` } }).record.person.x, 'a'.repeat(40));
  assert.match(merge({ person: { x: 'a'.repeat(41) } }).problems[0], /^person\.x: /);
  // Prose keeps its line breaks.
  assert.equal(merge({ person: { bio: 'One.\nTwo.' } }).record.person.bio, 'One.\nTwo.');
});

test('invalid leaves: caps, email, https, IANA, country, chains; never a whole-patch refusal', () => {
  const { record, problems } = merge({
    person: { email: 'nope', linkedin: 'http://linkedin.com/in/ada', timezone: 'Mars/Base', based_country: 'gb', bio: 'x'.repeat(281), technical: true },
    company: { stage: 'unicorn', launch_date: '2026-13-01', raised_usd: -1, name: 'Ada Labs' },
    projects: [{ id: 'Bad Id' }, { id: 'p1', repo_url: 'https://gitlab.com/a/b', chains_claimed: ['base', 'nochain'] }],
  });
  assert.equal(record.person.technical, true);
  assert.equal(record.company.name, 'Ada Labs');
  assert.equal(record.projects.length, 1);
  assert.equal(record.projects[0].repo_url, undefined);
  for (const p of ['person.email', 'person.linkedin', 'person.timezone', 'person.based_country', 'person.bio', 'company.stage', 'company.launch_date', 'company.raised_usd', 'projects.id', 'projects.p1.repo_url', 'projects.p1.chains_claimed'])
    assert.ok(problems.some((l) => l.startsWith(`${p}: `) || l.startsWith(`${p}.`)), `${p} in ${problems.join('|')}`);
});

test('mergeRecord by agent on answers.traction: set_by agent, no approved_at', () => {
  const { record, changed } = merge({ answers: { traction: { text: '140 on the waitlist since 2026-10-01.' } } });
  assert.deepEqual(record.meta['answers.traction'], { set_by: 'agent', set_at: NOW.toISOString() });
  assert.equal(record.answers.traction!.written_by, 'agent');
  assert.deepEqual(changed, ['answers.traction']);
  assert.equal(isApproved(record, 'answers.traction'), false);
  assert.equal(answerFor(record, null, 'traction'), null);
});

test('approvePath then answerFor returns the text; a later agent set unapproves it; the same value again does not', () => {
  const drafted = merge({ answers: { traction: { text: '140 on the waitlist.', short: '140 waitlist.' } } }).record;
  const approved = approvePath(drafted, 'answers.traction', LATER);
  assert.equal(approved.meta['answers.traction'].approved_at, LATER.toISOString());
  assert.deepEqual(answerFor(approved, null, 'traction'), { text: '140 on the waitlist.', short: '140 waitlist.' });
  const same = merge({ answers: { traction: { text: '140 on the waitlist.' } } }, 'agent', approved, LATER);
  assert.deepEqual(same.changed, []);
  assert.equal(isApproved(same.record, 'answers.traction'), true);
  const redone = merge({ answers: { traction: { text: '150 on the waitlist.' } } }, 'agent', approved, LATER);
  assert.equal(isApproved(redone.record, 'answers.traction'), false);
  assert.equal(answerFor(redone.record, null, 'traction'), null);
  assert.equal(isApproved(unapprovePath(approved, 'answers.traction'), 'answers.traction'), false);
});

test('APPROVABLE: answers, project answers, the traction line and raised; raised_usd and raised_from share company.raised', () => {
  for (const p of ['answers.traction', 'projects.p1.answers.problem', 'traction.line_pre_launch', 'company.raised']) assert.ok(APPROVABLE(p), p);
  for (const p of ['person.name', 'company.raised_usd', 'projects.p1.name', 'traction.waitlist']) assert.ok(!APPROVABLE(p), p);
  const r = merge({ company: { raised_usd: 50000, raised_from: 'Two angels.' } });
  assert.deepEqual(r.changed, ['company.raised']);
  const ok = approvePath(r.record, 'company.raised', LATER);
  assert.ok(isApproved(ok, 'company.raised'));
  assert.ok(!isApproved(merge({ company: { raised_usd: 60000 } }, 'agent', ok).record, 'company.raised'));
  assert.equal(approvePath(r.record, 'person.name', LATER), r.record);
});

test('projects[] merge by id keeps the other project; meta paths are per project', () => {
  const two = merge({ projects: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] }).record;
  const { record, changed } = merge({ projects: [{ id: 'p2', one_liner: 'The second.', answers: { problem: { text: 'Fees.' } } }] }, 'agent', two);
  assert.deepEqual(record.projects.map((p) => [p.id, p.name]), [['p1', 'One'], ['p2', 'Two']]);
  assert.equal(record.projects[1].one_liner, 'The second.');
  assert.deepEqual(changed.sort(), ['projects.p2.answers.problem', 'projects.p2.one_liner']);
  assert.equal(record.meta['projects.p2.answers.problem'].set_by, 'agent');
});

test('meta, evidence_read_at and last_tier in a patch are ignored with a problem line', () => {
  const start = merge({ projects: [{ id: 'p1', name: 'One' }] }).record;
  const { record, problems, changed } = merge(
    { meta: { 'answers.traction': { set_by: 'builder', set_at: NOW.toISOString(), approved_at: NOW.toISOString() } }, projects: [{ id: 'p1', evidence_read_at: NOW.toISOString(), last_tier: { tier: 'used', line: 'x', read_at: 'y' } }] },
    'agent', start,
  );
  assert.deepEqual(record, start);
  assert.deepEqual(changed, []);
  assert.deepEqual(problems, ['meta: set by EarnKit only', 'projects.p1.evidence_read_at: set by EarnKit only', 'projects.p1.last_tier: set by EarnKit only']);
});

test('arrays are replaced whole; null clears a field', () => {
  const a = merge({ team: [{ name: 'Bo' }, { name: 'Cy' }], person: { location: 'London' } }).record;
  const b = merge({ team: [{ name: 'Di', role: 'design' }], person: { location: null } }, 'builder', a);
  assert.deepEqual(b.record.team, [{ name: 'Di', role: 'design' }]);
  assert.equal(b.record.person.location, undefined);
  assert.deepEqual(b.changed.sort(), ['person.location', 'team']);
  assert.equal(b.record.meta.team.set_by, 'builder');
});

test('a patch that is not an object is one problem line', () => {
  const { record, problems } = merge('hello');
  assert.deepEqual(record, EMPTY_RECORD);
  assert.deepEqual(problems, ['set: not an object']);
});

test("answerFor(record, 'p1', 'how_it_works') reads the solution answer; the project's beats the record's", () => {
  let r = merge({ answers: { solution: { text: 'Record level.' } }, projects: [{ id: 'p1', answers: { solution: { text: 'Project level.' } } }] }).record;
  r = approvePath(approvePath(r, 'answers.solution', NOW), 'projects.p1.answers.solution', NOW);
  assert.deepEqual(answerFor(r, 'p1', 'how_it_works'), { text: 'Project level.', short: null });
  assert.deepEqual(answerFor(r, 'p2', 'solution'), { text: 'Record level.', short: null });
  assert.deepEqual(answerFor(r, null, 'how_it_works'), { text: 'Record level.', short: null });
  assert.equal(answerFor(r, 'p1', 'name'), null);
});

test('recordMissing names "your founder video link" when needs has founder_video and the doc is empty', () => {
  const m = recordMissing(EMPTY_RECORD, { needs: ['founder_video'], kinds: [] });
  assert.ok(m.includes('your founder video link'), m.join('|'));
  const withDoc = merge({ docs: { founder_video_url: 'https://youtu.be/x' } }).record;
  assert.ok(!recordMissing(withDoc, { needs: ['founder_video'], kinds: [] }).includes('your founder video link'));
});

test('recordMissing in builder words: name and email, a project, the traction line, unapproved answers, docs', () => {
  const m = recordMissing(EMPTY_RECORD, { needs: ['resume', 'deck', 'pitch_pdf', 'demo_video'], kinds: ['problem', 'how_it_works'] });
  assert.deepEqual(m, [
    'your name', 'your email', 'a project with its repo or site', 'one approved line on traction',
    'an approved answer on the problem', 'an approved answer on the solution',
    'your demo video link', 'your resume link', 'your deck link', 'your pitch PDF link',
  ]);
  let r = merge({ person: { name: 'Ada', email: 'ada@example.com' }, projects: [{ id: 'p1', live_url: 'https://ada.app' }], traction: { line_pre_launch: 'Pre-launch, 140 on the waitlist.' }, answers: { problem: { text: 'Fees.' } } }).record;
  r = approvePath(approvePath(r, 'traction.line_pre_launch', NOW), 'answers.problem', NOW);
  assert.deepEqual(recordMissing(r, { needs: [], kinds: ['problem'] }), []);
  for (const line of m) assert.doesNotMatch(line, /—|score|rank|grade|points|coin|token|streak|_/);
});

test('KIND_WORDS covers every answer kind', () => {
  assert.deepEqual(Object.keys(KIND_WORDS).sort(), [...ANSWER_KINDS].sort());
  assert.equal(KIND_WORDS.what_next, 'what is next');
});

test('parseRecord of garbage is EMPTY_RECORD, and of a good value is that value', () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errors.push(a);
  try {
    assert.deepEqual(parseRecord('garbage', 7), EMPTY_RECORD);
    assert.deepEqual(parseRecord({ person: { name: 42 } }, 7), EMPTY_RECORD);
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 2);
  assert.match(JSON.stringify(errors[0]), /7/);
  assert.doesNotMatch(JSON.stringify(errors[1]), /42/);
  assert.deepEqual(parseRecord({}), EMPTY_RECORD);
  const r = merge({ person: { name: 'Ada' } }).record;
  assert.deepEqual(parseRecord(JSON.parse(JSON.stringify(r))), r);
});

test('completeness of EMPTY_RECORD has six missing, in plain words', () => {
  assert.deepEqual(completeness(EMPTY_RECORD), {
    filled: [], missing: ['about you', 'a project', 'the company', 'your documents', 'traction', 'answers'],
  });
  const r = merge({ person: { name: 'Ada' }, docs: { deck_url: 'https://ada.app/deck.pdf' } }).record;
  assert.deepEqual(completeness(r).filled, ['about you', 'your documents']);
});

test('policy is builder-only: an agent cannot grant standing approval; a builder can', () => {
  const agent = merge({ policy: { auto_apply: true, max_per_night: 20 }, person: { name: 'Ada' } }, 'agent');
  assert.equal(agent.record.policy.auto_apply, false);
  assert.equal(agent.record.policy.max_per_night, 5);
  assert.deepEqual(agent.problems, ['policy: set by the builder on earnkit.com/me only']);
  assert.deepEqual(agent.changed, ['person.name']);
  const builder = merge({ policy: { auto_apply: true } }, 'builder');
  assert.equal(builder.record.policy.auto_apply, true);
  assert.deepEqual(builder.changed, ['policy.auto_apply']);
  assert.equal(builder.record.meta['policy.auto_apply'].set_by, 'builder');
});

test('an agent answer is written_by agent whatever it claims; a builder may say either', () => {
  const a = merge({ answers: { problem: { text: 'Fees.', written_by: 'builder' } } }, 'agent');
  assert.equal(a.record.answers.problem!.written_by, 'agent');
  const b = merge({ answers: { problem: { text: 'Fees.', written_by: 'agent' } } }, 'builder');
  assert.equal(b.record.answers.problem!.written_by, 'agent');
  const c = merge({ answers: { problem: { text: 'Fees.' } } }, 'builder');
  assert.equal(c.record.answers.problem!.written_by, 'builder');
});

test('policy.categories: at most four, de-duplicated; a null to a field at its default is no change', () => {
  const dup = merge({ policy: { categories: ['grant', 'grant', 'bounty'] } }, 'builder');
  assert.deepEqual(dup.record.policy.categories, ['grant', 'bounty']);
  const many = merge({ policy: { categories: ['grant', 'grant', 'grant', 'grant', 'bounty'] } }, 'builder');
  assert.equal(many.problems.length, 1);
  assert.match(many.problems[0], /^policy\.categories: /);
  const nul = merge({ policy: { max_per_night: null, auto_apply: null } }, 'builder');
  assert.deepEqual(nul.changed, []);
  assert.deepEqual(nul.record, EMPTY_RECORD);
});

test('problem-line keys are cut to 60 characters', () => {
  const key = 'k'.repeat(500);
  const { problems } = merge({ [key]: 1, person: { [key]: 1 } });
  assert.deepEqual(problems.sort(), [`${'k'.repeat(60)}: not a field`, `person.${'k'.repeat(53)}: not a field`].sort());
});

test('inherited-key names in a patch are the normal problem line, never a throw (security L1)', () => {
  for (const raw of ['{"__proto__":{"name":"x"}}', '{"constructor":{"name":"x"}}', '{"toString":{"name":"x"}}', '{"hasOwnProperty":1}']) {
    const key = Object.keys(JSON.parse(raw))[0];
    const { record, problems } = merge(JSON.parse(raw));
    assert.deepEqual(problems, [`${key}: not a field`], raw);
    assert.deepEqual(record, EMPTY_RECORD);
  }
  for (const key of ['__proto__', 'constructor', 'toString', 'valueOf']) {
    for (const block of ['person', 'company', 'traction', 'docs', 'policy']) {
      const { problems } = merge(JSON.parse(`{"${block}":{"${key}":{"a":1}}}`), 'builder');
      assert.deepEqual(problems, [`${block}.${key}: not a field`], `${block}.${key}`);
    }
    const a = merge(JSON.parse(`{"answers":{"${key}":{"text":"x"}}}`));
    assert.deepEqual(a.problems, [`answers.${key}: not a field`]);
  }
  assert.equal(({} as { name?: unknown }).name, undefined, 'Object.prototype is untouched');
});

test('B17: a new text drops the old short form (the builder\'s edit leaves no approved short); a short alone keeps the text', () => {
  let r = merge({ answers: { problem: { text: 'Teams lose time on payouts.', short: 'Payouts; we serve 5,000 paying customers.' } } }).record;
  r = approvePath(r, 'answers.problem', NOW);
  const edited = merge({ answers: { problem: { text: 'Teams lose time on payouts. We have no customers yet.' } } }, 'builder', r, LATER).record;
  assert.equal(edited.answers.problem?.short, undefined);
  assert.deepEqual(answerFor(edited, null, 'problem'), { text: 'Teams lose time on payouts. We have no customers yet.', short: null });
  // The agent redrafts the short: the answer waits for approval again, text and short together.
  const redrafted = merge({ answers: { problem: { short: 'Payouts take teams days.' } } }, 'agent', edited, LATER).record;
  assert.equal(redrafted.answers.problem?.text, 'Teams lose time on payouts. We have no customers yet.');
  assert.equal(redrafted.answers.problem?.short, 'Payouts take teams days.');
  assert.equal(answerFor(redrafted, null, 'problem'), null);
  // The same text sent again with a new short keeps both.
  const both = merge({ answers: { problem: { text: 'Teams lose time on payouts. We have no customers yet.', short: 'Short.' } } }, 'agent', redrafted, LATER).record;
  assert.equal(both.answers.problem?.short, 'Short.');
});

test('C48: an agent change that drops an approval stamps when; approving again clears it', () => {
  let r = merge({ answers: { problem: { text: 'Fees.' } } }).record;
  r = approvePath(r, 'answers.problem', NOW);
  const changed = merge({ answers: { problem: { short: 'F.' } } }, 'agent', r, LATER).record;
  assert.equal(changed.meta['answers.problem'].unapproved_at, LATER.toISOString());
  assert.equal(approvePath(changed, 'answers.problem', LATER).meta['answers.problem'].unapproved_at, undefined);
  // Never approved: nothing to stamp.
  assert.equal(merge({ answers: { why_you: { text: 'Us.' } } }, 'agent', r, LATER).record.meta['answers.why_you'].unapproved_at, undefined);
});

test('C49: traction is one item in the missing list (the line), never also an answer', () => {
  const m = recordMissing(EMPTY_RECORD, { needs: [], kinds: ['traction', 'problem'] });
  assert.deepEqual(m.filter((x) => /traction/.test(x)), ['one approved line on traction']);
});

test('C50: recordItems counts the items the open programs ask, and the ones missing', () => {
  const asks = { needs: ['deck'], kinds: ['problem', 'traction'] };
  const empty = recordItems(EMPTY_RECORD, asks);
  // name, email, project, traction line, problem, deck.
  assert.deepEqual([empty.total, empty.missing.length], [6, 6]);
  const r = merge({ person: { name: 'Ada' } }).record;
  assert.deepEqual([recordItems(r, asks).total, recordItems(r, asks).missing.length], [6, 5]);
  assert.deepEqual(recordItems(r, asks).missing, recordMissing(r, asks));
});

test('C53: an unknown chain is named', () => {
  const { problems } = merge({ projects: [{ id: 'p1', chains_claimed: ['base', 'notachain'] }] });
  assert.ok(problems.some((l) => l.endsWith('not a known chain: notachain')), problems.join('|'));
});

test('final fix (v6.1.12, F10): the record tool saves each chain once, in first order, as /me does', () => {
  const { record, problems } = merge({ projects: [{ id: 'p1', name: 'App', chains_claimed: ['base', 'base', 'arc', 'base'] }] });
  assert.deepEqual(problems, []);
  assert.deepEqual(record.projects[0].chains_claimed, ['base', 'arc']);
});

test('L21-18 (v6.1.16, controller ruling): Press submit stays on by default; only its label changed', async () => {
  const { EMPTY_RECORD } = await import('./record');
  const { ME_LABELS } = await import('../v5/site-copy');
  assert.equal(EMPTY_RECORD.policy.agent_may_submit, true);
  assert.equal(ME_LABELS['policy.agent_may_submit'], 'Press submit for me when I say yes.');
});

test('Task 11 fix round 1 (N3): a record link carrying a user name or password is refused; a plain one saves', () => {
  const m = mergeRecord(EMPTY_RECORD, { docs: { deck_url: 'https://user:pass@deck.example/d', resume_url: 'https://me@cv.example/r', founder_video_url: 'https://video.example/v' } }, 'agent', new Date('2026-11-06T12:00:00Z'));
  assert.equal(m.record.docs.deck_url, undefined);
  assert.equal(m.record.docs.resume_url, undefined);
  assert.equal(m.record.docs.founder_video_url, 'https://video.example/v');
  assert.equal(m.problems.filter((p) => /no user name or password/.test(p)).length, 2, m.problems.join('\n'));
});
