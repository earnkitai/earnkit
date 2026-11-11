import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { programFixture } from '../v5/fixtures/program';
import { mcpCall } from '../v5/fixtures/mcp-call';
import { connectInstallation, markNextNeeds, saveInstallation } from '../v5/installations';
import { upsertProgram } from '../v5/programs';
import { deleteBuilder, getRecord, linkInstallation, saveRecord, upsertBuilder } from './builders';
import { EMPTY_RECORD, approvePath } from './record';
import { refusedWords, savedLine } from './record-tool';

after(() => sql().end());

const NOW = new Date('2026-11-06T12:00:00Z');
const ENV_KEYS = ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'EARNKIT_URL', 'EARNKIT_AUTH_SECRET'] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

let gh = 700_000;
async function installation(): Promise<number> {
  const token = 'record-' + Math.random();
  await saveInstallation(token, 'Record Agent');
  const caller = await connectInstallation(token);
  assert.ok(caller);
  return caller.id;
}
async function linked() {
  const installationId = await installation();
  const b = await upsertBuilder({ github_id: ++gh, login: 'ada' + gh, name: 'Ada', avatar_url: null }, NOW);
  await linkInstallation(installationId, b.id, NOW);
  return { installationId, builderId: b.id, now: NOW };
}

test('unlinked and sign-in not configured: linked false, no sign_in, the session-only line', async () => {
  const r = await mcpCall({ installationId: await installation(), builderId: null, now: NOW }, 'record', { get: true });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.linked, false);
  assert.equal('sign_in' in r.reply!, false);
  // L29-20 (v6.1.16 Task 15): a get says what signing in does.
  assert.equal(r.reply!.show_to_builder, 'Sign in once and I remember you.');
  const set = await mcpCall({ installationId: await installation(), builderId: null, now: NOW }, 'record', { set: { person: { name: 'Ada' } } });
  assert.equal(set.reply!.show_to_builder, "I can't save that yet, so I keep it for this chat.");
  // L29-9: a set that saved nothing is a refusal.
  assert.equal(set.isError, true);
  assert.equal(r.reply!.agent_note, 'Show the link once. Ask for a personal fact only when the next form needs it; nothing is saved until the builder has signed in. Call record with get afterwards.');
  assert.equal('record' in r.reply!, false);
});

test('unlinked and configured: the sign-in link, and nothing saved', async () => {
  Object.assign(process.env, { GITHUB_OAUTH_CLIENT_ID: 'Iv1.client', GITHUB_OAUTH_CLIENT_SECRET: 'shh', EARNKIT_URL: 'https://earnkit.test/', EARNKIT_AUTH_SECRET: 'record-test-secret' });
  const id = await installation();
  const r = await mcpCall({ installationId: id, builderId: null, now: NOW }, 'record', { set: { person: { name: 'Ada' } } });
  const again = await mcpCall({ installationId: id, builderId: null, now: new Date(NOW.getTime() + 60_000) }, 'record', { get: true });
  assert.equal(again.reply!.sign_in, r.reply!.sign_in);
  assert.equal(r.reply!.linked, false);
  const link = r.reply!.sign_in as string;
  assert.match(link, /\/link\/[A-Za-z0-9_-]{16,}$/);
  assert.ok(link.startsWith('https://earnkit.test/link/'), link);
  // R8: a set while unlinked says the fact was not saved and what to do; get keeps the plain sign-in line.
  assert.equal(r.reply!.show_to_builder, `Not saved. Sign in once at ${link}, then tell me again.`);
  assert.equal(r.isError, true);
  assert.equal(again.isError, false);
  assert.equal(again.reply!.show_to_builder, `Sign in once at ${link} and I remember you.`);
  const [n] = await sql()`SELECT count(*)::int AS n FROM link_codes WHERE installation_id = ${id}`;
  assert.equal(n.n, 1);
});

