/**
 * Next's start-up hook (L13-11, v6.1.16 Task 17): in production a CRON_SECRET that is set and shorter than 32
 * characters stops the server at start, so the deploy fails rather than run a daily job nobody can call. An unset
 * secret still boots; the cron route then answers 503 as before (lib/v5/cron.ts).
 */
export const CRON_SECRET_MIN = 32;
export const CRON_SECRET_SHORT = 'CRON_SECRET must be at least 32 characters.';

/** Throws CRON_SECRET_SHORT for a short secret in production; nothing otherwise. Pure over `env`. */
export function checkBootEnv(env: NodeJS.ProcessEnv = process.env): void {
  const secret = env.CRON_SECRET;
  if (env.NODE_ENV === 'production' && secret && secret.length < CRON_SECRET_MIN) throw new Error(CRON_SECRET_SHORT);
}

/**
 * Next calls this once at start. A throw here only logs, and the server would stay up answering 500 to every request
 * (seen on `next start`, Next 16.4.1), so a refused secret logs its line and exits the process with code 1.
 */
export function register(deps: { exit: (code: number) => void } = { exit: (code) => process.exit(code) }): void {
  try {
    checkBootEnv();
  } catch (err) {
    console.error(`[boot] ${err instanceof Error ? err.message : String(err)}`);
    deps.exit(1);
    throw err;
  }
}
