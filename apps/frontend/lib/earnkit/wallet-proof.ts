import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createPublicClient, http, recoverMessageAddress, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import { xSignInEnabled } from './builder-score-flag';
import { sql } from './db';
import { discoverPerson, enqueueDiscovery } from './discovery';
import { defaultReaderDeps } from './source-readers';
import { shortWallet, siteUrl } from './entry-text';
import { noteEvent } from './events';
import { cookieValue } from './github-verify';
import { profileChanged } from './profile-cache';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { pageUrl } from './reserved-routes';
import { rpcFor } from './verify';

/**
 * v2.12.1 spec "Identity": a signed wallet proves the contracts it created (v2.12's deploy_wallet proof). v3.1 wallet
 * proof (owner-approved 2026-10-23): offered once in onboarding, right after setup (wallet-offer.ts), and again whenever
 * the builder asks to change their reward wallet. The token ties the signature to one person for 30 minutes and is used
 * once (wallet_proof_uses holds its hash); the message names the builder and their earnkit.com page. viem's
 * verifyMessage on Base also checks smart wallets (ERC-1271 and ERC-6492); the signature itself is EIP-191
 * personal_sign. A wallet the agent only typed never proves anything; only this signature writes person_wallets.
 *
 * Fix round (security): a leaked link must not redirect money. The first proof (no reward wallet yet) makes the wallet
 * the recipient on the token alone; replacing a recipient needs a fresh X sign-in as the same person on the page
 * (wallet_x_checks, bound to x_user_id); without it the wallet counts for contracts only (recipient_at NULL).
 */
export const UPGRADE_TTL_MS = 30 * 60_000;
export const WALLET_TEXT = {
  title: 'Prove your Base wallet',
  lead: 'One signature, no fee. Your contracts on Base will show on your page, and your EarnKit rewards go to this wallet. We never move funds.',
  basescan: 'Your page links your contracts on Basescan, so this wallet will be public.',
  sign: 'You sign this message',
  button: 'Sign with my wallet',
  xButton: 'Sign in with X',
  contractsOnly: 'Sign for contracts only',
  copy: 'Copy link',
  copied: 'Link copied.',
  doneTitle: 'Done',
  failed: "That signature didn't match. Try again, or ask your agent for a new link.",
  unchecked: "Couldn't check that signature. Try again in a minute.",
  cancelled: 'Nothing was signed. Tap the button to try again.',
  taken: 'That wallet is already on another EarnKit page.',
  expired: 'This link has expired. Ask your agent for a new wallet link.',
  used: 'This link was already used. Ask your agent for a new wallet link.',
  pick: 'Pick the wallet to sign with.',
  noWallet: "No wallet found in this browser. Copy this link and open it in your wallet app's browser.",
  busy: 'Too many tries from here. Try again in an hour.',
  xOther: 'That X account is not the one on this EarnKit page. Sign in with the same X account to change the reward wallet.',
  xLost: 'Signed in with X. Open the wallet link from your agent again.',
} as const;
/** The page's line once a reward wallet exists: changing it needs X first. Pure. */
export const walletXLead = (handle: string, current: string) =>
  `Your rewards go to ${shortWallet(current)}. To send them to a new wallet, sign in with X as @${handle} first.`;
/** Done, the wallet is now the reward recipient. Pure. */
export const walletDoneLine = (wallet: string) =>
  `Your rewards now go to ${shortWallet(wallet)}. You can close this page.`;
/** Done for contracts only (no X sign-in while another wallet gets the rewards). Pure. */
export const walletContractsLine = (current: string) =>
  `Added for your contracts. Your rewards still go to ${shortWallet(current)}. To change that, ask your agent for a new link and sign in with X on it.`;

/**
 * v4.6: `purpose` binds a token to the page it opens ('upgrade' = the wallet page, unchanged; 'stripe' = the Stripe
 * connect page). It is part of the HMAC input, so a token of one purpose never verifies as another.
 */
