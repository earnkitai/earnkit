/**
 * pnpm tsx scripts/people-backfill.mts [--apply] [--since YYYY-MM-DD]
 * Gives every installation without a person one (lib/v6/people-backfill.ts). Dry run unless --apply; DATABASE_URL from
 * the environment. --since limits the per-installation lines; the summary always has a since-2026-10-24 subtotal.
 */
import './env.mts';
import { sql } from '../lib/v5/db';
import { run } from '../lib/v6/people-backfill';

try {
  await run(process.argv.slice(2));
} finally {
  await sql().end();
}
