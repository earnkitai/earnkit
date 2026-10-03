import { test } from 'node:test';
import assert from 'node:assert/strict';
import nextConfig, { IMAGE_CSP, SECURITY_HEADERS } from '../../next.config';

test('every response gets the anti-framing and referrer headers', async () => {
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === '/:path*');
  assert.ok(all, 'a rule for every path');
  const h = Object.fromEntries(all.headers.map((x) => [x.key, x.value]));
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(all.headers, SECURITY_HEADERS);
});

test("the token image keeps its sandbox CSP (config headers replace a route's own)", async () => {
  const rules = await nextConfig.headers!();
  const i = rules.findIndex((r) => r.source === '/api/projects/:id/image');
  assert.ok(
    i > rules.findIndex((r) => r.source === '/:path*'),
    'after the global rule',
  );
  assert.deepEqual(rules[i].headers, [
    { key: 'Content-Security-Policy', value: IMAGE_CSP },
  ]);
  assert.match(IMAGE_CSP, /default-src 'none'; sandbox/);
  assert.match(IMAGE_CSP, /frame-ancestors 'none'/);
});
