import './env.mts';
import { join } from 'node:path';

/**
 * pnpm programs:check validates every programs/*.json; pnpm programs:sync validates, then writes
 * each to the database as a file program (runs before each deploy). Nothing is written when any
 * file is invalid. An active file past its ends_at is written as closed, with a warning (both modes).
 */
const checkOnly = process.argv.includes('--check');
const dir = join(import.meta.dirname, '..', '..', '..', 'programs');
const now = new Date();
const { readProgramFiles } = await import('../lib/v5/programs-sync');

const files = readProgramFiles(dir, now);
for (const line of files.invalid) console.error(line);
if (files.invalid.length > 0) process.exit(1);
for (const w of files.warnings) console.warn(w);

if (checkOnly) {
  for (const { f } of files.programs) console.log(`Valid: ${f}`);
  console.log(`${files.programs.length} valid files`);
  process.exit(0);
}

const { syncFiles } = await import('../lib/v5/programs-sync');
const { sql } = await import('../lib/v5/db');
for (const line of (await syncFiles(dir, now)).written) console.log(line);
await sql().end();
