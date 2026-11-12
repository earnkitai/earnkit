import { promises as dns } from 'node:dns';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * SSRF-safe GETs and link probes on hosts someone else named (program pages): https on 443, every
 * resolved address public, the connection pinned to the vetted address, no redirects but one
 * same-site hop on a probe, 5 s for the whole fetch, a capped body. DNS goes through c-ares with
 * its own timeout. The resolver and transport are injectable, so tests never touch the network.
 */

export class SafeFetchError extends Error {}

/**
 * A probe's non-2xx (and non-3xx) answer, with its status, so a caller can tell a bot wall (401, 403,
 * 429) from a missing page.
 */
export class HttpStatusError extends SafeFetchError {
  constructor(readonly status: number) {
    super(`answered ${status}, not 2xx`);
  }
}

/**
 * The fetch could not be made: DNS, connect, the deadline, or a 5xx (v6.1.15 Task 14 fix round 2). Every other
 * refusal is a definitive answer from the host. Same messages as before.
 */
export class TransportError extends SafeFetchError {}

/** A 3xx response: the status and, when the server sent one, the Location header. */
export class RedirectError extends SafeFetchError {
  constructor(
    readonly status: number,
    readonly location?: string,
  ) {
    super(`redirects aren't followed (${status})`);
  }
}

type Resolved = { address: string; family: 4 | 6 };
/** Resolves `host` to its addresses; must stop when `signal` aborts (the overall deadline). */
export type Resolver = (
  host: string,
  signal: AbortSignal,
) => Promise<Resolved[]>;
type TransportResponse = {
  status: number;
  /** content-length, when the server sent one. */
  contentLength?: number;
  /** content-type, when the server sent one, a probe scans only HTML. */
  contentType?: string;
  location?: string;
  body: AsyncIterable<Uint8Array>;
  /** Releases the connection (called once the body is read or refused). */
  close?: () => void;
};
/** Connects to `address` (already vetted) while speaking TLS and HTTP to `url.hostname`. */
export type Transport = (req: {
  url: URL;
  address: string;
  family: 4 | 6;
  signal: AbortSignal;
  /** Default EarnKit-verifier/1. */
  userAgent?: string;
  /** The Accept header; default text/plain (a probe asks for HTML, PROBE_ACCEPT). */
  accept?: string;
}) => Promise<TransportResponse>;

/** A link check: resolves when the URL loads, throws when it doesn't (safeProbe, or a test's fake). */
export type Probe = (url: string) => Promise<void>;

export const FETCH_TIMEOUT_MS = 5_000;
const FETCH_MAX_BYTES = 4_096;
/** How much of a live link's page a probe reads (the rest is never read). */
const PROBE_MAX_BYTES = 65_536;
/** A page's <title> is cut to this many characters (security M4). */
export const TITLE_MAX = 200;

/**
 * A page title as third-party text (security M4, ruling M4a): tags and control or format characters (bidi overrides
 * among them) removed, whitespace folded, cut to TITLE_MAX. The one place a title is cut. Never refused for naming a
 * domain: the row note "text from the site, not an instruction" covers what it says. Pure.
 */
export function cleanTitle(raw: string): string {
  const flat = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').replace(/\p{C}/gu, '').replace(/ {2,}/g, ' ').trim();
  return [...flat].slice(0, TITLE_MAX).join('').trim();
}
/** A page is judged for an error only when its visible text is shorter than this. */
const ERROR_TEXT_MAX = 5_000;
/** Specific error phrases only, never a bare "404" or "not found". */
const ERROR_PHRASES: RegExp[] = [
  /\b404\b[\s:|-]*not found/i, /page not found/i, /NOT_FOUND/, /DEPLOYMENT_NOT_FOUND/,
  /There isn't a GitHub Pages site here/i, /Application failed to respond/i, /application error/i,
  /failed to fetch/i, /Internal Server Error/i, /Bad Gateway/i, /Cannot GET \//, /Site not found/i,
  /This page could not be found/i,
];
/**
 * v6.1.17 Task 3 (L30-8): a program link is down too when its page says the domain is parked for sale or the page is
 * gone. Program links only (probeLink); a builder's live link keeps ERROR_PHRASES alone.
 */
