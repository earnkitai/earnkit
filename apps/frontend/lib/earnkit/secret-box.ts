import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * v4.6: a small sealed box for secrets we must read back later (a builder's Stripe read key). AES-256-GCM; the key is
 * derived from EARNKIT_AUTH_SECRET per `purpose`, so a box sealed for one purpose never opens as another, and a rotated
 * secret opens nothing. Output: `v1.<iv>.<tag>.<ct>` in base64url.
 */
const keyFor = (purpose: string): Buffer | null => {
  const secret = process.env.EARNKIT_AUTH_SECRET;
  if (!secret) return null;
  return Buffer.from(hkdfSync('sha256', secret, 'earnkit', purpose, 32));
};

/** Seals `plain`; throws (with no secret material in the message) when EARNKIT_AUTH_SECRET is unset. */
export function seal(plain: string, purpose: string): string {
  const key = keyFor(purpose);
  if (!key) throw new Error('secret-box: no auth secret');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** The plaintext, or null on any failure (wrong purpose, rotated secret, tampering, junk). Never throws. */
export function open(sealed: string, purpose: string): string | null {
  try {
    const key = keyFor(purpose);
    const [v, iv, tag, ct, extra] = sealed.split('.');
    if (!key || v !== 'v1' || !iv || !tag || !ct || extra !== undefined) return null;
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
