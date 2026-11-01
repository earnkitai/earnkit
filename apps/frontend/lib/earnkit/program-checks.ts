import type { ZodError } from 'zod';
import { checkLogoFile } from './logo-check';
import { ProgramFile, freshBuildProblems, needsRepoMissing, requiredWithoutTodo, requirementsWithoutKind } from './program-file';

/**
 * v4.9 Task 1: one set of program checks, for `pnpm programs:check`/`programs:sync` and the programs write API.
 *
 * The schema's own rules (the Optimism refusal, the shared-host refusal for proof_hosts, any_chain
 * min_product_score and the rest of ProgramFile's refinements) stay in the schema, so every parse keeps them; this
 * re-runs them on `p`, so a value that never went through the schema (an API body, a test object) is held to them
 * too. The check-time rules (a todo and a kind on each requirement, needs_repo, fresh_build, the logo file) follow,
 * as the sync script printed them before.
 */

/** A schema failure as `programs:check` prints it: "<path or (program)>: <message>", one per issue. Pure. */
export const schemaProblems = (error: ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join('.') || '(program)'}: ${issue.message}`);

/**
 * Every problem with a program, empty when it may be written. Schema problems come first and, as in the sync script,
 * stop there (the check-time rules read a well-formed program). `publicDir` is where `logo.path` resolves
 * (apps/frontend/public in the script; a fixture directory in tests). Reads only the logo file.
 */
export function programProblems(p: ProgramFile, opts: { publicDir: string }): string[] {
  const parsed = ProgramFile.safeParse(p);
  if (!parsed.success) return schemaProblems(parsed.error);
  const q = parsed.data;
  const problems: string[] = [];
  // v2.7 Ruling C5 carry: every required submission item needs its builder to-do phrase.
  const noTodo = requiredWithoutTodo(q);
  if (noTodo.length > 0) problems.push(`submission_requirements: add a "todo" to each required item (${noTodo.join(', ')})`);
  // v2.8 Ruling 9 (plan): every requirement needs its field kind (the coach's guidance and bank).
  const noKind = requirementsWithoutKind(q);
  if (noKind.length > 0) problems.push(`submission_requirements: add a "kind" to each item (${noKind.join(', ')})`);
  // v2.8.1 §B8 (fix round 1): whether entering needs a repo is the author's call, from the source.
  if (needsRepoMissing(q)) problems.push('needs_repo: say whether entering needs a repo or a live product (true or false)');
  // v2.11 T5 (spec 2): a fresh_build names a known, tested starter on one of the program's chains.
  problems.push(...freshBuildProblems(q));
  // v2.7 Ruling 23 (plan): the logo file exists under publicDir and is safe to serve.
  if (q.logo) {
    const logo = checkLogoFile(q.logo, opts.publicDir);
    if (logo) problems.push(logo);
  }
  return problems;
}
