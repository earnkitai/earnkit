import { z } from 'zod';
import { sql } from './db';
import { getProgramRow } from './programs';
import { ProjectInfo } from './submission';
import { tokenOffer } from './tokens';

export const RecordSubmissionInput = z
  .object({
    program_id: z.string(),
    project: ProjectInfo.extend({ name: z.string().trim().min(1) }),
    /** The final answers that were actually submitted, by requirement key. */
    submission_data: z.record(z.string(), z.unknown()),
    external_submission_url: z.string().url().optional(),
  })
  .strict();

/** Stores a project after it was actually submitted to the external program. */
export async function recordSubmission(
  input: z.infer<typeof RecordSubmissionInput>,
  installationId: number,
) {
  await getProgramRow(input.program_id);
  const { name, description, repo_url, live_url, demo_url, token_url } =
    input.project;

  return sql().begin(async (tx) => {
    const [project] = await tx<{ id: number; submitted_at: Date }[]>`
      INSERT INTO projects ${tx({
        program_id: input.program_id,
        name,
        description: description ?? null,
        repo_url: repo_url ?? null,
        live_url: live_url ?? null,
        demo_url: demo_url ?? null,
        token_url: token_url ?? null,
        installation_id: installationId,
      })} RETURNING id, submitted_at`;
    await tx`INSERT INTO submissions ${tx({
      project_id: project.id,
      submission_data: tx.json(input.submission_data as never),
      external_submission_url: input.external_submission_url ?? null,
    })}`;
    return {
      recorded: true,
      project_id: project.id,
      submitted_at: project.submitted_at.toISOString(),
      ...(!token_url && { next: tokenOffer(name) }),
    };
  });
}
