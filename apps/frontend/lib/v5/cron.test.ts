import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { cronPost, HEALTH_BUDGET_MS, RUN_BUDGET_MS } from './cron';
import { errorCode } from './health';
import { SafeFetchError } from './safe-fetch';
import type { Mailer } from './mail';
import { programFixture } from './fixtures/program';
import { upsertProgram } from './programs';
import { watchCatalogRevalidation } from './programs-read';
import { workQueue } from '../v6/screen-worker';
import { evidence, liveRows } from '../v6/fixtures/evidence-builder';

after(() => sql().end());

const SECRET = 'c'.repeat(40);
const req = (auth?: string) => new Request('https://earnkit.test/api/cron', { method: 'POST', headers: auth ? { authorization: auth } : {} });
let sent: Parameters<Mailer>[0][] = [];
const mailer: Mailer = async (m) => {
  sent.push(m);
};
const deps = { link: async () => ({ ok: true as const, page: '<p>x</p>' }), mailer, now: new Date('2026-11-04T06:15:00Z') };
type Body = {
  health: Record<string, number> | null; swept: Record<string, number | null>; screen: { read: number; requeued: number; left: number; jobs_finished: string[] } | null;
  digest: string | null; failed: { id: string | null; step: string; error: string }[];
};
const quietHealth = async () => ({ checked: 0, stale: [], changed: [], closed: [], opened: [], unreadable: [], failed: [], form_unread: [] });
const idleQueue = async () => ({ read: 0, requeued: 0, left: 0, jobs_finished: [] });
/** A statement trigger that refuses every DELETE on `table` (a sweep that fails). */
const refuseDeletes = async (table: string) => {
  await sql().unsafe(`CREATE OR REPLACE FUNCTION cr_refuse() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql`);
  await sql().unsafe(`CREATE TRIGGER cr_refuse_${table} BEFORE DELETE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION cr_refuse()`);
};
const allowDeletes = (table: string) => sql().unsafe(`DROP TRIGGER IF EXISTS cr_refuse_${table} ON ${table}`);
const quietLog = async <T>(run: () => Promise<T>): Promise<T> => {
  const was = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = was;
  }
};

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

test('L42-3: a CRON_SECRET with a trailing newline accepts the right bearer; 31 characters and a newline is still not set up', async () => {
  process.env.CRON_SECRET = `${SECRET}\n`;
  assert.equal((await cronPost(req('Bearer nope'), deps)).status, 401);
  assert.equal((await cronPost(req(`Bearer ${SECRET}`), { ...deps, runHealth: quietHealth, workQueue: idleQueue })).status, 200);
  process.env.CRON_SECRET = `${'c'.repeat(31)}\n`;
  const was = console.error;
  console.error = () => {};
  try {
    assert.equal((await cronPost(req(`Bearer ${'c'.repeat(31)}`), deps)).status, 503);
  } finally {
    console.error = was;
  }
});

