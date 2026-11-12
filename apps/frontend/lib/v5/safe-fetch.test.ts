import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSON_MAX_BYTES, landingPage, LANDING_MAX_REDIRECTS, probeLink, RedirectError, SafeFetchError, safeFetchJson, safeProbePage } from './safe-fetch';
import { cimdFixture } from './fixtures/cimd';

const URL_ = 'https://client.example/cimd.json';

test('safeFetchJson returns the parsed document; asks for JSON; content type parameters are allowed', async () => {
  let accept: string | undefined;
  const f = cimdFixture({ body: { a: 1 }, contentType: 'application/json; charset=utf-8' });
  const transport: typeof f.transport = (req) => {
    accept = req.accept;
    return f.transport(req);
  };
  assert.deepEqual(await safeFetchJson(URL_, { resolve: f.resolve, transport }), { a: 1 });
  assert.equal(accept, 'application/json');
});

test('safeFetchJson refuses private and loopback addresses before any request', async () => {
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '::1', '192.168.1.1', 'fc00::1']) {
    const f = cimdFixture({ body: {} }, address);
    await assert.rejects(safeFetchJson(URL_, f), SafeFetchError, address);
    assert.equal(f.requests.length, 0, address);
  }
});

test('safeFetchJson never follows a redirect: one request, RedirectError', async () => {
  const f = cimdFixture({ status: 302, location: 'https://public.example/doc.json' });
  await assert.rejects(safeFetchJson(URL_, f), RedirectError);
  assert.deepEqual(f.requests, [URL_]);
});

test('safeFetchJson refuses http, an IP literal, a port, oversize bodies, a wrong content type and bad JSON', async () => {
  const f = cimdFixture({ body: {} });
  for (const u of ['http://client.example/cimd.json', 'https://93.184.216.34/cimd.json', 'https://client.example:8443/cimd.json'])
    await assert.rejects(safeFetchJson(u, f), SafeFetchError, u);
  assert.equal(f.requests.length, 0);
  assert.equal(JSON_MAX_BYTES, 10_240);
  const big = JSON.stringify({ pad: 'x'.repeat(JSON_MAX_BYTES - 9) });
  assert.equal(Buffer.byteLength(big), JSON_MAX_BYTES + 1);
  await assert.rejects(safeFetchJson(URL_, cimdFixture({ body: big })), /larger than 10240 bytes/);
  await assert.rejects(safeFetchJson(URL_, cimdFixture({ body: big, noLength: true })), /larger than 10240 bytes/);
  const fits = JSON.stringify({ pad: 'x'.repeat(JSON_MAX_BYTES - 10) });
  assert.equal(((await safeFetchJson(URL_, cimdFixture({ body: fits }))) as { pad: string }).pad.length, JSON_MAX_BYTES - 10);
  for (const contentType of ['text/html', 'application/jsonp', 'text/plain; x=application/json', ''])
    await assert.rejects(safeFetchJson(URL_, cimdFixture({ body: {}, contentType })), /not a JSON document/, contentType);
  await assert.rejects(safeFetchJson(URL_, cimdFixture({ body: '{nope' })), /not valid JSON/);
  await assert.rejects(safeFetchJson(URL_, cimdFixture({ status: 404, body: {} })), SafeFetchError);
});

test('safeFetchJson gives up after 5 s: a 5,001 ms stall is refused, 4,999 ms is still waiting', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const f = cimdFixture({ stall: true });
    let settled = false;
    const p = safeFetchJson(URL_, f).finally(() => (settled = true));
    p.catch(() => {});
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(4_999);
    await new Promise((r) => setImmediate(r));
    assert.equal(settled, false);
    mock.timers.tick(2);
    await assert.rejects(p, /no answer within 5 s/);
  } finally {
    mock.timers.reset();
  }
});

// v6.1.16 Task 16 (L30-2, Review Focus 22): the stale check's probe.

const PAGE = '<html><p>Grants for builders</p></html>';
const site = (answer: Parameters<typeof cimdFixture>[0]) => cimdFixture(answer);

test('probeLink: a 302 to another host is alive with that host and is never requested; safeProbePage (the builder live-link reader) still refuses it', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const f = site({ status, location: 'https://docs.google.com/forms/d/x/viewform?usp=sf_link', body: '' });
    // v6.1.19 (L44-15): with its Location and the redirects taken, for the landing read to start there.
    assert.deepEqual(await probeLink('https://forms.example/apply', f), { ok: true, redirect: 'docs.google.com', location: 'https://docs.google.com/forms/d/x/viewform?usp=sf_link', hops: 1 }, String(status));
    assert.deepEqual(f.requests, ['https://forms.example/apply']);
  }
  const f = site({ status: 302, location: 'https://docs.google.com/forms', body: '' });
  await assert.rejects(safeProbePage('https://forms.example/apply', f), /redirects to another site \(docs\.google\.com\)/);
  assert.deepEqual(f.requests, ['https://forms.example/apply']);
});

test('probeLink: a same-site redirect is followed once and its page read; a 3xx with no Location and a second redirect are alive', async () => {
  const hop = site((u) => (u.hostname === 'grants.example' ? { status: 301, location: 'https://www.grants.example/new', body: '' } : { status: 200, contentType: 'text/html', body: PAGE }));
  const r = await probeLink('https://grants.example/old', hop);
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.page?.includes('Grants for builders') && !r.redirect);
  assert.deepEqual(hop.requests, ['https://grants.example/old', 'https://www.grants.example/new']);
  assert.deepEqual(await probeLink('https://grants.example/x', site({ status: 302, body: '' })), { ok: true });
  const twice = site((u) => (u.pathname === '/a' ? { status: 302, location: '/b', body: '' } : { status: 302, location: 'https://login.other.example/', body: '' }));
  assert.deepEqual(await probeLink('https://grants.example/a', twice), { ok: true, redirect: 'login.other.example', location: 'https://login.other.example/', hops: 2 });
  assert.equal(twice.requests.length, 2);
});

