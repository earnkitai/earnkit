import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubOAuthFetch } from './fixtures/github-oauth';
import { GitHubAuthError, authorizeUrl, exchangeCode, oauthConfigured, signState, verifyState } from './github-auth';

const ENV = { GITHUB_OAUTH_CLIENT_ID: 'Iv1.client', GITHUB_OAUTH_CLIENT_SECRET: 'shh-secret' };
const SECRET = 'state-secret-0123456789abcdef0123456789';
const NOW = new Date('2026-11-06T12:00:00Z');
const MIN = 60_000;
const USER = { id: 77, login: 'ada', name: 'Ada L', avatar_url: 'https://avatars.githubusercontent.com/u/77' };

test('authorizeUrl asks for read:user and returns to the callback on the origin', () => {
  const u = authorizeUrl('st.ate', 'https://earnkit.com', ENV);
  assert.ok(u.startsWith('https://github.com/login/oauth/authorize?'));
  assert.ok(u.includes('scope=read:user'));
  const q = new URL(u).searchParams;
  assert.equal(q.get('client_id'), 'Iv1.client');
  assert.equal(q.get('redirect_uri'), 'https://earnkit.com/auth/github/callback');
  assert.equal(q.get('scope'), 'read:user');
  assert.equal(q.get('state'), 'st.ate');
});

test('verifyState accepts its own state and refuses a tampered or 16-minute-old one', () => {
  const state = signState({ code: 'abc', exp: NOW.getTime() + 15 * MIN }, SECRET);
  assert.deepEqual(verifyState(state, SECRET, NOW), { code: 'abc' });
  assert.deepEqual(verifyState(state, SECRET, new Date(NOW.getTime() + 14 * MIN)), { code: 'abc' });
  assert.equal(verifyState(state, SECRET, new Date(NOW.getTime() + 16 * MIN)), null);
  const [body, sig] = state.split('.');
  const forged = Buffer.from(JSON.stringify({ code: 'other', exp: NOW.getTime() + 15 * MIN })).toString('base64url');
  assert.equal(verifyState(`${forged}.${sig}`, SECRET, NOW), null);
  assert.equal(verifyState(`${body}.${sig}x`, SECRET, NOW), null);
  assert.equal(verifyState(`${body}.${sig}.x`, SECRET, NOW), null);
  assert.equal(verifyState(state, 'another-secret-0123456789abcdef0123', NOW), null);
  assert.equal(verifyState('', SECRET, NOW), null);
});

test('exchangeCode returns the GitHub user over the fake', async () => {
  const gh = githubOAuthFetch(USER);
  const u = await exchangeCode('gh-code', 'https://earnkit.com', ENV, gh.fetch);
  assert.deepEqual(u, { github_id: 77, login: 'ada', name: 'Ada L', avatar_url: 'https://avatars.githubusercontent.com/u/77' });
  assert.deepEqual(gh.calls, ['POST https://github.com/login/oauth/access_token', 'GET https://api.github.com/user']);
});

test('exchangeCode throws GitHubAuthError on a 401 user read, a failed token and a missing id', async () => {
  await assert.rejects(exchangeCode('c', 'https://earnkit.com', ENV, githubOAuthFetch(USER, { fail: 'user' }).fetch), GitHubAuthError);
  await assert.rejects(exchangeCode('c', 'https://earnkit.com', ENV, githubOAuthFetch(USER, { fail: 'token' }).fetch), GitHubAuthError);
  const noId = githubOAuthFetch({ ...USER, id: undefined as unknown as number });
  await assert.rejects(exchangeCode('c', 'https://earnkit.com', ENV, noId.fetch), GitHubAuthError);
  const err = await exchangeCode('c', 'https://earnkit.com', ENV, githubOAuthFetch(USER, { fail: 'user', token: 'gho_secret_xyz' }).fetch).catch((e: Error) => e);
  assert.ok(err instanceof GitHubAuthError);
  assert.equal(err.message.includes('\n'), false);
  assert.equal(err.message.includes('gho_secret_xyz') || err.message.includes('shh-secret'), false);
});

test('oauthConfigured is false with one var missing', () => {
  assert.equal(oauthConfigured(ENV), true);
  assert.equal(oauthConfigured({ GITHUB_OAUTH_CLIENT_ID: 'x' }), false);
  assert.equal(oauthConfigured({ GITHUB_OAUTH_CLIENT_SECRET: 'x' }), false);
  assert.equal(oauthConfigured({ GITHUB_OAUTH_CLIENT_ID: '', GITHUB_OAUTH_CLIENT_SECRET: 'x' }), false);
});