test('cronPost: runs every step and answers the counts, the swept counts per table and an empty failed list (L30-13: the shape is pinned)', async () => {
  const res = await cronPost(req(`Bearer ${SECRET}`), deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.deepEqual(Object.keys(body), ['health', 'swept', 'screen', 'digest', 'failed']);
  // v6.1.19 (L44-16): form_unread counts the forms whose landing page could not be read.
  assert.deepEqual(Object.keys(body.health!), ['checked', 'stale', 'changed', 'closed', 'opened', 'unreadable', 'form_unread']);
  assert.deepEqual(Object.keys(body.swept), ['repo_cache', 'reports', 'screens', 'link_codes', 'sessions', 'oauth_codes', 'oauth_clients', 'evidence', 'windows', 'outcome_asks']);
  assert.ok(Object.values(body.swept).every((n) => typeof n === 'number'));
  assert.deepEqual(Object.keys(body.screen!), ['read', 'requeued', 'left', 'jobs_finished']);
  assert.ok(['sent', 'none'].includes(body.digest!));
  assert.deepEqual(body.failed, []);
});

test('cronPost: the digest says mail off when RESEND_API_KEY is unset (L30-5)', async () => {
  delete process.env.RESEND_API_KEY;
  const body = (await (await cronPost(req(`Bearer ${SECRET}`), deps)).json()) as Body;
  assert.equal(body.digest, 'mail off');
  assert.equal(sent.length, 0);
});

test('cronPost: the sweep after health drops a repo_cache row over 30 days old and answers swept', async () => {
  await sql()`INSERT INTO repo_cache (repo, facts, fetched_at) VALUES ('c/old', '{}', ${new Date(deps.now.getTime() - 40 * 86_400_000)}), ('c/new', '{}', ${deps.now})`;
  const body = (await (await cronPost(req(`Bearer ${SECRET}`), deps)).json()) as Body;
  assert.equal(body.swept.repo_cache, 1);
  assert.deepEqual((await sql()`SELECT repo FROM repo_cache`).map((r) => r.repo), ['c/new']);
});

test('W3 (v6.1.13 final round), re-pinned by L23-12 (v6.1.16): the 180-day sweep keeps every project report and confirmed step; only cached evidence goes', async () => {
  const day = 86_400_000;
  await sql()`INSERT INTO project_reports (owner, project_key, report, at) VALUES
    ('i:1', 'name:old', '{}', ${new Date(deps.now.getTime() - 181 * day)}), ('i:1', 'name:recent', '{}', ${new Date(deps.now.getTime() - 10 * day)})`;
  await sql()`INSERT INTO gaps_done (owner, installation_id, project_key, program_id, item, at) VALUES ('i:1', 1, 'name:old', 'p', 'rule:abc', ${new Date(deps.now.getTime() - 181 * day)})`;
  await sql()`INSERT INTO evidence_cache (key, kind, rows, read_at) VALUES ('w3:old', 'repo', '[]', ${new Date(deps.now.getTime() - 181 * day)})`;
  const body = (await (await cronPost(req(`Bearer ${SECRET}`), { ...deps, runHealth: quietHealth, workQueue: idleQueue })).json()) as Body;
  assert.equal(body.swept.reports, 1);
  assert.deepEqual((await sql()`SELECT project_key FROM project_reports WHERE owner = 'i:1' ORDER BY 1`).map((r) => r.project_key), ['name:old', 'name:recent']);
  assert.equal((await sql()`SELECT 1 FROM gaps_done WHERE owner = 'i:1' AND project_key = 'name:old'`).length, 1);
  assert.equal((await sql()`SELECT 1 FROM evidence_cache WHERE key = 'w3:old'`).length, 0);
  await sql()`DELETE FROM gaps_done WHERE owner = 'i:1'`;
  await sql()`DELETE FROM project_reports WHERE owner = 'i:1'`;
});

test('L30-4: a health error is listed and the sweeps, the queue and the digest still run; the error is a code only', async () => {
  let queued = 0;
  const res = await quietLog(() => cronPost(req(`Bearer ${SECRET}`), {
    ...deps,
    runHealth: async () => { throw new TypeError('bad https://x.example/p?token=secret'); },
    workQueue: async () => (queued++, { read: 0, requeued: 0, left: 0, jobs_finished: [] }),
  }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.health, null);
  assert.deepEqual(body.failed, [{ id: null, step: 'health', error: 'error' }]);
  assert.equal(queued, 1);
  assert.ok(['sent', 'none'].includes(body.digest!));
});

test('L30-4: a sweep error still lets the screen step and the digest run, with failed naming sweep_repo', async () => {
  let queued = 0;
  let digests = 0;
  await refuseDeletes('repo_cache');
  try {
    const res = await quietLog(() => cronPost(req(`Bearer ${SECRET}`), {
      ...deps, runHealth: quietHealth,
      workQueue: async () => (queued++, { read: 5, requeued: 0, left: 0, jobs_finished: [] }),
      sendDigest: async () => (digests++, 'none' as const),
    }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as Body;
    // L23-12 (v6.1.16): the 180-day sweep of cached evidence reads repo_cache too, so it fails with it; the rest run.
    assert.deepEqual(body.failed, [{ id: null, step: 'sweep_repo', error: 'db' }, { id: null, step: 'sweep_reports', error: 'db' }]);
    assert.equal(body.swept.repo_cache, null);
    assert.equal(body.swept.reports, null);
    assert.equal(typeof body.swept.screens, 'number');
    assert.deepEqual([queued, digests, body.screen!.read, body.digest], [1, 1, 5, 'none']);
  } finally {
    await allowDeletes('repo_cache');
  }
});

test('L30-3: a health write refused for one program closes the others and that one, and lists its id', async () => {
  for (const id of ['cr-w1', 'cr-w2', 'cr-w3']) await upsertProgram(programFixture({ id, ends_at: '2026-11-04T06:00:00Z' }), 'file', deps.now);
  await sql().unsafe(`CREATE OR REPLACE FUNCTION cr_health() RETURNS trigger AS $$ BEGIN
    IF NEW.program_id = 'cr-w2' THEN RAISE EXCEPTION 'refused'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await sql().unsafe(`CREATE TRIGGER cr_health BEFORE INSERT OR UPDATE ON program_health FOR EACH ROW EXECUTE FUNCTION cr_health()`);
  try {
    const res = await quietLog(() => cronPost(req(`Bearer ${SECRET}`), { ...deps, workQueue: idleQueue }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as Body;
    assert.deepEqual(body.failed, [{ id: 'cr-w2', step: 'health', error: 'db' }]);
    assert.equal(body.health!.closed, 3);
    const st = await sql()`SELECT id, status FROM programs WHERE id LIKE 'cr-w%' ORDER BY id`;
    assert.deepEqual(st.map((r) => r.status), ['closed', 'closed', 'closed']);
  } finally {
    await sql().unsafe('DROP TRIGGER cr_health ON program_health');
  }
});

test('L30-4: a digest error after the closes reads failed digest with status 200', async () => {
  const res = await quietLog(() => cronPost(req(`Bearer ${SECRET}`), { ...deps, workQueue: idleQueue, sendDigest: async () => { throw new Error('x'); } }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(body.digest, null);
  assert.deepEqual(body.failed, [{ id: null, step: 'digest', error: 'error' }]);
});

test('L30-4: 500 only when every step failed', async () => {
  const tables = ['repo_cache', 'project_reports', 'screen_jobs', 'link_codes', 'evidence_cache', 'rate_windows', 'outcome_asks'];
  for (const t of tables) await refuseDeletes(t);
  try {
    const res = await quietLog(() => cronPost(req(`Bearer ${SECRET}`), {
      ...deps,
      runHealth: async () => { throw new Error('h'); },
      workQueue: async () => { throw new Error('q'); },
      sendDigest: async () => { throw new Error('d'); },
    }));
    assert.equal(res.status, 500);
    const body = (await res.json()) as Body;
    assert.deepEqual(body.failed.map((f) => f.step), ['health', 'sweep_repo', 'sweep_reports', 'sweep_screens', 'sweep_auth', 'sweep_evidence', 'sweep_windows', 'sweep_asks', 'screen', 'digest']);
  } finally {
    for (const t of tables) await allowDeletes(t);
  }
});

test('budget: RUN_BUDGET_MS is 420 s; the queue gets min(300 s, the deadline less 20 s); past the deadline it is skipped as budget while the sweeps and the digest run', async () => {
  assert.equal(RUN_BUDGET_MS, 420_000);
  let t = 1_000_000;
  const calls: { deadline?: number }[] = [];
  const slowHealth = (ms: number) => async () => ((t += ms), quietHealth());
  const q = async (o: { deadline?: number }) => (calls.push(o), { read: 0, requeued: 0, left: 0, jobs_finished: [] });
  await cronPost(req(`Bearer ${SECRET}`), { ...deps, clock: () => t, runHealth: slowHealth(45_000), workQueue: q });
  assert.equal(calls[0].deadline, 1_000_000 + 45_000 + 300_000);
  t = 1_000_000;
  await cronPost(req(`Bearer ${SECRET}`), { ...deps, clock: () => t, runHealth: slowHealth(200_000), workQueue: q });
  assert.equal(calls[1].deadline, 1_000_000 + 420_000 - 20_000);
  t = 1_000_000;
  let digests = 0;
  const res = await cronPost(req(`Bearer ${SECRET}`), {
    ...deps, clock: () => t, runHealth: slowHealth(420_000), workQueue: q, sendDigest: async () => (digests++, 'none' as const),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.equal(calls.length, 2);
  assert.deepEqual(body.failed, [{ id: null, step: 'screen', error: 'budget' }]);
  assert.equal(body.screen, null);
  assert.equal(digests, 1);
  assert.equal(typeof body.swept.repo_cache, 'number');
});

test('budget: a share of 600 queued after a 200 s walk stops at the deadline, the run returns before 420 s and answers read and left', async () => {
  await upsertProgram(programFixture({ id: 'cr-q' }), 'file', deps.now);
  await sql()`INSERT INTO screen_jobs (id, program_id, builder_id, installation_id, created_at, total, expires_at)
    VALUES ('cr-job', 'cr-q', 1, 1, ${new Date(deps.now.getTime() - 3_600_000)}, 600, ${new Date(deps.now.getTime() + 30 * 86_400_000)})`;
  await sql()`INSERT INTO program_reviewers (program_id, builder_id) VALUES ('cr-q', 1) ON CONFLICT DO NOTHING`;
  for (let i = 0; i < 600; i++)
    await sql()`INSERT INTO screen_applicants (job_id, ref, name, live_url, status) VALUES ('cr-job', ${`q${String(i).padStart(3, '0')}`}, 'Q', 'https://q.example/', 'queued')`;
  const start = 5_000_000;
  let t = start;
  const res = await cronPost(req(`Bearer ${SECRET}`), {
    ...deps, clock: () => t,
    runHealth: async () => ((t += 200_000), quietHealth()),
    // Each read takes 2 s of the run's clock.
    workQueue: (o) => workQueue({ ...o, deps: { evidence: async () => ((t += 2_000), evidence({ live: liveRows({ url: 'https://q.example/', url_ok: true }) })) } }),
  });
  const body = (await res.json()) as Body;
  assert.ok(t - start < RUN_BUDGET_MS, `ran ${t - start} ms`);
  // 200 s of walk, then reads until the deadline less 20 s (400 s): 100 read, 100 of the share of 200 left.
  assert.deepEqual(body.screen, { read: 100, requeued: 0, left: 100, jobs_finished: [] });
  assert.deepEqual(body.failed, []);
  const [job] = await sql()`SELECT last_run_read, last_run_left FROM screen_jobs WHERE id = 'cr-job'`;
  assert.deepEqual([job.last_run_read, job.last_run_left], [100, 100]);
  await sql()`DELETE FROM screen_applicants WHERE job_id = 'cr-job'`;
  await sql()`DELETE FROM screen_jobs WHERE id = 'cr-job'`;
});

test('sweeps: evidence past 180 days, rate windows past 2 days, and OAuth clients over 30 days old that never exchanged a code', async () => {
  const day = 86_400_000;
  const now = deps.now;
  await sql()`INSERT INTO evidence_cache (key, kind, rows, read_at) VALUES ('cr:old', 'repo', '[]', ${new Date(now.getTime() - 180 * day - 1)}), ('cr:new', 'repo', '[]', ${new Date(now.getTime() - 180 * day + 1)})`;
  await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES ('cr-old', ${new Date(now.getTime() - 2 * day - 1)}, 1), ('cr-new', ${new Date(now.getTime() - 2 * day + 1)}, 1)`;
  // v6.1.16 Task 16 N2 (v6.1.17 Task 3): pinned 1 ms either side of 30 days.
  for (const [id, ms, used] of [['cr-c-old', 30 * day + 1, null], ['cr-c-used', 30 * day + 1, new Date(now.getTime() - 31 * day)], ['cr-c-edge', 30 * day, null], ['cr-c-young', 30 * day - 1, null]] as const)
    await sql()`INSERT INTO oauth_clients (client_id, redirect_uris, created_at, used_at) VALUES (${id}, ${['https://c.example/cb']}, ${new Date(now.getTime() - ms)}, ${used})`;
  const body = (await (await cronPost(req(`Bearer ${SECRET}`), { ...deps, runHealth: quietHealth, workQueue: idleQueue })).json()) as Body;
  // L23-12 (v6.1.16): the cached evidence past 180 days goes in the reports step, which runs first.
  assert.deepEqual([body.swept.reports, body.swept.evidence, body.swept.windows, body.swept.oauth_clients], [1, 0, 1, 1]);
  assert.deepEqual((await sql()`SELECT key FROM evidence_cache WHERE key LIKE 'cr:%'`).map((r) => r.key), ['cr:new']);
  assert.deepEqual((await sql()`SELECT key FROM rate_windows WHERE key LIKE 'cr-%'`).map((r) => r.key), ['cr-new']);
  assert.deepEqual((await sql()`SELECT client_id FROM oauth_clients WHERE client_id LIKE 'cr-c-%' ORDER BY 1`).map((r) => r.client_id), ['cr-c-edge', 'cr-c-used', 'cr-c-young']);
});

const jsonReq = (body: unknown) =>
  new Request('https://earnkit.test/api/cron', { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('cronPost: a run with a job_id works that job only and skips health, the sweep and the digest', async () => {
  const calls: { limit: number; jobId?: string; deadline?: number }[] = [];
  const res = await cronPost(jsonReq({ job_id: 'job-abc' }), {
    ...deps,
    runHealth: async () => { throw new Error('health must not run'); },
    sendDigest: async () => { throw new Error('digest must not run'); },
    workQueue: async (o) => (calls.push(o), { read: 3, requeued: 0, left: 0, jobs_finished: ['job-abc'] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { screen: { read: 3, requeued: 0, left: 0, jobs_finished: ['job-abc'] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 300);
  assert.equal(calls[0].jobId, 'job-abc');
  assert.ok(calls[0].deadline! > Date.now() + 590_000);
});

test('cronPost: a plain run works the queue with SCREEN_BATCH after the sweeps and answers screen; a queue error is listed', async () => {
  const calls: { limit: number; jobId?: string; deadline?: number }[] = [];
  const res = await cronPost(req(`Bearer ${SECRET}`), { ...deps, workQueue: async (o) => (calls.push(o), { read: 0, requeued: 0, left: 0, jobs_finished: [] }) });
  const body = (await res.json()) as Body;
  assert.deepEqual(body.screen, { read: 0, requeued: 0, left: 0, jobs_finished: [] });
  assert.deepEqual(calls.map((c) => [c.limit, c.jobId]), [[200, undefined]]);
  // The daily share is 300 s at most.
  assert.ok(calls[0].deadline! > Date.now() + 290_000 && calls[0].deadline! <= Date.now() + 300_000);
  const boom = await quietLog(() => cronPost(req(`Bearer ${SECRET}`), { ...deps, workQueue: async () => { throw new Error('x'); } }));
  assert.equal(boom.status, 200);
  assert.deepEqual(((await boom.json()) as Body).failed, [{ id: null, step: 'screen', error: 'error' }]);
});

test('cronPost: the plain run sweeps the rows of screen jobs over 180 days old (L15-14), keeps the job row until 365 days (L23-13); a triggered run sweeps nothing', async () => {
  const at = (days: number) => new Date(deps.now.getTime() - days * 86_400_000);
  // Their queuer still reviews the program, so only age sweeps them (L30-16 cuts the others).
  await sql()`INSERT INTO program_reviewers (program_id, builder_id) VALUES ('p', 1) ON CONFLICT DO NOTHING`;
  for (const [id, days] of [['dead-job', 366], ['old-job', 181], ['young-job', 179]] as const) {
    await sql()`INSERT INTO screen_jobs (id, program_id, builder_id, installation_id, created_at, total, expires_at)
      VALUES (${id}, 'p', 1, 1, ${at(days)}, 1, ${at(days - 180)})`;
    await sql()`INSERT INTO screen_applicants (job_id, ref, name, status) VALUES (${id}, 'r', 'R', 'done')`;
    await sql()`INSERT INTO screen_outcomes (job_id, ref, outcome) VALUES (${id}, 'r', 'won')`;
  }
  const idle = { ...deps, workQueue: idleQueue };
  await cronPost(jsonReq({ job_id: 'old-job' }), idle);
  assert.equal((await sql()`SELECT 1 FROM screen_jobs WHERE id = 'old-job'`).length, 1);
  const body = (await (await cronPost(req(`Bearer ${SECRET}`), idle)).json()) as Body;
  assert.equal(body.swept.screens, 2);
  for (const t of ['screen_jobs', 'screen_applicants', 'screen_outcomes']) {
    const col = t === 'screen_jobs' ? 'id' : 'job_id';
    const ids = (await sql()`SELECT ${sql()(col)} AS id FROM ${sql()(t)} ORDER BY 1`).map((r) => r.id);
    assert.deepEqual(ids, t === 'screen_jobs' ? ['old-job', 'young-job'] : ['young-job'], t);
  }
  await sql()`DELETE FROM screen_jobs WHERE id = 'old-job'`;
});

test('cronPost: a body that is not { job_id } answers 400 and runs nothing', async () => {
  let ran = 0;
  const watch = { ...deps, runHealth: async () => { ran++; throw new Error('must not run'); }, workQueue: async () => (ran++, { read: 0, requeued: 0, left: 0, jobs_finished: [] }) };
  const raw = (body: string) => new Request('https://earnkit.test/api/cron', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body });
  for (const body of ['{not json', JSON.stringify({ job: 'x' }), JSON.stringify({ job_id: 'x', extra: 1 }), JSON.stringify({ job_id: 7 }), JSON.stringify({ job_id: 'x'.repeat(2_000) })]) {
    const res = await cronPost(raw(body), watch);
    assert.equal(res.status, 400, body.slice(0, 40));
    assert.deepEqual(await res.json(), { error: 'bad body' });
  }
  assert.equal(ran, 0);
});

test('cronPost: the plain run sweeps link codes, sessions and spent OAuth codes over a day old; a triggered run sweeps nothing', async () => {
  // A day in 2000, so no other file's rows fall in the window.
  const now = new Date('2000-01-10T06:00:00Z');
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
  const rows = { 'cr-old': at(-48), 'cr-grace': at(-12), 'cr-live': at(1) };
  await sql()`DELETE FROM link_codes WHERE code LIKE 'cr-%'`;
  await sql()`DELETE FROM sessions WHERE token_hash LIKE 'cr-%'`;
  await sql()`DELETE FROM oauth_codes_spent WHERE nonce LIKE 'cr-%'`;
  for (const [key, exp] of Object.entries(rows)) {
    // v6.1.16 Task 5: a spent code's row is kept a day from its exchange (at), then swept.
    await sql()`INSERT INTO oauth_codes_spent (nonce, token_hash, at) VALUES (${key}, ${key}, ${new Date(exp.getTime() - 3_600_000)})`;
    await sql()`INSERT INTO link_codes (code, installation_id, created_at, expires_at) VALUES (${key}, 1, ${at(-72)}, ${exp})`;
    await sql()`INSERT INTO sessions (token_hash, builder_id, created_at, expires_at, last_seen_at) VALUES (${key}, 1, ${at(-72)}, ${exp}, ${at(-72)})`;
  }
  const quiet = {
    ...deps, now,
    runHealth: quietHealth,
    sendDigest: async () => 'none' as const,
    workQueue: idleQueue,
  };
  await cronPost(jsonReq({ job_id: 'none' }), quiet);
  assert.equal((await sql()`SELECT 1 FROM link_codes WHERE code LIKE 'cr-%'`).length, 3);
  const res = await cronPost(req(`Bearer ${SECRET}`), quiet);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.deepEqual([body.swept.link_codes, body.swept.sessions, body.swept.oauth_codes], [1, 1, 1]);
  assert.deepEqual((await sql()`SELECT nonce FROM oauth_codes_spent WHERE nonce LIKE 'cr-%' ORDER BY nonce`).map((r) => r.nonce), ['cr-grace', 'cr-live']);
  await sql()`DELETE FROM oauth_codes_spent WHERE nonce LIKE 'cr-%'`;
  assert.deepEqual((await sql()`SELECT code FROM link_codes WHERE code LIKE 'cr-%' ORDER BY code`).map((r) => r.code), ['cr-grace', 'cr-live']);
  assert.deepEqual((await sql()`SELECT token_hash FROM sessions WHERE token_hash LIKE 'cr-%' ORDER BY token_hash`).map((r) => r.token_hash), ['cr-grace', 'cr-live']);
  await sql()`DELETE FROM link_codes WHERE code LIKE 'cr-%'`;
  await sql()`DELETE FROM sessions WHERE token_hash LIKE 'cr-%'`;
});

test('L13-11 (v6.1.14): a CRON_SECRET under 32 characters answers 503 with one ops log line, the right secret too', async () => {
  const short = 's'.repeat(20);
  process.env.CRON_SECRET = short;
  const logged: string[] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  try {
    const r = await cronPost(req(`Bearer ${short}`), deps);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: 'cron is not set up' });
    assert.equal((await cronPost(req('Bearer nope'), deps)).status, 503);
  } finally {
    console.error = was;
  }
  assert.equal(logged.length, 2);
  assert.match(logged[0], /^\[cron\] CRON_SECRET is under 32 characters/);
  assert.doesNotMatch(logged[0], new RegExp(short));
});

test('controller ruling: a database error with a connection string in its message leaves only db in the answer; the message is in the server log only', async () => {
  const leak = Object.assign(new Error('connect failed postgresql://admin:hunter2@10.1.2.3:5432/earnkit'), { name: 'PostgresError' });
  const logged: string[] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  let res: Response;
  try {
    res = await cronPost(req(`Bearer ${SECRET}`), {
      ...deps, workQueue: idleQueue,
      runHealth: async () => { throw leak; },
      sendDigest: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); },
    });
  } finally {
    console.error = was;
  }
  const text = await res.text();
  assert.deepEqual((JSON.parse(text) as Body).failed, [{ id: null, step: 'health', error: 'db' }, { id: null, step: 'digest', error: 'timeout' }]);
  for (const bit of ['hunter2', '10.1.2.3', 'postgresql', 'admin']) assert.ok(!text.includes(bit), bit);
  assert.ok(logged.some((l) => l.startsWith('[cron] health failed: PostgresError: connect failed')));
});

test('errorCode: by class, never by message', () => {
  assert.equal(errorCode(Object.assign(new Error('x'), { name: 'PostgresError' })), 'db');
  assert.equal(errorCode(Object.assign(new Error('x'), { code: 'CONNECTION_CLOSED' })), 'db');
  assert.equal(errorCode(new SafeFetchError('down 10.0.0.1')), 'fetch');
  assert.equal(errorCode(Object.assign(new Error('Mail failed: 0'), { name: 'MailError' })), 'fetch');
  assert.equal(errorCode(new Error('timeout')), 'timeout');
  assert.equal(errorCode(new Error('postgresql://u:p@h/db')), 'error');
  assert.equal(errorCode('x'), 'error');
});

test('L22-13 (v6.1.16): the daily status flip expires every catalog surface (revalidateCatalog per changed program)', async () => {
  let n = 0;
  watchCatalogRevalidation(() => n++);
  try {
    const flip = async () => ({ checked: 2, stale: [], changed: [], closed: ['cr-a'], opened: ['cr-b'], unreadable: [], failed: [], form_unread: [] });
    const res = await cronPost(req(`Bearer ${SECRET}`), { ...deps, runHealth: flip, workQueue: idleQueue });
    assert.equal(res.status, 200);
    assert.equal(n, 2);
  } finally {
    watchCatalogRevalidation(null);
  }
});

test('fix round 1 (M1): the walk gets its own share; a walk that uses all of it still leaves the queue 220 s and the run ends inside 420 s', async () => {
  assert.equal(HEALTH_BUDGET_MS, 180_000);
  const start = 2_000_000;
  let t = start;
  let healthDeadline = 0;
  const calls: { deadline?: number }[] = [];
  const res = await cronPost(req(`Bearer ${SECRET}`), {
    ...deps, clock: () => t,
    // The slowest a real walk can be: its last probe ends at its deadline.
    runHealth: async (_now, d) => ((healthDeadline = d!.deadline!), (t = d!.deadline!), quietHealth()),
    workQueue: async (o) => (calls.push(o), (t = o.deadline!), { read: 1, requeued: 0, left: 0, jobs_finished: [] }),
  });
  const body = (await res.json()) as Body;
  assert.equal(healthDeadline, start + 180_000);
  assert.deepEqual(body.failed, []);
  assert.equal(calls[0].deadline! - (start + 180_000), 220_000);
  assert.ok(t - start < RUN_BUDGET_MS);
});

// --- v6.1.17 Task 3.

test('v6.1.16 Task 16 N2 (v6.1.17 Task 3): every sweep boundary is pinned 1 ms either side; outcome_asks over 30 days go by the day', async () => {
  // A day in 1999, so no other file's rows fall in any window.
  const now = new Date('1999-06-01T06:00:00Z');
  const day = 86_400_000;
  const ago = (ms: number) => new Date(now.getTime() - ms);
  /** Three rows per boundary: one ms younger, exactly at it, one ms older (only this one goes). */
  const edge = (ms: number) => [['young', ago(ms - 1)], ['at', ago(ms)], ['old', ago(ms + 1)]] as const;
  for (const [k, t] of edge(30 * day)) {
    await sql()`INSERT INTO repo_cache (repo, facts, fetched_at) VALUES (${`cr99/${k}`}, '{}', ${t})`;
    await sql()`INSERT INTO oauth_clients (client_id, redirect_uris, created_at) VALUES (${`cr99-${k}`}, ${['https://c.example/cb']}, ${t})`;
  }
  for (const [k, t] of edge(180 * day)) {
    await sql()`INSERT INTO evidence_cache (key, kind, rows, read_at) VALUES (${`cr99:${k}`}, 'repo', '[]', ${t})`;
    await sql()`INSERT INTO screen_jobs (id, program_id, builder_id, installation_id, created_at, total, expires_at, finished_at)
      VALUES (${`cr99-job-${k}`}, 'cr99', 1, 1, ${t}, 1, ${now}, ${t})`;
    await sql()`INSERT INTO screen_applicants (job_id, ref, name, status) VALUES (${`cr99-job-${k}`}, 'r', 'R', 'done')`;
  }
  for (const [k, t] of edge(365 * day))
    await sql()`INSERT INTO screen_jobs (id, program_id, builder_id, installation_id, created_at, total, expires_at, finished_at)
      VALUES (${`cr99-tomb-${k}`}, 'cr99', 1, 1, ${t}, 1, ${now}, ${t})`;
  for (const [k, t] of edge(day)) {
    await sql()`INSERT INTO link_codes (code, installation_id, created_at, expires_at) VALUES (${`cr99-${k}`}, 1, ${ago(3 * day)}, ${t})`;
    await sql()`INSERT INTO sessions (token_hash, builder_id, created_at, expires_at, last_seen_at) VALUES (${`cr99-${k}`}, 1, ${ago(3 * day)}, ${t}, ${ago(3 * day)})`;
    await sql()`INSERT INTO oauth_codes_spent (nonce, token_hash, at) VALUES (${`cr99-${k}`}, 'h', ${t})`;
  }
  for (const [k, t] of edge(2 * day)) await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${`cr99-${k}`}, ${t}, 1)`;
  // 1999-05-02 is 30 days before 1999-06-01: kept; the day before goes.
  await sql()`INSERT INTO outcome_asks (installation_id, owner, program_id, asked_on) VALUES
    (991, 'i:991', 'cr99-at', '1999-05-02'), (991, 'i:991', 'cr99-old', '1999-05-01'), (991, 'i:991', 'cr99-young', '1999-05-03')`;

  const res = await cronPost(req(`Bearer ${SECRET}`), { ...deps, now, runHealth: quietHealth, workQueue: idleQueue, sendDigest: async () => 'none' as const });
  const body = (await res.json()) as Body;
  assert.deepEqual(body.failed, []);
  assert.deepEqual(body.swept, {
    repo_cache: 1, reports: 1, screens: 2, link_codes: 1, sessions: 1, oauth_codes: 1, oauth_clients: 1, evidence: 0, windows: 1, outcome_asks: 1,
  });
  const left = async (q: Promise<{ k: string }[]>) => (await q).map((r) => r.k).sort();
  const two = (p: string) => [`${p}at`, `${p}young`];
  assert.deepEqual(await left(sql()`SELECT repo AS k FROM repo_cache WHERE repo LIKE 'cr99/%'`), two('cr99/'));
  assert.deepEqual(await left(sql()`SELECT client_id AS k FROM oauth_clients WHERE client_id LIKE 'cr99-%'`), two('cr99-'));
  assert.deepEqual(await left(sql()`SELECT key AS k FROM evidence_cache WHERE key LIKE 'cr99:%'`), two('cr99:'));
  assert.deepEqual(await left(sql()`SELECT job_id AS k FROM screen_applicants WHERE job_id LIKE 'cr99-job-%'`), two('cr99-job-'));
  assert.deepEqual(await left(sql()`SELECT id AS k FROM screen_jobs WHERE id LIKE 'cr99-tomb-%'`), two('cr99-tomb-'));
  assert.deepEqual(await left(sql()`SELECT code AS k FROM link_codes WHERE code LIKE 'cr99-%'`), two('cr99-'));
  assert.deepEqual(await left(sql()`SELECT token_hash AS k FROM sessions WHERE token_hash LIKE 'cr99-%'`), two('cr99-'));
  assert.deepEqual(await left(sql()`SELECT nonce AS k FROM oauth_codes_spent WHERE nonce LIKE 'cr99-%'`), two('cr99-'));
  assert.deepEqual(await left(sql()`SELECT key AS k FROM rate_windows WHERE key LIKE 'cr99-%'`), two('cr99-'));
  assert.deepEqual(await left(sql()`SELECT program_id AS k FROM outcome_asks WHERE installation_id = 991`), two('cr99-'));
  for (const [t, c] of [['repo_cache', 'repo'], ['oauth_clients', 'client_id'], ['evidence_cache', 'key'], ['screen_applicants', 'job_id'], ['screen_jobs', 'id'],
    ['link_codes', 'code'], ['sessions', 'token_hash'], ['oauth_codes_spent', 'nonce'], ['rate_windows', 'key'], ['outcome_asks', 'program_id']] as const)
    await sql()`DELETE FROM ${sql()(t)} WHERE ${sql()(c)} LIKE 'cr99%'`;
  await sql()`DELETE FROM cron_state`;
});

test('L30-14: a run that answers 200 stores its time, never moving it back; a 500 run and an owner trigger store nothing', async () => {
  await sql()`DELETE FROM cron_state`;
  const { lastRunAt } = await import('./cron');
  const quiet = { ...deps, runHealth: quietHealth, workQueue: idleQueue, sendDigest: async () => 'none' as const };
  await cronPost(jsonReq({ job_id: 'none' }), quiet);
  assert.equal(await lastRunAt(), null);
  assert.equal((await cronPost(req(`Bearer ${SECRET}`), quiet)).status, 200);
  assert.equal((await lastRunAt())?.toISOString(), deps.now.toISOString());
  await cronPost(req(`Bearer ${SECRET}`), { ...quiet, now: new Date(deps.now.getTime() - 86_400_000) });
  assert.equal((await lastRunAt())?.toISOString(), deps.now.toISOString());
  const later = new Date(deps.now.getTime() + 86_400_000);
  const tables = ['repo_cache', 'project_reports', 'screen_jobs', 'link_codes', 'evidence_cache', 'rate_windows', 'outcome_asks'];
  for (const t of tables) await refuseDeletes(t);
  try {
    const res = await quietLog(() => cronPost(req(`Bearer ${SECRET}`), {
      ...deps, now: later,
      runHealth: async () => { throw new Error('h'); },
      workQueue: async () => { throw new Error('q'); },
      sendDigest: async () => { throw new Error('d'); },
    }));
    assert.equal(res.status, 500);
  } finally {
    for (const t of tables) await allowDeletes(t);
  }
  assert.equal((await lastRunAt())?.toISOString(), deps.now.toISOString());
  await sql()`DELETE FROM cron_state`;
});

test('L30-14, L30-18 (Review Focus 5): after 27 hours with no run, the run\'s digest names the gap and the unreadable rows, then stores its time; /api/stats showed the old time until then', async () => {
  const { readStats } = await import('./stats');
  const H = 3_600_000;
  const old = new Date(deps.now.getTime() - 27 * H);
  await sql()`DELETE FROM cron_state`;
  await sql()`DELETE FROM owner_digests`;
  await sql()`INSERT INTO cron_state (id, last_run_at) VALUES (true, ${old})`;
  assert.equal((await readStats(deps.now)).last_run_at, old.toISOString());
  const walk = async () => ({ ...(await quietHealth()), unreadable: [{ id: 'cr-bad', fix: 'its saved entry no longer reads, so it is not checked; correct the entry.' }] });
  const res = await cronPost(req(`Bearer ${SECRET}`), { ...deps, runHealth: walk, workQueue: idleQueue });
  const body = (await res.json()) as Body;
  assert.equal(res.status, 200);
  assert.deepEqual(body.failed, []);
  assert.equal(body.health!.unreadable, 1);
  assert.equal(body.digest, 'sent');
  const text = sent.at(-1)!.text;
  assert.ok(text.includes('No daily run finished for 27 hours before this one; the last was 2026-11-03 03:15 UTC.'), text);
  assert.ok(text.includes('Programs the run could not read\n- cr-bad: its saved entry no longer reads, so it is not checked; correct the entry.'), text);
  assert.equal((await readStats(deps.now)).last_run_at, deps.now.toISOString());
  await sql()`DELETE FROM cron_state`;
  await sql()`DELETE FROM owner_digests`;
});

test('fix round 1 (M2): two runs on a day after a gap send one email: the second builds the same body (the gap from the last run before the day to its first run)', async () => {
  const H = 3_600_000;
  await sql()`DELETE FROM cron_state`;
  await sql()`DELETE FROM owner_digests`;
  // 27 h 55 min before the first run: measured from now, the second run 10 minutes later would read 28 hours.
  await sql()`INSERT INTO cron_state (id, last_run_at) VALUES (true, ${new Date(deps.now.getTime() - 27 * H - 55 * 60_000)})`;
  const run = (now: Date) => cronPost(req(`Bearer ${SECRET}`), { ...deps, now, runHealth: quietHealth, workQueue: idleQueue });
  const first = (await (await run(deps.now)).json()) as Body;
  const second = (await (await run(new Date(deps.now.getTime() + 10 * 60_000))).json()) as Body;
  assert.deepEqual([first.digest, second.digest], ['sent', 'none']);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes('No daily run finished for 27 hours before this one; the last was 2026-11-03 02:20 UTC.'), sent[0].text);
  // The next day, with its run on time, there is no gap.
  const next = (await (await run(new Date(deps.now.getTime() + 24 * H))).json()) as Body;
  assert.notEqual(next.digest, 'sent');
  assert.equal(sent.length, 1);
  await sql()`DELETE FROM cron_state`;
  await sql()`DELETE FROM owner_digests`;
});
