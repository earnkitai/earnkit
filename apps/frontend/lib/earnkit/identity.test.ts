import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { JOIN_QUESTIONS, JOIN_QUESTIONS_JOINER, answerJoin, joinOnProvenTie, linkInstallations, pendingJoinOf, rootOf } from './identity';
import { dueSources } from './sources';
import { loginContests, loginStands } from './login-contests';
import { identityInput, noteIdentity } from './identity-input';
import { ensureProfile } from './profiles';
import { connectInstallation, saveInstallation, sharedGroup } from './installations';
import { readBank } from './answer-bank';
import { PICKUP_TEXT, yesNo, handlers } from './tools';
import { TECHNICAL_TERMS } from './token-launch';

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

test('v2.8.1 §E18: pickup copy: no em dashes, no tool or file names, never "coin"', () => {
  for (const [k, t] of Object.entries(PICKUP_TEXT)) {
    assert.doesNotMatch(t, /—/, k);
    assert.doesNotMatch(t, TECHNICAL_TERMS, k);
    assert.doesNotMatch(t, /pick_up_entries|\bcoin/i, k);
  }
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

test('final fix wave (M3): linking keeps the earlier-submitted entry per program and repo; no duplicates', db, async () => {
  const a = await install();
  const b = await install();
  const programId = `idt-${stamp()}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${programId}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed')`;
  const add = async (inst: number, repo: string | null, name: string, ago: string) =>
    (await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, repo_url, submitted_at)
      VALUES (${programId}, ${name}, ${inst}, ${repo}, now() - ${ago}::interval) RETURNING id`)[0].id;
  // The same repo entered from both agents (b's first), the same no-repo project, and one distinct entry.
  const rootLater = await add(a.id, 'https://github.com/dup-x/app', 'App', '1 hour');
  const otherEarlier = await add(b.id, 'https://GitHub.com/dup-x/app/', 'App', '2 hours');
  const rootNamed = await add(a.id, null, 'Tip Jar', '3 hours');
  const otherNamed = await add(b.id, null, 'tip jar', '1 hour');
  const distinct = await add(b.id, 'https://github.com/dup-x/other', 'Other', '1 hour');
  assert.equal(await linkInstallations(b.id, [a.id]), 3);
  const owner = async (id: number) => (await sql()<{ i: number }[]>`SELECT installation_id AS i FROM projects WHERE id = ${id}`)[0].i;
  assert.equal(await owner(otherEarlier), a.id, 'the earlier entry is the group\'s');
  assert.equal(await owner(rootLater), b.id, 'the later duplicate leaves the group\'s entries');
  assert.equal(await owner(rootNamed), a.id);
  assert.equal(await owner(otherNamed), b.id);
  assert.equal(await owner(distinct), a.id);
});

test('v2.8.1 §E18: linking merges groups: rows move to the oldest root, clashes keep the newer answer, members follow', db, async () => {
  const a = await install();
  const b = await install();
  const c = await install();
  await entry(a.id, null);
  await entry(b.id, null);
  await entry(c.id, null);
  await sql()`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id, updated_at) VALUES
    (${a.id}, 'k', 'team', 'old', 'p', now() - interval '1 day'), (${b.id}, 'k', 'team', 'new', 'p', now())`;
  await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${b.id}, ${'0x' + 'e'.repeat(40)})`;
  // b and c first, then a joins (a is older, so it becomes the root).
  assert.equal(await linkInstallations(c.id, [b.id]), 2);
  assert.equal((await connectInstallation(c.token))!.id, b.id);
  assert.equal(await linkInstallations(a.id, [b.id]), 3);
  for (const t of [a, b, c]) assert.equal((await connectInstallation(t.token))!.id, a.id);
  assert.equal((await readBank(a.id, 'k')).get('team'), 'new');
  const [w] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM installation_wallets WHERE installation_id = ${a.id}`;
  assert.equal(w.n, 1);
});

test('v2.8.1 §E17: the per-agent launch floor is the shared one when the group has a hosted install', db, async () => {
  const plain = await install();
  const hosted = await install({ shared: true });
  assert.equal(await sharedGroup(plain.id), false);
  assert.equal(await sharedGroup(hosted.id), true);
  await linkInstallations(hosted.id, [plain.id]);
  assert.equal(await sharedGroup(Math.min(plain.id, hosted.id)), true);
});

// ---- v2.9 T12 (Ruling G0): the v2.8.1 deferred minors

const launchedOn = (projectId: number, repo: string) =>
  sql()`
    UPDATE projects SET token_url = ${`https://tokens.fun/coin/0x${randomBytes(20).toString('hex')}`}, token_status = 'launched',
      token_repo_key = ${repo.replace('https://', '').toLowerCase()}
    WHERE id = ${projectId}`;

test('G0 N3: linking keeps the duplicate that holds the repo\'s token in the group, even when it was submitted later', db, async () => {
  const a = await install();
  const b = await install();
  const programId = `idt-${stamp()}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${programId}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed')`;
  const repo = `https://github.com/dup-n3/app-${stamp()}`;
  const add = async (inst: number, ago: string) =>
    (await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, repo_url, submitted_at)
      VALUES (${programId}, 'App', ${inst}, ${repo}, now() - ${ago}::interval) RETURNING id`)[0].id;
  const earlier = await add(a.id, '2 hours');
  const laterWithToken = await add(b.id, '1 hour');
  await launchedOn(laterWithToken, repo);
  assert.equal(await linkInstallations(b.id, [a.id]), 1);
  const owner = async (id: number) => (await sql()<{ i: number }[]>`SELECT installation_id AS i FROM projects WHERE id = ${id}`)[0].i;
  assert.equal(await owner(laterWithToken), a.id, 'the entry with the token stays in the group\'s entries');
  assert.equal(await owner(earlier), b.id);
});

// ---- v2.12.1 Task 5: the identity input and merges on proven ties only

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
    assert.equal(await joinOnProvenTie(a, { github_login: 'lee' }), 0);
    assert.notEqual(await rootOf(a), await rootOf(b));
  }));

test('5.4 (fix rounds 1, 2) a GitHub login another group already proved asks both groups; only both yeses join, and the older page stays', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    const login = `lee-${b}`;
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    await sql()`UPDATE builder_profiles SET x_user_id = ${`9${b}`}, x_handle = ${`h${b}`.slice(0, 15)}, claimed_at = now(), github_login = ${login}, github_basis = 'signin' WHERE builder_id = ${b}`;
    const [{ slug: older }] = await sql()<{ slug: string }[]>`SELECT slug FROM builder_profiles WHERE builder_id = ${a}`;
    assert.equal(await joinOnProvenTie(a, { github_login: login }), 1, 'one group asked');
    assert.notEqual(await rootOf(a), await rootOf(b), 'nothing joins before both say yes');
    assert.deepEqual(await pendingJoinOf(b), { installation_id: a, tie: 'github_login', side: 'target' });
    assert.deepEqual(await pendingJoinOf(a), { installation_id: a, tie: 'github_login', side: 'joiner' });
    assert.equal(await answerJoin(b, true), 'waiting');
    assert.notEqual(await rootOf(a), await rootOf(b), 'one yes never joins');
    assert.equal(await pendingJoinOf(b), null, 'answered');
    assert.equal(await answerJoin(a, true), 'linked');
    const root = await rootOf(a);
    assert.equal(root, await rootOf(b));
    assert.equal(await pendingJoinOf(root), null);
    // The older group (the earliest installation) keeps its page: a newer claim never takes it over.
    // The proven login fills its gap (as in v2.12); v2.12.1 T12: the slug stays (an internal key).
    const [p] = await sql()`SELECT slug, x_user_id, x_handle, github_login FROM builder_profiles WHERE builder_id = ${root}`;
    assert.deepEqual({ ...p }, { slug: older, x_user_id: null, x_handle: null, github_login: login });
  }));

test('5.13 (round 2 addendum) a merge keeps hide and held from either side: hide wins, a held score stays under review', db, () =>
  scoreOn(async () => {
    for (const side of ['root', 'other'] as const) {
      const [a, b] = [await person(), await person()];
      await ensureProfile(a, NOW);
      await ensureProfile(b, NOW);
      const [{ slug }] = await sql()<{ slug: string }[]>`SELECT slug FROM builder_profiles WHERE builder_id = ${a}`;
      await sql()`UPDATE builder_profiles SET held = true, hidden = true WHERE builder_id = ${side === 'root' ? a : b}`;
      // The merge itself (answerJoin's link after both yeses; its consent checks are 5.12's and v2134-onboarding's).
      await linkInstallations(b, [a]);
      const [p] = await sql()`SELECT slug, held, hidden FROM builder_profiles WHERE builder_id = ${await rootOf(a)}`;
      assert.deepEqual({ ...p }, { slug, held: true, hidden: true }, side);
    }
  }));

test('5.14 a later find without identity keeps the last one; a merge keeps the side whose report has projects', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    await noteIdentity(b, identityInput({ projects: [{ name: 'TipJar', what: 'a tip jar', repo: 'lee/tipjar' }] }), NOW);
    await noteIdentity(b, identityInput(undefined), NOW);
    const [kept] = await sql()`SELECT identity->'projects'->0->>'name' AS n FROM builder_profiles WHERE builder_id = ${b}`;
    assert.equal(kept.n, 'TipJar');
    await sql()`UPDATE builder_profiles SET identity = ${sql().json({ github_login: null, projects: [], wallets: [] })} WHERE builder_id = ${a}`;
    await linkInstallations(a, [b]);
    const [m] = await sql()`SELECT identity->'projects'->0->>'name' AS n FROM builder_profiles WHERE builder_id = ${await rootOf(a)}`;
    assert.equal(m.n, 'TipJar');
  }));

test('5.14b (final fix wave) two agents of one person: each report merges by project; a login-only or partial find never erases names or words', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    await linkInstallations(a, [b]);
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

test('5.16 a merge moves the other\'s coin moments (a clash keeps the root\'s)', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    await sql()`INSERT INTO coin_moments (builder_id, project_key, moment) VALUES (${a}, 'k', 'built_live'), (${b}, 'k', 'countable'), (${b}, 'j', 'first_five')`;
    await linkInstallations(a, [b]);
    const root = Math.min(a, b);
    const rows = await sql()`SELECT builder_id, project_key, moment FROM coin_moments WHERE builder_id IN (${a}, ${b}) ORDER BY project_key`;
    assert.deepEqual(rows.map((r) => `${r.builder_id}:${r.project_key}:${r.moment}`), [`${root}:j:first_five`, `${root}:k:${root === a ? 'built_live' : 'countable'}`]);
  }));

test('5.5 two people claimed with different X accounts are never joined by a GitHub tie', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    for (const id of [a, b]) {
      await ensureProfile(id, NOW);
      await sql()`UPDATE builder_profiles SET x_user_id = ${`8${id}`}, x_handle = ${`k${id}`.slice(0, 15)}, claimed_at = now() WHERE builder_id = ${id}`;
    }
    await sql()`UPDATE builder_profiles SET github_login = ${`ann-${b}`}, github_basis = 'signin' WHERE builder_id = ${b}`;
    assert.equal(await joinOnProvenTie(a, { github_login: `ann-${b}` }), 0);
    assert.notEqual(await rootOf(a), await rootOf(b));
  }));

test('5.6 a login proven only by the X field match never joins anyone', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    await sql()`UPDATE builder_profiles SET github_login = ${`zed-${b}`}, github_basis = 'x_match' WHERE builder_id = ${b}`;
    assert.equal(await joinOnProvenTie(a, { github_login: `zed-${b}` }), 0);
  }));

test('5.7 a shared client never joins', db, async () => {
  const login = `sh-${stamp()}`.slice(0, 39);
  const a = (await install({ shared: true })).id;
  const b = await person();
  await scoreOn(async () => {
    await ensureProfile(b, NOW);
    await sql()`UPDATE builder_profiles SET github_login = ${login}, github_basis = 'signin' WHERE builder_id = ${b}`;
    assert.equal(await joinOnProvenTie(a, { github_login: login }), 0);
  });
});

test('5.8 merging moves claim codes and proven wallets, drops the loser\'s live score and projects, and re-reads the root', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    const w = '0x' + randomBytes(20).toString('hex');
    const code = `c-${stamp()}`;
    await sql()`INSERT INTO claim_codes (code_hash, builder_id) VALUES (${code}, ${b})`;
    await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${w}, ${b})`;
    for (const id of [a, b]) {
      await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
        VALUES (${id}, 10, '{}'::jsonb, false, 0, 0, 'v2', 'c', now(), now())`;
      await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, 'k', 'K', 'code', false, false)`;
    }
    await linkInstallations(a, [b]);
    const root = Math.min(a, b);
    const other = Math.max(a, b);
    const [cc] = await sql()`SELECT builder_id FROM claim_codes WHERE code_hash = ${code}`;
    assert.equal(cc.builder_id, root);
    const [pw] = await sql()`SELECT builder_id FROM person_wallets WHERE wallet = ${w}`;
    assert.equal(pw.builder_id, root);
    assert.equal((await sql()`SELECT 1 FROM builder_live WHERE builder_id = ${other}`).length, 0);
    assert.equal((await sql()`SELECT 1 FROM builder_projects WHERE builder_id = ${other}`).length, 0);
    const [live] = await sql()`SELECT read_at FROM builder_live WHERE builder_id = ${root}`;
    assert.equal(live.read_at, null);
  }));

