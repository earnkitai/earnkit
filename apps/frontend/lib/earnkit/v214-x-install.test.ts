import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { redirectClass, registerClient } from './oauth';
import { authorizeGet, tokenPost } from './oauth-routes';
import { SIGNIN_TEXT, attachToX, xSignInCallback } from './x-install';
import { connectInstallation, saveInstallation } from './installations';
import { mcpCall } from './fixtures/mcp-call';
import type { XOAuthDeps, XUser } from './x-oauth';

process.env.EARNKIT_AUTH_SECRET ??= 'x-install-test-secret';
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });

const RUN = String(process.pid % 100000);
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const LOOPBACK = 'http://127.0.0.1:33418/callback';
const noLimit = { limit: async () => {} };
const fakeX = (user: XUser): XOAuthDeps & { calls: number } => {
  const x = { calls: 0, exchange: async () => (x.calls++, 'x-token'), me: async () => user };
  return x;
};
const person = (n: string): XUser => ({ id: `91${RUN}${[...n].map((c) => c.charCodeAt(0) % 10).join('')}`, username: `${n}${RUN}`.slice(0, 15), name: n, avatar: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg' });
const clientFor = (redirect = LOOPBACK, name = 'Claude Code') => registerClient({ redirect_uris: [redirect], client_name: name }).client_id;
const authorizeReq = (clientId: string, redirect = LOOPBACK, extra: Record<string, string> = {}) =>
  new Request(`https://earnkit.com/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, state: 'client-state-1', code_challenge: CHALLENGE, code_challenge_method: 'S256', ...extra })}`);
const ctxOf = (c: { id: number; own: number; shared: boolean; x: string | null }) => ({ installationId: c.id, ownInstallationId: c.own, sharedClient: c.shared, xUserId: c.x });

/** authorize (302 to X with the cookie) then X back to the callback, as a browser carries them. */
async function toCallback(clientId: string, user: XUser, o: { redirect?: string; cookie?: string | null } = {}) {
  const start = await authorizeGet(authorizeReq(clientId, o.redirect ?? LOOPBACK), noLimit);
  assert.equal(start.status, 302);
  const toX = new URL(start.headers.get('location')!);
  assert.equal(`${toX.origin}${toX.pathname}`, 'https://x.com/i/oauth2/authorize');
  const cookie = start.headers.get('set-cookie')!.split(';')[0];
  const state = toX.searchParams.get('state')!;
  const c = o.cookie === undefined ? cookie : o.cookie;
  const back = await xSignInCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${state}`, { headers: c ? { cookie: c } : {} }), { x: fakeX(user), ...noLimit });
  return { back: back!, state, cookie, toX };
}
async function exchange(clientId: string, code: string, redirect = LOOPBACK) {
  const res = await tokenPost(new Request('https://earnkit.com/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `203.0.113.${Number(RUN) % 250}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: VERIFIER }),
  }));
  return res;
}
async function signIn(clientId: string, user: XUser, redirect = LOOPBACK) {
  const { back } = await toCallback(clientId, user, { redirect });
  assert.equal(back.status, 302);
  const toAgent = new URL(back.headers.get('location')!);
  const res = await exchange(clientId, toAgent.searchParams.get('code')!, redirect);
  assert.equal(res.status, 200);
  const { access_token } = (await res.json()) as { access_token: string };
  return { token: access_token, toAgent, caller: (await connectInstallation(access_token))! };
}

test('4.2 authorize with X on: one row, the cookie, straight to X; the client state and challenge stay with EarnKit', db, async () => {
  const start = await authorizeGet(authorizeReq(clientFor()), noLimit);
  const to = new URL(start.headers.get('location')!);
  assert.equal(to.searchParams.get('client_id'), 'cid');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://earnkit.com/x/callback');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.notEqual(to.searchParams.get('code_challenge'), CHALLENGE, "EarnKit's own PKCE with X, never the client's");
  assert.notEqual(to.searchParams.get('state'), 'client-state-1');
  assert.match(start.headers.get('set-cookie')!, /^__Host-eki-[0-9a-f]{16}=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=900; HttpOnly; Secure; SameSite=Lax$/);
  const h = createHash('sha256').update(to.searchParams.get('state')!).digest('hex');
  const [row] = await sql()<{ purpose: string; oauth: { state: string; code_challenge: string; redirect_uri: string } }[]>`SELECT purpose, oauth FROM x_signins WHERE state_hash = ${h}`;
  assert.equal(row.purpose, 'install');
  assert.equal(row.oauth.state, 'client-state-1');
  assert.equal(row.oauth.code_challenge, CHALLENGE);
  assert.equal(row.oauth.redirect_uri, LOOPBACK);
});

