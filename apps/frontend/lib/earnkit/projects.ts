import type postgres from 'postgres';
import { z } from 'zod';
import { sql } from './db';
import {
  EntryError,
  entryFieldProblems,
  givenWallet,
  githubRepo,
  isWalletAddress,
  normalizeLiveUrl,
  normalizeRepoUrl,
  sameRepoEntry,
  type Deployment,
} from './campaigns';
import { formatDeadline } from './dates';
import { entryMessage, entrySigner } from './entry-proof';
import { eventRepoKey, noteEvent, proofLink } from './events';
import { loginBasisFor } from './github-verify';
import { enteredTable, siteUrl } from './entry-text';
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
import type { ProofOutcome } from './submission-proof';
import { PROOF_LINE_PREFIX, SIGN_IN_FIRST, WALLET_CHANGED } from './token-gate';
import { ProjectInfo, prepareSubmission, type KnownInfo } from './submission';
import type { SubmissionRequirement } from './program-file';
import { CLANKER_ADDRESSES } from './traction';
import { ENTRIES_PER_CAMPAIGN } from './rate-limit';
import { COIN_PROGRAM } from './policy-constants';
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
    /**
     * v2.6 Ruling 5 (plan): the builder confirmed the entry is submitted on the program's own site.
     * Only `true` counts; stored as `submission_confirmed_at`. Never derived from builder_confirmed.
     */
    builder_submitted: z.unknown().optional(),
    /** v2.8.1 fix round 1: checking back after "launching": the token part is a read, never a launch. */
    check_back: z.boolean().optional(),
    /** v2.9 B9 (Ruling G9): the code a shared client's builder pasted after signing in with GitHub. */
    signed_in: z.string().max(40).optional(),
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
  return `Missing required answers: ${items.join(', ')}. Call prepare to see what each needs, then confirm again.`;
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
 * The builder bonus eligibility rule (v2.5 spec §3), for an entry's OWN token only (v2.8.1 §D: a
 * token carried from another program counts in SQL only, traction.ts coinSql, against the ledger;
 * this twin doesn't model it): a coin launched through EarnKit for this
 * entry (ownership was already proven by the token gate to launch it) and a submission that counts
 * (`submission_proof_ok_at`: since when, on any v2.6 basis; a v2.5 row with it set and no basis
 * counted on its page). Derived, never stored separately, so it can never go stale against either
 * field; Tasks 6 and 7 use this to rank and pay rounds. v2.8 Rulings 2-3 (plan): also a complete
 * entry (`complete_at`) and a confirmation never skipped (traction.ts eligibleSql, its SQL twin).
 * Pure; exported for tests.
 */
export function bonusEligible(project: {
  coin_address: string | null;
  submission_proof_ok_at: Date | string | null;
  /** v2.8 Ruling 2 (plan): the first time the entry's answers and links were complete. */
  complete_at: Date | string | null;
  /** v2.8 Ruling 3 (plan): 'skip' is final for the bonus; null is an older agent's entry. */
  confirm_choice: 'go' | 'skip' | null;
  /** Ruling 13b: an earlier eligible entry of the same normalized repo exists in this program. */
  earlier_same_repo?: boolean;
  /** Ruling 16, for a round: when the coin launched, and the round's end (all must precede it). */
  coin_launched_at?: Date | null;
  ends_at?: Date;
}): boolean {
  if (project.coin_address === null || project.submission_proof_ok_at === null || project.earlier_same_repo) return false;
  if (project.complete_at == null || project.confirm_choice === 'skip') return false;
  if (!project.ends_at) return true;
  const end = project.ends_at.getTime();
  return (
    !!project.coin_launched_at && project.coin_launched_at.getTime() < end &&
    new Date(project.submission_proof_ok_at).getTime() < end &&
    new Date(project.complete_at).getTime() < end
  );
}

/**
 * v2.9 A5: the verified columns an entry step writes from its checks (`verified`): now where a
 * check passed, NULL where it didn't; null (write nothing) when no checks ran. Pure.
 * Task 11 fix (journey 11.0): a contract that had code keeps counting. The UPDATEs below never clear
 * contract_verified_at, since a later step (tell's "I submitted" re-records from the stored fields,
 * which carry no contracts) can't see the address the earlier check passed with.
 */