const mac = (secret: string, s: string, purpose = 'upgrade') => createHmac('sha256', secret).update(`${purpose}:v1:${s}`).digest('base64url').slice(0, 22);
/**
 * A signed link token: the person, its expiry and (v3.1) a random part, so two links made in the same millisecond
 * are still two links (each is used once). Null without EARNKIT_AUTH_SECRET.
 */
export function upgradeToken(builderId: number, now: Date, secret = process.env.EARNKIT_AUTH_SECRET, purpose = 'upgrade'): string | null {
  if (!secret) return null;
  const body = `${builderId}.${now.getTime() + UPGRADE_TTL_MS}.${randomBytes(6).toString('base64url')}`;
  return `${body}.${mac(secret, body, purpose)}`;
}
export function upgradeOf(token: string, now: Date, secret = process.env.EARNKIT_AUTH_SECRET, purpose = 'upgrade'): number | null {
  const m = /^(\d{1,10})\.(\d{13})\.([A-Za-z0-9_-]{8})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!secret || !m) return null;
  const want = Buffer.from(mac(secret, `${m[1]}.${m[2]}.${m[3]}`, purpose));
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
/**
 * The person's reward wallet: the one made recipient last (lowercase); a person with proven wallets but none marked (rows
 * from before recipient_at) has their first. Null with none. A contracts-only wallet is never chosen while a recipient
 * exists, and only exists beside one (the first proof is always the recipient).
 */
