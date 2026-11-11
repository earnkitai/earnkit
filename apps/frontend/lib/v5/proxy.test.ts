import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { config, lowerPath, proxy } from '../../proxy';

/** Next's own reading of a matcher entry (the regex the server tests each path against, case-sensitive). */
const require = createRequire(import.meta.url);
const { tryToParsePath } = require('next/dist/lib/try-to-parse-path') as { tryToParsePath: (p: string) => { regexStr?: string; error?: unknown } };
const matched = (path: string) =>
  config.matcher.some((m) => {
    const parsed = tryToParsePath(m);
    assert.ok(parsed.regexStr && !parsed.error, m);
    return new RegExp(parsed.regexStr).test(path);
  });

const withOrigin = async <T>(fn: () => Promise<T>): Promise<T> => {
  const saved = process.env.EARNKIT_URL;
  process.env.EARNKIT_URL = 'https://earnkit.com';
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.EARNKIT_URL;
    else process.env.EARNKIT_URL = saved;
  }
};

test('L25-20 (v6.1.16): lowerPath lower-cases a path with an upper-case letter and keeps the query; else null', () => {
  assert.equal(lowerPath(new URL('https://earnkit.com/Programs/Base-Builder-Grants?x=1'))?.href, 'https://earnkit.com/programs/base-builder-grants?x=1');
  assert.equal(lowerPath(new URL('https://earnkit.com/DOCS'))?.href, 'https://earnkit.com/docs');
  assert.equal(lowerPath(new URL('https://earnkit.com/docs?Q=A')), null);
  assert.equal(lowerPath(new URL('https://earnkit.com/')), null);
});

test('L25-20 (v6.1.16): a capitalised page path is a 308 to its lower-case form on the public origin; /docs and /api/Programs pass', async () => {
  await withOrigin(async () => {
    const r = await proxy(new Request('http://10.0.0.7:8080/Programs/Base-Builder-Grants?x=1') as never);
    assert.equal(r.status, 308);
    assert.equal(r.headers.get('location'), 'https://earnkit.com/programs/base-builder-grants?x=1');
    const d = await proxy(new Request('http://10.0.0.7:8080/DOCS') as never);
    assert.equal(d.status, 308);
    assert.equal(d.headers.get('location'), 'https://earnkit.com/docs');
    const me = await proxy(new Request('http://10.0.0.7:8080/Me') as never);
    assert.equal(me.headers.get('location'), 'https://earnkit.com/me');
    for (const path of ['/docs', '/api/Programs', '/images/agents/Foo.svg', '/_next/static/AbC/x.js', '/MCP', '/OAuth/Token']) {
      const res = await proxy(new Request(`http://10.0.0.7:8080${path}`) as never);
      assert.notEqual(res.status, 308, path);
      assert.equal(res.headers.get('location'), null, path);
    }
  });
});

test('L25-20 (v6.1.16): the matcher picks capitalised page paths and never /mcp, /oauth/token, /oauth/register, /api or files', () => {
  for (const p of ['/Programs', '/programs/Thiel-Fellowship', '/DOCS', '/Terms', '/Me', '/Link/ABC']) assert.ok(matched(p), p);
  for (const p of ['/mcp', '/MCP', '/Mcp/x', '/oauth/token', '/oauth/register', '/OAuth/Token', '/api/Programs', '/API/programs', '/_next/static/AbC/x.js', '/images/agents/Foo.svg', '/docs', '/programs', '/programs/thiel-fellowship/x', '/programs/thiel-fellowship.svg', '/'])
    assert.ok(!matched(p), p);
  // Task 5's entries stay; L27-3 (v6.1.16): a guide path is matched for the unknown-id 404 rewrite.
  for (const p of ['/me', '/oauth/authorize', '/.well-known/oauth-authorization-server', '/programs/thiel-fellowship']) assert.ok(matched(p), p);
});
