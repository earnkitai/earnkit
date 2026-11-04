/**
 * The pending path of the programs write API: whether a submission link checks out (on a curated
 * program's site for the program's chains, official_url a hint only), the owner's one email per
 * pending write, the signed approve and revert links (HMAC with EARNKIT_AUTH_SECRET, 7 days), and
 * the owner's plain confirm pages those links open.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';
import { ownerMail, type Mailer } from './mail';
import type { Program } from './program-file';
import { STALE_DAYS } from './programs';
import { linkChecksOut, linkPlatformName, normalHost, registrableDomain, sameSite } from './submit-hosts';

/** How long an approve link works. */
export const APPROVE_TTL_DAYS = 7;
/** How long a revert link works (from the email that carries it). */
export const REVERT_TTL_DAYS = 7;
export const PENDING_SUBJECT = 'EarnKit: a program write waits for you';

const DAY_MS = 86_400_000;

/** EarnKit's public origin. */
export const siteUrl = (): string => (process.env.EARNKIT_URL ?? 'https://earnkit.com').replace(/\/$/, '');

// ---- signed links ----

type Kind = 'program-approve' | 'program-revert';
const macOf = (kind: Kind, writeId: string, expires: number, secret: string) =>
  createHmac('sha256', secret).update(`${kind}:v1:${writeId}:${expires}`).digest('base64url');

/** `<write id>.<expires, unix seconds>.<mac>`. Throws without the secret. */
function signedToken(kind: Kind, writeId: string | number, expires: number, secret = process.env.EARNKIT_AUTH_SECRET): string {
  if (!secret) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return `${writeId}.${expires}.${macOf(kind, String(writeId), expires, secret)}`;
}

const TOKEN = /^([1-9][0-9]{0,15})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;
export type LinkTarget = { writeId: string; expires: number };

/** The write a token names, or null (malformed, changed, the other kind's token, no secret). Timing-safe; expiry is the caller's. */
function signedTarget(kind: Kind, token: unknown, secret = process.env.EARNKIT_AUTH_SECRET): LinkTarget | null {
  if (!secret || typeof token !== 'string' || token.length > 120) return null;
  const m = token.match(TOKEN);
  if (!m) return null;
  const expires = Number(m[2]);
  if (!Number.isSafeInteger(expires) || !Number.isSafeInteger(Number(m[1]))) return null;
  const want = Buffer.from(macOf(kind, m[1]!, expires, secret));
  const got = Buffer.from(m[3]!);
  return want.length === got.length && timingSafeEqual(want, got) ? { writeId: m[1]!, expires } : null;
}

export const linkExpired = (t: LinkTarget, now: Date): boolean => now.getTime() / 1000 > t.expires;

/** When an approve link for a write made at `at` stops working (unix seconds). */
export const approveExpiry = (at: Date): number => Math.floor(at.getTime() / 1000) + APPROVE_TTL_DAYS * 86_400;
export const approveToken = (writeId: string | number, expires: number): string => signedToken('program-approve', writeId, expires);
export const approveTarget = (token: unknown): LinkTarget | null => signedTarget('program-approve', token);
export const approveUrl = (writeId: string | number, expires: number): string =>
  `${siteUrl()}/api/programs/approve?t=${encodeURIComponent(approveToken(writeId, expires))}`;

/** When a revert link mailed at `at` stops working (unix seconds). */
export const revertExpiry = (at: Date): number => Math.floor(at.getTime() / 1000) + REVERT_TTL_DAYS * 86_400;
export const revertToken = (writeId: string | number, expires: number): string => signedToken('program-revert', writeId, expires);
export const revertTarget = (token: unknown): LinkTarget | null => signedTarget('program-revert', token);
export const revertUrl = (writeId: string | number, expires: number): string =>
  `${siteUrl()}/api/programs/revert?t=${encodeURIComponent(revertToken(writeId, expires))}`;

// ---- does the submission link check out ----

const hostOf = (url: string | undefined | null): string | null => {
  if (!url || !URL.canParse(url)) return null;
  return normalHost(new URL(url).hostname);
};