test('4.3 an unknown https redirect host gets one page naming it before X; a known agent host goes straight', db, async () => {
  const other = 'https://agent.example.org/oauth/cb';
  const page = await authorizeGet(authorizeReq(clientFor(other, 'Some Agent'), other), noLimit);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(SIGNIN_TEXT.forHost('agent.example.org')));
  assert.ok(html.includes(SIGNIN_TEXT.warning));
  assert.match(html, /href="https:\/\/x\.com\/i\/oauth2\/authorize\?[^"]+"/);
  assert.match(page.headers.get('set-cookie')!, /^__Host-eki-/);
  const claude = 'https://claude.ai/api/mcp/auth_callback';
  assert.equal((await authorizeGet(authorizeReq(clientFor(claude, 'Claude'), claude), noLimit)).status, 302);
});

test('4.4 a hosted agent serving many (grok.com) and X off keep the anonymous approval', db, async () => {
  const grok = 'https://grok.com/oauth/callback';
  const r = await authorizeGet(authorizeReq(clientFor(grok, 'Grok'), grok), noLimit);
  assert.equal(r.status, 302);
  assert.ok(r.headers.get('location')!.startsWith(`${grok}?`));
  assert.ok(new URL(r.headers.get('location')!).searchParams.get('code'));
  delete process.env.X_CLIENT_ID;
  try {
    const off = await authorizeGet(authorizeReq(clientFor()), noLimit);
    assert.ok(off.headers.get('location')!.startsWith(`${LOOPBACK}?`));
  } finally {
    process.env.X_CLIENT_ID = 'cid';
  }
});

test('4.5 the callback needs this browser cookie, and takes the state once', db, async () => {
  const user = person('cara');
  const forwarded = await toCallback(clientFor(), user, { cookie: null });
  assert.equal(forwarded.back.status, 403, 'a forwarded X return finishes nowhere');
  const wrong = await toCallback(clientFor(), user, { cookie: `__Host-eki-0000000000000000=${'a'.repeat(43)}` });
  assert.equal(wrong.back.status, 403);
  const ok = await toCallback(clientFor(), user);
  assert.equal(ok.back.status, 302);
  const loc = new URL(ok.back.headers.get('location')!);
  assert.equal(`${loc.origin}${loc.pathname}`, LOOPBACK);
  assert.equal(loc.searchParams.get('state'), 'client-state-1');
  assert.equal(loc.searchParams.get('iss'), 'https://earnkit.com');
  const again = await xSignInCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${ok.state}`, { headers: { cookie: ok.cookie } }), { x: fakeX(user), ...noLimit });
  assert.equal(again, null, 'one use: the state is gone, so nothing finishes (the route answers 404)');
  assert.equal(await xSignInCallback(new Request('https://earnkit.com/x/callback?code=c&state=not-ours'), noLimit), null, 'not an install state: the route falls through');
});

test('4.6 the first token makes the page from X, and the first find through MCP shows it', db, async () => {
  const maya = person('maya');
  const { caller } = await signIn(clientFor(), maya);
  assert.equal(caller.x, maya.id);
  assert.equal(caller.shared, false);
  const [p] = await sql()<{ builder_id: number; x_handle: string; x_name: string; x_avatar_url: string; slug: string }[]>`
    SELECT builder_id, x_handle, x_name, x_avatar_url, slug FROM builder_profiles WHERE x_user_id = ${maya.id}`;
  assert.equal(p.builder_id, caller.id);
  assert.equal(p.x_handle, maya.username);
  assert.equal(p.x_name, 'maya');
  assert.equal(p.slug, maya.username.toLowerCase());
  const r = await mcpCall(ctxOf(caller), 'find', {});
  assert.ok(String(r.reply?.show_to_builder).includes(`https://earnkit.com/${maya.username}`));
});