const PROGRAM_ERROR_PHRASES: RegExp[] = [
  ...ERROR_PHRASES,
  /\b(domain|[\w-]+\.[a-z]{2,})\s+is for sale\b/i, /\bbuy this domain\b/i,
  // Fix round 1 (N1): two more parking wordings.
  /\bmay be for sale\b/i, /\bavailable for purchase\b/i,
  /could not find that page/i, /\bno longer available\b/i,
];
/** The Accept header of live-link probes: HTML first, anything else accepted. */
const PROBE_ACCEPT = 'text/html,*/*;q=0.8';

/**
 * A probe scans only an HTML response: content-type text/html, or a body whose first
 * non-space text is `<!doctype` or `<html`. JSON and other API bodies pass on any 2xx. Pure.
 */
function isHtmlResponse(contentType: string | undefined, body: string): boolean {
  if (contentType && /^\s*text\/html\b/i.test(contentType)) return true;
  return /^\s*<(!doctype|html)\b/i.test(body.replace(/^\uFEFF/, ''));
}

/** A live link that loads but shows an error page; `phrase` is the error text it shows. */
class ErrorPageError extends SafeFetchError {
  constructor(readonly phrase: string) {
    super(`shows an error page (${phrase})`);
    this.name = 'ErrorPageError';
  }
}

/**
 * The page's <title> and its visible text (comments, scripts, styles and tags removed, whitespace
 * folded). A probe reads only the first 64 KB, so the cut can land inside a script (a
 * Next.js RSC chunk holds the default "This page could not be found." tree on every page), a comment
 * or a tag: what is left open at the end is dropped too, never read as visible text. Pure.
 */
export function visibleText(html: string): { title: string; text: string } {
  const title = cleanTitle(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const text = html
    .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?(<\/\1\s*>|$)/gi, ' ')
    .replace(/<[^>]*$/, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, text };
}

/**
 * The error phrase a short page shows (its title first, else the first matching
 * sentence of its visible text, at most 80 characters), or null. Only pages whose visible text is
 * under 5 KB are judged, so a real page that mentions "404" passes. No JS runs, so an error drawn
 * by client JS isn't seen. Pure.
 */
function errorPageText(html: string, phrases: RegExp[] = ERROR_PHRASES): string | null {
  const { title, text } = visibleText(html);
  if (text.length >= ERROR_TEXT_MAX) return null;
  if (phrases.some((re) => re.test(title))) return title.slice(0, 80);
  const hit = phrases.map((re) => text.match(re)).find(Boolean);
  if (!hit) return null;
  const at = hit.index ?? 0;
  const start = Math.max(0, text.lastIndexOf('.', at) + 1);
  return text.slice(start, start + 80).trim();
}

// IANA special-purpose IPv4 (RFC 6890 and successors): never a program's website.
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. cloud metadata 169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.31.196.0', 24], // AS112
  ['192.52.193.0', 24], // AMT
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['192.175.48.0', 24], // AS112
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];
const v4Blocked = new BlockList();
for (const [net, bits] of BLOCKED_V4) v4Blocked.addSubnet(net, bits, 'ipv4');

// IPv6: only global unicast (2000::/3) is allowed. That alone refuses ::, ::1, IPv4-mapped
// (::ffff:0:0/96) and -compatible addresses, NAT64 (64:ff9b::/96), link-local (fe80::/10),
// unique-local (fc00::/7) and multicast (ff00::/8). Inside 2000::/3, refuse the special ranges.
const v6Global = new BlockList();
v6Global.addSubnet('2000::', 3, 'ipv6');
const v6Blocked = new BlockList();
for (const [net, bits] of [
  ['2001::', 23], // IETF protocol assignments (Teredo 2001::/32, benchmarking, ORCHID)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: embeds an IPv4 address
  ['3fff::', 20], // documentation
] as [string, number][])
  v6Blocked.addSubnet(net, bits, 'ipv6');

