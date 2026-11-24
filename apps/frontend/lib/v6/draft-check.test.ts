/**
 * v3.8 E11 (plan item 7, cutover A8): the draft check (pure) and its storage and gate in track (`draft_check` on): an
 * agent's send without a passing check of the text sent is refused; a passing one is recorded with its final hash.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { upsertProgram } from '../v5/programs';
import { programFixture } from '../v5/fixtures/program';
import { track, trackAdvertised, TrackInput } from '../v5/track';
import { BuilderRecord, EMPTY_RECORD } from './record';
import { saveRecord, upsertBuilder } from './builders';
import { checkDraft, draftHash, numberValue } from './draft-check';
import { CHECK_FAILED, FINAL_NEEDED, NOT_CHECKED_TEXT, NO_CHECK } from './drafts';

after(() => sql().end());

const NOW = new Date('2026-11-24T09:00:00Z');
const REQS = [
  { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' },
  { key: 'pitch', label: 'Pitch', type: 'text', required: true, from: 'project', kind: 'one_liner', todo: 'a pitch', max_chars: 200 },
] as const;
const program = (id = 'dc-grant') => programFixture({ id, title: 'Orbit Builder Grants', organizer: 'Orbit Labs', submission_requirements: REQS as never });
const record = BuilderRecord.parse({
  projects: [{ id: 'p1', name: 'Pip', live_url: 'https://pip.example', last_tier: { tier: 'live', line: 'Live', read_at: '2026-11-20', usage: '1,240 distinct senders the deployer did not fund in 90 days on Base' } }],
  traction: { waitlist: 300 },
  policy: { never_claim: ['backed by a16z'] },
});

test('a clean draft passes; traction is labelled verified or builder-stated', () => {
  const c = checkDraft(program(), { project_name: 'Pip', pitch: 'Pip for Orbit Builder Grants: 1,240 senders and 300 on the waitlist. https://pip.example' }, record, { now: NOW });
  assert.deepEqual(c.problems, []);
  assert.equal(c.pass, true);
  assert.deepEqual(c.traction.map((t) => [t.value, t.label]), [['1,240', 'verified'], ['300', 'builder_stated']]);
  assert.equal(c.hash, draftHash({ pitch: 'Pip for Orbit Builder Grants: 1,240 senders and 300 on the waitlist. https://pip.example', project_name: 'Pip' }));
});

test('it lists unsupported numbers and links, length, missing fields, filler, never-claim and an unnamed program', () => {
  const c = checkDraft(program(), {
    pitch: `Pip will revolutionize payments — 50k users, backed by a16z. See https://pip.example/deck ${'x'.repeat(150)}`,
    extra: 'hi',
  }, record, { now: NOW });
  const kinds = c.problems.map((p) => `${p.kind}:${p.detail}`);
  for (const k of ['missing:Project name is required', 'unknown_field:extra is not a field on this form', 'unsupported_link:https://pip.example/deck',
    'unsupported_number:50k', 'filler:revolutionize', 'filler:em dash', 'never_claim:backed by a16z', 'too_long:'])
    assert.ok(kinds.some((x) => x.startsWith(k)), `${k} in ${kinds.join(' | ')}`);
  assert.ok(kinds.some((x) => x.startsWith('program_not_named')));
  assert.equal(c.pass, false);
  // A proof link given with the check is supported.
  assert.equal(checkDraft(program(), { project_name: 'Pip', pitch: 'Orbit Labs: see https://pip.example/deck' }, record, { proof_links: ['https://pip.example/deck/'], now: NOW }).pass, true);
});

test('numberValue reads written numbers', () => {
  assert.equal(numberValue('$5k'), 5000);
  assert.equal(numberValue('1,240'), 1240);
  assert.equal(numberValue('2.5M'), 2_500_000);
  assert.equal(numberValue('12%'), 12);
});

test('A8: off, nothing changes; on, an agent send without a passing check of the sent text is refused', async () => {
  const b = await upsertBuilder({ github_id: 660_000 + Math.floor(Math.random() * 30_000), login: 'drafty', name: null, avatar_url: null }, NOW);
  await saveRecord(b.id, { ...EMPTY_RECORD, ...record }, NOW);
  const [i] = await sql()`INSERT INTO installations (token_hash, builder_id) VALUES (${'dc-' + Math.random()}, ${b.id}) RETURNING id`;
  const c = { installationId: i.id as number, builderId: b.id, now: NOW };
  const id = `dc-${Math.random().toString(36).slice(2, 8)}`;
  await upsertProgram(program(id), 'file', NOW);
  assert.equal(trackAdvertised({}), TrackInput);
  const saved = process.env.EARNKIT_FLAGS;
  delete process.env.EARNKIT_FLAGS; // v3.8 flags-on suite: the "off" half asserts draft_check off; restored in finally
  assert.equal((await track(c, { action: 'check', program_id: id, fields: {} })).refused, true, 'off: action is unknown');

  process.env.EARNKIT_FLAGS = 'draft_check';
  try {
    const good = { project_name: 'Pip', pitch: 'Pip for Orbit Builder Grants: 1,240 senders.' };
    const notStored = await track(c, { action: 'check', program_id: id, fields: good });
    assert.match(notStored.agent_note, /Not stored: call track started/);
    await track(c, { program_id: id, status: 'started', project_id: 'p1' });
    assert.equal((await track(c, { program_id: id, status: 'applied', project_id: 'p1', final: good })).agent_note, NO_CHECK);

    const bad = await track(c, { action: 'check', program_id: id, fields: { project_name: 'Pip', pitch: 'We have 9,999 users.' } });
    assert.equal(bad.check?.pass, false);
    assert.match(bad.agent_note, /unsupported number \(9,999\)/);
    assert.equal((await track(c, { program_id: id, status: 'applied', project_id: 'p1', final: good })).agent_note, CHECK_FAILED);

    const ok = await track(c, { action: 'check', program_id: id, fields: good });
    assert.equal(ok.check?.pass, true);
    assert.match(ok.agent_note, /Stored on the application/);
    const [row] = await sql()`SELECT draft_text, draft_check->>'hash' AS hash FROM applications WHERE owner = ${`b:${b.id}`} AND program_id = ${id}`;
    assert.deepEqual(row.draft_text, good);
    assert.equal(row.hash, draftHash(good));

    const noFinal = await track(c, { program_id: id, status: 'applied', project_id: 'p1' });
    assert.equal(noFinal.refused, true);
    assert.equal(noFinal.agent_note, FINAL_NEEDED);
    const other = await track(c, { program_id: id, status: 'applied', project_id: 'p1', final: { ...good, pitch: `${good.pitch} Edited.` } });
    assert.equal(other.agent_note, NOT_CHECKED_TEXT);
    assert.equal((await sql()`SELECT status FROM applications WHERE owner = ${`b:${b.id}`} AND program_id = ${id}`)[0].status, 'started');

    const sent = await track(c, { program_id: id, status: 'applied', project_id: 'p1', final: good });
    assert.equal(sent.refused, undefined, sent.agent_note);
    const [after] = await sql()`SELECT status, final_hash FROM applications WHERE owner = ${`b:${b.id}`} AND program_id = ${id}`;
    assert.deepEqual({ ...after }, { status: 'applied', final_hash: draftHash(good) });
  } finally {
    if (saved === undefined) delete process.env.EARNKIT_FLAGS;
    else process.env.EARNKIT_FLAGS = saved;
  }
});

test("the builder's own send is not gated", async () => {
  process.env.EARNKIT_FLAGS = 'draft_check';
  try {
    const [i] = await sql()`INSERT INTO installations (token_hash) VALUES (${'dc-' + Math.random()}) RETURNING id`;
    const id = `dc-${Math.random().toString(36).slice(2, 8)}`;
    await upsertProgram(program(id), 'file', NOW);
    const r = await track({ installationId: i.id as number, builderId: null, now: NOW }, { program_id: id, status: 'applied', submitted_by: 'builder' });
    assert.equal(r.refused, undefined, r.agent_note);
  } finally {
    delete process.env.EARNKIT_FLAGS;
  }
});
