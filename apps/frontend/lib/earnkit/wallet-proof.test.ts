import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { sql } from './db';
import { bindX } from './x-install';
import { WALLET_TEXT, proveWallet, upgradeToken, upgradeOf, walletGet, walletMessage, walletPost } from './wallet-proof';

process.env.EARNKIT_AUTH_SECRET = 'test-secret';
process.env.EARNKIT_URL = 'https://earnkit.com';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

// A new key each run: person_wallets is keyed by wallet across people, and the shared DB keeps every
// run's rows, so a fixed key would read "already on another EarnKit page" from the second run on.
const KEY = generatePrivateKey();
const NOW = new Date('2026-10-14T10:00:00Z');
const viemVerify = (a: { address: string; message: string; signature: string }) =>
  verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` });

/** A fresh installation with a profile, claimed with a fresh X id as `handle` (bindX clears it from any other profile). */
async function claimed(handle: string): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t7w-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`t7w-${id}`})`;
  const r = await bindX(id, { id: `t7w${randomBytes(6).toString('hex')}`, username: handle, name: handle, avatar: null }, NOW);
  assert.equal(r.ok, true);
  return id;
}

test('7.1 an upgrade token names one person for 30 minutes', () => {
  const t = upgradeToken(42, NOW)!;
  assert.equal(upgradeOf(t, new Date(NOW.getTime() + 29 * 60_000)), 42);
  assert.equal(upgradeOf(t, new Date(NOW.getTime() + 31 * 60_000)), null);
  assert.equal(upgradeOf(t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), NOW), null);
  assert.equal(upgradeOf(t, NOW, 'another-secret'), null);
  assert.equal(upgradeToken(42, NOW, ''), null, 'no secret, no token');
  assert.equal(upgradeOf('junk', NOW), null);
});

test('7.3 a signed message proves a wallet once; a wrong signer, an expired token or a wallet on another page is refused', dbTest, async () => {
  const id = await claimed(`wo${randomBytes(4).toString('hex')}`);
  const [{ handle }] = await sql()<{ handle: string }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${id}`;
  const acct = privateKeyToAccount(KEY);
  const token = upgradeToken(id, NOW)!;
  const signature = await acct.signMessage({ message: walletMessage(handle, token) });
  assert.deepEqual(await proveWallet({ token, wallet: acct.address, signature }, NOW, viemVerify), { ok: true });
  const [w] = await sql()`SELECT builder_id FROM person_wallets WHERE wallet = ${acct.address.toLowerCase()}`;
  assert.equal(w.builder_id, id);
  const [q] = await sql()<{ done_at: Date | null }[]>`SELECT done_at FROM discovery_queue WHERE builder_id = ${id}`;
  assert.equal(q.done_at, null, 'a proven wallet queues discovery');
  // A retried POST of the same proof (a double tap) is still done; nothing new is written.
  assert.deepEqual(await proveWallet({ token, wallet: acct.address, signature }, NOW, viemVerify), { ok: true });
  const other = await claimed(`wx${randomBytes(4).toString('hex')}`);
  const [{ h2 }] = await sql()<{ h2: string }[]>`SELECT x_handle AS h2 FROM builder_profiles WHERE builder_id = ${other}`;
  const t2 = upgradeToken(other, NOW)!;
  const s2 = await acct.signMessage({ message: walletMessage(h2, t2) });
  assert.deepEqual(await proveWallet({ token: t2, wallet: acct.address, signature: s2 }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.taken });
  assert.deepEqual(await proveWallet({ token, wallet: '0x' + '1'.repeat(40), signature }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.failed });
  assert.deepEqual(await proveWallet({ token, wallet: acct.address, signature }, new Date(NOW.getTime() + 31 * 60_000), viemVerify), { ok: false, line: WALLET_TEXT.expired });
  // A signature over another person's page (the message names the page) proves nothing here.
  const second = privateKeyToAccount(generatePrivateKey());
  const wrongPage = await second.signMessage({ message: walletMessage(h2, token) });
  assert.deepEqual(await proveWallet({ token, wallet: second.address, signature: wrongPage }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.failed });
  // v3.1 wallet proof: a link is used once: the same link never proves a second wallet, even the same person's.
  const s3 = await second.signMessage({ message: walletMessage(handle, token) });
  assert.deepEqual(await proveWallet({ token, wallet: second.address, signature: s3 }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.used });
  const fresh = upgradeToken(id, new Date(NOW.getTime() + 1000))!;
  const s4 = await second.signMessage({ message: walletMessage(handle, fresh) });
  assert.deepEqual(await proveWallet({ token: fresh, wallet: second.address, signature: s4 }, NOW, viemVerify), { ok: true }, 'a fresh link proves it');
  // An unclaimed person has no page to sign for.
  const [{ id: plain }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t7w-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_handle) VALUES (${plain}, ${`t7w-${plain}`}, ${`p${plain}`})`;
  const tp = upgradeToken(plain, NOW)!;
  const third = privateKeyToAccount(generatePrivateKey());
  const sp = await third.signMessage({ message: walletMessage(`p${plain}`, tp) });
  assert.deepEqual(await proveWallet({ token: tp, wallet: third.address, signature: sp }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.expired });
});

