import { createHmac } from 'node:crypto';
import { sql } from './db';
import { readParams, secretMatches } from './http';
import { RateLimitError, clientIp, enforce } from './rate-limit';
import { plainText } from './untrusted-text';

export class VetoError extends Error {}

/** What the owner's review page says for `?error=<code>` (fix round 1): one sentence each. */
export const VETO_ERRORS = {
  entry: 'Give the id of the entry to remove.',
  closed: "That entry can't be removed: it is paid, already removed, or the review isn't open.",
  'rate-limited': 'Too many review requests from this address; try again within the hour.',
} as const;
export type VetoErrorCode = keyof typeof VETO_ERRORS;

/** The secret per-campaign veto key (v2.4 §3): HMAC-SHA256 of the slug under ADMIN_VETO_SECRET (32+ characters), or null. Pure. */
export function vetoKey(slug: string, secret = process.env.ADMIN_VETO_SECRET) {
  if (!secret || secret.length < 32) return null;
  return createHmac('sha256', secret).update(`veto:${slug}`).digest('base64url');
}

/** Whether `given` is the campaign's veto key, in constant time. Pure; exported for tests. */
export const vetoKeyMatches = (slug: string, given: string | null | undefined, secret = process.env.ADMIN_VETO_SECRET) => {
  const key = vetoKey(slug, secret);
  return key !== null && secretMatches(given, key);
};

/** The owner's review link (pnpm campaign veto-link prints it); never sent anywhere by EarnKit. */
export const vetoLink = (origin: string, slug: string, secret = process.env.ADMIN_VETO_SECRET) => {
  const key = vetoKey(slug, secret);
  return key ? `${origin.replace(/\/$/, '')}/admin/veto/${slug}?key=${key}` : null;
};

/**
 * Removes an entry during its campaign's 48 h review (v2.4 §3): only while campaign_runs.state is
 * 'review' with review_until still ahead, and the entry has no prize transfer, in one conditional statement. The run row is read
 * FOR SHARE, so the cron's switch to 'paying' waits for this veto to commit (and a veto that comes
 * after it sees 'paying' and is refused): a removed entry is never paid. The next eligible entry
 * moves up (pickWinners). The reason is public.
 */
export async function vetoEntry(slug: string, entryId: number, reason: string) {
  const why = plainText(reason, true).trim().slice(0, 200) || 'Removed in review';
  const rows = await sql()`
    UPDATE projects SET vetoed_at = now(), veto_reason = ${why}
    WHERE id = ${entryId} AND program_id = ${slug} AND prize_tx IS NULL AND vetoed_at IS NULL
      AND EXISTS (SELECT 1 FROM campaign_runs r WHERE r.program_id = ${slug} AND r.state = 'review'
        AND r.review_until > now() FOR SHARE)
    RETURNING id`;
  if (rows.length === 0)
    throw new VetoError(`Entry ${entryId} can't be removed: it isn't an unpaid entry of ${slug} during its review.`);
}

/** Back to the owner's review page (303), with `removed=<id>` or `error=<code>`. */
const back = (slug: string, key: string, q: string) =>
  new Response(null, {
    status: 303,
    headers: { Location: `/admin/veto/${encodeURIComponent(slug)}?key=${encodeURIComponent(key)}&${q}` },
  });

/**
 * POST /api/admin/veto (form: slug, key, entry, reason); app/api/admin/veto/route.ts calls it
 * (v2.14: the builder bonus round branch went with the rounds). GET doesn't
 * exist: link previews and scanners can't remove anything (Review Focus 4). Rate limited per IP; a
 * wrong key is a plain 404; every other outcome goes back to the review page (303) with
 * `removed=<id>` or `error=<code>` (VETO_ERRORS). `deps` for tests.
 */
export async function vetoPost(
  request: Request,
  deps: {
    limit?: (ip: string) => Promise<unknown>;
    veto?: (slug: string, id: number, reason: string) => Promise<void>;
  } = {},
) {
  let limited = false;
  try {
    await (deps.limit ?? ((ip: string) => enforce('veto', ip, 'Too many veto requests from this address.')))(
      clientIp(request.headers),
    );
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    limited = true;
  }
  const form = await readParams(request);
  const slug = form.get('slug') ?? '';
  const key = form.get('key') ?? '';
  if (!vetoKeyMatches(slug, key)) return new Response('Not found', { status: 404 });
  if (limited) return back(slug, key, 'error=rate-limited');
  const entry = Number(form.get('entry'));
  if (!Number.isInteger(entry) || entry <= 0) return back(slug, key, 'error=entry');
  try {
    await (deps.veto ?? vetoEntry)(slug, entry, form.get('reason') ?? '');
  } catch (err) {
    if (err instanceof VetoError) return back(slug, key, 'error=closed');
    throw err;
  }
  return back(slug, key, `removed=${entry}`);
}
