import { z } from 'zod';
import type { ProjectField, SubmissionRequirement } from './program-file';
import type { Chain } from './chains';
import { LIVE_FAILED_LINE, PLACEHOLDER_LINE, contractMissingLine, contractUncheckedLine, liveErrorLine } from './placeholder';
import { BuilderUrl, RAW_CAP, builderUrlProblem } from './untrusted-text';

export const ProjectInfo = z
  .object({
    // Bounded before any cleaning; campaign entries are then held to TEXT_LIMITS (cleanProject).
    name: z.string().max(RAW_CAP).optional(),
    description: z.string().max(RAW_CAP).optional(),
    // Links reach other people's agents and pages: https, one line, at most 200 characters.
    repo_url: BuilderUrl.optional(),
    live_url: BuilderUrl.optional(),
    demo_url: BuilderUrl.optional(),
    token_url: BuilderUrl.optional(),
    // v2.9 A5 (Pre-flight P4): up to 2 mainnet contracts the project deployed, for the contract check.
    // An array, unlike the `contracts` answer (one comma-separated string, submission_data) and the
    // projects.contracts column (Base contracts a campaign or the builder bonus scores).
    contracts: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'a 0x contract address')).max(2).optional(),
  })
  .strict();
export type ProjectInfo = z.infer<typeof ProjectInfo>;

export type KnownInfo = {
  project?: ProjectInfo;
  /** Answers to program questions, by submission requirement key. */
  answers?: Record<string, string>;
  /**
   * v2.9 A5: this entry's link and contract checks (verify.ts entryVerified). When given, a required
   * item filled from live_url is missing unless the live link loaded, and, when the program needs a
   * contract on a chain, unless one has code there. Absent: v2.8.1's rules.
   */
  verified?: { live: boolean; liveError?: string | null; contract: boolean | null; needsContract: Chain | null };
};

/** v2.9 A5: why a required live link doesn't count yet (`verified`), or null. Pure. */
function unverifiedProblem(req: SubmissionRequirement, verified: KnownInfo['verified']): string | null {
  if (!verified || !req.required || req.project_field !== 'live_url') return null;
  if (!verified.live) return verified.liveError ? liveErrorLine(verified.liveError) : LIVE_FAILED_LINE;
  // Ruling G15: "not found" only on a real answer; a check that couldn't run keeps the item open.
  if (verified.needsContract && verified.contract === false) return contractMissingLine(verified.needsContract);
  if (verified.needsContract && verified.contract === null) return contractUncheckedLine(verified.needsContract);
  return null;
}

function problemWith(req: SubmissionRequirement, value: string): string | null {
  const urlProblem = req.type === 'url' ? builderUrlProblem(value) : null;
  // v2.9 A5: a placeholder link is said as the builder reads it.
  if (urlProblem === PLACEHOLDER_LINE) return PLACEHOLDER_LINE;
  if (urlProblem) return `Not a valid link: ${urlProblem}.`;
  if (req.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return 'Not a valid email.';
  if (req.type === 'choice' && req.options && !req.options.includes(value)) {
    return `Must be one of: ${req.options.join(', ')}.`;
  }
  return null;
}

/**
 * Compares what the agent knows against the program's real submission
 * requirements. Pure: never invents values, only reports what is filled,
 * what is missing, and who should supply each missing piece.
 */
export function prepareSubmission(
  requirements: SubmissionRequirement[],
  known: KnownInfo,
) {
  const answers = known.answers ?? {};
  const project = known.project ?? {};

  const complete: {
    key: string;
    label: string;
    value: string;
    filled_from: 'answer' | ProjectField;
  }[] = [];
  const missing: {
    key: string;
    label: string;
    type: SubmissionRequirement['type'];
    required: boolean;
    description?: string;
    options?: string[];
    problem?: string;
    next_step: string;
  }[] = [];

  for (const req of requirements) {
    const fromAnswer = answers[req.key]?.trim();
    const fromProject = req.project_field
      ? project[req.project_field]?.trim()
      : undefined;
    const value = fromAnswer || fromProject;
    const problem = value ? (problemWith(req, value) ?? unverifiedProblem(req, known.verified)) : null;

    if (value && !problem) {
      complete.push({
        key: req.key,
        label: req.label,
        value,
        filled_from: fromAnswer ? 'answer' : req.project_field!,
      });
      continue;
    }

    missing.push({
      key: req.key,
      label: req.label,
      type: req.type,
      required: req.required,
      ...(req.description && { description: req.description }),
      ...(req.options && { options: req.options }),
      ...(problem && { problem }),
      next_step:
        req.from === 'builder'
          ? 'Use what you know for sure about the builder (e.g. their GitHub or X); otherwise ask. Never guess.'
          : 'Draft this from the project, then confirm it with the builder.',
    });
  }

  const knownKeys = new Set(requirements.map((r) => r.key));
  const unused_answers = Object.keys(answers).filter((k) => !knownKeys.has(k));

  return {
    ready: missing.every((m) => !m.required),
    complete,
    missing,
    ...(unused_answers.length > 0 && { unused_answers }),
  };
}

/**
 * The wallet this installation used for its last campaign entry, as a question for the builder
 * (I8): shown in full and never put into the answers, since a hosted client sharing one
 * registration shares this memory. Only when the program asks for a payout wallet and the agent
 * didn't pass one. Returns the wallet to ask about and the note for the agent, or nulls. Pure;
 * exported for tests.
 */
export function rememberedWalletQuestion(
  requirements: SubmissionRequirement[],
  answers: Record<string, string> | undefined,
  remembered: string | null,
): { wallet: string | null; note: string | null } {
  if (
    !remembered ||
    answers?.payout_wallet?.trim() ||
    !requirements.some((r) => r.key === 'payout_wallet')
  )
    return { wallet: null, note: null };
  return {
    wallet: remembered,
    note:
      `Pay prizes to ${remembered}? Confirm with the builder. It is the payout wallet of the last entry ` +
      'made through this connection; pass it as payout_wallet only after they say yes.',
  };
}
