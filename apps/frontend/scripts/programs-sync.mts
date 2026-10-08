import './env.mts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkLogoFile } from '../lib/earnkit/logo-check';
import { OutcomeFile } from '../lib/earnkit/outcomes';
import { ProgramFile, needsRepoMissing, requiredWithoutTodo, requirementsWithoutKind } from '../lib/earnkit/program-file';

/**
 * pnpm programs:check — validates every programs/*.json.
 * pnpm programs:sync  — validates, then writes them all to the database (runs before each deploy).
 * v2.8 Part G, Ruling 30 (plan): programs/outcomes/*.json (announced results) are validated in both,
 * and sync matches them to EarnKit entries. Output is counts only, never names.
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
  // v2.8.1 §B8 (fix round 1): whether entering needs a repo is the author's call, from the source.
  if (needsRepoMissing(result.data))
    fileProblems.push({ f, problem: 'needs_repo: say whether entering needs a repo or a live product (true or false)' });
  const logo = result.data.logo;
  if (!logo) continue;
  const problem = checkLogoFile(logo, publicDir);
  if (problem) fileProblems.push({ f, problem });
}
for (const { f, problem } of fileProblems) {
  console.error(`${f} is not valid:`);
  console.error(`  - ${problem}`);
}

// v2.8 Part G: announced results, one file per program round set (programs/outcomes/<program-id>.json).
const outcomesDir = join(dir, 'outcomes');
const outcomeFiles = existsSync(outcomesDir)
  ? readdirSync(outcomesDir).filter((f) => f.endsWith('.json')).sort()
  : [];
const programIds = new Set(parsed.flatMap(({ result }) => (result.success ? [result.data.id] : [])));
const outcomes = outcomeFiles.map((f) => ({
  f,
  result: OutcomeFile.safeParse(JSON.parse(readFileSync(join(outcomesDir, f), 'utf8'))),
}));
let outcomeProblems = 0;
for (const { f, result } of outcomes) {
  const problems = result.success
    ? [
        ...(programIds.has(result.data.program_id) ? [] : [`program_id: no programs/${result.data.program_id}.json`]),
        ...(f === `${result.data.program_id}.json` ? [] : [`the file is named <program_id>.json`]),
      ]
    : result.error.issues.map((i) => `${i.path.join('.') || '(file)'}: ${i.message}`);
  if (problems.length === 0) continue;
  outcomeProblems++;
  console.error(`outcomes/${f} is not valid:`);
  for (const p of problems) console.error(`  - ${p}`);
}

if (invalid.length > 0 || fileProblems.length > 0 || outcomeProblems > 0) process.exit(1);

if (checkOnly) {
  for (const { f } of parsed) console.log(`Valid: ${f}`);
  for (const { f } of outcomes) console.log(`Valid: outcomes/${f}`);
  process.exit(0);
}

const { upsertProgram } = await import('../lib/earnkit/programs');
const { sql } = await import('../lib/earnkit/db');
for (const { f, result } of parsed) {
  await upsertProgram(result.data!);
  console.log(`Synced ${f}`);
}
const { syncOutcomeFile } = await import('../lib/earnkit/outcomes');
for (const { f, result } of outcomes) {
  const { matched, unmatched, others } = await syncOutcomeFile(result.data!);
  console.log(`Outcomes ${f}: ${matched} matched, ${unmatched} unmatched, ${others} others labelled`);
}
// v2.9 A8: the outcome feedback loop (match floors and precision), after the announced results.
const { updateMatchFloors } = await import('../lib/earnkit/match-loop');
const { updated } = await updateMatchFloors();
console.log(`Match floors: ${updated} program${updated === 1 ? '' : 's'} with 30 or more labelled entries`);
await sql().end();
