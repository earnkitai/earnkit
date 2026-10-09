import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_CSP, HOST_HEADERS, HOST_RESERVED } from '../../../apps/frontend/lib/earnkit/host-names';
import {
  ENDED_PAGE,
  TAKEN_DOWN_PAGE,
  contentTypeFor,
  handle,
  objectKey,
  siteSlug,
  type Bucket,
  type EdgeCache,
} from './route';

const ZONE = 'earnkit.com';

/** A Map-backed fake R2 bucket that counts reads. */
function fakeBucket(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files));
  const reads: string[] = [];
  const bucket: Bucket = {
    async get(key) {
      reads.push(key);
      const text = store.get(key);
      if (text === undefined) return null;
      const bytes = new TextEncoder().encode(text);
      return { body: new Response(bytes).body as ReadableStream, size: bytes.length };
    },
  };
  return { bucket, reads, store };
}

/** A Map-backed fake Cache API keyed by URL (GET only, as the Workers cache is). */
function fakeCache() {
  const store = new Map<string, Response>();
  const puts: string[] = [];
  const cache: EdgeCache = {
    async match(req) {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      puts.push(req.url);
      store.set(req.url, new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers }));
    },
  };
  return { cache, store, puts };
}

const live = (login = 'alice') => JSON.stringify({ status: 'live', login });

async function run(
  url: string,
  files: Record<string, string>,
  opts: { method?: string; host?: string; reserved?: string; cache?: ReturnType<typeof fakeCache> } = {},
) {
  const b = fakeBucket(files);
  const c = opts.cache ?? fakeCache();
  const pending: Promise<unknown>[] = [];
  const headers: Record<string, string> = {};
  if (opts.host) headers.host = opts.host;
  const req = new Request(url, { method: opts.method ?? 'GET', headers });
  const res = await handle(req, { BUCKET: b.bucket, ZONE, RESERVED: opts.reserved }, c.cache, (p) => {
    pending.push(p);
  });
  await Promise.all(pending);
  return { res, reads: b.reads, cache: c };
}

function assertHostHeaders(res: Response) {
  for (const [name, value] of Object.entries(HOST_HEADERS)) {
    assert.equal(res.headers.get(name), value, `${name} on ${res.status}`);
  }
  assert.equal(res.headers.get('Content-Security-Policy'), HOST_CSP);
}

test('7.1 siteSlug: one label under the zone, not reserved, lowercased, port and trailing dot handled', () => {
  assert.equal(siteSlug('tipjar-alice.earnkit.com', ZONE, HOST_RESERVED), 'tipjar-alice');
  for (const host of [
    'www.earnkit.com',
    'docs.earnkit.com',
    'earnkit.com',
    'a.b.earnkit.com',
    'tipjar-alice.earnkit.com.evil.io',
    '-x.earnkit.com',
    'x-.earnkit.com',
    '.earnkit.com',
    'tipjar-aliceearnkit.com',
    'tip_jar.earnkit.com',
    'tipjar-alice.earnkit.com:abc',
    'user@tipjar-alice.earnkit.com',
    '',
  ]) {
    assert.equal(siteSlug(host, ZONE, HOST_RESERVED), null, host);
  }
  assert.equal(siteSlug('TipJar-Alice.EarnKit.COM', ZONE, HOST_RESERVED), 'tipjar-alice');
  assert.equal(siteSlug('tipjar-alice.earnkit.com:443', ZONE, HOST_RESERVED), 'tipjar-alice');
  assert.equal(siteSlug('tipjar-alice.earnkit.com.', ZONE, HOST_RESERVED), 'tipjar-alice');
  assert.equal(siteSlug('a'.repeat(63) + '.earnkit.com', ZONE, HOST_RESERVED), 'a'.repeat(63));
  assert.equal(siteSlug('a'.repeat(64) + '.earnkit.com', ZONE, HOST_RESERVED), null);
  assert.equal(siteSlug('shop.earnkit.com', ZONE, [...HOST_RESERVED, 'shop']), null);
});

test('7.2 objectKey: index files, and traversal or odd paths are null', () => {
  assert.equal(objectKey('s', '/'), 'sites/s/index.html');
  assert.equal(objectKey('s', '/app/'), 'sites/s/app/index.html');
  assert.equal(objectKey('s', '/app.js'), 'sites/s/app.js');
  assert.equal(objectKey('s', '/a%20b.png'), 'sites/s/a b.png');
  assert.equal(objectKey('s', '/.well-known/x.txt'), 'sites/s/.well-known/x.txt');
  for (const p of ['/../x', '/%2e%2e/x', '/%2E%2E/x', '/a/..', '/./x', '/a\\b', '/a%5cb', '/a//b', '/a%00b', '/%e0%a4%a', '//x']) {
    assert.equal(objectKey('s', p), null, p);
  }
});

