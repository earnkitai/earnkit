import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { rootOf } from './identity';
import { dueSources } from './sources';
import { identityInput, noteIdentity } from './identity-input';
import { ensureProfile } from './profiles';
import { connectInstallation, saveInstallation, sharedGroup } from './installations';
import { yesNo, handlers } from './tools';

process.env.EARNKIT_AUTH_SECRET ??= 'identity-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  // Task 17: this file's programs never outlive the run.
  if (process.env.DATABASE_URL) await dropRunPrograms();
  if (process.env.DATABASE_URL) await sql().end();
});

// ---- Pure

test('v2.8.1 §E18: yes and no in the forms agents pass them', () => {
  for (const y of [true, 1, 'yes', 'Yes.', ' y ', 'sure', 'OK']) assert.equal(yesNo(y), true, String(y));
  for (const n of [false, 0, 'no', 'No!', 'nope', 'not now']) assert.equal(yesNo(n), false, String(n));
  for (const u of [undefined, null, 'maybe', '', 2, {}]) assert.equal(yesNo(u), null, String(u));
});

// ---- With the database

const stamp = () => `${process.pid}-${Date.now()}-${randomBytes(3).toString('hex')}`;
async function install(o: { github_user?: string; wallet?: string; shared?: boolean } = {}) {
  const token = `ek_test_${stamp()}`;
  await saveInstallation(token, undefined, o.shared ?? false);
  const caller = (await connectInstallation(token))!;
  if (o.github_user) await sql()`UPDATE installations SET github_user = ${o.github_user} WHERE id = ${caller.own}`;
  if (o.wallet) await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${caller.own}, ${o.wallet.toLowerCase()})`;
  return { token, id: caller.own };
}
async function entry(installationId: number, repo: string | null, o: { wallet?: string } = {}) {
  const programId = `idt-${stamp()}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${programId}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed')`;
  const [row] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, installation_id, repo_url, creator_wallet)
    VALUES (${programId}, 'Tip Jar', ${installationId}, ${repo}, ${o.wallet ?? null}) RETURNING id`;
  return row.id;
}

test('v2.8.1 §E17: the per-agent launch floor is the shared one when the group has a hosted install', db, async () => {
  const plain = await install();
  const hosted = await install({ shared: true });
  assert.equal(await sharedGroup(plain.id), false);
  assert.equal(await sharedGroup(hosted.id), true);
  // v2.14: no merge links groups any more; a pre-v2.14 group (builder_id) with a hosted member is shared.
  await sql()`UPDATE installations SET builder_id = ${Math.min(plain.id, hosted.id)} WHERE id = ${Math.max(plain.id, hosted.id)}`;
  assert.equal(await sharedGroup(Math.min(plain.id, hosted.id)), true);
});

// ---- v2.12.1 Task 5: the identity input (v2.14: no merges)

const NOW = new Date('2026-10-14T12:00:00Z');
/** Runs `fn` with the event log on (the file's other cases run with it off). */
async function scoreOn<T>(fn: () => Promise<T>): Promise<T> {
  const was = { log: process.env.EARNKIT_EVENT_LOG };
  process.env.EARNKIT_EVENT_LOG = 'on';
  try {
    return await fn();
  } finally {
    if (was.log === undefined) delete process.env.EARNKIT_EVENT_LOG;
    else process.env.EARNKIT_EVENT_LOG = was.log;
  }
}
const person = async () => (await install()).id;

test('5.2 noteIdentity proposes agent sources and remembers the reported login, never as proof', db, () =>
  scoreOn(async () => {
    const id = await person();
    await ensureProfile(id, NOW);
    await noteIdentity(id, identityInput({ github_login: 'lee', projects: [{ name: 'TipJar', what: 'a tip jar', repo: 'lee/tipjar', live_url: 'https://tip.example.com' }] }), NOW);
    const [p] = await sql()`SELECT github_login, reported_github, identity->'projects'->0->>'what' AS what FROM builder_profiles WHERE builder_id = ${id}`;
    assert.deepEqual({ ...p }, { github_login: null, reported_github: 'lee', what: 'a tip jar' });
    const s = await sql()`SELECT kind, state, proposed_by FROM builder_sources WHERE builder_id = ${id} ORDER BY kind`;
    assert.deepEqual(s.map((r) => `${r.kind}:${r.state}:${r.proposed_by}`), ['repo:proposed:agent', 'site:proposed:agent']);
    const [e] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'identity_given' AND installation_id = ${id}`;
    assert.equal(e.n, 1);
    // Again the same day: no second event; the reported login is unchanged, so no new discovery.
    await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${id}`;
    await noteIdentity(id, identityInput({ github_login: 'lee', projects: [] }), NOW);
    const [e2] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'identity_given' AND installation_id = ${id}`;
    assert.equal(e2.n, 1);
    const [q] = await sql()<{ done: boolean }[]>`SELECT done_at IS NOT NULL AS done FROM discovery_queue WHERE builder_id = ${id}`;
    assert.equal(q.done, true);
  }));

