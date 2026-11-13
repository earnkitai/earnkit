/**
 * OAuth for the hosted MCP endpoint: OAuth 2.1 with PKCE and dynamic client registration, as MCP
 * clients expect. Anonymous: the authorize step approves at once. The issued token is the
 * installation. A registered client_id is 128 random bits kept in `oauth_clients` (v6.1.16 Task 5); a signed id from
 * before v6.1.16 still verifies for one release. Codes are signed with EARNKIT_AUTH_SECRET and spent once
 * (`oauth_codes_spent`). A client_id that is an https URL is a client ID metadata document (CIMD, v6.1.15 Task 14):
 * fetched through the SSRF-safe JSON fetch and cached in process.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CONFUSABLES } from './confusables-table';
import { sql } from './db';
import { RateLimitError, enforce } from './rate-limit';
import { type Resolver, type Transport, TransportError, safeFetchJson } from './safe-fetch';

const CODE_TTL_MS = 5 * 60 * 1000;

export class OAuthError extends Error {
  constructor(
    public code: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'invalid_redirect_uri' | 'invalid_client_metadata' | 'invalid_target',
    message: string,
  ) {
    super(message);
  }
}

function secret() {
  const s = process.env.EARNKIT_AUTH_SECRET;
  if (!s) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return s;
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url');
const mac = (purpose: string, data: string) => createHmac('sha256', secret()).update(`${purpose}:${data}`).digest('base64url');

function sign(purpose: string, payload: object) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${mac(purpose, body)}`;
}

function verify<T>(purpose: string, value: string): T | null {
  // Exactly body.sig: extra segments ("code.x") would verify and, as distinct strings, mint distinct tokens from one code.
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(purpose, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

/** The most redirect URIs a registration or a client document may list (L19-8). */
const MAX_REDIRECT_URIS = 10;

const BLOCKED_SCHEMES = ['javascript:', 'data:', 'file:', 'vbscript:'];

/** https, http on loopback (native apps), or a custom app scheme. Pure. */
export function isAllowedRedirectUri(uri: string) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return !BLOCKED_SCHEMES.includes(url.protocol);
}

/** `r`: the redirect URIs; `n`: the registration nonce; `cn`: the registered name, cleaned. */
export type ClientPayload = { r: string[]; n?: string; cn?: string };
/** `a`: the resource (audience) the code was issued for; absent in codes from before v6.1.16. */
type CodePayload = { c: string; r: string; ch: string; e: number; n: string; a?: string };

/** The MCP resource URL for an origin (RFC 8707): what a token is issued for. Pure. */
export const resourceOf = (origin: string) => `${origin}/mcp`;

/** Whether a `resource` names this origin's MCP resource, one trailing slash folded (L19-5). Pure. */
export function sameResource(given: string, origin: string): boolean {
  return given.replace(/\/$/, '') === resourceOf(origin.replace(/\/$/, ''));
}

