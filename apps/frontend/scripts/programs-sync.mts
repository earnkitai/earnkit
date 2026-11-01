import './env.mts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OutcomeFile } from '../lib/earnkit/outcomes';
import { programProblems, schemaProblems } from '../lib/earnkit/program-checks';
import { ProgramFile, agentCompletableOf, starterAgeWarnings } from '../lib/earnkit/program-file';

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
  for (const problem of schemaProblems(result.error!)) console.error(`  - ${problem}`);
}
// v2.7 Ruling 23 (plan): a program's logo file must exist under apps/frontend/public and be safe
// to serve, checked before any DB write, in both --check and sync. v4.9 T1: every per-file check
// (todo, kind, needs_repo, fresh_build, logo) is program-checks.ts programProblems, the one set the
// programs write API runs too.
const publicDir = join(import.meta.dirname, '..', 'public');
const fileProblems: { f: string; problem: string }[] = [];
for (const { f, result } of parsed) {
  if (!result.success) continue;
  for (const problem of programProblems(result.data, { publicDir })) fileProblems.push({ f, problem });
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

// Final fix I4: a starter going stale is the owner's notice, never a failure (fresh-build.ts stops
// offering it at 30 days on its own).
for (const w of starterAgeWarnings(parsed.flatMap(({ result }) => (result.success ? [result.data] : [])), new Date()))
  console.warn(`Warning: ${w}`);

if (invalid.length > 0 || fileProblems.length > 0 || outcomeProblems > 0) process.exit(1);

// v2.12 spec 9: what programs.agent_completable gets (the file's override, else the derivation);
// find leaves out the programs an agent can't complete.
const notCompletable = parsed.filter(({ result }) => result.success && !agentCompletableOf(result.data)).map(({ f }) => f);
console.log(`Agent-completable: ${parsed.length - notCompletable.length} of ${parsed.length}${notCompletable.length ? ` (not: ${notCompletable.join(', ')})` : ''}`);

if (checkOnly) {
  for (const { f } of parsed) console.log(`Valid: ${f}`);
  for (const { f } of outcomes) console.log(`Valid: outcomes/${f}`);
  process.exit(0);
}

const { upsertProgram } = await import('../lib/earnkit/programs');
const { sql } = await import('../lib/earnkit/db');
const { noteFileTakeover } = await import('../lib/earnkit/programs-api');
for (const { f, result } of parsed) {
  // v4.9 Task 2 (controller ruling 2): files win (R3), but never silently over a program the write API made.
  if (await noteFileTakeover(result.data!.id)) console.warn(`[programs] file ${result.data!.id} took over an api program`);
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
