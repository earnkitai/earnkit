import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { programFixture } from '../v5/fixtures/program';
import { mcpCall } from '../v5/fixtures/mcp-call';
import { connectInstallation, saveInstallation } from '../v5/installations';
import { upsertProgram } from '../v5/programs';
import { deleteBuilder, getRecord, linkInstallation, saveRecord, upsertBuilder } from './builders';
import { EMPTY_RECORD, approvePath } from './record';
import { listWords } from './reply-words';
import { refusedWords } from './record-tool';

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
  assert.equal(r.reply!.show_to_builder, "I can't save that yet, so I keep it for this chat.");
  assert.equal(r.reply!.agent_note, 'Show the link once. Ask for personal facts once, all together, when a form needs them; nothing is saved until the builder has signed in. Call record with get afterwards.');
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
  assert.equal(again.reply!.show_to_builder, `Sign in once at ${link} so I remember you across agents.`);
  const [n] = await sql()`SELECT count(*)::int AS n FROM link_codes WHERE installation_id = ${id}`;
  assert.equal(n.n, 1);
});

test('linked: set saves, get reads it back; missing lists the founder video when a program needs it', async () => {
  await upsertProgram(programFixture({ id: 'record-video', needs: ['founder_video'] }), 'file', NOW);
  const c = await linked();
  const s = await mcpCall(c, 'record', { set: { person: { name: 'Ada', email: 'ada@example.com' }, projects: [{ id: 'app', repo_url: 'https://github.com/ada/app' }] } });
  assert.equal(s.isError, false, s.text);
  assert.equal(s.reply!.linked, true);
  const missing = s.reply!.missing as string[];
  assert.ok(missing.includes('your founder video link'), missing.join('|'));
  // Name, email and the project's repo: three facts (a new project is not a fourth).
  assert.match(s.reply!.show_to_builder as string, /^Saved 3\. Still missing: [^.]+\.$/);
  assert.equal((await getRecord(c.builderId)).person.name, 'Ada');
  const [row] = await sql()`SELECT record_updated_at FROM builders WHERE id = ${c.builderId}`;
  assert.equal((row.record_updated_at as Date).toISOString(), NOW.toISOString());

  const g = await mcpCall(c, 'record', { get: true });
  const rec = g.reply!.record as { person: { name: string }; meta: Record<string, { set_by: string }> };
  assert.equal(rec.person.name, 'Ada');
  assert.equal(rec.meta['person.name'].set_by, 'agent');
  assert.ok((g.reply!.missing as string[]).includes('your founder video link'));
  // C30: get and set say what is missing with one line, from one list.
  assert.deepEqual(g.reply!.missing, s.reply!.missing);
  assert.equal(g.reply!.show_to_builder, `Your record is missing: ${listWords(missing)}.`);
});

test('the Saved line: three missing items, then "and n more"; the approval note only when an approvable path changed', async () => {
  const c = await linked();
  const plain = await mcpCall(c, 'record', { set: { person: { location: 'London' } } });
  assert.match(plain.reply!.show_to_builder as string, /^Saved 1\. Still missing: your name, your email, a project with its repo or site and \d+ more\.$/);
  assert.equal(plain.reply!.agent_note, '');
  const ans = await mcpCall(c, 'record', { set: { answers: { problem: { text: 'Fees are high.' } } } });
  assert.equal(ans.reply!.agent_note, 'Approved answers come from earnkit.com/me, where the builder reads and approves each one; an unapproved answer is never used in a form.');
});

test('set with meta or evidence_read_at: a problem line and no change', async () => {
  const c = await linked();
  await mcpCall(c, 'record', { set: { projects: [{ id: 'app', name: 'App' }], answers: { problem: { text: 'Fees.' } } } });
  const before = await getRecord(c.builderId);
  const r = await mcpCall(c, 'record', {
    set: { meta: { 'answers.problem': { set_by: 'builder', set_at: NOW.toISOString(), approved_at: NOW.toISOString() } }, projects: [{ id: 'app', evidence_read_at: NOW.toISOString() }] },
  });
  assert.equal(r.isError, false, r.text);
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
    assert.equal(r.isError, false, r.text);
    assert.equal(r.reply!.show_to_builder, 'I could not read that. Send the facts to save, or ask for the record.');
    assert.match(r.reply!.agent_note as string, /^Nothing was saved\. /);
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
  assert.match(r.reply!.show_to_builder as string, /^Saved 1; 1 not saved: one looked like a secret\. Still missing: /);
  const rec = await getRecord(c.builderId);
  assert.equal(rec.person.name, undefined);
  assert.equal(rec.person.email, 'ada@example.com');
  // As the route delivers it: the key already swapped for the placeholder.
  const p = await mcpCall(c, 'record', { set: { person: { name: '[key removed]', location: 'x [key removed]' } } });
  assert.match(p.reply!.show_to_builder as string, /^Not saved: 2 looked like secrets\. Still missing: /);
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
  for (const args of [{ get: true }, { set: { person: { location: 'London' } } }]) {
    const r = await mcpCall(c, 'record', args);
    const missing = r.reply!.missing as string[];
    assert.ok(missing.length >= 9, missing.join('|'));
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
  assert.equal(r.isError, false, r.text);
  const problems = r.reply!.problems as string[];
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^projects\.id: /);
  assert.match(r.reply!.show_to_builder as string, /^Not saved: project short name was not valid\. /);
  assert.deepEqual(await getRecord(c.builderId), before);
});

test('C29: record set counts what it saved and names what it did not; never a bare Saved. when something was refused', async () => {
  const c = await linked();
  const r = await mcpCall(c, 'record', { set: { person: { name: 'Ada', email: 'not-an-email' } } });
  assert.match(r.reply!.show_to_builder as string, /^Saved 1; 1 not saved: email was not valid\. Still missing: /);
  assert.equal((await getRecord(c.builderId)).person.name, 'Ada');
  const t = await mcpCall(c, 'record', { set: { team: { lead: 'x' } } });
  assert.match(t.reply!.show_to_builder as string, /^Not saved: team was not valid\. /);
  const same = await mcpCall(c, 'record', { set: { person: { name: 'Ada' } } });
  assert.match(same.reply!.show_to_builder as string, /^Nothing new to save\. /);
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
  assert.match(r.reply!.show_to_builder as string, /^Not saved: the answer on the problem was not valid\. /);
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
  assert.equal(first.reply!.show_to_builder, "Your record was deleted at earnkit.com/me; this agent is unlinked. I can't save that yet, so I keep it for this chat.");
  const second = await mcpCall({ ...c, builderId: null }, 'record', { get: true });
  assert.equal(second.reply!.show_to_builder, "I can't save that yet, so I keep it for this chat.");
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
