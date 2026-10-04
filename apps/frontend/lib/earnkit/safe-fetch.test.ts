import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SafeFetchError,
  isPublicAddress,
  pinnedLookup,
  resolveBoth,
  safeFetchText,
  safeProbe,
  type Resolver,
  type Transport,
} from './safe-fetch';

// No test here touches the network: the resolver and transport are always injected.

const resolveTo =
  (...addresses: string[]): Resolver =>
  async () =>
    addresses.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    }));

/** A resolver that answers with a public address, for tests that don't care which one. */
const publicResolver = resolveTo('93.184.216.34');

async function* chunks(...parts: string[]) {
  for (const p of parts) yield Buffer.from(p);
}

type Seen = { address: string; host: string; path: string }[];
const transport =
  (
    status: number,
    body: string[] = ['ok'],
    seen: Seen = [],
    contentLength?: number,
    location?: string,
  ): Transport =>
  async ({ url, address }) => {
    seen.push({ address, host: url.hostname, path: url.pathname });
    return { status, contentLength, location, body: chunks(...body) };
  };

const refuses = (p: Promise<unknown>, re: RegExp) =>
  assert.rejects(p, (e) => e instanceof SafeFetchError && re.test(e.message));

test('isPublicAddress: every blocked IPv4 range is refused', () => {
  for (const ip of [
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.8.9.10',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
});

test('isPublicAddress: every blocked IPv6 range is refused, incl. IPv4-mapped', () => {
  for (const ip of [
    '::',
    '::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:7f00:1', // the same, hex form
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:8.8.8.8', // mapped, even when public: never needed for a real host
    '::127.0.0.1', // IPv4-compatible (deprecated)
    '64:ff9b::7f00:1', // NAT64
    'fe80::1',
    'fe80::1%eth0',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    'ff05::2',
    '2001::1', // Teredo
    '2001:db8::1', // documentation
    '2002:7f00:1::1', // 6to4 of 127.0.0.1
    '3fff::1', // documentation
    '100::1', // discard-only
  ])
    assert.equal(isPublicAddress(ip), false, ip);
});

test('isPublicAddress: public addresses pass; junk does not', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111'])
    assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of ['', 'localhost', '127.1', '0x7f000001', '1.2.3.4.5'])
    assert.equal(isPublicAddress(ip), false, ip);
});

test('safeFetchText: fetches from the vetted address, keeping the hostname', async () => {
  const seen: Seen = [];
  const text = await safeFetchText(
    'https://acme.example/.well-known/earnkit.txt',
    {
      resolve: resolveTo('93.184.216.34'),
      transport: transport(200, ['earnkit-', 'sponsor: 0xabc'], seen),
    },
  );
  assert.equal(text, 'earnkit-sponsor: 0xabc');
  assert.deepEqual(seen, [
    {
      address: '93.184.216.34',
      host: 'acme.example',
      path: '/.well-known/earnkit.txt',
    },
  ]);
});

test('safeFetchText: refuses before connecting when any address is non-public', async () => {
  for (const addrs of [
    ['127.0.0.1'],
    ['169.254.169.254'],
    ['::1'],
    ['::ffff:10.0.0.1'],
    // One good and one bad: refused (a rebinding-style mixed answer).
    ['93.184.216.34', '10.0.0.5'],
    ['2606:4700::1111', 'fe80::1'],
  ]) {
    const seen: Seen = [];
    await refuses(
      safeFetchText('https://acme.example/x', {
        resolve: resolveTo(...addrs),
        transport: transport(200, ['ok'], seen),
      }),
      /doesn't point to a public address$/,
    );
    assert.equal(seen.length, 0, `connected for ${addrs}`);
  }
});

test('safeFetchText: https on port 443 with a domain name only', async () => {
  const opts = {
    resolve: resolveTo('93.184.216.34'),
    transport: transport(200),
  };
  await refuses(safeFetchText('http://acme.example/x', opts), /https only/);
  await refuses(safeFetchText('ftp://acme.example/x', opts), /https only/);
  await refuses(safeFetchText('https://acme.example:8443/x', opts), /port 443/);
  await refuses(safeFetchText('https://u:p@acme.example/x', opts), /user/);
  await refuses(safeFetchText('https://127.0.0.1/x', opts), /domain name/);
  await refuses(safeFetchText('https://[::1]/x', opts), /domain name/);
  await refuses(safeFetchText('not a url', opts), /valid link/);
});

