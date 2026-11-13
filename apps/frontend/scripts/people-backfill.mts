/**
 * pnpm tsx scripts/people-backfill.mts [--apply] [--since YYYY-MM-DD]
 * pnpm tsx scripts/people-backfill.mts --reflag [--apply]
 * pnpm tsx scripts/people-backfill.mts --unflag <b:builder id | i:installation id | p:person id> [--apply]
 * Gives every installation without a person one (lib/v6/people-backfill.ts); --reflag re-evaluates every person's test
 * reason from the env lists and client names (never clears one, only a stronger one replaces it); --unflag clears one
 * person's reason by hand (nothing automatic flags it again). Dry run unless --apply; DATABASE_URL from the environment.
 * EARNKIT_OWNER_LOGINS, EARNKIT_DOGFOOD_LOGINS and EARNKIT_TEST_INSTALLATIONS are read from THIS shell, not from
 * Railway: export them before the dry run and the --apply. --since limits the per-installation lines; the summary
 * always has a since-2026-10-24 subtotal.
 */
import './env.mts';
import { sql } from '../lib/v5/db';
import { main } from '../lib/v6/people-backfill';

try {
  await main(process.argv.slice(2));
} finally {
  await sql().end();
}
