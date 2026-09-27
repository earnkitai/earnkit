import './env.mts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProgramFile } from '../lib/earnkit/program-file';

/**
 * pnpm program:upsert programs/<slug>.json [--check]
 * Validates the file, then writes it to the database (unless --check).
 */
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: pnpm program:upsert programs/<slug>.json [--check]');
  process.exit(1);
}

const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
const result = ProgramFile.safeParse(JSON.parse(readFileSync(path, 'utf8')));
if (!result.success) {
  console.error(`${file} is not valid:`);
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(program)'}: ${issue.message}`);
  }
  process.exit(1);
}

const p = result.data;
const summary = `${p.id}: ${p.tracks.length} tracks, ${p.starters.length} starters, ${p.submission_requirements.length} submission fields`;
if (checkOnly) {
  console.log(`Valid. ${summary}`);
  process.exit(0);
}

const { upsertProgram } = await import('../lib/earnkit/programs');
const { sql } = await import('../lib/earnkit/db');
await upsertProgram(p);
console.log(`Upserted ${summary}`);
await sql().end();
