import { z } from 'zod';
import { sql } from './db';
import {
  EntryError,
  normalizeLiveUrl,
  normalizeRepoUrl,
  sameRepoEntry,
  validateEntry,
  type Deployment,
} from './campaigns';
import { formatDeadline } from './dates';
import {
  checkOwnership,
  type DeployerLookup,
  type RepoFactsLookup,
} from './ownership';
import { getProgramRow, isOpen, type ProgramRow } from './programs';
import { BASE_MAINNET, CANT_RECEIVE, screenWallet } from './sanctions';
import { ProjectInfo, prepareSubmission } from './submission';
import { ENTRIES_PER_CAMPAIGN } from './rate-limit';
import { tokenOffer } from './tokens';
import {
  RAW_CAP,
  builderUrlProblem,
  cleanProject,
  quoted,
} from './untrusted-text';

export const RecordSubmissionInput = z
  .object({
    program_id: z.string(),
    project: ProjectInfo.extend({
      name: z.string().max(RAW_CAP).trim().min(1),
    }),
    /** The final answers that were actually submitted, by requirement key. */
    submission_data: z.record(z.string(), z.unknown()),
    external_submission_url: z.string().url().optional(),
  })
  .strict();

/** submission_data as prepareSubmission's answers: strings, lists joined with ", ". */
export const answersOf = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]),
  );

/**
 * Why a campaign entry is missing required answers, or null: prepareSubmission's `missing` items
 * that are required (absent, or present but invalid). Pure; exported for tests.
 */
export function missingAnswersProblem(
  requirements: ProgramRow['submission_requirements'],
  project: z.infer<typeof ProjectInfo>,
  data: Record<string, unknown>,
): string | null {
  const { ready, missing } = prepareSubmission(requirements, {
    project,
    answers: answersOf(data),
  });
  if (ready) return null;
  const items = missing
    .filter((m) => m.required)
    .map((m) => `${m.key} (${m.label}${m.problem ? `: ${m.problem}` : ''})`);
  return `Missing required answers: ${items.join(', ')}. Call prepare_submission to see what each needs, then record_submission again.`;
}

/**
 * Why `installationId` can't enter a sponsor's campaign, or null: it is the sponsor's own
 * installation, or the payout wallet is the sponsor's wallet. Pure; exported for tests.
 */
export function selfEntryProblem(
  sponsor: { installation_id: number; sponsor_wallet: string | null } | null,
  installationId: number,
  payoutWallet: string,
): string | null {
  if (!sponsor) return null;
  if (sponsor.installation_id === installationId)
    return "You created this campaign, so you can't enter it.";
  if (sponsor.sponsor_wallet?.toLowerCase() === payoutWallet.toLowerCase())
    return "payout_wallet: that's the sponsor's wallet, which can't enter its own campaign.";
  return null;
}

/** The entry's repo link: project.repo_url, else submission_data.repo_url; both must agree. */
function entryRepoUrl(
  projectRepo: string | undefined,
  data: Record<string, unknown>,
) {
  const answer =
    typeof data.repo_url === 'string' && data.repo_url.trim()
      ? data.repo_url.trim()
      : undefined;
  if (
    projectRepo &&
    answer &&
    normalizeRepoUrl(projectRepo) !== normalizeRepoUrl(answer)
  )
    throw new EntryError(
      'repo_url: project.repo_url and submission_data.repo_url are different repos; enter one.',
    );
  return projectRepo || answer;
}

/**
 * How a campaign entry's contracts are checked: EarnKit campaigns require contracts; sponsor
 * campaigns don't. With existing_work 'allowed', contracts deployed before the start are accepted
 * (scoring still counts only use inside the campaign window). Pure; exported for tests.
 */
export const entryRules = (
  kind: 'earnkit' | 'sponsor',
  existingWork: string,
) => ({
  requireContracts: kind === 'earnkit',
  allowExisting: existingWork === 'allowed',
});