test('safeFetchText: a redirect is a failure, never followed', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const seen: Seen = [];
    await refuses(
      safeFetchText('https://acme.example/x', {
        resolve: resolveTo('93.184.216.34'),
        transport: transport(status, [''], seen),
      }),
      /redirects aren't followed/,
    );
    assert.equal(seen.length, 1);
  }
  await refuses(
    safeFetchText('https://acme.example/x', {
      resolve: resolveTo('93.184.216.34'),
      transport: transport(404),
    }),
    /404/,
  );
});

test('safeFetchText: 4 KB cap, by header and while reading', async () => {
  const opts = (body: string[], len?: number) => ({
    resolve: resolveTo('93.184.216.34'),
    transport: transport(200, body, [], len),
  });
  assert.equal(
    (await safeFetchText('https://a.example/x', opts(['a'.repeat(4096)])))
      .length,
    4096,
  );
  await refuses(
    safeFetchText('https://a.example/x', opts(['a'.repeat(4097)])),
    /larger than 4096/,
  );
  await refuses(
    safeFetchText(
      'https://a.example/x',
      opts(['a'.repeat(3000), 'a'.repeat(3000)]),
    ),
    /larger than 4096/,
  );
  await refuses(
    safeFetchText('https://a.example/x', opts(['small'], 1_000_000)),
    /larger than 4096/,
  );
});

test('safeFetchText: times out (slow DNS or a slow server) and aborts the transport', async () => {
  // The resolver gets the deadline's signal, so slow DNS is cancelled, not left running (I5).
  let dnsAborted = false;
  await refuses(
    safeFetchText('https://a.example/x', {
      resolve: (_host, signal) => {
        signal.addEventListener('abort', () => (dnsAborted = true));
        return new Promise(() => {});
      },
      transport: transport(200),
      timeoutMs: 20,
    }),
    /no answer within/,
  );
  assert.equal(dnsAborted, true);
  let aborted = false;
  await refuses(
    safeFetchText('https://a.example/x', {
      resolve: resolveTo('93.184.216.34'),
      transport: async ({ signal }) => {
        signal.addEventListener('abort', () => (aborted = true));
        return {
          status: 200,
          body: (async function* () {
            yield Buffer.from('a');
            await new Promise(() => {});
          })(),
        };
      },
      timeoutMs: 20,
    }),
    /no answer within/,
  );
  assert.equal(aborted, true);
});

test('safeFetchText (review m1, m4): no internal address echoed; IPv4 tried first', async () => {
  await assert.rejects(
    safeFetchText('https://redis.example/x', {
      resolve: resolveTo('fd12:3456:789a::5'),
      transport: transport(200),
    }),
    (e: Error) =>
      !e.message.includes('fd12') && /public address/.test(e.message),
  );
  const seen: Seen = [];
  await safeFetchText('https://a.example/x', {
    resolve: resolveTo('2606:4700::1111', '93.184.216.34'),
    transport: transport(200, ['ok'], seen),
  });
  assert.equal(seen[0].address, '93.184.216.34');
});

test('safeFetchText: a transport error becomes a SafeFetchError', async () => {
  await refuses(
    safeFetchText('https://a.example/x', {
      resolve: resolveTo('93.184.216.34'),
      transport: async () => {
        throw new Error('certificate has expired');
      },
    }),
    /couldn't fetch it \(certificate has expired\)/,
  );
  await refuses(
    safeFetchText('https://a.example/x', {
      resolve: resolveTo(),
      transport: transport(200),
    }),
    /doesn't resolve/,
  );
});

