import type postgres from 'postgres';
import { z } from 'zod';
import { bonusOn, roundFor } from './bonus-rounds';
import { sql } from './db';
import {
  EntryError,
  entryFieldProblems,
  givenWallet,
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
import { proofCheck, type ProofOutcome } from './submission-proof';
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
    /**
     * v2.6 Ruling 5 (plan): the builder confirmed the entry is submitted on the program's own site.
     * Only `true` counts; stored as `submission_confirmed_at`. Never derived from builder_confirmed.
     */
    builder_submitted: z.unknown().optional(),
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
 * entry (ownership was already proven by the token gate to launch it) and a submission that counts
 * (`submission_proof_ok_at`: since when, on any v2.6 basis; a v2.5 row with it set and no basis
 * counted on its page). Derived, never stored separately, so it can never go stale against either
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
  const confirm = 'Pass builder_submitted: true once the builder confirms the entry is submitted on the program site.';
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
  submission_proof_url: string | null;
  submission_proof_ok_at: Date | null;
  submission_basis: string | null;
  submission_confirmed_at: Date | null;
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
    SELECT id, token_url, submission_proof_url, submission_proof_ok_at, submission_basis, submission_confirmed_at
    FROM projects
    WHERE program_id = ${k.programId} AND installation_id = ${k.installationId} AND payout_wallet IS NULL
      AND ${key ? q`bonus_repo_key = ${key}` : q`repo_url IS NULL AND lower(name) = lower(${k.name})`}
    ORDER BY (coin_address IS NOT NULL) DESC, submitted_at, id
    LIMIT 1`;
  return row ?? null;
}

/** A program's submission site as builder text ("dorahacks.io"), or null. Pure. */
const siteOf = (url: string | null | undefined) =>
  url && URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, '') : null;

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
  const existing = program.campaign ? null : await ownEntry(sql(), sameEntryKey);

  // v2.6 §3: how this entry's submission counts for the builder bonus (submissionBasis). With a
  // public submission page (a submission_proof pattern) EarnKit checks the external URL; without
  // one, the builder's confirmation counts. A failure never fails the submission: it's recorded
  // either way, just not (yet) bonus-eligible, with a note telling the agent what to fix. The cron
  // re-checks a page daily while the round is open (submission-proof.ts recheckSubmissionProofs).
  let submissionProofUrl: string | null = existing?.submission_proof_url ?? null;
  // An existing entry keeps what it has unless the bonus check below runs (e.g. the program closed).
  let submissionProofOkAt: Date | null = existing?.submission_proof_ok_at ?? null;
  let submissionProofCheckedAt: Date | null = null;
  let submissionBasisValue = (existing?.submission_basis ?? null) as 'page' | 'unverified_page' | 'confirmed' | null;
  let submissionConfirmedAt: Date | null = existing?.submission_confirmed_at ?? null;
  let bonusNote: string | null = null;
  // Builder text when the entry doesn't count yet (I3): what joins the builder bonus.
  let bonusJoin: { kind: 'confirm' | 'page' | 'link'; site: string } | null = null;
  if (bonusOn(program)) {
    const now = new Date();
    if (input.builder_submitted === true) submissionConfirmedAt ??= now;
    let outcome: ProofOutcome | null = null;
    if (program.submission_proof) {
      submissionProofUrl = input.external_submission_url ?? existing?.submission_proof_url ?? null;
      // Already counting on this same page: kept as it is, no fetch (a transient failure now must
      // never undo it; the daily re-check owns unverified pages).
      const countsOnPage =
        existing !== null &&
        existing.submission_proof_ok_at !== null &&
        existing.submission_basis !== 'unverified_page' &&
        existing.submission_basis !== 'confirmed' &&
        existing.submission_proof_url === submissionProofUrl;
      if (countsOnPage) outcome = { kind: 'ok' };
      else if (submissionProofUrl) {
        outcome = await proofCheck(program, submissionProofUrl, repo_url, live_url, { fetchText: deps.fetchProof });
        submissionProofCheckedAt = now;
      }
    }
    // I2: a page that loaded without the entry's link disproves the confirmation.
    if (outcome?.kind === 'refused') submissionConfirmedAt = null;
    const counted = submissionBasis({
      hasPattern: program.submission_proof !== null,
      outcome,
      confirmed: submissionConfirmedAt !== null,
    });
    if (counted.basis) {
      submissionBasisValue = counted.basis;
      submissionProofOkAt = existing?.submission_proof_ok_at ?? now;
    } else {
      submissionBasisValue = null;
      submissionProofOkAt = null;
      bonusJoin = {
        // Ruling 24: a public entry page with no link given asks for the link.
        kind: !program.submission_proof
          ? 'confirm'
          : !submissionProofUrl
            ? 'link'
            : outcome?.kind === 'refused'
              ? 'page'
              : 'confirm',
        site: program.submission_proof?.host ?? siteOf(program.submission_url) ?? program.title,
      };
    }
    bonusNote = counted.note;
  }

  // Ruling 13a: an external entry's own contracts, verified, for the builder bonus's users signal.
  let bonusContracts: string[] | null = null;
  let bonusDeployers: string[] | null = null;
  let bonusWallet: string | null = null;
  const notes: string[] = bonusNote ? [bonusNote] : [];
  if (bonusOn(program)) {
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
  let coinElsewhere = false;
  if (bonusRepoKey && bonusOn(program)) {
    const coin = (await repoCoinPrograms([bonusRepoKey]).catch(() => new Map<string, { program_id: string; title: string }>())).get(bonusRepoKey);
    // Ruling 25 is about another program: a coin in this same program is Ruling 13b's case.
    if (coin && coin.program_id !== program.id) {
      coinElsewhere = true;
      const line = repoCoinNote(coin.title);
      notes.push(`${line[0].toUpperCase()}${line.slice(1)}.`);
    }
  }
  // v2.6 §3: the round this entry's coin would enter, for the after-submission reply (null with
  // no bonus, no open round, or Ruling 25).
  const openRound = bonusOn(program) && !coinElsewhere ? roundFor(program, new Date()) : null;
  // Ruling 10 (plan): outside campaigns, a valid wallet named here is this installation's last
  // wallet, prefilled next time (campaign entries remember their proven payout wallet below).
  const lastWallet = entryWallet?.toLowerCase() ?? null;
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
      // I1: one entry per installation, program and project; serialized so two calls at once
      // can't both insert. A row found now is updated (not charged: no new entry).
      let own: OwnEntry | null = null;
      if (!program.campaign) {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`own-entry:${program.id}:${installationId}`}))`;
        own = await ownEntry(tx, sameEntryKey);
      }
      // The daily limit counts recorded entries only (v2.4 §2): checks that failed above cost nothing.
      if (!own) await deps.charge?.();
      if (bonusRepoKey && bonusOn(program)) {
        // Only an earlier ELIGIBLE entry (coin and proof) holds the repo (Ruling 15): a squatter's
        // row or the builder's own failed attempt never blocks (traction.ts eligibleSql).
        const [earlier] = await tx<{ id: number }[]>`
          SELECT id FROM projects WHERE program_id = ${program.id} AND bonus_repo_key = ${bonusRepoKey}
            AND id <> ${existing?.id ?? 0}
            AND coin_address IS NOT NULL AND submission_proof_ok_at IS NOT NULL ${beforeEnd(tx)}
          ORDER BY submitted_at, id LIMIT 1`;
        if (earlier)
          notes.push(
            `Not eligible for the builder bonus: entry #${earlier.id} already holds this repo in this program, and only the earliest eligible entry of a repo is.`,
          );
      }
      if (bonusContracts && bonusOn(program)) {
        // A contract backs only one eligible entry per program, the earliest (Ruling 15; scoring
        // drops it from later entries, traction.ts ownContracts).
        const held = await tx<{ id: number; contracts: string[] }[]>`
          SELECT id, contracts FROM projects
          WHERE program_id = ${program.id} AND contracts && ${bonusContracts}::text[]
            AND id <> ${existing?.id ?? 0}
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
      const [project] = own
        ? await tx<{ id: number; submitted_at: Date }[]>`
          UPDATE projects SET
            submission_proof_url = ${submissionProofUrl},
            submission_proof_ok_at = ${submissionProofOkAt},
            submission_basis = ${submissionBasisValue},
            submission_confirmed_at = ${submissionConfirmedAt},
            submission_proof_checked_at = COALESCE(${submissionProofCheckedAt}, submission_proof_checked_at),
            contracts = COALESCE(${bonusContracts}::text[], contracts),
            deployers = COALESCE(${bonusDeployers}::text[], deployers),
            creator_wallet = CASE WHEN token_url IS NULL AND ${bonusWallet}::text IS NOT NULL THEN ${bonusWallet} ELSE creator_wallet END
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
        contracts: entry?.contracts ?? bonusContracts,
        deployers: deployers ?? bonusDeployers,
        bonus_repo_key: bonusRepoKey,
        ...(bonusWallet && { creator_wallet: bonusWallet }),
        submission_proof_url: submissionProofUrl,
        submission_proof_ok_at: submissionProofOkAt,
        submission_proof_checked_at: submissionProofCheckedAt,
        submission_basis: submissionBasisValue,
        submission_confirmed_at: submissionConfirmedAt,
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
        ...(own && { updated: true as const, coin_url: own.token_url }),
        bonus_join: bonusJoin,
        submitted_at: project.submitted_at.toISOString(),
        program_title: program.title,
        // For record_submission's reply: a program without coins skips the coin line (M3).
        token_policy: program.token_policy,
        bonus_round: openRound ? { key: openRound.key, ends_at: openRound.ends.toISOString() } : null,
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