/** RFC 7636 4.1: 43 to 128 characters of the unreserved set. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/** A registered client name as stored: letters, digits, spaces and a few marks, at most 40 characters, or null. Pure. */
export function clientNameOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.normalize('NFKC').replace(/[^\p{L}\p{N} .,'&()+-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  return t || null;
}

/** L13-16 (v6.1.14): a client may not register or install under EarnKit's own name. */
export const INVALID_CLIENT_NAME = "client_name may not be EarnKit's own name; send the agent's name.";

/** T6-F1 (v6.1.14): Cyrillic, Greek and other letters that read as Latin ones, folded before the reserved-name check. */
const LOOKALIKES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', і: 'i', ј: 'j', ѕ: 's', т: 't', н: 'h', м: 'm', в: 'b',
  А: 'a', Е: 'e', О: 'o', Р: 'p', С: 'c', У: 'y', Х: 'x', К: 'k', І: 'i', Ј: 'j', Ѕ: 's', Т: 't', Н: 'h', М: 'm', В: 'b',
  α: 'a', ε: 'e', ο: 'o', ρ: 'p', τ: 't', υ: 'u', κ: 'k', ι: 'i', ν: 'v',
  Α: 'a', Ε: 'e', Ο: 'o', Ρ: 'p', Τ: 't', Υ: 'y', Κ: 'k', Ι: 'i', Ν: 'n', Β: 'b', Η: 'h', Μ: 'm', Χ: 'x', Ζ: 'z',
  // FR-9 (final fix): letters NFKD leaves whole: the dotless i and j, Latin alpha and iota, more Cyrillic, Armenian,
  // and the Latin small capitals.
  ı: 'i', ȷ: 'j', ɑ: 'a', ɩ: 'i', һ: 'h', ӏ: 'l', Ӏ: 'l', ԛ: 'q', ԝ: 'w', ԁ: 'd',
  օ: 'o', ո: 'n', ս: 'u', հ: 'h', ց: 'g', զ: 'q', Օ: 'o', Ս: 'u',
  ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ꜰ: 'f', ɢ: 'g', ʜ: 'h', ɪ: 'i', ᴊ: 'j', ᴋ: 'k', ʟ: 'l', ᴍ: 'm', ɴ: 'n',
  ᴏ: 'o', ᴘ: 'p', ʀ: 'r', ꜱ: 's', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ʏ: 'y', ᴢ: 'z',
  // L40-B1 (v6.1.18): the k shapes Unicode's confusables table leaves out (kra, k with hook, turned k).
  ĸ: 'k', ƙ: 'k', ʞ: 'k',
};

/**
 * Whether a client name is EarnKit's own (L13-16, T6-F1): NFKC (widths), NFKD with combining marks dropped (accents),
 * Cyrillic and Greek look-alikes folded to Latin, lower case, letters and digits only, then digits and `l` read as
 * letters and the rest dropped (L16-10), holding `earnkit` anywhere. L45-16 fix round 1 (v6.1.19): the only names let
 * through are the allow-listed words that hold it (`ALLOWED_WORDS`: learnkit, yearnkit, also split as learn kit and
 * yearn kit), dropped before the check; AIEarnKit, 1EarnKit, EarnKitBot and Earn Kitchen are still EarnKit's. A trailing
 * `(server name)` is dropped first (L25-1). Pure.
 */
export function reservedClientName(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  // L25-1 (v6.1.14.1): Claude Code registers as `Claude Code (<server name>)` and the docs name the server
  // `earnkit`, so a trailing parenthetical is the builder's server label, not the agent's name. Drop one before
  // the check, unless fewer than two letters or digits would be left (so `x (EarnKit)` is still refused).
  const stripped = v.replace(/\s*\([^()]*\)\s*$/u, '');
  return leet(withoutAllowed(fold(stripped).length >= 2 ? stripped : v)).includes('earnkit');
}

/** L45-16 fix round 1 (v6.1.19): whole folded words that hold `earnkit` and are another product's name. */
const ALLOWED_WORDS: readonly string[] = ['learnkit', 'yearnkit'];

/**
 * L45-16 fix round 1 (v6.1.19): the name folded as `fold` folds it, but kept as words (hidden characters dropped, any
 * other mark a break), with every allow-listed word (`learnkit`, or `learn` then `kit`) left out; the rest joined. Pure.
 */
function withoutAllowed(v: string): string {
  const bare = v.normalize('NFKC').normalize('NFKD').replace(/\p{M}/gu, '').replace(/\p{Cf}/gu, '');
  const latin = [...bare].map((ch) => LOOKALIKES[ch] ?? CONFUSABLES.get(ch) ?? ch).join('').toLowerCase();
  const words = latin.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (ALLOWED_WORDS.includes(words[i])) continue;
    if (words[i + 1] === 'kit' && ALLOWED_WORDS.includes(`${words[i]}kit`)) {
      i++;
      continue;
    }
    kept.push(words[i]);
  }
  return kept.join('');
}

/** L16-10 (v6.1.16): digits and `l` that read as letters (0 o, 1 i, 3 e, 4 a, 5 s, 7 t, l i), then letters only. */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', l: 'i' };
const leet = (folded: string): string => folded.replace(/[013457l]/g, (ch) => LEET[ch]).replace(/[^\p{L}]/gu, '');

/**
 * NFKC, NFKD with marks dropped, look-alikes to Latin (`LOOKALIKES`, then Unicode's `CONFUSABLES`, L40-B1 v6.1.18),
 * lower case, letters and digits only. Also folds the repro pack's host names (`scripts/repro/target.ts`). Pure.
 */
