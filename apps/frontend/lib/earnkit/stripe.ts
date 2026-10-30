import { sql } from './db';
import { siteUrl } from './entry-text';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { open, seal } from './secret-box';
import { linkPerson, upgradeOf, upgradeToken } from './wallet-proof';

/**
 * v4.6 verified Stripe revenue, Task 1: the key store and the connect page. A builder pastes a live restricted key with
 * Read only; it is checked (four GETs and the ownership rule: the account's website must be one of the builder's
 * verified sites), then kept sealed (secret-box.ts). The key is never logged, returned, evented or put in an error.
 *
 * Stripe docs (checked 2026-10-30): a restricted key's GET /v1/account needs the Accounts read permission
 * (`connected_account_read`, Direct), which the dashboard files under Connect; docs.stripe.com/api/accounts/retrieve
 * shows only GET /v1/accounts/{id}. We call /v1/account (it returns our own id) and name that permission "Account" in
 * the page copy, as the plan's exact copy does. Write permissions imply read, so a Write key also passes.
 */
export const STRIPE_PURPOSE = 'stripe';
export type StripeCall = (path: string, key: string) => Promise<{ status: number; body: unknown }>;

export const STRIPE_TEXT = {
  title: 'Connect Stripe, read-only',
  steps: [
    'In Stripe, open Developers, API keys, and create a restricted key.',
    'Give it Read on Balance transactions, Charges, Subscriptions and Account. Nothing else.',
    "Paste it here. EarnKit only reads, never shows the number publicly, and you can disconnect any time.",
  ],
  saved: 'Connected. Your next grant draft shows your Stripe revenue once it reaches $100 in 30 days.',
  secretKey: "That's your full secret key. Make a restricted key with Read only and paste that instead.",
  testKey: "That's a test key. Paste a live restricted key.",
  notAKey: "That doesn't look like a Stripe key. Paste a live restricted key, it starts with rk_live_.",
  noSite: "Stripe lists no website for this account. Set your project's site in Stripe, Settings, Business details, then paste again.",
  alreadyConnected: 'Stripe is already connected. Ask your agent to disconnect it first, then use a new link.',
  taken: 'That Stripe account is already connected to another builder.',
  rejected: "Stripe didn't accept that key. Check it and paste it again.",
  unreachable: "Couldn't reach Stripe. Try again in a minute.",
  expired: 'This link has expired. Ask your agent for a new Stripe link.',
  busy: 'Too many tries from here. Try again in an hour.',
  failed: "Couldn't save that. Try again.",
  button: 'Connect Stripe',
  placeholder: 'rk_live_...',
  label: 'Restricted key',
  doneTitle: 'Done',
  disconnected: 'Stripe disconnected. EarnKit deleted the key.',
} as const;
export const missingLine = (what: string) => `This key can't read ${what}. Add Read on ${what} and paste it again.`;
export const mismatchLine = (host: string) =>
  `Stripe lists ${host} as this account's website, which isn't one of your projects. Set your project's site in Stripe, Settings, Business details, then paste again.`;

export type KeyKind = 'restricted' | 'secret' | 'test' | 'other';
/** What a pasted string is, by prefix only. Pure. */
export function keyKind(key: string): KeyKind {
  if (key.startsWith('rk_live_')) return 'restricted';
  if (key.startsWith('sk_live_')) return 'secret';
  if (key.startsWith('rk_test_') || key.startsWith('sk_test_')) return 'test';
  return 'other';
}

