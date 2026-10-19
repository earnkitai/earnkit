import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { sql } from './db';
import { enqueueDiscovery } from './discovery';
import { siteUrl } from './entry-text';
import { noteEvent } from './events';
import { profileChanged } from './profile-cache';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { pageUrl } from './reserved-routes';
import { rpcFor } from './verify';
import { brandShell } from './brand-page';

/**
 * v2.12.1 spec "Identity": "The claim page offers two optional one-tap upgrades: sign a message with
 * the wallet, and sign in with GitHub." A signed wallet proves the contracts it created (v2.12's
 * deploy_wallet proof, which the post-push audit left waiting for exactly this). The token ties
 * the signature to one person for 30 minutes; the message names their page. viem's verifyMessage
 * on Base also checks smart wallets (ERC-1271 and ERC-6492). The signature itself is chain-agnostic
 * (EIP-191 personal_sign). Each (token, wallet) signature is used once (wallet_proof_uses). A wallet
 * the agent only typed never proves anything; only this signature writes person_wallets.
 */
export const UPGRADE_TTL_MS = 30 * 60_000;
export const WALLET_TEXT = {
  title: 'Show a wallet is yours',
  lead: 'Sign one message with your wallet so EarnKit can count the apps it made. It costs nothing.',
  button: 'Sign with my wallet',
  done: 'Done. Your agent will show the new numbers next time you ask.',
  failed: "That signature didn't match. Try again from the link on your page.",
  taken: 'That wallet is already on another EarnKit page.',
  expired: 'This link has expired. Open your page link from your agent again.',
  used: 'That wallet is already on your page.',
  noWallet: 'Open this page in a browser with your wallet.',
  busy: 'Too many tries from here. Try again in an hour.',
} as const;

const mac = (secret: string, s: string) => createHmac('sha256', secret).update(`upgrade:v1:${s}`).digest('base64url').slice(0, 22);
export function upgradeToken(builderId: number, now: Date, secret = process.env.EARNKIT_AUTH_SECRET): string | null {
  if (!secret) return null;
  const body = `${builderId}.${now.getTime() + UPGRADE_TTL_MS}`;
  return `${body}.${mac(secret, body)}`;
}
export function upgradeOf(token: string, now: Date, secret = process.env.EARNKIT_AUTH_SECRET): number | null {
  const m = /^(\d{1,10})\.(\d{13})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!secret || !m) return null;
  const want = Buffer.from(mac(secret, `${m[1]}.${m[2]}`));
  const got = Buffer.from(m[3]);
  if (want.length !== got.length || !timingSafeEqual(want, got) || Number(m[2]) < now.getTime()) return null;
  return Number(m[1]);
}
export const walletMessage = (handle: string, token: string) => `EarnKit: this wallet is mine and belongs on ${pageUrl(handle)}.\nCode: ${token}`;

