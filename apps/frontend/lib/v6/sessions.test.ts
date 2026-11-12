import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from '../v5/db';
import { upsertBuilder } from './builders';
import { OLD_COOKIE, clearCookie, cookieName, cookieValue, createSession, renewedCookies, sessionBuilder, sessionToken } from './sessions';

after(() => sql().end());

const NOW = new Date('2026-11-11T12:00:00Z');
/** Runs `fn` with NODE_ENV set (Next reads it at call time here). */
async function asEnv<T>(env: string, fn: () => Promise<T> | T): Promise<T> {
  const saved = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = env;
  try {
    return await fn();
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = saved;
  }
}

test('cookieValue reads the first match; the /me page reads the raw header with it too (v6.1.7 B2)', () => {
  assert.equal(cookieValue('ek_me=B; ek_me=A', OLD_COOKIE), 'B');
  assert.equal(cookieValue('other=1; ek_me=valid; ek_me=garbage', OLD_COOKIE), 'valid');
  assert.equal(cookieValue('ek_me=a=b', OLD_COOKIE), 'a=b');
  assert.equal(cookieValue('ek_me=', OLD_COOKIE), null);
  assert.equal(cookieValue(null, OLD_COOKIE), null);
  // The gate (proxy -> meGet), every post (guard) and the page share one parser: the page must not use Next's cookie
  // store, which keeps the last of two same-named cookies.
  const page = readFileSync(new URL('../../app/me/page.tsx', import.meta.url), 'utf8');
  assert.ok(!/\bcookies\(\)/.test(page), 'page.tsx does not read cookies()');
  assert.match(page, /sessionToken\(cookie\)/);
  assert.match(page, /sessionBuilder\(cookie, now\)/);
});

test('L31-6 (v6.1.16 Task 17): in production the session cookie is __Host-ek_me with Secure and Path=/ and no Domain', async () => {
  const b = await upsertBuilder({ github_id: 930_001, login: 'hostcookie', name: null, avatar_url: null }, NOW);
  await asEnv('production', async () => {
    assert.equal(cookieName(), '__Host-ek_me');
    const { token, cookie } = await createSession(b.id, NOW);
    assert.match(cookie, new RegExp(`^__Host-ek_me=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$`));
    assert.doesNotMatch(cookie, /Domain/i);
    assert.equal((await sessionBuilder(`__Host-ek_me=${token}`, NOW))?.id, b.id);
    assert.match(clearCookie(), /^__Host-ek_me=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/);
  });
});

test('L31-6 (v6.1.16 Task 17): on local http the name stays ek_me, with no Secure', async () => {
  const b = await upsertBuilder({ github_id: 930_002, login: 'localcookie', name: null, avatar_url: null }, NOW);
  await asEnv('development', async () => {
    assert.equal(cookieName(), 'ek_me');
    const { token, cookie } = await createSession(b.id, NOW);
    assert.equal(cookie, `ek_me=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    assert.deepEqual(renewedCookies(`ek_me=${token}`), []);
  });
});

test('L31-6 (v6.1.16 Task 17): in production a request with only the old ek_me is read and moved to the new name', async () => {
  const b = await upsertBuilder({ github_id: 930_003, login: 'oldcookie', name: null, avatar_url: null }, NOW);
  const { token } = await asEnv('development', () => createSession(b.id, NOW));
  await asEnv('production', async () => {
    assert.equal(sessionToken(`ek_me=${token}`), token);
    assert.equal((await sessionBuilder(`ek_me=${token}`, NOW))?.id, b.id);
    // The new name wins over the old.
    assert.equal(sessionToken(`ek_me=old; __Host-ek_me=${token}`), token);
    assert.deepEqual(renewedCookies(`ek_me=${token}`), [
      `__Host-ek_me=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
      'ek_me=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ]);
    assert.deepEqual(renewedCookies(`__Host-ek_me=${token}`), []);
    assert.deepEqual(renewedCookies(null), []);
    // The /me gate answers the old-name request with the new cookie.
    const { proxy } = await import('../../proxy');
    const r = await proxy(new Request('https://earnkit.test/me', { headers: { cookie: `ek_me=${token}` } }) as never);
    assert.notEqual(r.status, 302);
    const set = r.headers.getSetCookie();
    assert.ok(set.some((c) => c.startsWith(`__Host-ek_me=${token}; Path=/;`) && c.includes('Secure') && !/Domain/i.test(c)), JSON.stringify(set));
    assert.ok(set.some((c) => c.startsWith('ek_me=;') && c.includes('Max-Age=0')));
  });
});
