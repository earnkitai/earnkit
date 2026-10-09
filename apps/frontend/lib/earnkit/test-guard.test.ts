import './fixtures/test-guard';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
