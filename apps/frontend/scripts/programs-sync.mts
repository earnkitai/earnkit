import './env.mts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkLogoFile } from '../lib/earnkit/logo-check';
import { ProgramFile, requiredWithoutTodo, requirementsWithoutKind } from '../lib/earnkit/program-file';

/**
 * pnpm programs:check — validates every programs/*.json.
 * pnpm programs:sync  — validates, then writes them all to the database (runs before each deploy).
 */
const checkOnly = process.argv.includes('--check');
const dir = join(import.meta.dirname, '..', '..', '..', 'programs');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();

const parsed = files.map((f) => ({
  f,
  result: ProgramFile.safeParse(JSON.parse(readFileSync(join(dir, f), 'utf8'))),
}));
const invalid = parsed.filter((p) => !p.result.success);
for (const { f, result } of invalid) {
  console.error(`${f} is not valid:`);
  for (const issue of result.error!.issues) {
    console.error(`  - ${issue.path.join('.') || '(program)'}: ${issue.message}`);
  }
}
// v2.7 Ruling 23 (plan): a program's logo file must exist under apps/frontend/public and be safe
// to serve, checked before any DB write, in both --check and sync. Ruling C5's required-item todo
// is checked in the same pass.
const publicDir = join(import.meta.dirname, '..', 'public');
const fileProblems: { f: string; problem: string }[] = [];
for (const { f, result } of parsed) {
  if (!result.success) continue;
  // v2.7 Ruling C5 carry: every required submission item needs its builder to-do phrase.
  const noTodo = requiredWithoutTodo(result.data);
  if (noTodo.length > 0)
    fileProblems.push({ f, problem: `submission_requirements: add a "todo" to each required item (${noTodo.join(', ')})` });
  // v2.8 Ruling 9 (plan): every requirement needs its field kind (the coach's guidance and bank).
  const noKind = requirementsWithoutKind(result.data);
  if (noKind.length > 0)
    fileProblems.push({ f, problem: `submission_requirements: add a "kind" to each item (${noKind.join(', ')})` });
  const logo = result.data.logo;
  if (!logo) continue;
  const problem = checkLogoFile(logo, publicDir);
  if (problem) fileProblems.push({ f, problem });
}
for (const { f, problem } of fileProblems) {
  console.error(`${f} is not valid:`);
  console.error(`  - ${problem}`);
}

if (invalid.length > 0 || fileProblems.length > 0) process.exit(1);

if (checkOnly) {
  for (const { f } of parsed) console.log(`Valid: ${f}`);
  process.exit(0);
}

const { upsertProgram } = await import('../lib/earnkit/programs');
const { sql } = await import('../lib/earnkit/db');
for (const { f, result } of parsed) {
  await upsertProgram(result.data!);
  console.log(`Synced ${f}`);
}
await sql().end();
