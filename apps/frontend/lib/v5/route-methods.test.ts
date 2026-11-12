import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { METHODS_BY_ROUTE, allowOf, serves } from './route-methods';

/** Next's route methods (next/dist/server/web/http HTTP_METHODS). */
const HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'];
const APP = join(__dirname, '../../app');
/** Task 5's routes answer their own methods (well-known.test.ts pins them). */
const TASK_5 = /^\/(?:mcp|oauth\/|\.well-known\/)/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? routeFiles(p) : n === 'route.ts' ? [p] : [];
  });
}
const pathOf = (file: string) => `/${relative(APP, file).replace(/\/?route\.ts$/, '')}`.replace(/\[code\]/, 'abcd-efgh');

test('L31-1 (v6.1.16 Task 17): every route outside Task 5 serves its METHODS_BY_ROUTE set and answers every other method 405 with that Allow', async () => {
  const files = routeFiles(APP).filter((f) => !TASK_5.test(pathOf(f)));
  assert.ok(files.length >= 18, String(files.length));
  for (const file of files) {
    const path = pathOf(file);
    assert.ok(METHODS_BY_ROUTE.some(([re]) => re.test(path)), `${path} is in the table`);
    const allow = allowOf(path);
    const mod = (await import(file)) as Record<string, unknown>;
    for (const m of HTTP_METHODS) {
      const handler = mod[m] as ((r: Request) => Response | Promise<Response>) | undefined;
      if (serves(allow, m)) {
        // HEAD is Next's GET where the file does not name it.
        if (m !== 'HEAD' || !mod.GET) assert.ok(handler, `${m} ${path} is served`);
        if (handler && path.startsWith('/me/') && m === 'GET') {
          const r = await handler(new Request(`https://earnkit.test${path}`));
          assert.equal(r.status, 303);
          assert.equal(r.headers.get('location'), '/me');
        }
        continue;
      }
      assert.ok(handler, `${m} ${path} is exported, so Next's empty-Allow 405 never answers`);
      const r = await handler(new Request(`https://earnkit.test${path}`, { method: m }));
      assert.equal(r.status, 405, `${m} ${path}`);
      assert.equal(r.headers.get('allow'), allow, `${m} ${path}`);
      // L43-20 (v6.1.19): CORS only on the MCP, OAuth and well-known handlers, never here.
      assert.equal(r.headers.get('access-control-allow-origin'), null, `${m} ${path}`);
      assert.deepEqual(await r.json(), { error: 'method_not_allowed' });
    }
  }
});

test('L31-1 (v6.1.16 Task 17): PATCH on /me/edit is 405 with Allow: GET, POST; pages are GET, HEAD', async () => {
  const edit = (await import('../../app/me/edit/route')) as unknown as Record<string, () => Response>;
  const r = edit.PATCH();
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('allow'), 'GET, POST');
  assert.equal(allowOf('/'), 'GET, HEAD');
  assert.equal(allowOf('/programs/thiel-fellowship'), 'GET, HEAD');
  assert.equal(allowOf('/link/abcd-efgh'), 'GET');
  // L18-5 (v6.1.18 Task 5): the owner's list of sends is read only.
  assert.equal(allowOf('/api/programs/applications'), 'GET, HEAD');
  assert.ok(serves('GET', 'head') && !serves('GET, HEAD', 'TRACE') && !serves('POST', 'HEAD'));
});

test('L43-20: OPTIONS /api/me/signed-in is 405 with no CORS header; OPTIONS /mcp keeps it', async () => {
  const signedIn = (await import('../../app/api/me/signed-in/route')) as unknown as Record<string, () => Response>;
  const r = signedIn.OPTIONS();
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('allow'), 'GET, HEAD');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal(r.headers.get('access-control-allow-methods'), null);
  const mcp = (await import('../../app/mcp/route')) as unknown as Record<string, () => Response>;
  const put = mcp.PUT();
  assert.equal(put.status, 405);
  assert.equal(put.headers.get('access-control-allow-origin'), '*');
  // The two files a crawler reads answer OPTIONS as the pages do, through the proxy.
  const { proxy } = await import('../../proxy');
  for (const path of ['/sitemap.xml', '/robots.txt']) {
    const o = await proxy(new Request(`https://earnkit.test${path}`, { method: 'OPTIONS' }) as never);
    assert.equal(o.status, 405, path);
    assert.equal(o.headers.get('allow'), 'GET, HEAD', path);
    assert.equal(o.headers.get('access-control-allow-origin'), null, path);
  }
});
