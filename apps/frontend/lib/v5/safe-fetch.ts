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
  /**
   * v3.8 G-A: `wall` names the bot wall the answer is (a WAF or CAPTCHA challenge page, `wallMarker`), when it is one,
   * so a 405 "Human Verification" page reads as a wall like a 403, not as a missing page.
   */
  constructor(
    readonly status: number,
    readonly wall: string | null = null,
  ) {
    super(wall ? `answered ${status}, a bot check (${wall})` : `answered ${status}, not 2xx`);
  }
}

/**
 * v3.8 G-A: the official page is behind a bot wall even after the reader's second try (VERIFIER_BROWSER_UA): its status
 * and the wall it showed. The page exists; its text could not be read.
 */
export class PageBlockedError extends HttpStatusError {}

/**
 * The fetch could not be made: DNS, connect, the deadline, or a 5xx (v6.1.15 Task 14 fix round 2). Every other
 * refusal is a definitive answer from the host. Same messages as before.
 */
export class TransportError extends SafeFetchError {}

/**
 * v3.8 G-A: the page answered 5xx. `html` is what it sent (a framework's error shell can still carry the page's data,
 * official-page.ts reads it), '' when that was not HTML.
 */
export class PageShellError extends TransportError {
  constructor(
    readonly status: number,
    readonly html: string,
  ) {
    super(`answered ${status}, not 200`);
  }
}

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
  /** Default VERIFIER_UA. */
  userAgent?: string;
  /** The Accept header; default text/plain (a probe asks for HTML, PROBE_ACCEPT). */
  accept?: string;
}) => Promise<TransportResponse>;

/** A link check: resolves when the URL loads, throws when it doesn't (safeProbe, or a test's fake). */
export type Probe = (url: string) => Promise<void>;

export const FETCH_TIMEOUT_MS = 5_000;
const FETCH_MAX_BYTES = 4_096;
/**
 * v3.8 G-A: how much of an official page the reader reads (safeReadPage): the whole page, up to this hard cap. The
 * quotes are searched in all of it (Ink Spark's amounts sit past 64 KB, Devpost's past 80 KB).
 */
export const PAGE_MAX_BYTES = 4 * 1024 * 1024;
/** v3.8 G-A: the deadline for one page read (one rung of the reader's ladder, its one same-site hop included). */
export const PAGE_TIMEOUT_MS = 10_000;
/** How much of a non-2xx probe answer is read to tell a bot wall from an error. */
const WALL_SNIFF_BYTES = 16_384;

/**
 * v3.8 G-A: the reader's user agents. The first try names EarnKit plainly; on a bot wall the reader tries once more
 * as a browser that still names EarnKit-verifier and links the page saying what it is (/docs#verifier). A full fake
 * browser string was refused by Devpost's wall where the plain one passed, so the plain one goes first. GET only.
 */
