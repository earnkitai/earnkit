import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { programProblems } from './program-checks';
import { ProgramFile, categoryOf } from './program-file';
import { upsertProgram } from './programs';

const db = { skip: !process.env.DATABASE_URL };
const PROGRAMS = join(import.meta.dirname, '../../../../programs');
const PUBLIC = join(import.meta.dirname, '../../public');
const file = (name: string): ProgramFile => ProgramFile.parse(JSON.parse(readFileSync(join(PROGRAMS, `${name}.json`), 'utf8')));

after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});

test('v4.9 T1: programProblems finds nothing in any committed program file', () => {
  const names = readdirSync(PROGRAMS).filter((f) => f.endsWith('.json'));
  assert.ok(names.length > 0);
  for (const f of names) assert.deepEqual(programProblems(file(f.replace(/\.json$/, '')), { publicDir: PUBLIC }), [], f);
});

test('v4.9 T1: programProblems prints what programs:check printed (a missing todo, an optimism.io submission_url)', () => {
  // Captured from `pnpm programs:check` before the refactor, on a copy of base-builder-grants with no todo on its
  // required items, no kind on its first item and no needs_repo.
  const base = committedProgram('base-builder-grants');
  const noTodo = structuredClone(base);
  for (const r of noTodo.submission_requirements) if (r.required) delete r.todo;
  delete noTodo.submission_requirements[0].kind;
  delete noTodo.needs_repo;
  const keys = (base.submission_requirements as { key: string; required: boolean }[]).filter((r) => r.required).map((r) => r.key);
  assert.deepEqual(programProblems(ProgramFile.parse(noTodo), { publicDir: PUBLIC }), [
    `submission_requirements: add a "todo" to each required item (${keys.join(', ')})`,
    `submission_requirements: add a "kind" to each item (${base.submission_requirements[0].key})`,
    'needs_repo: say whether entering needs a repo or a live product (true or false)',
  ]);

  // An object that never went through the schema is still held to its rules (the API's case).
  const optimism = { ...file('a16z-speedrun'), submission_url: 'https://app.optimism.io/grants' };
  assert.deepEqual(programProblems(optimism, { publicDir: PUBLIC }), ['(program): Optimism programs are not listed']);
  // base-builder-grants also has a form, so its submit host changing adds the script's form line after it.
  assert.deepEqual(programProblems({ ...file('base-builder-grants'), submission_url: 'https://app.optimism.io/grants' }, { publicDir: PUBLIC }), [
    '(program): Optimism programs are not listed',
    '(program): form is only for a Google, Airtable or Tally form on the submit host',
  ]);

  // The logo file, and the schema's shared-host and any_chain rules.
  assert.deepEqual(programProblems({ ...file('base-builder-grants'), id: 'tmp-v49-c', logo: { ...file('base-builder-grants').logo!, path: 'programs/tmp-v49-c.svg' } }, { publicDir: PUBLIC }), [
    'logo.path: programs/tmp-v49-c.svg not found under apps/frontend/public',
  ]);
  assert.deepEqual(programProblems({ ...file('a16z-speedrun'), proof_hosts: ['github.com/'] }, { publicDir: PUBLIC }), [
    'proof_hosts.0: not a shared host, a public suffix or earnkit.com',
  ]);
  assert.ok(programProblems({ ...file('a16z-speedrun'), chains: [], any_chain: true, min_product_score: 0 }, { publicDir: PUBLIC }).includes(
    '(program): any_chain programs need min_product_score of 5 or more',
  ));
});

test('v4.9 T1: categoryOf derives investment, grant and hackathon; an explicit category wins', () => {
  assert.equal(categoryOf(file('a16z-speedrun')), 'investment');
  assert.equal(categoryOf(file('base-builder-grants')), 'grant');
  assert.equal(categoryOf(file('ethglobal-mumbai')), 'hackathon', 'in person');
  const poolOnly = { ...file('arc-microgrants'), max_award_usd: undefined, min_award_usd: undefined, pitch: undefined };
  assert.equal(poolOnly.pool_usd !== undefined, true);
  assert.equal(categoryOf(poolOnly), 'hackathon', 'a pool with no per-winner amount');
  assert.equal(categoryOf({ ...file('a16z-speedrun'), category: 'bounty' }), 'bounty');
  assert.equal(categoryOf({ ...file('base-builder-grants'), category: 'hackathon' }), 'hackathon');
  assert.equal(ProgramFile.safeParse({ ...committedProgram('base-builder-grants'), category: 'prize' }).success, false);
});

test("v4.9 T1: upsertProgram(p, 'api') stores source 'api' and the category; a file sync stores its category", db, async () => {
  const id = `v49-api-${process.pid}`;
  await upsertProgram(ProgramFile.parse({ ...committedProgram('a16z-speedrun'), id }), 'api');
  const [row] = await sql()<{ source: string; category: string }[]>`SELECT source, category FROM programs WHERE id = ${id}`;
  assert.deepEqual({ ...row }, { source: 'api', category: 'investment' });

  await upsertProgram(ProgramFile.parse({ ...committedProgram('a16z-speedrun'), id, category: 'bounty' }), 'api');
  const [again] = await sql()<{ category: string }[]>`SELECT category FROM programs WHERE id = ${id}`;
  assert.equal(again.category, 'bounty');

  const fileId = `v49-file-${process.pid}`;
  await upsertProgram(ProgramFile.parse({ ...committedProgram('base-builder-grants'), id: fileId }));
  const [f] = await sql()<{ source: string; category: string }[]>`SELECT source, category FROM programs WHERE id = ${fileId}`;
  assert.deepEqual({ ...f }, { source: 'file', category: 'grant' });
});

test('v4.9 T1: program_writes exists with its columns', db, async () => {
  const cols = await sql()<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'program_writes' ORDER BY ordinal_position`;
  assert.deepEqual(cols.map((c) => c.column_name), ['id', 'at', 'program_id', 'action', 'result', 'reason', 'body']);
});
