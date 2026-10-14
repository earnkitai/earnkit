import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { contractConflicts, dueSources, previousSignals, proposeSource, readSources, rejectSource, verifySource, writeReading } from './sources';
import { GitHubBudgetStop, type ReaderDeps } from './source-readers';

/** A ReaderDeps whose every outside read throws, so a test sees exactly the reads it overrides. */
function fakeReader(): ReaderDeps {
  const no = async (): Promise<never> => {
    throw new Error('unexpected read');
  };
  return { gh: no, ghGraphql: no, probe: no, fetchText: no, json: no, baseTxs: no, tokenTransfers: no, contractOrigin: no, arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, walletCreations: no, now: new Date('2026-10-14T10:00:00Z') };
}
/** The person query's answer: these repos, bare. */
const graphBody = (login: string, keys: string[]) => ({
  data: { user: { login, twitterUsername: null, websiteUrl: null, repositories: { nodes: keys.map((k) => ({ nameWithOwner: k, isFork: false, isTemplate: false, stargazers: { edges: [] }, forks: { nodes: [] }, defaultBranchRef: null })) } } },
});

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const ID = 2_100_002_000 + (process.pid % 1000);
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const OTHER = ID + 1000;
beforeEach(async () => {
  if (process.env.DATABASE_URL) await sql()`DELETE FROM builder_sources WHERE builder_id IN (${ID}, ${OTHER})`;
});

