import { sql } from './db';
import { siteUrl } from './entry-text';
import { usdRate } from './fx';
import { RateLimitError, clientIp, enforce, hit } from './rate-limit';
import { REVENUE_MIN } from './ship-log-facts';
import { USED_STALE_DAYS } from './site-data';
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

/**
 * v4.6 Task 2: the daily read. Balance transaction names checked against docs.stripe.com/reports/balance-transaction-types
 * (2026-10-30): `charge` (card) and `payment` (local methods) in; `refund` and `payment_refund` out; disputes and their
 * reversals are both type `adjustment` (reporting_category `dispute` / `dispute_reversal`). `amount` is signed and
 * before Stripe fees, so fees are not subtracted. Only GETs through the injected StripeCall; the key goes nowhere but there.
 */
export const STRIPE_PAGES = 10;
export const STRIPE_PER_RUN = 25;
const WINDOW_DAYS = 30;
const PAYER_MIN = 3;
const TOP_MAX = 0.5;
/** A 401/403: the key no longer works. The only error the read throws on purpose (carries no key or Stripe text). */
export class StripeAuthError extends Error {
  constructor() {
    super('stripe key rejected');
    this.name = 'StripeAuthError';
  }
}
class NoRate extends Error {}
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
export type StripeRate = (currency: string) => Promise<number | null>;
export type StripeRevenue = { net_usd: number; mrr_usd: number; payers: number; top_share: number; capped: boolean };
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Every item of a list endpoint, STRIPE_PAGES pages of 100 at most (capped when more remain). Throws on any failure. */
async function listAll(call: StripeCall, key: string, base: string): Promise<{ items: Record<string, unknown>[]; capped: boolean }> {
  const items: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (let page = 0; page < STRIPE_PAGES; page++) {
    const r = await call(`${base}${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`, key);
    if (r.status === 401 || r.status === 403) throw new StripeAuthError();
    const b = obj(r.body);
    if (r.status !== 200 || !Array.isArray(b.data)) throw new Error('stripe: odd answer');
    for (const x of b.data) items.push(obj(x));
    if (b.has_more !== true) return { items, capped: false };
    after = str(obj(b.data[b.data.length - 1]).id);
    if (!after) throw new Error('stripe: no cursor');
  }
  return { items, capped: true };
}

/**
 * The last 30 days of one account (Rules: net figure, MRR, currency, real customers). Null on any failed or partial read
 * or a missing rate (nothing is stored then); throws StripeAuthError on a 401/403. `ownEmails` are lowercased addresses
 * of the builder: their charges (and balance transactions) are dropped before the net and the payer count.
 */
