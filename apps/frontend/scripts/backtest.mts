/**
 * pnpm backtest --file <round.json> [--apply]
 * v3.8 E17: scores a past round from public data on evidence cut at its deadline (lib/v6/backtest.ts) and prints the
 * public-safe report (non-users: hit or miss only). Dry run unless --apply, which stores the round, entries and scores
 * under METHOD_VERSION; DATABASE_URL from the environment. GITHUB_TOKEN in the shell raises the GitHub limit.
 */
import './env.mts';
import { sql } from '../lib/v5/db';
import { main } from '../lib/v6/backtest';

try {
  await main(process.argv.slice(2));
} finally {
  if (process.env.DATABASE_URL) await sql().end();
}
