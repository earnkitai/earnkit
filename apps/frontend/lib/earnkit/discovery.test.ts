import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { bindX } from './x-install';
import { discover, discoverPerson, enqueueClue, enqueueDiscovery, localGitInput, provenLogin } from './discovery';
import { rememberWallets } from './installations';
import { rescorePerson, standingOf } from './person-score';
import type { ReaderDeps } from './source-readers';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('4.11 local_git is read leniently: GitHub remotes, at most 20; emails kept as clues only; junk dropped', () => {
  assert.deepEqual(localGitInput({ emails: ['lee@x.dev', 7], remotes: ['git@github.com:Lee/A.git', 'nope', 'https://github.com/lee/b'], live_urls: ['https://a.lovable.app', 'javascript:x'] }), {
    emails: ['lee@x.dev'], remotes: ['lee/a', 'lee/b'], live_urls: ['https://a.lovable.app'],
  });
  assert.deepEqual(localGitInput('garbage'), { emails: [], remotes: [], live_urls: [] });
  assert.equal(localGitInput({ remotes: Array.from({ length: 30 }, (_, i) => `https://github.com/lee/r${i}`) }).remotes.length, 20);
});

test('4.11b live links must be public https sites; the caps apply after filtering', () => {
  const bad = ['https://localhost', 'https://127.0.0.1', 'https://10.1.2.3', 'https://172.16.0.1', 'https://172.31.9.9', 'https://192.168.1.1', 'https://169.254.169.254', 'https://[::1]', 'https://printer.local', 'https://intranet', 'http://a.example.com'];
  assert.deepEqual(localGitInput({ live_urls: bad }).live_urls, []);
  assert.deepEqual(localGitInput({ live_urls: [...bad, 'https://172.32.0.1', 'https://ok.example.com/x'] }).live_urls, ['https://172.32.0.1', 'https://ok.example.com']);
  assert.equal(localGitInput({ emails: ['bad', 'b', 'c@x.dev', 'd@x.dev', 'e@x.dev', 'f@x.dev', 'g@x.dev', 'h@x.dev'] }).emails.length, 5);
});

test('4.13 enqueue: a done person is queued again by a new clue; an open entry keeps its first reason and time', dbTest, async () => {
  const id = 2_100_001_000 + (process.pid % 1000);
  await sql()`DELETE FROM discovery_queue WHERE builder_id = ${id}`;
  await enqueueDiscovery(id, 'first_find');
  const [a] = await sql()<{ queued_at: Date }[]>`SELECT queued_at FROM discovery_queue WHERE builder_id = ${id}`;
  await enqueueDiscovery(id, 'wallet');
  const [b] = await sql()<{ reason: string; queued_at: Date }[]>`SELECT reason, queued_at FROM discovery_queue WHERE builder_id = ${id}`;
  assert.equal(b.reason, 'first_find');
  assert.equal(b.queued_at.getTime(), a.queued_at.getTime());
  await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${id}`;
  await enqueueDiscovery(id, 'signin');
  const [c] = await sql()<{ reason: string; done_at: Date | null }[]>`SELECT reason, done_at FROM discovery_queue WHERE builder_id = ${id}`;
  assert.deepEqual([c.reason, c.done_at], ['signin', null]);
});

test('4.13b first_find never re-opens a done entry; a new clue does', dbTest, async () => {
  const id = 2_100_002_000 + (process.pid % 1000);
  await sql()`DELETE FROM discovery_queue WHERE builder_id = ${id}`;
  await enqueueDiscovery(id, 'first_find');
  await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${id}`;
  await enqueueDiscovery(id, 'first_find');
  const [a] = await sql()<{ reason: string; done_at: Date | null }[]>`SELECT reason, done_at FROM discovery_queue WHERE builder_id = ${id}`;
  assert.notEqual(a.done_at, null, 'another find leaves a done entry done');
  await enqueueDiscovery(id, 'wallet');
  const [b] = await sql()<{ reason: string; done_at: Date | null }[]>`SELECT reason, done_at FROM discovery_queue WHERE builder_id = ${id}`;
  assert.deepEqual([b.reason, b.done_at], ['wallet', null]);
});

