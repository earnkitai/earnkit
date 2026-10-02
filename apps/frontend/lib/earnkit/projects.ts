import { z } from 'zod';
import { sql } from './db';
import { EntryError, sameRepoEntry, validateEntry } from './campaigns';
import { formatDeadline } from './dates';
import { getProgramRow, isOpen } from './programs';
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
  const program = await getProgramRow(input.program_id);
  const { name, description, repo_url, live_url, demo_url, token_url } =
    input.project;

  // EarnKit campaigns: this call *is* the entry, so check it before storing anything.
  let entry: { contracts: string[]; payoutWallet: string } | null = null;
  if (program.campaign) {
    if (!isOpen(program)) throw new EntryError('This campaign is closed.');
    entry = await validateEntry(input.submission_data, program, {
      requireContracts: program.campaign.kind === 'earnkit',
    });
  }

  return sql().begin(async (tx) => {
    if (entry) {
      // One entry per repo and per contract in a campaign. Entries for the same campaign are
      // serialized, so two agents entering the same repo at once can't both get in.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'entry:' + program.id}))`;
      if (repo_url) {
        const same = sameRepoEntry(
          repo_url,
          await tx<{ id: number; name: string; repo_url: string | null }[]>`
            SELECT id, name, repo_url FROM projects
            WHERE program_id = ${program.id} AND repo_url IS NOT NULL`,
        );
        if (same)
          throw new EntryError(
            `repo_url: already entered as "${same.name}" (entry #${same.id}).`,
          );
      }
      if (entry.contracts.length > 0) {
        const [taken] = await tx<{ name: string }[]>`
          SELECT name FROM projects
          WHERE program_id = ${program.id} AND contracts && ${entry.contracts}::text[]`;
        if (taken)
          throw new EntryError(
            `contracts: already entered by "${taken.name}".`,
          );
      }
    }
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
        payout_wallet: entry?.payoutWallet ?? null,
        contracts: entry?.contracts ?? null,
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
      ...(entry &&
        program.campaign && {
          campaign_entry:
            `Entered ${program.title}. ` +
            (program.campaign.kind === 'earnkit'
              ? `Scored on unique wallets using ${entry.contracts.join(', ')} until ${program.ends_at ? formatDeadline(program.ends_at) : 'the deadline'}; ` +
                `at least ${program.campaign.min_score} to be eligible. `
              : `The sponsor picks winners after ${program.ends_at ? formatDeadline(program.ends_at) : 'the deadline'}${entry.contracts.length ? `; EarnKit scores ${entry.contracts.join(', ')} as a guide` : ''}. `) +
            `If you win, the prize goes to ${entry.payoutWallet} on Base. Tell the builder, and make sure your agent controls that wallet.`,
        }),
      ...(!token_url && { next: tokenOffer(name) }),
    };
  });
}
