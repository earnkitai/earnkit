import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { sql } from './db';
import { bindX } from './claim';
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
const noLimit = { limit: async () => {} };

/** A fresh installation with a profile, claimed with a fresh X id as `handle` (bindX clears it from any other profile). */
async function claimed(handle: string): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t7w-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`t7w-${id}`})`;
  const r = await bindX(id, { id: `t7w${randomBytes(6).toString('hex')}`, username: handle, name: handle, avatar: null }, NOW);
  assert.equal(r.ok, true);
  return id;
}
async function withScore<T>(fn: () => Promise<T>): Promise<T> {
  const old = process.env.EARNKIT_BUILDER_SCORE;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
    return await fn();
  } finally {
    if (old === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = old;
  }
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
  // One time: the same signature again is refused.
  assert.deepEqual(await proveWallet({ token, wallet: acct.address, signature }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.used });
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
  // The same link proves a second wallet of the same person.
  const s3 = await second.signMessage({ message: walletMessage(handle, token) });
  assert.deepEqual(await proveWallet({ token, wallet: second.address, signature: s3 }, NOW, viemVerify), { ok: true });
  // An unclaimed person has no page to sign for.
  const [{ id: plain }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t7w-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_handle) VALUES (${plain}, ${`t7w-${plain}`}, ${`p${plain}`})`;
  const tp = upgradeToken(plain, NOW)!;
  const third = privateKeyToAccount(generatePrivateKey());
  const sp = await third.signMessage({ message: walletMessage(`p${plain}`, tp) });
  assert.deepEqual(await proveWallet({ token: tp, wallet: third.address, signature: sp }, NOW, viemVerify), { ok: false, line: WALLET_TEXT.expired });
});

test('7.5 the wallet page: 404 with the flag off; one button and the message to sign; the POST checks Origin and answers a line', dbTest, async () => {
  const id = await claimed(`wp${randomBytes(4).toString('hex')}`);
  const t = upgradeToken(id, new Date())!;
  assert.equal((await walletGet(new Request(`https://earnkit.com/claim/wallet?t=${encodeURIComponent(t)}`))).status, 404);
  await withScore(async () => {
    const get = await walletGet(new Request(`https://earnkit.com/claim/wallet?t=${encodeURIComponent(t)}`));
    assert.equal(get.status, 200);
    const body = await get.text();
    assert.ok(body.includes(WALLET_TEXT.lead));
    // T11 fix round 3: the page's full policy (fonts only as data:, the one nonce script).
    assert.match(get.headers.get('content-security-policy') ?? '', /^default-src 'none'; script-src 'nonce-[A-Za-z0-9+/=]+'; connect-src 'self'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/);
    assert.match(body, /@font-face\{font-family:"Funnel Display"/);
    assert.match(body, /<h1>Show a wallet is yours<\/h1>/);
    assert.ok(body.includes(WALLET_TEXT.button));
    assert.ok(body.includes('personal_sign'));
    assert.ok(body.includes('Open this page in a browser with your wallet.'));
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
    const bad = await post('https://earnkit.com', 'garbage');
    assert.deepEqual(await bad.json(), { line: WALLET_TEXT.expired });
  });
});