/**
 * The curated sites a submission link may be on to go live, for program `p`'s chains (no chains:
 * the any-chain programs). Never `p` itself. A live file program anchors with its submission and
 * source hosts; a live, fresh API program anchors with its submission host only, and only when the
 * owner approved that link for overlapping chains.
 */
export async function linkAnchors(db: Db, p: Pick<Program, 'id' | 'chains'>, now: Date): Promise<string[]> {
  const chains = p.chains;
  const sameChains =
    chains.length === 0 ? db`jsonb_array_length(COALESCE(p.file->'chains', '[]'::jsonb)) = 0` : db`(p.file->'chains') ?| ${chains}::text[]`;
  const approvedChains =
    chains.length === 0 ? db`jsonb_array_length(w.body->'chains') = 0` : db`(w.body->'chains') ?| ${chains}::text[]`;
  const staleBefore = new Date(now.getTime() - STALE_DAYS * DAY_MS);
  const rows = await db<{ source: string; source_url: string | null; submission_url: string | null }[]>`
    SELECT p.source, p.file->>'source_url' AS source_url, p.file->>'submission_url' AS submission_url FROM programs p
    WHERE p.id <> ${p.id} AND p.file IS NOT NULL AND ${sameChains}
      AND (p.status = 'upcoming' OR (p.status = 'active' AND (p.ends_at IS NULL OR p.ends_at > ${now})))
      AND NOT (p.stale_since IS NOT NULL AND p.stale_since < ${staleBefore})
      AND (p.source = 'file' OR (p.source = 'api' AND p.verified_at >= ${staleBefore}::date AND EXISTS (
        SELECT 1 FROM program_writes w
        WHERE w.program_id = p.id AND w.result = 'approved' AND w.body->>'submission_url' = p.file->>'submission_url'
          AND jsonb_typeof(w.body->'chains') = 'array' AND ${approvedChains})))`;
  return rows
    .flatMap((r) => [hostOf(r.submission_url), r.source === 'file' ? hostOf(r.source_url) : null])
    .filter((h): h is string => h !== null);
}

/**
 * Whether `submissionUrl` checks out: its host is on a curated anchor's site; or it is on
 * official_url's site and official_url's own host is on a curated anchor's site. Pure.
 */
export function submissionChecksOut(submissionUrl: string, officialUrl: string | undefined, anchors: string[]): boolean {
  const host = hostOf(submissionUrl);
  if (host === null) return false;
  if (linkChecksOut(host, anchors)) return true;
  const official = hostOf(officialUrl);
  return official !== null && linkChecksOut(host, [official]) && linkChecksOut(official, anchors);
}

/** The links a program sends builders to, by field: every one must check out for a gated write to go live. Pure. */
export function builderLinks(p: Pick<Program, 'submission_url' | 'form' | 'pool_source_url'>): { field: string; url: string }[] {
  return [
    { field: 'submission_url', url: p.submission_url },
    ...(p.form?.url ? [{ field: 'form.url', url: p.form.url }] : []),
    ...(p.pool_source_url ? [{ field: 'pool_source_url', url: p.pool_source_url }] : []),
  ];
}

/** The first builder link that doesn't check out, or null when all do. Pure. */
export function uncheckedLink(
  p: Pick<Program, 'submission_url' | 'form' | 'pool_source_url' | 'official_url'>,
  anchors: string[],
): { field: string; url: string } | null {
  return builderLinks(p).find((l) => !submissionChecksOut(l.url, p.official_url, anchors)) ?? null;
}

/** Why a builder link (`field`, default submission_url) doesn't check out, for the owner. Pure. */
export function pendingReason(url: string, officialUrl: string | undefined, field = 'submission_url'): string {
  const host = hostOf(url) ?? 'the link';
  const platform = linkPlatformName(host);
  if (platform) return `${field} is on ${platform}, a form, hosting or submit platform anyone can publish on`;
  const official = hostOf(officialUrl);
  if (official && sameSite(host, official))
    return `${field} ${host} is on official_url's site, but ${registrableDomain(official)} is not a curated program's site for its chains`;
  return `${field} ${host} is not on a curated program's site for its chains`;
}