// ---- Restored in v2.14 T3 fix round 1: the wallet page's security rules ----

const run = <T>(fn: () => Promise<T>): Promise<T> => fn();
const noLimit = { limit: async () => {} };

test('7.5b (final fix wave) every non-200 answer of /claim/wallet carries frame-ancestors: 410, JSON errors and 405', dbTest, async () => {
  const frame = (r: Response) => assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'none'", `${r.status}`);
  const route = await import('../../app/claim/wallet/route');
  await run(async () => {
    const gone = await walletGet(new Request('https://earnkit.com/claim/wallet?t=junk'));
    assert.equal(gone.status, 410);
    frame(gone);
    const post = (origin: string, body: string) =>
      walletPost(new Request('https://earnkit.com/claim/wallet', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body }), { ...noLimit, verify: viemVerify });
    const cross = await post('https://evil.example', '{}');
    assert.equal(cross.status, 403);
    frame(cross);
    const bad = await post('https://earnkit.com', 'garbage');
    assert.equal(bad.status, 400);
    frame(bad);
    for (const m of [route.PUT, route.PATCH, route.DELETE]) {
      const r = await m();
      assert.equal(r.status, 405);
      assert.equal(r.headers.get('allow'), 'GET, POST');
      frame(r);
    }
  });
});

