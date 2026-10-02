import { promises as dns, type LookupAddress } from 'node:dns';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * An SSRF-safe GET for one small text file on a host someone else named (a sponsor's domain).
 * https only, port 443; the name is resolved once and every address must be public (no
 * private, loopback, link-local, multicast or reserved IPv4/IPv6, incl. IPv4-mapped IPv6); the
 * connection goes to that vetted address while TLS (SNI + certificate check) and the Host header
 * keep the hostname; no redirects (any 3xx fails); 5 s for the whole fetch; a 4 KB body cap.
 *
 * The resolver and transport are injectable so the guard is tested without the network.
 */

export class SafeFetchError extends Error {}

export type Resolved = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<Resolved[]>;
export type TransportResponse = {
  status: number;
  /** content-length, when the server sent one. */
  contentLength?: number;
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
}) => Promise<TransportResponse>;

export const FETCH_TIMEOUT_MS = 5_000;
export const FETCH_MAX_BYTES = 4_096;

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

const defaultResolver: Resolver = async (host) =>
  (await dns.lookup(host, { all: true, verbatim: true })).map(
    (a: LookupAddress) => ({ address: a.address, family: a.family as 4 | 6 }),
  );

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

const nodeTransport: Transport = ({ url, address, family, signal }) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'GET',
        // TLS to the hostname (SNI + certificate verified against it); the socket goes to the
        // vetted address only.
        servername: url.hostname,
        lookup: pinnedLookup(address, family) as never,
        // A fresh connection: never a pooled socket to some other address.
        agent: false,
        signal,
        headers: { accept: 'text/plain', 'user-agent': 'EarnKit-verifier/1' },
      },
      (res) => {
        const length = Number(res.headers['content-length']);
        resolve({
          status: res.statusCode ?? 0,
          ...(Number.isFinite(length) && { contentLength: length }),
          body: res,
          close: () => res.destroy(),
        });
      },
    );
    req.on('error', reject);
    req.end();
  });

/**
 * Fetches `url` and returns its body as text, or throws `SafeFetchError` saying why not. Never
 * follows a redirect and never connects to a non-public address.
 */
export async function safeFetchText(
  url: string,
  {
    resolve = defaultResolver,
    transport = nodeTransport,
    timeoutMs = FETCH_TIMEOUT_MS,
    maxBytes = FETCH_MAX_BYTES,
  }: {
    resolve?: Resolver;
    transport?: Transport;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<string> {
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
    const addresses = await resolve(u.hostname);
    if (addresses.length === 0)
      throw new SafeFetchError(`${u.hostname} doesn't resolve`);
    // Every address must be public, so no answer in the set can point inside.
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad)
      throw new SafeFetchError(
        `${u.hostname} resolves to a non-public address (${bad.address})`,
      );
    const res = await transport({
      url: u,
      address: addresses[0].address,
      family: addresses[0].family,
      signal: controller.signal,
    });
    close = res.close;
    if (res.status >= 300 && res.status < 400)
      throw new SafeFetchError(`redirects aren't followed (${res.status})`);
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
    return Buffer.concat(chunks).toString('utf8');
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