test('7.3 a reserved or foreign host is 404 and never reads the bucket', async () => {
  const files = { 'state/www.json': live(), 'sites/www/index.html': 'x', 'state/shop.json': live(), 'sites/shop/index.html': 'x' };
  for (const host of ['www.earnkit.com', 'earnkit.com', 'evil.io', 'a.b.earnkit.com', 'tipjar-alice.earnkit.com.evil.io']) {
    const { res, reads } = await run(`https://${host}/`, files, { host });
    assert.equal(res.status, 404, host);
    assert.equal(reads.length, 0, host);
    assertHostHeaders(res);
  }
  const { res, reads } = await run('https://shop.earnkit.com/', files, { host: 'shop.earnkit.com', reserved: ' Shop , ,mail2' });
  assert.equal(res.status, 404);
  assert.equal(reads.length, 0);
});

test('7.3 the Host header decides the slug, not the URL', async () => {
  const files = { 'state/tipjar-alice.json': live(), 'sites/tipjar-alice/index.html': '<p>hi</p>' };
  const { res, reads } = await run('https://tipjar-alice.earnkit.com/', files, { host: 'docs.earnkit.com' });
  assert.equal(res.status, 404);
  assert.equal(reads.length, 0);
});

test('7.4 every response carries HOST_HEADERS with the exact CSP', async () => {
  const files = {
    'state/ok-a.json': live(),
    'sites/ok-a/index.html': '<p>hi</p>',
    'state/gone-a.json': JSON.stringify({ status: 'ended', login: 'a' }),
    'state/bad-a.json': '{not json',
  };
  const cases: [string, number, string?][] = [
    ['https://ok-a.earnkit.com/', 200],
    ['https://ok-a.earnkit.com/missing.js', 404],
    ['https://gone-a.earnkit.com/', 410],
    ['https://nope-a.earnkit.com/', 404],
    ['https://bad-a.earnkit.com/', 404],
    ['https://ok-a.earnkit.com/', 405, 'POST'],
  ];
  for (const [url, status, method] of cases) {
    const { res } = await run(url, files, { method });
    assert.equal(res.status, status, `${method ?? 'GET'} ${url}`);
    assertHostHeaders(res);
  }
  const cached = fakeCache();
  await run('https://ok-a.earnkit.com/', files, { cache: cached });
  const { res: hit } = await run('https://ok-a.earnkit.com/', {}, { cache: cached });
  assert.equal(hit.status, 200);
  assertHostHeaders(hit);
});

test('7.4 a bucket error is a 500 with the headers', async () => {
  const bucket: Bucket = {
    async get() {
      throw new Error('r2 down');
    },
  };
  const res = await handle(new Request('https://ok-a.earnkit.com/'), { BUCKET: bucket, ZONE }, fakeCache().cache, () => {});
  assert.equal(res.status, 500);
  assertHostHeaders(res);
});

test('7.5 killed and review are taken down, ended has ended, no state is 404', async () => {
  const files: Record<string, string> = {};
  for (const s of ['killed', 'review', 'ended', 'live']) {
    files[`state/${s}-a.json`] = JSON.stringify({ status: s, login: 'a' });
    files[`sites/${s}-a/index.html`] = '<p>site</p>';
  }
  for (const s of ['killed', 'review']) {
    const { res, reads, cache } = await run(`https://${s}-a.earnkit.com/`, files);
    assert.equal(res.status, 410);
    assert.equal(await res.text(), TAKEN_DOWN_PAGE);
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.deepEqual(reads, [`state/${s}-a.json`]);
    assert.equal(cache.puts.length, 0);
  }
  const ended = await run('https://ended-a.earnkit.com/x.js', files);
  assert.equal(ended.res.status, 410);
  assert.equal(await ended.res.text(), ENDED_PAGE);
  assert.match(TAKEN_DOWN_PAGE, /This site was taken down\./);
  assert.match(ENDED_PAGE, /This site has ended\./);

  const unknown = await run('https://other-a.earnkit.com/', files);
  assert.equal(unknown.res.status, 404);
  assert.deepEqual(unknown.reads, ['state/other-a.json']);

  const odd = await run('https://odd-a.earnkit.com/', { 'state/odd-a.json': JSON.stringify({ status: 'paused' }), 'sites/odd-a/index.html': 'x' });
  assert.equal(odd.res.status, 404);
  assert.deepEqual(odd.reads, ['state/odd-a.json']);
});