export function fold(v: string): string {
  const bare = v.normalize('NFKC').normalize('NFKD').replace(/\p{M}/gu, '');
  const latin = [...bare].map((ch) => LOOKALIKES[ch] ?? CONFUSABLES.get(ch) ?? ch).join('');
  return latin.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Hosted agents' callbacks: their servers register for many people. Each is the exact host and the
 * path its callback sits under (an exact path, or one ending in '/' for a prefix). A hosted client
 * only gets a higher per-client ceiling; every address still counts on the one per-address floor (v6.1.7, B5).
 */
export const HOSTED_REDIRECTS = {
  'grok.com': '/connectors/',
  'x.ai': '/connectors/',
  'x.com': '/connectors/',
  'meta.ai': '/connectors/',
  'claude.ai': '/api/mcp/auth_callback',
  'chatgpt.com': '/connector_platform_oauth_redirect',
  'openai.com': '/connector_platform_oauth_redirect',
} as const satisfies Record<string, string>;
export const HOSTED_REDIRECT_HOSTS = Object.keys(HOSTED_REDIRECTS) as (keyof typeof HOSTED_REDIRECTS)[];

/** The hosted service one redirect URI is a callback of: exact host, default port, no user, the vendor's path. Pure. */
function hostedCallbackHost(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!Object.hasOwn(HOSTED_REDIRECTS, host)) return null;
  const path = HOSTED_REDIRECTS[host as keyof typeof HOSTED_REDIRECTS] as string;
  // The registered string itself, not only its normalised form: a dot segment never counts.
  if (/\/\.\.?(?:[/?#]|$)|%2e/i.test(uri)) return null;
  const ok = path.endsWith('/') ? url.pathname.startsWith(path) && url.pathname.length > path.length : url.pathname === path;
  return ok ? host : null;
}

/**
 * The hosted service a client runs on: its host when every redirect URI is that service's callback,
 * else null (a mixed list, or the client name, never counts: anyone can pick either). Pure.
 */
export function hostedRedirectHost(uris: readonly string[]): string | null {
  const hosts = uris.map(hostedCallbackHost);
  const h = hosts[0];
  return h && hosts.every((x) => x === h) ? h : null;
}

/** A client's key in the limits: the first 32 hex of sha256(client_id). Never log client ids. Pure. */
export const clientKeyOf = (clientId: string) => createHash('sha256').update(clientId).digest('hex').slice(0, 32);

/**
 * What a new installation counts against besides its IP: its own registration, or for a client ID metadata document
 * the document's host (`client:host:{host}`; tokenPost adds the caller's address block, so no ceiling is shared by
 * every user of one document; the host as `cimdHost` reads it, L40-C1). Pure.
 */
export const registrationLimitKey = (clientId: string) =>
  isCimdClientId(clientId) ? `client:host:${cimdHost(new URL(clientId).host)}` : `client:${clientKeyOf(clientId)}`;

/** The register ceiling's key: the hosted service every redirect is on, else the registration when given, else none. Pure. */
export function clientLimitKey(uris: readonly string[], clientId?: string): string | null {
  const host = hostedRedirectHost(uris);
  if (host) return `host:${host}`;
  return clientId ? registrationLimitKey(clientId) : null;
}

export type RegisteredClient = {
  client_id: string;
  client_id_issued_at: number;
  redirect_uris: string[];
  client_name?: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
};

/**
 * RFC 7591 dynamic client registration. The client id is 128 random bits (22 base64url characters), never derived from
 * the metadata; it is stored in `oauth_clients` with its redirect URIs (at most 10) and its cleaned name (L19-8).
 */
export async function registerClient(metadata: { redirect_uris?: unknown; client_name?: unknown }): Promise<RegisteredClient> {
  const uris = metadata.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === 'string'))
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be a non-empty list of URIs');
  if (uris.length > MAX_REDIRECT_URIS) throw new OAuthError('invalid_redirect_uri', `at most ${MAX_REDIRECT_URIS} redirect_uris`);
  const bad = uris.find((u) => !isAllowedRedirectUri(u));
  if (bad) throw new OAuthError('invalid_redirect_uri', `redirect_uri not allowed: ${bad}`);
  const cn = clientNameOf(metadata.client_name);
  // Every registration is its own client: apps with one fixed redirect URI for all users never share one.
  const clientId = randomBytes(16).toString('base64url');
  await sql()`INSERT INTO oauth_clients (client_id, redirect_uris, client_name) VALUES (${clientId}, ${uris}, ${cn})`;
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: uris,
    ...(typeof metadata.client_name === 'string' && { client_name: metadata.client_name }),
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

/** Per-user agent hosts' exact documented callbacks. */
export const AGENT_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'https://www.cursor.com/agents/mcp/oauth/callback',
] as const;
/** Known agent apps' custom schemes: the OS hands the code to that app on the builder's machine. */
export const AGENT_APP_SCHEMES = ['cursor', 'vscode', 'vscode-insiders', 'windsurf', 'claude'] as const;

/** `resource`: the resource the code is for (RFC 8707; the MCP resource URL), carried into the code as its audience. */
export type PendingAuthorize = { client_id: string; redirect_uri: string; state: string | null; code_challenge: string; resource?: string };
export type RedirectClass = 'loopback' | 'app' | 'agent_host' | 'other';
export type CheckedAuthorize = { req: PendingAuthorize; redirectClass: RedirectClass; host: string | null };

/** Where a registered redirect sends the code: loopback, a known app scheme, an exact agent callback, or other. Pure. */
export function redirectClass(uri: string): { cls: RedirectClass; host: string | null } {
  const u = new URL(uri);
  if (u.protocol === 'http:') return { cls: 'loopback', host: null };
  if (u.protocol !== 'https:')
    return { cls: (AGENT_APP_SCHEMES as readonly string[]).includes(u.protocol.slice(0, -1).toLowerCase()) ? 'app' : 'other', host: null };
  return { cls: (AGENT_REDIRECT_URIS as readonly string[]).includes(uri) ? 'agent_host' : 'other', host: u.host };
}

/** The page text for a client ID metadata document that fails any check (v6.1.15 Task 14). Builder text. */
export const CIMD_FAILED = "Connecting EarnKit failed. Your agent's client document could not be read.";
/** L45-16 (v6.1.19): the client document's refusal when its name is EarnKit's own, with the reason. */
export const CIMD_RESERVED = "Connecting EarnKit failed. Your agent's client document uses EarnKit's own name; it needs the agent's name.";

/** A client_id that names a URL (http or https): a client ID metadata document, never a registered id. Pure. */
export function isCimdClientId(clientId: string): boolean {
  if (!/^https?:\/\//i.test(clientId) || !URL.canParse(clientId)) return false;
  const p = new URL(clientId).protocol;
  return p === 'https:' || p === 'http:';
}

/** The fetch behind a client ID metadata document, injectable so tests never touch the network. */
export type ClientDeps = {
  resolve?: Resolver;
  transport?: Transport;
  timeoutMs?: number;
  now?: () => number;
  /** Counts one uncached fetch for a document host and the caller's address block; throws RateLimitError over the cap
   *  (default: cimdFetch, `CIMD_FETCH_KEY`). */
  fetchLimit?: (host: string, block: string) => Promise<unknown>;
  /** L35-5 (v6.1.16.1 Task 2): the caller's address block (`blockOf(clientIp)`), the second half of the fetch cap's key. */
  block?: string;
  /** L35-5: false leaves the stored documents (`cimd_documents`) out: a test with mocked timers, which the database
   *  driver's own timers would wait on. */
  store?: false;
};

const CIMD_OK_MS = 60 * 60 * 1000;
const CIMD_FAILED_MS = 5 * 60 * 1000;
/** How long the last good copy is served when a refetch hits a transport error (fix rounds 1 and 2: stale-if-error). */
const CIMD_STALE_MS = 6 * 60 * 60 * 1000;
const CIMD_CACHE_MAX = 1_000;
/** `at`: when it was last read good; `failedAt`: the last refetch that could not be made, while the good copy is served. */
type CimdEntry = { at: number; ok: ClientPayload; failedAt?: number } | { at: number; failed: true; why?: string };
const cimdCache = new Map<string, CimdEntry>();

/** Empties the document cache (tests only). */
export const clearCimdCache = () => cimdCache.clear();

function remember(url: string, entry: CimdEntry) {
  cimdCache.delete(url);
  cimdCache.set(url, entry);
  // Oldest first: a Map iterates in insertion order.
  while (cimdCache.size > CIMD_CACHE_MAX) cimdCache.delete(cimdCache.keys().next().value as string);
}

/** L35-5 (v6.1.16.1 Task 2): the window the uncached-fetch cap counts in: per document host and caller address block. */
export const CIMD_FETCH_KEY = (host: string, block: string) => `cimdFetch:${cimdHost(host)}:${block}`;
/** L40-C1 (v6.1.18): a document host as the fetch caps count it: lower case, trailing dots removed (before any port), so
 *  `host.` and `HOST` are the one host. Pure. */
export const cimdHost = (host: string) => host.toLowerCase().replace(/\.+(?=:\d+$|$)/, '');
/** The block a caller with no address is counted under. */
const NO_BLOCK = 'none';

/**
 * Fetches of document URLs with no cache entry, per document host an hour (fix rounds 1 and 2): nobody can use the
 * authorize page to make EarnKit hammer a public site (a query string per request misses the cache). A refetch of a
 * URL already in the cache never counts, so cache-busting URLs can never stop a vendor's own document being read. Over
 * it: no fetch, the failure page, nothing cached. L35-5 (v6.1.16.1 Task 2): per host and caller address block, so one
 * network's cache-busting never stops anyone else's sign-in through that host; and (controller ruling) at most 300 an
 * hour per host across every block, so many blocks never multiply the fetches.
 */
const cimdFetchLimit = async (host: string, block: string) => {
  await enforce('cimdFetch', `${cimdHost(host)}:${block}`, 'Too many client document reads for this host.');
  // Controller ruling: a total per host beside it; both must pass before a fetch.
  await enforce('cimdFetchHost', cimdHost(host), 'Too many client document reads for this host.');
};
/** The window of the total per-host cap (`cimdFetchHost`, 300 an hour). */
export const CIMD_HOST_KEY = (host: string) => `cimdFetchHost:${cimdHost(host)}`;

/** L35-5: the stored good copy of a document URL (its document and when it was read), or null; never a failure. */
async function storedDocument(url: string): Promise<{ doc: unknown; at: number } | null> {
  try {
    const [r] = await sql()<{ document: unknown; fetched_at: Date }[]>`SELECT document, fetched_at FROM cimd_documents WHERE url = ${url}`;
    return r ? { doc: r.document, at: r.fetched_at.getTime() } : null;
  } catch {
    return null;
  }
}
/** L35-5: keeps a document read good (upsert), or drops a withdrawn one; a store failure never fails the sign-in. */
async function storeDocument(url: string, doc: unknown, at: number): Promise<void> {
  try {
    await sql()`INSERT INTO cimd_documents (url, document, fetched_at) VALUES (${url}, ${sql().json(doc as never)}, ${new Date(at)})
      ON CONFLICT (url) DO UPDATE SET document = EXCLUDED.document, fetched_at = EXCLUDED.fetched_at`;
    // A copy past the 6 hours is never served, so it goes: the table holds at most the last 6 hours of good reads.
    await sql()`DELETE FROM cimd_documents WHERE fetched_at < ${new Date(at - CIMD_STALE_MS)}`;
    // Fix round 1 (N2): one row per URL and at most CIMD_CACHE_MAX rows, the oldest read dropped first.
    await sql()`DELETE FROM cimd_documents WHERE url IN (SELECT url FROM cimd_documents ORDER BY fetched_at DESC, url OFFSET ${CIMD_CACHE_MAX})`;
  } catch (err) {
    console.warn('[oauth] client document not stored', err instanceof Error ? err.message : String(err));
  }
}
async function dropDocument(url: string): Promise<void> {
  try {
    await sql()`DELETE FROM cimd_documents WHERE url = ${url}`;
  } catch {
    // The in-process failure entry already refuses it for 5 minutes.
  }
}
/** Empties the stored documents (tests only). */
export const clearCimdStore = () => sql()`DELETE FROM cimd_documents`;

/** L45-16 (v6.1.19): whether a fetched document's client name is EarnKit's own (as the stored form reads too). Pure. */
const reservedDocName = (doc: unknown): boolean => {
  const n = doc && typeof doc === 'object' ? (doc as { client_name?: unknown }).client_name : undefined;
  return reservedClientName(n) || reservedClientName(clientNameOf(n));
};

/** A fetched document's client, or null when any check fails. Pure. */
function cimdPayload(url: string, doc: unknown): ClientPayload | null {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  const d = doc as { client_id?: unknown; redirect_uris?: unknown; client_name?: unknown };
  if (d.client_id !== url) return null;
  const uris = d.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) return null;
  if (!uris.every((u): u is string => typeof u === 'string' && isAllowedRedirectUri(u))) return null;
  const cn = clientNameOf(d.client_name);
  if (reservedClientName(d.client_name) || reservedClientName(cn)) return null;
  return { r: [...uris], ...(cn && { cn }) };
}

/**
 * A client ID metadata document's client: fetched through `safeFetchJson` (https, public addresses only, no redirects,
 * 5 s, 10 KB, JSON), its `client_id` equal to the URL, its redirect URIs allowed (at most 10), its name not EarnKit's.
 * Cached per URL, at most 1,000 URLs (oldest dropped first): a good document 1 hour. A refetch that hits a transport
 * error (DNS, connect, timeout, 5xx) keeps serving the last good copy for up to 6 hours from its last good read and
 * waits 5 minutes before trying again. A definitive answer (any 4xx, a redirect, a non-JSON or invalid body, a failed
 * check) is a withdrawal: it drops the good copy and caches the failure 5 minutes. Only a refetch of a URL with a
 * good copy is exempt from the per-host fetch cap; every other fetch counts. Any failure throws `invalid_client` with CIMD_FAILED.
 */
export async function cimdClient(url: string, deps: ClientDeps = {}): Promise<ClientPayload> {
  const now = (deps.now ?? Date.now)();
  // L35-5 (v6.1.16.1 Task 2): with no entry in this process, the copy another process (or this one before a restart)
  // read good is the entry, checked again as a fetched one is.
  if (deps.store !== false && !cimdCache.has(url)) {
    const kept = await storedDocument(url);
    const client = kept && now - kept.at < CIMD_STALE_MS ? cimdPayload(url, kept.doc) : null;
    if (client) remember(url, { at: kept!.at, ok: client });
  }
  const hit = cimdCache.get(url);
  const good = hit && 'ok' in hit && now - hit.at < CIMD_STALE_MS ? hit : null;
  if (good && (now - good.at < CIMD_OK_MS || (good.failedAt !== undefined && now - good.failedAt < CIMD_FAILED_MS))) return good.ok;
  if (hit && 'failed' in hit && now - hit.at < CIMD_FAILED_MS) throw new OAuthError('invalid_client', hit.why ?? CIMD_FAILED);
  const refused = () => new OAuthError('invalid_client', CIMD_FAILED);
  // Security review (round 2): only a refetch of a URL with a good copy is exempt from the per-host cap; a URL
  // with a failed entry counts again, so failed cache-busting URLs cannot be refetched for free every 5 minutes.
  if (!good) {
    try {
      await (deps.fetchLimit ?? cimdFetchLimit)(cimdHost(new URL(url).host), deps.block ?? NO_BLOCK);
    } catch (err) {
      if (!(err instanceof RateLimitError)) throw err;
      // Over the cap: no fetch, and nothing cached (a cap is not the document's fault).
      throw refused();
    }
  }
  let doc: unknown;
  try {
    doc = await safeFetchJson(url, { resolve: deps.resolve, transport: deps.transport, timeoutMs: deps.timeoutMs });
  } catch (err) {
    // The read could not be made (an outage): the last good copy stands. Any definitive answer is a withdrawal.
    if (good && err instanceof TransportError) {
      remember(url, { ...good, failedAt: now });
      return good.ok;
    }
    remember(url, { at: now, failed: true });
    if (good && deps.store !== false) await dropDocument(url);
    throw refused();
  }
  const client = cimdPayload(url, doc);
  if (!client) {
    // The vendor's document now fails a check: it replaces any good copy. L45-16 (v6.1.19): EarnKit's own name says so.
    const why = reservedDocName(doc) ? CIMD_RESERVED : undefined;
    remember(url, { at: now, failed: true, ...(why && { why }) });
    if (good && deps.store !== false) await dropDocument(url);
    throw new OAuthError('invalid_client', why ?? CIMD_FAILED);
  }
  remember(url, { at: now, ok: client });
  if (deps.store !== false) await storeDocument(url, doc, now);
  return client;
}

/** A registered id's shape: 22 base64url characters (128 random bits). */
const REGISTERED_ID = /^[A-Za-z0-9_-]{22}$/;

/**
 * The client behind a client_id: a URL goes to its client ID metadata document (checked first, only for a value that
 * parses as a URL, so a registered id never reaches it); a registered id is read from `oauth_clients` (v6.1.16 Task 5);
 * else a signed id from before v6.1.16 is verified (an alias for one release, so connected agents re-authorize without
 * registering again). Null when unknown.
 */
export async function clientOf(clientId: string, deps: ClientDeps = {}): Promise<ClientPayload | null> {
  if (isCimdClientId(clientId)) return cimdClient(clientId, deps);
  if (REGISTERED_ID.test(clientId)) {
    const [row] = await sql()<{ redirect_uris: string[]; client_name: string | null }[]>`
      SELECT redirect_uris, client_name FROM oauth_clients WHERE client_id = ${clientId}`;
    return row ? { r: row.redirect_uris, ...(row.client_name && { cn: row.client_name }) } : null;
  }
  return verify<ClientPayload>('client', clientId);
}

/** The origin when a caller passes none: EARNKIT_URL (tests and dev may fall back to localhost). */
const defaultOrigin = () => originFor(process.env, 'http://localhost');

/**
 * Validates an authorize request: an unknown client or unregistered redirect throws (shown on our
 * page, never redirected); one without response_type=code and a PKCE S256 challenge goes back to
 * the redirect with invalid_request; a `resource` other than this origin's MCP resource goes back with
 * invalid_target (L19-5; absent is allowed). `origin`: the public origin (publicOrigin).
 */
export async function checkAuthorize(params: URLSearchParams, deps: ClientDeps = {}, origin = defaultOrigin()): Promise<CheckedAuthorize | { error: URL }> {
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const client = await clientOf(clientId, deps);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client_id. Register first.');
  if (!client.r.includes(redirectUri)) {
    // A document that does not list the redirect fails like any other document check.
    if (isCimdClientId(clientId)) throw new OAuthError('invalid_client', CIMD_FAILED);
    throw new OAuthError('invalid_redirect_uri', 'redirect_uri was not registered');
  }
  const state = params.get('state');
  const challenge = params.get('code_challenge');
  if (params.get('response_type') !== 'code' || !challenge || params.get('code_challenge_method') !== 'S256') {
    const back = new URL(redirectUri);
    if (state) back.searchParams.set('state', state);
    back.searchParams.set('error', 'invalid_request');
    back.searchParams.set('error_description', 'Requires response_type=code and a PKCE S256 code_challenge');
    return { error: back };
  }
  const resource = params.get('resource');
  if (resource !== null && !sameResource(resource, origin)) {
    const back = new URL(redirectUri);
    if (state) back.searchParams.set('state', state);
    back.searchParams.set('error', 'invalid_target');
    back.searchParams.set('error_description', `resource must be ${resourceOf(origin)}`);
    return { error: back };
  }
  const { cls, host } = redirectClass(redirectUri);
  return {
    req: { client_id: clientId, redirect_uri: redirectUri, state, code_challenge: challenge, resource: resourceOf(origin) },
    redirectClass: cls,
    host,
  };
}

/** The redirect with a code (and RFC 9207's iss). `_who` is always null: the approval is anonymous. */
export async function issueCode(req: PendingAuthorize, _who: null, issuer?: string, deps: ClientDeps = {}): Promise<URL> {
  const client = await clientOf(req.client_id, deps);
  if (!client || !client.r.includes(req.redirect_uri)) throw new OAuthError('invalid_client', 'Unknown client_id. Register first.');
  const back = new URL(req.redirect_uri);
  if (req.state) back.searchParams.set('state', req.state);
  if (issuer) back.searchParams.set('iss', issuer);
  back.searchParams.set(
    'code',
    sign('code', {
      c: req.client_id,
      r: req.redirect_uri,
      ch: req.code_challenge,
      e: Date.now() + CODE_TTL_MS,
      n: randomBytes(12).toString('base64url'),
      a: req.resource ?? resourceOf(issuer ?? defaultOrigin()),
    } satisfies CodePayload),
  );
  return back;
}

/**
 * Exchanges a code for the installation token. The token is derived from the code; the caller spends the code's
 * `nonce` once (tokenPost, `oauth_codes_spent`), so a second exchange is refused and revokes the token (L19-4). Each
 * token is its own installation: a re-authorization starts a fresh ledger (nothing proves two tokens are one builder).
 * A `resource` field must name this origin's MCP resource (invalid_target); `audience` is the code's resource.
 */
export async function exchangeCode(
  form: URLSearchParams,
  deps: ClientDeps = {},
  origin = defaultOrigin(),
): Promise<{ token: string; limitKey: string; hostedHost: string | null; clientName: string | null; nonce: string; audience: string }> {
  if (form.get('grant_type') !== 'authorization_code') throw new OAuthError('unsupported_grant_type', 'Only authorization_code is supported');
  const code = form.get('code') ?? '';
  const payload = verify<CodePayload>('code', code);
  if (!payload || payload.e < Date.now()) throw new OAuthError('invalid_grant', 'Code is invalid or expired');
  const clientId = form.get('client_id');
  if (clientId && clientId !== payload.c) throw new OAuthError('invalid_grant', 'Code was issued to another client');
  const redirectUri = form.get('redirect_uri');
  if (redirectUri && redirectUri !== payload.r) throw new OAuthError('invalid_grant', 'redirect_uri does not match');
  const verifier = form.get('code_verifier') ?? '';
  // L19-2: RFC 7636 4.1, before the hash compare.
  if (!VERIFIER.test(verifier)) throw new OAuthError('invalid_grant', 'code_verifier must be 43 to 128 unreserved characters');
  if (b64(createHash('sha256').update(verifier).digest()) !== payload.ch) throw new OAuthError('invalid_grant', 'PKCE verification failed');
  const resource = form.get('resource');
  if (resource !== null && !sameResource(resource, origin)) throw new OAuthError('invalid_target', `resource must be ${resourceOf(origin)}`);

  // The code keeps the client_id; a document is re-read through its cache (a failed read refuses the exchange).
  const client = await clientOf(payload.c, deps);
  // v6.1.16 Task 16: a registered client that exchanged a code is kept; the daily run sweeps the unused ones over 30 days.
  if (client && !isCimdClientId(payload.c)) await sql()`UPDATE oauth_clients SET used_at = now() WHERE client_id = ${payload.c} AND used_at IS NULL`;
  return {
    token: `ek_${mac('token', code)}`,
    limitKey: registrationLimitKey(payload.c),
    hostedHost: hostedRedirectHost(client?.r ?? [payload.r]),
    clientName: clientNameOf(client?.cn),
    nonce: payload.n,
    audience: payload.a ?? resourceOf(origin),
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

export function protectedResourceMetadata(origin: string) {
  return { resource: resourceOf(origin), authorization_servers: [origin], bearer_methods_supported: ['header'], resource_name: 'EarnKit' };
}

/**
 * The public origin for discovery and WWW-Authenticate: EARNKIT_URL. Production requires it and
 * never falls back to the request's Host, which a client controls; local dev and tests may. Pure.
 */
export function originFor(env: { NODE_ENV?: string; EARNKIT_URL?: string }, requestUrl: string) {
  const configured = env.EARNKIT_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test')
    throw new Error('EARNKIT_URL is not set. Production needs it (e.g. https://earnkit.com) for OAuth discovery; the request Host is never used.');
  return new URL(requestUrl).origin;
}

export const publicOrigin = (request: Request) => originFor(process.env, request.url);
