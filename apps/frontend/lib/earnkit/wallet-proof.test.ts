import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { sql } from './db';
import { bindX, xSignInCallback } from './x-install';
import { RateLimitError } from './rate-limit';
import {
  WALLET_TEXT, proveWallet, provenWallet, provenSince, tokenUseKey, upgradeOf, upgradeToken, verifierOn, walletContractsLine, walletDoneLine,
  walletMessage, walletPageState, walletPost, walletTokenCookie, walletXCookie, walletXLead, walletXStart,
} from './wallet-proof';
import { walletXSignIn } from './fixtures/wallet-step';
import WalletView from '../../app/claim/wallet/WalletView';

process.env.EARNKIT_AUTH_SECRET = 'test-secret';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
(globalThis as { React?: typeof React }).React = React;

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const NOW = new Date('2026-10-14T10:00:00Z');
const viemVerify = (a: { address: string; message: string; signature: string }) =>
  verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` });
const noLimit = async () => {};
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

/** A fresh installation with a profile, claimed with a fresh X id as `handle`; its X user id. */
async function claimed(handle: string): Promise<{ id: number; handle: string; x: string }> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t7w-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`t7w-${id}`})`;
  const x = `t7w${randomBytes(6).toString('hex')}`;
  const r = await bindX(id, { id: x, username: handle, name: handle, avatar: null }, NOW);
  assert.equal(r.ok, true);
  const [{ h }] = await sql()<{ h: string }[]>`SELECT x_handle AS h FROM builder_profiles WHERE builder_id = ${id}`;
  return { id, handle: h, x };
}
const signWith = async (acct: ReturnType<typeof privateKeyToAccount>, handle: string, t: string) => acct.signMessage({ message: walletMessage(handle, t) });

test('7.1 an upgrade token names one person for 30 minutes; two made the same millisecond differ', () => {
  const t = upgradeToken(42, NOW)!;
  assert.equal(upgradeOf(t, new Date(NOW.getTime() + 29 * 60_000)), 42);
  assert.equal(upgradeOf(t, new Date(NOW.getTime() + 31 * 60_000)), null);
  assert.equal(upgradeOf(t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), NOW), null);
  assert.equal(upgradeOf(t, NOW, 'another-secret'), null);
  assert.equal(upgradeToken(42, NOW, ''), null, 'no secret, no token');
  assert.equal(upgradeOf('junk', NOW), null);
  assert.notEqual(upgradeToken(42, NOW), upgradeToken(42, NOW));
});

