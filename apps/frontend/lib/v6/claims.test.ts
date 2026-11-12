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
  // L23-7 (v6.1.16): with its title and when it was started.
  assert.deepEqual((await releaseStale(owner, later)).map((x) => [x.program_id, x.title]), [['cl-1', 'Claim Grant']]);
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

test("skips and claims: a skip replaces the agent's own claim, never another agent's live one; a claim over a skip refuses; release leaves skips", async () => {
  await upsertProgram(programFixture({ id: 'cl-skip', title: 'Skip Grant' }), 'file', NOW);
  const { owner, a, c } = await builderWithTwoAgents();
  await claim(owner, 'cl-skip', 'earnkit', a, NOW);
  // L17-1 (v6.1.16): another agent's skip over a live claim records nothing and leaves the claim.
  assert.deepEqual(await record(owner, 'cl-skip', 'skipped', { installationId: c, now: new Date(NOW.getTime() + H) }),
    { ok: false, note: 'Your other agent is handling that one; nothing recorded.' });
  const [held] = await sql()`SELECT status, claimed_by FROM applications WHERE owner = ${owner} AND program_id = 'cl-skip'`;
  assert.deepEqual({ ...held }, { status: 'started', claimed_by: a });
  assert.deepEqual(await record(owner, 'cl-skip', 'skipped', { installationId: a, now: new Date(NOW.getTime() + H) }), { ok: true });
  const [row] = await sql()`SELECT status, claimed_at, claimed_by FROM applications WHERE owner = ${owner} AND program_id = 'cl-skip'`;
  assert.deepEqual({ ...row }, { status: 'skipped', claimed_at: null, claimed_by: null });
  assert.deepEqual(await claim(owner, 'cl-skip', 'earnkit', a, new Date(NOW.getTime() + 2 * H)), { ok: false, skipped: true });
  assert.deepEqual(await releaseStale(owner, new Date(NOW.getTime() + 80 * H)), []);
  const [still] = await sql()`SELECT status FROM applications WHERE owner = ${owner} AND program_id = 'cl-skip'`;
  assert.equal(still.status, 'skipped');
});

