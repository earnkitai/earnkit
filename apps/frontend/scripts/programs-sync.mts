import './env.mts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { programProblems } from '../lib/v5/program-checks';
import type { Program } from '../lib/v5/program-file';

/**
 * pnpm programs:check validates every programs/*.json; pnpm programs:sync validates, then writes
 * each to the database as a file program (runs before each deploy). Nothing is written when any
 * file is invalid.
 */
const checkOnly = process.argv.includes('--check');
const dir = join(import.meta.dirname, '..', '..', '..', 'programs');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

let invalid = 0;
const programs: { f: string; p: Program }[] = [];
for (const f of files) {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch {
    console.error(`${f} is not valid:\n  - not JSON`);
    invalid++;
    continue;
  }
  const problems = programProblems(raw as Program);
  const id = (raw as { id?: unknown }).id;
  if (problems.length === 0 && f !== `${id}.json`) problems.push(`the file is named <id>.json (${id}.json)`);
  if (problems.length > 0) {
    console.error(`${f} is not valid:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    invalid++;
    continue;
  }
  programs.push({ f, p: raw as Program });
}
if (invalid > 0) process.exit(1);

if (checkOnly) {
  for (const { f } of programs) console.log(`Valid: ${f}`);
  console.log(`${programs.length} valid files`);
  process.exit(0);
}

const { upsertProgram } = await import('../lib/v5/programs');
const { sql } = await import('../lib/v5/db');
for (const { f, p } of programs) console.log(`${f}: ${await upsertProgram(p, 'file')}`);
await sql().end();
