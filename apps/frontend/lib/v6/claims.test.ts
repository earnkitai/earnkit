import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { programFixture } from '../v5/fixtures/program';
import { connectInstallation, saveInstallation } from '../v5/installations';
import { record } from '../v5/ledger';
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
  assert.deepEqual(second, { ok: false, already: { since: NOW.toISOString(), by: 'Claude Code' } });
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

test('appliedOvernight lists what an agent sent after the last find, not what the builder sent', async () => {
  await upsertProgram(programFixture({ id: 'cl-3', title: 'Agent Sent' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'cl-4', title: 'Builder Sent' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'cl-5', title: 'Sent Before' }), 'file', NOW);
  const { owner, a } = await builderWithTwoAgents();
  await record(owner, 'cl-5', 'applied', { installationId: a, now: new Date(NOW.getTime() - H), submitted_by: 'agent' });
  await claim(owner, 'cl-3', 'earnkit', a, NOW);
  await record(owner, 'cl-3', 'applied', { installationId: a, now: new Date(NOW.getTime() + H), submitted_by: 'agent', fields_used: ['email', 'problem'], project_id: 'earnkit' });
  await record(owner, 'cl-4', 'applied', { installationId: a, now: new Date(NOW.getTime() + H), submitted_by: 'builder' });
  assert.deepEqual(await appliedOvernight(owner, NOW), [{ program_id: 'cl-3', title: 'Agent Sent' }]);
  assert.deepEqual(await appliedOvernight(owner, null), []);
  // An applied over a claim keeps when it was claimed, and what was sent.
  const [row] = await sql()`SELECT claimed_at, submitted_by, fields_used, project_id FROM applications WHERE owner = ${owner} AND program_id = 'cl-3'`;
  assert.equal((row.claimed_at as Date).toISOString(), NOW.toISOString());
  assert.deepEqual({ submitted_by: row.submitted_by, fields_used: row.fields_used, project_id: row.project_id }, { submitted_by: 'agent', fields_used: ['email', 'problem'], project_id: 'earnkit' });
});