export const VERIFIER_UA = 'Mozilla/5.0 (compatible; EarnKit-verifier/1; +https://earnkit.com/docs#verifier)';
export const VERIFIER_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (compatible; EarnKit-verifier/1; +https://earnkit.com/docs#verifier)';
/** The statuses a bot wall answers with: the reader's second try follows one of these, or a challenge page. */
const WALL_STATUSES = [403, 405, 429];
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

/**
 * Challenge pages of the common bot walls: AWS WAF (DoraHacks, Binance), Cloudflare (Devpost), DataDome, Imperva,
 * PerimeterX. Judged only on a short page (wallMarker), since a real page can load a wall's script too.
 */
const WALL_MARKERS: [RegExp, string][] = [
  [/<title>\s*Human Verification\s*<\/title>/i, 'Human Verification'],
  [/AwsWafIntegration|awsWafCookieDomainList|captcha\.awswaf\.com|token\.awswaf\.com/i, 'AWS WAF'],
  [/<title>\s*Just a moment\.\.\.\s*<\/title>|\bcf_chl_opt\b|challenges\.cloudflare\.com|Attention Required! \| Cloudflare/i, 'Cloudflare'],
  [/captcha-delivery\.com/i, 'DataDome'],
  [/_Incapsula_Resource|Incapsula incident/i, 'Imperva'],
  [/px-captcha|perimeterx/i, 'PerimeterX'],
];

/**
 * The bot wall a response is, or null (v3.8 G-A): a short page (visible text under ERROR_TEXT_MAX) carrying a wall's
 * challenge markers, or a 202 with a short page (Binance's WAF answers 202 with a challenge and no content). Pure.
 */
export function wallMarker(status: number, html: string): string | null {
  if (visibleText(html).text.length >= ERROR_TEXT_MAX) return null;
  const hit = WALL_MARKERS.find(([re]) => re.test(html));
  if (hit) return hit[1];
  return status === 202 ? 'a 202 challenge' : null;
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
export function visibleText(html: string, opts: { dropHidden?: boolean; joinInline?: boolean } = {}): { title: string; text: string } {
  const title = cleanTitle(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const shown = html
    .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?(<\/\1\s*>|$)/gi, ' ');
  const kept = opts.dropHidden ? dropHiddenElements(shown) : shown;
  // v3.8 G-A: inline tags join their text as a browser shows it (Devpost's `$<span>10,000</span>` reads "$10,000"), after
  // hidden elements are gone; every other tag still separates words.
  const text = (opts.joinInline ? kept.replace(INLINE_TAG, '') : kept)
    .replace(/<[^>]*$/, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, text };
}

/** An opening or closing tag of an element a browser draws inline, inside the line (`visibleText`'s `joinInline`). */
const INLINE_TAG = /<\/?(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|font|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;

/** Elements with no content (an `<input type="hidden">` hides nothing else). */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Whether an opening tag's attributes hide the element: `hidden`, `aria-hidden="true"`, or a display:none or visibility:hidden style. Pure. */
function hidesElement(attrs: string): boolean {
  const names = attrs.replace(/=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, '=');
  if (/(^|\s)hidden(=|\s|\/|$)/i.test(names)) return true;
  if (/aria-hidden\s*=\s*["']?\s*true\b/i.test(attrs)) return true;
  return /\bstyle\s*=\s*("[^"]*(display\s*:\s*none|visibility\s*:\s*hidden)[^"]*"|'[^']*(display\s*:\s*none|visibility\s*:\s*hidden)[^']*')/i.test(attrs);
}

/**
 * v6.1.19 (L44-7): the HTML without the elements a reader never sees (`hidesElement`), each with everything inside it,
 * nested elements of the same name counted; one never closed hides the rest of the page. Pure.
 */
function dropHiddenElements(html: string): string {
  // Fix round 1 (M2): a `>` inside a quoted attribute value does not end the tag.
  const open = /<([a-z][\w-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  let out = '';
  let from = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const name = m[1].toLowerCase();
    if (VOID_TAGS.has(name) || m[2].trim().endsWith('/') || !hidesElement(m[2])) continue;
    const tag = new RegExp(`<(/?)${name}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, 'gi');
    tag.lastIndex = open.lastIndex;
    let depth = 1;
    let end = html.length;
    for (let t = tag.exec(html); t; t = tag.exec(html)) {
      if (t[1] && --depth === 0) {
        end = tag.lastIndex;
        break;
      }
      if (!t[1] && !t[0].endsWith('/>')) depth++;
    }
    out += html.slice(from, m.index) + ' ';
    from = end;
    open.lastIndex = end;
  }
  return out + html.slice(from);
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
 * The https.request options for one vetted fetch (nodeTransport): always GET, never HEAD (v3.8 G-A; exported for that
 * test). Pure.
 */
export function requestOptions({ url, address, family, signal, userAgent, accept }: Parameters<Transport>[0]): https.RequestOptions {
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
      'user-agent': userAgent ?? VERIFIER_UA,
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
  /**
   * v3.8 G-A (safeReadPage): any 2xx, 4xx or 5xx answer is returned with its status, the body read up to `maxBytes`
   * (cut there, never refused for size). A 3xx still throws RedirectError.
   */
  page?: boolean;
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
    page = false,
    userAgent,
    accept,
  }: FetchOpts,
): Promise<{ body: Buffer; contentType?: string; status: number }> {
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
      ...(accept ? { accept } : probe || page ? { accept: PROBE_ACCEPT } : {}),
    });
    close = res.close;
    if (res.status >= 300 && res.status < 400)
      throw new RedirectError(res.status, res.location);
    /** The body up to `cap` bytes, the rest never read (or the deadline). */
    const readUpTo = async (cap: number): Promise<Buffer> => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        if (controller.signal.aborted) break;
        const part = chunk.subarray(0, cap - size);
        chunks.push(part);
        size += part.byteLength;
        if (size >= cap) break;
      }
      return Buffer.concat(chunks);
    };
    if (page) {
      if (res.status < 200) throw new HttpStatusError(res.status);
      return { body: await readUpTo(maxBytes), contentType: res.contentType, status: res.status };
    }
    if (probe) {
      // v3.8 G-A: the start of a refusal is read too, to tell a bot wall (a WAF challenge on a 405) from an error.
      if (res.status < 200 || res.status >= 300)
        throw new HttpStatusError(res.status, wallMarker(res.status, (await readUpTo(WALL_SNIFF_BYTES)).toString('utf8')));
      // The start of the page, to tell a real page from an error page. Reading
      // stops at PROBE_MAX_BYTES (or the deadline); a larger page is judged on what was read.
      return { body: await readUpTo(PROBE_MAX_BYTES), contentType: res.contentType, status: res.status };
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
    return { body: Buffer.concat(chunks), contentType: res.contentType, status: res.status };
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

/** One answer the official-page reader got: its status, its body as text, and the URL that answered. */
type PageAnswer = { status: number; text: string; contentType?: string; url: string };

/** One guarded page GET as `userAgent`, following one same-site redirect (as safeProbePage). */
async function readOnce(url: string, userAgent: string, deps: ReadPageDeps): Promise<PageAnswer> {
  const opts = {
    resolve: deps.resolve,
    transport: deps.transport,
    timeoutMs: deps.timeoutMs ?? PAGE_TIMEOUT_MS,
    maxBytes: deps.maxBytes ?? PAGE_MAX_BYTES,
    page: true,
    userAgent,
    ...(deps.accept && { accept: deps.accept }),
  };
  const get = async (at: string): Promise<PageAnswer> => {
    const { body, contentType, status } = await safeFetch(at, opts);
    return { status, text: body.toString('utf8'), contentType, url: at };
  };
  try {
    return await get(url);
  } catch (err) {
    if (!(err instanceof RedirectError) || !err.location) throw err;
    const next = new URL(err.location, url);
    if (!sameSite(next.hostname, new URL(url).hostname)) throw new SafeFetchError(`redirects to another site (${next.hostname})`);
    return get(next.href);
  }
}

export type ReadPageDeps = {
  resolve?: Resolver;
  transport?: Transport;
  /** Per try; default PAGE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Default PAGE_MAX_BYTES. */
  maxBytes?: number;
  /** The Accept header; default HTML first. A JSON read (a platform's public API, official-page.ts) asks for JSON. */
  accept?: string;
};

/** The wall an answer is, or null: a WALL_STATUSES status (named by its challenge marker when it shows one), or a challenge page at any status. */
const wallOf = (a: PageAnswer): string | null =>
  wallMarker(a.status, a.text) ?? (WALL_STATUSES.includes(a.status) ? `answered ${a.status}` : null);

/**
 * v3.8 G-A: the official-page reader. A guarded GET (every safeFetch rule: https on 443, a domain name, every resolved
 * address public and the connection pinned to it, one same-site redirect) that reads the whole page up to
 * PAGE_MAX_BYTES within PAGE_TIMEOUT_MS. GET only, never HEAD. The first try is VERIFIER_UA; when it meets a bot wall
 * (403, 405, 429, or a WAF or CAPTCHA challenge page such as AWS WAF's 202) it tries once more as VERIFIER_BROWSER_UA.
 * Returns the page's text (its HTML; any text when `accept` asks for something other than HTML; '' for a non-HTML
 * answer to an HTML read). Throws PageBlockedError when the wall stays, PageShellError on a 5xx (with what it sent),
 * HttpStatusError on any other non-2xx, ErrorPageError on an error page, and SafeFetchError or TransportError when the
 * fetch could not be made.
 */
export async function safeReadPage(url: string, deps: ReadPageDeps = {}): Promise<string> {
  let answer = await readOnce(url, VERIFIER_UA, deps);
  let wall = wallOf(answer);
  if (wall) {
    answer = await readOnce(url, VERIFIER_BROWSER_UA, deps);
    wall = wallOf(answer);
    if (wall) throw new PageBlockedError(answer.status, wall);
  }
  const html = deps.accept || isHtmlResponse(answer.contentType, answer.text) ? answer.text : '';
  if (answer.status >= 500) throw new PageShellError(answer.status, html);
  if (answer.status >= 300) throw new HttpStatusError(answer.status);
  const phrase = deps.accept ? null : errorPageText(html);
  if (phrase) throw new ErrorPageError(phrase);
  return html;
}

/**
 * v3.8 G-A: where a link redirects: one guarded GET (every safeFetch rule) as VERIFIER_UA, returning its 3xx Location
 * made absolute. The Location itself is never requested here. Throws SafeFetchError when the link does not redirect.
 */
export async function redirectTarget(url: string, deps: { resolve?: Resolver; transport?: Transport; timeoutMs?: number } = {}): Promise<string> {
  try {
    await safeFetchText(url, { ...deps, probe: true, userAgent: VERIFIER_UA });
  } catch (err) {
    if (err instanceof RedirectError && err.location && URL.canParse(err.location, url)) return new URL(err.location, url).href;
    throw err;
  }
  throw new SafeFetchError("doesn't redirect");
}

/** v6.1.18 fix round 1 (L39-5): the most redirects `landingPage` follows. */
export const LANDING_MAX_REDIRECTS = 3;

/**
 * The page a link finally lands on (v6.1.18 fix round 1, L39-5): follows redirects on any host, each hop the same
 * guarded GET as every other fetch here (https on 443, a domain name, every resolved address public and the connection
 * pinned to it, `timeoutMs` per hop), LANDING_MAX_REDIRECTS in all counting the `hops` the caller already followed.
 * v6.1.19 (L44-4, L44-15): the daily run judges a redirected link on its landing page, starting at the Location its
 * probe already read (`hops` 1 or 2), so hop 0 is fetched once. Returns `{ ok: true, page }` (the first 64 KB of HTML,
 * '' when it is not HTML or the landing is a 401, 403 or 429 wall), `{ ok: false, why }` for a landing that is a 4xx,
 * 5xx, an error page (a program link's phrases, as probeLink) or a name that does not resolve, and null when it could not
 * be read: a refused hop (http, a private address, a port), one redirect too many, no Location, a timeout or a refused
 * connection. Never throws.
 */
export type Landing = { ok: true; page: string; url: string } | { ok: false; why: '4xx' | '5xx' | 'dns'; url: string };
export async function landingPage(
  url: string,
  deps: { resolve?: Resolver; transport?: Transport; timeoutMs?: number; hops?: number } = {},
): Promise<Landing | null> {
  const { hops = 0, ...rest } = deps;
  const opts = { ...rest, probe: true, userAgent: LINKCHECK_UA };
  let at = url;
  for (let hop = hops; ; hop++) {
    try {
      const page = await safeFetchText(at, opts);
      return errorPageText(page, PROGRAM_ERROR_PHRASES) ? { ok: false, why: '4xx', url: at } : { ok: true, page, url: at };
    } catch (err) {
      if (err instanceof RedirectError) {
        if (!err.location || !URL.canParse(err.location, at) || hop >= LANDING_MAX_REDIRECTS) return null;
        at = new URL(err.location, at).href;
        continue;
      }
      const dead = deadWhy(err);
      if (dead.ok) return { ok: true, page: '', url: at };
      return dead.why === '4xx' || dead.why === '5xx' || dead.why === 'dns' ? { ok: false, why: dead.why, url: at } : null;
    }
  }
}

/**
 * A program link's answer for the daily stale check (v6.1.16 Task 16, L30-2): alive, or dead and why. `redirect` names
 * the other host a 3xx pointed to (never followed); `page` is the first 64 KB of an HTML page that loaded ('' otherwise).
 */
export type ProbeResult =
  | { ok: true; redirect?: string; page?: string; location?: string; hops?: number }
  | { ok: false; why: '4xx' | '5xx' | 'dns' | 'timeout' | 'refused' };

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
  // v6.1.19 (L44-15): a redirect elsewhere also carries its Location and the redirects it took (`hops`), so the
  // landing read starts there; the Location itself is never requested here.
  const redirected = (err: RedirectError, from: string, hops: number): ProbeResult | URL => {
    if (!err.location || !URL.canParse(err.location, from)) return { ok: true };
    const next = new URL(err.location, from);
    return sameSite(next.hostname, host) ? next : { ok: true, redirect: next.hostname, location: next.href, hops };
  };
  try {
    try {
      return await read(url);
    } catch (err) {
      if (!(err instanceof RedirectError)) throw err;
      const next = redirected(err, url, 1);
      if (!(next instanceof URL)) return next;
      try {
        return await read(next.href);
      } catch (err2) {
        // A second redirect is not followed either; the host answered, so the link is alive.
        if (!(err2 instanceof RedirectError)) throw err2;
        const again = redirected(err2, next.href, 2);
        return again instanceof URL ? { ok: true } : again;
      }
    }
  } catch (err) {
    return deadWhy(err);
  }
}

/** Why a probe failed, in the stale check's words. Pure. */
function deadWhy(err: unknown): ProbeResult {
  // v3.8 G-A: a challenge page is a wall whatever its status (DoraHacks' AWS WAF answers 405).
  if (err instanceof HttpStatusError) return WALLS.includes(err.status) || err.wall ? { ok: true } : { ok: false, why: err.status >= 500 ? '5xx' : '4xx' };
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
