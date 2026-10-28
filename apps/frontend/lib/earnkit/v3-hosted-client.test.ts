import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from './db';
import { registerClient } from './oauth';
import { authorizeGet } from './oauth-routes';
import { SIGNIN_TEXT, attachToX, xSignInCallback } from './x-install';
import { SIGN_IN_NOTES, signInLink, signinGet } from './x-link';
import { tokenPost } from './oauth-routes';
import type { XOAuthDeps } from './x-oauth';
import { connectInstallation, saveInstallation, sharedGroup } from './installations';
import { mcpCall } from './fixtures/mcp-call';
import { X_ON, withEnv } from './fixtures/find';
import { enqueueClue } from './discovery';
import { pageHandle } from './github-verify';
import type { XUser } from './x-oauth';

process.env.EARNKIT_AUTH_SECRET ??= 'v3-hosted-test-secret';
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });

const RUN = String(process.pid % 100000);
const CHALLENGE = createHash('sha256').update('v'.repeat(64)).digest('base64url');
const GROK = 'https://grok.com/mcp/callback';
const noLimit = { limit: async () => {} };
const user = (n: string): XUser => ({ id: `93${RUN}${[...n].map((c) => c.charCodeAt(0) % 10).join('')}`, username: `${n}${RUN}`.slice(0, 15), name: n, avatar: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg' });
const hosted = async (tag: string) => {
  const t = `ek_v3h_${tag}_${RUN}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, true);
  return { token: t, own: (await connectInstallation(t))!.own };
};

test('(a) authorize from a hosted client goes to X, not straight to a code', db, async () => {
  const { client_id } = registerClient({ redirect_uris: [GROK], client_name: 'Grok' });
  const res = await authorizeGet(new Request(`https://earnkit.com/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: GROK, state: 's', code_challenge: CHALLENGE, code_challenge_method: 'S256' })}`), noLimit);
  assert.equal(res.status, 200, 'the warning page, then X');
  assert.ok((await res.text()).includes(SIGNIN_TEXT.warning));
});

test('(b) attachToX on a shared_client installation binds it and the caller is not shared', db, async () => {
  const { token, own } = await hosted('b');
  const r = await attachToX(own, user('ana'), new Date());
  assert.equal(r.ok, true);
  const c = (await connectInstallation(token))!;
  assert.equal(c.shared, false);
  assert.equal(c.x, user('ana').id);
  assert.equal(await sharedGroup(own), false);
});

test('(c) a second hosted token for the same X attaches to the same page', db, async () => {
  const a = await hosted('c1');
  const b = await hosted('c2');
  const r1 = await attachToX(a.own, user('cat'), new Date());
  const r2 = await attachToX(b.own, user('cat'), new Date());
  assert.ok(r1.ok && r2.ok);
  if (r1.ok && r2.ok) assert.equal(r2.root, r1.root);
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_profiles WHERE x_user_id = ${user('cat').id}`;
  assert.equal(n, 1);
});

test('(d) tell profile hide on a bound hosted installation hides the page (no SHARED note)', db, async () => {
  const { token, own } = await hosted('d');
  const r = await attachToX(own, user('dan'), new Date());
  assert.ok(r.ok);
  const c = (await connectInstallation(token))!;
  const out = await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: c.shared }, 'tell', { profile: 'hide' });
  assert.equal(out.isError, false, out.text);
  assert.ok(out.reply, out.text);
  assert.ok(!/shared/i.test(String(out.reply!.agent_note ?? '')), out.text);
  assert.ok(String(out.reply!.show_to_builder ?? '').length > 0, out.text);
});

test('(e) an anonymous shared_client installation stays shared', db, async () => {
  const { token } = await hosted('e');
  assert.equal((await connectInstallation(token))!.shared, true);
});

test('(f) a bound hosted installation gets discovery clues and its page handle; an anonymous one gets neither', db, async () => {
  const anon = await hosted('f1');
  assert.equal(await enqueueClue(anon.own, 'signin'), false);
  assert.equal(await pageHandle(anon.own), null);
  const bound = await hosted('f2');
  const r = await attachToX(bound.own, user('fay'), new Date());
  assert.ok(r.ok);
  assert.equal(await enqueueClue(bound.own, 'signin'), true);
  assert.equal(await pageHandle(bound.own), user('fay').username.toLowerCase());
});

test('(g) an anonymous shared_client installation is minted a sign-in link; a bound one is not', db, async () => {
  const anon = await hosted('g1');
  const link = await withEnv(X_ON, () => signInLink(anon.own, new Date()));
  assert.match(link ?? '', /^https:\/\/earnkit\.com\/signin\/[A-Za-z0-9_-]{22}$/);
  const bound = await hosted('g2');
  assert.ok((await attachToX(bound.own, user('gus'), new Date())).ok);
  assert.equal(await withEnv(X_ON, () => signInLink(bound.own, new Date())), null);
});

test('(h) an anonymous hosted find renders the Bench signed_out reply: Sign in with X and one link', db, async () => {
  const { token } = await hosted('h');
  const c = (await connectInstallation(token))!;
  const r = await withEnv({ EARNKIT_URL: undefined, ...X_ON }, () =>
    mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: c.shared }, 'find', { agent_can_build: true }));
  assert.equal(r.isError, false, r.text);
  const text = String(r.reply?.show_to_builder);
  assert.match(text, /Sign in with X/, text);
  assert.equal((text.match(/https?:\/\/\S+/g) ?? []).length, 1, text);
});

/** Opens the sign-in link in a browser, signs in with X, and reads the paste code off the done page. */
async function pasteCodeFor(link: string, u: XUser): Promise<string> {
  const code = link.split('/').pop()!;
  const page = await signinGet(new Request(link), code, noLimit);
  const html = await page.text();
  const to = new URL(/href="(https:\/\/x\.com\/i\/oauth2\/authorize[^"]+)"/.exec(html)![1].replaceAll('&amp;', '&'));
  const cookie = page.headers.get('set-cookie')!.split(';')[0];
  const x: XOAuthDeps = { exchange: async () => 'x-token', me: async () => u };
  const done = await xSignInCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${to.searchParams.get('state')}`, { headers: { cookie } }), { x, ...noLimit });
  return /([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec(await done!.text())![1];
}

test('(i) a successful hosted paste binds and the same reply is not signed_out', db, async () => {
  const { token, own } = await hosted('i');
  const c = (await connectInstallation(token))!;
  const link = (await withEnv(X_ON, () => signInLink(own, new Date())))!;
  const code = await pasteCodeFor(link, user('ivo'));
  const r = await withEnv({ EARNKIT_URL: undefined, ...X_ON }, () =>
    mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: c.shared }, 'find', { agent_can_build: true, sign_in_code: code }));
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply?.sign_in_note, SIGN_IN_NOTES.bound);
  assert.doesNotMatch(String(r.reply?.show_to_builder), /sign in with X|sign-in link/i);
  assert.equal((await connectInstallation(token))!.x, user('ivo').id);
});