test('L1d-1 (v6.1.11): claimed returns each claim\'s stored project; L28-4 (v6.1.16 Task 14): another project claims on its own', async () => {
  await upsertProgram(programFixture({ id: 'cl-proj', title: 'Project Grant' }), 'file', NOW);
  const { owner, a, c } = await builderWithTwoAgents();
  assert.deepEqual(await claim(owner, 'cl-proj', 'https://github.com/x/a', a, NOW), { ok: true });
  assert.deepEqual((await claimed(owner)).get('cl-proj'), { since: NOW.toISOString(), by: a, project: 'https://github.com/x/a' });
  // L28-4 (v6.1.16 Task 14, re-pinned): another project of the same builder is another application: its own claim.
  const other = await claim(owner, 'cl-proj', 'https://github.com/x/b', c, new Date(NOW.getTime() + H));
  assert.equal(other.ok, true);
  // The same project from the other agent is still held off for 24 hours.
  assert.equal((await claim(owner, 'cl-proj', 'https://github.com/x/a', c, new Date(NOW.getTime() + H))).ok, false);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${owner} AND program_id = 'cl-proj'`)[0].n, 2);
});

test('L25-1 (v6.1.16): a claim held by "Claude Code (earnkit)" names it "Claude Code"; the stored name is unchanged', async () => {
  await upsertProgram(programFixture({ id: 'cl-25', title: 'Claim Name Grant' }), 'file', NOW);
  const b = await upsertBuilder({ github_id: ++gh, login: 'cl' + gh, name: 'Cl', avatar_url: null }, NOW);
  const a = await installation('Claude Code (earnkit)');
  const c = await installation('Cursor');
  await linkInstallation(a, b.id, NOW);
  await linkInstallation(c, b.id, NOW);
  const owner = ownerKey(a, b.id);
  assert.deepEqual(await claim(owner, 'cl-25', null, a, NOW, 'Drafted the pitch.'), { ok: true });
  assert.equal((await sql()`SELECT note FROM applications WHERE owner = ${owner} AND program_id = 'cl-25'`)[0].note, 'Drafted the pitch.');
  const second = await claim(owner, 'cl-25', null, c, new Date(NOW.getTime() + H));
  assert.deepEqual(second, { ok: false, already: { since: NOW.toISOString(), by: 'Claude Code', sent: false } });
  assert.equal((await sql()`SELECT client_name FROM installations WHERE id = ${a}`)[0].client_name, 'Claude Code (earnkit)');
});

test('Task 14 fix round 3b, L35-7 and L35-4 (v6.1.16.1 Task 2): two builders taking over their keyless rows onto one repo at once: a refusal moves nothing, and one claim holds the repo', async () => {
  await upsertProgram(programFixture({ id: 'cl-3b', title: 'Takeover Grant' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'cl-3c', title: 'Takeover Claim Grant' }), 'file', NOW);
  const repo = 'https://github.com/org/takeover';
  const PAST = new Date(NOW.getTime() - 30 * 3_600_000);
  const each = await Promise.all([0, 1].map(async () => {
    const b = await upsertBuilder({ github_id: ++gh, login: 'tk' + gh, name: null, avatar_url: null }, NOW);
    const i = await installation('Claude Code');
    await linkInstallation(i, b.id, NOW);
    const owner = ownerKey(i, b.id);
    assert.deepEqual(await record(owner, 'cl-3b', 'applied', { installationId: i, now: NOW }), { ok: true });
    assert.deepEqual(await claim(owner, 'cl-3c', null, i, PAST), { ok: true });
    return { owner, i };
  }));
  for (let k = 0; k < 10; k++) {
    // Both rows were sent already, so both answer "already sent"; a refusal writes nothing, so neither takes the repo.
    const r = await Promise.all(each.map((e) => claim(e.owner, 'cl-3b', repo, e.i, NOW, null, { tied: true })));
    assert.deepEqual(r.map((x) => !x.ok && 'already' in x && x.already.sent), [true, true]);
    assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE program_id = 'cl-3b' AND project_id IS NOT NULL`)[0].n, 0, `round ${k}`);
    // Two stale keyless claims: one takes the repo; the other hears its co-founder started it.
    await sql()`UPDATE applications SET project_id = NULL, repo_key = NULL, identity = NULL, claimed_at = ${PAST} WHERE program_id = 'cl-3c'`;
    const c = await Promise.all(each.map((e) => claim(e.owner, 'cl-3c', repo, e.i, NOW, null, { tied: true })));
    assert.deepEqual(c.map((x) => x.ok || 'cofounder' in x).sort(), [true, true], `round ${k}`);
    assert.equal(c.filter((x) => x.ok).length, 1, `round ${k}`);
    assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE program_id = 'cl-3c' AND repo_key = ${repo}`)[0].n, 1, `round ${k}`);
  }
});

test('L35-4, L35-3, L35-2 (v6.1.16.1 Task 2): a co-founder\'s live claim on the repo refuses a claim and writes nothing; a fork\'s claim reads the parent\'s send; a claim keeps its identity', async () => {
  await upsertProgram(programFixture({ id: 'cl-35', title: 'Co-founder Grant' }), 'file', NOW);
  const repo = 'https://github.com/org/cl35';
  const a = await builderWithTwoAgents();
  const b = await builderWithTwoAgents();
  assert.deepEqual(await claim(a.owner, 'cl-35', repo, a.a, NOW, null, { repoId: 35350, tied: true }), { ok: true });
  const [mine] = await sql()`SELECT identity FROM applications WHERE owner = ${a.owner} AND program_id = 'cl-35'`;
  assert.equal(mine.identity, 'gh:35350');
  assert.deepEqual(await claim(b.owner, 'cl-35', repo, b.a, new Date(NOW.getTime() + H), null, { repoId: 35350, tied: true }), { ok: false, cofounder: { at: NOW } });
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${b.owner}`)[0].n, 0);
  // The same repo by its id alone (a renamed link) is the same claim.
  assert.deepEqual(await claim(b.owner, 'cl-35', 'https://github.com/org/cl35-renamed', b.a, new Date(NOW.getTime() + H), null, { repoId: 35350, tied: true }), { ok: false, cofounder: { at: NOW } });
  // A claim past 24 hours is not live: the co-founder may claim.
  assert.deepEqual(await claim(b.owner, 'cl-35', repo, b.a, new Date(NOW.getTime() + 25 * H), null, { repoId: 35350, tied: true }), { ok: true });

  // A fork's claim after the parent was sent: refused, with no login (the match is by the parent).
  await upsertProgram(programFixture({ id: 'cl-35f', title: 'Fork Grant' }), 'file', NOW);
  assert.deepEqual(await record(a.owner, 'cl-35f', 'applied', { installationId: a.a, now: NOW, project_id: repo, repoId: 35350, tied: true }), { ok: true });
  const fork = await claim(b.owner, 'cl-35f', 'https://github.com/someone/cl35-fork', b.a, NOW, null, { repoId: 35351, tied: true, parentRepo: { id: 35350, key: repo } });
  assert.ok(!fork.ok && 'repo' in fork && fork.repo.login === null, JSON.stringify(fork));
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${b.owner} AND program_id = 'cl-35f'`)[0].n, 0);
});