test('4.7 a second agent signed in with the same X is the same person (acceptance 2); a reconnect too', db, async () => {
  const sam = person('sam');
  const first = await signIn(clientFor(), sam);
  const second = await signIn(clientFor('http://localhost:8787/callback', 'Cursor'), sam, 'http://localhost:8787/callback');
  assert.notEqual(second.caller.own, first.caller.own, 'its own installation');
  assert.equal(second.caller.id, first.caller.id, 'the same person');
  const id = clientFor();
  const a = await signIn(id, sam);
  const b = await signIn(id, sam);
  assert.equal(b.caller.own, a.caller.own, 'the same agent re-authorizing is the same installation');
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_profiles WHERE x_user_id = ${sam.id}`;
  assert.equal(n, 1);
});

test('4.8 another X account on the same registration is a new installation and never the first one', db, async () => {
  const id = clientFor();
  const one = await signIn(id, person('ana'));
  const two = await signIn(id, person('ben'));
  assert.notEqual(two.caller.own, one.caller.own);
  assert.notEqual(two.caller.id, one.caller.id);
  assert.equal((await connectInstallation(one.token))!.x, person('ana').id, 'the first token still acts as its own X');
});

test('4.9 a pre-v2.14 anonymous token keeps working, anonymous', db, async () => {
  const token = `ek_legacy_${RUN}_${Date.now()}`;
  await saveInstallation(token, undefined, false);
  const c = (await connectInstallation(token))!;
  assert.equal(c.x, null);
  const r = await mcpCall(ctxOf(c), 'find', {});
  assert.equal(r.isError, false);
});

test('4.10 an X account the owner cleared gets no code', db, async () => {
  const gone = person('gone');
  await sql()`INSERT INTO x_owner_clears (x_user_id, builder_id) VALUES (${gone.id}, 0) ON CONFLICT DO NOTHING`;
  const { back } = await toCallback(clientFor(), gone);
  assert.equal(back.status, 403);
  assert.ok((await back.text()).includes(SIGNIN_TEXT.paused));
});

test('4.11 the migration binds claimed pages\' installations, never shared or unclaimed ones, and reruns as a no-op', db, async () => {
  const schema = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');
  const block = /-- v2\.14 bind:start\n([\s\S]*?)-- v2\.14 bind:end/.exec(schema)![1];
  const mk = async (shared = false) => {
    const t = `ek_mig_${RUN}_${Math.random().toString(36).slice(2)}`;
    await saveInstallation(t, undefined, shared);
    return (await connectInstallation(t))!.own;
  };
  const root = await mk();
  const member = await mk();
  const lone = await mk();
  await sql()`UPDATE installations SET builder_id = ${root} WHERE id = ${member}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at, x_user_id, x_handle, claimed_at) VALUES (${root}, ${`mig${RUN}`}, now(), ${`88${RUN}1`}, ${`mig${RUN}`}, now())`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at) VALUES (${lone}, ${`lone${RUN}`}, now())`;
  await sql().unsafe(block);
  await sql().unsafe(block);
  const rows = await sql()<{ id: number; x: string | null }[]>`SELECT id, x_user_id AS x FROM installations WHERE id IN (${root}, ${member}, ${lone}) ORDER BY id`;
  assert.deepEqual(rows.map((r) => r.x), [`88${RUN}1`, `88${RUN}1`, null]);
});

test('4.12 attachToX is idempotent and refuses an installation bound to another X', db, async () => {
  const t = `ek_att_${RUN}_${Date.now()}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  const r1 = await attachToX(own, person('dee'), new Date());
  const r2 = await attachToX(own, person('dee'), new Date());
  assert.ok(r1.ok && r2.ok && r1.root === r2.root);
  assert.deepEqual(await attachToX(own, person('eve'), new Date()), { ok: false, reason: 'other_x' });
});

test('4.13 S5: a bindX refusal leaves the installation unbound and unattached (one transaction)', db, async () => {
  const t = `ek_ref_${RUN}_${Date.now()}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  // Its own (pre-v2.14) profile holds another X account without a handle: bindX refuses (claimed_by_other).
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at, x_user_id) VALUES (${own}, ${`ref${RUN}${own}`}, now(), ${`89${RUN}${own}`})`;
  assert.deepEqual(await attachToX(own, person('fay'), new Date()), { ok: false, reason: 'claimed_by_other' });
  const [row] = await sql()<{ x: string | null; b: number | null }[]>`SELECT x_user_id AS x, builder_id AS b FROM installations WHERE id = ${own}`;
  assert.deepEqual(row, { x: null, b: null });
  assert.equal((await connectInstallation(t))!.x, null);
  const [p] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_profiles WHERE x_user_id = ${person('fay').id}`;
  assert.equal(p.n, 0);
});

test('4.14 no merge: an installation with data signing in with an X that has a page attaches alone; its data and members stay behind', db, async () => {
  const gus = person('gus');
  const page = await signIn(clientFor(), gus);
  const t = `ek_old_${RUN}_${Date.now()}`;
  await saveInstallation(t, undefined, false);
  const old = (await connectInstallation(t))!.own;
  const mt = `ek_mem_${RUN}_${Date.now()}`;
  await saveInstallation(mt, undefined, false);
  const member = (await connectInstallation(mt))!.own;
  await sql()`UPDATE installations SET builder_id = ${old} WHERE id = ${member}`;
  await sql()`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id) VALUES (${old}, 'k', 'pitch', 'old answer', 'p')`;
  const r = await attachToX(old, gus, new Date());
  assert.ok(r.ok && r.root === page.caller.id && r.created === false);
  const now = (await connectInstallation(t))!;
  assert.equal(now.id, page.caller.id, 'the old installation is the X page now');
  assert.equal(now.x, gus.id);
  const [a] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM answer_bank WHERE installation_id = ${page.caller.id}`;
  assert.equal(a.n, 0, 'nothing merged into the page');
  const [kept] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM answer_bank WHERE installation_id = ${old}`;
  assert.equal(kept.n, 1, 'its data stays behind');
  const m = (await connectInstallation(mt))!;
  assert.notEqual(m.id, page.caller.id, 'its old member does not become the page');
  assert.equal(m.x, null);
});

