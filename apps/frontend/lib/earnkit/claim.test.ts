import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { CLAIM_TEXT, bindX, claimCode, claimGet, claimLink, claimPost, xCallback } from './claim';
import { clearXHandle, resolveHandle, resolveSlug, ensureProfile, setXHandle } from './profiles';
import { answerJoin, pendingJoinOf, rootOf } from './identity';
import { connectInstallation, saveInstallation } from './installations';
import type { XOAuthDeps, XUser } from './x-oauth';

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_AUTH_SECRET ??= 'claim-test-secret';
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

// The shared DB keeps every run's claimed people; x_user_id and the claimed handle are unique.
const RUN = String(process.pid % 100000);
const X = (n: string) => n + RUN;
const H = (h: string) => (h + RUN).slice(0, 15);
const NOW = new Date();
const stamp = () => `${process.pid}-${Date.now()}-${randomBytes(3).toString('hex')}`;

async function profiled(): Promise<number> {
  const token = `ek_test_${stamp()}`;
  await saveInstallation(token, undefined, false);
  const c = (await connectInstallation(token))!;
  await ensureProfile(c.own, NOW);
  return c.own;
}
const fakeX = (user: XUser): XOAuthDeps & { calls: number } => {
  const x = { calls: 0, exchange: async () => (x.calls++, 'tok'), me: async () => user };
  return x;
};
const failX = (): XOAuthDeps & { calls: number } => {
  const x = { calls: 0, exchange: async (): Promise<string> => { x.calls++; throw new Error('X down'); }, me: async (): Promise<XUser> => { throw new Error('no'); } };
  return x;
};
const noLimit = { limit: async () => {} };

/** The GET (the cookie and csrf), the POST (303 to X), and X's state, as a browser would carry them. */
async function startClaim(code: string, o: { origin?: string } = {}) {
  const get = await claimGet(new Request(`https://earnkit.com/claim/${code}`), code);
  assert.equal(get.status, 200);
  const cookie = get.headers.get('set-cookie')!.split(';')[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(await get.text())![1];
  const post = await claimPost(
    new Request(`https://earnkit.com/claim/${code}`, {
      method: 'POST',
      headers: { cookie, origin: o.origin ?? 'https://earnkit.com', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf }),
    }),
    code,
    noLimit,
  );
  return { post, cookie, csrf };
}
async function runClaim(code: string, x: XOAuthDeps, o: { cookie?: string | null } = {}) {
  const { post, cookie } = await startClaim(code);
  assert.equal(post.status, 303);
  const loc = post.headers.get('location')!;
  assert.ok(loc.startsWith('https://x.com/i/oauth2/authorize'), loc);
  const state = new URL(loc).searchParams.get('state')!;
  const c = o.cookie === undefined ? cookie : o.cookie;
  return xCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${encodeURIComponent(state)}`, { headers: c ? { cookie: c } : {} }), { x, limit: noLimit.limit });
}
const codeOf = async (id: number) => (await claimLink(id))!.split('/').pop()!;

test('6.3 the claim link is off without X, the same link every time, and gone once claimed', dbTest, async () => {
  const id = await profiled();
  delete process.env.X_CLIENT_ID;
  assert.equal(await claimLink(id), null);
  process.env.X_CLIENT_ID = 'cid';
  process.env.X_CLIENT_SECRET = 'sec';
  const a = await claimLink(id);
  assert.match(a!, /^earnkit\.com\/claim\/[a-z2-7]{12}$/);
  assert.equal(await claimLink(id), a);
  assert.equal(claimCode(id), a!.split('/').pop());
  assert.equal(claimCode(id, ''), null);
  // Only the code's hash is stored.
  const [row] = await sql()`SELECT code_hash FROM claim_codes WHERE builder_id = ${id}`;
  assert.equal(row.code_hash, createHash('sha256').update(a!.split('/').pop()!).digest('hex'));
  await bindX(id, { id: X('111'), username: H('lee_a'), name: 'Lee', avatar: null }, NOW);
  assert.equal(await claimLink(id), null);
});

test('6.4 a forwarded claim link: the first X account wins, a second one is refused', dbTest, async () => {
  const id = await profiled();
  const code = await codeOf(id);
  const first = await runClaim(code, fakeX({ id: X('222'), username: H('owner_x'), name: 'Owner', avatar: null }));
  assert.equal(first.status, 200);
  const done = await first.text();
  assert.match(done, new RegExp(`<h1>Your page is live</h1><p class="ek-url">earnkit\\.com/${H('owner_x')}</p>`));
  // T11 fix round 2: the page link is the primary button.
  assert.match(done, new RegExp(`<a class="ek-btn" href="https://earnkit\\.com/${H('owner_x')}">See your page</a>`));
  assert.match(first.headers.get('set-cookie') ?? '', /Max-Age=0/, 'the cookie is cleared');
  const again = await claimGet(new Request(`https://earnkit.com/claim/${code}`), code);
  assert.equal(again.status, 410);
  assert.match(await again.text(), new RegExp(CLAIM_TEXT.used));
  assert.deepEqual(await bindX(id, { id: X('333'), username: H('stranger'), name: 'S', avatar: null }, NOW), { ok: false, reason: 'claimed_by_other' });
  const [p] = await sql()`SELECT x_user_id, x_handle, x_name, claimed_at IS NOT NULL AS claimed FROM builder_profiles WHERE builder_id = ${id}`;
  assert.deepEqual({ ...p }, { x_user_id: X('222'), x_handle: H('owner_x'), x_name: 'Owner', claimed: true });
});