/** Whether `ip` is a public unicast address EarnKit may connect to. Pure. */
function isPublicAddress(ip: string): boolean {
  // Zone ids (fe80::1%eth0) are only for local scopes.
  if (ip.includes('%')) return false;
  const v = isIP(ip);
  if (v === 4) return !v4Blocked.check(ip, 'ipv4');
  if (v === 6)
    return v6Global.check(ip, 'ipv6') && !v6Blocked.check(ip, 'ipv6');
  return false;
}

const DNS_TIMEOUT_MS = 2_000;

// "No such name" and "no records of this type": an empty answer, not a failure.
const NO_ANSWER = new Set([dns.NODATA, dns.NOTFOUND]);

/**
 * Combines parallel A and AAAA lookups. An A answer that is non-empty and all public is used as
 * soon as it arrives, without waiting for AAAA (IPv4 is also what the connection prefers). Else
 * both are awaited and every address is returned for safeFetchText to vet: "no such name/no
 * records" counts as empty; both failing otherwise is an error.
 */
async function resolveBoth(
  v4: Promise<string[]>,
  v6: Promise<string[]>,
): Promise<Resolved[]> {
  const as = (family: 4 | 6) => (list: string[]) =>
    list.map((address) => ({ address, family }));
  const settled = (p: Promise<string[]>) =>
    p.then(
      (value) => ({ ok: true as const, value }),
      (reason) => ({ ok: false as const, reason }),
    );
  // Settled handlers on both before awaiting either, so a late AAAA rejection (e.g. cancelled
  // after a safe A answer) is never unhandled.
  const aaaaSettled = settled(v6);
  const a = await settled(v4);
  if (a.ok && a.value.length > 0 && a.value.every(isPublicAddress))
    return as(4)(a.value);
  const aaaa = await aaaaSettled;
  const failed = [a, aaaa].flatMap((x) =>
    !x.ok && !NO_ANSWER.has(x.reason?.code) ? [x.reason] : [],
  );
  if (failed.length === 2) throw failed[0];
  return [
    ...(a.ok ? as(4)(a.value) : []),
    ...(aaaa.ok ? as(6)(aaaa.value) : []),
  ];
}

/**
 * A/AAAA through c-ares (`dns.promises.Resolver`), not `dns.lookup`: getaddrinfo runs on libuv's
 * 4-thread pool and can't be cancelled, so a few black-holed nameservers would stall every other
 * lookup, fs and crypto call in the process. This one has its own timeout and
 * `tries`, is cancelled when the overall deadline aborts, and stops waiting for AAAA once a safe
 * A answer is in (resolveBoth; the pending query is then cancelled).
 */
const defaultResolver: Resolver = async (host, signal) => {
  const r = new dns.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  const cancel = () => r.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await resolveBoth(r.resolve4(host), r.resolve6(host));
  } finally {
    signal.removeEventListener('abort', cancel);
    r.cancel();
  }
};

/**
 * A `lookup` for node's net/tls that always answers with the vetted address, so the socket goes
 * there while `host` (and so SNI, certificate check and the Host header) stays the hostname.
 * Handles both call shapes (`all: true` is used by autoSelectFamily).
 */
function pinnedLookup(address: string, family: 4 | 6) {
  return (
    _host: string,
    options: unknown,
    cb?: (...args: unknown[]) => void,
  ) => {
    const done = (typeof options === 'function' ? options : cb) as (
      ...args: unknown[]
    ) => void;
    const all =
      typeof options === 'object' &&
      options !== null &&
      (options as { all?: boolean }).all;
    if (all) done(null, [{ address, family }]);
    else done(null, address, family);
  };
}

