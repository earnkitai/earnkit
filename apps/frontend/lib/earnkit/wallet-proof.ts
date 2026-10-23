import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createPublicClient, http, type PublicClient } from 'viem';
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
import { THEME as T } from './theme';

/**
 * v2.12.1 spec "Identity": a signed wallet proves the contracts it created (v2.12's deploy_wallet proof). v3.1 wallet
 * proof (owner-approved 2026-10-23): offered once in onboarding, right after setup (wallet-offer.ts), and again whenever
 * the builder asks to change their reward wallet. The token ties the signature to one person for 30 minutes and is used
 * once (wallet_proof_uses holds its hash); the message names the builder and their earnkit.com page. viem's
 * verifyMessage on Base also checks smart wallets (ERC-1271 and ERC-6492); the signature itself is EIP-191
 * personal_sign. A wallet the agent only typed never proves anything; only this signature writes person_wallets, and
 * the newest proven wallet is the person's reward recipient (provenWallet).
 */
export const UPGRADE_TTL_MS = 30 * 60_000;
export const WALLET_TEXT = {
  title: 'Prove your Base wallet',
  lead: 'One signature, no fee. Your contracts on Base will show on your page, and your EarnKit rewards go to this wallet. We never move funds.',
  sign: 'You sign this message',
  button: 'Sign with my wallet',
  copy: 'Copy link',
  copied: 'Link copied.',
  doneTitle: 'Done',
  done: 'Your wallet is proven. Your contracts on Base will show on your page soon. You can close this page.',
  failed: "That signature didn't match. Try again, or ask your agent for a new link.",
  cancelled: 'Nothing was signed. Tap the button to try again.',
  taken: 'That wallet is already on another EarnKit page.',
  expired: 'This link has expired. Ask your agent for a new wallet link.',
  used: 'This link was already used. Ask your agent for a new wallet link.',
  noWallet: "No wallet found in this browser. Copy this link and open it in your wallet app's browser.",
  busy: 'Too many tries from here. Try again in an hour.',
} as const;

const mac = (secret: string, s: string) => createHmac('sha256', secret).update(`upgrade:v1:${s}`).digest('base64url').slice(0, 22);
/**
 * A signed link token: the person, its expiry and (v3.1) a random part, so two links made in the same millisecond
 * are still two links (each is used once). Null without EARNKIT_AUTH_SECRET.
 */
export function upgradeToken(builderId: number, now: Date, secret = process.env.EARNKIT_AUTH_SECRET): string | null {
  if (!secret) return null;
  const body = `${builderId}.${now.getTime() + UPGRADE_TTL_MS}.${randomBytes(6).toString('base64url')}`;
  return `${body}.${mac(secret, body)}`;
}
export function upgradeOf(token: string, now: Date, secret = process.env.EARNKIT_AUTH_SECRET): number | null {
  const m = /^(\d{1,10})\.(\d{13})\.([A-Za-z0-9_-]{8})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!secret || !m) return null;
  const want = Buffer.from(mac(secret, `${m[1]}.${m[2]}.${m[3]}`));
  const got = Buffer.from(m[4]);
  if (want.length !== got.length || !timingSafeEqual(want, got) || Number(m[2]) < now.getTime()) return null;
  return Number(m[1]);
}
/** What the builder signs: their handle, their earnkit.com page, that it moves no funds, and the one-use code. Pure. */
export const walletMessage = (handle: string, token: string) =>
  `EarnKit: this wallet belongs to @${handle} on ${pageUrl(handle)}.\nSigning is free and moves no funds.\nCode: ${token}`;
/** The signing page's link for this person, a fresh one-use token (null without EARNKIT_AUTH_SECRET). */
export function walletLink(builderId: number, now: Date): string | null {
  const t = upgradeToken(builderId, now);
  return t ? `${siteUrl()}/claim/wallet?t=${encodeURIComponent(t)}` : null;
}
/** The person's reward wallet: the newest wallet they proved by signature (lowercase), else null. */
export async function provenWallet(builderId: number): Promise<string | null> {
  const [w] = await sql()<{ wallet: string }[]>`SELECT wallet FROM person_wallets WHERE builder_id = ${builderId} ORDER BY proven_at DESC, wallet LIMIT 1`;
  return w?.wallet ?? null;
}
/** Whether the person proved a wallet at or after `since` (the ask's time). */
export async function provenSince(builderId: number, since: Date): Promise<boolean> {
  const [w] = await sql()`SELECT 1 FROM person_wallets WHERE builder_id = ${builderId} AND proven_at >= ${since} LIMIT 1`;
  return Boolean(w);
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** A token's use key: one per token, so a link proves one wallet once. */
const tokenUseKey = (token: string) => sha256(`token:${token}`);

type Verify = (a: { address: string; message: string; signature: string }) => Promise<boolean>;
/**
 * The check on a Base client: viem's verifyMessage, which recovers an EOA's signer and asks a smart wallet itself
 * (ERC-1271 isValidSignature; ERC-6492 for one not deployed yet, through eth_call). No wallet SDK.
 */
export const verifierOn = (client: Pick<PublicClient, 'verifyMessage'>): Verify => (a) =>
  client.verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` });
const baseVerify: Verify = (a) =>
  verifierOn(createPublicClient({ chain: base, transport: http(rpcFor('base') ?? undefined, { timeout: 10_000, retryCount: 0 }) }))(a);

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
      INSERT INTO wallet_proof_uses (use_hash, used_at) VALUES (${tokenUseKey(a.token)}, ${now})
      ON CONFLICT (use_hash) DO NOTHING RETURNING 1`;
    if (!fresh) {
      // A retried POST of the same proof (a double tap) is still done; any other use of the link is refused.
      const [same] = await tx`SELECT 1 FROM person_wallets WHERE wallet = ${wallet} AND builder_id = ${id}`;
      return same ? ('again' as const) : ('used' as const);
    }
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
  if (out === 'again') return { ok: true };
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
  return new Response(shell(`<p class="ek-line ek-first">${escapeHtml('This page only opens from your link.')}</p>`), { status: 405, headers: { ...PAGE_HEADERS, Allow: 'GET, POST' } });
}

