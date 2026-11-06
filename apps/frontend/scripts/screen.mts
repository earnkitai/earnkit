/**
 * pnpm screen <csv> --program <id> [--chain base] [--out <dir>] [--no-cache] [--thresholds <json>]
 * Screens a program's applicant list into a markdown and a CSV report; `run` is in lib/v6/screen.ts. Reads public
 * evidence only; GITHUB_TOKEN in the shell raises the GitHub limit, DATABASE_URL turns the cache on.
 */
import { run } from '../lib/v6/screen';

const r = await run(process.argv.slice(2), { now: new Date(), log: (line) => console.log(line) });
if (process.env.DATABASE_URL) {
  const { sql } = await import('../lib/v5/db');
  await sql().end();
}
process.exit(r.code);