test('linked: set saves, get reads it back; before any find nothing is asked (L29-11)', async () => {
  await upsertProgram(programFixture({ id: 'record-video', needs: ['founder_video'] }), 'file', NOW);
  const c = await linked();
  const s = await mcpCall(c, 'record', { set: { person: { name: 'Ada', email: 'ada@example.com' }, projects: [{ id: 'app', repo_url: 'https://github.com/ada/app' }] } });
  assert.equal(s.isError, false, s.text);
  assert.equal(s.reply!.linked, true);
  assert.deepEqual(s.reply!.missing, []);
  // Name, email and the project's repo: three facts (a new project is not a fourth).
  assert.equal(s.reply!.show_to_builder, 'Tracked 3 facts.');
  assert.equal((await getRecord(c.builderId)).person.name, 'Ada');
  const [row] = await sql()`SELECT record_updated_at FROM builders WHERE id = ${c.builderId}`;
  assert.equal((row.record_updated_at as Date).toISOString(), NOW.toISOString());

  const g = await mcpCall(c, 'record', { get: true });
  const rec = g.reply!.record as { person: { name: string }; meta: Record<string, { set_by: string }> };
  assert.equal(rec.person.name, 'Ada');
  assert.equal(rec.meta['person.name'].set_by, 'agent');
  // C30: get and set read one list; L29-11: never the whole lack.
  assert.deepEqual(g.reply!.missing, s.reply!.missing);
  assert.match(g.reply!.show_to_builder as string, /^Your record has \d+ of \d+ items\.$/);
  assert.equal(g.reply!.agent_note, 'Call find with the project; it names what the next application needs.');
});

test('L29-11 (v6.1.16 Task 15): after a find, record get and set ask for at most the two items the next send needs', async () => {
  const c = await linked();
  await markNextNeeds(c.installationId, ['your email', 'the problem', 'your deck']);
  const g = await mcpCall(c, 'record', { get: true });
  assert.deepEqual(g.reply!.missing, ['your email', 'the problem']);
  assert.match(g.reply!.show_to_builder as string, /^Your record has \d+ of \d+ items\. The next application needs your email and the problem\.$/);
  assert.doesNotMatch(g.reply!.show_to_builder as string, /and \d+ more/);
  assert.equal(g.reply!.agent_note, 'The next application needs your email and the problem: ask the builder for them and save with record set. Ask for nothing else now.');
  assert.doesNotMatch(g.reply!.agent_note as string, /all together/);
  const s = await mcpCall(c, 'record', { set: { person: { location: 'London' } } });
  assert.equal(s.reply!.show_to_builder, 'Tracked 1 fact. Still missing: your email and the problem.');
  await markNextNeeds(c.installationId, []);
  const none = await mcpCall(c, 'record', { get: true });
  assert.deepEqual(none.reply!.missing, []);
  assert.equal(none.reply!.agent_note, 'Nothing more is needed for the next application; call find with the project for what it can apply to now.');
});

test('the Saved line: three missing items, then "and n more"; the approval note only when an approvable path changed', async () => {
  const c = await linked();
  const plain = await mcpCall(c, 'record', { set: { person: { location: 'London' } } });
  assert.equal(plain.reply!.show_to_builder, 'Tracked 1 fact.');
  assert.equal(plain.reply!.agent_note, 'Call find with the project; it names what the next application needs.');
  const ans = await mcpCall(c, 'record', { set: { answers: { problem: { text: 'Fees are high.' } } } });
  assert.match(ans.reply!.agent_note as string, /^Approved answers come from earnkit\.com\/me, where the builder reads and approves each one; an unapproved answer is never used in a form\. Call find with the project/);
});

