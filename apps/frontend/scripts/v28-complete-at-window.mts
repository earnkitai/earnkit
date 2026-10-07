import './env.mts';
import { sql } from '../lib/earnkit/db';
import { completeAtWindow } from '../lib/earnkit/token-launch';

/**
 * v2.8 Ruling C7, a ship step run once right after the v2.8 deploy. predeploy's migration backfills
 * complete_at once; a token launched by v2.7 code between the migration and the cutover passed
 * v2.7's C7 gate but has complete_at NULL. This finds those rows (token launched in the window,
 * complete_at NULL, never confirmed, stored entry complete) and sets complete_at = coin_launched_at.
 *
 *   pnpm exec tsx apps/frontend/scripts/v28-complete-at-window.mts [--since <ISO>] [--until <ISO>] [--apply]
 *
 * Dry run unless --apply. --since defaults to 24 hours ago, --until to now. Idempotent (set-once).
 * Logs counts only, never names, repos or answers.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function when(name: string, fallback: Date): Date {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    console.error(`${name}: not a date (use ISO 8601, e.g. 2026-10-08T10:00:00Z).`);
    process.exit(1);
  }
  return d;
}

const apply = process.argv.includes('--apply');
const now = new Date();
const since = when('--since', new Date(now.getTime() - 24 * 3_600_000));
const until = when('--until', now);
if (since > until) {
  console.error('--since is after --until.');
  process.exit(1);
}
const out = await completeAtWindow({ since, until, apply });
console.log(
  `${apply ? 'apply' : 'dry run'}: tokens launched ${since.toISOString()} to ${until.toISOString()} ` +
    `without complete_at: ${out.launched_without_complete}; complete entries: ${out.complete}; ` +
    `updated: ${out.updated}.${apply ? '' : ' Pass --apply to write.'}`,
);
await sql().end();
