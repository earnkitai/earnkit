import { isIP } from 'node:net';
import { CHAIN_NAMES, type Chain } from './chains';

/**
 * v2.9 A5: links no real product lives on, and the builder lines for a link or contract that
 * failed its check. Pure and import-light (Pre-flight P48), so untrusted-text.ts and submission.ts
 * stay free of the database and network code in verify.ts, which re-exports all of this.
 */

/** RFC 2606/6761 top-level names. */
const RESERVED_TLDS = ['example', 'test', 'invalid', 'localhost', 'local'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];
/** EarnKit's own site is never a builder's product (a builder subdomain like tipjar-alice.earnkit.com is). */
const RESERVED_NAMES = new Set([...RESERVED_DOMAINS, 'localhost', 'earnkit.com']);
const SHORT_LIST = new Set(['yourdomain.com', 'yoursite.com', 'domain.com', 'test.com', 'myapp.com']);

/** v2.9 A5: a host no real product lives on (RFC 2606/6761 names, a short list, IP literals, earnkit.com). Pure. */
export function placeholderHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(h)) return true;
  const bare = h.replace(/^www\./, '');
  if (RESERVED_NAMES.has(bare) || SHORT_LIST.has(bare)) return true;
  const tld = bare.split('.').at(-1) ?? '';
  return RESERVED_TLDS.includes(tld) || RESERVED_DOMAINS.some((d) => bare.endsWith(`.${d}`));
}

/** v2.9 A5: a link on a placeholder host, or EarnKit's own GitHub (github.com/earnkitai/...). Pure. */
export function placeholderLink(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const u = new URL(url);
  if (placeholderHost(u.hostname)) return true;
  return u.hostname.toLowerCase().replace(/^www\./, '') === 'github.com' && /^\/earnkitai(\/|$)/i.test(u.pathname);
}

export const PLACEHOLDER_LINE = 'Use your real site, not a placeholder.';
export const LIVE_FAILED_LINE = "Live link didn't load from here. Check it's public.";
/** v2.10 item 14: the live link loads, but shows an error page (`phrase` is what it shows). */
export const liveErrorLine = (phrase: string) => `Your live link loads but shows an error ("${phrase}"). Fix it and tell me.`;
export const contractMissingLine = (chain: Chain) => `No contract found on ${CHAIN_NAMES[chain]} mainnet yet.`;
/** Ruling G15: the contract check couldn't run (an RPC error or no check left): never "not found". */
export const contractUncheckedLine = (chain: Chain) => `Couldn't check your ${CHAIN_NAMES[chain]} mainnet contract yet. It's checked again next step.`;