test('set with meta or evidence_read_at: a problem line and no change', async () => {
  const c = await linked();
  await mcpCall(c, 'record', { set: { projects: [{ id: 'app', name: 'App' }], answers: { problem: { text: 'Fees.' } } } });
  const before = await getRecord(c.builderId);
  const r = await mcpCall(c, 'record', {
    set: { meta: { 'answers.problem': { set_by: 'builder', set_at: NOW.toISOString(), approved_at: NOW.toISOString() } }, projects: [{ id: 'app', evidence_read_at: NOW.toISOString() }] },
  });
  // L29-9 (v6.1.16 Task 15): nothing saved is a refusal.
  assert.equal(r.isError, true, r.text);
  assert.deepEqual(r.reply!.problems, ['meta: set by EarnKit only', 'projects.app.evidence_read_at: set by EarnKit only']);
  assert.deepEqual(await getRecord(c.builderId), before);
});

test('brief: the brief for the kind plus the record; an approved answer survives a get', async () => {
  const c = await linked();
  await mcpCall(c, 'record', { set: { answers: { problem: { text: 'Fees.' } } } });
  await saveRecord(c.builderId, approvePath(await getRecord(c.builderId), 'answers.problem', NOW), NOW);
  const r = await mcpCall(c, 'record', { brief: 'problem' });
  const brief = r.reply!.brief as { question: string; kind: string };
  assert.equal(brief.kind, 'problem');
  assert.equal(brief.question, 'What problem do you solve, for whom, and how do they handle it today?');
  const rec = r.reply!.record as { meta: Record<string, { approved_at?: string }> };
  assert.equal(rec.meta['answers.problem'].approved_at, NOW.toISOString());
});

test('the input is strict: an approve key is refused with one line, the detail in the agent note (C35)', async () => {
  const c = await linked();
  for (const args of [{ approve: 'answers.problem' }, { get: 'yes' }, { brief: 'nope' }]) {
    const r = await mcpCall(c, 'record', args);
    // L29-10 (v6.1.16 Task 15): an input error: isError, no builder text, the fix in the note.
    assert.equal(r.isError, true, r.text);
    assert.equal(r.reply!.show_to_builder, '');
    assert.match(r.reply!.agent_note as string, /^Nothing was saved\. .+; fix it and call again\.$/);
    assert.equal(r.reply!.linked, true);
  }
  const r = await mcpCall(c, 'record', { approve: 'answers.problem' });
  assert.match(r.reply!.agent_note as string, /approve/);
  assert.deepEqual((await getRecord(c.builderId)).meta, {});
});

