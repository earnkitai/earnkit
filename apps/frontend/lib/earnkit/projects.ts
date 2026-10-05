import type postgres from 'postgres';
import { z } from 'zod';
import { roundFor } from './bonus-rounds';
import { sql } from './db';
import {
  EntryError,
  entryFieldProblems,
  isWalletAddress,
  normalizeLiveUrl,
  normalizeRepoUrl,
  sameRepoEntry,
  type Deployment,
} from './campaigns';
import { formatDeadline } from './dates';
import { entryMessage, entrySigner } from './entry-proof';
import { enteredTable, repoCoinNote, siteUrl } from './entry-text';
import {
  checkOwnership,
  type DeployerLookup,
  type OwnershipFetcher,
  type RepoFactsLookup,
} from './ownership';
import { getProgramRow, isOpen, type ProgramRow } from './programs';
import {
  BASE_MAINNET,
  CANT_RECEIVE,
  SanctionsError,
  screenWallet,
} from './sanctions';
import { proofProblem } from './submission-proof';
import { repoCoinPrograms } from './tokens';
import { ProjectInfo, prepareSubmission } from './submission';
import { CLANKER_ADDRESSES } from './traction';
import { ENTRIES_PER_CAMPAIGN } from './rate-limit';
import {
  RAW_CAP,
  canonicalBuilderUrl,
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
    /**
     * The token: 'skip' is "no token"; else the name and symbol the builder confirmed. Accepted
     * loosely here and checked in the token flow, so a bad token field never fails the entry.
     */
    token: z.unknown().optional(),
    /** The builder confirmed the summary that included the token line: only `true` counts. */
    builder_confirmed: z.unknown().optional(),
    /**
     * v2.4 §2: when the agent deployed the contracts from its own wallet, that wallet's EIP-191
     * signature of "EarnKit entry: <program id> <repo key> <payout wallet> <contracts>"
     * (prepare_submission's sign_to_enter).
     */
    deployer_signature: z.string().optional(),
    /**
     * v2.5 Ruling 13a, external (non-campaign) programs only: up to 5 Base contracts of the project,
     * scored for the builder bonus's onchain users once verified like a v2.4 entry (deployed by
     * `payout_wallet`, or by the wallet that signed the entry message in `deployer_signature`;
     * earnkit.txt in the repo naming `payout_wallet`). Unverified ones are dropped with a note.
     */
    contracts: z.array(z.string()).max(5).optional(),
    /** External programs: the builder's Base wallet (kept as the entry's creator wallet). */
    payout_wallet: z.string().optional(),
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

/** At most this many submission_data answers, each at most SUBMISSION_VALUE_MAX bytes. */
export const SUBMISSION_KEYS_MAX = 50;
export const SUBMISSION_VALUE_MAX = 4096;
/** Programs that aren't campaigns: an answer may be a long essay already submitted elsewhere (M4). */
export const OTHER_VALUE_MAX = 16_384;

/**
 * Why submission_data is too large to check or store, or null: more than 50 answers, or an answer
 * over `max` bytes (4 KB for campaign entries; a list counts as its JSON). Pure; exported for tests.
 */
export function submissionDataProblem(data: Record<string, unknown>, max = SUBMISSION_VALUE_MAX) {
  const keys = Object.keys(data);
  if (keys.length > SUBMISSION_KEYS_MAX)
    return `submission_data: at most ${SUBMISSION_KEYS_MAX} answers (got ${keys.length}); pass only the program's questions.`;
  for (const k of keys) {
    const v = data[k];
    const text = typeof v === 'string' ? v : (JSON.stringify(v) ?? '');
    if (Buffer.byteLength(text, 'utf8') > max)
      return `submission_data: ${k.slice(0, 64)} is over ${max / 1024} KB; shorten it.`;
  }
  return null;
}

/** Chain, explorer and GitHub reads, injectable for tests and the e2e. */
export type EntryDeps = {
  status?: (contract: string) => Promise<Deployment>;
  deployer?: DeployerLookup;
  repoFacts?: RepoFactsLookup;
  fetchFile?: OwnershipFetcher;
  /** v2.5 §3: fetches a program's submission proof page (proofProblem); defaults to safeFetchText. */
  fetchProof?: (url: string) => Promise<string>;
};

/**
 * Every check of a campaign entry, all problems at once (v2.4 §2): required answers, the repo
 * link, the contracts and payout wallet, the sponsor's own wallet, the deployer signature,
 * ownership (earnkit.txt and who deployed each contract) and the sanctions screen. Checks that
 * need an earlier answer (ownership needs a valid repo and wallet) run only once it is valid.
 * Throws EntryError.of(problems); otherwise returns the entry, its proof and deployers.
 */
export async function campaignEntryProblems(
  program: ProgramRow,
  input: z.infer<typeof RecordSubmissionInput>,
  installationId: number,
  sponsor: { installation_id: number; sponsor_wallet: string | null } | null,
  deps: EntryDeps = {},
) {
  const c = program.campaign!;
  // Too much data is refused before anything is read.
  const tooLarge = submissionDataProblem(input.submission_data);
  if (tooLarge) throw new EntryError(tooLarge);
  const cleaned = cleanProject(input.project);
  const problems: string[] = [];
  const missing = missingAnswersProblem(
    program.submission_requirements,
    cleaned,
    input.submission_data,
  );
  if (missing) problems.push(missing);
  let repoUrl: string | undefined;
  try {
    repoUrl = entryRepoUrl(cleaned.repo_url, input.submission_data);
    if (repoUrl) {
      const canon = canonicalBuilderUrl(repoUrl);
      if (canon.problem) {
        problems.push(`repo_url: ${canon.problem}.`);
        repoUrl = undefined;
      } else repoUrl = canon.url;
    } else
      problems.push(
        'repo_url: campaign entries need the public GitHub repo of the project.',
      );
  } catch (err) {
    if (!(err instanceof EntryError)) throw err;
    problems.push(err.message);
  }
  const fields = await entryFieldProblems(input.submission_data, program, {
    ...entryRules(c.kind, program.existing_work),
    status: deps.status,
  });
  problems.push(...fields.problems);
  const wallet = fields.payoutWallet;
  if (wallet) {
    const self = selfEntryProblem(sponsor, installationId, wallet);
    if (self) problems.push(self);
  }
  let signer: string | null = null;
  if (input.deployer_signature && repoUrl && wallet) {
    signer = await entrySigner(
      program.id,
      repoUrl,
      wallet,
      fields.contracts,
      input.deployer_signature,
    );
    if (!signer)
      problems.push(
        'deployer_signature: it is not a valid signature (0x + 130 hex characters).',
      );
  }
  let proof: Awaited<ReturnType<typeof checkOwnership>> | null = null;
  if (repoUrl && wallet) {
    try {
      proof = await checkOwnership(
        { repoUrl, payoutWallet: wallet, contracts: fields.contracts, signer },
        {
          deployer: deps.deployer,
          repoFacts: deps.repoFacts,
          fetchFile: deps.fetchFile,
        },
      );
    } catch (err) {
      if (!(err instanceof EntryError)) throw err;
      problems.push(...err.problems);
      // A contract deployed by another wallet (the agent's, in the default flow) enters with that
      // wallet's signature, and a signature over other text recovers another wallet: either way,
      // say exactly what to sign (never "redeploy").
      if (err.problems.some((p) => p.startsWith('Contract ')))
        problems.push(
          `deployer_signature: sign exactly "${entryMessage(program.id, normalizeRepoUrl(repoUrl), wallet, fields.contracts)}" with the wallet that deployed the contracts and pass it as deployer_signature.`,
        )
    }
  }
  if (wallet) {
    try {
      await screenWallet(
        wallet,
        c.kind === 'sponsor' ? c.prize.chain_id : BASE_MAINNET,
        `payout_wallet: ${CANT_RECEIVE}`,
      );
    } catch (err) {
      if (!(err instanceof SanctionsError)) throw err;
      problems.push(err.message);
    }
  }
  if (problems.length) throw EntryError.of(problems);
  return {
    repoUrl: repoUrl!,
    entry: { contracts: fields.contracts, payoutWallet: wallet! },
    proof: proof!,
    deployers: [
      ...new Set(Object.values(proof!.deployers).filter(Boolean)),
    ] as string[],
  };
}

/**
 * The builder bonus eligibility rule (v2.5 spec §3): a coin launched through EarnKit for this
 * entry (ownership was already proven by the token gate to launch it) and a submission proof that
 * last checked out. Derived, never stored separately, so it can never go stale against either
 * field; Tasks 6 and 7 use this to rank and pay rounds. Pure; exported for tests.
 */
export function bonusEligible(project: {
  coin_address: string | null;
  submission_proof_ok_at: Date | string | null;
  /** Ruling 13b: an earlier eligible entry of the same normalized repo exists in this program. */
  earlier_same_repo?: boolean;
  /** Ruling 16, for a round: when the coin launched, and the round's end (both must precede it). */
  coin_launched_at?: Date | null;
  ends_at?: Date;
}): boolean {
  if (project.coin_address === null || project.submission_proof_ok_at === null || project.earlier_same_repo) return false;
  if (!project.ends_at) return true;
  const end = project.ends_at.getTime();
  return (
    !!project.coin_launched_at && project.coin_launched_at.getTime() < end &&
    new Date(project.submission_proof_ok_at).getTime() < end
  );
}

/**
 * Ruling 13a/16: an external entry's contracts that verify like a v2.4 entry AND are proven
 * controlled by the submitter: `deployer_signature` (over the v2.4 entry message for the list as
 * submitted) must recover to each contract's deployer, whether that is `wallet` or the agent's
 * wallet; naming a public wallet in earnkit.txt is never enough. checkOwnership still requires the
 * repo's earnkit.txt to name `wallet`. Each contract is checked on its own, so one bad contract
 * drops only itself; Clanker/Uniswap contracts are never accepted. Never throws: returns the
 * verified contracts, their deployers and a note on what was dropped and what to sign.
 */
export async function verifiedBonusContracts(
  programId: string,
  repoUrl: string | undefined,
  wallet: string | undefined,
  given: string[],
  signature: string | undefined,
  deps: EntryDeps = {},
): Promise<{ contracts: string[]; deployers: string[]; note: string | null }> {
  const none = (note: string) => ({ contracts: [], deployers: [], note: `Contracts not counted for the builder bonus: ${note}` });
  const asked = [...new Set(given.map((c) => c.trim().toLowerCase()))];
  const bad = asked.filter((c) => !/^0x[0-9a-f]{40}$/.test(c));
  if (bad.length) return none(`${bad.join(', ')} ${bad.length === 1 ? "isn't a" : "aren't"} Base contract address${bad.length === 1 ? '' : 'es'}.`);
  const never = asked.filter((c) => CLANKER_ADDRESSES.includes(c));
  const candidates = asked.filter((c) => !never.includes(c));
  const notes: string[] = [];
  if (never.length)
    notes.push(
      `${never.join(', ')}: Clanker or Uniswap contracts never count as yours; leave them out of contracts` +
        (signature ? ' and sign the list without them next time.' : '.'),
    );
  if (!candidates.length) return { contracts: [], deployers: [], note: notes.length ? `Contracts not counted for the builder bonus: ${notes.join(' ')}` : null };
  if (!repoUrl) return none('they need the project\'s public GitHub repo_url.');
  if (!wallet || !isWalletAddress(wallet)) return none('pass payout_wallet, the builder\'s Base wallet that deployed them (or signed for them).');
  const w = wallet.toLowerCase();
  const toSign = `sign exactly "${entryMessage(programId, normalizeRepoUrl(repoUrl), w, candidates)}" with the wallet that deployed them and pass it as deployer_signature.`;
  // Ruling 16: a contract counts only with its deployer's signature.
  if (!signature) return { contracts: [], deployers: [], note: `Contracts not counted for the builder bonus: ${[...notes, `To count them, ${toSign}`].join(' ')}` };
  // The signature covers the contract list exactly as the agent submitted it (Ruling 15).
  const signer = await entrySigner(programId, repoUrl, w, asked, signature);
  if (!signer)
    return {
      contracts: [],
      deployers: [],
      note: `Contracts not counted for the builder bonus: ${[...notes, `deployer_signature is not a valid signature; ${toSign}`].join(' ')}`,
    };
  const contracts: string[] = [];
  const deployers = new Set<string>();
  for (const c of candidates) {
    try {
      const proof = await checkOwnership(
        { repoUrl, payoutWallet: w, contracts: [c], signer },
        { deployer: deps.deployer, repoFacts: deps.repoFacts, fetchFile: deps.fetchFile },
      );
      const d = proof.deployers[c];
      if (d !== signer) {
        notes.push(`Contract ${c} was deployed by ${d ?? 'an unknown wallet'}, not by the wallet that signed deployer_signature (${signer}).`);
        continue;
      }
      contracts.push(c);
      deployers.add(d);
    } catch (err) {
      if (!(err instanceof EntryError)) {
        console.error('[bonus contracts] check failed:', err);
        notes.push(`${c}: EarnKit couldn't check it right now.`);
      } else notes.push(...err.problems.map((p) => p.replace(/^contracts: /, '')));
    }
  }
  if (contracts.length < candidates.length) notes.push(`Each contract counts with its deployer's signature: ${toSign}`);
  return {
    contracts,
    deployers: [...deployers],
    note: notes.length ? `Contracts not counted for the builder bonus: ${[...new Set(notes)].join(' ')}` : null,
  };
}

/** Stores a project after it was actually submitted to the external program. */
export async function recordSubmission(
  input: z.infer<typeof RecordSubmissionInput>,
  installationId: number,
  /**
   * Chain, explorer and GitHub reads (injectable for tests and the e2e), and `charge`: the daily
   * limit, counted right before the insert.
   */
  deps: EntryDeps & { charge?: () => Promise<unknown> } = {},
) {
  const program = await getProgramRow(input.program_id);
  const tooLarge = submissionDataProblem(
    input.submission_data,
    program.campaign ? SUBMISSION_VALUE_MAX : OTHER_VALUE_MAX,
  );
  if (tooLarge) throw new EntryError(tooLarge);
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
  let deployers: string[] | null = null;
  if (program.campaign) {
    if (!isOpen(program)) throw new EntryError('This campaign is closed.');
    const [sponsor] = await sql()<
      { installation_id: number; sponsor_wallet: string | null }[]
    >`SELECT installation_id, sponsor_wallet FROM sponsor_campaigns WHERE program_id = ${program.id}`;
    if (sponsor?.installation_id === installationId)
      throw new EntryError(selfEntryProblem(sponsor, installationId, '')!);
    const checked = await campaignEntryProblems(
      program,
      input,
      installationId,
      sponsor ?? null,
      deps,
    );
    repo_url = checked.repoUrl;
    entry = checked.entry;
    proof = checked.proof;
    deployers = checked.deployers;
  }

  // v2.5 §3: external (non-campaign) programs with a public submission page. The external URL is
  // the proof EarnKit checks for the builder bonus; a failure never fails the submission — it's
  // recorded either way, just not (yet) bonus-eligible (bonusEligible), with a note telling the
  // agent what to fix. The cron re-checks a failed proof daily until the round ends.
  let submissionProofUrl: string | null = null;
  let submissionProofOkAt: Date | null = null;
  let submissionProofCheckedAt: Date | null = null;
  let bonusNote: string | null = null;
  if (!program.campaign && program.submission_proof) {
    submissionProofUrl = input.external_submission_url ?? null;
    if (!submissionProofUrl) {
      bonusNote =
        `No external_submission_url was given; the builder bonus needs a public link to this ` +
        `entry on ${program.submission_proof.host} (e.g. a DoraHacks BUIDL page).`;
    } else {
      const problem = await proofProblem(
        program,
        submissionProofUrl,
        repo_url,
        live_url,
        { fetchText: deps.fetchProof },
      );
      submissionProofCheckedAt = new Date();
      if (problem) bonusNote = `Builder bonus not available yet: ${problem}`;
      else submissionProofOkAt = submissionProofCheckedAt;
    }
  }

  // Ruling 13a: an external entry's own contracts, verified, for the builder bonus's users signal.
  let bonusContracts: string[] | null = null;
  let bonusDeployers: string[] | null = null;
  let bonusWallet: string | null = null;
  const notes: string[] = bonusNote ? [bonusNote] : [];
  if (!program.campaign && program.submission_proof) {
    if (input.payout_wallet && isWalletAddress(input.payout_wallet)) bonusWallet = input.payout_wallet.toLowerCase();
    if (input.contracts?.length) {
      const v = await verifiedBonusContracts(program.id, repo_url, input.payout_wallet, input.contracts, input.deployer_signature, deps);
      if (v.contracts.length) {
        bonusContracts = v.contracts;
        bonusDeployers = v.deployers;
      }
      if (v.note) notes.push(v.note);
    }
  }
  // Ruling 13b: one bonus-eligible entry per normalized repo per program, the earliest.
  const bonusRepoKey = (!program.campaign && repo_url && normalizeRepoUrl(repo_url)) || null;
  // Ruling 25: one coin per repo (v2.3). A repo whose coin is already entered in a program gets no
  // new coin here, so no builder bonus: said now, not discovered at launch.
  if (bonusRepoKey && program.submission_proof) {
    const coin = (await repoCoinPrograms([bonusRepoKey]).catch(() => new Map<string, { program_id: string; title: string }>())).get(bonusRepoKey);
    // Ruling 25 is about another program: a coin in this same program is Ruling 13b's case.
    if (coin && coin.program_id !== program.id) {
      const line = repoCoinNote(coin.title);
      notes.push(`${line[0].toUpperCase()}${line.slice(1)}.`);
    }
  }
  // M12: the entry-time notes judge earlier entries by the eligibility rule of the round open now
  // (traction.ts eligibleSql: coin and proof before the round's end), like scoring does.
  const roundEnd = roundFor(program, new Date())?.ends ?? null;
  const beforeEnd = (tx: postgres.TransactionSql) =>
    roundEnd
      ? tx`AND coin_launched_at < ${roundEnd} AND submission_proof_ok_at < ${roundEnd} AND submitted_at < ${roundEnd}`
      : tx``;

  // Campaign entries store the normalized repo; a unique index on (program_id, repo_key) backs
  // the check below at the database level.
  const repoKey = (entry && repo_url && normalizeRepoUrl(repo_url)) || null;
  // The live link, normalized: not unique (it isn't proven, so uniqueness let anyone squat it);
  // the sponsor sees entries that share one (sponsor.ts sameLiveLink).
  const liveKey = (entry && live_url && normalizeLiveUrl(live_url)) || null;
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
      // The daily limit counts recorded entries only (v2.4 §2): checks that failed above cost nothing.
      await deps.charge?.();
      if (bonusRepoKey && program.submission_proof) {
        // Only an earlier ELIGIBLE entry (coin and proof) holds the repo (Ruling 15): a squatter's
        // row or the builder's own failed attempt never blocks (traction.ts eligibleSql).
        const [earlier] = await tx<{ id: number }[]>`
          SELECT id FROM projects WHERE program_id = ${program.id} AND bonus_repo_key = ${bonusRepoKey}
            AND coin_address IS NOT NULL AND submission_proof_ok_at IS NOT NULL ${beforeEnd(tx)}
          ORDER BY submitted_at, id LIMIT 1`;
        if (earlier)
          notes.push(
            `Not eligible for the builder bonus: entry #${earlier.id} already holds this repo in this program, and only the earliest eligible entry of a repo is.`,
          );
      }
      if (bonusContracts && program.submission_proof) {
        // A contract backs only one eligible entry per program, the earliest (Ruling 15; scoring
        // drops it from later entries, traction.ts ownContracts).
        const held = await tx<{ id: number; contracts: string[] }[]>`
          SELECT id, contracts FROM projects
          WHERE program_id = ${program.id} AND contracts && ${bonusContracts}::text[]
            AND coin_address IS NOT NULL AND submission_proof_ok_at IS NOT NULL ${beforeEnd(tx)}
          ORDER BY submitted_at, id`;
        const taken = bonusContracts
          .map((c) => ({ c, by: held.find((h) => h.contracts.map((x) => x.toLowerCase()).includes(c)) }))
          .filter((x) => x.by);
        if (taken.length)
          notes.push(
            `Not counted for this entry: ${taken.map((x) => `${x.c} already backs entry #${x.by!.id}`).join('; ')} (a contract counts for one entry per program).`,
          );
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
        contracts: entry?.contracts ?? bonusContracts,
        deployers: deployers ?? bonusDeployers,
        bonus_repo_key: bonusRepoKey,
        ...(bonusWallet && { creator_wallet: bonusWallet }),
        submission_proof_url: submissionProofUrl,
        submission_proof_ok_at: submissionProofOkAt,
        submission_proof_checked_at: submissionProofCheckedAt,
      })} RETURNING id, submitted_at`;
      // Remembered for this installation's next entry (prepare_submission asks the builder to confirm it).
      if (entry)
        await tx`UPDATE installations SET payout_wallet = ${entry.payoutWallet} WHERE id = ${installationId}`;
      // v2.4 §5: the installation's wallets (its wins show for them from any connection).
      if (entry)
        await tx`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${installationId}, ${entry.payoutWallet.toLowerCase()}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO submissions ${tx({
        project_id: project.id,
        submission_data: tx.json(input.submission_data as never),
        external_submission_url: input.external_submission_url ?? null,
      })}`;
      return {
        recorded: true,
        project_id: project.id,
        submitted_at: project.submitted_at.toISOString(),
        ...(notes.length && { bonus_note: notes.join(' ') }),
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
        ...(entry &&
          program.campaign && {
            show_to_builder: enteredTable({
              project: name,
              programTitle:
                program.campaign.kind === 'sponsor'
                  ? quoted(program.title)
                  : program.title,
              standing: 'not scored yet (scores update daily)',
              leaderboard: `${siteUrl()}/campaigns/${program.id}`,
              campaign: program.campaign,
              endsAt: program.ends_at,
              payoutWallet: entry.payoutWallet,
            }),
          }),
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
      throw err;
    });
}