/**
 * The https.request options for one vetted fetch (nodeTransport). Pure.
 */
function requestOptions({ url, address, family, signal, userAgent, accept }: Parameters<Transport>[0]): https.RequestOptions {
  return {
    protocol: 'https:',
    hostname: url.hostname,
    port: 443,
    // The query too (image links such as /_next/image?url=... need it).
    path: url.pathname + url.search,
    method: 'GET',
    // TLS to the hostname (SNI + certificate verified against it); the socket goes to the
    // vetted address only.
    servername: url.hostname,
    lookup: pinnedLookup(address, family) as never,
    // A fresh connection: never a pooled socket to some other address.
    agent: false,
    signal,
    headers: {
      accept: accept ?? 'text/plain',
      'user-agent': userAgent ?? 'EarnKit-verifier/1',
    },
  };
}

const nodeTransport: Transport = (req0) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      requestOptions(req0),
      (res) => {
        const length = Number(res.headers['content-length']);
        const type = res.headers['content-type'];
        resolve({
          status: res.statusCode ?? 0,
          ...(Number.isFinite(length) && { contentLength: length }),
          ...(typeof type === 'string' && { contentType: type }),
          ...(typeof res.headers.location === 'string' && {
            location: res.headers.location,
          }),
          body: res,
          close: () => res.destroy(),
        });
      },
    );
    req.on('error', reject);
    req.end();
  });

type FetchOpts = {
  resolve?: Resolver;
  transport?: Transport;
  timeoutMs?: number;
  maxBytes?: number;
  /**
   * Accept any 2xx, ask for HTML and read at most PROBE_MAX_BYTES of the body, never failing on
   * size (safeProbe). Returns that HTML, or '' when the response isn't HTML.
   */
  probe?: boolean;
  userAgent?: string;
  /** The Accept header (default text/plain; a probe always asks for HTML). */
  accept?: string;
};

/**
 * Fetches `url` and returns its body as text, or throws `SafeFetchError` saying why not. Never
 * follows a redirect and never connects to a non-public address.
 */
async function safeFetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const { body, contentType } = await safeFetch(url, opts);
  const text = body.toString('utf8');
  if (opts.probe) return isHtmlResponse(contentType, text) ? text : '';
  return text;
}