test('7.3 a signed message proves a wallet once; a wrong signer, an expired token, a used link or a wallet on another page is refused', dbTest, async () => {
  const me = await claimed(`wo${randomBytes(4).toString('hex')}`);
  const acct = privateKeyToAccount(generatePrivateKey());
  const token = upgradeToken(me.id, NOW)!;
  const signature = await signWith(acct, me.handle, token);
  const first = await proveWallet({ token, wallet: acct.address, signature }, NOW, viemVerify);
  assert.deepEqual(first, { ok: true, recipient: true, line: walletDoneLine(acct.address.toLowerCase()) });
  const [w] = await sql()`SELECT builder_id FROM person_wallets WHERE wallet = ${acct.address.toLowerCase()}`;
  assert.equal(w.builder_id, me.id);
  const [q] = await sql()<{ done_at: Date | null }[]>`SELECT done_at FROM discovery_queue WHERE builder_id = ${me.id}`;
  assert.equal(q.done_at, null, 'a proven wallet queues discovery');
  // A retried POST of the same proof (a double tap) is still done; nothing new is written.
  assert.equal((await proveWallet({ token, wallet: acct.address, signature }, NOW, viemVerify)).ok, true);
  const other = await claimed(`wx${randomBytes(4).toString('hex')}`);
  const t2 = upgradeToken(other.id, NOW)!;
  assert.deepEqual(await proveWallet({ token: t2, wallet: acct.address, signature: await signWith(acct, other.handle, t2) }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.taken });
  assert.deepEqual(await proveWallet({ token, wallet: '0x' + '1'.repeat(40), signature }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.failed });
  assert.deepEqual(await proveWallet({ token, wallet: acct.address, signature }, new Date(NOW.getTime() + 31 * 60_000), viemVerify), { ok: false, line: WALLET_TEXT.expired });
  // A signature over another person's page (the message names the page) proves nothing here.
  const second = privateKeyToAccount(generatePrivateKey());
  assert.deepEqual(await proveWallet({ token, wallet: second.address, signature: await signWith(second, other.handle, token) }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.failed });
  // A link is used once: it never proves a second wallet, even the same person's.
  assert.deepEqual(await proveWallet({ token, wallet: second.address, signature: await signWith(second, me.handle, token) }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.used });
  // An unclaimed person has no page to sign for.
  const [{ id: plain }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t7w-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_handle) VALUES (${plain}, ${`t7w-${plain}`}, ${`p${plain}`})`;
  const tp = upgradeToken(plain, NOW)!;
  const third = privateKeyToAccount(generatePrivateKey());
  assert.deepEqual(await proveWallet({ token: tp, wallet: third.address, signature: await signWith(third, `p${plain}`, tp) }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.expired });
});

test('fix round 1: a second wallet without the X sign-in counts for contracts only; with it, it becomes the recipient and a notice is queued', dbTest, async () => {
  const me = await claimed(`wr${randomBytes(4).toString('hex')}`);
  const first = privateKeyToAccount(generatePrivateKey());
  const second = privateKeyToAccount(generatePrivateKey());
  const t1 = upgradeToken(me.id, NOW)!;
  assert.equal((await proveWallet({ token: t1, wallet: first.address, signature: await signWith(first, me.handle, t1) }, NOW, viemVerify)).ok, true);
  const W1 = first.address.toLowerCase();
  assert.equal(await provenWallet(me.id), W1, 'the first proof is the recipient on the link alone');
  // A leaked link: the token alone never moves the rewards.
  const later = new Date(NOW.getTime() + 60_000);
  const t2 = upgradeToken(me.id, later)!;
  const leaked = await proveWallet({ token: t2, wallet: second.address, signature: await signWith(second, me.handle, t2) }, later, viemVerify);
  assert.deepEqual(leaked, { ok: true, recipient: false, line: walletContractsLine(W1) });
  assert.equal(await provenWallet(me.id), W1);
  assert.deepEqual(await provenSince(me.id, later), { wallet: second.address.toLowerCase(), recipient: false });
  // With the page's X sign-in for that link in this browser (its cookie secret), re-proving makes it the recipient.
  const later2 = new Date();
  const t3 = upgradeToken(me.id, later2)!;
  const ck = await walletXSignIn(t3, me.x);
  assert.ok(ck);
  const moved = await proveWallet({ token: t3, wallet: second.address, signature: await signWith(second, me.handle, t3), xSecret: ck.split('=')[1] }, later2, viemVerify);
  assert.deepEqual(moved, { ok: true, recipient: true, line: walletDoneLine(second.address.toLowerCase()) });
  assert.equal(await provenWallet(me.id), second.address.toLowerCase());
  const [s] = await sql()<{ n: string | null }[]>`SELECT standing_seen->>'wallet_notice' AS n FROM builder_profiles WHERE builder_id = ${me.id}`;
  assert.equal(s.n, short(second.address.toLowerCase()));
  // Fix round 2: the first wallet keeps its proof time (the Base Builder Code's wallet is the first one, attribution.ts).
  const [f] = await sql()<{ w: string }[]>`SELECT wallet AS w FROM person_wallets WHERE builder_id = ${me.id} ORDER BY proven_at, wallet LIMIT 1`;
  assert.equal(f.w, W1);
  // Another person's X check never counts for this person (even with that row's own secret).
  const other = await claimed(`wq${randomBytes(4).toString('hex')}`);
  const third = privateKeyToAccount(generatePrivateKey());
  const t4 = upgradeToken(me.id, later2)!;
  await sql()`INSERT INTO wallet_x_checks (use_hash, builder_id, checked_at, browser_hash) VALUES (${tokenUseKey(t4)}, ${other.id}, now(), 'x')`;
  assert.equal((await proveWallet({ token: t4, wallet: third.address, signature: await signWith(third, me.handle, t4), xSecret: 'x' }, later2, viemVerify) as { recipient: boolean }).recipient, false);
});

test('security follow-up: the X check is the signed-in browser\'s: the same link from another browser adds contracts only; the right cookie works once', dbTest, async () => {
  const me = await claimed(`wb${randomBytes(4).toString('hex')}`);
  const W = `0x${randomBytes(20).toString('hex')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${W}, ${me.id}, now())`;
  const now = new Date();
  const post = async (t: string, acct: ReturnType<typeof privateKeyToAccount>, cookie: string | null) => {
    const r = await walletPost(
      new Request('https://earnkit.com/claim/wallet/proof', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://earnkit.com', ...(cookie && { cookie }) },
        body: JSON.stringify({ t, wallet: acct.address, signature: await signWith(acct, me.handle, t) }),
      }),
      { limit: noLimit, verify: viemVerify },
    );
    return { status: r.status, body: (await r.json()) as { line: string; recipient?: boolean }, setCookie: r.headers.getSetCookie() };
  };
  // The owner signs in with X on link A; the cookie is HttpOnly, Secure, Lax, __Host-, and only its hash is kept.
  const tA = upgradeToken(me.id, now)!;
  const ckA = await walletXSignIn(tA, me.x);
  assert.ok(ckA && ckA.startsWith(walletXCookie(tokenUseKey(tA)) + '='));
  const [row] = await sql()<{ h: string }[]>`SELECT browser_hash AS h FROM wallet_x_checks WHERE use_hash = ${tokenUseKey(tA)}`;
  assert.ok(row.h && !row.h.includes(ckA.split('=')[1]), 'the hash, never the secret');
  // The page knows the browser: with the cookie, no X step; another browser (no cookie) still sees it.
  assert.ok((await walletPageState(tA, now, { limit: noLimit, xCookie: (n) => (n === ckA.split('=')[0] ? ckA.split('=')[1] : null) })).kind === 'sign');
  const withCk = await walletPageState(tA, now, { limit: noLimit, xCookie: (n) => (n === ckA.split('=')[0] ? ckA.split('=')[1] : null) });
  const without = await walletPageState(tA, now, { limit: noLimit });
  assert.ok(withCk.kind === 'sign' && !withCk.needX && without.kind === 'sign' && without.needX);
  // Someone else holding link A, no cookie: contracts only, never the recipient (the owner's check spent nothing).
  const thief = privateKeyToAccount(generatePrivateKey());
  const stolen = await post(tA, thief, null);
  assert.equal(stolen.status, 200);
  assert.equal(stolen.body.recipient, false);
  assert.equal(await provenWallet(me.id), W);
  // A wrong cookie on link B: contracts only.
  const tB = upgradeToken(me.id, now)!;
  const ckB = await walletXSignIn(tB, me.x);
  assert.ok(ckB);
  const wrong = await post(tB, privateKeyToAccount(generatePrivateKey()), `${ckB.split('=')[0]}=not-the-secret`);
  assert.equal(wrong.body.recipient, false);
  assert.equal(await provenWallet(me.id), W);
  // The right cookie on link C: the recipient, the check used up and its cookie cleared.
  const tC = upgradeToken(me.id, now)!;
  const ckC = await walletXSignIn(tC, me.x);
  assert.ok(ckC);
  const mine = privateKeyToAccount(generatePrivateKey());
  const good = await post(tC, mine, ckC);
  assert.deepEqual(good.body, { line: walletDoneLine(mine.address.toLowerCase()), recipient: true });
  assert.ok(good.setCookie.some((c) => c.startsWith(`${ckC.split('=')[0]}=;`) && /Max-Age=0/.test(c)));
  assert.equal(await provenWallet(me.id), mine.address.toLowerCase());
  assert.equal((await sql()`SELECT 1 FROM wallet_x_checks WHERE use_hash = ${tokenUseKey(tC)}`).length, 0, 'used once');
  // Once: the same cookie on the same link proves nothing new (the link is used too).
  const again = await post(tC, privateKeyToAccount(generatePrivateKey()), ckC);
  assert.deepEqual(again.body, { line: WALLET_TEXT.used });
});

test('fix round 1: the page\'s X sign-in passes only for the X account on the page, and sends the browser back to its link', dbTest, async () => {
  const me = await claimed(`wy${randomBytes(4).toString('hex')}`);
  const W = `0x${randomBytes(20).toString('hex')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${W}, ${me.id}, now())`;
  const t = upgradeToken(me.id, new Date())!;
  const s = await walletPageState(t, new Date(), { limit: noLimit });
  assert.ok(s.kind === 'sign' && s.needX && s.current === W);
  assert.equal(s.kind === 'sign' && s.xHref, `/claim/wallet/x?t=${encodeURIComponent(t)}`);
  const start = async () => {
    const r = await walletXStart(new Request(`https://earnkit.com/claim/wallet/x?t=${encodeURIComponent(t)}`, { headers: { 'x-real-ip': `10.9.${randomBytes(1)[0]}.1` } }));
    assert.equal(r.status, 302);
    const to = new URL(r.headers.get('location')!);
    assert.equal(to.host, 'x.com');
    const cookies = r.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.ok(cookies[1].startsWith(`${walletTokenCookie(tokenUseKey(t))}=${t};`) && /HttpOnly; Secure; SameSite=Lax/.test(cookies[1]));
    const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    return { state: to.searchParams.get('state')!, cookie };
  };
  const callback = (a: { state: string; cookie: string }, xId: string) =>
    xSignInCallback(new Request(`https://earnkit.com/x/callback?state=${a.state}&code=c`, { headers: { cookie: a.cookie } }), {
      limit: noLimit, x: { exchange: async () => 'tok', me: async () => ({ id: xId, username: 'someone', name: 'S', avatar: null }) },
    });
  // Another X account: refused, nothing kept.
  const wrong = await callback(await start(), 'not-them');
  assert.equal(wrong!.status, 403);
  assert.ok((await wrong!.text()).includes('That X account is not the one on this EarnKit page.'));
  assert.equal((await sql()`SELECT 1 FROM wallet_x_checks WHERE use_hash = ${tokenUseKey(t)}`).length, 0);
  // The same X account: kept, back to the page, which now asks for no X.
  const ok = await callback(await start(), me.x);
  assert.equal(ok!.status, 303);
  assert.equal(ok!.headers.get('location'), `/claim/wallet?t=${encodeURIComponent(t)}`);
  // Security follow-up: only this browser (its __Host-ekwx- cookie) skips the X step now.
  const set = ok!.headers.getSetCookie().find((c) => c.startsWith(`${walletXCookie(tokenUseKey(t))}=`) && !/Max-Age=0/.test(c))!;
  assert.match(set, /^__Host-ekwx-[0-9a-f]{16}=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=1800; HttpOnly; Secure; SameSite=Lax$/);
  const secret = set.split(';')[0].split('=')[1];
  const after = await walletPageState(t, new Date(), { limit: noLimit, xCookie: (n) => (n === walletXCookie(tokenUseKey(t)) ? secret : null) });
  assert.ok(after.kind === 'sign' && !after.needX && after.xHref === null);
  const elsewhere = await walletPageState(t, new Date(), { limit: noLimit });
  assert.ok(elsewhere.kind === 'sign' && elsewhere.needX, 'another browser still sees the X step');
  // No reward wallet yet: no X step at all (the first proof needs only the link).
  const fresh = await claimed(`wz${randomBytes(4).toString('hex')}`);
  const tf = upgradeToken(fresh.id, new Date())!;
  const sf = await walletPageState(tf, new Date(), { limit: noLimit });
  assert.ok(sf.kind === 'sign' && !sf.needX && sf.current === null);
  const r = await walletXStart(new Request(`https://earnkit.com/claim/wallet/x?t=${encodeURIComponent(tf)}`));
  assert.equal(r.status, 303, 'nothing to sign in for: back to the page');
});