test('6.5 X down at the callback: nothing is bound, the page says so, the same link still works', dbTest, async () => {
  const id = await profiled();
  const code = await codeOf(id);
  const r = await runClaim(code, failX());
  assert.equal(r.status, 502);
  assert.match(await r.text(), new RegExp(CLAIM_TEXT.failed));
  const [p] = await sql()`SELECT x_user_id FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(p.x_user_id, null);
  assert.equal(await claimLink(id), `earnkit.com/claim/${code}`);
  const ok = await runClaim(code, fakeX({ id: X('2221'), username: H('retry_x'), name: 'R', avatar: null }));
  assert.equal(ok.status, 200);
});

test('6.6 a handle that moved to someone else: the new holder wins, the old holder is cleared, no redirect to them', dbTest, async () => {
  const [a, b] = [await profiled(), await profiled()];
  await bindX(a, { id: X('444'), username: H('lee'), name: 'A', avatar: null }, NOW);
  await bindX(b, { id: X('555'), username: H('Lee'), name: 'B', avatar: null }, NOW);
  const [pa] = await sql()`SELECT x_handle FROM builder_profiles WHERE builder_id = ${await rootOf(a)}`;
  assert.equal(pa.x_handle, null);
  assert.deepEqual(await resolveHandle(H('lee')), { redirect: `/${H('Lee')}` });
  assert.deepEqual(await resolveHandle(H('Lee')), { builderId: await rootOf(b), handle: H('Lee') });
});

test('6.7 reserved handles live under /b/; case redirects; a rename redirects 90 days', dbTest, async () => {
  const id = await profiled();
  await bindX(id, { id: X('666'), username: 'Terms', name: 'T', avatar: null }, NOW);
  assert.deepEqual(await resolveHandle('terms'), { redirect: '/b/Terms' });
  assert.deepEqual(await resolveHandle('Terms'), { builderId: id, handle: 'Terms' });
  await bindX(id, { id: X('666'), username: H('NewName'), name: 'T', avatar: null }, NOW);
  assert.deepEqual(await resolveHandle('Terms', new Date(NOW.getTime() + 89 * 86_400_000)), { redirect: `/${H('NewName')}` });
  assert.equal(await resolveHandle('Terms', new Date(NOW.getTime() + 91 * 86_400_000)), null);
  // Hidden: no page, no redirect.
  await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${id}`;
  assert.equal(await resolveHandle(H('NewName')), null);
  assert.equal(await resolveHandle('Terms', new Date(NOW.getTime() + 89 * 86_400_000)), null);
  assert.equal(await resolveHandle('bad handle!'), null);
});

test('6.8 the same X account claimed from a second installation never merges at once: both agents say yes, then one person', dbTest, async () => {
  const [a, b] = [await profiled(), await profiled()];
  await bindX(a, { id: X('777'), username: H('one_page'), name: 'O', avatar: null }, NOW);
  const r = await bindX(b, { id: X('777'), username: H('one_page'), name: 'O', avatar: null }, NOW);
  assert.deepEqual(r, { ok: false, reason: 'join_pending' });
  assert.notEqual(await rootOf(a), await rootOf(b), 'never a direct merge');
  assert.deepEqual(await pendingJoinOf(a), { installation_id: b, tie: 'x_user_id', side: 'target' });
  assert.deepEqual(await pendingJoinOf(b), { installation_id: b, tie: 'x_user_id', side: 'joiner' });
  const [pb] = await sql()`SELECT x_user_id FROM builder_profiles WHERE builder_id = ${b}`;
  assert.equal(pb.x_user_id, null, 'the X account stays on the first page');
  assert.equal(await answerJoin(b, true), 'waiting');
  assert.equal(await answerJoin(a, true), 'linked');
  assert.equal(await rootOf(a), await rootOf(b));
  // Through the callback, the page says what happens next.
  const [c, d] = [await profiled(), await profiled()];
  await bindX(c, { id: X('778'), username: H('two_page'), name: 'T', avatar: null }, NOW);
  const page = await runClaim(await codeOf(d), fakeX({ id: X('778'), username: H('two_page'), name: 'T', avatar: null }));
  assert.equal(page.status, 200);
  assert.match(await page.text(), new RegExp(CLAIM_TEXT.joinPending));
});