/** An official_url on a platform or shared host never names an organizer's own site: the problem, or null. Pure. */
export function officialUrlProblem(officialUrl: string | undefined): string | null {
  const host = hostOf(officialUrl);
  const platform = host && linkPlatformName(host);
  return platform ? `official_url: ${host} is on ${platform}, a shared or platform host; send the organizer's own site` : null;
}

// ---- the owner's email ----

type MailFields = Pick<Program, 'id' | 'title' | 'organizer' | 'source_url' | 'submission_url' | 'official_url'>;

/** One line: control characters, line and paragraph separators and runs of whitespace become one space. Pure. */
export const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, ' ').trim();

/** The owner's email for a pending write. Plain text; every bot value is on one line (oneLine). Pure. */
export function pendingMailText(p: MailFields, reason: string, link: string | null): string {
  return [
    "The Grok Bot wrote a program change EarnKit couldn't check. It is not live.",
    '',
    `Program: ${oneLine(p.title)} (${p.id})`,
    `Organizer: ${oneLine(p.organizer)}`,
    `Submission link: ${oneLine(p.submission_url)}`,
    `Source page: ${oneLine(p.source_url)}`,
    `Official site: ${oneLine(p.official_url ?? 'none sent')}`,
    `Why: ${oneLine(reason)}`,
    '',
    link
      ? `Check the links, then approve it here (a confirm page; the link works for ${APPROVE_TTL_DAYS} days): ${link}`
      : 'EARNKIT_AUTH_SECRET is not set, so there is no approve link. It stays pending.',
  ].join('\n');
}

/** Sends the owner's one email for a pending write (idempotency key program-pending:<id>). Throws on a failed send. */
export async function mailPending(w: { id: string; at: Date }, p: MailFields, reason: string, mailer?: Mailer): Promise<void> {
  const link = process.env.EARNKIT_AUTH_SECRET ? approveUrl(w.id, approveExpiry(w.at)) : null;
  await ownerMail(PENDING_SUBJECT, pendingMailText(p, reason, link), `program-pending:${w.id}`, mailer);
}

// ---- the owner's confirm pages ----

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
  'X-Frame-Options': 'DENY',
  // No script; the one form posts back to EarnKit; nobody can frame the button.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
const STYLE =
  'body{margin:0;background:#000;color:#fff;font:400 1.0625rem/1.55 ui-sans-serif,system-ui,sans-serif}' +
  'main{max-width:36rem;margin:0 auto;padding:64px 16px}h1{font-size:2rem;line-height:1.1;margin:0 0 16px}' +
  'p{margin:12px 0 0;overflow-wrap:anywhere}button{margin-top:28px;min-height:48px;padding:0 24px;border:0;border-radius:999px;' +
  'background:#2563eb;color:#fff;font:500 1rem/1 inherit;cursor:pointer}';

/** A page around `inner` (already escaped HTML). */
export const ownerPage = (inner: string, status = 200): Response =>
  new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<meta name="robots" content="noindex"><title>EarnKit</title><style>${STYLE}</style></head><body><main>${inner}</main></body></html>`,
    { status, headers: PAGE_HEADERS },
  );

/** A page of one plain line. */
export const ownerLine = (text: string, status: number): Response => ownerPage(`<p>${escapeHtml(text)}</p>`, status);

/** The confirm page: a title, plain lines and one button that POSTs back to `action` (an EarnKit path). */
export const confirmPage = (title: string, lines: string[], action: string, button: string): Response =>
  ownerPage(
    `<h1>${escapeHtml(title)}</h1>` +
      lines.map((l) => `<p>${escapeHtml(oneLine(l))}</p>`).join('') +
      `<form method="post" action="${escapeHtml(action)}"><button type="submit">${escapeHtml(button)}</button></form>`,
  );