test('pinnedLookup: always answers with the vetted address, in both call shapes', () => {
  const lookup = pinnedLookup('93.184.216.34', 4);
  let got: unknown[] = [];
  lookup('evil.example', { all: true }, (...a) => (got = a));
  assert.deepEqual(got, [null, [{ address: '93.184.216.34', family: 4 }]]);
  lookup('evil.example', {}, (...a) => (got = a));
  assert.deepEqual(got, [null, '93.184.216.34', 4]);
  lookup('evil.example', ((...a: unknown[]) => (got = a)) as never);
  assert.deepEqual(got, [null, '93.184.216.34', 4]);
});

test('resolveBoth: a safe A answer is used without waiting for AAAA; else both are vetted', async () => {
  const never = new Promise<string[]>(() => {});
  const noData = () =>
    Promise.reject(Object.assign(new Error('nodata'), { code: 'ENODATA' }));
  const servfail = () =>
    Promise.reject(Object.assign(new Error('servfail'), { code: 'ESERVFAIL' }));
  // AAAA never answers: the public A answer is returned anyway.
  assert.deepEqual(
    await resolveBoth(Promise.resolve(['93.184.216.34']), never),
    [{ address: '93.184.216.34', family: 4 }],
  );
  // A private A answer isn't "safe": AAAA is awaited and both go to the vetting step (refused there).
  assert.deepEqual(
    await resolveBoth(
      Promise.resolve(['10.0.0.5']),
      Promise.resolve(['2606:4700::1111']),
    ),
    [
      { address: '10.0.0.5', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ],
  );
  // No A records: the AAAA answer.
  assert.deepEqual(
    await resolveBoth(noData(), Promise.resolve(['2606:4700::1111'])),
    [{ address: '2606:4700::1111', family: 6 }],
  );
  // Neither has records: empty ("doesn't resolve"); both failing: an error.
  assert.deepEqual(await resolveBoth(noData(), noData()), []);
  await assert.rejects(resolveBoth(servfail(), servfail()), /servfail/);
  assert.deepEqual(
    await resolveBoth(servfail(), Promise.resolve(['2606:4700::1111'])),
    [{ address: '2606:4700::1111', family: 6 }],
  );
});

test('safeProbe: any 2xx passes without reading a large body', async () => {
  await safeProbe('https://example.com/app', {
    resolve: publicResolver,
    transport: async () => ({ status: 204, body: (async function* () { throw new Error('body read'); })() }),
  });
});

test('safeProbe: one redirect within the same site is followed (apex↔www, path change)', async () => {
  const seen: string[] = [];
  await safeProbe('https://example.com/', {
    resolve: publicResolver,
    transport: async ({ url }) => {
      seen.push(url.href);
      return url.hostname === 'example.com'
        ? { status: 301, location: 'https://www.example.com/home', body: (async function* () {})() }
        : { status: 200, body: (async function* () {})() };
    },
  });
  assert.deepEqual(seen, ['https://example.com/', 'https://www.example.com/home']);
});

test('safeProbe: a redirect to another site, or a second redirect, is refused', async () => {
  await assert.rejects(
    safeProbe('https://example.com/', { resolve: publicResolver, transport: async () => ({ status: 302, location: 'https://evil.test/', body: (async function* () {})() }) }),
    /another site/,
  );
  await assert.rejects(
    safeProbe('https://example.com/', { resolve: publicResolver, transport: async () => ({ status: 302, location: '/again', body: (async function* () {})() }) }),
    /redirects aren't followed/,
  );
});

test('safeProbe: 404 and private addresses fail with the reason', async () => {
  await assert.rejects(safeProbe('https://example.com/', { resolve: publicResolver, transport: async () => ({ status: 404, body: (async function* () {})() }) }), /answered 404/);
  await assert.rejects(safeProbe('https://example.com/', { resolve: async () => [{ address: '10.0.0.1', family: 4 }] }), /public address/);
});

test('safeFetchText is unchanged: still refuses redirects and non-200', async () => {
  await assert.rejects(safeFetchText('https://example.com/', { resolve: publicResolver, transport: async () => ({ status: 301, location: '/x', body: (async function* () {})() }) }), /redirects aren't followed \(301\)/);
});
