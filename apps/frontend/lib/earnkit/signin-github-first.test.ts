import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { sql } from './db';
import { avalanche, dropAvalanche, find, fitsFor, install, person, withEnv, X_ON } from './fixtures/find';
import { chooseAsk, connectAsk, enterAsk, type BenchAsk } from './bench-reply';
import { CLAIM_NOTE } from './bench-find';
import { claimGet, claimLink } from './claim';
import { appSetup, appTokenFor } from './github-app';
import { connectRepoKey, pickPost } from './github-connect';
import { completeVerify, createVerifyLink, csrfCookieName, verifyConfirm, type GitHubOAuthDeps } from './github-verify';
import { X_SCOPES } from './x-oauth';

/**
 * Sign-in first (one-pager step 2): the connect ask (GitHub then X, nothing to type), the repo-agnostic
 * read-only App link on the claim page, the one-repo auto-pick and the multi-repo picker, programs optional
 * during first run, and no new OAuth scopes. A fake fetch stands in for GitHub; nothing reaches the network.
 */

process.env.EARNKIT_AUTH_SECRET ||= 'signin-github-first-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropAvalanche();
  await sql().end();
});

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const OAUTH = { GITHUB_OAUTH_CLIENT_ID: 'test-client', GITHUB_OAUTH_CLIENT_SECRET: 'test-secret' };
const APP = { ...OAUTH, GITHUB_APP_ID: '123456', GITHUB_APP_SLUG: 'earnkit-read', GITHUB_APP_PRIVATE_KEY: privateKey };
const BENCH = { EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on', EARNKIT_URL: undefined, ...X_ON };
const NO_APP = { ...OAUTH, GITHUB_APP_ID: undefined, GITHUB_APP_SLUG: undefined, GITHUB_APP_PRIVATE_KEY: undefined };
const noLimit = { limit: async () => {} };
const RUN = randomBytes(3).toString('hex');

type Call = { method: string; path: string; body: unknown };
/** A fake GitHub: the installation (77) of `account` covers `repos`; records every call. */
function fakeGitHub(account: string, repos: string[]) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    calls.push({ method, path: u.pathname + u.search, body: init?.body ? JSON.parse(String(init.body)) : null });
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (u.pathname === '/app/installations/77') return ok({ id: 77, account: { login: account } });
    if (u.pathname === '/app/installations/77/access_tokens') return ok({ token: 'ghs_secret_token' }, 201);
    if (u.pathname === '/installation/repositories') return ok({ repositories: repos.map((full_name) => ({ full_name })) });
    const m = /^\/repos\/(.+)\/installation$/.exec(u.pathname);
    if (m && repos.includes(m[1])) return ok({ id: 77 });
    return ok({ message: 'Not Found' }, 404);
  }) as typeof fetch;
  return { f, calls };
}
const oauth = (login: string): GitHubOAuthDeps => ({
  exchange: async () => 'gho_token',
  user: async () => ({ login, created_at: '2020-01-01T00:00:00Z', public_repos: 3 }),
  repoPerms: async () => null,
});

/** A builder with a profile and a claim link; runs the connect link's OAuth hop and returns what the setup URL needs. */
async function connecting(login: string) {
  const id = await person({ projects: [] });
  const link = await createVerifyLink({ installationId: id, projectId: null, repoKey: connectRepoKey(id), purpose: 'app' });
  const nonce = new URL(link).searchParams.get('n')!;
  await completeVerify('code', nonce, oauth(login));
  const cookie = `${csrfCookieName(nonce)}=K1`;
  const setup = (f: typeof fetch) =>
    appSetup(new Request(`https://earnkit.com/github/verify/app?installation_id=77&setup_action=install&state=${encodeURIComponent(nonce)}`, { headers: { cookie } }), { ...noLimit, fetch: f });
  return { id, setup };
}
const mainOf = async (id: number) => (await sql()<{ k: string | null }[]>`SELECT main_project_key AS k FROM builder_profiles WHERE builder_id = ${id}`)[0].k;
const appRows = (id: number) => sql()<{ repo_key: string; via: string }[]>`SELECT repo_key, via FROM github_verifications WHERE installation_id = ${id}`;