export async function provenWallet(builderId: number): Promise<string | null> {
  const [w] = await sql()<{ wallet: string }[]>`
    SELECT wallet FROM person_wallets WHERE builder_id = ${builderId} ORDER BY (recipient_at IS NULL), recipient_at DESC, proven_at, wallet LIMIT 1`;
  return w?.wallet ?? null;
}
/** The newest wallet proven at or after `since` and whether it is the recipient now; null when none. */
export async function provenSince(builderId: number, since: Date): Promise<{ wallet: string; recipient: boolean } | null> {
  const [w] = await sql()<{ wallet: string }[]>`
    SELECT wallet FROM person_wallets WHERE builder_id = ${builderId} AND GREATEST(proven_at, COALESCE(recipient_at, proven_at)) >= ${since}
    ORDER BY GREATEST(proven_at, COALESCE(recipient_at, proven_at)) DESC, wallet LIMIT 1`;
  if (!w) return null;
  return { wallet: w.wallet, recipient: (await provenWallet(builderId)) === w.wallet };
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** A token's use key: one per token, so a link proves one wallet once (also the key of its X check). */
export const tokenUseKey = (token: string) => sha256(`token:${token}`);
/**
 * Security follow-up: the X check belongs to the browser that signed in, not to whoever holds the link. Its secret
 * lives only in that browser's __Host-ekwx- cookie (HttpOnly, Secure, Lax); wallet_x_checks keeps its sha256.
 */
export const walletXCookie = (useHash: string) => `__Host-ekwx-${useHash.slice(0, 16)}`;
const browserHash = (secret: string) => sha256(`walletx:${secret}`);
/** Whether this link's page passed an X sign-in as its person, in this browser (`secret`, its cookie), within the link's life. */
async function xChecked(token: string, builderId: number, now: Date, secret: string | null | undefined): Promise<boolean> {
  if (!secret) return false;
  const [r] = await sql()`
    SELECT 1 FROM wallet_x_checks WHERE use_hash = ${tokenUseKey(token)} AND builder_id = ${builderId} AND browser_hash = ${browserHash(secret)}
      AND checked_at > ${new Date(now.getTime() - UPGRADE_TTL_MS)}`;
  return Boolean(r);
}

type Verify = (a: { address: string; message: string; signature: string }) => Promise<boolean>;
/**
 * The check on a Base client: viem's verifyMessage, which recovers an EOA's signer and asks a smart wallet itself
 * (ERC-1271 isValidSignature; ERC-6492 for one not deployed yet, through eth_call). No wallet SDK.
 */
export const verifierOn = (client: Pick<PublicClient, 'verifyMessage' | 'getBlockNumber'>): Verify => async (a) => {
  if (await client.verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` })) return true;
  // viem reads a failed eth_call as "not valid": a no is only a no while the RPC answers (else this throws: try again).
  await client.getBlockNumber({ cacheTime: 0 });
  return false;
};
const baseVerify: Verify = (a) =>
  verifierOn(createPublicClient({ chain: base, transport: http(rpcFor('base') ?? undefined, { timeout: 10_000, retryCount: 0 }) }))(a);
/** An EOA's own signature, checked locally (no RPC): its recovered signer is the wallet. Never throws. */
async function signedByKey(wallet: string, message: string, signature: string): Promise<boolean> {
  if (signature.length !== 132) return false;
  return recoverMessageAddress({ message, signature: signature as `0x${string}` }).then((a) => a.toLowerCase() === wallet, () => false);
}

/** `first`: v4.0, this proof made the person's first reward wallet (none before it): their token launches on it. */
export type ProveResult = { ok: true; recipient: boolean; first: boolean; line: string } | { ok: false; line: string };
/** `xSecret`: the request's __Host-ekwx- cookie (walletPost), the browser's proof that it passed the page's X sign-in. */
/**
 * v4.0 fix round 1 `hooks`: `onProven(first)` runs once the proof is written, before its side effects (so a failing one
 * never stops the token launch); `after` is test injection only (a side effect that may throw).
 */
export type ProveHooks = { onProven?: (first: boolean) => void; after?: (builderId: number) => Promise<void> };
export async function proveWallet(a: { token: string; wallet: string; signature: string; xSecret?: string | null }, now: Date, verify: Verify = baseVerify, hooks: ProveHooks = {}): Promise<ProveResult> {
  const id = upgradeOf(a.token, now);
  if (id === null) return { ok: false, line: WALLET_TEXT.expired };
  const wallet = a.wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || !/^0x[0-9a-fA-F]{130,20000}$/.test(a.signature)) return { ok: false, line: WALLET_TEXT.failed };
  // Only the handle the X claim wrote (x_user_id-bound): an unclaimed person has no page to sign for.
  const [p] = await sql()<{ x_handle: string | null }[]>`SELECT x_handle FROM builder_profiles WHERE builder_id = ${id} AND x_user_id IS NOT NULL`;
  if (!p?.x_handle) return { ok: false, line: WALLET_TEXT.expired };
  const message = walletMessage(p.x_handle, a.token);
  // Fix round: an EOA is checked locally; a smart wallet asks the chain, and a failed ask is "try again", never a mismatch.
  let good = await signedByKey(wallet, message, a.signature);
  if (!good) {
    try {
      good = await verify({ address: wallet, message, signature: a.signature });
    } catch (err) {
      console.error('[wallet] verify', err instanceof Error ? err.name : 'error');
      return { ok: false, line: WALLET_TEXT.unchecked };
    }
  }
  if (!good) return { ok: false, line: WALLET_TEXT.failed };
  const before = await provenWallet(id);
  // The first reward wallet needs only the link; replacing one needs this link's X sign-in in this same browser.
  const free = before === null || before === wallet;
  let recipient = free;
  const out = await sql().begin(async (tx) => {
    await tx`DELETE FROM wallet_proof_uses WHERE used_at < ${new Date(now.getTime() - 86_400_000)}`;
    await tx`DELETE FROM wallet_x_checks WHERE checked_at < ${new Date(now.getTime() - 86_400_000)}`;
    const [fresh] = await tx`
      INSERT INTO wallet_proof_uses (use_hash, used_at) VALUES (${tokenUseKey(a.token)}, ${now})
      ON CONFLICT (use_hash) DO NOTHING RETURNING 1`;
    if (!fresh) {
      // A retried POST of the same proof (a double tap) is still done; any other use of the link is refused.
      const [same] = await tx`SELECT 1 FROM person_wallets WHERE wallet = ${wallet} AND builder_id = ${id}`;
      return same ? ('again' as const) : ('used' as const);
    }
    // The X check is used up with the proof (one use): it counts only for this link, person and browser cookie.
    if (!free && a.xSecret) {
      const [x] = await tx`
        DELETE FROM wallet_x_checks WHERE use_hash = ${tokenUseKey(a.token)} AND builder_id = ${id} AND browser_hash = ${browserHash(a.xSecret)}
          AND checked_at > ${new Date(now.getTime() - UPGRADE_TTL_MS)} RETURNING 1`;
      recipient = Boolean(x);
    }
    // proven_at stays the first proof's (Base Builder Code attribution keeps the first wallet, attribution.ts).
    const [row] = await tx<{ builder_id: number }[]>`
      INSERT INTO person_wallets (wallet, builder_id, proven_at, recipient_at) VALUES (${wallet}, ${id}, ${now}, ${recipient ? now : null})
      ON CONFLICT (wallet) DO UPDATE SET recipient_at = CASE WHEN ${recipient} THEN EXCLUDED.proven_at ELSE person_wallets.recipient_at END
      WHERE person_wallets.builder_id = EXCLUDED.builder_id
      RETURNING builder_id`;
    // Another person's wallet: nothing is written, and the use is given back.
    if (!row) throw new TakenError();
    // A changed recipient: the next agent reply says so in one line (bench-find.ts takeWalletNotice).
    if (recipient && before !== null && before !== wallet)
      await tx`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('wallet_notice', ${shortWallet(wallet)}::text)
        WHERE builder_id = ${id}`;
    return 'ok' as const;
  }).catch((err: unknown) => {
    if (err instanceof TakenError) return 'taken' as const;
    throw err;
  });
  if (out === 'used') return { ok: false, line: WALLET_TEXT.used };
  if (out === 'taken') return { ok: false, line: WALLET_TEXT.taken };
  const now_ = await provenWallet(id);
  const done = (r: boolean, first = false): ProveResult => ({ ok: true, recipient: r, first, line: r ? walletDoneLine(wallet) : walletContractsLine(now_ ?? wallet) });
  if (out === 'again') return done(now_ === wallet);
  const first = recipient && before === null;
  hooks.onProven?.(first);
  await hooks.after?.(id);
  await noteEvent('wallet_proven', () => ({ type: 'wallet_proven', dedupe_key: `wallet_proven:${id}:${wallet}`, installation_id: id, wallet, detail: { recipient } }));
  await enqueueDiscovery(id, 'wallet');
  await sql()`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${id}`;
  profileChanged();
  return done(recipient, first);
}
class TakenError extends Error {}

// ---- The page (app/claim/wallet/page.tsx reads walletPageState) and its POST (/claim/wallet/proof).

export type WalletPage =
  | { kind: 'gone'; line: string }
  | {
      kind: 'sign'; token: string; handle: string; message: string;
      /** The reward wallet now (shown short), null before the first. */
      current: string | null;
      /** A reward wallet exists and this link hasn't passed the X sign-in: the page asks for it (or contracts only). */
      needX: boolean;
      /** The X sign-in route for this link, null while X sign-in is off. */
      xHref: string | null;
    };

/** What the signing page shows for this link (expired, used, signing, X first). A busy client IP: the busy line. */
export async function walletPageState(
  token: string, now: Date, o: { ip?: string; limit?: (ip: string) => Promise<unknown>; xCookie?: (name: string) => string | null | undefined } = {},
): Promise<WalletPage> {
  try {
    await (o.limit ?? ((ip: string) => enforce('walletPage', ip, WALLET_TEXT.busy)))(o.ip ?? 'unknown');
  } catch (err) {
    if (err instanceof RateLimitError) return { kind: 'gone', line: WALLET_TEXT.busy };
    throw err;
  }
  const id = upgradeOf(token, now);
  if (id === null) return { kind: 'gone', line: WALLET_TEXT.expired };
  const [p] = await sql()<{ x_handle: string | null }[]>`SELECT x_handle FROM builder_profiles WHERE builder_id = ${id} AND x_user_id IS NOT NULL`;
  if (!p?.x_handle) return { kind: 'gone', line: WALLET_TEXT.expired };
  const [used] = await sql()`SELECT 1 FROM wallet_proof_uses WHERE use_hash = ${tokenUseKey(token)}`;
  if (used) return { kind: 'gone', line: WALLET_TEXT.used };
  const current = await provenWallet(id);
  const needX = current !== null && !(await xChecked(token, id, now, o.xCookie?.(walletXCookie(tokenUseKey(token)))));
  return {
    kind: 'sign', token, handle: p.x_handle, message: walletMessage(p.x_handle, token), current, needX,
    xHref: needX && xSignInEnabled() ? `/claim/wallet/x?t=${encodeURIComponent(token)}` : null,
  };
}

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
/** The wallet page's X sign-in cookie that carries the link back after X (HttpOnly, 15 minutes, this origin only). */
export const walletTokenCookie = (useHash: string) => `__Host-ekwt-${useHash.slice(0, 16)}`;

/**
 * GET /claim/wallet/x?t=: the X sign-in for a link whose person already has a reward wallet (the v2.14 sign-in rows,
 * purpose 'wallet', bound to the link's use hash). Two cookies: the state's csrf (x-install.ts) and the link itself, so
 * the callback can send the browser back to the page. Anything else: the page itself.
 */
export async function walletXStart(request: Request, now = new Date()): Promise<Response> {
  const t = new URL(request.url).searchParams.get('t') ?? '';
  const back = new Response(null, { status: 303, headers: { Location: `/claim/wallet?t=${encodeURIComponent(t)}`, ...NO_STORE } });
  const s = await walletPageState(t, now, { ip: clientIp(request.headers), xCookie: (n) => cookieValue(request, n) });
  if (s.kind !== 'sign' || !s.needX || !s.xHref) return back;
  const id = upgradeOf(t, now)!;
  const h = tokenUseKey(t);
  const { newSignin } = await import('./x-install');
  const { to, cookie } = await newSignin({ purpose: 'wallet', installationId: id, linkHash: h }, now);
  const headers = new Headers({ Location: to, ...NO_STORE });
  headers.append('Set-Cookie', cookie);
  headers.append('Set-Cookie', `${walletTokenCookie(h)}=${t}; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax`);
  return new Response(null, { status: 302, headers });
}

/**
 * The X callback's wallet branch (x-install.ts xSignInCallback): only the X account already on this page (x_user_id)
 * passes; the link's check is kept (wallet_x_checks) and the browser goes back to the page with its link (the cookie).
 */
export async function walletXSignedIn(builderId: number, useHash: string, user: { id: string }, clear: Record<string, string>, request: Request): Promise<Response> {
  const { signinPage } = await import('./x-install');
  const [p] = await sql()<{ x: string | null }[]>`SELECT x_user_id AS x FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p?.x || p.x !== user.id) return signinPage(WALLET_TEXT.xOther, 403, clear);
  const t = cookieValue(request, walletTokenCookie(useHash)) ?? '';
  if (tokenUseKey(t) !== useHash) return signinPage(WALLET_TEXT.xLost, 200, clear);
  // The check is this browser's: a random secret in its cookie, only the hash kept (a newer sign-in replaces it).
  const secret = randomBytes(32).toString('base64url');
  await sql()`
    INSERT INTO wallet_x_checks (use_hash, builder_id, checked_at, browser_hash) VALUES (${useHash}, ${builderId}, now(), ${browserHash(secret)})
    ON CONFLICT (use_hash) DO UPDATE SET checked_at = now(), browser_hash = EXCLUDED.browser_hash WHERE wallet_x_checks.builder_id = EXCLUDED.builder_id`;
  const headers = new Headers({ ...NO_STORE, ...clear });
  headers.append('Set-Cookie', `${walletTokenCookie(useHash)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  headers.append('Set-Cookie', `${walletXCookie(useHash)}=${secret}; Path=/; Max-Age=1800; HttpOnly; Secure; SameSite=Lax`);
  headers.set('Location', `/claim/wallet?t=${encodeURIComponent(t)}`);
  return new Response(null, { status: 303, headers });
}

type RouteDeps = {
  limit?: (request: Request) => Promise<unknown>; verify?: Verify; now?: Date; discover?: (builderId: number) => Promise<void>;
  /** v4.0: test injection only: the builder token launch's tokens.fun fetch and ticker check (builder-token.ts). */
  builderToken?: { fetch?: typeof fetch; check?: (symbol: string) => Promise<boolean | null> };
  /** v4.0 fix round 1: test injection only: a side effect after the proof is written (ProveHooks.after). */
  afterProof?: (builderId: number) => Promise<void>;
};
/**
 * v4.0: the builder's token launches on their first reward wallet (setup step 3), unless they said no (a declined row is
 * returned untouched); never awaited by the proof's answer, and never throws (a failure is logged; "launch my token" or
 * the owner settles it). Fix round 1: only when the builder saw step 3's token sentence (standing_seen.token_offered);
 * otherwise only their own "launch my token" launches it.
 */
async function launchOnProof(builderId: number, deps: RouteDeps['builderToken']): Promise<void> {
  try {
    const [p] = await sql()<{ offered: boolean }[]>`
      SELECT COALESCE(standing_seen ? 'token_offered', false) AS offered FROM builder_profiles WHERE builder_id = ${builderId}`;
    if (!p?.offered) return;
    const { launchBuilderToken } = await import('./builder-token');
    await launchBuilderToken(builderId, deps ?? {});
  } catch (err) {
    console.error('[wallet proof] token launch', err instanceof Error ? err.name : 'error');
  }
}
/** The new wallet's discovery budget: it runs beside the reply, so the page shows it moments after signing. */
export const PROOF_DISCOVER_MS = 20_000;
/** The new wallet's discovery now (its first Base transaction, its contracts), then the page's caches. Never throws. */
async function discoverNow(builderId: number): Promise<void> {
  const deadline = Date.now() + PROOF_DISCOVER_MS;
  await discoverPerson(builderId, { deadline, reader: defaultReaderDeps(new Date(), deadline) })
    .catch((err: unknown) => console.error('[wallet proof] discovery', err instanceof Error ? err.name : 'error'));
  profileChanged();
}
const json = (body: { line: string; recipient?: boolean }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** POST /claim/wallet/proof ({ t, wallet, signature }): same origin, its own limit, then proveWallet; answers { line, recipient? }. */
export async function walletPost(request: Request, deps: RouteDeps = {}): Promise<Response> {
  if (request.headers.get('origin') !== new URL(siteUrl()).origin) return json({ line: WALLET_TEXT.failed }, 403);
  try {
    await (deps.limit ?? ((r: Request) => enforce('walletProof', clientIp(r.headers), WALLET_TEXT.busy)))(request);
  } catch (err) {
    if (err instanceof RateLimitError) return json({ line: WALLET_TEXT.busy }, 429);
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
  if (typeof b.t !== 'string' || typeof b.wallet !== 'string' || typeof b.signature !== 'string') return json({ line: WALLET_TEXT.expired }, 400);
  const xName = walletXCookie(tokenUseKey(b.t));
  const xSecret = cookieValue(request, xName);
  const builderId = upgradeOf(b.t, deps.now ?? new Date());
  // v4.0: the first reward wallet launches the token, fired as soon as the proof is written (never awaited; fix round 1:
  // before the proof's side effects, so a failing one never stops it).
  const r = await proveWallet({ token: b.t, wallet: b.wallet, signature: b.signature, xSecret }, deps.now ?? new Date(), deps.verify, {
    onProven: (first) => {
      if (first && builderId !== null) void launchOnProof(builderId, deps.builderToken);
    },
    after: deps.afterProof,
  });
  if (!r.ok) return json({ line: r.line }, r.line === WALLET_TEXT.unchecked ? 503 : 400);
  // A newly proven wallet shows on the page at once, not on the next background run (never waited on).
  if (builderId !== null) void (deps.discover ?? discoverNow)(builderId);
  const done = json({ line: r.line, recipient: r.recipient });
  // The X check is used up: its cookie goes too.
  if (xSecret) done.headers.append('Set-Cookie', `${walletXCookie(tokenUseKey(b.t))}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return done;
}
