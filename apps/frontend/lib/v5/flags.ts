/**
 * Feature flags (v3.8 first ship): `EARNKIT_FLAGS` is a comma list of the flag names that are on, read on each call.
 * Unset or empty turns every flag off, which is the shipped behaviour; a name not in `FLAGS` is ignored, so a typo or a
 * retired flag left in Railway turns nothing on. Names are matched trimmed and case-insensitively. Rollback is the
 * variable without the name, then a restart.
 *
 * v3.8 owner/test preview: a request whose caller is an owner or test account (`lib/v6/flag-preview.ts` decides, once
 * per request) runs inside `withFlagPreview(true, ...)`, and there every `PREVIEW_FLAGS` flag is on as well. Every other
 * request, and work outside a request, follows `EARNKIT_FLAGS` exactly.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type Env = Record<string, string | undefined>;

export const FLAGS = [
  'auto_live', 'x_signin', 'private_rows', 'track_v2', 'draft_check', 'form', 'reply_fields', 'copy_v38', 'screen_v2',
  // v3.8 E4: GitHub sign-in and the consent page on the install path (lib/v6/install-consent.ts).
  'install_signin',
] as const;
export type Flag = (typeof FLAGS)[number];

/**
 * The flags a preview caller gets: the shipping flags whose code is on main. `auto_live` (E6r) sends an owner/test
 * caller's program adds through the automated check; normal callers keep main's approval path. `private_rows` has no
 * code yet, so the preview leaves it to `EARNKIT_FLAGS` like everything else.
 */
export const PREVIEW_FLAGS: readonly Flag[] = ['auto_live', 'install_signin', 'x_signin', 'track_v2', 'draft_check', 'form', 'reply_fields', 'copy_v38', 'screen_v2'];

const preview = new AsyncLocalStorage<boolean>();
/** Runs `fn` with the preview on or off for everything it awaits (the request's flag context). */
export const withFlagPreview = <T>(on: boolean, fn: () => T): T => preview.run(on, fn);
/** Whether the current request is a preview caller's. */
export const flagPreviewOn = (): boolean => preview.getStore() === true;

const isFlag = (s: string): s is Flag => (FLAGS as readonly string[]).includes(s);

/** The known flags `EARNKIT_FLAGS` turns on, each once, in `FLAGS` order, plus `PREVIEW_FLAGS` in a preview request. Pure given `env` and the request's flag context. */
export function flagsOn(env: Env = process.env): Flag[] {
  const named = new Set<Flag>((env.EARNKIT_FLAGS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(isFlag));
  if (flagPreviewOn()) for (const f of PREVIEW_FLAGS) named.add(f);
  return FLAGS.filter((f) => named.has(f));
}

/** Whether `flag` is on. Pure given `env` and the request's flag context. */
export const flagOn = (flag: Flag, env: Env = process.env): boolean => flagsOn(env).includes(flag);
