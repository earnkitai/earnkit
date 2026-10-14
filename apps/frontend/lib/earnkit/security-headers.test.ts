import { test } from 'node:test';
import assert from 'node:assert/strict';
import nextConfig, { IMAGE_CSP, securityHeaders } from '../../next.config';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { csrfCookieName, verifyCallback, verifyStart } from './github-verify';

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

test("the token image and the generated mark keep their sandbox CSP (config headers replace a route's own)", async () => {
  const rules = await nextConfig.headers!();
  for (const source of ['/api/projects/:id/image', '/api/projects/:id/mark']) {
    const i = rules.findIndex((r) => r.source === source);
    assert.ok(
      i > rules.findIndex((r) => r.source === '/:path*'),
      `${source} after the global rule`,
    );
    assert.deepEqual(rules[i].headers, [
      { key: 'Content-Security-Policy', value: IMAGE_CSP },
    ]);
  }
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

// ---- v2.9 B9, Ruling 7, Ruling G8: cookies


const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' ? [] : sources(p);
    return /\.(ts|tsx|mts)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });

test('5.12 Ruling 7: every cookie EarnKit sets is __Host- (source scan of app/ and lib/); only the sign-in sets one', () => {
  const root = join(import.meta.dirname, '..', '..');
  const setting = [...sources(join(root, 'app')), ...sources(join(root, 'lib'))].filter((p) =>
    /Set-Cookie|cookies\(\)\.set|\.cookies\.set/i.test(readFileSync(p, 'utf8')),
  );
  // v2.10 item 7b: the App's setup URL only clears the sign-in's cookie, through github-verify's clearCsrf.
  // v2.12.1 T6: the X claim (claim.ts) sets its own per-code __Host- cookie, as the GitHub sign-in does.
  assert.deepEqual(setting.map((p) => p.slice(root.length + 1)).sort(), ['lib/earnkit/claim.ts', 'lib/earnkit/github-app.ts', 'lib/earnkit/github-verify.ts']);
  const claim = readFileSync(setting.find((p) => p.endsWith('claim.ts'))!, 'utf8');
  const claimCookies = [...claim.matchAll(/=>\s*`\$\{cookieName\(codeHash\)\}=([^`]*)`/g)];
  assert.equal(claimCookies.length, 2, 'set and clear');
  for (const m of claimCookies) assert.match(m[1], /Path=\/; .*HttpOnly; Secure; SameSite=Lax$/);
  assert.match(claim, /const cookieName = \(codeHash: string\) => `__Host-ekx-/);
  setting.sort((a, b) => a.localeCompare(b)).shift();
  const app = readFileSync(setting[0], 'utf8');
  assert.deepEqual([...app.matchAll(/'Set-Cookie': ([^}]+)/g)].map((m) => m[1].trim()), ['clearCsrf(nonce)']);
  assert.doesNotMatch(app, /__Host-|Max-Age|cookies\(\)\.set/);
  const src = readFileSync(setting[1], 'utf8');
  // Each Set-Cookie value is built from csrfCookieName, which is __Host- with Path=/ and Secure.
  for (const m of src.matchAll(/=>\s*`\$\{csrfCookieName\(nonce\)\}=([^`]*)`/g)) {
    assert.match(m[1], /Path=\/;/);
    assert.match(m[1], /HttpOnly; Secure; SameSite=Lax$/);
  }
  assert.equal([...src.matchAll(/=>\s*`\$\{csrfCookieName\(nonce\)\}=/g)].length, 2, 'set and clear');
  assert.match(csrfCookieName('n'), /^__Host-/);
});

test('5.12 the verify routes: off, no cookie at all; on, only the __Host- cookie (G8)', async () => {
  const old = [process.env.GITHUB_OAUTH_CLIENT_ID, process.env.GITHUB_OAUTH_CLIENT_SECRET];
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  try {
    for (const res of [
      await verifyStart(new Request('https://earnkit.com/github/verify?n=x')),
      await verifyCallback(new Request('https://earnkit.com/github/verify/callback?code=c&state=x.y')),
    ])
      assert.equal(res.headers.get('set-cookie'), null);
    process.env.GITHUB_OAUTH_CLIENT_ID = 'id';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'secret';
    const refused = await verifyCallback(new Request('https://earnkit.com/github/verify/callback?code=c&state=x.y'), undefined, { limit: async () => {} });
    assert.equal(refused.headers.get('set-cookie'), null);
  } finally {
    if (old[0] === undefined) delete process.env.GITHUB_OAUTH_CLIENT_ID;
    else process.env.GITHUB_OAUTH_CLIENT_ID = old[0];
    if (old[1] === undefined) delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    else process.env.GITHUB_OAUTH_CLIENT_SECRET = old[1];
  }
});

test('Ruling 7: HSTS never has includeSubDomains', () => {
  const hsts = securityHeaders(true).find((h) => h.key === 'Strict-Transport-Security')?.value ?? '';
  assert.doesNotMatch(hsts, /includeSubDomains/i);
});
