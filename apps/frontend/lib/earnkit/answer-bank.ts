import { sql } from './db';
import { normalizeRepoUrl } from './campaigns';
import { FIELD_KINDS, type FieldKind, type SubmissionRequirement } from './program-file';
import { bankEntries, type Application } from './coach';

/**
 * v2.8 Ruling 6 (plan): the answer bank. The builder's confirmed answers per project and field kind,
 * for this installation only, so the next program asks at most one new question.
 *
 * Privacy: read only here, only for the same installation. Never shown on a public page, in
 * /api/stats, on an admin page or the bonus board, and never logged (callers log error classes
 * only). The same rule covers projects.application.
 */

/** The bank's project key: the normalized repo, else `name:<lowercased trimmed name>`. Pure. */
export function projectKey(project: { repo_url?: string | null; name: string }): string {
  const repo = project.repo_url?.trim();
  return repo ? normalizeRepoUrl(repo) : `name:${project.name.trim().toLowerCase()}`;
}

const isKind = (k: string): k is FieldKind => (FIELD_KINDS as readonly string[]).includes(k);

/** This installation's banked answers for one project, by kind. */
export async function readBank(installationId: number, key: string): Promise<Map<FieldKind, string>> {
  const rows = await sql()<{ kind: string; answer: string }[]>`
    SELECT kind, answer FROM answer_bank WHERE installation_id = ${installationId} AND project_key = ${key}`;
  return new Map(rows.flatMap((r) => (isKind(r.kind) && r.kind !== 'other' ? [[r.kind, r.answer] as const] : [])));
}

/** Banks confirmed answers, one row per kind; the latest wins. `other` is never banked. */
export async function saveBank(
  installationId: number,
  key: string,
  programId: string,
  reqs: SubmissionRequirement[],
  answers: Record<string, string>,
): Promise<void> {
  const entries = bankEntries(reqs, answers, await readBank(installationId, key));
  for (const [kind, answer] of entries)
    await sql()`
      INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id, updated_at)
      VALUES (${installationId}, ${key}, ${kind}, ${answer}, ${programId}, now())
      ON CONFLICT (installation_id, project_key, kind)
      DO UPDATE SET answer = EXCLUDED.answer, program_id = EXCLUDED.program_id, updated_at = now()`;
}

/** Part D.5: the application snapshot on the entry (its own installation's row only). */
export async function saveApplication(installationId: number, projectId: number, app: Application): Promise<void> {
  await sql()`
    UPDATE projects SET application = ${sql().json(app)}
    WHERE id = ${projectId} AND installation_id = ${installationId}`;
}