test('4.15 a new clue queues the person again: a wallet not seen before (rememberWallets), only with the flag on and a profile', dbTest, async () => {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v212-clue-${process.pid}-${Date.now()}`}) RETURNING id`;
  const wallet = (n: number) => '0x' + n.toString(16).padStart(40, '0');
  const [w1, w2] = [wallet(Date.now()), wallet(Date.now() + 1)];
  const queued = async () => (await sql()<{ reason: string; done_at: Date | null }[]>`SELECT reason, done_at FROM discovery_queue WHERE builder_id = ${id}`)[0] ?? null;
  // Flag off: v2.11, nothing is queued.
  await rememberWallets(id, [w1]);
  assert.equal(await queued(), null);
  assert.equal(await enqueueClue(id, 'wallet'), false, 'no profile yet: the first find queues them');
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`c${id}`})`;
  await sql()`INSERT INTO discovery_queue (builder_id, reason, done_at) VALUES (${id}, 'first_find', now())`;
  await rememberWallets(id, [w1, w2]);
  const w = await queued();
  assert.deepEqual([w!.reason, w!.done_at], ['wallet', null], 'a new wallet is a new clue');
  await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${id}`;
  await rememberWallets(id, [w2]);
  assert.notEqual((await queued())!.done_at, null, 'a wallet already remembered is no new clue');
  assert.equal(await enqueueClue(id, 'signin'), true);
  const s = await queued();
  assert.deepEqual([s!.reason, s!.done_at], ['signin', null]);
});

test('4.16 the wiring: rememberWallets and saveVerification queue their clue', () => {
  const src = (f: string) => readFileSync(join(import.meta.dirname, f), 'utf8');
  assert.match(src('installations.ts'), /RETURNING wallet[\s\S]{0,300}enqueueClue\(installationId, 'wallet'\)/);
  // v2.14 spec 1, 2: a GitHub login is no clue and joins no one (the App proves a repo, proveByApp).
  assert.doesNotMatch(src('github-verify.ts'), /enqueueClue|joinOnProvenTie|settleLogin/);
});

// ---- v2.12.1 Task 7: confirmed vs not yet confirmed.

const NOW = new Date('2026-10-14T10:00:00Z');
/** A ReaderDeps whose every outside read throws, so a test sees exactly the reads it overrides. */
function fakeReader(): ReaderDeps {
  const no = async (): Promise<never> => {
    throw new Error('unexpected read');
  };
  return {
    gh: no, ghGraphql: no, probe: no, fetchText: no, json: no, baseTxs: no, tokenTransfers: no, contractOrigin: no,
    arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, walletCreations: no, now: NOW,
  };
}
const randomAddress = () => '0x' + randomBytes(20).toString('hex');
/** A fresh installation with a profile, claimed with a fresh X id as `handle` (bindX clears it from any other profile). */
async function claimed(handle: string): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t7-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`t7-${id}`})`;
  const r = await bindX(id, { id: `t7${randomBytes(6).toString('hex')}`, username: handle, name: handle, avatar: null }, NOW);
  assert.equal(r.ok, true);
  return id;
}
async function withScore<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

test('7.2 v2.14: a reported login proves nothing (no X field match); what it names stays not yet confirmed', dbTest, () => withScore(async () => {
  const id = await claimed('lee_builds');
  await sql()`UPDATE builder_profiles SET reported_github = 'lee' WHERE builder_id = ${id}`;
  assert.equal(await provenLogin(id), null, 'no X field match: only the App names a login');
  await sql()`UPDATE builder_profiles SET reported_github = 'someone_else' WHERE builder_id = ${id}`;
  assert.equal(await provenLogin(id), null);
  // An unclaimed profile never matches, whatever GitHub's X field says.
  const [{ id: plain }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t7-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_handle, reported_github) VALUES (${plain}, ${`t7-${plain}`}, ${`u${plain}`}, 'lee')`;
  assert.equal(await provenLogin(plain), null);
  // The reported project is live, so it would be a ship if it were confirmed; it must stay not yet confirmed.
  const [site] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proposed_by)
    VALUES (${id}, 'site', ${`https://app${id}.example.com`}, 'someone_else/app', 'proposed', 'agent') RETURNING id`;
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${site.id}, '2026-10-13', ${sql().json({ status: 200, up: true })}, true)`;
  await rescorePerson(id, NOW);
  const [p] = await sql()<{ shipped: boolean; confirmed: boolean }[]>`SELECT shipped, confirmed FROM builder_projects WHERE builder_id = ${id} AND project_key = 'someone_else/app'`;
  assert.deepEqual({ ...p }, { shipped: true, confirmed: false });
  const s = await standingOf(id);
  assert.equal(s.ranked, false);
}));