/** The guarded GET behind safeFetchText. */
async function safeFetch(
  url: string,
  {
    resolve = defaultResolver,
    transport = nodeTransport,
    timeoutMs = FETCH_TIMEOUT_MS,
    maxBytes = FETCH_MAX_BYTES,
    probe = false,
    userAgent,
    accept,
  }: FetchOpts,
): Promise<{ body: Buffer; contentType?: string }> {
  if (!URL.canParse(url)) throw new SafeFetchError('not a valid link');
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new SafeFetchError('https only');
  if (u.port !== '') throw new SafeFetchError('port 443 only');
  if (u.username || u.password)
    throw new SafeFetchError('no user or password in the link');
  // A domain name only: TLS needs a name to check the certificate against.
  if (isIP(u.hostname.replace(/^\[(.*)\]$/, '$1')))
    throw new SafeFetchError('use a domain name, not an IP address');

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TransportError(`no answer within ${timeoutMs / 1000} s`));
    }, timeoutMs);
  });
  let close: (() => void) | undefined;
  const run = async () => {
    const addresses = await resolve(u.hostname, controller.signal);
    if (addresses.length === 0)
      throw new TransportError(`${u.hostname} doesn't resolve`);
    // Every address must be public, so no answer in the set can point inside.
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad)
      // The address itself isn't echoed: that would map private networks for anyone.
      throw new SafeFetchError(
        `${u.hostname} doesn't point to a public address`,
      );
    // IPv4 first: some egress hosts have no IPv6 route.
    const first = addresses.find((a) => a.family === 4) ?? addresses[0];
    const res = await transport({
      url: u,
      address: first.address,
      family: first.family,
      signal: controller.signal,
      userAgent,
      ...(probe ? { accept: PROBE_ACCEPT } : accept && { accept }),
    });
    close = res.close;
    if (res.status >= 300 && res.status < 400)
      throw new RedirectError(res.status, res.location);
    if (probe) {
      if (res.status < 200 || res.status >= 300)
        throw new HttpStatusError(res.status);
      // The start of the page, to tell a real page from an error page. Reading
      // stops at PROBE_MAX_BYTES (or the deadline); a larger page is judged on what was read.
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        if (controller.signal.aborted) break;
        const part = chunk.subarray(0, PROBE_MAX_BYTES - size);
        chunks.push(part);
        size += part.byteLength;
        if (size >= PROBE_MAX_BYTES) break;
      }
      return { body: Buffer.concat(chunks), contentType: res.contentType };
    }
    if (res.status !== 200)
      throw new (res.status >= 500 ? TransportError : SafeFetchError)(`answered ${res.status}, not 200`);
    if (res.contentLength !== undefined && res.contentLength > maxBytes)
      throw new SafeFetchError(`larger than ${maxBytes} bytes`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.byteLength;
      if (size > maxBytes)
        throw new SafeFetchError(`larger than ${maxBytes} bytes`);
      chunks.push(chunk);
    }
    return { body: Buffer.concat(chunks), contentType: res.contentType };
  };
  try {
    return await Promise.race([run(), timeout]);
  } catch (err) {
    controller.abort();
    if (err instanceof SafeFetchError) throw err;
    throw new TransportError(
      `couldn't fetch it (${(err instanceof Error ? err.message : String(err)).slice(0, 120)})`,
    );
  } finally {
    clearTimeout(timer);
    close?.();
  }
}

/** Same site for a redirect: the same host, ignoring one leading "www.". Pure. */
const sameSite = (a: string, b: string) =>
  a.replace(/^www\./, '') === b.replace(/^www\./, '');

/** The User-Agent of live-link checks (sites that refuse unnamed clients see who is asking). */
const LINKCHECK_UA = 'EarnKit-linkcheck/1';

/**
 * Whether a builder's live link loads: any 2xx whose first 64 KB isn't an error page (`ErrorPageError`
 * with the phrase it shows; only an HTML response is scanned). Follows one redirect within the same site
 * (apex↔www, a path change); refuses a redirect elsewhere or a second redirect.
 */
export async function safeProbe(
  url: string,
  deps: { resolve?: Resolver; transport?: Transport; timeoutMs?: number } = {},
): Promise<void> {
  await safeProbePage(url, deps);
}

/** safeProbe, returning the first 64 KB of the page it read ('' when it isn't HTML). */
export async function safeProbePage(
  url: string,
  deps: { resolve?: Resolver; transport?: Transport; timeoutMs?: number } = {},
): Promise<string> {
  const opts = { ...deps, probe: true, userAgent: LINKCHECK_UA };
  let page: string;
  try {
    page = await safeFetchText(url, opts);
  } catch (err) {
    if (!(err instanceof RedirectError) || !err.location) throw err;
    const next = new URL(err.location, url);
    if (!sameSite(next.hostname, new URL(url).hostname))
      throw new SafeFetchError(`redirects to another site (${next.hostname})`);
    page = await safeFetchText(next.href, opts);
  }
  const phrase = errorPageText(page);
  if (phrase) throw new ErrorPageError(phrase);
  return page;
}

/**
 * A program link's answer for the daily stale check (v6.1.16 Task 16, L30-2): alive, or dead and why. `redirect` names
 * the other host a 3xx pointed to (never followed); `page` is the first 64 KB of an HTML page that loaded ('' otherwise).
 */
export type ProbeResult = { ok: true; redirect?: string; page?: string } | { ok: false; why: '4xx' | '5xx' | 'dns' | 'timeout' | 'refused' };

/** A bot wall or a sign-in still means the page exists. */
const WALLS = [401, 403, 429];

