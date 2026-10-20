import './fixtures/test-guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http, { createServer } from 'node:http';
import https from 'node:https';
import { promises as dnsPromises } from 'node:dns';
import { safeFetchText } from './safe-fetch';
import './fixtures/no-network-checks';
import type { AddressInfo } from 'node:net';

// v2.9 Part 2 final review I3: `pnpm test` preloads fixtures/test-guard.ts.

test('I3: the test guard clears the vendor keys a shell may export', () => {
  for (const name of ['TOKENSFUN_DEPLOY_API_KEY', 'RESEND_API_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'])
    assert.equal(process.env[name], undefined, name);
});

test('I3: fetch throws for any outside host and still reaches this machine', { skip: process.env.LINK_CHECK === '1' && 'LINK_CHECK=1 keeps the real fetch' }, async () => {
  for (const url of ['https://tokens.fun/api/deploy', 'https://mainnet.base.org', 'https://api.resend.com/emails', new URL('https://coins.llama.fi/x')])
    await assert.rejects(fetch(url), /test guard: no network in tests/);
  await assert.rejects(fetch(new Request('https://api.github.com/user')), /test guard/);
  const server = createServer((_, res) => res.end('ok'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address() as AddressInfo;
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'ok');
    assert.equal(await (await fetch(`http://localhost:${port}/`)).text(), 'ok');
  } finally {
    server.close();
  }
});

test('final fix I3: https.request and http.request (safe-fetch\'s transport) throw for any outside host; this machine still answers', { skip: process.env.LINK_CHECK === '1' && 'LINK_CHECK=1 keeps the real network' }, async () => {
  assert.throws(() => https.request({ hostname: 'dorahacks.io', port: 443, path: '/buidl/1' }), /test guard: no network in tests \(https\.request to dorahacks\.io\)/);
  assert.throws(() => https.request('https://dorahacks.io/buidl/1'), /test guard/);
  assert.throws(() => https.get(new URL('https://api.github.com/user')), /test guard/);
  assert.throws(() => http.request({ host: 'example.com', path: '/' }), /test guard/);
  assert.throws(() => http.get('http://example.com/'), /test guard/);
  // The name lookup that comes first never leaves the machine either.
  await assert.rejects(dnsPromises.lookup('dorahacks.io', { all: true }), /test guard: no network in tests \(dns lookup of dorahacks\.io\)/);
  await assert.rejects(new dnsPromises.Resolver().resolve4('dorahacks.io'), /test guard: no network in tests \(dns query for dorahacks\.io\)/);
  // safe-fetch's default resolver and transport: refused before any socket opens.
  await assert.rejects(safeFetchText('https://dorahacks.io/buidl/1'), /test guard|could not|resolve|load/i);
  const server = createServer((_, res) => res.end('ok'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address() as AddressInfo;
    const body = await new Promise<string>((resolve, reject) =>
      http.get({ hostname: 'localhost', port, path: '/' }, (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve(t));
      }).on('error', reject),
    );
    assert.equal(body, 'ok');
  } finally {
    server.close();
  }
});