test('5.2b noteIdentity proposes packages and chain-named contracts with their project key; wallets are remembered, never proven', db, () =>
  scoreOn(async () => {
    const id = await person();
    await ensureProfile(id, NOW);
    const w = '0x' + randomBytes(20).toString('hex');
    const c = 'base:0x' + randomBytes(20).toString('hex');
    await noteIdentity(id, identityInput({ projects: [{ name: 'Lib', package: 'left-pad' }, { name: 'Py', package: 'pypi:requests' }, { name: 'Coin', contracts: [c] }], wallets: [w] }), NOW);
    const s = await sql()`SELECT kind, ref, project_key FROM builder_sources WHERE builder_id = ${id} ORDER BY kind, ref`;
    assert.deepEqual(s.map((r) => `${r.kind}:${r.ref}:${r.project_key}`), [`contract:${c}:${c}`, 'package_npm:left-pad:left-pad', 'package_pypi:requests:pypi:requests']);
    const [iw] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM installation_wallets WHERE installation_id = ${id} AND wallet = ${w}`;
    assert.equal(iw.n, 1);
    const [pw] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM person_wallets WHERE wallet = ${w}`;
    assert.equal(pw.n, 0);
  }));

test('5.3 the same reported login or wallet on two installations never joins them', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    const w = '0x' + randomBytes(20).toString('hex');
    for (const id of [a, b]) {
      await ensureProfile(id, NOW);
      await noteIdentity(id, identityInput({ github_login: 'lee', wallets: [w] }), NOW);
    }
    assert.notEqual(await rootOf(a), await rootOf(b));
  }));

test('5.14 a later find without identity keeps the last one', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    await noteIdentity(b, identityInput({ projects: [{ name: 'TipJar', what: 'a tip jar', repo: 'lee/tipjar' }] }), NOW);
    await noteIdentity(b, identityInput(undefined), NOW);
    const [kept] = await sql()`SELECT identity->'projects'->0->>'name' AS n FROM builder_profiles WHERE builder_id = ${b}`;
    assert.equal(kept.n, 'TipJar');
  }));