test('4.15 S5: two X accounts racing for one installation: one binds, the other is refused', db, async () => {
  const t = `ek_race_${RUN}_${Date.now()}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  const [a, b] = [person('ivy'), person('jon')];
  const rs = await Promise.all([attachToX(own, a, new Date()), attachToX(own, b, new Date())]);
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.deepEqual(rs.find((r) => !r.ok), { ok: false, reason: 'other_x' });
  const winner = rs[0].ok ? a : b;
  const [row] = await sql()<{ x: string }[]>`SELECT x_user_id AS x FROM installations WHERE id = ${own}`;
  assert.equal(row.x, winner.id);
  const [p] = await sql()<{ x: string }[]>`SELECT x_user_id AS x FROM builder_profiles WHERE builder_id = ${own}`;
  assert.equal(p.x, winner.id, 'the page holds the same X as the token');
});

test('4.16 a shared installation is never bound', db, async () => {
  const t = `ek_sh_${RUN}_${Date.now()}`;
  await saveInstallation(t, undefined, true);
  const own = (await connectInstallation(t))!.own;
  assert.deepEqual(await attachToX(own, person('kai'), new Date()), { ok: false, reason: 'shared' });
  assert.equal((await connectInstallation(t))!.x, null);
});

test('4.17 S6 fix 1: only known agent app schemes skip the warning page; a browser trampoline or unknown scheme sees the full URI', db, async () => {
  for (const uri of ['microsoft-edge:https://evil.example/cb', 'x-safari-https://evil.example/cb', 'googlechromes://evil.example/cb', 'firefox:https://evil.example/cb', 'web+ek://evil.example/cb', 'someunknownapp://cb']) {
    assert.equal(redirectClass(uri).cls, 'other', uri);
    const page = await authorizeGet(authorizeReq(clientFor(uri, 'Some Agent'), uri), noLimit);
    assert.equal(page.status, 200, uri);
    const html = await page.text();
    assert.ok(html.includes(SIGNIN_TEXT.warning), uri);
    assert.ok(html.includes(SIGNIN_TEXT.sendsTo(uri).replace(/&/g, '&amp;')), `${uri}: the full redirect is shown`);
  }
  for (const uri of ['cursor://anysphere.cursor-mcp/oauth/callback', 'vscode://vscode.github-authentication/did-authenticate', 'vscode-insiders://x/cb', 'windsurf://x/cb', 'claude://claude.ai/cb']) {
    assert.equal(redirectClass(uri).cls, 'app', uri);
    assert.equal((await authorizeGet(authorizeReq(clientFor(uri, 'Cursor'), uri), noLimit)).status, 302, uri);
  }
  // Minor 4: the page names the host with its port.
  const ported = 'https://agent.example.org:8443/cb';
  assert.deepEqual(redirectClass(ported), { cls: 'other', host: 'agent.example.org:8443' });
  const html = await (await authorizeGet(authorizeReq(clientFor(ported, 'Some Agent'), ported), noLimit)).text();
  assert.ok(html.includes(SIGNIN_TEXT.forHost('agent.example.org:8443')));
  // Escaped: a redirect with markup characters never becomes markup.
  const odd = 'https://agent.example.org/cb?a="><b>x</b>';
  const oddHtml = await (await authorizeGet(authorizeReq(clientFor(odd, 'Some Agent'), odd), noLimit)).text();
  assert.ok(!oddHtml.includes('"><b>x</b>'));
});

test('4.18 fix 1: an attach refused at the token exchange issues no token (invalid_grant)', db, async () => {
  const late = person('lou');
  const id = clientFor();
  const { back } = await toCallback(id, late);
  assert.equal(back.status, 302);
  const code = new URL(back.headers.get('location')!).searchParams.get('code')!;
  // The owner clears the X account between the callback and the token exchange.
  await sql()`INSERT INTO x_owner_clears (x_user_id, builder_id) VALUES (${late.id}, 0) ON CONFLICT DO NOTHING`;
  const res = await exchange(id, code);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; access_token?: string };
  assert.equal(body.error, 'invalid_grant');
  assert.equal(body.access_token, undefined);
  const [n] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM installations WHERE x_user_id = ${late.id}`;
  assert.equal(n.n, 0, 'nothing bound');
  assert.equal((await exchange(id, code)).status, 400, 'a replay is refused too');
});
