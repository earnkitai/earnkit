import { test } from 'node:test';
import assert from 'node:assert/strict';
import nextConfig, { IMAGE_CSP, securityHeaders } from '../../next.config';

test('every response gets the anti-framing and referrer headers', async () => {
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === '/:path*');
  assert.ok(all, 'a rule for every path');
  const h = Object.fromEntries(all.headers.map((x) => [x.key, x.value]));
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.deepEqual(
    all.headers,
    securityHeaders(process.env.NODE_ENV === 'production'),
  );
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

/**
 * The source string is a path-to-regexp pattern: `/programs/:file(<custom regex>)`. Rebuilt here
 * as a plain RegExp (no path-to-regexp dependency available to apps/frontend's test runner) so
 * the test exercises the same matching the custom regex expresses, not just the literal string.
 */
function routeRegex(source: string): RegExp {
  const m = source.match(/^(.*):[A-Za-z_]+\((.+)\)$/);
  if (!m) throw new Error(`cannot parse source as a custom-regex param: ${source}`);
  const [, prefix, paramPattern] = m;
  return new RegExp(`^${prefix}${paramPattern}$`);
}

test('v2.7 fix round 1 (Finding 4), narrowed in fix round 2: a program logo file keeps the sandbox CSP, the guide page route does not', async () => {
  const rules = await nextConfig.headers!();
  const i = rules.findIndex((r) => r.source.startsWith('/programs/:file('));
  assert.ok(
    i > rules.findIndex((r) => r.source === '/:path*'),
    'after the global rule',
  );
  assert.deepEqual(rules[i].headers, [
    { key: 'Content-Security-Policy', value: IMAGE_CSP },
  ]);
  const re = routeRegex(rules[i].source);
  assert.ok(re.test('/programs/arc.svg'), 'matches a logo file');
  assert.ok(re.test('/programs/arc-microgrants.png'), 'matches a logo file');
  assert.ok(
    !re.test('/programs/arc-microgrants'),
    "doesn't match Task 7's /programs/<id> guide-page route",
  );
});

test('HSTS in production only (local http is never pinned)', () => {
  const hsts = (production: boolean) =>
    securityHeaders(production).find(
      (h) => h.key === 'Strict-Transport-Security',
    )?.value;
  assert.equal(hsts(true), 'max-age=31536000');
  assert.equal(hsts(false), undefined);
});