type Verify = (a: { address: string; message: string; signature: string }) => Promise<boolean>;
const baseVerify: Verify = (a) =>
  createPublicClient({ chain: base, transport: http(rpcFor('base') ?? undefined, { timeout: 10_000, retryCount: 0 }) })
    .verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` });

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function proveWallet(
  a: { token: string; wallet: string; signature: string },
  now: Date,
  verify: Verify = baseVerify,
): Promise<{ ok: true } | { ok: false; line: string }> {
  const id = upgradeOf(a.token, now);
  if (id === null) return { ok: false, line: WALLET_TEXT.expired };
  const wallet = a.wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || !/^0x[0-9a-fA-F]{130,20000}$/.test(a.signature)) return { ok: false, line: WALLET_TEXT.failed };
  // Only the handle the X claim wrote (x_user_id-bound): an unclaimed person has no page to sign for.
  const [p] = await sql()<{ x_handle: string | null }[]>`SELECT x_handle FROM builder_profiles WHERE builder_id = ${id} AND x_user_id IS NOT NULL`;
  if (!p?.x_handle) return { ok: false, line: WALLET_TEXT.expired };
  const good = await verify({ address: wallet, message: walletMessage(p.x_handle, a.token), signature: a.signature }).catch(() => false);
  if (!good) return { ok: false, line: WALLET_TEXT.failed };
  const out = await sql().begin(async (tx) => {
    await tx`DELETE FROM wallet_proof_uses WHERE used_at < ${new Date(now.getTime() - 86_400_000)}`;
    const [fresh] = await tx`
      INSERT INTO wallet_proof_uses (use_hash, used_at) VALUES (${sha256(`${a.token}:${wallet}`)}, ${now})
      ON CONFLICT (use_hash) DO NOTHING RETURNING 1`;
    if (!fresh) return 'used' as const;
    const [row] = await tx<{ builder_id: number }[]>`
      INSERT INTO person_wallets (wallet, builder_id, proven_at) VALUES (${wallet}, ${id}, ${now})
      ON CONFLICT (wallet) DO UPDATE SET proven_at = EXCLUDED.proven_at WHERE person_wallets.builder_id = EXCLUDED.builder_id
      RETURNING builder_id`;
    // Another person's wallet: nothing is written, and the use is given back.
    if (!row) throw new TakenError();
    return 'ok' as const;
  }).catch((err: unknown) => {
    if (err instanceof TakenError) return 'taken' as const;
    throw err;
  });
  if (out === 'used') return { ok: false, line: WALLET_TEXT.used };
  if (out === 'taken') return { ok: false, line: WALLET_TEXT.taken };
  await noteEvent('wallet_proven', () => ({ type: 'wallet_proven', dedupe_key: `wallet_proven:${id}:${wallet}`, installation_id: id, wallet }));
  await enqueueDiscovery(id, 'wallet');
  await sql()`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${id}`;
  profileChanged();
  return { ok: true };
}
class TakenError extends Error {}

// ---- The page (GET /claim/wallet?t=) and its POST, as claim.ts's pages.

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** A JSON value safe inside a <script> element. Pure. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
/**
 * Final fix wave: next.config's site-wide frame-ancestors policy skips /claim/wallet (WALLET_EXCEPT),
 * so every answer of this route carries it itself: the 200 page in its nonce policy, every other
 * answer (404, 410, JSON, 405) this one.
 */
export const WALLET_FRAME_CSP = { 'Content-Security-Policy': "frame-ancestors 'none'" } as const;
const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...WALLET_FRAME_CSP };
/** T11 fix round 2: the profile's look (brand-page.ts), Funnel Display as data: fonts (font-src data: below). */
const shell = (inner: string) => brandShell(inner, { fonts: true });
const linePage = (line: string, status: number) =>
  new Response(shell(`<p class="ek-line ek-first">${escapeHtml(line)}</p>`), { status, headers: PAGE_HEADERS });

/** Any method but GET and POST on /claim/wallet: 405. */
export function walletOtherMethod(): Response {
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST', 'Cache-Control': 'no-store', ...WALLET_FRAME_CSP } });
}

/**
 * GET /claim/wallet?t=<token>: the lead, one button, and one script: the browser wallet's account,
 * personal_sign of walletMessage, then a same-origin POST; the answer line is printed. No wallet in
 * the browser: WALLET_TEXT.noWallet. Only this page's script runs (a per-response nonce).
 */
export async function walletGet(request: Request): Promise<Response> {
  const t = new URL(request.url).searchParams.get('t') ?? '';
  const id = upgradeOf(t, new Date());
  if (id === null) return linePage(WALLET_TEXT.expired, 410);
  const [p] = await sql()<{ x_handle: string | null }[]>`SELECT x_handle FROM builder_profiles WHERE builder_id = ${id} AND x_user_id IS NOT NULL`;
  if (!p?.x_handle) return linePage(WALLET_TEXT.expired, 410);
  const nonce = randomBytes(16).toString('base64');
  const script =
    `const T=${scriptJson(t)},M=${scriptJson(walletMessage(p.x_handle, t))},NO=${scriptJson(WALLET_TEXT.noWallet)},BAD=${scriptJson(WALLET_TEXT.failed)};` +
    "const out=document.getElementById('out');" +
    "document.getElementById('go').addEventListener('click',async()=>{" +
    'const eth=window.ethereum;if(!eth){out.textContent=NO;return;}' +
    'try{' +
    "const [wallet]=await eth.request({method:'eth_requestAccounts'});" +
    "const hex='0x'+Array.from(new TextEncoder().encode(M),(b)=>b.toString(16).padStart(2,'0')).join('');" +
    "const signature=await eth.request({method:'personal_sign',params:[hex,wallet]});" +
    "const r=await fetch('/claim/wallet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({t:T,wallet,signature})});" +
    'out.textContent=(await r.json()).line||BAD;' +
    '}catch(e){out.textContent=BAD;}});';
  const body = shell(
    `<h1>${escapeHtml(WALLET_TEXT.title)}</h1><p class="ek-line">${escapeHtml(WALLET_TEXT.lead)}</p>` +
      `<div class="ek-actions"><button class="ek-btn" type="button" id="go">${escapeHtml(WALLET_TEXT.button)}</button></div>` +
      `<p class="ek-status" id="out" role="status"></p><script nonce="${nonce}">${script}</script>`,
  );
  return new Response(body, {
    status: 200,
    headers: {
      ...PAGE_HEADERS,
      // Same-origin so the POST carries a real Origin (as claimGet).
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}

type RouteDeps = { limit?: (request: Request) => Promise<unknown>; verify?: Verify; now?: Date };
const json = (line: string, status = 200) =>
  new Response(JSON.stringify({ line }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...WALLET_FRAME_CSP } });

/** POST /claim/wallet ({ t, wallet, signature }): same origin, the xClaim limit, then proveWallet; answers { line }. */
export async function walletPost(request: Request, deps: RouteDeps = {}): Promise<Response> {
  if (request.headers.get('origin') !== new URL(siteUrl()).origin) return json(WALLET_TEXT.failed, 403);
  try {
    await (deps.limit ?? ((r: Request) => enforce('xClaim', clientIp(r.headers), WALLET_TEXT.busy)))(request);
  } catch (err) {
    if (err instanceof RateLimitError) return json(WALLET_TEXT.busy, 429);
    throw err;
  }
  const raw = await request.text().catch(() => '');
  let b: { t?: unknown; wallet?: unknown; signature?: unknown } = {};
  try {
    const parsed: unknown = raw.length <= 30_000 ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') b = parsed as typeof b;
  } catch {
    // not JSON: answered as an expired link below
  }
  if (typeof b.t !== 'string' || typeof b.wallet !== 'string' || typeof b.signature !== 'string') return json(WALLET_TEXT.expired, 400);
  const r = await proveWallet({ token: b.t, wallet: b.wallet, signature: b.signature }, deps.now ?? new Date(), deps.verify);
  return r.ok ? json(WALLET_TEXT.done) : json(r.line, 400);
}