test('6.9 the claim page says what becomes public and how to hide it before the button; X off is a plain page; flag off is a 404', dbTest, async () => {
  const id = await profiled();
  const code = await codeOf(id);
  const get = await claimGet(new Request(`https://earnkit.com/claim/${code}`), code);
  const body = await get.text();
  const at = (s: string) => body.indexOf(s);
  for (const line of [CLAIM_TEXT.lead, CLAIM_TEXT.public, CLAIM_TEXT.warning]) assert.ok(at(line) > 0 && at(line) < at(CLAIM_TEXT.button), line);
  assert.ok(at('You can hide your page anytime by telling your agent') > 0);
  assert.match(body, /<form method="post" action="https:\/\/earnkit\.com\/claim\/[a-z2-7]{12}">/);
  assert.doesNotMatch(body, /<script/);
  assert.equal(get.headers.get('referrer-policy'), 'same-origin');
  assert.equal(get.headers.get('cache-control'), 'no-store');
  assert.match(get.headers.get('set-cookie')!, new RegExp(`^__Host-ekx-${createHash('sha256').update(code).digest('hex').slice(0, 16)}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax$`));
  for (const t of Object.values(CLAIM_TEXT)) {
    const s = String(t);
    assert.doesNotMatch(s, /—|–|\p{Extended_Pictographic}|outcome|verified source|wallet address|repo\b|onchain/iu, s);
  }
  // A malformed code is a 404, an unknown one "already claimed".
  assert.equal((await claimGet(new Request('https://earnkit.com/claim/x'), 'x')).status, 404);
  assert.equal((await claimGet(new Request('https://earnkit.com/claim/aaaaaaaaaaaa'), 'aaaaaaaaaaaa')).status, 410);
  // X off: a plain "not open yet" page, never X; the POST and callback answer 503.
  delete process.env.X_CLIENT_SECRET;
  try {
    const off = await claimGet(new Request(`https://earnkit.com/claim/${code}`), code);
    assert.equal(off.status, 200);
    assert.match(await off.text(), new RegExp(CLAIM_TEXT.notOpen));
    assert.equal(off.headers.get('set-cookie'), null);
    assert.equal((await claimPost(new Request(`https://earnkit.com/claim/${code}`, { method: 'POST' }), code, noLimit)).status, 503);
    assert.equal((await xCallback(new Request('https://earnkit.com/x/callback?code=c&state=s'), { x: failX(), limit: noLimit.limit })).status, 503);
  } finally {
    process.env.X_CLIENT_SECRET = 'sec';
  }
  process.env.EARNKIT_BUILDER_SCORE = 'off';
  try {
    assert.equal((await claimGet(new Request(`https://earnkit.com/claim/${code}`), code)).status, 404);
    assert.equal((await claimPost(new Request(`https://earnkit.com/claim/${code}`, { method: 'POST' }), code, noLimit)).status, 404);
    assert.equal((await xCallback(new Request('https://earnkit.com/x/callback?code=c&state=s'), { x: failX(), limit: noLimit.limit })).status, 404);
  } finally {
    process.env.EARNKIT_BUILDER_SCORE = 'on';
  }
});

