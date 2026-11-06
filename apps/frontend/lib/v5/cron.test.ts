import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { cronPost } from './cron';
import type { Mailer } from './mail';

after(() => sql().end());

const SECRET = 'c'.repeat(40);
const req = (auth?: string) => new Request('https://earnkit.test/api/cron', { method: 'POST', headers: auth ? { authorization: auth } : {} });
let sent: Parameters<Mailer>[0][] = [];
const mailer: Mailer = async (m) => {
  sent.push(m);
};
const deps = { probe: async () => {}, page: async () => '<p>x</p>', mailer, now: new Date('2026-11-04T06:15:00Z') };

beforeEach(() => {
  sent = [];
  process.env.CRON_SECRET = SECRET;
  process.env.RESEND_API_KEY = 're_test';
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.RESEND_API_KEY;
});

test('cronPost: 401 without or with a wrong secret, 503 when CRON_SECRET is unset', async () => {
  assert.equal((await cronPost(req(), deps)).status, 401);
  assert.equal((await cronPost(req('Bearer nope'), deps)).status, 401);
  delete process.env.CRON_SECRET;
  assert.equal((await cronPost(req(`Bearer ${SECRET}`), deps)).status, 503);
});

test('cronPost: runs health then the digest and answers the counts', async () => {
  const res = await cronPost(req(`Bearer ${SECRET}`), deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { health: Record<string, number>; swept: number; digest: string };
  assert.deepEqual(Object.keys(body.health).sort(), ['changed', 'checked', 'closed', 'stale']);
  assert.equal(typeof body.swept, 'number');
  assert.ok(['sent', 'none'].includes(body.digest));
});

test('cronPost: the sweep after health drops a repo_cache row over 30 days old and answers swept', async () => {
  await sql()`INSERT INTO repo_cache (repo, facts, fetched_at) VALUES ('c/old', '{}', ${new Date(deps.now.getTime() - 40 * 86_400_000)}), ('c/new', '{}', ${deps.now})`;
  const body = (await (await cronPost(req(`Bearer ${SECRET}`), deps)).json()) as { swept: number };
  assert.equal(body.swept, 1);
  assert.deepEqual((await sql()`SELECT repo FROM repo_cache`).map((r) => r.repo), ['c/new']);
});

test('cronPost: a thrown step answers 500 with the step name only', async () => {
  const boom = { ...deps, probe: async () => {}, runHealth: async () => { throw new Error('secret detail'); } };
  const res = await cronPost(req(`Bearer ${SECRET}`), boom);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'health failed' });
  const boom2 = { ...deps, sendDigest: async () => { throw new Error('x'); } };
  const res2 = await cronPost(req(`Bearer ${SECRET}`), boom2);
  assert.deepEqual(await res2.json(), { error: 'digest failed' });
});

const jsonReq = (body: unknown) =>
  new Request('https://earnkit.test/api/cron', { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('cronPost: a run with a job_id works that job only and skips health, the sweep and the digest', async () => {
  const calls: { limit: number; jobId?: string; deadline?: number }[] = [];
  const res = await cronPost(jsonReq({ job_id: 'job-abc' }), {
    ...deps,
    runHealth: async () => { throw new Error('health must not run'); },
    sendDigest: async () => { throw new Error('digest must not run'); },
    workQueue: async (o) => (calls.push(o), { read: 3, jobs_finished: ['job-abc'] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { screen: { read: 3, jobs_finished: ['job-abc'] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 300);
  assert.equal(calls[0].jobId, 'job-abc');
  assert.ok(calls[0].deadline! > Date.now() + 590_000);
});

test('cronPost: a plain run works the queue with SCREEN_BATCH after the sweep and answers screen', async () => {
  const calls: { limit: number; jobId?: string }[] = [];
  const res = await cronPost(req(`Bearer ${SECRET}`), { ...deps, workQueue: async (o) => (calls.push(o), { read: 0, jobs_finished: [] }) });
  const body = (await res.json()) as { screen: unknown; digest: string };
  assert.deepEqual(body.screen, { read: 0, jobs_finished: [] });
  assert.deepEqual(calls.map((c) => [c.limit, c.jobId]), [[40, undefined]]);
  const boom = await cronPost(req(`Bearer ${SECRET}`), { ...deps, workQueue: async () => { throw new Error('x'); } });
  assert.deepEqual(await boom.json(), { error: 'screen failed' });
});