test('7.5 the wallet page: one button and the message to sign; the POST checks Origin and answers a line', dbTest, async () => {
  const id = await claimed(`wp${randomBytes(4).toString('hex')}`);
  const t = upgradeToken(id, new Date())!;
  await run(async () => {
    const get = await walletGet(new Request(`https://earnkit.com/claim/wallet?t=${encodeURIComponent(t)}`));
    assert.equal(get.status, 200);
    const body = await get.text();
    assert.ok(body.includes(WALLET_TEXT.lead));
    // T11 fix round 3: the page's full policy (fonts only as data:, the one nonce script).
    assert.match(get.headers.get('content-security-policy') ?? '', /^default-src 'none'; script-src 'nonce-[A-Za-z0-9+/=]+'; connect-src 'self'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/);
    assert.match(body, /@font-face\{font-family:"Funnel Display"/);
    assert.match(body, /<h1>Prove your Base wallet<\/h1>/);
    assert.ok(body.includes(WALLET_TEXT.button));
    assert.ok(body.includes('personal_sign'));
    assert.ok(body.includes(JSON.stringify(WALLET_TEXT.noWallet).slice(1, -1)));
    assert.doesNotMatch(body, /—/, 'no em dash');
    const expired = await walletGet(new Request('https://earnkit.com/claim/wallet?t=junk'));
    assert.equal(expired.status, 410);
    assert.ok((await expired.text()).includes(WALLET_TEXT.expired));
    const post = (origin: string | null, payload: unknown) =>
      walletPost(new Request('https://earnkit.com/claim/wallet', {
        method: 'POST', headers: { 'content-type': 'application/json', ...(origin && { origin }) }, body: JSON.stringify(payload),
      }), { ...noLimit, verify: viemVerify });
    const cross = await post('https://evil.example', { t, wallet: '0x' + '2'.repeat(40), signature: '0x' + 'a'.repeat(130) });
    assert.equal(cross.status, 403);
    const acct = privateKeyToAccount(generatePrivateKey());
    const [{ handle }] = await sql()<{ handle: string }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${id}`;
    const signature = await acct.signMessage({ message: walletMessage(handle, t) });
    const ok = await post('https://earnkit.com', { t, wallet: acct.address, signature });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { line: WALLET_TEXT.done });
    // v3.1: the link is used: opening it again says so (410), never a second signing page.
    const again = await walletGet(new Request(`https://earnkit.com/claim/wallet?t=${encodeURIComponent(t)}`));
    assert.equal(again.status, 410);
    assert.ok((await again.text()).includes(WALLET_TEXT.used));
    const bad = await post('https://earnkit.com', 'garbage');
    assert.deepEqual(await bad.json(), { line: WALLET_TEXT.expired });
  });
});

// ---- v3.1 wallet proof (owner-approved 2026-10-23) ----

test('v3.1 the message names the builder and earnkit.com; the page says what happens, shows the message, and has a done state', dbTest, async () => {
  const handle = `wv${randomBytes(4).toString('hex')}`;
  const id = await claimed(handle);
  const t = upgradeToken(id, new Date())!;
  assert.equal(walletMessage(handle, t), `EarnKit: this wallet belongs to @${handle} on earnkit.com/${handle}.\nSigning is free and moves no funds.\nCode: ${t}`);
  assert.equal(WALLET_TEXT.lead, 'One signature, no fee. Your contracts on Base will show on your page, and your EarnKit rewards go to this wallet. We never move funds.');
  const get = await walletGet(new Request(`https://earnkit.com/claim/wallet?t=${encodeURIComponent(t)}`));
  assert.equal(get.status, 200);
  const body = await get.text();
  assert.match(body, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.ok(body.includes(`<p class="ek-msg">EarnKit: this wallet belongs to @${handle} on earnkit.com/${handle}.\nSigning is free and moves no funds.\nCode: ${t}</p>`));
  assert.match(body, /<div id="done" hidden><h1 id="done-h" tabindex="-1">Done<\/h1><p class="ek-line">Your wallet is proven\. Your contracts on Base will show on your page soon\. You can close this page\.<\/p><\/div>/);
  assert.match(body, /<button class="ek-btn ek-sec" type="button" id="copy" hidden>Copy link<\/button>/);
  assert.ok(body.includes('e.code===4001'), 'a cancelled request says nothing was signed');
  assert.ok(body.includes('[hidden]{display:none!important}'));
  assert.doesNotMatch(body, /—|0x[0-9a-f]{40}/i, 'no em dash, no wallet address');
  for (const line of Object.values(WALLET_TEXT)) assert.doesNotMatch(line, /—|\p{Extended_Pictographic}/u, line);
});

test('v3.1 a smart wallet proves through viem on Base: ERC-6492 (undeployed) goes to eth_call, a false answer refuses', dbTest, async () => {
  const { createPublicClient, custom, serializeErc6492Signature } = await import('viem');
  const { base } = await import('viem/chains');
  const { verifierOn } = await import('./wallet-proof');
  const handle = `ws${randomBytes(4).toString('hex')}`;
  const id = await claimed(handle);
  const smart = `0x${randomBytes(20).toString('hex')}`;
  const calls: string[] = [];
  const client = (valid: boolean) =>
    createPublicClient({
      chain: base,
      transport: custom({
        request: async ({ method }: { method: string }) => {
          calls.push(method);
          if (method === 'eth_chainId') return '0x2105';
          if (method === 'eth_call') return `0x${valid ? '1'.padStart(64, '0') : '0'.padStart(64, '0')}`;
          if (method === 'eth_getCode') return '0x';
          throw new Error(`unexpected ${method}`);
        },
      }),
    });
  // A counterfactual smart wallet's signature: its factory call and inner signature, wrapped (ERC-6492). The wallet
  // itself decides (the chain answers through eth_call), so the bytes here stand in for any wallet's own scheme.
  const sign6492 = () => serializeErc6492Signature({ address: `0x${'ab'.repeat(20)}`, data: `0x${'cd'.repeat(68)}`, signature: `0x${'ef'.repeat(65)}` });
  const t = upgradeToken(id, NOW)!;
  assert.deepEqual(await proveWallet({ token: t, wallet: smart, signature: sign6492() }, NOW, verifierOn(client(false))), { ok: false, line: WALLET_TEXT.failed });
  assert.ok(calls.includes('eth_call'), `asked the chain: ${calls.join(',')}`);
  assert.deepEqual(await proveWallet({ token: t, wallet: smart, signature: sign6492() }, NOW, verifierOn(client(true))), { ok: true }, 'a failed check never spends the link');
  const [w] = await sql()<{ builder_id: number }[]>`SELECT builder_id FROM person_wallets WHERE wallet = ${smart}`;
  assert.equal(w.builder_id, id);
  // A deployed smart wallet (ERC-1271): a plain signature its own key didn't make is still asked of the chain.
  const deployed = `0x${randomBytes(20).toString('hex')}`;
  const t2 = upgradeToken(id, new Date(NOW.getTime() + 1000))!;
  calls.length = 0;
  const plain = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: walletMessage(handle, t2) });
  assert.deepEqual(await proveWallet({ token: t2, wallet: deployed, signature: plain }, NOW, verifierOn(client(true))), { ok: true });
  assert.ok(calls.includes('eth_call'), `asked the chain: ${calls.join(',')}`);
});

test('v3.1 the newest proven wallet is the reward recipient (a change of wallet)', dbTest, async () => {
  const { provenWallet, provenSince } = await import('./wallet-proof');
  const id = await claimed(`wr${randomBytes(4).toString('hex')}`);
  const [{ handle }] = await sql()<{ handle: string }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(await provenWallet(id), null);
  const first = privateKeyToAccount(generatePrivateKey());
  const second = privateKeyToAccount(generatePrivateKey());
  const t1 = upgradeToken(id, NOW)!;
  assert.deepEqual(await proveWallet({ token: t1, wallet: first.address, signature: await first.signMessage({ message: walletMessage(handle, t1) }) }, NOW, viemVerify), { ok: true });
  assert.equal(await provenWallet(id), first.address.toLowerCase());
  const later = new Date(NOW.getTime() + 60_000);
  const t2 = upgradeToken(id, later)!;
  assert.equal(await provenSince(id, later), false);
  assert.deepEqual(await proveWallet({ token: t2, wallet: second.address, signature: await second.signMessage({ message: walletMessage(handle, t2) }) }, later, viemVerify), { ok: true });
  assert.equal(await provenWallet(id), second.address.toLowerCase(), 'the newest proof wins');
  assert.equal(await provenSince(id, later), true);
});
