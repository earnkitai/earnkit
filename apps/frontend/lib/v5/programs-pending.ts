/**
 * The pending path of the programs write API while auto_live is off: whether a submission link checks out (on a
 * curated program's site for the program's chains, official_url a hint only). A held write is never mailed and has no
 * approve link (v3.8 E6: no person approves a program). The signed revert link and its confirm page are gone too
 * (v3.8 E7: revert is a bearer POST by write id).
 */
import type { Db } from './db';
import type { Program } from './program-file';
import { STALE_DAYS } from './programs';
import { linkChecksOut, linkPlatformName, normalHost, registrableDomain, sameSite } from './submit-hosts';

/** How long a held write is listed in GET /api/programs/writes and reused for an identical write. */
export const PENDING_DAYS = 7;
const DAY_MS = 86_400_000;

// ---- does the submission link check out ----

const hostOf = (url: string | undefined | null): string | null => {
  if (!url || !URL.canParse(url)) return null;
  return normalHost(new URL(url).hostname);
};

/**
 * The curated sites a submission link may be on to go live, for program `p`'s chains (no chains:
 * the any-chain programs). Never `p` itself. A live file program anchors with its submission and
 * source hosts; a live, fresh API program anchors with its submission host only, and only when the
 * owner approved that link for overlapping chains (an approval from before v3.8; nothing approves now).
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

/** HTML-escapes text for a page (used by the install consent page). Pure. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