test('5.9 linking never merges two people with different X accounts (pickup or any other path)', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    for (const id of [a, b]) {
      await ensureProfile(id, NOW);
      await sql()`UPDATE builder_profiles SET x_user_id = ${`7${id}`}, x_handle = ${`m${id}`.slice(0, 15)}, claimed_at = now() WHERE builder_id = ${id}`;
    }
    await linkInstallations(a, [b]);
    assert.notEqual(await rootOf(a), await rootOf(b));
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

test('5.11 a deploy wallet the agent typed joins no one (held for the owner\'s ruling: it is agent-reported)', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    const w = '0x' + randomBytes(20).toString('hex');
    for (const id of [a, b])
      await sql()`INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd, owner_wallet)
        VALUES (${id}, ${`installation:${id}`}, ${`o/r${id}`}, 'base', ${`0x${randomBytes(32).toString('hex')}`}, 'deployed', 0, ${w})`;
    assert.equal(await joinOnProvenTie(a, { deploy_wallet: w }), 0);
    assert.notEqual(await rootOf(a), await rootOf(b));
  }));

// ---- Fix round 2: contested GitHub logins, and every merge path needs both yeses

test('5.19 the admin page lists contested logins with a confirm button per group (POST rule_login)', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../../app/admin/scores/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /loginContests\(\)/);
  assert.match(page, /name="action" value="rule_login"/);
});

