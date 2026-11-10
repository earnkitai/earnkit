import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { programFixture } from '../v5/fixtures/program';
import { connectInstallation, saveInstallation } from '../v5/installations';
import { claimed, record } from '../v5/ledger';
import { upsertProgram } from '../v5/programs';
import { linkInstallation, ownerKey, upsertBuilder } from './builders';
import { appliedOvernight, claim, releaseStale } from './claims';

after(() => sql().end());

const NOW = new Date('2026-11-06T12:00:00Z');
const H = 3_600_000;
let gh = 810_000;
async function installation(client: string): Promise<number> {
  const token = 'claims-' + Math.random();
  await saveInstallation(token, client);
  return (await connectInstallation(token))!.id;
}
async function builderWithTwoAgents() {
  const b = await upsertBuilder({ github_id: ++gh, login: 'cl' + gh, name: 'Cl', avatar_url: null }, NOW);
  const a = await installation('Claude Code');
  const c = await installation('Cursor');
  await linkInstallation(a, b.id, NOW);
  await linkInstallation(c, b.id, NOW);
  return { owner: ownerKey(a, b.id), a, c };
}

test("a second claim is refused across the builder's agents", async () => {
  await upsertProgram(programFixture({ id: 'cl-1', title: 'Claim Grant' }), 'file', NOW);
  const { owner, a, c } = await builderWithTwoAgents();
  assert.deepEqual(await claim(owner, 'cl-1', 'earnkit', a, NOW), { ok: true });
  const second = await claim(owner, 'cl-1', 'earnkit', c, new Date(NOW.getTime() + 2 * H));
  assert.deepEqual(second, { ok: false, already: { since: NOW.toISOString(), by: 'Claude Code', sent: false } });
  const [row] = await sql()`SELECT status, claimed_by, project_id FROM applications WHERE owner = ${owner} AND program_id = 'cl-1'`;
  assert.deepEqual({ ...row }, { status: 'started', claimed_by: a, project_id: 'earnkit' });

  // Inside 24 hours nothing is released; after 25 the claim goes and a new one succeeds.
  assert.deepEqual(await releaseStale(owner, new Date(NOW.getTime() + 23 * H)), []);
  const later = new Date(NOW.getTime() + 25 * H);
  assert.deepEqual(await releaseStale(owner, later), ['cl-1']);
  assert.deepEqual(await claim(owner, 'cl-1', 'earnkit', c, later), { ok: true });
});

test('a stale claim is taken over by a new one; an application already sent is not', async () => {
  await upsertProgram(programFixture({ id: 'cl-2', title: 'Stale Grant' }), 'file', NOW);
  const { owner, a, c } = await builderWithTwoAgents();
  await claim(owner, 'cl-2', null, a, NOW);
  assert.deepEqual(await claim(owner, 'cl-2', null, c, new Date(NOW.getTime() + 25 * H)), { ok: true });
  await record(owner, 'cl-2', 'applied', { installationId: c, now: new Date(NOW.getTime() + 26 * H), submitted_by: 'agent' });
  const r = await claim(owner, 'cl-2', null, a, new Date(NOW.getTime() + 27 * H));
  assert.equal(r.ok, false);
  assert.deepEqual(await releaseStale(owner, new Date(NOW.getTime() + 80 * H)), []);
});

