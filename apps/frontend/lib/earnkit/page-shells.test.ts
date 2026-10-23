import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { appSetup } from './github-app';
import { VERIFY_PAGE, confirmPage, verifyCallback, verifyConfirm, verifyPage, verifyStart } from './github-verify';
import { authorizeGet } from './oauth-routes';
import { RateLimitError } from './rate-limit';
import { signinPage } from './x-install';
import { GET as xCallbackGet } from '../../app/x/callback/route';

// R14: every sign-in and verify page is the shared dark shell (brand-page.ts brandShell), with its slim top bar.
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const TOP_BAR = '<header class="ek-top">';

async function assertShell(res: Response, status: number, label: string) {
  assert.equal(res.status, status, `${label}: status`);
  assert.match(res.headers.get('content-type') ?? '', /^text\/html/, `${label}: content type`);
  const body = await res.text();
  assert.ok(body.startsWith('<!doctype html>'), `${label}: a full page`);
  assert.ok(body.includes(TOP_BAR), `${label}: the slim top bar`);
  assert.ok(!/—/.test(body.replace(/<style>[\s\S]*?<\/style>/, '')), `${label}: no em dash`);
  return body;
}

test('R14: the GitHub verify pages are the shell, every branch', async () => {
  await assertShell(verifyPage(VERIFY_PAGE.done), 200, 'done');
  await assertShell(verifyPage(VERIFY_PAGE.expired, 410), 410, 'expired');
  await assertShell(verifyPage(VERIFY_PAGE.failed, 403), 403, 'failed');
  await assertShell(verifyPage(VERIFY_PAGE.busy, 429), 429, 'busy');
  const confirm = confirmPage({ repo_key: 'a/b', handle: 'ada' }, 'n', 'c');
  assert.ok(confirm.startsWith('<!doctype html>') && confirm.includes(TOP_BAR), 'confirm page');
  const off = { GITHUB_OAUTH_CLIENT_ID: process.env.GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET: process.env.GITHUB_OAUTH_CLIENT_SECRET };
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  try {
    const req = new Request('http://localhost/github/verify?n=x');
    await assertShell(await verifyStart(req), 404, 'verifyStart off');
    await assertShell(await verifyConfirm(req), 404, 'verifyConfirm off');
    await assertShell(await verifyCallback(req), 404, 'verifyCallback off');
    await assertShell(await appSetup(req), 404, 'appSetup off');
  } finally {
    for (const [k, v] of Object.entries(off)) if (v !== undefined) process.env[k] = v;
  }
});

test('R14: OAuth authorize errors are the shell and keep their status', async () => {
  const limited = await authorizeGet(new Request('http://localhost/oauth/authorize'), {
    limit: async () => {
      throw new RateLimitError('Too many EarnKit sign-ins from this address.', 42);
    },
  });
  const body = await assertShell(limited, 429, 'authorize 429');
  assert.equal(limited.headers.get('retry-after'), '42');
  assert.match(body, /Too many EarnKit sign-ins from this address/);
  const bad = await authorizeGet(new Request('http://localhost/oauth/authorize?client_id=nope&redirect_uri=https%3A%2F%2Fx.test%2Fcb&response_type=code'), { limit: async () => {} });
  const badBody = await assertShell(bad, 400, 'authorize 400');
  assert.match(badBody, /Sign-in failed/);
});

test('R14: the X callback 404, sign-in pages and wallet pages are the shell', async () => {
  await assertShell(await xCallbackGet(new Request('http://localhost/x/callback?state=nope')), 404, 'x callback 404');
  await assertShell(signinPage('Hello.', 200), 200, 'signinPage');
  // v3.1 wallet proof fix round: /claim/wallet is a site page now (app/claim/wallet/page.tsx, v31-wallet-proof.test.ts).
});