// ---- v2.12.1 Task 6 carries (binding): the X claim against contested logins, dormant installs, the joiner's question

test('6.13 reverse phish with X: an attacker holding a victim\'s login claims their own X, and GitHub\'s X field names the victim\'s X: still not confirmed', db, async () => {
  const { saveVerification } = await import('./github-verify');
  const { bindX } = await import('./claim');
  await scoreOn(async () => {
    const login = `rx-${stamp()}`.slice(0, 39);
    const victimX = `vx${process.pid}`.slice(0, 15);
    const user = { login, created_at: new Date('2020-01-01'), public_repos: 3 };
    const signIn = (id: number) => saveVerification({ installation_id: id, project_id: null, repo_key: `${login}/app`, purpose: 'entry', wallet: null, symbol: null }, user, NOW);
    const [attacker, victim] = [await person(), await person()];
    for (const id of [attacker, victim]) await ensureProfile(id, NOW);
    await signIn(attacker); // the victim completed the attacker's link first
    await signIn(victim);
    // The attacker claims their own X, and its prefill is the victim's X (GitHub's field). v2.12.1
    // T12: nothing writes a prefill into x_handle any more (setXHandle is gone).
    await bindX(attacker, { id: `7${attacker}`, username: `ax${attacker}`.slice(0, 15), name: 'A', avatar: null }, NOW);
    await sql()`UPDATE builder_profiles SET github_login = ${login}, github_basis = 'signin', twitter_prefill = ${victimX} WHERE builder_id = ${attacker}`;
    const [p] = await sql()`SELECT x_handle FROM builder_profiles WHERE builder_id = ${attacker}`;
    assert.equal(p.x_handle, `ax${attacker}`.slice(0, 15));
    assert.equal(await loginStands(attacker, login, victimX), false);
    // A handle written straight into x_handle without a claim never stands either.
    await sql()`UPDATE builder_profiles SET x_handle = ${victimX} WHERE builder_id = ${victim}`;
    assert.equal(await loginStands(victim, login, victimX), false, 'unclaimed: no X claim, no standing');
  });
});