/** Stores a project after it was actually submitted to the external program. */
export async function recordSubmission(
  input: z.infer<typeof RecordSubmissionInput>,
  installationId: number,
  /** Chain and explorer reads, injectable for the local e2e (contracts on anvil, not Base). */
  deps: {
    status?: (contract: string) => Promise<Deployment>;
    deployer?: DeployerLookup;
    repoFacts?: RepoFactsLookup;
  } = {},
) {
  const program = await getProgramRow(input.program_id);
  // A campaign entry's name and description reach the sponsor's agent: cleaned like all
  // third-party text. Other programs' projects go only to the builder's own submission.
  const cleaned = program.campaign
    ? cleanProject(input.project)
    : input.project;
  const { name, description, live_url, demo_url, token_url } = cleaned;
  let repo_url = cleaned.repo_url;

  // EarnKit campaigns: this call *is* the entry, so check it before storing anything.
  let entry: { contracts: string[]; payoutWallet: string } | null = null;
  let proof: Awaited<ReturnType<typeof checkOwnership>> | null = null;
  if (program.campaign) {
    if (!isOpen(program)) throw new EntryError('This campaign is closed.');
    const [sponsor] = await sql()<
      { installation_id: number; sponsor_wallet: string | null }[]
    >`SELECT installation_id, sponsor_wallet FROM sponsor_campaigns WHERE program_id = ${program.id}`;
    if (sponsor?.installation_id === installationId)
      throw new EntryError(selfEntryProblem(sponsor, installationId, '')!);
    const missing = missingAnswersProblem(
      program.submission_requirements,
      cleaned,
      input.submission_data,
    );
    if (missing) throw new EntryError(missing);
    repo_url = entryRepoUrl(repo_url, input.submission_data);
    const repoProblem = repo_url ? builderUrlProblem(repo_url) : null;
    if (repoProblem) throw new EntryError(`repo_url: ${repoProblem}.`);
    entry = await validateEntry(input.submission_data, program, {
      ...entryRules(program.campaign.kind, program.existing_work),
      status: deps.status,
    });
    const self = selfEntryProblem(
      sponsor ?? null,
      installationId,
      entry.payoutWallet,
    );
    if (self) throw new EntryError(self);
    // Proof of ownership: the repo's earnkit.txt names this payout wallet (and the contracts).
    if (!repo_url)
      throw new EntryError(
        'repo_url: campaign entries need the public GitHub repo of the project.',
      );
    proof = await checkOwnership(
      {
        repoUrl: repo_url,
        payoutWallet: entry.payoutWallet,
        contracts: entry.contracts,
      },
      { deployer: deps.deployer, repoFacts: deps.repoFacts },
    );
    await screenWallet(
      entry.payoutWallet,
      program.campaign.kind === 'sponsor'
        ? program.campaign.prize.chain_id
        : BASE_MAINNET,
      `payout_wallet: ${CANT_RECEIVE}`,
    );
  }

  // Campaign entries store the normalized repo; a unique index on (program_id, repo_key) backs
  // the check below at the database level.
  const repoKey = (entry && repo_url && normalizeRepoUrl(repo_url)) || null;
  // One entry per live link too (copied work pointing at someone else's site).
  const liveKey = (entry && live_url && normalizeLiveUrl(live_url)) || null;
  const liveEntered = (same: { id: number }) =>
    new EntryError(`This live link is already entered (entry #${same.id}).`);
  // Other entries are referred to by number only: never repeat another builder's text.
  const alreadyEntered = (same: { id: number }) =>
    new EntryError(
      `repo_url: this repo is already entered in this campaign (entry #${same.id}).`,
    );

  return sql()
    .begin(async (tx) => {
      if (entry) {
        // One entry per repo and per contract in a campaign. Entries for the same campaign are
        // serialized, so two agents entering the same repo at once can't both get in.
        await tx`SELECT pg_advisory_xact_lock(hashtext(${'entry:' + program.id}))`;
        // At most 3 entries per installation per campaign (v2.2 §5); the lock makes the count exact.
        const [{ n }] = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM projects
          WHERE program_id = ${program.id} AND installation_id = ${installationId}
            AND payout_wallet IS NOT NULL`;
        if (n >= ENTRIES_PER_CAMPAIGN)
          throw new EntryError(
            `This agent already has ${n} entries in this campaign, the most allowed (${ENTRIES_PER_CAMPAIGN}).`,
          );
        if (repo_url) {
          const same = sameRepoEntry(
            repo_url,
            await tx<{ id: number; repo_url: string | null }[]>`
            SELECT id, repo_url FROM projects
            WHERE program_id = ${program.id} AND repo_url IS NOT NULL`,
          );
          if (same) throw alreadyEntered(same);
        }
        if (liveKey) {
          const [same] = await tx<{ id: number }[]>`
          SELECT id FROM projects WHERE program_id = ${program.id} AND live_key = ${liveKey}`;
          if (same) throw liveEntered(same);
        }
        if (entry.contracts.length > 0) {
          const [taken] = await tx<{ id: number }[]>`
          SELECT id FROM projects
          WHERE program_id = ${program.id} AND contracts && ${entry.contracts}::text[]`;
          if (taken)
            throw new EntryError(
              `contracts: already used by entry #${taken.id}.`,
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
        live_key: liveKey,
        repo_created_at: proof?.repo_created_at ?? null,
        repo_pushed_at: proof?.repo_pushed_at ?? null,
        contracts: entry?.contracts ?? null,
      })} RETURNING id, submitted_at`;
      // Remembered for this installation's next entry (prepare_submission prefills it).
      if (entry)
        await tx`UPDATE installations SET payout_wallet = ${entry.payoutWallet} WHERE id = ${installationId}`;
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
              `If you win, the prize goes to ${entry.payoutWallet} on Base. Tell the builder, and make sure they control that wallet.`,
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
        const [same] = await sql()<{ id: number }[]>`
          SELECT id FROM projects WHERE program_id = ${program.id} AND repo_key = ${repoKey}`;
        if (same) throw alreadyEntered(same);
      }
      if (
        liveKey &&
        (err as { code?: string }).code === '23505' &&
        (err as { constraint_name?: string }).constraint_name ===
          'projects_campaign_live_key'
      ) {
        const [same] = await sql()<{ id: number }[]>`
          SELECT id FROM projects WHERE program_id = ${program.id} AND live_key = ${liveKey}`;
        if (same) throw liveEntered(same);
      }
      throw err;
    });
}