test('probeLink: 401, 403 and 429 are alive; 404 and an error page are 4xx, 500 is 5xx, no address is dns, a stall is timeout, a private address is refused', async () => {
  for (const status of [401, 403, 429]) assert.deepEqual(await probeLink('https://w.example/', site({ status, body: '' })), { ok: true }, String(status));
  assert.deepEqual(await probeLink('https://w.example/', site({ status: 404, body: '' })), { ok: false, why: '4xx' });
  assert.deepEqual(await probeLink('https://w.example/', site({ status: 200, contentType: 'text/html', body: '<html><title>x</title>Page not found</html>' })), { ok: false, why: '4xx' });
  assert.deepEqual(await probeLink('https://w.example/', site({ status: 500, body: '' })), { ok: false, why: '5xx' });
  const f = site({ status: 200, body: '' });
  assert.deepEqual(await probeLink('https://w.example/', { ...f, resolve: async () => [] }), { ok: false, why: 'dns' });
  assert.deepEqual(await probeLink('https://w.example/', { ...site({ stall: true }), timeoutMs: 30 }), { ok: false, why: 'timeout' });
  const inside = cimdFixture({ status: 200, body: '' }, '10.0.0.5');
  assert.deepEqual(await probeLink('https://w.example/', inside), { ok: false, why: 'refused' });
  assert.equal(inside.requests.length, 0);
  assert.deepEqual(await probeLink('http://w.example/', f), { ok: false, why: 'refused' });
});

// v6.1.17 Task 3 (L30-8): a parked domain or a soft 404 on a program link is down; the builder live-link reader keeps its list.
test('probeLink: a 200 page saying the domain is for sale, or that the page could not be found, is down; safeProbePage reads them as before', async () => {
  const html = (t: string) => site({ status: 200, contentType: 'text/html', body: `<html><head><title>Welcome</title></head><body><p>${t}</p></body></html>` });
  for (const t of [
    'example-grants.com is for sale',
    'This domain is for sale. Make an offer.',
    'Buy this domain today.',
    'This domain may be for sale.',
    'example-grants.com is available for purchase.',
    'Sorry, we could not find that page',
    'This program is no longer available.',
  ]) {
    assert.deepEqual(await probeLink('https://example-grants.com/', html(t)), { ok: false, why: '4xx' }, t);
    assert.ok((await safeProbePage('https://example-grants.com/', html(t))).includes(t), t);
  }
  const titled = site({ status: 200, contentType: 'text/html', body: '<html><title>example-grants.com is for sale</title><p>Hello.</p></html>' });
  assert.deepEqual(await probeLink('https://example-grants.com/', titled), { ok: false, why: '4xx' });
  assert.equal((await probeLink('https://grants.example/', site({ status: 200, contentType: 'text/html', body: PAGE }))).ok, true);
});

test('L44-4, L44-15 (v6.1.19): landingPage starts at the Location with the hops already taken, and says a 4xx, 5xx, error page or no address landing is down', async () => {
  const at = (pages: Record<string, number | string | { to: string }>) => site((u) => {
    const p = pages[u.href];
    if (typeof p === 'number') return { status: p, body: '' };
    if (typeof p === 'object') return { status: 302, location: p.to, body: '' };
    return { status: 200, contentType: 'text/html', body: p ?? '' };
  });
  assert.equal(LANDING_MAX_REDIRECTS, 3);
  const ok = at({ 'https://docs.example/f': PAGE });
  assert.deepEqual(await landingPage('https://docs.example/f', { ...ok, hops: 1 }), { ok: true, page: PAGE, url: 'https://docs.example/f' });
  assert.deepEqual(ok.requests, ['https://docs.example/f']);
  for (const [status, why] of [[404, '4xx'], [410, '4xx'], [500, '5xx']] as const)
    assert.deepEqual(await landingPage('https://docs.example/f', at({ 'https://docs.example/f': status })), { ok: false, why, url: 'https://docs.example/f' });
  assert.deepEqual(await landingPage('https://docs.example/f', at({ 'https://docs.example/f': '<html><title>Page not found</title></html>' })), { ok: false, why: '4xx', url: 'https://docs.example/f' });
  assert.deepEqual(await landingPage('https://docs.example/f', { ...ok, resolve: async () => [] }), { ok: false, why: 'dns', url: 'https://docs.example/f' });
  assert.deepEqual(await landingPage('https://docs.example/f', at({ 'https://docs.example/f': 403 })), { ok: true, page: '', url: 'https://docs.example/f' });
  // Two hops taken already: one more redirect is followed, a second is not.
  const chain = at({ 'https://b.example/2': { to: 'https://c.example/3' }, 'https://c.example/3': { to: 'https://d.example/4' }, 'https://d.example/4': PAGE });
  assert.equal(await landingPage('https://b.example/2', { ...chain, hops: 2 }), null);
  assert.equal((await landingPage('https://b.example/2', { ...chain, hops: 1 }))?.ok, true);
  // Every hop is guarded: http, a private address, a port: not read, nothing requested past the refusal.
  const http = at({ 'https://a.example/1': { to: 'http://b.example/x' } });
  assert.equal(await landingPage('https://a.example/1', http), null);
  assert.deepEqual(http.requests, ['https://a.example/1']);
  const inside = { ...ok, resolve: async () => [{ address: '10.0.0.5', family: 4 as const }] };
  assert.equal(await landingPage('https://docs.example/f', inside), null);
  assert.equal(await landingPage('https://docs.example:8443/f', ok), null);
});