test('B9: a set field that looks like a secret is skipped, never stored; the line says how many', async () => {
  const c = await linked();
  const key = 'sk_live_' + 'a1'.repeat(12);
  const r = await mcpCall(c, 'record', { set: { person: { name: key, email: 'ada@example.com' } } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.show_to_builder, 'Tracked 1 fact; 1 not saved: one looked like a secret.');
  const rec = await getRecord(c.builderId);
  assert.equal(rec.person.name, undefined);
  assert.equal(rec.person.email, 'ada@example.com');
  // As the route delivers it: the key already swapped for the placeholder.
  const p = await mcpCall(c, 'record', { set: { person: { name: '[key removed]', location: 'x [key removed]' } } });
  assert.equal(p.reply!.show_to_builder, 'Not saved: 2 looked like secrets.');
  assert.equal(p.isError, true);
  assert.equal((await getRecord(c.builderId)).person.name, undefined);
  const clean = await mcpCall(c, 'record', { set: { person: { name: 'Ada' } } });
  assert.doesNotMatch(clean.reply!.show_to_builder as string, /not saved/i);
});

test('the record is private: another builder reads only their own', async () => {
  const a = await linked();
  const b = await linked();
  await mcpCall(a, 'record', { set: { person: { name: 'Ada' } } });
  const g = await mcpCall(b, 'record', { get: true });
  assert.equal((g.reply!.record as { person: { name?: string } }).person.name, undefined);
});

test('two concurrent sets on different paths both land (the row lock)', async () => {
  const c = await linked();
  const [a, b] = await Promise.all([
    mcpCall(c, 'record', { set: { person: { name: 'Ada' } } }),
    mcpCall(c, 'record', { set: { company: { name: 'Ada Labs' } } }),
  ]);
  assert.equal(a.isError, false, a.text);
  assert.equal(b.isError, false, b.text);
  const r = await getRecord(c.builderId);
  assert.equal(r.person.name, 'Ada');
  assert.equal(r.company.name, 'Ada Labs');
  assert.deepEqual(Object.keys(r.meta).sort(), ['company.name', 'person.name']);
});

test('an unreadable stored record is never overwritten by a set; get reads it as empty with a problem line', async () => {
  const c = await linked();
  await sql()`UPDATE builders SET record = ${sql().json({ person: { name: 42 }, keep: 'me' })}, record_updated_at = NULL WHERE id = ${c.builderId}`;
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errors.push(a);
  try {
    const s = await mcpCall(c, 'record', { set: { person: { name: 'Ada' } } });
    assert.equal(s.isError, false, s.text);
    assert.equal(s.reply!.show_to_builder, 'Your record could not be read; nothing was saved.');
    assert.equal(s.reply!.agent_note, 'Tell the builder to open earnkit.com/me; the owner can inspect the stored row.');
    const [row] = await sql()`SELECT record, record_updated_at FROM builders WHERE id = ${c.builderId}`;
    assert.deepEqual(row.record, { person: { name: 42 }, keep: 'me' });
    assert.equal(row.record_updated_at, null);
    const g = await mcpCall(c, 'record', { get: true });
    assert.deepEqual(g.reply!.record, JSON.parse(JSON.stringify(EMPTY_RECORD)));
    assert.deepEqual(g.reply!.problems, ['stored record could not be read']);
  } finally {
    console.error = orig;
  }
  assert.ok(errors.length >= 2);
  assert.doesNotMatch(JSON.stringify(errors), /42|keep/);
});

const FORBIDDEN = /\u2014|score|rank|grade|points|coin|token|streak|_/i;
test('every missing line obeys the copy rules, and the builder line ends with a full stop', async () => {
  await upsertProgram(programFixture({
    id: 'record-all-needs', needs: ['founder_video', 'demo_video', 'resume', 'deck', 'pitch_pdf'],
    submission_requirements: ['problem', 'how_it_works', 'use_of_funds', 'what_next'].map((kind, n) => ({ key: `q${n}`, label: `Question ${n}`, type: 'text', required: false, from: 'builder', kind })) as never,
  }), 'file', NOW);
  const c = await linked();
  // L29-11 (v6.1.16 Task 15): the next send's needs, as find keeps them, at most two.
  await markNextNeeds(c.installationId, ['your founder video link', 'an approved answer on the problem']);
  for (const args of [{ get: true }, { set: { person: { location: 'London' } } }]) {
    const r = await mcpCall(c, 'record', args);
    const missing = r.reply!.missing as string[];
    assert.equal(missing.length, 2, missing.join('|'));
    for (const line of missing) {
      assert.doesNotMatch(line, FORBIDDEN, line);
      assert.match(line, /^[a-z][A-Za-z -]+[A-Za-z]$/, line);
    }
    assert.match(r.reply!.show_to_builder as string, /\.$/);
    assert.doesNotMatch(r.reply!.show_to_builder as string, FORBIDDEN);
  }
});

test('a projects entry without an id: a problem line and no change', async () => {
  const c = await linked();
  const before = await getRecord(c.builderId);
  const r = await mcpCall(c, 'record', { set: { projects: [{ name: 'No id' }] } });
  assert.equal(r.isError, true, r.text);
  const problems = r.reply!.problems as string[];
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^projects\.id: /);
  assert.equal(r.reply!.show_to_builder, 'Not saved: project short name was not valid.');
  assert.deepEqual(await getRecord(c.builderId), before);
});

