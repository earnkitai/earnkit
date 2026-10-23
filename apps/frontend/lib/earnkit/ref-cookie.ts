/**
 * v3.1 GTM W1, referral attribution (measure only, no rewards). A visitor who opens a builder's page (/<handle>, which a
 * one-tap post's link also lands on) is remembered by that handle in a first-party cookie for 30 days; when the visitor
 * then installs EarnKit, /oauth/authorize carries the handle in the signed code and the token exchange stores the
 * referring builder on the new installation (installations.ref_builder_id, installations.ts noteReferral). Only the owner
 * counts it (owner_people.referred_installs); never shown publicly, never trusted for anything else (a cookie anyone can
 * set). Client-safe: no server imports.
 */
export const REF_COOKIE = 'ek_ref';
export const REF_MAX_AGE_S = 30 * 86_400;
/** An X handle as page URLs carry it (profiles.ts X_HANDLE), stored lowercase. */
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** The handle, lowercase, when it is a valid X handle; else null. Pure. */
export function cleanRef(v: unknown): string | null {
  return typeof v === 'string' && HANDLE.test(v) ? v.toLowerCase() : null;
}

/** The remembered handle in a Cookie header (validated), or null. Pure. */
export function refFromCookieHeader(header: string | null): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === REF_COOKIE) return cleanRef(v.join('='));
  }
  return null;
}

/**
 * The cookie to set for `handle`, or null when one is already remembered (the first page in 30 days keeps the credit)
 * or the handle is not valid. Lax (sent on the top-level GET to /oauth/authorize), Secure only over https. Pure.
 */
export function refCookieToSet(handle: string, existing: string | null, https: boolean): string | null {
  const h = cleanRef(handle);
  if (!h || refFromCookieHeader(existing)) return null;
  return `${REF_COOKIE}=${h}; Path=/; Max-Age=${REF_MAX_AGE_S}; SameSite=Lax${https ? '; Secure' : ''}`;
}
