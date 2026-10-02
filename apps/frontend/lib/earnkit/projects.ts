import { z } from 'zod';
import { sql } from './db';
import {
  EntryError,
  normalizeRepoUrl,
  sameRepoEntry,
  validateEntry,
} from './campaigns';
import { formatDeadline } from './dates';
import { getProgramRow, isOpen } from './programs';
import { ProjectInfo } from './submission';
import { tokenOffer } from './tokens';
import { cleanProject, quoted } from './untrusted-text';

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
  // A campaign entry's name and description reach the sponsor's agent: cleaned like all
  // third-party text. Other programs' projects go only to the builder's own submission.
  const { name, description, repo_url, live_url, demo_url, token_url } =
    program.campaign ? cleanProject(input.project) : input.project;

  // EarnKit campaigns: this call *is* the entry, so check it before storing anything.
  let entry: { contracts: string[]; payoutWallet: string } | null = null;
  if (program.campaign) {
    if (!isOpen(program)) throw new EntryError('This campaign is closed.');
    entry = await validateEntry(input.submission_data, program, {
      requireContracts: program.campaign.kind === 'earnkit',
    });
  }

  // Campaign entries store the normalized repo; a unique index on (program_id, repo_key) backs
  // the check below at the database level.
  const repoKey = (entry && repo_url && normalizeRepoUrl(repo_url)) || null;
  const alreadyEntered = (same: { id: number; name: string }) =>
    new EntryError(
      `repo_url: already entered as "${same.name}" (entry #${same.id}).`,
    );

  return sql()
    .begin(async (tx) => {
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
          if (same) throw alreadyEntered(same);
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
        repo_key: repoKey,
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
              `Entered ${program.campaign.kind === 'sponsor' ? quoted(program.title) : program.title}. ` +
              (program.campaign.kind === 'earnkit'
                ? `Scored on unique wallets using ${entry.contracts.join(', ')} until ${program.ends_at ? formatDeadline(program.ends_at) : 'the deadline'}; ` +
                  `at least ${program.campaign.min_score} to be eligible. `
                : `The sponsor picks winners after ${program.ends_at ? formatDeadline(program.ends_at) : 'the deadline'}${entry.contracts.length ? `; EarnKit scores ${entry.contracts.join(', ')} as a guide` : ''}. `) +
              `If you win, the prize goes to ${entry.payoutWallet} on Base. Tell the builder, and make sure your agent controls that wallet.`,
          }),
        ...(!token_url && { next: tokenOffer(name) }),
      };
    })
    .catch(async (err: unknown) => {
      // Only reachable if a row got in without the lock: same friendly error as the check.
      if (
        repoKey &&
        (err as { code?: string; constraint_name?: string }).code === '23505' &&
        (err as { constraint_name?: string }).constraint_name ===
          'projects_campaign_repo_key'
      ) {
        const [same] = await sql()<{ id: number; name: string }[]>`
          SELECT id, name FROM projects WHERE program_id = ${program.id} AND repo_key = ${repoKey}`;
        if (same) throw alreadyEntered(same);
      }
      throw err;
    });
}