/** The page's own few rules on top of brandShell's (the message box, the done block); inline, as style-src allows. */
const PAGE_CSS =
  `<style>.ek-msg{margin:12px 0 0;padding:14px 16px;background:${T.surface};border:1px solid ${T.border};color:${T.text};` +
  `font:400 .9375rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}` +
  `.ek-sec{background:transparent;border:1px solid ${T.borderStrong}}.ek-sec:hover{background:${T.chipHover}}` +
  `.ek-btn[disabled]{opacity:.6;cursor:default}[hidden]{display:none!important}</style>`;
/** Whether this token was used already (wallet_proof_uses). */
async function tokenUsed(token: string): Promise<boolean> {
  const [u] = await sql()`SELECT 1 FROM wallet_proof_uses WHERE use_hash = ${tokenUseKey(token)}`;
  return Boolean(u);
}

/**
 * GET /claim/wallet?t=<token>: what happens (the lead), the exact message, one button, and one script: the browser
 * wallet's account (EIP-1193 window.ethereum, no SDK), personal_sign of walletMessage, then a same-origin POST. Success
 * swaps in the done block; a cancel or a bad signature says so and the button works again. No wallet in the browser:
 * WALLET_TEXT.noWallet and a Copy link button (open it in a wallet app's browser). An expired or used link: one line,
 * 410. Only this page's script runs (a per-response nonce).
 */
export async function walletGet(request: Request): Promise<Response> {
  const t = new URL(request.url).searchParams.get('t') ?? '';
  const id = upgradeOf(t, new Date());
  if (id === null) return linePage(WALLET_TEXT.expired, 410);
  const [p] = await sql()<{ x_handle: string | null }[]>`SELECT x_handle FROM builder_profiles WHERE builder_id = ${id} AND x_user_id IS NOT NULL`;
  if (!p?.x_handle) return linePage(WALLET_TEXT.expired, 410);
  if (await tokenUsed(t)) return linePage(WALLET_TEXT.used, 410);
  const message = walletMessage(p.x_handle, t);
  const nonce = randomBytes(16).toString('base64');
  const script =
    `const T=${scriptJson(t)},M=${scriptJson(message)},X=${scriptJson({ no: WALLET_TEXT.noWallet, bad: WALLET_TEXT.failed, cancel: WALLET_TEXT.cancelled, copied: WALLET_TEXT.copied })};` +
    "const $=(i)=>document.getElementById(i),out=$('out'),go=$('go'),copy=$('copy');" +
    "go.addEventListener('click',async()=>{" +
    'const eth=window.ethereum;if(!eth){out.textContent=X.no;copy.hidden=false;return;}' +
    "go.disabled=true;out.textContent='';let wallet,signature;" +
    "try{[wallet]=await eth.request({method:'eth_requestAccounts'});" +
    "const hex='0x'+Array.from(new TextEncoder().encode(M),(b)=>b.toString(16).padStart(2,'0')).join('');" +
    "signature=await eth.request({method:'personal_sign',params:[hex,wallet]});}" +
    'catch(e){go.disabled=false;out.textContent=e&&e.code===4001?X.cancel:X.bad;return;}' +
    "try{const r=await fetch('/claim/wallet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({t:T,wallet,signature})});" +
    "const j=await r.json();if(r.ok){$('ask').hidden=true;$('done').hidden=false;out.textContent='';$('done-h').focus();return;}" +
    'out.textContent=j.line||X.bad;}catch(e){out.textContent=X.bad;}go.disabled=false;});' +
    "copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);out.textContent=X.copied;}catch(e){}});";
  const body = shell(
    PAGE_CSS +
      `<div id="ask"><h1>${escapeHtml(WALLET_TEXT.title)}</h1><p class="ek-line">${escapeHtml(WALLET_TEXT.lead)}</p>` +
      `<p class="ek-small">${escapeHtml(WALLET_TEXT.sign)}</p><p class="ek-msg">${escapeHtml(message)}</p>` +
      `<div class="ek-actions"><button class="ek-btn" type="button" id="go">${escapeHtml(WALLET_TEXT.button)}</button>` +
      `<button class="ek-btn ek-sec" type="button" id="copy" hidden>${escapeHtml(WALLET_TEXT.copy)}</button></div></div>` +
      `<div id="done" hidden><h1 id="done-h" tabindex="-1">${escapeHtml(WALLET_TEXT.doneTitle)}</h1><p class="ek-line">${escapeHtml(WALLET_TEXT.done)}</p></div>` +
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