test('C29: record set counts what it saved and names what it did not; never a bare Saved. when something was refused', async () => {
  const c = await linked();
  const r = await mcpCall(c, 'record', { set: { person: { name: 'Ada', email: 'not-an-email' } } });
  assert.equal(r.reply!.show_to_builder, 'Tracked 1 fact; 1 not saved: email was not valid.');
  assert.equal((await getRecord(c.builderId)).person.name, 'Ada');
  const t = await mcpCall(c, 'record', { set: { team: { lead: 'x' } } });
  assert.equal(t.reply!.show_to_builder, 'Not saved: team was not valid.');
  const same = await mcpCall(c, 'record', { set: { person: { name: 'Ada' } } });
  assert.equal(same.reply!.show_to_builder, 'Nothing new to save.');
  for (const x of [r, t, same]) {
    const show = x.reply!.show_to_builder as string;
    assert.doesNotMatch(show, /^Saved\./);
    assert.doesNotMatch(show, /person\.|\bset\b|—/);
  }
});

test('C20: an answer sent as plain text: the agent note names the shape the record takes', async () => {
  const c = await linked();
  const r = await mcpCall(c, 'record', { set: { answers: { problem: 'Fees are high.' } } });
  assert.deepEqual(r.reply!.problems, ['answers.problem: not an object']);
  assert.equal(r.reply!.show_to_builder, 'Not saved: the answer on the problem was not valid.');
  const note = r.reply!.agent_note as string;
  assert.ok(note.includes('{ kind, text }'), note);
  assert.ok(note.includes('answers: { problem: { text: "..." } }'), note);
});

test('not saved reasons name the fact in plain words, never a record key (v6.1.7 task 6 review)', () => {
  assert.equal(refusedWords('projects.0.repo_url: must be a link'), 'project repo link was not valid');
  assert.equal(refusedWords('traction.line_pre_launch: too long'), 'pre-launch line was not valid');
  assert.equal(refusedWords('projects.1.id: too long'), 'project short name was not valid');
  assert.equal(refusedWords('person.email: bad'), 'email was not valid');
});

test('C51: after the account is deleted, the next record call of a linked agent says so, once', async () => {
  const c = await linked();
  await deleteBuilder(c.builderId, NOW);
  const first = await mcpCall({ ...c, builderId: null }, 'record', { get: true });
  assert.equal(first.reply!.show_to_builder, 'Your record was deleted at earnkit.com/me; this agent is unlinked. Sign in once and I remember you.');
  const second = await mcpCall({ ...c, builderId: null }, 'record', { get: true });
  assert.equal(second.reply!.show_to_builder, 'Sign in once and I remember you.');
});

test('C50 and B17: a brief counts items, not blocks; an answer the builder rewrote (no short) asks the agent to redraft its short', async () => {
  const c = await linked();
  await mcpCall(c, 'record', { set: { answers: { problem: { text: 'Fees.' } } } });
  const r = await mcpCall(c, 'record', { brief: 'problem' });
  assert.match(r.reply!.show_to_builder as string, /^Your record has \d+ of \d+ items\.$/);
  assert.doesNotMatch(r.reply!.show_to_builder as string, /blocks/);
  assert.match(r.reply!.agent_note as string, /no short form: draft one of at most 280 characters/);
  await mcpCall(c, 'record', { set: { answers: { problem: { short: 'Fees.' } } } });
  const again = await mcpCall(c, 'record', { brief: 'problem' });
  assert.doesNotMatch(again.reply!.agent_note as string, /no short form/);
});

test('v6.1.9: record get and set always say what to do next', async () => {
  const c = await linked();
  const get = await mcpCall(c, 'record', { get: true });
  assert.equal(get.reply!.agent_note, 'Call find with the project; it names what the next application needs.');
  const nothing = await mcpCall(c, 'record', { set: {} });
  assert.equal(nothing.reply!.agent_note, 'Call find with the project; it names what the next application needs.');
});

