import { promises as dns } from 'node:dns';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * An SSRF-safe GET for one small text file on a host someone else named (a sponsor's domain).
 * https only, port 443; the name is resolved once and every address must be public (no
 * private, loopback, link-local, multicast or reserved IPv4/IPv6, incl. IPv4-mapped IPv6); the
 * connection goes to that vetted address while TLS (SNI + certificate check) and the Host header
 * keep the hostname; no redirects (any 3xx fails); 5 s for the whole fetch; a 4 KB body cap.
 *
 * DNS goes through c-ares with its own timeout, cancelled at the deadline (never `dns.lookup`).
 * The resolver and transport are injectable so the guard is tested without the network.
 */

export class SafeFetchError extends Error {}

/** A 3xx response: the status and, when the server sent one, the Location header. */
export class RedirectError extends SafeFetchError {
  constructor(
    readonly status: number,
    readonly location?: string,
  ) {
    super(`redirects aren't followed (${status})`);
  }
}

export type Resolved = { address: string; family: 4 | 6 };
/** Resolves `host` to its addresses; must stop when `signal` aborts (the overall deadline). */
export type Resolver = (
  host: string,
  signal: AbortSignal,
) => Promise<Resolved[]>;
export type TransportResponse = {
  status: number;
  /** content-length, when the server sent one. */
  contentLength?: number;
  /** content-type, when the server sent one (v2.10: a probe scans only HTML). */
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

export const FETCH_TIMEOUT_MS = 5_000;
export const FETCH_MAX_BYTES = 4_096;
/**
 * A larger body cap for fetching a whole public HTML page (e.g. a builder bonus submission proof
 * page: a DoraHacks BUIDL and the like run well past 4 KB) rather than a small text file like
 * earnkit.txt or a sponsor's earnkit.txt verification. Passed explicitly as `maxBytes`; the
 * default stays `FETCH_MAX_BYTES` for every existing caller.
 */
export const LARGE_PAGE_MAX_BYTES = 512_000;
/** v2.10 item 14: how much of a live link's page a probe reads (the rest is never read). */
export const PROBE_MAX_BYTES = 65_536;
/** v2.10 item 14: a page is judged for an error only when its visible text is shorter than this. */
export const ERROR_TEXT_MAX = 5_000;
/** v2.10 item 14 (Ruling H4): specific error phrases only, never a bare "404" or "not found". */
const ERROR_PHRASES: RegExp[] = [
  /\b404\b[\s:|-]*not found/i, /page not found/i, /NOT_FOUND/, /DEPLOYMENT_NOT_FOUND/,
  /There isn't a GitHub Pages site here/i, /Application failed to respond/i, /application error/i,
  /failed to fetch/i, /Internal Server Error/i, /Bad Gateway/i, /Cannot GET \//, /Site not found/i,
  /This page could not be found/i,
];
/** The Accept header of live-link probes (Ruling H4): HTML first, anything else accepted. */
export const PROBE_ACCEPT = 'text/html,*/*;q=0.8';

/**
 * Ruling H4: a probe scans only an HTML response: content-type text/html, or a body whose first
 * non-space text is `<!doctype` or `<html`. JSON and other API bodies pass on any 2xx. Pure.
 */
export function isHtmlResponse(contentType: string | undefined, body: string): boolean {
  if (contentType && /^\s*text\/html\b/i.test(contentType)) return true;
  return /^\s*<(!doctype|html)\b/i.test(body.replace(/^\uFEFF/, ''));
}

/** A live link that loads but shows an error page; `phrase` is the error text it shows. */
export class ErrorPageError extends SafeFetchError {
  constructor(readonly phrase: string) {
    super(`shows an error page (${phrase})`);
    this.name = 'ErrorPageError';
  }
}

/**
 * The page's <title> and its visible text (comments, scripts, styles and tags removed, whitespace
 * folded). Final fix M1: a probe reads only the first 64 KB, so the cut can land inside a script (a
 * Next.js RSC chunk holds the default "This page could not be found." tree on every page), a comment
 * or a tag: what is left open at the end is dropped too, never read as visible text. Pure.
 */
export function visibleText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
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
 * v2.10 item 14: the error phrase a short page shows (its title first, else the first matching
 * sentence of its visible text, at most 80 characters), or null. Only pages whose visible text is
 * under 5 KB are judged, so a real page that mentions "404" passes. No JS runs, so an error drawn
 * by client JS isn't seen. Pure.
 */
export function errorPageText(html: string): string | null {
  const { title, text } = visibleText(html);
  if (text.length >= ERROR_TEXT_MAX) return null;
  if (ERROR_PHRASES.some((re) => re.test(title))) return title.slice(0, 80);
  const hit = ERROR_PHRASES.map((re) => text.match(re)).find(Boolean);
  if (!hit) return null;
  const at = hit.index ?? 0;
  const start = Math.max(0, text.lastIndexOf('.', at) + 1);
  return text.slice(start, start + 80).trim();
}

// IANA special-purpose IPv4 (RFC 6890 and successors): never a sponsor's website.
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

/** Whether `ip` is a public unicast address EarnKit may connect to. Pure; exported for tests. */
export function isPublicAddress(ip: string): boolean {
  // Zone ids (fe80::1%eth0) are only for local scopes.
  if (ip.includes('%')) return false;
  const v = isIP(ip);
  if (v === 4) return !v4Blocked.check(ip, 'ipv4');
  if (v === 6)
    return v6Global.check(ip, 'ipv6') && !v6Blocked.check(ip, 'ipv6');
  return false;
}

export const DNS_TIMEOUT_MS = 2_000;

// "No such name" and "no records of this type": an empty answer, not a failure.
const NO_ANSWER = new Set([dns.NODATA, dns.NOTFOUND]);

/**
 * Combines parallel A and AAAA lookups. An A answer that is non-empty and all public is used as
 * soon as it arrives, without waiting for AAAA (IPv4 is also what the connection prefers). Else
 * both are awaited and every address is returned for safeFetchText to vet: "no such name/no
 * records" counts as empty; both failing otherwise is an error. Exported for tests.
 */
export async function resolveBoth(
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
 * lookup, fs and crypto call in the process (review I5). This one has its own timeout and
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
 * Handles both call shapes (`all: true` is used by autoSelectFamily). Exported for tests.
 */
export function pinnedLookup(address: string, family: 4 | 6) {
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
 * The https.request options for one vetted fetch (nodeTransport). Pure; exported so the request
 * line (v2.10 item 12: the path keeps the query) is pinned by a test.
 */
export function requestOptions({ url, address, family, signal, userAgent, accept }: Parameters<Transport>[0]): https.RequestOptions {
  return {
    protocol: 'https:',
    hostname: url.hostname,
    port: 443,
    // v2.10 item 12: the query too (image links such as /_next/image?url=... need it).
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
   * size (safeProbe). Returns that HTML, or '' when the response isn't HTML (Ruling H4).
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
export async function safeFetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const { body, contentType } = await safeFetch(url, opts);
  const text = body.toString('utf8');
  if (opts.probe) return isHtmlResponse(contentType, text) ? text : '';
  return text;
}

/** v2.10 item 12: the Accept header of an image read (only these types are ever kept). */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
export const IMAGE_MAX_BYTES = 1_000_000;

/**
 * v2.10 item 12: one image as bytes, under the same SSRF rules as `safeFetchText` (https on 443, a
 * domain name, every resolved address public, no redirects, 200 only, the deadline); 1 MB by
 * default. The caller checks the bytes (tokens.ts imageTypeOf); the declared type isn't trusted.
 */
export async function safeFetchBytes(
  url: string,
  opts: { maxBytes?: number; resolve?: Resolver; transport?: Transport; timeoutMs?: number } = {},
): Promise<Buffer> {
  return (await safeFetch(url, { maxBytes: IMAGE_MAX_BYTES, ...opts, accept: IMAGE_ACCEPT })).body;
}

/** The shared guarded GET behind safeFetchText and safeFetchBytes. */
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
      reject(new SafeFetchError(`no answer within ${timeoutMs / 1000} s`));
    }, timeoutMs);
  });
  let close: (() => void) | undefined;
  const run = async () => {
    const addresses = await resolve(u.hostname, controller.signal);
    if (addresses.length === 0)
      throw new SafeFetchError(`${u.hostname} doesn't resolve`);
    // Every address must be public, so no answer in the set can point inside.
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad)
      // The address itself isn't echoed: that would map private networks for anyone (review m1).
      throw new SafeFetchError(
        `${u.hostname} doesn't point to a public address`,
      );
    // IPv4 first: some egress hosts have no IPv6 route (review m4).
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
        throw new SafeFetchError(`answered ${res.status}, not 2xx`);
      // v2.10 item 14: the start of the page, to tell a real page from an error page. Reading
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
      throw new SafeFetchError(`answered ${res.status}, not 200`);
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
    throw new SafeFetchError(
      `couldn't fetch it (${(err instanceof Error ? err.message : String(err)).slice(0, 120)})`,
    );
  } finally {
    clearTimeout(timer);
    close?.();
  }
}

/** Same site for a redirect: the same host, ignoring one leading "www.". Pure; exported for tests. */
export const sameSite = (a: string, b: string) =>
  a.replace(/^www\./, '') === b.replace(/^www\./, '');

/** The User-Agent of live-link checks (sites that refuse unnamed clients see who is asking). */
export const LINKCHECK_UA = 'EarnKit-linkcheck/1';

/**
 * Whether a builder's live link loads: any 2xx whose first 64 KB isn't an error page (v2.10 item
 * 14: `ErrorPageError` with the phrase it shows; only an HTML response is scanned, Ruling H4). Follows one redirect within the same site
 * (apex↔www, a path change); refuses a redirect elsewhere or a second redirect.
 */
export async function safeProbe(
  url: string,
  deps: { resolve?: Resolver; transport?: Transport; timeoutMs?: number } = {},
): Promise<void> {
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
}
