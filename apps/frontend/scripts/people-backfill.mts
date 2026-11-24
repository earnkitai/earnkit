/**
 * pnpm tsx scripts/people-backfill.mts [--apply] [--since YYYY-MM-DD]
 * pnpm tsx scripts/people-backfill.mts --reflag [--apply]
 * pnpm tsx scripts/people-backfill.mts --reflag-report
 * pnpm tsx scripts/people-backfill.mts --unflag <b:builder id | i:installation id | p:person id> [--apply]
 * Gives every installation without a person one (lib/v6/people-backfill.ts); --reflag re-evaluates every person's test
 * reason from the env lists and client names (never clears one, only a stronger one replaces it); --unflag clears one
 * person's reason by hand (nothing automatic flags it again). Dry run unless --apply; DATABASE_URL from the environment.
 * EARNKIT_OWNER_LOGINS, EARNKIT_DOGFOOD_LOGINS and EARNKIT_TEST_INSTALLATIONS are read from THIS shell, not from
 * Railway: export them before the dry run and the --apply. --since limits the per-installation lines; the summary
 * always has a since-2026-10-24 subtotal.
 * --reflag-report (v3.8, run by `pnpm predeploy`, so it sees Railway's lists): the read-only reflag dry run as a
 * "[reflag dry-run]" block (counts and public handles only). It never writes and never fails the deploy: any error or
 * a 60 s stall logs one line and exits 0.
 */
import './env.mts';
import { sql } from '../lib/v5/db';
import { REFLAG_LABEL, main, reflagReport } from '../lib/v6/people-backfill';

if (process.argv.includes('--reflag-report')) {
  // The error's code or class only: a message can carry a host or a connection string.
  const fail = (e: unknown) => console.log(`${REFLAG_LABEL} skipped: ${(e as { code?: string })?.code ?? (e instanceof Error ? e.name : 'error')}`);
  setTimeout(() => {
    console.log(`${REFLAG_LABEL} skipped: timeout`);
    process.exit(0);
  }, 60_000).unref();
  try {
    await reflagReport();
  } catch (e) {
    fail(e);
  }
  await sql().end({ timeout: 5 }).catch(() => {});
  process.exit(0);
}

try {
  await main(process.argv.slice(2));
} finally {
  await sql().end();
}
