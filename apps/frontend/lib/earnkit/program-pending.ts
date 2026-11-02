import { createHmac, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import type { Mailer } from './digest';
import { siteUrl } from './entry-text';
import { ownerMail } from './owner-mail';
import type { ProgramFile } from './program-file';
import { freshSql } from './api-stale';
import { linkChecksOut, linkPlatformName, normalHost, registrableDomain, sameSite } from './submit-hosts';

/**
 * v4.10.1 Task 4 (ruling R4, owner 2026-11-02 "Live if link checks out"; fix round 1): a new API program, or a write
 * that changes `submission_url` or `chains`, goes live only when the submission link is on a curated program's site
 * for its chains (linkAnchors). `official_url` (sent with the write) is a hint only: it counts when its own site is a
 * curated one. Anything else is held as a `program_writes` row
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
 * Fix round 1 (controller ruling): the curated sites a submission link may be on to go live, for program `p`'s
 * chains (a program with no chains: the curated any-chain programs). Only owner-curated programs anchor, and never
 * `p` itself:
 * - a file program that is live (active and not past ends_at, or upcoming): its submission and source hosts;
 * - an API program that is live and fresh (api-stale.ts freshSql) whose current submission_url the owner approved
 *   through the approve link, with the approved write's chains on `p`'s: its submission host only (an API source_url
 *   was never checked).
 * Closed, expired, unlisted, sponsor and unchecked API rows never anchor; linkChecksOut skips platform hosts.
 */
export async function linkAnchors(
  db: postgres.Sql | postgres.TransactionSql,
  p: Pick<ProgramFile, 'id' | 'chains'>,
  now: Date,
): Promise<string[]> {
  const chains = p.chains ?? [];
  const sameChains = chains.length === 0 ? db`p.chains = '{}'::text[]` : db`p.chains && ${chains}::text[]`;
  const approvedChains = chains.length === 0 ? db`jsonb_array_length(w.body->'chains') = 0` : db`(w.body->'chains') ?| ${chains}::text[]`;
  const rows = await db<{ source: string; source_url: string; submission_url: string }[]>`
    SELECT p.source, p.source_url, p.submission_url FROM programs p
    WHERE p.id <> ${p.id} AND ${sameChains}
      AND (p.status = 'upcoming' OR (p.status = 'active' AND (p.ends_at IS NULL OR p.ends_at > ${now})))
      AND (p.source = 'file' OR (p.source = 'api' AND ${freshSql(db, 'p', now)} AND EXISTS (
        SELECT 1 FROM program_writes w
        WHERE w.program_id = p.id AND w.result = 'approved' AND w.body->>'submission_url' = p.submission_url
          AND jsonb_typeof(w.body->'chains') = 'array' AND ${approvedChains})))`;
  return rows
    .flatMap((r) => [hostOf(r.submission_url), r.source === 'file' ? hostOf(r.source_url) : null])
    .filter((h): h is string => h !== null);
}

/** Why a submission link doesn't check out, for the owner (the audit reason and the email). Pure. */
export function pendingReason(submissionUrl: string, officialUrl: string | undefined): string {
  const host = hostOf(submissionUrl) ?? 'the submission link';
  const platform = linkPlatformName(host);
  if (platform) return `submission_url is on ${platform}, a form, hosting or submit platform anyone can publish on`;
  const official = hostOf(officialUrl);
  if (official && sameSite(host, official))
    return `submission_url ${host} is on official_url's site, but ${registrableDomain(official)} is not a curated program's site for its chains`;
  return `submission_url ${host} is not on a curated program's site for its chains`;
}

/**
 * Fix round 1: whether `submissionUrl` checks out. Its host is on a curated anchor's site; or it is on official_url's
 * site and official_url's own host is on a curated anchor's site (official_url is a hint, never trusted alone). Pure.
 */
export function submissionChecksOut(submissionUrl: string, officialUrl: string | undefined, anchors: string[]): boolean {
  const host = hostOf(submissionUrl);
  if (host === null) return false;
  if (linkChecksOut(host, anchors)) return true;
  const official = hostOf(officialUrl);
  return official !== null && linkChecksOut(host, [official]) && linkChecksOut(official, anchors);
}

/** Fix round 1: an official_url on a platform or shared host never names an organizer's own site; the problem or null. Pure. */
export function officialUrlProblem(officialUrl: string): string | null {
  const host = hostOf(officialUrl);
  const platform = host && linkPlatformName(host);
  return platform ? `official_url: ${host} is on ${platform}, a shared or platform host; send the organizer's own site` : null;
}

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