test('6.10 OAuth binding: a cross-site POST, a wrong csrf, a missing cookie or a replayed state never reaches X or binds', dbTest, async () => {
  const id = await profiled();
  const code = await codeOf(id);
  // Another site's form post.
  assert.equal((await startClaim(code, { origin: 'https://evil.example.com' })).post.status, 403);
  // No Origin at all (fix round 1 minor): refused too.
  const { cookie: c0, csrf: csrf0 } = await startClaim(code);
  const noOrigin = await claimPost(
    new Request(`https://earnkit.com/claim/${code}`, { method: 'POST', headers: { cookie: c0, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrf0 }) }),
    code,
    noLimit,
  );
  assert.equal(noOrigin.status, 403);
  // A form csrf that is not this browser's cookie.
  const { cookie } = await startClaim(code);
  const wrong = await claimPost(
    new Request(`https://earnkit.com/claim/${code}`, { method: 'POST', headers: { cookie, origin: 'https://earnkit.com', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: 'nope' }) }),
    code,
    noLimit,
  );
  assert.equal(wrong.status, 403);
  // The callback in a browser without the cookie (a phished X sign-in): 403 before any X call.
  const x = fakeX({ id: X('888'), username: H('phish'), name: 'P', avatar: null });
  const r = await runClaim(code, x, { cookie: null });
  assert.equal(r.status, 403);
  assert.equal(x.calls, 0);
  // Another claim's cookie is not this state's.
  const other = await profiled();
  const { cookie: otherCookie } = await startClaim(await codeOf(other));
  assert.equal((await runClaim(code, x, { cookie: otherCookie })).status, 403);
  assert.equal(x.calls, 0);
  // One state, one use: the replay is refused; the verifier is not kept after use.
  const { post, cookie: c2 } = await startClaim(code);
  const state = new URL(post.headers.get('location')!).searchParams.get('state')!;
  const call = () => xCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie: c2 } }), { x, limit: noLimit.limit });
  assert.equal((await call()).status, 200);
  const [left] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM x_oauth_states WHERE state_hash = ${createHash('sha256').update(state).digest('hex')}`;
  assert.equal(left.n, 0);
  assert.equal((await call()).status, 403);
  // An expired state is refused.
  const late = await profiled();
  const lateCode = await codeOf(late);
  const { post: p3, cookie: c3 } = await startClaim(lateCode);
  const s3 = new URL(p3.headers.get('location')!).searchParams.get('state')!;
  await sql()`UPDATE x_oauth_states SET expires_at = now() - interval '1 minute' WHERE state_hash = ${createHash('sha256').update(s3).digest('hex')}`;
  const r3 = await xCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${encodeURIComponent(s3)}`, { headers: { cookie: c3 } }), { x, limit: noLimit.limit });
  assert.equal(r3.status, 403);
  // X said no (no code): nothing is bound, the link still works.
  const { post: p4, cookie: c4 } = await startClaim(lateCode);
  const s4 = new URL(p4.headers.get('location')!).searchParams.get('state')!;
  const denied = await xCallback(new Request(`https://earnkit.com/x/callback?error=access_denied&state=${encodeURIComponent(s4)}`, { headers: { cookie: c4 } }), { x, limit: noLimit.limit });
  assert.equal(denied.status, 400);
  assert.equal(await claimLink(late), `earnkit.com/claim/${lateCode}`);
});

test('6.11 resolveSlug (the v2.12 card and share routes) means claimed: an unclaimed page is never public', dbTest, async () => {
  const id = await profiled();
  const [{ slug }] = await sql()<{ slug: string }[]>`SELECT slug FROM builder_profiles WHERE builder_id = ${id}`;
  await sql()`UPDATE builder_profiles SET consent_shown_at = now() WHERE builder_id = ${id}`;
  assert.equal(await resolveSlug(slug), null);
  await bindX(id, { id: X('999'), username: H('slugged'), name: 'S', avatar: null }, NOW);
  // The old random slug follows the person to the handle.
  assert.deepEqual(await resolveSlug(slug), { builderId: id, redirect: H('slugged').toLowerCase(), handle: H('slugged') });
  assert.deepEqual(await resolveSlug(H('slugged').toLowerCase()), { builderId: id, redirect: null, handle: H('slugged') });
});

