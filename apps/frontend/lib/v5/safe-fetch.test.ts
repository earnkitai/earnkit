import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSON_MAX_BYTES, RedirectError, SafeFetchError, safeFetchJson } from './safe-fetch';
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