test('(j) with X off, an anonymous hosted find keeps its programs reply', db, async () => {
  const { token } = await hosted('j');
  const c = (await connectInstallation(token))!;
  const r = await withEnv({ EARNKIT_URL: undefined, X_CLIENT_ID: undefined }, () =>
    mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: c.shared }, 'find', { agent_can_build: true }));
  assert.equal(r.isError, false, r.text);
  assert.doesNotMatch(String(r.reply?.show_to_builder), /Sign in with X/i);
  assert.ok(Array.isArray(r.reply?.programs) && (r.reply!.programs as unknown[]).length > 0, r.text);
});

test('(k) a bound token whose group holds an anonymous hosted member is not forced to signed_out', db, async () => {
  const a = await hosted('k1');
  const b = await hosted('k2');
  assert.ok((await attachToX(b.own, user('kit'), new Date())).ok);
  await sql()`UPDATE installations SET builder_id = ${b.own} WHERE id = ${a.own}`;
  const c = (await connectInstallation(b.token))!;
  assert.equal(c.shared, true, 'the group holds an anonymous hosted member');
  const r = await withEnv({ EARNKIT_URL: undefined, ...X_ON }, () =>
    mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: c.shared }, 'find', { agent_can_build: true }));
  assert.doesNotMatch(String(r.reply?.show_to_builder), /Sign in with X/i, r.text);
});

test('(l) two token exchanges for one hosted registration are two installations; binding one leaves the other anonymous', db, async () => {
  const { client_id } = registerClient({ redirect_uris: [GROK], client_name: 'Grok' });
  const exchange = async () => {
    const saved = process.env.X_CLIENT_ID;
    delete process.env.X_CLIENT_ID; // X off: authorize issues the code straight away
    let loc: string;
    try {
      const res = await authorizeGet(new Request(`https://earnkit.com/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: GROK, state: 's', code_challenge: CHALLENGE, code_challenge_method: 'S256' })}`), noLimit);
      loc = res.headers.get('location')!;
    } finally { process.env.X_CLIENT_ID = saved; }
    const code = new URL(loc).searchParams.get('code')!;
    const res = await tokenPost(new Request('https://earnkit.com/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `203.0.113.${Number(RUN) % 250}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id, redirect_uri: GROK, code_verifier: 'v'.repeat(64) }),
    }));
    assert.equal(res.status, 200);
    return (await connectInstallation(((await res.json()) as { access_token: string }).access_token))!;
  };
  const one = await exchange();
  const two = await exchange();
  assert.notEqual(one.own, two.own);
  assert.equal(one.shared, true);
  assert.ok((await attachToX(one.own, user('lee'), new Date())).ok);
  const [row] = await sql()<{ x: string | null }[]>`SELECT x_user_id AS x FROM installations WHERE id = ${two.own}`;
  assert.equal(row.x, null);
});
