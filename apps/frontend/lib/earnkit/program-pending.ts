import { createHmac, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import type { Mailer } from './digest';
import { siteUrl } from './entry-text';
import { ownerMail } from './owner-mail';
import type { ProgramFile } from './program-file';
import { linkChecksOut, linkPlatformName, normalHost, registrableDomain } from './submit-hosts';

/**
 * v4.10.1 Task 4 (ruling R4, owner 2026-11-02 "Live if link checks out"): a new API program, or a write that changes
 * `submission_url`, goes live only when the submission link is on the official site's domain (`official_url`, sent
 * with the write) or on a live program's site for one of its chains. Anything else is held as a `program_writes` row
 * with result 'pending' and the checked body; nothing reaches `programs` until the owner approves. The owner gets one
 * email (ownerMail, to CONTACT_EMAIL) with an approve link: a GET confirm page whose button POSTs
 * (program-approve.ts), so a mail scanner opening the link approves nothing.
 *
 * The link's token is `<write id>.<expires, unix seconds>.<base64url HMAC-SHA256(EARNKIT_AUTH_SECRET,
 * "program-approve:v1:<write id>:<expires>")>`, checked in constant time before any database read. Single use is the
 * row's own state (an approval flips 'pending' to 'approved' under a row lock), so a replay does nothing.
 */

/** How long an approve link works. */
export const APPROVE_TTL_DAYS = 7;
const TTL_SECONDS = APPROVE_TTL_DAYS * 86_400;
export const PENDING_SUBJECT = 'EarnKit: a program write waits for you';

const macOf = (writeId: string, expires: number, secret: string) =>
  createHmac('sha256', secret).update(`program-approve:v1:${writeId}:${expires}`).digest('base64url');

/** When a link for a write made at `at` stops working (unix seconds). Pure. */
export const approveExpiry = (at: Date) => Math.floor(at.getTime() / 1000) + TTL_SECONDS;

/** The approve token for a pending write. Throws without the secret. Pure. */
export function approveToken(writeId: string | number, expires: number, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): string {
  if (!secret) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return `${writeId}.${expires}.${macOf(String(writeId), expires, secret)}`;
}

/** The approve link (always EarnKit's own origin). Throws without the secret. */
export const approveUrl = (writeId: string | number, expires: number) =>
  `${siteUrl()}/api/programs/approve?t=${encodeURIComponent(approveToken(writeId, expires))}`;

const TOKEN = /^([1-9][0-9]{0,15})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;
export type ApproveTarget = { writeId: string; expires: number };

/**
 * The write a token names, or null (malformed, a changed character, another id or expiry, no secret). Timing-safe. The
 * expiry is checked by the caller (approveExpired), so an expired link can say so. Pure.
 */
export function approveTarget(token: unknown, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): ApproveTarget | null {
  if (!secret || typeof token !== 'string' || token.length > 120) return null;
  const m = token.match(TOKEN);
  if (!m) return null;
  const expires = Number(m[2]);
  if (!Number.isSafeInteger(expires) || !Number.isSafeInteger(Number(m[1]))) return null;
  const want = Buffer.from(macOf(m[1]!, expires, secret));
  const got = Buffer.from(m[3]!);
  return want.length === got.length && timingSafeEqual(want, got) ? { writeId: m[1]!, expires } : null;
}

export const approveExpired = (t: ApproveTarget, now: Date) => now.getTime() / 1000 > t.expires;

/** A URL's hostname, normalized, or null. */
const hostOf = (url: string | undefined | null): string | null => {
  if (!url || !URL.canParse(url)) return null;
  return normalHost(new URL(url).hostname);
};

/**
 * The sites a submission link may be on to go live: the official site's host, then each live program's submission
 * host for a shared chain, and the source host of a curated (file) one. An API program's source_url is never an anchor:
 * nobody checked it. Live: active or upcoming, not past ends_at.
 */
export async function linkAnchors(
  db: postgres.Sql | postgres.TransactionSql,
  p: Pick<ProgramFile, 'chains'>,
  officialUrl: string | undefined,
  now: Date,
): Promise<string[]> {
  const official = hostOf(officialUrl);
  const chains = p.chains ?? [];
  const rows =
    chains.length === 0
      ? []
      : await db<{ source: string; source_url: string; submission_url: string }[]>`
          SELECT source, source_url, submission_url FROM programs
          WHERE chains && ${chains}::text[] AND source IN ('file', 'api')
            AND (status = 'upcoming' OR (status = 'active' AND (ends_at IS NULL OR ends_at > ${now})))`;
  const hosts = rows.flatMap((r) => [hostOf(r.submission_url), r.source === 'file' ? hostOf(r.source_url) : null]);
  return [official, ...hosts].filter((h): h is string => h !== null);
}

/** Why a submission link doesn't check out, for the owner (the audit reason and the email). Pure. */
export function pendingReason(submissionUrl: string, officialUrl: string | undefined): string {
  const host = hostOf(submissionUrl) ?? 'the submission link';
  const platform = linkPlatformName(host);
  if (platform) return `submission_url is on ${platform}, a platform anyone can publish on`;
  const official = hostOf(officialUrl);
  if (!official) return `submission_url ${host} is not on a live program's site for its chains, and no official_url was sent`;
  return `submission_url ${host} is not on ${registrableDomain(official)} (official_url)`;
}

/** Whether `submissionUrl` checks out against `anchors` (linkAnchors). Pure. */
export const submissionChecksOut = (submissionUrl: string, anchors: string[]) => {
  const host = hostOf(submissionUrl);
  return host !== null && linkChecksOut(host, anchors);
};

/** The owner's email for a pending write. Plain text; every value in it passed the write's checks. Pure. */
export function pendingMailText(
  w: { id: string; at: Date },
  p: Pick<ProgramFile, 'id' | 'title' | 'organizer' | 'source_url' | 'submission_url'>,
  officialUrl: string | undefined,
  reason: string,
  link: string | null,
): string {
  return [
    "The Grok Bot wrote a program whose link EarnKit couldn't check. It is not live.",
    '',
    `Program: ${p.title} (${p.id})`,
    `Organizer: ${p.organizer}`,
    `Submission link: ${p.submission_url}`,
    `Source page: ${p.source_url}`,
    `Official site: ${officialUrl ?? 'none sent'}`,
    `Why: ${reason}`,
    '',
    link
      ? `Check the links, then approve it here (a confirm page; the link works for ${APPROVE_TTL_DAYS} days): ${link}`
      : 'EARNKIT_AUTH_SECRET is not set, so there is no approve link. It stays pending.',
  ].join('\n');
}

/** Sends the owner's one email for a new pending write (Idempotency-Key program-pending:<id>). Throws on a failed send. */
export async function mailPending(
  w: { id: string; at: Date },
  p: Pick<ProgramFile, 'id' | 'title' | 'organizer' | 'source_url' | 'submission_url'>,
  officialUrl: string | undefined,
  reason: string,
  mailer?: Mailer,
): Promise<void> {
  const link = process.env.EARNKIT_AUTH_SECRET ? approveUrl(w.id, approveExpiry(w.at)) : null;
  await ownerMail(PENDING_SUBJECT, pendingMailText(w, p, officialUrl, reason, link), `program-pending:${w.id}`, mailer);
}
