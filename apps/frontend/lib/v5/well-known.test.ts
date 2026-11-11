/** v6.1.16 Task 5 (lane 19): discovery paths and the 405s of the OAuth and discovery routes. No database. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as authorize from '../../app/oauth/authorize/route';
import * as register from '../../app/oauth/register/route';
import * as token from '../../app/oauth/token/route';
import * as asMeta from '../../app/.well-known/oauth-authorization-server/route';
import * as prMeta from '../../app/.well-known/oauth-protected-resource/[[...path]]/route';
import { proxy } from '../../proxy';

process.env.EARNKIT_URL = 'https://earnkit.test';

const at = (path?: string[]) => ({ params: Promise.resolve(path === undefined ? {} : { path }) });
const req = (path: string) => new Request(`https://earnkit.test${path}`);

test('L19-9: protected-resource metadata is served at the exact path and the /mcp suffix (a trailing slash on both); any other subpath is 404', async () => {
  // Next hands a trailing slash as the same segments: /x/ is ['x'], the bare path has no segments.
  for (const [path, segs] of [['/.well-known/oauth-protected-resource', undefined], ['/.well-known/oauth-protected-resource/', undefined], ['/.well-known/oauth-protected-resource/mcp', ['mcp']], ['/.well-known/oauth-protected-resource/mcp/', ['mcp']]] as const) {
    const r = await prMeta.GET(req(path), at(segs ? [...segs] : undefined));
    assert.equal(r.status, 200, path);
    assert.deepEqual(await r.json(), { resource: 'https://earnkit.test/mcp', authorization_servers: ['https://earnkit.test'], bearer_methods_supported: ['header'], resource_name: 'EarnKit' });
  }
  for (const segs of [['anything', 'else'], ['mcp', 'x'], ['other'], ['MCP']]) {
    const r = await prMeta.GET(req(`/.well-known/oauth-protected-resource/${segs.join('/')}`), at(segs));
    assert.equal(r.status, 404, segs.join('/'));
    assert.deepEqual(await r.json(), { error: 'not_found' });
  }
});

test('L19-1: every unserved method on the OAuth and discovery routes is 405 with its Allow and CORS', async () => {
  const cases: [string, Record<string, unknown>, string[], string][] = [
    ['/oauth/authorize', authorize, ['POST', 'PUT', 'PATCH', 'DELETE'], 'GET, HEAD, OPTIONS'],
    ['/oauth/register', register, ['GET', 'PUT', 'PATCH', 'DELETE'], 'POST, OPTIONS'],
    ['/oauth/token', token, ['GET', 'PUT', 'PATCH', 'DELETE'], 'POST, OPTIONS'],
    ['/.well-known/oauth-authorization-server', asMeta, ['POST', 'PUT', 'PATCH', 'DELETE'], 'GET, HEAD, OPTIONS'],
    ['/.well-known/oauth-protected-resource', prMeta, ['POST', 'PUT', 'PATCH', 'DELETE'], 'GET, HEAD, OPTIONS'],
  ];
  for (const [path, mod, methods, allow] of cases) {
    for (const m of methods) {
      const handler = mod[m] as (() => Response) | undefined;
      assert.ok(handler, `${m} ${path}`);
      const r = handler();
      assert.equal(r.status, 405, `${m} ${path}`);
      assert.equal(r.headers.get('allow'), allow, `${m} ${path}`);
      assert.equal(r.headers.get('access-control-allow-origin'), '*');
      assert.deepEqual(await r.json(), { error: 'method_not_allowed' });
    }
    // Methods no route can export are refused by the proxy before the route runs, on the paths it matches (fix round 1,
    // I1: authorize and discovery only; never /mcp, token or register, whose bodies Next would buffer).
    if (path === '/oauth/register' || path === '/oauth/token') continue;
    for (const method of ['TRACE', 'CONNECT', 'PROPFIND']) {
      const r = await proxy({ url: `https://earnkit.test${path}`, method, headers: new Headers() } as never);
      assert.equal(r.status, 405, `${method} ${path}`);
      assert.equal(r.headers.get('allow'), allow, `${method} ${path}`);
    }
  }
  // The served methods are unchanged.
  assert.equal((await asMeta.GET(req('/.well-known/oauth-authorization-server'))).status, 200);
  assert.equal(register.OPTIONS().status, 204);
  // N1 (fix round 1): authorize's own OPTIONS names what it serves, never the 405 methods.
  const o = authorize.OPTIONS();
  assert.equal(o.status, 204);
  assert.equal(o.headers.get('allow'), 'GET, HEAD, OPTIONS');
});