test('5.11 propose is idempotent; verify and reject set state; only verified sources are due, oldest read first', dbTest, async () => {
  const a = (await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://a.example', project_key: 'a', proposed_by: 'server' }))!;
  assert.equal(await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://a.example', project_key: 'a', proposed_by: 'server' }), null);
  const b = (await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://b.example', project_key: 'b', proposed_by: 'agent' }))!;
  const c = (await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://c.example', project_key: 'c', proposed_by: 'agent' }))!;
  await verifySource(a, 'repo_link');
  await verifySource(b, 'earnkit_txt');
  await rejectSource(c, 'ownership_unproven');
  await sql()`UPDATE builder_sources SET last_read_day = '2026-10-10' WHERE id = ${a}`;
  // A limit past every other test's never-read sources (files share the DB and run in parallel).
  const due = (await dueSources('2026-10-12', 1_000_000)).filter((s) => s.builder_id === ID).map((s) => s.id);
  assert.deepEqual(due, [b, a], 'never read first, then the oldest');
  assert.deepEqual((await dueSources('2026-10-12', 10, [ID])).map((s) => s.id), [b, a], 'only: these people');
  assert.deepEqual(await dueSources('2026-10-12', 10, []), [], 'only: nobody');
});

test('5.12 one reading per source per day; a failed read is stored with its error class and still counts as read', dbTest, async () => {
  const a = (await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://d.example', project_key: 'd', proposed_by: 'server' }))!;
  await verifySource(a, 'repo_link');
  assert.equal(await writeReading(a, ID, '2026-10-12', { ok: false, error: 'TimeoutError' }), true);
  assert.equal(await writeReading(a, ID, '2026-10-12', { ok: true, signals: { up: true } }), false);
  assert.equal((await dueSources('2026-10-12', 1000)).some((s) => s.id === a), false);
  const [r] = await sql()<{ ok: boolean; error: string }[]>`SELECT ok, error FROM source_readings WHERE source_id = ${a}`;
  assert.deepEqual([r.ok, r.error], [false, 'TimeoutError']);
});

test('5.23 a verified source can be revoked; readings are refused for any source that is not verified', dbTest, async () => {
  const a = (await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://e.example', project_key: 'e', proposed_by: 'server' }))!;
  assert.equal(await writeReading(a, ID, '2026-10-12', { ok: true, signals: {} }), false, 'proposed');
  await verifySource(a, 'earnkit_txt');
  await rejectSource(a, 'earnkit_txt_removed');
  const [row] = await sql()<{ state: string; reject_reason: string }[]>`SELECT state, reject_reason FROM builder_sources WHERE id = ${a}`;
  assert.deepEqual([row.state, row.reject_reason], ['rejected', 'earnkit_txt_removed']);
  assert.equal(await writeReading(a, ID, '2026-10-12', { ok: true, signals: {} }), false, 'revoked');
  assert.equal((await sql()`SELECT 1 FROM source_readings WHERE source_id = ${a}`).length, 0);
});

test('5.24 contract conflicts: another person\'s verified contract or deployer; the latest ok reading is the previous signals', dbTest, async () => {
  // Unique per run: another run's leftovers (another pid) must not look like a claim here.
  const tag = String(process.pid).padStart(8, '0').slice(-8);
  const ref = `base:0x${'7'.repeat(32)}${tag}`;
  const dev = `0x${'8'.repeat(32)}${tag}`;
  assert.deepEqual(await contractConflicts(ID, ref, dev), { contractTaken: false, deployerTaken: false });
  const theirs = (await proposeSource({ builder_id: OTHER, kind: 'contract', ref, project_key: 'x', proposed_by: 'server' }))!;
  assert.deepEqual(await contractConflicts(ID, ref, dev), { contractTaken: false, deployerTaken: false }, 'proposed is not a claim');
  await verifySource(theirs, 'repo_link', dev.toUpperCase().replace('0X', '0x'));
  assert.deepEqual(await contractConflicts(ID, ref.toUpperCase().replace('BASE:0X', 'base:0x'), dev), { contractTaken: true, deployerTaken: true });
  assert.deepEqual(await contractConflicts(ID, `base:0x${'9'.repeat(40)}`, null), { contractTaken: false, deployerTaken: false });
  assert.deepEqual(await contractConflicts(OTHER, ref, dev), { contractTaken: false, deployerTaken: false }, 'their own is no conflict');
  assert.equal(await previousSignals(theirs), null);
  await writeReading(theirs, OTHER, '2026-10-10', { ok: true, signals: { n: 1 } });
  await writeReading(theirs, OTHER, '2026-10-11', { ok: false, error: 'TimeoutError' });
  assert.deepEqual(await previousSignals(theirs), { n: 1 });
});

test('3.6 a failing source writes one failed reading for the day and is not read again that day', dbTest, async () => {
  const id = ID; // the file's own id; beforeEach clears its sources
  const [s] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
    VALUES (${id}, 'site', 'https://down.example.com', 'k', 'repo_link', 'verified', 'server') RETURNING id`;
  let probes = 0;
  const reader = { ...fakeReader(), probe: async () => { probes++; throw new Error('ECONNREFUSED'); } };
  const now = new Date('2026-10-14T10:00:00Z');
  await readSources(now, { deadline: Date.now() + 5000, reader, only: [id] });
  await readSources(now, { deadline: Date.now() + 5000, reader, only: [id] });
  assert.equal(probes, 1);
  const rows = await sql()`SELECT ok FROM source_readings WHERE source_id = ${s.id}`;
  assert.equal(rows.length, 1);
});

test('3.7 every repo source of one person is read by one GraphQL query', dbTest, async () => {
  const id = ID;
  const login = `lee-${process.pid}`; // github_login is unique across people: one per run
  const keys = ['a', 'b', 'c'].map((r) => `${login}/${r}`);
  await sql()`INSERT INTO builder_profiles (builder_id, slug, github_login) VALUES (${id}, ${`b-t${id}`}, ${login})
    ON CONFLICT (builder_id) DO UPDATE SET github_login = EXCLUDED.github_login`;
  for (const r of keys)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by) VALUES (${id}, 'repo', ${r}, ${r}, 'repo_owner', 'verified', 'server')`;
  let queries = 0;
  const reader = { ...fakeReader(), ghGraphql: async () => { queries++; return graphBody(login, keys); }, gh: async () => { throw new Error('no REST per repo'); } } as ReaderDeps;
  const out = await readSources(new Date('2026-10-14T10:00:00Z'), { deadline: Date.now() + 5000, reader, only: [id] });
  assert.equal(queries, 1);
  assert.equal(out.read, 3);
});

const node = (k: string, o: Record<string, unknown> = {}) => ({ nameWithOwner: k, isFork: false, isTemplate: false, stargazers: { edges: [] }, forks: { nodes: [] }, defaultBranchRef: null, ...o });
const addRepo = async (ref: string) => {
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by) VALUES (${ID}, 'repo', ${ref}, ${ref}, 'repo_owner', 'verified', 'server') RETURNING id`;
  return Number(row.id);
};
const readingOf = async (id: number) => {
  const [r] = await sql()<{ ok: boolean; error: string | null; signals: Record<string, unknown> }[]>`SELECT ok, error, signals FROM source_readings WHERE source_id = ${id}`;
  return r;
};
const setLogin = async (login: string | null) => sql()`INSERT INTO builder_profiles (builder_id, slug, github_login) VALUES (${ID}, ${`b-t${ID}`}, ${login})
    ON CONFLICT (builder_id) DO UPDATE SET github_login = EXCLUDED.github_login, reported_github = NULL`;

test('3.14 a person with 101+ repos: a tracked repo outside the newest 100 is read by name in one more call; not_found only when that is empty too', dbTest, async () => {
  const login = `lea-${process.pid}`;
  await setLogin(login);
  const newest = Array.from({ length: 100 }, (_, i) => `${login}/n${i}`);
  const old = await addRepo(`${login}/old`);
  const gone = await addRepo(`${login}/gone`);
  const listed = await addRepo(newest[7]);
  const calls: Record<string, unknown>[] = [];
  const reader = {
    ...fakeReader(),
    ghGraphql: async <T,>(_q: string, v: Record<string, unknown>): Promise<T> => {
      calls.push(v);
      if (v.login) return graphBody(login, newest) as T;
      return { data: { r0: node(`${login}/old`, { stargazerCount: 3 }), r1: null } } as T;
    },
  } as ReaderDeps;
  const out = await readSources(new Date('2026-10-14T10:00:00Z'), { deadline: Date.now() + 5000, reader, only: [ID] });
  assert.equal(calls.length, 2, 'the person query, then one by-name call');
  assert.deepEqual([calls[1].n0, calls[1].n1], ['old', 'gone']);
  assert.deepEqual(out, { read: 2, failed: 1 });
  assert.equal((await readingOf(old)).ok, true);
  assert.equal((await readingOf(listed)).ok, true);
  assert.deepEqual([(await readingOf(gone)).ok, (await readingOf(gone)).error], [false, 'not_found']);
});

test('3.15 commit weeks join the previous good reading (more than 100 commits), the last 52 weeks only', dbTest, async () => {
  const login = `leb-${process.pid}`;
  await setLogin(login);
  const id = await addRepo(`${login}/busy`);
  await writeReading(id, ID, '2026-10-13', { ok: true, signals: { commit_weeks: ['2025-W30', '2026-W20', '2026-W39'] } });
  await sql()`UPDATE builder_sources SET last_read_day = '2026-10-13' WHERE id = ${id}`;
  // The newest 100 commits (hourly) reach back only to W41; W20 and W39 come from the previous reading.
  const commits = Array.from({ length: 100 }, (_, i) => ({ committedDate: new Date(Date.parse('2026-10-14T09:00:00Z') - i * 3_600_000).toISOString() }));
  const reader = {
    ...fakeReader(),
    ghGraphql: async <T,>(): Promise<T> =>
      ({ data: { user: { login, repositories: { nodes: [node(`${login}/busy`, { defaultBranchRef: { target: { history: { nodes: commits } } } })] } } } }) as T,
  } as ReaderDeps;
  await readSources(new Date('2026-10-14T10:00:00Z'), { deadline: Date.now() + 5000, reader, only: [ID] });
  const r = await sql()<{ signals: { commit_weeks: string[] } }[]>`SELECT signals FROM source_readings WHERE source_id = ${id} AND day = '2026-10-14'`;
  assert.deepEqual(r[0].signals.commit_weeks, ['2026-W20', '2026-W39', '2026-W41', '2026-W42'], '2025-W30 is older than 52 weeks');
});

test('3.16 an org repo is read by name plus one contributors call; no login means no person query', dbTest, async () => {
  await setLogin(null);
  const org = await addRepo(`acme-${process.pid}/tool`);
  const own = await addRepo(`someone-${process.pid}/app`);
  const calls: Record<string, unknown>[] = [];
  const rest: string[] = [];
  const reader = {
    ...fakeReader(),
    ghGraphql: async <T,>(_q: string, v: Record<string, unknown>): Promise<T> => {
      calls.push(v);
      return { data: { r0: node(`acme-${process.pid}/tool`, { owner: { __typename: 'Organization', login: 'acme' } }), r1: node(`someone-${process.pid}/app`) } } as T;
    },
    gh: async <T,>(path: string): Promise<T> => {
      rest.push(path);
      return [{ login: 'Lee' }, { login: 'Ann' }] as T;
    },
  } as ReaderDeps;
  const out = await readSources(new Date('2026-10-14T10:00:00Z'), { deadline: Date.now() + 5000, reader, only: [ID] });
  assert.deepEqual(out, { read: 2, failed: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].login, undefined, 'no person query without a login');
  assert.deepEqual(rest, [`/repos/acme-${process.pid}/tool/contributors?per_page=100`]);
  assert.deepEqual(((await readingOf(org)).signals.contributors as { id: string }[]).map((c) => c.id), ['gh:lee', 'gh:ann']);
  assert.deepEqual((await readingOf(own)).signals.contributors, []);
});

test('3.17 a source of an untracked project is not due', dbTest, async () => {
  const id = await addRepo(`lec-${process.pid}/quiet`);
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, tracked)
    VALUES (${ID}, ${`lec-${process.pid}/quiet`}, 'quiet', 'code', true, true, false)
    ON CONFLICT (builder_id, project_key) DO UPDATE SET tracked = false`;
  assert.equal((await dueSources('2026-10-14', 100, [ID])).some((s) => s.id === id), false);
  await sql()`UPDATE builder_projects SET tracked = true WHERE builder_id = ${ID} AND project_key = ${`lec-${process.pid}/quiet`}`;
  assert.equal((await dueSources('2026-10-14', 100, [ID])).some((s) => s.id === id), true);
  await sql()`DELETE FROM builder_projects WHERE builder_id = ${ID}`;
});

test('3.18 npm in bulk: a package npm has no data for is a failed no_data reading', dbTest, async () => {
  const add = async (ref: string) => {
    const [row] = await sql()<{ id: string }[]>`
      INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by) VALUES (${ID}, 'package_npm', ${ref}, 'k', 'repo_link', 'verified', 'server') RETURNING id`;
    return Number(row.id);
  };
  const a = await add(`ek-a-${process.pid}`);
  const b = await add(`ek-b-${process.pid}`);
  const urls: string[] = [];
  const reader = {
    ...fakeReader(),
    json: async <T,>(u: string): Promise<T> => {
      urls.push(u);
      return { [`ek-a-${process.pid}`]: { downloads: 12 }, [`ek-b-${process.pid}`]: null } as T;
    },
  } as ReaderDeps;
  assert.deepEqual(await readSources(new Date('2026-10-14T10:00:00Z'), { deadline: Date.now() + 5000, reader, only: [ID] }), { read: 1, failed: 1 });
  assert.equal(urls.length, 1);
  assert.deepEqual((await readingOf(a)).signals, { weekly: 12, repo_url: null });
  assert.deepEqual([(await readingOf(b)).ok, (await readingOf(b)).error], [false, 'no_data']);
});

test('3.19 a spent GitHub budget on the person query writes no reading: the repos stay due', dbTest, async () => {
  const login = `led-${process.pid}`;
  await setLogin(login);
  const a = await addRepo(`${login}/one`);
  const b = await addRepo(`${login}/two`);
  const reader = { ...fakeReader(), ghGraphql: async () => { throw new GitHubBudgetStop(); } } as ReaderDeps;
  assert.deepEqual(await readSources(new Date('2026-10-14T10:00:00Z'), { deadline: Date.now() + 5000, reader, only: [ID] }), { read: 0, failed: 0 });
  assert.equal((await sql()`SELECT 1 FROM source_readings WHERE source_id IN (${a}, ${b})`).length, 0);
  const due = (await dueSources('2026-10-14', 100, [ID])).map((s) => s.id);
  assert.ok(due.includes(a) && due.includes(b), 'still due');
});

test('3.20 a malformed repo ref fails alone; the valid ones are still read by name', dbTest, async () => {
  await setLogin(null);
  const bad = await addRepo('a--b/x');
  const good = await addRepo(`lee-${process.pid}/fine`);
  const reader = {
    ...fakeReader(),
    ghGraphql: async <T,>(_q: string, v: Record<string, unknown>): Promise<T> => {
      assert.deepEqual([v.o0, v.n0, v.o1], [`lee-${process.pid}`, 'fine', undefined]);
      return { data: { r0: node(`lee-${process.pid}/fine`) } } as T;
    },
  } as ReaderDeps;
  assert.deepEqual(await readSources(new Date('2026-10-14T10:00:00Z'), { deadline: Date.now() + 5000, reader, only: [ID] }), { read: 1, failed: 1 });
  assert.deepEqual([(await readingOf(bad)).ok, (await readingOf(bad)).error], [false, 'not_a_repo']);
  assert.equal((await readingOf(good)).ok, true);
});
