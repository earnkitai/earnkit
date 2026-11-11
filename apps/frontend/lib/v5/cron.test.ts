import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { cronPost, RUN_BUDGET_MS } from './cron';
import { errorCode } from './health';
import { SafeFetchError } from './safe-fetch';
import type { Mailer } from './mail';
import { programFixture } from './fixtures/program';
import { upsertProgram } from './programs';
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
  health: Record<string, number> | null; swept: Record<string, number | null>; screen: { read: number; left: number; jobs_finished: string[] } | null;
  digest: string | null; failed: { id: string | null; step: string; error: string }[];
};
const quietHealth = async () => ({ checked: 0, stale: [], changed: [], closed: [], opened: [], failed: [] });
const idleQueue = async () => ({ read: 0, left: 0, jobs_finished: [] });
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

test('cronPost: runs every step and answers the counts, the swept counts per table and an empty failed list', async () => {
  const res = await cronPost(req(`Bearer ${SECRET}`), deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.deepEqual(Object.keys(body.health!).sort(), ['changed', 'checked', 'closed', 'opened', 'stale']);
  assert.deepEqual(Object.keys(body.swept).sort(), ['evidence', 'link_codes', 'oauth_clients', 'oauth_codes', 'repo_cache', 'reports', 'screens', 'sessions', 'windows']);
  assert.ok(Object.values(body.swept).every((n) => typeof n === 'number'));
  assert.deepEqual(Object.keys(body.screen!).sort(), ['jobs_finished', 'left', 'read']);
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

test('W3 (v6.1.13 final round): the sweep drops a project report no find updated for 180 days and keeps a recent one', async () => {
  const day = 86_400_000;
  await sql()`INSERT INTO project_reports (owner, project_key, report, at) VALUES
    ('i:1', 'name:old', '{}', ${new Date(deps.now.getTime() - 181 * day)}), ('i:1', 'name:recent', '{}', ${new Date(deps.now.getTime() - 10 * day)})`;
  await cronPost(req(`Bearer ${SECRET}`), deps);
  assert.deepEqual((await sql()`SELECT project_key FROM project_reports WHERE owner = 'i:1'`).map((r) => r.project_key), ['name:recent']);
});

test('L30-4: a health error is listed and the sweeps, the queue and the digest still run; the error is a code only', async () => {
  let queued = 0;
  const res = await quietLog(() => cronPost(req(`Bearer ${SECRET}`), {
    ...deps,
    runHealth: async () => { throw new TypeError('bad https://x.example/p?token=secret'); },
    workQueue: async () => (queued++, { read: 0, left: 0, jobs_finished: [] }),
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
      workQueue: async () => (queued++, { read: 5, left: 0, jobs_finished: [] }),
      sendDigest: async () => (digests++, 'none' as const),
    }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as Body;
    assert.deepEqual(body.failed, [{ id: null, step: 'sweep_repo', error: 'db' }]);
    assert.equal(body.swept.repo_cache, null);
    assert.equal(typeof body.swept.reports, 'number');
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
  const tables = ['repo_cache', 'project_reports', 'screen_jobs', 'link_codes', 'evidence_cache', 'rate_windows'];
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
    assert.deepEqual(body.failed.map((f) => f.step), ['health', 'sweep_repo', 'sweep_reports', 'sweep_screens', 'sweep_auth', 'sweep_evidence', 'sweep_windows', 'screen', 'digest']);
  } finally {
    for (const t of tables) await allowDeletes(t);
  }
});

test('budget: RUN_BUDGET_MS is 420 s; the queue gets min(300 s, the deadline less 20 s); past the deadline it is skipped as budget while the sweeps and the digest run', async () => {
  assert.equal(RUN_BUDGET_MS, 420_000);
  let t = 1_000_000;
  const calls: { deadline?: number }[] = [];
  const slowHealth = (ms: number) => async () => ((t += ms), quietHealth());
  const q = async (o: { deadline?: number }) => (calls.push(o), { read: 0, left: 0, jobs_finished: [] });
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
  assert.deepEqual(body.screen, { read: 100, left: 100, jobs_finished: [] });
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
  for (const [id, days, used] of [['cr-c-old', 31, null], ['cr-c-used', 31, new Date(now.getTime() - 31 * day)], ['cr-c-young', 29, null]] as const)
    await sql()`INSERT INTO oauth_clients (client_id, redirect_uris, created_at, used_at) VALUES (${id}, ${['https://c.example/cb']}, ${new Date(now.getTime() - days * day)}, ${used})`;
  const body = (await (await cronPost(req(`Bearer ${SECRET}`), { ...deps, runHealth: quietHealth, workQueue: idleQueue })).json()) as Body;
  assert.deepEqual([body.swept.evidence, body.swept.windows, body.swept.oauth_clients], [1, 1, 1]);
  assert.deepEqual((await sql()`SELECT key FROM evidence_cache WHERE key LIKE 'cr:%'`).map((r) => r.key), ['cr:new']);
  assert.deepEqual((await sql()`SELECT key FROM rate_windows WHERE key LIKE 'cr-%'`).map((r) => r.key), ['cr-new']);
  assert.deepEqual((await sql()`SELECT client_id FROM oauth_clients WHERE client_id LIKE 'cr-c-%' ORDER BY 1`).map((r) => r.client_id), ['cr-c-used', 'cr-c-young']);
});

const jsonReq = (body: unknown) =>
  new Request('https://earnkit.test/api/cron', { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('cronPost: a run with a job_id works that job only and skips health, the sweep and the digest', async () => {
  const calls: { limit: number; jobId?: string; deadline?: number }[] = [];
  const res = await cronPost(jsonReq({ job_id: 'job-abc' }), {
    ...deps,
    runHealth: async () => { throw new Error('health must not run'); },
    sendDigest: async () => { throw new Error('digest must not run'); },
    workQueue: async (o) => (calls.push(o), { read: 3, left: 0, jobs_finished: ['job-abc'] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { screen: { read: 3, left: 0, jobs_finished: ['job-abc'] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 300);
  assert.equal(calls[0].jobId, 'job-abc');
  assert.ok(calls[0].deadline! > Date.now() + 590_000);
});

test('cronPost: a plain run works the queue with SCREEN_BATCH after the sweeps and answers screen; a queue error is listed', async () => {
  const calls: { limit: number; jobId?: string; deadline?: number }[] = [];
  const res = await cronPost(req(`Bearer ${SECRET}`), { ...deps, workQueue: async (o) => (calls.push(o), { read: 0, left: 0, jobs_finished: [] }) });
  const body = (await res.json()) as Body;
  assert.deepEqual(body.screen, { read: 0, left: 0, jobs_finished: [] });
  assert.deepEqual(calls.map((c) => [c.limit, c.jobId]), [[200, undefined]]);
  // The daily share is 300 s at most.
  assert.ok(calls[0].deadline! > Date.now() + 290_000 && calls[0].deadline! <= Date.now() + 300_000);
  const boom = await quietLog(() => cronPost(req(`Bearer ${SECRET}`), { ...deps, workQueue: async () => { throw new Error('x'); } }));
  assert.equal(boom.status, 200);
  assert.deepEqual(((await boom.json()) as Body).failed, [{ id: null, step: 'screen', error: 'error' }]);
});

test('cronPost: the plain run sweeps screen jobs over 180 days old with their rows (L15-14); a triggered run sweeps nothing', async () => {
  const at = (days: number) => new Date(deps.now.getTime() - days * 86_400_000);
  for (const [id, days] of [['old-job', 181], ['young-job', 179]] as const) {
    await sql()`INSERT INTO screen_jobs (id, program_id, builder_id, installation_id, created_at, total, expires_at)
      VALUES (${id}, 'p', 1, 1, ${at(days)}, 1, ${at(days - 180)})`;
    await sql()`INSERT INTO screen_applicants (job_id, ref, name, status) VALUES (${id}, 'r', 'R', 'done')`;
    await sql()`INSERT INTO screen_outcomes (job_id, ref, outcome) VALUES (${id}, 'r', 'won')`;
  }
  const idle = { ...deps, workQueue: idleQueue };
  await cronPost(jsonReq({ job_id: 'old-job' }), idle);
  assert.equal((await sql()`SELECT 1 FROM screen_jobs WHERE id = 'old-job'`).length, 1);
  const body = (await (await cronPost(req(`Bearer ${SECRET}`), idle)).json()) as Body;
  assert.equal(body.swept.screens, 1);
  for (const t of ['screen_jobs', 'screen_applicants', 'screen_outcomes']) {
    const col = t === 'screen_jobs' ? 'id' : 'job_id';
    const ids = (await sql()`SELECT ${sql()(col)} AS id FROM ${sql()(t)} ORDER BY 1`).map((r) => r.id);
    assert.deepEqual(ids, ['young-job'], t);
  }
});

test('cronPost: a body that is not { job_id } answers 400 and runs nothing', async () => {
  let ran = 0;
  const watch = { ...deps, runHealth: async () => { ran++; throw new Error('must not run'); }, workQueue: async () => (ran++, { read: 0, left: 0, jobs_finished: [] }) };
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