test('fix round 10: a smart wallet goes to the chain; a failed RPC says try again, never a mismatch, and spends nothing', dbTest, async (t0) => {
  // The failed RPC is logged ("[wallet] verify"); kept out of the test output.
  t0.mock.method(console, 'error', () => {});
  const { createPublicClient, custom, serializeErc6492Signature } = await import('viem');
  const { base } = await import('viem/chains');
  const me = await claimed(`ws${randomBytes(4).toString('hex')}`);
  const smart = `0x${randomBytes(20).toString('hex')}`;
  const calls: string[] = [];
  const client = (answer: 'yes' | 'no' | 'down') =>
    createPublicClient({
      chain: base,
      transport: custom({
        request: async ({ method }: { method: string }) => {
          calls.push(method);
          if (answer === 'down') throw new Error('rpc down');
          if (method === 'eth_chainId') return '0x2105';
          if (method === 'eth_call') return `0x${(answer === 'yes' ? '1' : '0').padStart(64, '0')}`;
          if (method === 'eth_getCode') return '0x';
          if (method === 'eth_blockNumber') return '0x10';
          throw new Error(`unexpected ${method}`);
        },
      }),
    });
  // A counterfactual smart wallet's signature (ERC-6492): the wallet itself decides, through eth_call.
  const sig6492 = serializeErc6492Signature({ address: `0x${'ab'.repeat(20)}`, data: `0x${'cd'.repeat(68)}`, signature: `0x${'ef'.repeat(65)}` });
  const t = upgradeToken(me.id, NOW)!;
  assert.deepEqual(await proveWallet({ token: t, wallet: smart, signature: sig6492 }, NOW, verifierOn(client('down'))), { ok: false, line: WALLET_TEXT.unchecked });
  assert.deepEqual(await proveWallet({ token: t, wallet: smart, signature: sig6492 }, NOW, verifierOn(client('no'))), { ok: false, line: WALLET_TEXT.failed });
  assert.ok(calls.includes('eth_call'), `asked the chain: ${calls.join(',')}`);
  assert.equal((await proveWallet({ token: t, wallet: smart, signature: sig6492 }, NOW, verifierOn(client('yes')))).ok, true, 'a failed check never spends the link');
  // A deployed smart wallet (ERC-1271): a plain signature its own key didn't make is still asked of the chain.
  const deployed = `0x${randomBytes(20).toString('hex')}`;
  const t2 = upgradeToken(me.id, NOW)!;
  calls.length = 0;
  const plain = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: walletMessage(me.handle, t2) });
  assert.equal((await proveWallet({ token: t2, wallet: deployed, signature: plain }, NOW, verifierOn(client('yes')))).ok, true);
  assert.ok(calls.includes('eth_call'));
  // An EOA is checked locally: an RPC that is down never stops it.
  const eoa = privateKeyToAccount(generatePrivateKey());
  const t3 = upgradeToken(me.id, NOW)!;
  assert.equal((await proveWallet({ token: t3, wallet: eoa.address, signature: await signWith(eoa, me.handle, t3) }, NOW, verifierOn(client('down')))).ok, true);
  const r = await walletPost(
    new Request('https://earnkit.com/claim/wallet/proof', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://earnkit.com' }, body: JSON.stringify({ t: upgradeToken(me.id, NOW), wallet: smart, signature: sig6492 }) }),
    { limit: noLimit, verify: verifierOn(client('down')), now: NOW },
  );
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { line: WALLET_TEXT.unchecked });
});