test('7.4 a contract a signed wallet created is confirmed on the next discovery', dbTest, () => withScore(async () => {
  const id = await claimed(`wd${randomBytes(4).toString('hex')}`);
  // Random per run: a wallet is one person's, and a contract verified for an earlier run's person would be refused here.
  const [wallet, contract] = [randomAddress(), randomAddress()];
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${wallet}, ${id})`;
  const asked: string[] = [];
  const reader = {
    ...fakeReader(),
    walletCreations: async (w: string) => (asked.push(w), [{ address: contract.toUpperCase().replace(/^0X/, '0x'), created_at: '2026-09-01T00:00:00Z' }]),
    contractOrigin: async () => ({ deployer: wallet, created_at: '2026-09-01T00:00:00Z' }),
  };
  await discoverPerson(id, { deadline: Date.now() + 5000, reader });
  assert.deepEqual(asked, [wallet]);
  const [s] = await sql()`SELECT state, proof, ref FROM builder_sources WHERE builder_id = ${id} AND kind = 'contract'`;
  assert.deepEqual({ ...s }, { state: 'verified', proof: 'deploy_wallet', ref: `base:${contract}` });
  // A wallet only typed by the agent (installation_wallets) is never asked.
  const other = await claimed(`wt${randomBytes(4).toString('hex')}`);
  await rememberWallets(other, [randomAddress()]);
  const none: string[] = [];
  await discoverPerson(other, { deadline: Date.now() + 5000, reader: { ...reader, walletCreations: async (w: string) => (none.push(w), []) } });
  assert.deepEqual(none, []);
}));

// ---- v2.13.4: verdicts on one transaction; effects only after its commit (scan on f2e7d33c) --------

test('D.1 afterCommit inside withDeferred runs only after the commit, and never on a rollback', dbTest, async () => {
  const { afterCommit, withDeferred } = await import('./db');
  const ran: string[] = [];
  await withDeferred(async (tx) => {
    afterCommit(tx, () => ran.push('later'));
    assert.deepEqual(ran, [], 'not inside the open transaction');
  });
  assert.deepEqual(ran, ['later']);
  await assert.rejects(withDeferred(async (tx) => {
    afterCommit(tx, () => ran.push('never'));
    throw new Error('boom');
  }));
  assert.deepEqual(ran, ['later'], 'dropped on rollback');
  // With no deferring transaction it runs at once (every other caller's behaviour).
  afterCommit(undefined, () => ran.push('now'));
  assert.deepEqual(ran, ['later', 'now']);
});

test('D.2 a verdict that throws rolls the person back: still queued (done_at NULL), nothing verified, no success counted, no event', dbTest, () => withScore(async () => {
  const id = await claimed(`dr${randomBytes(4).toString('hex')}`);
  const [wallet, contract, second] = [randomAddress(), randomAddress(), randomAddress()];
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${wallet}, ${id})`;
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'wallet') ON CONFLICT (builder_id) DO UPDATE SET done_at = NULL`;
  // Two verdicts: the first succeeds, the second throws, so the first's event and count must not survive.
  const reader = {
    ...fakeReader(),
    walletCreations: async () => [{ address: contract, created_at: '2026-09-01T00:00:00Z' }, { address: second, created_at: '2026-09-01T00:00:00Z' }],
    contractOrigin: async () => ({ deployer: wallet, created_at: '2026-09-01T00:00:00Z' }),
  };
  // Every verdict write for this person fails (a trigger only on its rows).
  const fn = `v2134_fail_${id}`;
  await sql().unsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.builder_id = ${id} AND NEW.state = 'verified' AND NEW.ref = 'base:${second}' THEN RAISE EXCEPTION 'verdict failed'; END IF; RETURN NEW; END $$`);
  await sql().unsafe(`CREATE TRIGGER ${fn} BEFORE UPDATE ON builder_sources FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  const was = process.env.EARNKIT_EVENT_LOG;
  process.env.EARNKIT_EVENT_LOG = 'on';
  try {
    const out = await discover(NOW, { deadline: Date.now() + 5000, reader, only: [id] });
    assert.equal(out.verified, 0, 'no success counted');
    assert.equal(out.people, 0);
    const [q] = await sql()<{ done: boolean }[]>`SELECT done_at IS NOT NULL AS done FROM discovery_queue WHERE builder_id = ${id}`;
    assert.equal(q.done, false, 'still queued, retried next run');
    const states = await sql()<{ state: string }[]>`SELECT state FROM builder_sources WHERE builder_id = ${id} AND kind = 'contract'`;
    assert.deepEqual(states.map((x) => x.state), ['proposed', 'proposed'], 'the first verdict rolled back with the second');
    assert.equal((await sql()`SELECT 1 FROM builder_events WHERE installation_id = ${id} AND type = 'source_verified'`).length, 0, 'no event for what rolled back');
  } finally {
    if (was === undefined) delete process.env.EARNKIT_EVENT_LOG;
    else process.env.EARNKIT_EVENT_LOG = was;
    await sql().unsafe(`DROP TRIGGER IF EXISTS ${fn} ON builder_sources; DROP FUNCTION IF EXISTS ${fn}()`);
  }
  // Once the write works again, the next run verifies it and marks the person done.
  const again = await discover(NOW, { deadline: Date.now() + 5000, reader, only: [id] });
  assert.equal(again.verified, 2);
  const [q2] = await sql()<{ done: boolean }[]>`SELECT done_at IS NOT NULL AS done FROM discovery_queue WHERE builder_id = ${id}`;
  assert.equal(q2.done, true);
}));
