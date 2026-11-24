/**
 * Feature flags (v3.8 first ship): `EARNKIT_FLAGS` is a comma list of the flag names that are on, read on each call.
 * Unset or empty turns every flag off, which is the shipped behaviour; a name not in `FLAGS` is ignored, so a typo or a
 * retired flag left in Railway turns nothing on. Names are matched trimmed and case-insensitively. Rollback is the
 * variable without the name, then a restart.
 */
type Env = Record<string, string | undefined>;

export const FLAGS = [
  'auto_live', 'x_signin', 'private_rows', 'track_v2', 'draft_check', 'form', 'reply_fields', 'copy_v38', 'screen_v2',
] as const;
export type Flag = (typeof FLAGS)[number];

const isFlag = (s: string): s is Flag => (FLAGS as readonly string[]).includes(s);

/** The known flags `EARNKIT_FLAGS` turns on, each once, in `FLAGS` order. Pure. */
export function flagsOn(env: Env = process.env): Flag[] {
  const named = new Set((env.EARNKIT_FLAGS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(isFlag));
  return FLAGS.filter((f) => named.has(f));
}

/** Whether `flag` is on. Pure given `env`. */
export const flagOn = (flag: Flag, env: Env = process.env): boolean => flagsOn(env).includes(flag);