export function verifiedAt(
  verified: KnownInfo['verified'],
  now: Date,
): { live_verified_at: Date | null; contract_verified_at: Date | null } | null {
  if (!verified) return null;
  return { live_verified_at: verified.live ? now : null, contract_verified_at: verified.contract === true ? now : null };
}

/**
 * v2.8 Ruling 2 (plan): when the entry became complete. Set once, the first time its answers and
 * links pass prepareSubmission(...).ready, and never cleared or moved (`previous` is kept even when
 * the entry is no longer ready). Pure.
 */
export function completeAt(
  requirements: SubmissionRequirement[],
  known: KnownInfo,
  previous: Date | null,
  now: Date,
): Date | null {
  if (previous) return previous;
  return prepareSubmission(requirements, known).ready ? now : null;
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
      `${never.join(', ')}: token launch or Uniswap contracts never count as yours; leave them out of contracts` +
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

/**
 * v2.6 §3, Rulings 4, 5 and 15 (plan): how an entry's submission counts for the builder bonus, and
 * the agent-facing note when it doesn't (yet).
 * - A program with a public entry page (`hasPattern`) needs its link: the page checked out counts
 *   (`page`); a page that can't be fetched counts on the builder's confirmation, flagged
 *   (`unverified_page`); a page that loaded without the entry's link never counts, confirmed or not.
 * - A program without one counts on the builder's confirmation (`confirmed`).
 * Pure.
 */
export function submissionBasis(a: {
  hasPattern: boolean;
  outcome: ProofOutcome | null;
  confirmed: boolean;
}): { basis: 'page' | 'unverified_page' | 'confirmed' | null; note: string | null } {
  const confirm = 'Call tell with submitted once the builder confirms the entry is submitted on the program site.';
  if (!a.hasPattern)
    return a.confirmed ? { basis: 'confirmed', note: null } : { basis: null, note: `Builder bonus not available yet: ${confirm}` };
  if (!a.outcome)
    return { basis: null, note: 'No external_submission_url was given; the builder bonus needs the link to this entry on the program site.' };
  if (a.outcome.kind === 'ok') return { basis: 'page', note: null };
  if (a.outcome.kind === 'refused') return { basis: null, note: `Builder bonus not available yet: ${a.outcome.problem}` };
  return a.confirmed
    ? { basis: 'unverified_page', note: null }
    : { basis: null, note: `Builder bonus not available yet: ${a.outcome.problem} ${confirm}` };
}

type OwnEntry = {
  id: number;
  token_url: string | null;
  /** Fix round 2 (N1): the row's EarnKit coin or claim, never a builder-typed token_url. */
  earnkit_coin: boolean;
  submission_proof_url: string | null;
  submission_proof_ok_at: Date | null;
  submission_basis: string | null;
  submission_confirmed_at: Date | null;
  /** v2.8 Ruling 1 (plan): set once the builder passed the confirmation step (confirm_entry). */
  confirm_choice: 'go' | 'skip' | null;
  /** v2.8 Ruling C9 fix: the entry's own wallet, which the confirmation offer shows. */
  creator_wallet: string | null;
};

/**
 * Fix round 1 (Ruling 23, I1): this installation's existing entry of the same project in a
 * program that isn't a campaign: the same normalized repo, or, without a repo, the same name on a
 * repo-less entry. The one with a coin first, then the earliest. Never another installation's row.
 */
async function ownEntry(
  q: postgres.Sql | postgres.TransactionSql,
  k: { programId: string; installationId: number; repoUrl: string | null; name: string },
): Promise<OwnEntry | null> {
  const key = k.repoUrl ? normalizeRepoUrl(k.repoUrl) : null;
  const [row] = await q<OwnEntry[]>`
    SELECT id, token_url,
      (coin_address IS NOT NULL OR token_status IN ('launched', 'pending')) AS earnkit_coin,
      submission_proof_url, submission_proof_ok_at, submission_basis, submission_confirmed_at, confirm_choice,
      creator_wallet
    FROM projects
    WHERE program_id = ${k.programId} AND installation_id = ${k.installationId} AND payout_wallet IS NULL
      AND ${key ? q`bonus_repo_key = ${key}` : q`repo_url IS NULL AND lower(name) = lower(${k.name})`}
    ORDER BY (coin_address IS NOT NULL) DESC, submitted_at, id
    LIMIT 1`;
  return row ?? null;
}

/**
 * v2.8 Ruling 29 (plan), Task 8 carry: every non-campaign program this installation already has a
 * row for, for the same project (ownEntry's own repo/name match: a confirmed-but-unsubmitted entry
 * counts too). For "Also qualifies": a program already entered is never offered a second time.
 * Not the same rule as present.ts enteredIds (the first message), which counts only submitted
 * entries so an unsubmitted one can still be finished.
 */
export async function enteredProgramIds(installationId: number, k: { repoUrl: string | null; name: string }): Promise<Set<string>> {
  const q = sql();
  const key = k.repoUrl ? normalizeRepoUrl(k.repoUrl) : null;
  const rows = await q<{ program_id: string }[]>`
    SELECT DISTINCT program_id FROM projects
    WHERE installation_id = ${installationId}
      AND ${key ? q`bonus_repo_key = ${key}` : q`repo_url IS NULL AND lower(name) = lower(${k.name})`}`;
  return new Set(rows.map((r) => r.program_id));
}

/**
 * v2.10 (Task 9 fix round 2, I-a, I-b): the entry `confirm` with `project_id` acts on, if this
 * installation's: its program, key fields, token state and wallets. Null otherwise.
 */
export type LaunchEntry = {
  id: number;
  program_id: string;
  name: string;
  repo_url: string | null;
  token_url: string | null;
  confirm_choice: string | null;
  wallet: string | null;
};
export async function launchEntry(
  installationId: number,
  projectId: number,
): Promise<LaunchEntry | null> {
  const [row] = await sql()<LaunchEntry[]>`
    SELECT id, program_id, name, repo_url, token_url, confirm_choice, COALESCE(creator_wallet, payout_wallet) AS wallet
    FROM projects WHERE id = ${projectId} AND installation_id = ${installationId}`;
  return row ?? null;
}

/**
 * v2.10 R16: the entry an "I submitted" names (`projectId`), else this installation's newest in the
 * program (as v2.9 outcomes find it), with its project fields and its saved answers (the confirmed
 * application's, else the latest recorded submission's). `onlyIds`: only among these (G7). Null when
 * there is none.
 */
export async function submittedEntry(
  installationId: number,
  programId: string,
  projectId?: number,
  /** Ruling G7: on a shared client, only the entries the caller's verified login signed in for. */
  onlyIds?: number[],
): Promise<{ id: number; project: Record<string, string>; answers: Record<string, unknown> } | null> {
  const [row] = await sql()<
    { id: number; name: string; description: string | null; repo_url: string | null; live_url: string | null; demo_url: string | null; answers: Record<string, unknown> | null }[]
  >`
    SELECT p.id, p.name, p.description, p.repo_url, p.live_url, p.demo_url,
      COALESCE(p.application -> 'answers',
        (SELECT s.submission_data FROM submissions s WHERE s.project_id = p.id ORDER BY s.id DESC LIMIT 1)) AS answers
    FROM projects p
    WHERE p.installation_id = ${installationId} AND p.program_id = ${programId}
      AND (${projectId ?? null}::int IS NULL OR p.id = ${projectId ?? null})
      AND (${onlyIds === undefined} OR p.id = ANY(${onlyIds ?? []}::int[]))
    ORDER BY p.submitted_at DESC, p.id DESC LIMIT 1`;
  if (!row) return null;
  const { id, answers, ...fields } = row;
  const project = Object.fromEntries(Object.entries(fields).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
  return { id, project, answers: answers ?? {} };
}

/**
 * v2.10 item 3 (Pre-flight P23): whether this installation has any entry (a row, confirmed or not)
 * for the program; the guide is not shown again after one.
 */
export async function hasProgramEntry(installationId: number, programId: string): Promise<boolean> {
  const [row] = await sql()<{ n: number }[]>`
    SELECT 1 AS n FROM projects WHERE installation_id = ${installationId} AND program_id = ${programId} LIMIT 1`;
  return row !== undefined;
}

/**
 * v2.8.1 §B9: this installation's entries in open programs that aren't campaigns, newest first, for
 * list_programs' "Your entries" line and its "entered" marks. Submitted: the builder confirmed it, the
 * entry page was checked, or the row came from record_submission without a confirmation step (before v2.8).
 * `onlyIds` (v2.9 B9, Ruling G7): only these entries (a verified login's, on a shared client).
 * v2.10 item 15: `id` and the program's `ends_at`, for the deadline line (alerts.ts deadlineLine).
 */
export type OpenEntry = { id: number; program_id: string; title: string; name: string; submitted: boolean; ends_at: Date | null };

export async function openEntries(installationId: number, onlyIds?: number[]): Promise<OpenEntry[]> {
  const db = sql();
  return [
    ...(await db<OpenEntry[]>`
      SELECT p.id, p.program_id, pr.title, p.name, pr.ends_at,
        (p.confirmed_at IS NULL OR p.submission_confirmed_at IS NOT NULL OR p.submission_proof_ok_at IS NOT NULL) AS submitted
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE p.installation_id = ${installationId} AND pr.campaign IS NULL AND pr.status = 'active' AND p.program_id <> ${COIN_PROGRAM}
        AND (pr.ends_at IS NULL OR pr.ends_at > now())
        ${onlyIds ? db`AND p.id = ANY(${onlyIds}::int[])` : db``}
      ORDER BY p.submitted_at DESC, p.id DESC
      LIMIT 20`),
  ];
}

/**
 * v2.11 T3: a new entry row (record_submission or the confirmation step): its `entered` event, with
 * the entry page as proof. The wallet only when the builder gave one with this entry and it is kept.
 */
const enteredEvent = (e: { projectId: number; installationId: number; programId: string; repoUrl: string | null; wallet?: string | null }) =>
  noteEvent('entered', async () => {
    const repoKey = eventRepoKey(e.repoUrl);
    const who = repoKey ? await loginBasisFor(e.installationId, repoKey, { projectId: e.projectId }) : null;
    return {
      type: 'entered',
      dedupe_key: `entered:${e.projectId}`,
      installation_id: e.installationId,
      program_id: e.programId,
      project_id: e.projectId,
      ...(repoKey && { repo_key: repoKey }),
      ...(e.wallet && { wallet: e.wallet }),
      ...(who && { github_login: who.login, login_basis: who.basis }),
      proof_url: `${siteUrl()}/p/${e.projectId}`,
    };
  });

/**
 * v2.11 T3 fix: record_submission recorded the entry (a `submissions` row, so it counts as submitted
 * under Ruling C10, as the backfill reads it): its `submitted` event. Through tell `submitted` too.
 * The first one per entry is kept.
 */
const submittedEvent = (e: { projectId: number; installationId: number; programId: string; repoUrl: string | null; url?: string; said: boolean }) =>
  noteEvent('submitted', async () => {
    const repoKey = eventRepoKey(e.repoUrl);
    const who = repoKey ? await loginBasisFor(e.installationId, repoKey, { projectId: e.projectId }) : null;
    return {
      type: 'submitted',
      dedupe_key: `submitted:${e.projectId}`,
      installation_id: e.installationId,
      program_id: e.programId,
      project_id: e.projectId,
      ...(repoKey && { repo_key: repoKey }),
      ...(who && { github_login: who.login, login_basis: who.basis }),
      ...(proofLink(e.url) && { proof_url: proofLink(e.url) }),
      detail: { basis: proofLink(e.url) ? 'link' : e.said ? 'builder_said' : 'recorded' },
    };
  });

/** Stores a project after it was actually submitted to the external program. */
export async function recordSubmission(
  input: z.infer<typeof RecordSubmissionInput>,
  installationId: number,
  /**
   * Chain, explorer and GitHub reads (injectable for tests and the e2e), and `charge`: the daily
   * limit, counted right before the insert.
   */
  deps: EntryDeps & {
    charge?: () => Promise<unknown>;
    /** v2.9 A5: this step's link and contract checks (completeness, and the verified columns). */
    verified?: KnownInfo['verified'];
    /** The program row, when the caller already read it (record_submission); else read here. */
    program?: ProgramRow;
    /**
     * v2.9 B9 (fix round 2): false on a shared client: the wallet given is not kept on the entry
     * here (the entry may be another builder's); the token flow keeps it once its gate passed.
     */
    keepWallet?: boolean;
  } = {},
) {
  const program = deps.program ?? (await getProgramRow(input.program_id));
  const tooLarge = submissionDataProblem(
    input.submission_data,
    program.campaign ? SUBMISSION_VALUE_MAX : OTHER_VALUE_MAX,
  );
  if (tooLarge) throw new EntryError(tooLarge);
  // Ruling 22: outside campaigns a wallet the builder gave is valid or the call fails (never
  // dropped, so a typo never falls back to the remembered wallet). Campaigns keep v2.4's checks.
  const entryWallet = program.campaign ? null : givenWallet(input.payout_wallet);
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

  // Fix round 1 (Ruling 23, I1): outside campaigns, the same installation recording the same
  // project again in this program (same normalized repo, or the same name without a repo) updates
  // its entry instead of adding a second one, so a late confirmation lands on the row with the coin.
  const sameEntryKey = { programId: program.id, installationId, repoUrl: repo_url ?? null, name };

  // v2.14: there is no builder bonus, so an entry's submission basis is never judged here (an existing
  // entry keeps what it has). The repo key old entries were matched on (kept for the stored rows).
  const bonusRepoKey = (!program.campaign && repo_url && normalizeRepoUrl(repo_url)) || null;
  // Ruling 10 (plan): outside campaigns, a valid wallet named here is this installation's last
  // wallet, prefilled next time (campaign entries remember their proven payout wallet below).
  const lastWallet = entryWallet?.toLowerCase() ?? null;
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

  // v2.8 Ruling 2 (plan): the entry is complete when what this call was given (what
  // prepare_submission saw, as v2.7's C7 gate read it) passes the program's requirements. Written
  // with COALESCE, so it is set once and never cleared (completeAt's rule, in SQL).
  const completeNow = completeAt(
    program.submission_requirements,
    { project: { ...cleaned, repo_url }, answers: answersOf(input.submission_data), verified: deps.verified },
    null,
    new Date(),
  );
  const checked = verifiedAt(deps.verified, new Date());

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
      // I1: one entry per installation, program and project; serialized so two calls at once
      // can't both insert. A row found now is updated (not charged: no new entry).
      let own: OwnEntry | null = null;
      if (!program.campaign) {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`own-entry:${program.id}:${installationId}`}))`;
        own = await ownEntry(tx, sameEntryKey);
      }
      // The daily limit counts recorded entries only (v2.4 §2): checks that failed above cost nothing.
      if (!own) await deps.charge?.();
      const [project] = own
        ? await tx<{ id: number; submitted_at: Date }[]>`
          UPDATE projects SET
            complete_at = COALESCE(complete_at, ${completeNow}),
            live_verified_at = CASE WHEN ${checked !== null} THEN ${checked?.live_verified_at ?? null}::timestamptz ELSE live_verified_at END,
            contract_verified_at = COALESCE(${checked?.contract_verified_at ?? null}::timestamptz, contract_verified_at)
          WHERE id = ${own.id} RETURNING id, submitted_at`
        : await tx<{ id: number; submitted_at: Date }[]>`
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
        deployers: deployers ?? null,
        bonus_repo_key: bonusRepoKey,
        complete_at: completeNow,
        ...checked,
      })} RETURNING id, submitted_at`;
      // Remembered for this installation's next entry (prepare_submission asks the builder to confirm it).
      if (entry)
        await tx`UPDATE installations SET payout_wallet = ${entry.payoutWallet} WHERE id = ${installationId}`;
      // v2.4 §5: the installation's wallets (its wins show for them from any connection).
      if (entry)
        await tx`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${installationId}, ${entry.payoutWallet.toLowerCase()}) ON CONFLICT DO NOTHING`;
      if (lastWallet) {
        await tx`UPDATE installations SET payout_wallet = ${lastWallet} WHERE id = ${installationId}`;
        await tx`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${installationId}, ${lastWallet}) ON CONFLICT DO NOTHING`;
      }
      await tx`INSERT INTO submissions ${tx({
        project_id: project.id,
        submission_data: tx.json(input.submission_data as never),
        external_submission_url: input.external_submission_url ?? null,
      })}`;
      return {
        recorded: true,
        project_id: project.id,
        // I1: an earlier entry of this project was updated (same id), with its coin if it has one.
        // N1: only an EarnKit coin (or a launch in flight); a token_url the builder typed is theirs.
        ...(own && { updated: true as const, coin_url: own.earnkit_coin ? own.token_url : null }),
        // v2.8 Ruling 1 (plan): the entry passed the confirmation step; its token was decided there.
        ...(own?.confirm_choice && { confirm_choice: own.confirm_choice }),
        submitted_at: project.submitted_at.toISOString(),
        program_title: program.title,
        // For record_submission's reply: a program without coins skips the coin line (M3).
        token_policy: program.token_policy,
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
    })
    .then(async (res) => {
      if (!('updated' in res))
        await enteredEvent({
          projectId: res.project_id,
          installationId,
          programId: program.id,
          repoUrl: repo_url ?? null,
          wallet: entry?.payoutWallet ?? null,
        });
      await submittedEvent({
        projectId: res.project_id,
        installationId,
        programId: program.id,
        repoUrl: repo_url ?? null,
        url: input.external_submission_url ?? undefined,
        said: input.builder_submitted === true,
      });
      return res;
    });
}

/**
 * v2.8 Task 8 fix round 1 (item 1): the wallet stored on this installation's entry of the project
 * (ownEntry's rule), or null. The confirmation offer shows it, since a "go" without a wallet
 * launches to it; so the wallet shown and the wallet used are the same.
 */
export async function ownEntryWallet(k: { programId: string; installationId: number; repoUrl: string | null; name: string }) {
  if (!k.repoUrl && !k.name.trim()) return null;
  return (await ownEntry(sql(), k))?.creator_wallet ?? null;
}

/**
 * v2.8 Ruling 1 (plan): the entry at the confirmation step (confirm_entry). Finds this
 * installation's entry of the project in the program through the same rule as recordSubmission
 * (ownEntry: same normalized repo, or the same name without a repo), or inserts it (charged against
 * recordSubmission's 20 a day through `charge`, only then). `complete_at` is set once (completeAt's
 * rule, COALESCE in SQL). No `submissions` row is written: a confirmed entry counts as submitted
 * (on the public board too, Ruling C10) only once record_submission records it or it is proven.
 *
 * The choice (Ruling 3 (plan), Task 7's carry): "skip" never lands on a row that has an EarnKit
 * token or claim (it stays "go"), so an eligible entry can never drop out of a round; once the entry
 * is submitted (`submission_confirmed_at`) or proven (`submission_proof_ok_at`) the choice is locked,
 * except that a row from before v2.8 gets one.
 *
 * Fix round 1 (item 2): a token link the builder typed (an older entry) is not EarnKit's token. It
 * is never returned as `token_url`, and a "go" moves it to `own_token_url` (Ruling C11: kept, never
 * shown as EarnKit's token) so EarnKit's token can launch (one per repo still holds at the claim).
 */
export async function startEntry(a: {
  program: ProgramRow;
  installationId: number;
  project: z.infer<typeof ProjectInfo> & { name: string };
  answers: Record<string, string>;
  choice: 'go' | 'skip';
  now: Date;
  charge?: () => Promise<unknown>;
  /** v2.9 A5: this step's link and contract checks; stored as live_verified_at / contract_verified_at. */
  verified?: KnownInfo['verified'];
}): Promise<{
  id: number;
  created: boolean;
  token_url: string | null;
  confirm_choice: 'go' | 'skip';
  /** Ruling C24: the last "go" on this entry stopped at the repo's proof line. */
  proof_line_missed: boolean;
  /** v2.8.1 §A1: when the launch claim was taken (token_url 'pending'); null otherwise or before v2.8.1. */
  token_claimed_at: Date | null;
  /** v2.8.1 §A1: a pending claim whose deploy answered without a clear result (its note is set). */
  token_settled: boolean;
}> {
  const { program, installationId, project, answers, choice, now } = a;
  const tooLarge = submissionDataProblem(answers, OTHER_VALUE_MAX);
  if (tooLarge) throw new EntryError(tooLarge);
  const repoUrl = entryRepoUrl(project.repo_url, answers) ?? null;
  const completeNow = completeAt(program.submission_requirements, { project: { ...project, repo_url: repoUrl ?? undefined }, answers, verified: a.verified }, null, now);
  const checked = verifiedAt(a.verified, now);
  const key = { programId: program.id, installationId, repoUrl, name: project.name };
  const out = await sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`own-entry:${program.id}:${installationId}`}))`;
    const own = await ownEntry(tx, key);
    // v2.10 R10 (Pre-flight P4): the repo is private when it was read through the read-only App (a
    // `via_app` facts row); no row means public. Once private, an entry stays private (fail closed).
    const gh = repoUrl ? githubRepo(repoUrl) : null;
    const [{ repo_private }] = gh
      ? await tx<{ repo_private: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM github_repo_facts WHERE full_name = ${`${gh.owner}/${gh.repo}`.toLowerCase()} AND via_app) AS repo_private`
      : [{ repo_private: false }];
    // An EarnKit token or claim on the row (N1), never a token link the builder typed; and whether
    // the entry is submitted or proven (the choice is then locked). Fresh fragments per use.
    const earnkit = () => tx`(coin_address IS NOT NULL OR COALESCE(token_status IN ('launched', 'pending'), false))`;
    const locked = () => tx`(submission_confirmed_at IS NOT NULL OR submission_proof_ok_at IS NOT NULL)`;
    let row: { id: number; token_url: string | null; confirm_choice: 'go' | 'skip'; proof_line_missed: boolean; token_claimed_at: Date | null; token_settled: boolean };
    if (own) {
      [row] = await tx<typeof row[]>`
        UPDATE projects SET
          confirmed_at = COALESCE(confirmed_at, ${now}),
          confirm_choice = CASE
            WHEN ${choice} = 'skip' AND ${earnkit()} THEN 'go'
            WHEN confirm_choice IS NULL OR NOT ${locked()} THEN ${choice}
            ELSE confirm_choice END,
          -- Ruling C11: never erase builder data. The typed link moves to own_token_url (the old
          -- value: SET reads the row as it was), never shown as EarnKit's token or on a public page.
          own_token_url = CASE
            WHEN ${choice} = 'go' AND token_url IS NOT NULL AND NOT ${earnkit()}
              AND NOT (confirm_choice IS NOT DISTINCT FROM 'skip' AND ${locked()}) THEN token_url
            ELSE own_token_url END,
          token_url = CASE
            WHEN ${choice} = 'go' AND token_url IS NOT NULL AND NOT ${earnkit()}
              AND NOT (confirm_choice IS NOT DISTINCT FROM 'skip' AND ${locked()}) THEN NULL
            ELSE token_url END,
          complete_at = COALESCE(complete_at, ${completeNow}),
          repo_private = repo_private OR ${repo_private},
          live_verified_at = CASE WHEN ${checked !== null} THEN ${checked?.live_verified_at ?? null}::timestamptz ELSE live_verified_at END,
          contract_verified_at = COALESCE(${checked?.contract_verified_at ?? null}::timestamptz, contract_verified_at)
        WHERE id = ${own.id}
        RETURNING id, CASE WHEN ${earnkit()} THEN token_url END AS token_url, confirm_choice,
          -- v2.9 B9: a stop on the GitHub sign-in (G10, G11) counts the same way (P10).
          COALESCE(token_status = 'gate_failed' AND (starts_with(token_note, ${PROOF_LINE_PREFIX})
            OR starts_with(token_note, ${SIGN_IN_FIRST}) OR starts_with(token_note, ${WALLET_CHANGED})), false) AS proof_line_missed,
          token_claimed_at, (token_url = 'pending' AND token_note IS NOT NULL) IS TRUE AS token_settled`;
    } else {
      await a.charge?.();
      [row] = await tx<typeof row[]>`
        INSERT INTO projects ${tx({
          program_id: program.id,
          name: project.name,
          description: project.description ?? null,
          repo_url: repoUrl,
          live_url: project.live_url ?? null,
          demo_url: project.demo_url ?? null,
          installation_id: installationId,
          bonus_repo_key: repoUrl ? normalizeRepoUrl(repoUrl) : null,
          confirmed_at: now,
          confirm_choice: choice,
          complete_at: completeNow,
          repo_private,
          ...checked,
        })} RETURNING id, NULL::text AS token_url, confirm_choice, false AS proof_line_missed, NULL::timestamptz AS token_claimed_at, false AS token_settled`;
    }
    return {
      id: row.id,
      created: !own,
      token_url: row.token_url,
      confirm_choice: row.confirm_choice,
      proof_line_missed: row.proof_line_missed,
      token_claimed_at: row.token_claimed_at,
      token_settled: row.token_settled,
    };
  });
  if (out.created) await enteredEvent({ projectId: out.id, installationId, programId: program.id, repoUrl });
  return out;
}
