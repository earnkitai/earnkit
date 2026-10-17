import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { sql } from '../db';
import { fakeGitHub } from './fake-github-branch';

/**
 * Test only (v2.13.3, shared by v2.13.4): the read-only GitHub App switched on with a generated key,
 * and a fake GitHub where one repo is a private org repo that only the installation token can read.
 */
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
export const APP = { GITHUB_OAUTH_CLIENT_ID: 'v2133-client', GITHUB_OAUTH_CLIENT_SECRET: 'v2133-secret', GITHUB_APP_ID: '424242', GITHUB_APP_SLUG: 'earnkit-read', GITHUB_APP_PRIVATE_KEY: privateKey };
/** The installation token the fake mints (unique per process, so a leak check can search for it). */
export const TOKEN = `ghs_fixture_${randomBytes(3).toString('hex')}_secret`;
export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * GitHub where `key` is a private org repo: EarnKit's own token gets 404 for it (REST and GraphQL); the
 * installation token (minted for installation 77) reads it. `commits`: how many commits its history
 * shows this week (default 1). Everything else is fakeGitHub's.
 */
export function privateGitHub(key: string, o: { commits?: number } = {}) {
  const base = fakeGitHub();
  const org = key.split('/')[0];
  base.repos[key] = { owner: { login: org, type: 'Organization' }, private: true } as never;
  const minted: unknown[] = [];
  const week = new Date(Date.now() - 86_400_000).toISOString();
  const history = Array.from({ length: o.commits ?? 1 }, () => ({ committedDate: week }));
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('authorization');
    if (url.pathname === '/app/installations/77/access_tokens' && init?.method === 'POST') {
      minted.push(JSON.parse(String(init.body)));
      return json(201, { token: TOKEN });
    }
    // v2.13.3 review M4: the installation GitHub names for the repo (asked with the App's JWT).
    if (url.pathname.toLowerCase() === `/repos/${key}/installation`) return json(200, { id: 77 });
    const mine = auth === `Bearer ${TOKEN}`;
    if (url.pathname === '/graphql')
      return mine
        ? json(200, { data: { r0: {
            nameWithOwner: key, isPrivate: true, isFork: false, isTemplate: false, owner: { __typename: 'Organization', login: org },
            stargazers: { edges: [] }, forks: { nodes: [] }, stargazerCount: 0, forkCount: 0, defaultBranchRef: { target: { history: { nodes: history } } },
          } } })
        : json(200, { data: { r0: null }, errors: [{ type: 'NOT_FOUND' }] });
    if (url.pathname.toLowerCase().startsWith(`/repos/${key}`)) {
      if (!mine) return json(404, { message: 'Not Found' });
      if (url.pathname.endsWith('/contributors')) return json(200, [{ login: 'jenil' }]);
    }
    return base.f(input, init);
  }) as typeof fetch;
  return { ...base, f, minted };
}

/** The builder installed the App (installation 77) on `key`, proven through the setup URL (a `via = 'app'` row). */
export const installApp = (id: number, key: string, login: string) => sql()`
  INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose, via, github_installation_id)
  VALUES (${key}, ${login}, ${id}, now() - interval '2 years', 3, 'app', 'app', 77)`;
