/**
 * v3.8 E6r: whether a request comes from the owner or a test-preview account. The programs write API uses it to send
 * such a caller's program adds through the automated official-page check while `auto_live` is off for everyone else.
 *
 * The caller is the signed-in builder (the session cookie). It is a preview caller when its proven GitHub login or X
 * handle is on an owner or dogfood list (`envListReason`: the built-in OWNER_LOGINS jenil04 and jenilt,
 * EARNKIT_OWNER_LOGINS, EARNKIT_DOGFOOD_LOGINS), or when its person's `test_reason` is test, persona, dogfood or owner.
 * No cookie, no live session, or any error reads as not a preview caller, which is main's behaviour.
 *
 * TODO(v3.8 owner/test preview): switch to the shared per-request preview context once the "owner/test preview" PR
 * merges, and delete this file.
 */
import { sql } from '../v5/db';
import { envListReason } from './people';
import { anySessionCookie, sessionBuilder } from './sessions';

/** The `test_reason` values that make a person a preview caller. */
export const PREVIEW_REASONS = ['owner', 'test', 'persona', 'dogfood'] as const;

const isPreviewReason = (r: string | null | undefined): boolean => (PREVIEW_REASONS as readonly string[]).includes(r ?? '');

/** Whether `request` is from the owner or a test-preview account. Never throws. */
export async function previewCaller(request: Request, now: Date = new Date()): Promise<boolean> {
  const cookie = request.headers.get('cookie');
  if (!anySessionCookie(cookie)) return false;
  try {
    const b = await sessionBuilder(cookie, now);
    if (!b) return false;
    if (isPreviewReason(envListReason({ githubLogin: b.login, xHandle: b.x_handle })?.reason)) return true;
    const [p] = await sql()<{ test_reason: string | null }[]>`SELECT test_reason FROM people WHERE builder_id = ${b.id} LIMIT 1`;
    return isPreviewReason(p?.test_reason);
  } catch (err) {
    console.error(`[preview-caller] lookup failed: ${err instanceof Error ? err.name : 'unknown'}`);
    return false;
  }
}
