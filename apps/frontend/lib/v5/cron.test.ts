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

test('W3 (v6.1.13 final round): the sweep drops a project report no find updated for 180 days and keeps a recent one', async () => {
  const day = 86_400_000;
  await sql()`INSERT INTO project_reports (owner, project_key, report, at) VALUES
    ('i:1', 'name:old', '{}', ${new Date(deps.now.getTime() - 181 * day)}), ('i:1', 'name:recent', '{}', ${new Date(deps.now.getTime() - 10 * day)})`;
  await cronPost(req(`Bearer ${SECRET}`), deps);
  assert.deepEqual((await sql()`SELECT project_key FROM project_reports WHERE owner = 'i:1'`).map((r) => r.project_key), ['name:recent']);
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
  const calls: { limit: number; jobId?: string; deadline?: number }[] = [];
  const res = await cronPost(req(`Bearer ${SECRET}`), { ...deps, workQueue: async (o) => (calls.push(o), { read: 0, jobs_finished: [] }) });
  const body = (await res.json()) as { screen: unknown; digest: string };
  const { swept_auth, ...rest } = body.screen as { swept_auth: Record<string, number> };
  assert.deepEqual(rest, { swept: 0, read: 0, jobs_finished: [] });
  assert.deepEqual(Object.keys(swept_auth).sort(), ['link_codes', 'sessions']);
  assert.deepEqual(calls.map((c) => [c.limit, c.jobId]), [[200, undefined]]);
  // The daily share is 300 s: the workflow's curl allows 540 s for the whole run.
  assert.ok(calls[0].deadline! > Date.now() + 290_000 && calls[0].deadline! <= Date.now() + 300_000);
  const boom = await cronPost(req(`Bearer ${SECRET}`), { ...deps, workQueue: async () => { throw new Error('x'); } });
  assert.deepEqual(await boom.json(), { error: 'screen failed' });
});

test('cronPost: the plain run sweeps screen jobs over 90 days old with their rows; a triggered run sweeps nothing', async () => {
  const at = (days: number) => new Date(deps.now.getTime() - days * 86_400_000);
  for (const [id, days] of [['old-job', 91], ['young-job', 89]] as const) {
    await sql()`INSERT INTO screen_jobs (id, program_id, builder_id, installation_id, created_at, total, expires_at)
      VALUES (${id}, 'p', 1, 1, ${at(days)}, 1, ${at(days - 30)})`;
    await sql()`INSERT INTO screen_applicants (job_id, ref, name, status) VALUES (${id}, 'r', 'R', 'done')`;
    await sql()`INSERT INTO screen_outcomes (job_id, ref, outcome) VALUES (${id}, 'r', 'won')`;
  }
  const idle = { ...deps, workQueue: async () => ({ read: 0, jobs_finished: [] }) };
  await cronPost(jsonReq({ job_id: 'old-job' }), idle);
  assert.equal((await sql()`SELECT 1 FROM screen_jobs WHERE id = 'old-job'`).length, 1);
  const body = (await (await cronPost(req(`Bearer ${SECRET}`), idle)).json()) as { screen: { swept: number } };
  assert.equal(body.screen.swept, 1);
  for (const t of ['screen_jobs', 'screen_applicants', 'screen_outcomes']) {
    const col = t === 'screen_jobs' ? 'id' : 'job_id';
    const ids = (await sql()`SELECT ${sql()(col)} AS id FROM ${sql()(t)} ORDER BY 1`).map((r) => r.id);
    assert.deepEqual(ids, ['young-job'], t);
  }
});

test('cronPost: a body that is not { job_id } answers 400 and runs nothing', async () => {
  let ran = 0;
  const watch = { ...deps, runHealth: async () => { ran++; throw new Error('must not run'); }, workQueue: async () => (ran++, { read: 0, jobs_finished: [] }) };
  const raw = (body: string) => new Request('https://earnkit.test/api/cron', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body });
  for (const body of ['{not json', JSON.stringify({ job: 'x' }), JSON.stringify({ job_id: 'x', extra: 1 }), JSON.stringify({ job_id: 7 }), JSON.stringify({ job_id: 'x'.repeat(2_000) })]) {
    const res = await cronPost(raw(body), watch);
    assert.equal(res.status, 400, body.slice(0, 40));
    assert.deepEqual(await res.json(), { error: 'bad body' });
  }
  assert.equal(ran, 0);
});

test('cronPost: the plain run sweeps link codes and sessions expired over a day ago; a triggered run sweeps nothing', async () => {
  // A day in 2000, so no other file's rows fall in the window.
  const now = new Date('2000-01-10T06:00:00Z');
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
  const rows = { 'cr-old': at(-48), 'cr-grace': at(-12), 'cr-live': at(1) };
  await sql()`DELETE FROM link_codes WHERE code LIKE 'cr-%'`;
  await sql()`DELETE FROM sessions WHERE token_hash LIKE 'cr-%'`;
  for (const [key, exp] of Object.entries(rows)) {
    await sql()`INSERT INTO link_codes (code, installation_id, created_at, expires_at) VALUES (${key}, 1, ${at(-72)}, ${exp})`;
    await sql()`INSERT INTO sessions (token_hash, builder_id, created_at, expires_at, last_seen_at) VALUES (${key}, 1, ${at(-72)}, ${exp}, ${at(-72)})`;
  }
  const quiet = {
    ...deps, now,
    runHealth: async () => ({ checked: 0, stale: [], changed: [], closed: [] }),
    sendDigest: async () => 'none' as const,
    workQueue: async () => ({ read: 0, jobs_finished: [] }),
  };
  await cronPost(jsonReq({ job_id: 'none' }), quiet);
  assert.equal((await sql()`SELECT 1 FROM link_codes WHERE code LIKE 'cr-%'`).length, 3);
  const res = await cronPost(req(`Bearer ${SECRET}`), quiet);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { screen: { swept_auth: { link_codes: number; sessions: number } } };
  assert.deepEqual(body.screen.swept_auth, { link_codes: 1, sessions: 1 });
  assert.deepEqual((await sql()`SELECT code FROM link_codes WHERE code LIKE 'cr-%' ORDER BY code`).map((r) => r.code), ['cr-grace', 'cr-live']);
  assert.deepEqual((await sql()`SELECT token_hash FROM sessions WHERE token_hash LIKE 'cr-%' ORDER BY token_hash`).map((r) => r.token_hash), ['cr-grace', 'cr-live']);
  await sql()`DELETE FROM link_codes WHERE code LIKE 'cr-%'`;
  await sql()`DELETE FROM sessions WHERE token_hash LIKE 'cr-%'`;
});
