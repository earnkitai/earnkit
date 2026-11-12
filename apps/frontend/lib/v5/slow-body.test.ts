/**
 * v6.1.16 Task 5 fix round 1 (I2): every caller of the shared body reader answers a body slower than 5 s with a 408
 * and one log line, never a 500, a 413 or a 400. One test, all callers at once (each waits the 5 s).
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { cronPost } from './cron';
import { writePost } from './programs-api';
import { reviewersPost } from '../v6/reviewers';
import { approvePost, deletePost, editPost, linkPost, policyPost, signoutPost, unlinkPost } from '../v6/me-routes';
import { ME_ERRORS } from './site-copy';

after(() => sql().end());

const TOKEN = 't'.repeat(40);
const CRON = 'c'.repeat(40);

/** A request whose body sends one byte and never ends. */
const slow = (path: string, headers: Record<string, string>) =>
  new Request(`https://earnkit.test${path}`, {
    method: 'POST',
    headers,
    body: new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(new Uint8Array([123])) }),
    duplex: 'half',
  } as RequestInit);

test('I2: /me posts, reviewers, the programs write and the cron answer a stalled body 408 within 6 s, one log line each', async () => {
  const env = { token: process.env.EARNKIT_PROGRAMS_TOKEN, cron: process.env.CRON_SECRET };
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  process.env.CRON_SECRET = CRON;
  const logs: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void logs.push(a.join(' '));
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const api = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
  const me = [editPost, approvePost, policyPost, unlinkPost, linkPost, deletePost, signoutPost];
  const t0 = Date.now();
  let rs: Response[];
  try {
    rs = await Promise.all([
      ...me.map((post) => post(slow('/me/x', form))),
      reviewersPost(slow('/api/programs/reviewers', api)),
      writePost(slow('/api/programs/write', api), { limit: async () => {} }),
      cronPost(slow('/api/cron', { 'content-type': 'application/json', authorization: `Bearer ${CRON}` })),
    ]);
  } finally {
    console.warn = warn;
    if (env.token === undefined) delete process.env.EARNKIT_PROGRAMS_TOKEN;
    else process.env.EARNKIT_PROGRAMS_TOKEN = env.token;
    if (env.cron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = env.cron;
  }
  assert.ok(Date.now() - t0 < 6_000);
  for (const r of rs) assert.equal(r.status, 408);
  // /me: the page's own line, as plain text.
  for (const r of rs.slice(0, me.length)) assert.equal(await r.text(), ME_ERRORS.slow);
  assert.equal(ME_ERRORS.slow, 'The request took too long. Try again.');
  const [reviewers, write, cron] = rs.slice(me.length);
  assert.deepEqual(await reviewers.json(), { ok: false, error: 'the body came too slowly' });
  assert.deepEqual(await write.json(), { ok: false, error: 'the body came too slowly' });
  assert.deepEqual(await cron.json(), { error: 'the body came too slowly' });
  assert.equal(logs.filter((l) => l === '[http] body read timed out').length, rs.length);
});

test('I2: a body over the cap stays a 413 on the programs write (only a slow body is a 408)', async () => {
  const was = process.env.EARNKIT_PROGRAMS_TOKEN;
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  try {
    const r = await writePost(
      new Request('https://earnkit.test/api/programs/write', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'content-length': String(10_000_000) }, body: '{}',
      }),
      { limit: async () => {} },
    );
    assert.equal(r.status, 413);
  } finally {
    if (was === undefined) delete process.env.EARNKIT_PROGRAMS_TOKEN;
    else process.env.EARNKIT_PROGRAMS_TOKEN = was;
  }
});