test('#8 (v6.1.15): one save verb, Tracked, with what was kept; the refusals keep Not saved', () => {
  assert.equal(savedLine(1, [], 0), 'Tracked 1 fact.');
  assert.equal(savedLine(2, [], 0), 'Tracked 2 facts.');
  assert.equal(savedLine(2, ['person.email: not valid'], 1), 'Tracked 2 facts; 2 not saved: email was not valid and one looked like a secret.');
  assert.equal(savedLine(0, ['person.email: not valid'], 0), 'Not saved: email was not valid.');
  assert.equal(savedLine(0, [], 0), 'Nothing new to save.');
});

// v6.1.16 Task 11 (lane 24).

test('L24-5, L24-16: inherited names and every policy spelling are refused in plain words; the policy stays off', async () => {
  const c = await linked();
  const set = JSON.parse('{"__proto__":{"policy":{"auto_apply":true}},"constructor":{"policy":{"auto_apply":true}},"Policy":{"auto_apply":true},"policy.auto_apply":true,"policy":{"auto_apply":true}}');
  const r = await mcpCall(c, 'record', { set });
  const show = r.reply!.show_to_builder as string;
  // L29-4 (v6.1.16 Task 15): the policy line is the ruled one, last, with no missing list; nothing saved is a refusal.
  assert.equal(show, 'Not saved: "__proto__" is not something I keep and "constructor" is not something I keep. Standing approval is yours to turn off at earnkit.com/me. Until then say stop for a program and I hold it.');
  assert.equal(r.isError, true);
  assert.equal(show.match(/[Ss]tanding approval/g)?.length, 1);
  assert.doesNotMatch(show, /\[object Object\]|native code|function/);
  assert.equal((await getRecord(c.builderId)).policy.auto_apply, false);
  assert.equal(savedLine(0, ['projects.p1.policy: not a field'], 0), 'Not saved: standing approval is yours to set on earnkit.com/me.');
});

test('L24-21: a refusal for length names the limit; a NUL in prose is dropped and the field saves', async () => {
  const c = await linked();
  const r = await mcpCall(c, 'record', { set: { answers: { risks: { text: 'x'.repeat(2_100) } } } });
  assert.equal(r.reply!.show_to_builder, 'Not saved: risks is at most 2,000 characters.');
  const p = await mcpCall(c, 'record', { set: { person: { bio: 'Hi\u0000there ‮builder', location: 'Pu\u0000ne' } } });
  assert.equal(p.reply!.show_to_builder, 'Tracked 2 facts.');
  const rec = await getRecord(c.builderId);
  assert.equal(rec.person.bio, 'Hithere builder');
  assert.equal(rec.person.location, 'Pune');
});

test('L24-5: refusedWords never reads an inherited name', () => {
  assert.equal(refusedWords('__proto__: not a field'), '"__proto__" is not something I keep');
  assert.equal(refusedWords('toString: bad'), 'toString was not valid');
  assert.equal(refusedWords('person.constructor: not a field'), '"constructor" is not something I keep');
});

test('L29-4, L29-5, L29-20 (v6.1.16 Task 15): an agent\'s policy set, linked and unlinked: the ruled line, no missing list, isError', async () => {
  const c = await linked();
  await markNextNeeds(c.installationId, ['your email']);
  const r = await mcpCall(c, 'record', { set: { policy: { auto_apply: false } } });
  assert.equal(r.isError, true);
  assert.equal(r.reply!.show_to_builder, 'Standing approval is yours to turn off at earnkit.com/me. Until then say stop for a program and I hold it.');
  assert.equal(r.reply!.agent_note, 'Nothing was saved. On stop, call track with status held for each program named.');
  assert.equal('missing' in r.reply!, false);
  const u = await mcpCall({ installationId: await installation(), builderId: null, now: NOW }, 'record', { set: { policy: { auto_apply: false } } });
  assert.equal(u.isError, true);
  assert.equal(u.reply!.show_to_builder, 'There is no standing approval on this agent.');
});