test('7.6 a miss reads state then file and caches 300 s; a hit reads nothing', async () => {
  const files = { 'state/tipjar-alice.json': live(), 'sites/tipjar-alice/index.html': '<p>tip</p>' };
  const c = fakeCache();
  const miss = await run('https://tipjar-alice.earnkit.com/', files, { cache: c });
  assert.equal(miss.res.status, 200);
  assert.equal(await miss.res.text(), '<p>tip</p>');
  assert.deepEqual(miss.reads, ['state/tipjar-alice.json', 'sites/tipjar-alice/index.html']);
  assert.equal(miss.res.headers.get('Cache-Control'), 'public, max-age=300');
  assert.equal(miss.res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.deepEqual(c.puts, ['https://tipjar-alice.earnkit.com/']);
  assert.equal(c.store.get('https://tipjar-alice.earnkit.com/')!.headers.get('Cache-Control'), 'public, max-age=300');

  const hit = await run('https://TipJar-Alice.earnkit.com/?bust=1', files, { cache: c, host: 'TipJar-Alice.earnkit.com:443' });
  assert.equal(hit.res.status, 200);
  assert.equal(await hit.res.text(), '<p>tip</p>');
  assert.deepEqual(hit.reads, []);
  assert.equal(c.puts.length, 1);
});

test('7.6 HEAD is served without a body and is not cached', async () => {
  const files = { 'state/tipjar-alice.json': live(), 'sites/tipjar-alice/app.js': 'x()' };
  const { res, cache } = await run('https://tipjar-alice.earnkit.com/app.js', files, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.body, null);
  assert.equal(res.headers.get('Content-Type'), 'text/javascript');
  assert.equal(cache.puts.length, 0);
  assertHostHeaders(res);
});

test('7.6 a missing extensionless path tries x/index.html, then 404.html, then a plain 404', async () => {
  const files = {
    'state/s-a.json': live(),
    'sites/s-a/about/index.html': '<p>about</p>',
    'sites/s-a/404.html': '<p>lost</p>',
    'state/t-a.json': live(),
  };
  const about = await run('https://s-a.earnkit.com/about', files);
  assert.equal(about.res.status, 200);
  assert.equal(await about.res.text(), '<p>about</p>');
  assert.deepEqual(about.reads, ['state/s-a.json', 'sites/s-a/about', 'sites/s-a/about/index.html']);

  const lost = await run('https://s-a.earnkit.com/nope.css', files);
  assert.equal(lost.res.status, 404);
  assert.equal(await lost.res.text(), '<p>lost</p>');
  assert.equal(lost.res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.deepEqual(lost.reads, ['state/s-a.json', 'sites/s-a/nope.css', 'sites/s-a/404.html']);
  assert.equal(lost.cache.puts.length, 0);

  const plain = await run('https://t-a.earnkit.com/nope', files);
  assert.equal(plain.res.status, 404);
  assert.deepEqual(plain.reads, ['state/t-a.json', 'sites/t-a/nope', 'sites/t-a/nope/index.html', 'sites/t-a/404.html']);
  assertHostHeaders(plain.res);
});

test('7.2 a traversal path is 400 and never reads the bucket', async () => {
  const files = { 'state/s-a.json': live() };
  const { res, reads } = await run('https://s-a.earnkit.com/a//b', files);
  assert.equal(res.status, 400);
  assert.equal(reads.length, 0);
  assertHostHeaders(res);
});

test('7.7 contentTypeFor', () => {
  assert.equal(contentTypeFor('a/index.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('a/APP.JS'), 'text/javascript');
  assert.equal(contentTypeFor('a/m.wasm'), 'application/wasm');
  assert.equal(contentTypeFor('a/site.webmanifest'), 'application/manifest+json');
  assert.equal(contentTypeFor('a/s.css'), 'text/css; charset=utf-8');
  assert.equal(contentTypeFor('a/i.png'), 'image/png');
  assert.equal(contentTypeFor('a/f.woff2'), 'font/woff2');
  assert.equal(contentTypeFor('a/x.exe'), 'application/octet-stream');
  assert.equal(contentTypeFor('a/noext'), 'application/octet-stream');
  assert.equal(contentTypeFor('a.html/noext'), 'application/octet-stream');
});

test('7.8 only GET and HEAD are served; others are 405 with the headers and no read', async () => {
  const files = { 'state/s-a.json': live(), 'sites/s-a/index.html': 'x' };
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const { res, reads } = await run('https://s-a.earnkit.com/', files, { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('Allow'), 'GET, HEAD');
    assert.equal(reads.length, 0);
    assertHostHeaders(res);
  }
});