/** The live call: GET https://api.stripe.com/v1/... with the key as a bearer. No redirects; 10 s; never throws the key. */
export const stripeFetch: StripeCall = async (path, key) => {
  if (!path.startsWith('/v1/')) throw new Error('stripe: bad path');
  const r = await fetch(`https://api.stripe.com${path}`, {
    method: 'GET', headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// Hosting suffixes whose subdomains belong to different people: a Stripe host that IS one of these never matches a sibling.
const SHARED_SUFFIXES = new Set([
  'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'up.railway.app', 'railway.app', 'herokuapp.com', 'fly.dev',
  'onrender.com', 'web.app', 'firebaseapp.com', 'surge.sh', 'replit.app', 'repl.co', 'glitch.me', 'lovable.app', 'webflow.io',
  'wixsite.com', 'carrd.co', 'framer.website', 'framer.app', 'streamlit.app', 'gitlab.io', 'vercel.dev', 'netlify.com', 'ngrok.app',
]);
const hostOf = (v: string): string | null => {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
    const h = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    return h.includes('.') ? h : null;
  } catch {
    return null;
  }
};
/**
 * Exact-host ownership, no public-suffix guessing: the Stripe host equals a verified site host, is a subdomain of one,
 * or (with at least two labels and not a shared hosting suffix) is a parent of one. Pure.
 */
export const hostMatches = (stripeHost: string, siteHosts: string[]) =>
  siteHosts.some(
    (s) =>
      stripeHost === s ||
      stripeHost.endsWith(`.${s}`) ||
      (stripeHost.split('.').length >= 2 && !SHARED_SUFFIXES.has(stripeHost) && s.endsWith(`.${stripeHost}`)),
  );

export type CheckResult = { ok: true; accountId: string; host: string } | { ok: false; line: string };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/**
 * Runs the four reads and the ownership rule. A 401 is a rejected key, a 403 names the missing permission, anything
 * else (a thrown call, 5xx, an odd answer) is "try again". Nothing here returns or logs the key.
 */
export async function checkKey(builderId: number, key: string, call: StripeCall): Promise<CheckResult> {
  const get = async (path: string): Promise<{ status: number; body: unknown } | null> => {
    try {
      return await call(path, key);
    } catch (err) {
      console.error('[stripe] call', err instanceof Error ? err.name : 'error');
      return null;
    }
  };
  const a = await get('/v1/account');
  if (!a) return { ok: false, line: STRIPE_TEXT.unreachable };
  if (a.status === 401) return { ok: false, line: STRIPE_TEXT.rejected };
  if (a.status === 403) return { ok: false, line: missingLine('Account') };
  const acct = obj(a.body);
  if (a.status !== 200 || typeof acct.id !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(acct.id)) return { ok: false, line: STRIPE_TEXT.unreachable };
  // Ownership: the account's website is one of this builder's verified sites (a friend's account is refused, nothing stored).
  const rawUrl = obj(acct.business_profile).url;
  const host = typeof rawUrl === 'string' ? hostOf(rawUrl) : null;
  if (!host) return { ok: false, line: STRIPE_TEXT.noSite };
  const sites = await sql()<{ ref: string }[]>`SELECT ref FROM builder_sources WHERE builder_id = ${builderId} AND kind = 'site' AND state = 'verified'`;
  const hosts = sites.map((s) => hostOf(s.ref)).filter((h): h is string => h !== null);
  if (!hostMatches(host, hosts)) return { ok: false, line: mismatchLine(host) };
  for (const [path, what] of [
    ['/v1/balance_transactions?limit=1', 'Balance transactions'],
    ['/v1/charges?limit=1', 'Charges'],
    ['/v1/subscriptions?limit=1', 'Subscriptions'],
  ] as const) {
    const r = await get(path);
    if (!r) return { ok: false, line: STRIPE_TEXT.unreachable };
    if (r.status === 401) return { ok: false, line: STRIPE_TEXT.rejected };
    if (r.status === 403) return { ok: false, line: missingLine(what) };
    if (r.status !== 200) return { ok: false, line: STRIPE_TEXT.unreachable };
  }
  return { ok: true, accountId: acct.id, host };
}

export type ConnectResult = { ok: true; line: string } | { ok: false; line: string };
/** Checks the kind, then the key, then stores it sealed (an upsert: pasting again replaces the key and clears 'broken'). */
export async function connectStripe(token: string, key: string, now: Date, call: StripeCall = stripeFetch): Promise<ConnectResult> {
  const who = await linkPerson(token, now, STRIPE_PURPOSE);
  if (!who.ok) return { ok: false, line: STRIPE_TEXT.expired };
  const id = who.id;
  const k = key.trim();
  const kind = keyKind(k);
  if (kind === 'secret') return { ok: false, line: STRIPE_TEXT.secretKey };
  if (kind === 'test') return { ok: false, line: STRIPE_TEXT.testKey };
  if (kind !== 'restricted' || k.length > 400 || !/^rk_live_[A-Za-z0-9_]+$/.test(k)) return { ok: false, line: STRIPE_TEXT.notAKey };
  const c = await checkKey(id, k, call);
  if (!c.ok) return c;
  const [other] = await sql()`SELECT 1 FROM stripe_connections WHERE account_id = ${c.accountId} AND builder_id <> ${id}`;
  if (other) return { ok: false, line: STRIPE_TEXT.taken };
  // A link may create a connection or rotate the key of the same account, never swap in a different account.
  const [mine] = await sql()<{ account_id: string }[]>`SELECT account_id FROM stripe_connections WHERE builder_id = ${id}`;
  if (mine && mine.account_id !== c.accountId) return { ok: false, line: STRIPE_TEXT.alreadyConnected };
  try {
    // The write itself enforces "never swap accounts": a conflicting row of another account is not updated (no row back).
    const won = await sql()`
      INSERT INTO stripe_connections (builder_id, sealed_key, account_id, site_host, state, connected_at, broken_at)
      VALUES (${id}, ${seal(k, STRIPE_PURPOSE)}, ${c.accountId}, ${c.host}, 'ok', ${now}, NULL)
      ON CONFLICT (builder_id) DO UPDATE SET sealed_key = EXCLUDED.sealed_key, site_host = EXCLUDED.site_host,
        state = 'ok', connected_at = EXCLUDED.connected_at, broken_at = NULL
        WHERE stripe_connections.account_id = EXCLUDED.account_id
      RETURNING builder_id`;
    if (won.length === 0) return { ok: false, line: STRIPE_TEXT.alreadyConnected };
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') return { ok: false, line: STRIPE_TEXT.taken };
    console.error('[stripe] store', err instanceof Error ? err.name : 'error');
    return { ok: false, line: STRIPE_TEXT.failed };
  }
  return { ok: true, line: STRIPE_TEXT.saved };
}

/** Deletes the builder's sealed key; true when a row was there. */
export async function disconnectStripe(builderId: number): Promise<boolean> {
  const r = await sql()`DELETE FROM stripe_connections WHERE builder_id = ${builderId} RETURNING 1`;
  return r.length > 0;
}
/** The builder's decrypted key, or null (none, or a rotated secret). For the daily read only; never returned by a route. */
export async function stripeKey(builderId: number): Promise<string | null> {
  const [r] = await sql()<{ sealed_key: string }[]>`SELECT sealed_key FROM stripe_connections WHERE builder_id = ${builderId}`;
  return r ? open(r.sealed_key, STRIPE_PURPOSE) : null;
}

/** The connect page's link for this person: a fresh 30-minute token of the 'stripe' purpose (null without EARNKIT_AUTH_SECRET). */
export function stripeLink(builderId: number, now: Date): string | null {
  const t = upgradeToken(builderId, now, undefined, STRIPE_PURPOSE);
  return t ? `${siteUrl()}/connect/stripe?t=${encodeURIComponent(t)}` : null;
}

export type StripePage = { kind: 'gone'; line: string } | { kind: 'connect'; token: string; handle: string; connected: boolean };
/** What the connect page shows for this link (expired, busy, or the form). */
export async function stripePageState(
  token: string, now: Date, o: { ip?: string; limit?: (ip: string) => Promise<unknown> } = {},
): Promise<StripePage> {
  const who = await linkPerson(token, now, STRIPE_PURPOSE, () => (o.limit ?? ((ip: string) => enforce('stripePage', ip, STRIPE_TEXT.busy)))(o.ip ?? 'unknown'));
  if (!who.ok) return { kind: 'gone', line: who.why === 'busy' ? STRIPE_TEXT.busy : STRIPE_TEXT.expired };
  const id = who.id;
  const [c] = await sql()`SELECT 1 FROM stripe_connections WHERE builder_id = ${id}`;
  return { kind: 'connect', token, handle: who.handle, connected: Boolean(c) };
}

type RouteDeps = { limit?: (request: Request, builderId: number | null) => Promise<unknown>; call?: StripeCall; now?: Date };
const json = (body: { line: string; ok: boolean }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

/** POST /connect/stripe ({ t, key }): same origin, rate limited per IP and per builder; answers { ok, line } only. */
export async function stripePost(request: Request, deps: RouteDeps = {}): Promise<Response> {
  const now = deps.now ?? new Date();
  if (request.headers.get('origin') !== new URL(siteUrl()).origin) return json({ ok: false, line: STRIPE_TEXT.failed }, 403);
  const raw = await request.text().catch(() => '');
  let b: { t?: unknown; key?: unknown } = {};
  try {
    const parsed: unknown = raw.length <= 2_000 ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') b = parsed as typeof b;
  } catch {
    // not JSON: answered as an expired link below
  }
  const builderId = typeof b.t === 'string' ? upgradeOf(b.t, now, undefined, STRIPE_PURPOSE) : null;
  try {
    await (deps.limit ?? (async (r: Request, id: number | null) => {
      await enforce('stripeConnect', clientIp(r.headers), STRIPE_TEXT.busy);
      if (id !== null) await enforce('stripeConnect', `b${id}`, STRIPE_TEXT.busy);
    }))(request, builderId);
  } catch (err) {
    if (err instanceof RateLimitError) return json({ ok: false, line: STRIPE_TEXT.busy }, 429);
    throw err;
  }
  if (typeof b.t !== 'string' || typeof b.key !== 'string' || builderId === null) return json({ ok: false, line: STRIPE_TEXT.expired }, 400);
  let r: ConnectResult;
  try {
    r = await connectStripe(b.t, b.key, now, deps.call);
  } catch (err) {
    console.error('[stripe] connect', err instanceof Error ? err.name : 'error');
    return json({ ok: false, line: STRIPE_TEXT.failed }, 500);
  }
  return json({ ok: r.ok, line: r.line }, r.ok ? 200 : 400);
}