test('appliedOvernight lists what was sent under standing approval after the last find, nothing else', async () => {
  await upsertProgram(programFixture({ id: 'cl-3', title: 'Agent Sent' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'cl-4', title: 'Builder Sent' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'cl-5', title: 'Sent Before' }), 'file', NOW);
  const { owner, a } = await builderWithTwoAgents();
  await upsertProgram(programFixture({ id: 'cl-6', title: 'Yes In Session' }), 'file', NOW);
  await record(owner, 'cl-5', 'applied', { installationId: a, now: new Date(NOW.getTime() - H), submitted_by: 'agent', autoApplied: true });
  await claim(owner, 'cl-3', 'earnkit', a, NOW);
  await record(owner, 'cl-3', 'applied', { installationId: a, now: new Date(NOW.getTime() + H), submitted_by: 'agent', fields_used: ['email', 'problem'], project_id: 'earnkit', autoApplied: true });
  await record(owner, 'cl-4', 'applied', { installationId: a, now: new Date(NOW.getTime() + H), submitted_by: 'builder' });
  // The agent sent it on a yes in the session, standing approval off: not listed.
  await record(owner, 'cl-6', 'applied', { installationId: a, now: new Date(NOW.getTime() + H), submitted_by: 'agent', autoApplied: false });
  assert.deepEqual(await appliedOvernight(owner, NOW), [{ program_id: 'cl-3', title: 'Agent Sent' }]);
  assert.deepEqual(await appliedOvernight(owner, null), []);
  // An applied over a claim keeps when it was claimed, and what was sent.
  const [row] = await sql()`SELECT claimed_at, submitted_by, fields_used, project_id FROM applications WHERE owner = ${owner} AND program_id = 'cl-3'`;
  assert.equal((row.claimed_at as Date).toISOString(), NOW.toISOString());
  assert.deepEqual({ submitted_by: row.submitted_by, fields_used: row.fields_used, project_id: row.project_id }, { submitted_by: 'agent', fields_used: ['email', 'problem'], project_id: 'earnkit' });
});

test('two claims at once from two agents of one builder: exactly one wins, one row', async () => {
  await upsertProgram(programFixture({ id: 'cl-race', title: 'Race Grant' }), 'file', NOW);
  for (let round = 0; round < 5; round++) {
    const { owner, a, c } = await builderWithTwoAgents();
    const both = await Promise.all([claim(owner, 'cl-race', 'earnkit', a, NOW), claim(owner, 'cl-race', 'earnkit', c, NOW)]);
    assert.equal(both.filter((r) => r.ok).length, 1, JSON.stringify(both));
    const lost = both.find((r) => !r.ok)!;
    assert.ok('already' in lost, JSON.stringify(lost));
    const rows = await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${owner} AND program_id = 'cl-race'`;
    assert.equal(rows[0].n, 1);
    const hist = await sql()`SELECT count(*)::int AS n FROM application_history WHERE owner = ${owner} AND program_id = 'cl-race'`;
    assert.equal(hist[0].n, 1);
  }
});

test('skips and claims: a skip replaces a claim; a claim over a skip refuses; release leaves skips', async () => {
  await upsertProgram(programFixture({ id: 'cl-skip', title: 'Skip Grant' }), 'file', NOW);
  const { owner, a, c } = await builderWithTwoAgents();
  await claim(owner, 'cl-skip', 'earnkit', a, NOW);
  assert.deepEqual(await record(owner, 'cl-skip', 'skipped', { installationId: c, now: new Date(NOW.getTime() + H) }), { ok: true });
  const [row] = await sql()`SELECT status, claimed_at, claimed_by FROM applications WHERE owner = ${owner} AND program_id = 'cl-skip'`;
  assert.deepEqual({ ...row }, { status: 'skipped', claimed_at: null, claimed_by: null });
  assert.deepEqual(await claim(owner, 'cl-skip', 'earnkit', a, new Date(NOW.getTime() + 2 * H)), { ok: false, skipped: true });
  assert.deepEqual(await releaseStale(owner, new Date(NOW.getTime() + 80 * H)), []);
  const [still] = await sql()`SELECT status FROM applications WHERE owner = ${owner} AND program_id = 'cl-skip'`;
  assert.equal(still.status, 'skipped');
});

test('L1d-1 (v6.1.11): claimed returns each claim\'s stored project; the hold stays per owner and program across projects', async () => {
  await upsertProgram(programFixture({ id: 'cl-proj', title: 'Project Grant' }), 'file', NOW);
  const { owner, a, c } = await builderWithTwoAgents();
  assert.deepEqual(await claim(owner, 'cl-proj', 'https://github.com/x/a', a, NOW), { ok: true });
  assert.deepEqual((await claimed(owner)).get('cl-proj'), { since: NOW.toISOString(), by: a, project: 'https://github.com/x/a' });
  // Another project of the same builder is still held off for 24 hours.
  const other = await claim(owner, 'cl-proj', 'https://github.com/x/b', c, new Date(NOW.getTime() + H));
  assert.equal(other.ok, false);
});
