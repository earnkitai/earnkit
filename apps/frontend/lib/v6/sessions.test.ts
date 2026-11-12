import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from '../v5/db';
import { upsertBuilder } from './builders';
import { OLD_COOKIE, clearCookie, cookieName, cookieValue, createSession, currentName, hasSession, sessionBuilder, sessionToken } from './sessions';

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
    assert.equal(currentName(`ek_me=${token}`), true);
  });
});

test('L35-17 (v6.1.17 Task 4): in production a request with only the old ek_me is read for this release and never promoted', async () => {
  const b = await upsertBuilder({ github_id: 930_003, login: 'oldcookie', name: null, avatar_url: null }, NOW);
  const { token } = await asEnv('development', () => createSession(b.id, NOW));
  await asEnv('production', async () => {
    assert.equal(sessionToken(`ek_me=${token}`), token);
    assert.equal((await sessionBuilder(`ek_me=${token}`, NOW))?.id, b.id);
    // The new name wins over the old.
    assert.equal(sessionToken(`ek_me=old; __Host-ek_me=${token}`), token);
    assert.equal(currentName(`ek_me=${token}`), false);
    assert.equal(currentName(`ek_me=old; __Host-ek_me=${token}`), true);
    assert.equal(currentName(null), false);
    const { proxy } = await import('../../proxy');
    process.env.EARNKIT_URL ??= 'https://earnkit.test';
    // G2.2, G2.4: the /me page reads the old-name session but mints no __Host-ek_me from it, nor from a planted one.
    for (const cookie of [`ek_me=${token}`, 'ek_me=PLANTED']) {
      const r = await proxy(new Request('https://earnkit.test/me', { headers: { cookie } }) as never);
      assert.equal(r.status === 302, cookie.includes('PLANTED'), cookie);
      const set = r.headers.getSetCookie();
      assert.ok(!set.some((c) => c.startsWith('__Host-ek_me=') && !c.startsWith('__Host-ek_me=;')), JSON.stringify(set));
      assert.ok(!set.some((c) => c.includes(token) || c.includes('PLANTED')), JSON.stringify(set));
    }
  });
});

test('v6.1.17 Task 4: hasSession reads a live session without moving last_seen_at; none, expired or forged is false', async () => {
  const b = await upsertBuilder({ github_id: 930_004, login: 'hassession', name: null, avatar_url: null }, NOW);
  const { token } = await createSession(b.id, NOW);
  const seen = async () => (await sql()<{ at: Date }[]>`SELECT last_seen_at AS at FROM sessions WHERE builder_id = ${b.id}`)[0].at.getTime();
  const before = await seen();
  assert.equal(await hasSession(`${cookieName()}=${token}`, new Date(NOW.getTime() + 3_600_000)), true);
  assert.equal(await seen(), before);
  assert.equal(await hasSession(`${cookieName()}=${token}`, new Date(NOW.getTime() + 31 * 86_400_000)), false);
  assert.equal(await hasSession(`${cookieName()}=forged`, NOW), false);
  assert.equal(await hasSession(null, NOW), false);
});
