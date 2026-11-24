/**
 * pnpm tsx scripts/track-import.mts --file <jenil-ai-grants-export.json> --owner <b:builder id | i:installation id>
 *   [--map <grant id>=<program id | https link>]... [--apply]
 * v3.8 E10: imports the Jenil AI ledger export into the owner's track rows (lib/v6/track-import.ts), with the known
 * hard rows fixed. Dry run unless --apply (a READ ONLY transaction, rolled back); DATABASE_URL from the environment.
 * --map names the program of a grant EarnKit cannot match (Delphi and Ship or Die have no link in the export).
 */
import './env.mts';
import { sql } from '../lib/v5/db';
import { main } from '../lib/v6/track-import';

try {
  await main(process.argv.slice(2));
} finally {
  await sql().end();
}
