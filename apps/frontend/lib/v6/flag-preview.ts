/**
 * v3.8 owner/test preview: the owner's and the test accounts' requests get every shipping flag (`PREVIEW_FLAGS` in
 * lib/v5/flags.ts) while EARNKIT_FLAGS stays unset, so the v3.8 gates run on production without changing anything for
 * a real builder. The caller is resolved once per request: an MCP call by its installation, a /me, sign-in or install
 * consent request by the browser's /me session. A request with neither, or a lookup that fails, follows EARNKIT_FLAGS.
 * Design: docs/design-docs-and-implementation-plans/v3.8-owner-test-flag-preview.md.
 */
import { sql } from '../v5/db';
import { PREVIEW_FLAGS, flagsOn, withFlagPreview } from '../v5/flags';
import { envListReason } from './people';
import { sessionBuilderId } from './sessions';

type Env = Record<string, string | undefined>;

/** The test reasons that get the preview. `repro` (the repro scripts) does not: those check what a builder sees. */
export const PREVIEW_REASONS = ['owner', 'test', 'persona', 'dogfood'] as const;

type Who = { reasons: (string | null)[]; login: string | null; xHandle: string | null; installationId?: number };

/**
 * Whether this caller is an owner or test account: a person of theirs is flagged owner, test, persona or dogfood, or
 * their login, X handle or installation id is on an env list (EARNKIT_OWNER_LOGINS, the built-in owner logins,
 * EARNKIT_DOGFOOD_LOGINS, EARNKIT_TEST_INSTALLATIONS). Pure.
 */
export function isPreviewCaller(who: Who, env: Env = process.env): boolean {
  if (who.reasons.some((r) => (PREVIEW_REASONS as readonly (string | null)[]).includes(r))) return true;
  return envListReason({ githubLogin: who.login, xHandle: who.xHandle, installationId: who.installationId }, env) !== null;
}

type Row = { login: string | null; x_handle: string | null; reasons: (string | null)[] };

/** An installation's caller: its person and, once linked, its builder and the builder's person. */
export async function previewForInstallation(installationId: number): Promise<boolean> {
  const [r] = await sql()<Row[]>`
    SELECT b.login, b.x_handle,
      ARRAY(SELECT p.test_reason FROM people p WHERE p.id = i.person_id OR (i.builder_id IS NOT NULL AND p.builder_id = i.builder_id)) AS reasons
    FROM installations i LEFT JOIN builders b ON b.id = i.builder_id WHERE i.id = ${installationId}`;
  return r ? isPreviewCaller({ reasons: r.reasons, login: r.login, xHandle: r.x_handle, installationId }) : false;
}

/** A builder's caller: their person and their linked installations' people. */
export async function previewForBuilder(builderId: number): Promise<boolean> {
  const [r] = await sql()<Row[]>`
    SELECT b.login, b.x_handle,
      ARRAY(SELECT p.test_reason FROM people p WHERE p.builder_id = b.id OR p.id IN (SELECT person_id FROM installations WHERE builder_id = b.id)) AS reasons
    FROM builders b WHERE b.id = ${builderId}`;
  return r ? isPreviewCaller({ reasons: r.reasons, login: r.login, xHandle: r.x_handle }) : false;
}

/** The browser's /me session's builder; no session cookie is no caller (no query). */
export async function previewForCookie(cookieHeader: string | null, now: Date = new Date()): Promise<boolean> {
  const id = await sessionBuilderId(cookieHeader, now);
  return id === null ? false : previewForBuilder(id);
}

/**
 * Runs `fn` in the request's flag context: the preview when `resolve` says this caller gets it. A lookup that throws is
 * logged and follows EARNKIT_FLAGS. When EARNKIT_FLAGS already turns every preview flag on there is nothing to look up.
 */
export async function withCallerFlags<T>(resolve: () => Promise<boolean>, fn: () => Promise<T>): Promise<T> {
  let on = false;
  if (!PREVIEW_FLAGS.every((f) => flagsOn().includes(f))) {
    try {
      on = await resolve();
    } catch (err) {
      console.error('[flags] preview lookup failed, EARNKIT_FLAGS only', err instanceof Error ? err.name : typeof err);
    }
  }
  return withFlagPreview(on, fn);
}

/** `withCallerFlags` by the request's /me session cookie (the /me, sign-in and install consent routes). */
export const withSessionFlags = <T>(request: Request, fn: () => Promise<T>): Promise<T> =>
  withCallerFlags(() => previewForCookie(request.headers.get('cookie')), fn);
