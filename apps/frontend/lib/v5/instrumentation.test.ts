import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRON_SECRET_SHORT, checkBootEnv, register } from '../../instrumentation';
import { cronPost } from './cron';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

test('L13-11 (v6.1.16 Task 17): in production a CRON_SECRET under 32 characters refuses to start; 32 passes; development and unset pass', async () => {
  assert.throws(() => checkBootEnv(env({ NODE_ENV: 'production', CRON_SECRET: 'x'.repeat(20) })), { message: CRON_SECRET_SHORT });
  assert.throws(() => checkBootEnv(env({ NODE_ENV: 'production', CRON_SECRET: 'x'.repeat(31) })), { message: 'CRON_SECRET must be at least 32 characters.' });
  assert.doesNotThrow(() => checkBootEnv(env({ NODE_ENV: 'production', CRON_SECRET: 'x'.repeat(32) })));
  assert.doesNotThrow(() => checkBootEnv(env({ NODE_ENV: 'development', CRON_SECRET: 'short' })));
  assert.doesNotThrow(() => checkBootEnv(env({ NODE_ENV: 'production' })));
  // register() reads the process env: unset boots, and the cron answers 503 as before.
  const saved = { node: process.env.NODE_ENV, secret: process.env.CRON_SECRET, runtime: process.env.NEXT_RUNTIME };
  try {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.CRON_SECRET;
    const exits: number[] = [];
    const exit = (code: number) => void exits.push(code);
    assert.doesNotThrow(() => register({ exit }));
    assert.deepEqual(exits, []);
    const r = await cronPost(new Request('https://earnkit.test/api/cron', { method: 'POST', headers: { authorization: 'Bearer x' } }));
    assert.equal(r.status, 503);
    process.env.CRON_SECRET = 'y'.repeat(20);
    // A throw alone leaves next start up answering 500, so the process exits with code 1.
    assert.throws(() => register({ exit }), { message: CRON_SECRET_SHORT });
    assert.deepEqual(exits, [1]);
    // Fix round 1 (M1): the check runs on the Node runtime only; Next's Edge build of this file does nothing.
    process.env.NEXT_RUNTIME = 'edge';
    assert.doesNotThrow(() => register({ exit }));
    assert.deepEqual(exits, [1]);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = saved.node;
    if (saved.runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = saved.runtime;
    if (saved.secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved.secret;
  }
});