test('6.12 the claim owns the X handle: setXHandle refuses a claimed page and GitHub never clears it', dbTest, async () => {
  const id = await profiled();
  await bindX(id, { id: X('1010'), username: H('mine'), name: 'M', avatar: null }, NOW);
  await sql()`UPDATE builder_profiles SET github_login = ${`gl${id}`}, twitter_prefill = ${H('someone')} WHERE builder_id = ${id}`;
  const r = await setXHandle(id, 'yes');
  assert.equal(r.ok, false);
  const [p] = await sql()`SELECT x_handle FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(p.x_handle, H('mine'));
  // GitHub's X field differing never clears a claimed handle (discovery's clearXHandle 'github').
  assert.equal(await clearXHandle(id, 'github'), false);
  assert.deepEqual(await resolveHandle(H('mine')), { builderId: id, handle: H('mine') });
});

test('6.18 (fix round 1) a 90-day /<name> redirect only for a real X handle rename; a v2.12 login or wallet slug never redirects at the root', dbTest, async () => {
  const id = await profiled();
  const login = `gl${RUN}${Date.now() % 100000}`.slice(0, 15);
  await sql()`UPDATE builder_profiles SET slug = ${login} WHERE builder_id = ${id}`;
  await bindX(id, { id: X('1212'), username: H('realname'), name: 'R', avatar: null }, NOW);
  assert.equal(await resolveHandle(login), null, 'a GitHub-login slug is not an X handle');
  assert.deepEqual(await resolveSlug(login), { builderId: id, redirect: H('realname').toLowerCase(), handle: H('realname') }, '/b/ keeps every old slug');
  await bindX(id, { id: X('1212'), username: H('renamed'), name: 'R', avatar: null }, NOW);
  assert.deepEqual(await resolveHandle(H('realname')), { redirect: `/${H('renamed')}` }, 'the X rename redirects');
});

test('6.19 (fix round 1) a stale holder (its handle moved to someone else) can claim again', dbTest, async () => {
  const [a, b] = [await profiled(), await profiled()];
  await bindX(a, { id: X('1313'), username: H('moved'), name: 'A', avatar: null }, NOW);
  await bindX(b, { id: X('1414'), username: H('moved'), name: 'B', avatar: null }, NOW);
  const link = await claimLink(a);
  assert.match(link ?? '', /^earnkit\.com\/claim\/[a-z2-7]{12}$/);
  const r = await runClaim(link!.split('/').pop()!, fakeX({ id: X('1313'), username: H('newhandle'), name: 'A', avatar: null }));
  assert.equal(r.status, 200);
  assert.deepEqual(await resolveHandle(H('newhandle')), { builderId: a, handle: H('newhandle') });
  assert.equal(await claimLink(a), null, 'claimed with a handle again: no link');
});

test('6.20 (fix round 1) a bind that throws is a plain 500 page and the cookie is cleared', dbTest, async () => {
  const id = await profiled();
  const r = await runClaim(await codeOf(id), fakeX({ id: X('1515'), username: 'bad handle!', name: 'B', avatar: null }));
  assert.equal(r.status, 500);
  assert.match(await r.text(), new RegExp(CLAIM_TEXT.failed));
  assert.match(r.headers.get('set-cookie') ?? '', /Max-Age=0/);
  const [p] = await sql()`SELECT x_user_id FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(p.x_user_id, null);
});

test('7.7 the done page offers the two optional upgrades as plain links; GitHub only while its sign-in is on', dbTest, async () => {
  const gh = { id: process.env.GITHUB_OAUTH_CLIENT_ID, secret: process.env.GITHUB_OAUTH_CLIENT_SECRET };
  try {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    const a = await profiled();
    const off = await (await runClaim(await codeOf(a), fakeX({ id: X('771'), username: H('up_a'), name: 'A', avatar: null }))).text();
    assert.match(off, /<a class="ek-link" href="https:\/\/earnkit\.com\/claim\/wallet\?t=[^"]+">Show a wallet is yours \(optional\)<\/a>/);
    assert.doesNotMatch(off, /Sign in with GitHub/);
    process.env.GITHUB_OAUTH_CLIENT_ID = 'gid';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'gsec';
    const b = await profiled();
    const on = await (await runClaim(await codeOf(b), fakeX({ id: X('772'), username: H('up_b'), name: 'B', avatar: null }))).text();
    assert.match(on, new RegExp(`<p class="ek-url">earnkit\\.com/${H('up_b')}</p>`));
    assert.match(on, /<a class="ek-link" href="https:\/\/earnkit\.com\/github\/verify\?n=[A-Za-z0-9_-]{43}">Sign in with GitHub \(optional\)<\/a>/);
    const [n] = await sql()<{ purpose: string; repo_key: string; installation_id: number }[]>`
      SELECT purpose, repo_key, installation_id FROM github_verify_nonces WHERE installation_id = ${b} AND purpose = 'claim'`;
    assert.deepEqual({ ...n }, { purpose: 'claim', repo_key: `claim/${b}`, installation_id: b });
    assert.doesNotMatch(on, /—/);
  } finally {
    for (const [k, v] of [['GITHUB_OAUTH_CLIENT_ID', gh.id], ['GITHUB_OAUTH_CLIENT_SECRET', gh.secret]] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});