test('6.14 (fix round 1) a dormant prover still contests: an old install that proved the login is a second group, and neither stands', db, async () => {
  const { saveVerification } = await import('./github-verify');
  const { contestants } = await import('./login-contests');
  await scoreOn(async () => {
    const login = `dm-${stamp()}`.slice(0, 39);
    const user = { login, created_at: new Date('2020-01-01'), public_repos: 3 };
    const signIn = (id: number) => saveVerification({ installation_id: id, project_id: null, repo_key: `${login}/app`, purpose: 'entry', wallet: null, symbol: null }, user, NOW);
    const [old, fresh] = [await person(), await person()];
    await signIn(old);
    await sql()`UPDATE installations SET last_seen_at = now() - interval '31 days' WHERE id = ${old}`;
    await ensureProfile(fresh, NOW);
    await signIn(fresh);
    assert.deepEqual(await contestants(login), [old, fresh].sort((a, b) => a - b));
    assert.equal(await loginStands(fresh, login, null), false, 'contested: no one stands without a ruling or a matching X claim');
    assert.ok((await loginContests()).some((c) => c.login === login));
  });
});

test('6.15 the joining agent\'s question reads for the agent that just signed in; the holder keeps "Another agent ..."', () => {
  assert.equal(JOIN_QUESTIONS.github_login, 'Another agent signed in as your GitHub. Add it to your page?');
  assert.equal(JOIN_QUESTIONS.x_user_id, 'Another agent signed in with your X. Add it to your page?');
  for (const q of Object.values(JOIN_QUESTIONS_JOINER)) {
    assert.match(q, /Add this agent to your EarnKit page\?$/);
    assert.equal((q.match(/\?/g) ?? []).length, 1);
    assert.doesNotMatch(q, /—|–|^Another agent/);
  }
});