export async function stripeRevenue(key: string, now: Date, call: StripeCall, rate: StripeRate, ownEmails: string[] = []): Promise<StripeRevenue | null> {
  const since = Math.floor(now.getTime() / 1000) - WINDOW_DAYS * 86_400;
  const rates = new Map<string, number>();
  const usd = async (amount: number, currency: unknown) => {
    const cur = (str(currency) ?? 'usd').toLowerCase();
    let r = rates.get(cur);
    if (r === undefined) {
      const got = cur === 'usd' ? 1 : await rate(cur);
      if (got === null || !Number.isFinite(got) || got <= 0) throw new NoRate();
      rates.set(cur, (r = got));
    }
    return (amount / (ZERO_DECIMAL.has(cur) ? 1 : 100)) * r;
  };
  try {
    const bts = await listAll(call, key, `/v1/balance_transactions?limit=100&created[gte]=${since}`);
    const charges = await listAll(call, key, `/v1/charges?limit=100&created[gte]=${since}`);
    const subs = await listAll(call, key, '/v1/subscriptions?limit=100&status=active');
    const own = new Set(ownEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
    // Charges: payers (real customers) and the builder's own, dropped.
    const droppedBt = new Set<string>();
    const paid = new Map<string, number>();
    const payerCustomers = new Set<string>();
    const btById = new Map<string, Record<string, unknown>>(bts.items.map((t) => [String(t.id), t]));
    for (const c of charges.items) {
      const email = str(obj(c.billing_details).email)?.trim().toLowerCase();
      if (c.status !== 'succeeded') continue;
      if (email && own.has(email)) {
        const id = str(obj(c.balance_transaction).id) ?? str(c.balance_transaction);
        if (id) droppedBt.add(id);
        continue;
      }
      if (c.refunded === true) continue;
      const card = obj(obj(c.payment_method_details).card);
      const who = str(card.fingerprint) ?? str(c.customer) ?? email;
      if (!who) continue;
      // Gross from the settled balance transaction (same currency and units as net), scaled by what was not refunded.
      const t = btById.get(str(obj(c.balance_transaction).id) ?? str(c.balance_transaction) ?? '');
      const amount = num(c.amount);
      if (!t || amount <= 0) continue;
      const kept = Math.max(0, amount - num(c.amount_refunded)) / amount;
      paid.set(who, (paid.get(who) ?? 0) + (await usd(Math.abs(num(t.amount)), t.currency)) * kept);
      const cus = str(c.customer) ?? str(obj(c.customer).id);
      if (cus) payerCustomers.add(cus);
    }
    let net = 0;
    for (const t of bts.items) {
      const type = str(t.type);
      const cat = str(t.reporting_category);
      const a = Math.abs(num(t.amount));
      let sign = 0;
      if (type === 'charge' || type === 'payment') sign = droppedBt.has(String(t.id)) ? 0 : 1;
      else if (type === 'refund' || type === 'payment_refund' || type === 'payment_reversal' || type === 'payment_failure_refund') sign = -1;
      else if (type === 'refund_failure') sign = 1;
      else if (type === 'adjustment' && cat === 'dispute') sign = -1;
      else if (type === 'adjustment' && cat === 'dispute_reversal') sign = 1;
      if (sign !== 0 && a > 0) net += sign * (await usd(a, t.currency));
    }
    let mrr = 0;
    for (const s of subs.items) {
      if (s.status !== 'active') continue;
      // Only a paying customer's undiscounted subscription counts (no 100%-off coupons, no unpaid invoices, never the builder's own).
      const cus = str(s.customer) ?? str(obj(s.customer).id);
      if (!cus || !payerCustomers.has(cus)) continue;
      if (s.discount || (Array.isArray(s.discounts) && s.discounts.length > 0)) continue;
      for (const it of Array.isArray(obj(s.items).data) ? (obj(s.items).data as unknown[]) : []) {
        const price = obj(obj(it).price);
        const unit = price.unit_amount;
        const rec = obj(price.recurring);
        const per = ({ month: 1, year: 1 / 12, week: 52 / 12, day: 365 / 12 } as Record<string, number | undefined>)[str(rec.interval) ?? ''];
        if (typeof unit !== 'number' || !Number.isFinite(unit) || per === undefined) continue;
        const every = Math.max(1, num(rec.interval_count) || 1);
        const qty = obj(it).quantity === undefined ? 1 : num(obj(it).quantity);
        try {
          mrr += ((await usd(unit * qty, price.currency)) * per) / every;
        } catch (err) {
          if (!(err instanceof NoRate)) throw err; // MRR is not the gate: an item without a rate is skipped
        }
      }
    }
    const gross = [...paid.values()].reduce((x, y) => x + y, 0);
    const top = gross > 0 ? Math.max(...paid.values()) / gross : 0;
    const cents = (v: number) => Math.round(v * 100) / 100;
    return {
      net_usd: Math.max(0, cents(net)), mrr_usd: cents(mrr), payers: paid.size, top_share: Math.round(top * 10_000) / 10_000,
      capped: bts.capped || charges.capped || subs.capped,
    };
  } catch (err) {
    if (err instanceof StripeAuthError) throw err;
    console.error('[stripe] read', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/** The builder's own addresses EarnKit holds (the digest opt-in email, over their installation(s)), lowercased. */
async function ownEmails(builderId: number): Promise<string[]> {
  const rows = await sql()<{ email: string }[]>`
    SELECT DISTINCT lower(d.email) AS email FROM digest_subscriptions d JOIN installations i ON i.id = d.installation_id
    WHERE (i.builder_id = ${builderId} OR (i.id = ${builderId} AND i.builder_id IS NULL)) AND d.email IS NOT NULL`;
  return rows.map((r) => r.email);
}

/** Connections in state 'ok' with no stripe_revenue row today: never read first, then the oldest; at most `limit`. */
export async function stripeDue(now: Date, o: { limit?: number; only?: number[] } = {}): Promise<number[]> {
  const today = now.toISOString().slice(0, 10);
  const db = sql();
  const rows = await db<{ builder_id: number }[]>`
    SELECT c.builder_id FROM stripe_connections c
    LEFT JOIN LATERAL (SELECT max(r.day) AS day FROM stripe_revenue r WHERE r.builder_id = c.builder_id) r ON true
    WHERE c.state = 'ok' AND (r.day IS NULL OR r.day < ${today}::date) ${o.only ? db`AND c.builder_id IN ${db(o.only)}` : db``}
    ORDER BY r.day NULLS FIRST, c.builder_id LIMIT ${o.limit ?? STRIPE_PER_RUN}`;
  return rows.map((r) => r.builder_id);
}

/**
 * The cron's daily step: each due connection once a UTC day (claimed before its reads, so a failing one waits a day),
 * none started past `deadline`. A 401/403 marks it 'broken'; any other failure stores nothing. Only error names are logged.
 */
export async function runStripeRevenue(
  now: Date,
  o: { deadline: number; call?: StripeCall; rate?: StripeRate; only?: number[]; limit?: number },
): Promise<{ due: number; stored: number; note?: string }> {
  // Without the secret no key can be opened: skip the whole step (no claim, no state change) and say so.
  if (!process.env.EARNKIT_AUTH_SECRET) return { due: 0, stored: 0, note: 'EARNKIT_AUTH_SECRET is not set, Stripe not read' };
  const due = await stripeDue(now, o);
  const day = now.toISOString().slice(0, 10);
  const call = o.call ?? stripeFetch;
  const rate = o.rate ?? ((c: string) => usdRate(c, now));
  let stored = 0;
  for (const id of due) {
    if (Date.now() >= o.deadline) break;
    if (!(await hit(`stripe:${id}:${day}`, 1, 86_400, now)).allowed) continue;
    try {
      const key = await stripeKey(id);
      if (!key) {
        // A sealed key that no longer opens (a rotated secret) is as good as a rejected one: broken, so the ask re-offers.
        await sql()`UPDATE stripe_connections SET state = 'broken', broken_at = ${now} WHERE builder_id = ${id}`;
        continue;
      }
      const r = await stripeRevenue(key, now, call, rate, await ownEmails(id));
      if (!r) continue;
      const shown = r.payers >= PAYER_MIN && r.top_share <= TOP_MAX;
      await sql()`
        INSERT INTO stripe_revenue (builder_id, day, net_usd, mrr_usd, payers, top_share, shown, capped, read_at)
        VALUES (${id}, ${day}, ${r.net_usd}, ${r.mrr_usd}, ${r.payers}, ${r.top_share}, ${shown}, ${r.capped}, ${now})
        ON CONFLICT (builder_id, day) DO UPDATE SET net_usd = EXCLUDED.net_usd, mrr_usd = EXCLUDED.mrr_usd, payers = EXCLUDED.payers,
          top_share = EXCLUDED.top_share, shown = EXCLUDED.shown, capped = EXCLUDED.capped, read_at = EXCLUDED.read_at`;
      stored++;
    } catch (err) {
      if (err instanceof StripeAuthError) {
        await sql()`UPDATE stripe_connections SET state = 'broken', broken_at = ${now} WHERE builder_id = ${id}`;
      } else {
        console.error('[stripe] run', err instanceof Error ? err.name : 'error');
      }
    }
  }
  return { due: due.length, stored };
}

/** The builder's newest stripe_revenue row no older than USED_STALE_DAYS, when shown and net >= REVENUE_MIN; else null. */
export async function latestStripe(builderId: number, now: Date): Promise<{ usd: number; mrr: number; capped: boolean } | null> {
  const today = now.toISOString().slice(0, 10);
  const [r] = await sql()<{ usd: number; mrr: number; capped: boolean; shown: boolean }[]>`
    SELECT net_usd::float8 AS usd, mrr_usd::float8 AS mrr, capped, shown FROM stripe_revenue
    WHERE builder_id = ${builderId} AND day <= ${today}::date AND day >= ${today}::date - ${USED_STALE_DAYS}::int
    ORDER BY day DESC LIMIT 1`;
  return r && r.shown && r.usd >= REVENUE_MIN ? { usd: r.usd, mrr: r.mrr, capped: r.capped } : null;
}