test('fix round 9: the POST has its own limit (walletProof) and checks Origin; the page view its own light one', dbTest, async () => {
  const ip = `10.77.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const post = (origin: string) =>
    walletPost(new Request('https://earnkit.com/claim/wallet/proof', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-real-ip': ip }, body: 'garbage' }));
  assert.equal((await post('https://evil.example')).status, 403);
  const { LIMITS } = await import('./rate-limit');
  assert.deepEqual(LIMITS.walletProof, { limit: 20, windowSeconds: 3_600 });
  assert.deepEqual(LIMITS.walletPage, { limit: 120, windowSeconds: 3_600 });
  for (let i = 0; i < LIMITS.walletProof.limit; i++) assert.equal((await post('https://earnkit.com')).status, 400);
  const busy = await post('https://earnkit.com');
  assert.equal(busy.status, 429);
  assert.deepEqual(await busy.json(), { line: WALLET_TEXT.busy });
  const page = await walletPageState('junk', new Date(), { limit: async () => { throw new RateLimitError(WALLET_TEXT.busy, 60); } });
  assert.deepEqual(page, { kind: 'gone', line: WALLET_TEXT.busy });
});

test('fix round 4, 5: the page in the site design: Kaftan title, what happens, the Basescan line, the message, the buttons; X first once a reward wallet exists', dbTest, async () => {
  const me = await claimed(`wv${randomBytes(4).toString('hex')}`);
  const t = upgradeToken(me.id, new Date())!;
  assert.equal(walletMessage(me.handle, t), `EarnKit: this wallet belongs to @${me.handle} on earnkit.com/${me.handle}.\nSigning is free and moves no funds.\nCode: ${t}`);
  const render = async (tok: string) => renderToStaticMarkup(React.createElement(WalletView, { state: await walletPageState(tok, new Date(), { limit: noLimit }) })).replace(/&#x27;|&#39;/g, "'");
  const h = await render(t);
  assert.match(h, /data-ek-wallet=""[^>]*class="[^"]*rounded-\[32px\][^"]*linear-gradient/);
  assert.match(h, /<h1 id="wallet-title" class="ek-serif[^"]*">Prove your Base wallet<\/h1>/);
  assert.ok(h.includes(WALLET_TEXT.lead));
  assert.ok(h.includes('Your page links your contracts on Basescan, so this wallet will be public.'));
  assert.ok(h.includes(`EarnKit: this wallet belongs to @${me.handle} on earnkit.com/${me.handle}.`));
  assert.ok(h.includes('>Sign with my wallet</button>'));
  assert.doesNotMatch(h, /Sign in with X|data-ek-wallet-x/);
  assert.doesNotMatch(h, /—|0x[0-9a-f]{40}/i, 'no em dash, no wallet address');
  // A reward wallet exists: the short wallet, Sign in with X first, signing is for contracts only.
  const W = `0x${randomBytes(20).toString('hex')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${W}, ${me.id}, now())`;
  const x = await render(t);
  assert.ok(x.includes(walletXLead(me.handle, W)));
  assert.ok(x.includes(`Your rewards go to ${short(W)}. To send them to a new wallet, sign in with X as @${me.handle} first.`));
  assert.match(x, /<a href="\/claim\/wallet\/x\?t=[^"]+"[^>]*>Sign in with X<\/a>/);
  assert.ok(x.includes('>Sign for contracts only</button>'));
  assert.doesNotMatch(x, new RegExp(W));
  // Expired and used links: one line.
  assert.ok((await render('junk')).includes(WALLET_TEXT.expired));
  await sql()`INSERT INTO wallet_proof_uses (use_hash, used_at) VALUES (${tokenUseKey(t)}, now())`;
  assert.ok((await render(t)).includes(WALLET_TEXT.used));
  for (const line of Object.values(WALLET_TEXT)) assert.doesNotMatch(line, /—|\p{Extended_Pictographic}/u, line);
});