test('connect ask: one link, nothing to type, no question; the claim kind and note stay', () => {
  const line = connectAsk('https://earnkit.com/claim/abcdefghijkl');
  assert.equal(line, 'Connect GitHub and X to get ranked (two sign-ins, nothing to type): https://earnkit.com/claim/abcdefghijkl');
  assert.ok(!line.includes('?'));
  assert.doesNotMatch(line, /verified|raise|raising|investor/i);
  assert.match(CLAIM_NOTE, /GitHub, then X/);
  assert.doesNotMatch(CLAIM_NOTE, /claims their page with X/);
});

test('find: unclaimed, the reply ends on the connect link (kind claim) and Ways to get funded still shows', dbTest, () =>
  withEnv(BENCH, async () => {
    const id = await install();
    const r = await find(id, {}, { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) });
    assert.ok(r.claim?.link);
    assert.ok(r.show_to_builder.endsWith(connectAsk(r.claim!.link)), r.show_to_builder);
    assert.equal((r.show_to_builder.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length, 0, 'no question');
    assert.equal(r.move_up?.kind, 'claim');
    assert.equal(r.move_up?.agent_note, CLAIM_NOTE);
    assert.ok(r.show_to_builder.includes('Ways to get funded'), r.show_to_builder);
  }));

test('first run: a confirmed project with no update posted is not asked to enter a program; once it has posted, it is', dbTest, () =>
  withEnv(BENCH, async () => {
    const p = await avalanche();
    const first = `signin${RUN}/first`;
    const id = await person({ main: first, claimed: `sf1${RUN}`, projects: [{ key: first, name: 'First', confirmed: true }] });
    const r = await find(id, {}, { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(p.id, first) }) });
    assert.notEqual(r.move_up?.kind, 'enter', r.show_to_builder);
    assert.ok(!r.show_to_builder.includes(enterAsk(p.title)));
    assert.ok(r.show_to_builder.includes('Ways to get funded'), 'programs stay as information');
    const posted = `signin${RUN}/posted`;
    const id2 = await person({ main: posted, claimed: `sf2${RUN}`, projects: [{ key: posted, name: 'Posted', confirmed: true, weeks_shipping: 1 }] });
    const r2 = await find(id2, {}, { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(p.id, posted) }) });
    assert.equal(r2.move_up?.kind, 'enter');
  }));

test('chooseAsk: firstRun skips enter and goes on to the next step', () => {
  const project = { key: 'a/b', name: 'B', confirmed: true, live: true, weeks: 0 };
  const enter: BenchAsk = { kind: 'enter', project_key: 'a/b', program_id: 'p', line: enterAsk('X') };
  const base = { project, canHost: false, updatesOn: false, postedThisWeek: false, scheduled: false, coin: null, build: null, enter, declined: [] as string[] };
  assert.equal(chooseAsk(base)?.kind, 'enter');
  assert.equal(chooseAsk({ ...base, firstRun: true })?.kind, 'updates');
});

test('claim page: GitHub first (the read-only App, no repo named), X second', dbTest, () =>
  withEnv({ ...BENCH, ...APP }, async () => {
    const id = await person({ projects: [] });
    const link = (await claimLink(id))!;
    const page = await (await claimGet(new Request(link), link.split('/').pop()!)).text();
    const gh = /href="(https:\/\/earnkit\.com\/github\/verify\?n=[^"]+)"/.exec(page)![1];
    assert.ok(page.indexOf('Connect GitHub') < page.indexOf('Continue with X'), 'GitHub comes first');
    const nonce = new URL(gh.replace(/&amp;/g, '&')).searchParams.get('n')!;
    const [row] = await sql()<{ purpose: string; repo_key: string }[]>`SELECT purpose, repo_key FROM github_verify_nonces WHERE installation_id = ${id}`;
    assert.deepEqual({ ...row }, { purpose: 'app', repo_key: connectRepoKey(id) });
    assert.ok(nonce);
    assert.ok(!page.includes('Public work only.'));
  }));

test('claim page, App off: the scopeless GitHub sign-in, public repos only, said in one line', dbTest, () =>
  withEnv({ ...BENCH, ...NO_APP }, async () => {
    const id = await person({ projects: [] });
    const link = (await claimLink(id))!;
    const page = await (await claimGet(new Request(link), link.split('/').pop()!)).text();
    assert.ok(page.includes('Public work only.'));
    assert.ok(page.indexOf('Connect GitHub') < page.indexOf('Continue with X'));
    const [row] = await sql()<{ purpose: string }[]>`SELECT purpose FROM github_verify_nonces WHERE installation_id = ${id}`;
    assert.equal(row.purpose, 'claim');
  }));

