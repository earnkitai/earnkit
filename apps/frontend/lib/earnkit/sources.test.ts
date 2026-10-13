import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { contractConflicts, dueSources, previousSignals, proposeSource, readSources, rejectSource, verifySource, writeReading } from './sources';
import type { ReaderDeps } from './source-readers';

/** A ReaderDeps whose every outside read throws, so a test sees exactly the reads it overrides. */
function fakeReader(): ReaderDeps {
  const no = async (): Promise<never> => {
    throw new Error('unexpected read');
  };
  return { gh: no, ghGraphql: no, probe: no, fetchText: no, json: no, baseTxs: no, tokenTransfers: no, contractOrigin: no, arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, now: new Date('2026-10-14T10:00:00Z') };
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
