import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COOKIE, cookieValue } from './sessions';

test('cookieValue reads the first match; the /me page reads the raw header with it too (v6.1.7 B2)', () => {
  assert.equal(cookieValue('ek_me=B; ek_me=A', COOKIE), 'B');
  assert.equal(cookieValue('other=1; ek_me=valid; ek_me=garbage', COOKIE), 'valid');
  assert.equal(cookieValue('ek_me=a=b', COOKIE), 'a=b');
  assert.equal(cookieValue('ek_me=', COOKIE), null);
  assert.equal(cookieValue(null, COOKIE), null);
  // The gate (proxy -> meGet), every post (guard) and the page share one parser: the page must not use Next's cookie
  // store, which keeps the last of two same-named cookies.
  const page = readFileSync(new URL('../../app/me/page.tsx', import.meta.url), 'utf8');
  assert.ok(!/\bcookies\(\)/.test(page), 'page.tsx does not read cookies()');
  assert.match(page, /cookieValue\(cookie, COOKIE\)/);
  assert.match(page, /sessionBuilder\(cookie, now\)/);
});
