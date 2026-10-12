import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { enqueueClue, enqueueDiscovery, localGitInput, noteLocalGit } from './discovery';
import { rememberWallets } from './installations';

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

test('4.12 remotes become proposed repo sources (agent), once; a new one queues discovery', dbTest, async () => {
  const id = 2_100_000_000 + (process.pid % 1000);
  await sql()`DELETE FROM builder_sources WHERE builder_id = ${id}`;
  await sql()`DELETE FROM discovery_queue WHERE builder_id = ${id}`;
  const g = localGitInput({ remotes: ['https://github.com/lee/a', 'https://github.com/lee/b'] });
  assert.equal(await noteLocalGit(id, g), 2);
  assert.equal(await noteLocalGit(id, g), 0);
  const rows = await sql()<{ state: string; proposed_by: string }[]>`SELECT state, proposed_by FROM builder_sources WHERE builder_id = ${id}`;
  assert.deepEqual(new Set(rows.map((r) => `${r.state}/${r.proposed_by}`)), new Set(['proposed/agent']));
  const [q] = await sql()<{ reason: string; done_at: Date | null }[]>`SELECT reason, done_at FROM discovery_queue WHERE builder_id = ${id}`;
  assert.equal(q.reason, 'local_repo');
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

test('4.15 a new clue queues the person again: a wallet not seen before (rememberWallets), only with the flag on and a profile', dbTest, async () => {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v212-clue-${process.pid}-${Date.now()}`}) RETURNING id`;
  const wallet = (n: number) => '0x' + n.toString(16).padStart(40, '0');
  const [w1, w2] = [wallet(Date.now()), wallet(Date.now() + 1)];
  const queued = async () => (await sql()<{ reason: string; done_at: Date | null }[]>`SELECT reason, done_at FROM discovery_queue WHERE builder_id = ${id}`)[0] ?? null;
  // Flag off: v2.11, nothing is queued.
  await rememberWallets(id, [w1]);
  assert.equal(await queued(), null);
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
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
  } finally {
    delete process.env.EARNKIT_BUILDER_SCORE;
  }
});

test('4.16 the wiring: rememberWallets and saveVerification queue their clue, behind the flag', () => {
  const src = (f: string) => readFileSync(join(import.meta.dirname, f), 'utf8');
  assert.match(src('installations.ts'), /RETURNING wallet[\s\S]{0,300}builderScoreEnabled\(\)[\s\S]{0,120}enqueueClue\(installationId, 'wallet'\)/);
  assert.match(src('github-verify.ts'), /INSERT INTO github_verifications[\s\S]{0,900}builderScoreEnabled\(\)[\s\S]{0,120}enqueueClue\(row\.installation_id, 'signin'\)/);
});