test('App setup, one repo: it becomes the main project, the App proof lets the commit reader mint a token for it, then on to X', dbTest, () =>
  withEnv({ ...BENCH, ...APP }, async () => {
    const repo = `alice${RUN}/private-app`;
    const gh = fakeGitHub(`alice${RUN}`, [repo]);
    const c = await connecting(`Alice${RUN}`);
    const res = await c.setup(gh.f);
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location')!, /^https:\/\/earnkit\.com\/claim\/[a-z2-7]{12}$/);
    assert.equal(await mainOf(c.id), repo);
    assert.deepEqual((await appRows(c.id)).map((r) => ({ ...r })), [{ repo_key: repo, via: 'app' }]);
    // The listing token is minted with no repo list and read-only permissions; the reader then mints a one-repo token.
    const mint = gh.calls.find((x) => x.path.endsWith('/access_tokens'))!;
    assert.deepEqual(mint.body, { permissions: { contents: 'read', metadata: 'read' } });
    assert.equal(await appTokenFor({ installationId: c.id, repoKey: repo }, { fetch: gh.f }), 'ghs_secret_token');
    assert.ok(gh.calls.some((x) => x.path.endsWith('/access_tokens') && JSON.stringify(x.body).includes('"repositories":["private-app"]')));
  }));

test('App setup, several repos: a picker (radio list, one button); the choice sets the main project; a bad csrf or an unlisted repo does not', dbTest, () =>
  withEnv({ ...BENCH, ...APP }, async () => {
    const [a, b] = [`bob${RUN}/one`, `bob${RUN}/two`];
    const gh = fakeGitHub(`bob${RUN}`, [a, b]);
    const c = await connecting(`Bob${RUN}`);
    const res = await c.setup(gh.f);
    assert.equal(res.status, 200);
    const page = await res.text();
    assert.equal((page.match(/type="radio"/g) ?? []).length, 2);
    assert.ok(page.includes(a) && page.includes(b));
    assert.equal(await mainOf(c.id), null, 'nothing is set before the choice');
    const t = /name="t" value="([^"]+)"/.exec(page)![1];
    const csrf = /name="csrf" value="([^"]+)"/.exec(page)![1];
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    const post = (fields: Record<string, string>, ck = cookie) =>
      pickPost(new Request('https://earnkit.com/github/verify/app/pick', {
        method: 'POST', headers: { cookie: ck, origin: 'https://earnkit.com', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
      }), { ...noLimit, fetch: gh.f });
    assert.equal((await post({ t, csrf: 'wrong', repo: b })).status, 403);
    assert.equal((await post({ t, csrf, repo: `bob${RUN}/not-listed` })).status, 403);
    assert.equal((await post({ t: `${t}x`, csrf, repo: b })).status, 403);
    assert.equal(await mainOf(c.id), null);
    const ok = await post({ t, csrf, repo: b });
    assert.equal(ok.status, 303);
    assert.match(ok.headers.get('location')!, /\/claim\/[a-z2-7]{12}$/);
    assert.equal(await mainOf(c.id), b);
    assert.deepEqual((await appRows(c.id)).map((r) => r.repo_key), [b]);
  }));

test('no new OAuth scopes: X keeps users.read tweet.read; the GitHub authorize URL carries none', dbTest, () =>
  withEnv({ ...BENCH, ...APP }, async () => {
    assert.equal(X_SCOPES, 'users.read tweet.read');
    const id = await person({ projects: [] });
    const link = await createVerifyLink({ installationId: id, projectId: null, repoKey: connectRepoKey(id), purpose: 'app' });
    const nonce = new URL(link).searchParams.get('n')!;
    const res = await verifyConfirm(new Request('https://earnkit.com/github/verify', {
      method: 'POST', headers: { cookie: `${csrfCookieName(nonce)}=K1`, origin: 'https://earnkit.com', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ n: nonce, csrf: 'K1' }),
    }), noLimit);
    assert.equal(res.status, 303);
    const to = new URL(res.headers.get('location')!);
    assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize');
    assert.equal(to.searchParams.has('scope'), false);
  }));
