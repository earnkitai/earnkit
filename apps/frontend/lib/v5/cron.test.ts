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
  const body = (await res.json()) as { health: Record<string, number>; digest: string };
  assert.deepEqual(Object.keys(body.health).sort(), ['changed', 'checked', 'closed', 'stale']);
  assert.ok(['sent', 'none'].includes(body.digest));
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
