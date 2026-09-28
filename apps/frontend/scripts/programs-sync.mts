import './env.mts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProgramFile } from '../lib/earnkit/program-file';
import { upsertProgram } from '../lib/earnkit/programs';
import { sql } from '../lib/earnkit/db';

/**
 * pnpm programs:sync — writes every programs/*.json to the database.
 * Runs before each deploy, so the program files in git are the source of truth.
 * Validates all files first and writes nothing if any is invalid.
 */
const dir = join(import.meta.dirname, '..', '..', '..', 'programs');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

const parsed = files.map((f) => ({ f, result: ProgramFile.safeParse(JSON.parse(readFileSync(join(dir, f), 'utf8'))) }));
const invalid = parsed.filter((p) => !p.result.success);
if (invalid.length > 0) {
  for (const { f, result } of invalid) {
    console.error(`${f} is not valid:`);
    for (const issue of result.error!.issues) console.error(`  - ${issue.path.join('.') || '(program)'}: ${issue.message}`);
  }
  process.exit(1);
}

for (const { f, result } of parsed) {
  await upsertProgram(result.data!);
  console.log(`Synced ${f}`);
}
await sql().end();