/**
 * The stale check's probe (L30-2): the same guarded GET as safeProbePage (one same-site hop), but a redirect elsewhere
 * is an answer, not a failure: `{ ok: true, redirect: host }`, and the redirect is never requested (the SSRF rule
 * stands). A 3xx with no Location, a second redirect, 401, 403 and 429 are alive too. Only a 4xx (or an error page,
 * which for a program link includes a parked domain for sale and a soft 404, v6.1.17 L30-8),
 * a 5xx, a name that does not resolve, the deadline (`timeoutMs`) and a refused connection or address count as dead.
 * The builder live-link reader keeps safeProbePage's rule. Never throws.
 */
export async function probeLink(
  url: string,
  deps: { resolve?: Resolver; transport?: Transport; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const opts = { ...deps, probe: true, userAgent: LINKCHECK_UA };
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  const read = async (target: string): Promise<ProbeResult> => {
    const page = await safeFetchText(target, opts);
    return errorPageText(page, PROGRAM_ERROR_PHRASES) ? { ok: false, why: '4xx' } : { ok: true, page };
  };
  const redirected = (err: RedirectError, from: string): ProbeResult | URL => {
    if (!err.location || !URL.canParse(err.location, from)) return { ok: true };
    const next = new URL(err.location, from);
    return sameSite(next.hostname, host) ? next : { ok: true, redirect: next.hostname };
  };
  try {
    try {
      return await read(url);
    } catch (err) {
      if (!(err instanceof RedirectError)) throw err;
      const next = redirected(err, url);
      if (!(next instanceof URL)) return next;
      try {
        return await read(next.href);
      } catch (err2) {
        // A second redirect is not followed either; the host answered, so the link is alive.
        if (!(err2 instanceof RedirectError)) throw err2;
        const again = redirected(err2, next.href);
        return again instanceof URL ? { ok: true } : again;
      }
    }
  } catch (err) {
    return deadWhy(err);
  }
}

/** Why a probe failed, in the stale check's words. Pure. */
function deadWhy(err: unknown): ProbeResult {
  if (err instanceof HttpStatusError) return WALLS.includes(err.status) ? { ok: true } : { ok: false, why: err.status >= 500 ? '5xx' : '4xx' };
  const msg = err instanceof Error ? err.message : '';
  if (/no answer within/.test(msg)) return { ok: false, why: 'timeout' };
  if (/doesn't resolve|ENOTFOUND|ENODATA|EAI_AGAIN|queryA|queryAaaa/.test(msg)) return { ok: false, why: 'dns' };
  return { ok: false, why: 'refused' };
}

/** The most a JSON document may be (an OAuth client ID metadata document, v6.1.15 Task 14). */
export const JSON_MAX_BYTES = 10_240;

/**
 * Fetches a small JSON document (v6.1.15 Task 14: an OAuth client ID metadata document) and returns it parsed. The same
 * guarded GET as every other fetch here: https on 443, every resolved address public, the connection pinned to it, 5 s
 * for the whole fetch. Any 3xx throws `RedirectError` and is never followed (no second request; safeProbePage's
 * same-site hop is not on this path). A body over `maxBytes` (default 10,240), a content type that is not
 * application/json (parameters allowed), or invalid JSON throws `SafeFetchError`.
 */
export async function safeFetchJson(
  url: string,
  deps: { resolve?: Resolver; transport?: Transport; timeoutMs?: number; maxBytes?: number } = {},
): Promise<unknown> {
  const { body, contentType } = await safeFetch(url, {
    ...deps,
    maxBytes: deps.maxBytes ?? JSON_MAX_BYTES,
    accept: 'application/json',
    userAgent: 'EarnKit-oauth/1',
  });
  if (!contentType || !/^\s*application\/json\s*(;|$)/i.test(contentType)) throw new SafeFetchError('not a JSON document');
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new SafeFetchError('not valid JSON');
  }
}