test('5.14b (final fix wave) two agents of one person: each report merges by project; a login-only or partial find never erases names or words', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    // v2.14: b is attached to a's page (as attachToX attaches a second agent alone).
    await sql()`UPDATE installations SET builder_id = ${a} WHERE id = ${b}`;
    const root = await rootOf(a);
    assert.equal(await rootOf(b), root);
    // The first agent sees all three projects.
    await noteIdentity(root, identityInput({
      github_login: 'lee',
      projects: [
        { name: 'TipJar', what: 'a tip jar', repo: 'lee/tipjar' },
        { name: 'Recipes', what: 'a recipe planner', live_url: 'https://recipes.example.com' },
        { name: 'Budget', what: 'a budget tracker', live_url: 'https://budget.example.com' },
      ],
    }), NOW);
    // The second agent sees only one, described its own way; then a find with only the login.
    await noteIdentity(root, identityInput({ projects: [{ name: 'Budget', what: 'a money planner', live_url: 'https://budget.example.com' }] }), NOW);
    await noteIdentity(root, identityInput({ github_login: 'lee' }), NOW);
    const [p] = await sql()<{ identity: { github_login: string | null; projects: { name: string; what: string | null }[] } }[]>`
      SELECT identity FROM builder_profiles WHERE builder_id = ${root}`;
    assert.deepEqual(
      p.identity.projects.map((x) => `${x.name}: ${x.what}`).sort(),
      ['Budget: a money planner', 'Recipes: a recipe planner', 'TipJar: a tip jar'],
      'merged by project key, the newest words win per project',
    );
    assert.equal(p.identity.github_login, 'lee');
  }));

test('5.15 agent proposals are capped at 25 projects per person, in one insert; only reported or tracked ones are read, verified first', db, () =>
  scoreOn(async () => {
    const id = await person();
    await ensureProfile(id, NOW);
    const first = identityInput({ projects: Array.from({ length: 25 }, (_, k) => ({ name: `a${k}`, live_url: `https://a${k}-${id}.example.com` })) });
    assert.equal((await noteIdentity(id, first, NOW)).proposed, 25);
    const more = identityInput({ projects: Array.from({ length: 5 }, (_, k) => ({ name: `b${k}`, live_url: `https://b${k}-${id}.example.com` })) });
    assert.equal((await noteIdentity(id, more, NOW)).proposed, 0, 'a 26th project is refused');
    const [n] = await sql()<{ n: number }[]>`SELECT count(DISTINCT project_key)::int AS n FROM builder_sources WHERE builder_id = ${id} AND proposed_by = 'agent'`;
    assert.equal(n.n, 25);
    // The latest report names only b0..b4 (none proposed). Final fix wave: reports merge, so the
    // stored report keeps b0..b4 first, then a0..a19 (25 at most); a20..a24 fell out of it and are
    // read only when tracked (none is).
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${`https://a3-${id}.example.com`}, 'a3', 'app', false, false)`;
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${`https://a22-${id}.example.com`}, 'a22', 'app', false, false)`;
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, state, proof) VALUES (${id}, 'repo', ${`v${id}/x`}, ${`v${id}/x`}, 'server', 'verified', 'github_signin')`;
    const due = await dueSources('2999-01-01', 1000, [id]);
    const named = Array.from({ length: 20 }, (_, k) => `https://a${k}-${id}.example.com`);
    assert.deepEqual(due.map((s) => s.ref), [`v${id}/x`, ...named.slice(0, 20), `https://a22-${id}.example.com`], 'verified first, then the reported and tracked proposals');
    await noteIdentity(id, first, NOW);
    assert.equal((await dueSources('2999-01-01', 1000, [id])).length, 26, 'the latest report names them all again');
  }));

test('5.10 find takes identity and never offers a pickup', db, async () => {
  const repo = `https://github.com/pk${process.pid}${Date.now()}/tipjar`;
  const owner = repo.split('/')[3];
  const earlier = await install({ github_user: owner });
  await entry(earlier.id, repo);
  const ctx = (id: number) => ({ installationId: id, ownInstallationId: id, sharedClient: false }) as never;
  const on = await install();
  await scoreOn(async () => {
    const out = (await handlers.list_programs({ github_user: owner, identity: { github_login: owner, projects: [{ name: 'TipJar', what: 'a tip jar', repo }] } }, ctx(on.id))) as Record<string, unknown>;
    assert.ok(!JSON.stringify(out).includes('Pick up'), JSON.stringify(out));
    const [p] = await sql()`SELECT reported_github FROM builder_profiles WHERE builder_id = ${on.id}`;
    assert.equal(p.reported_github, owner);
  });
});
