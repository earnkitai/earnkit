import { z } from 'zod';
import { alsoProgramFacts, getProgram, getProgramRow, isOpen, listPrograms } from './programs';
import {
  RecordSubmissionInput,
  recordSubmission,
  answersOf,
  enteredProgramIds,
  ownEntryWallet,
  startEntry,
  type EntryDeps,
} from './projects';
import { EntryError, githubRepo, givenWallet, isWalletAddress, normalizeRepoUrl, presentYourEntries } from './campaigns';
import { signToEnter } from './entry-proof';
import { boardLink, confirmTable, enteredText, noCoinYet, todoOf, type EnteredText } from './entry-text';
import { cleanTokenName, proposeToken, repoNameOf, tickerProblem, titleCase } from './token-proposal';
import { earnkitCampaignRows, yourCampaignEntries } from './leaderboard';
import {
  checkPrograms,
  rememberWallets,
  rememberedWallet,
  setFitChains,
  setWorkingOn,
} from './installations';
import { ReportOutcome, outcomeQuestion, outcomeToAsk, saveSelfReport } from './outcomes';
import { sinceLine, sinceYouLastChecked } from './alerts';
import {
  GitHubError,
  MatchProjectsInput,
  ReportedRepoInput,
  cachedRepoChains,
  checkEligibility,
  matchProjects,
} from './match-projects';
import { alsoQualifies, alsoText, type AlsoRow } from './also-qualifies';
import {
  bonusCell,
  bonusProgramIds,
  closesInDays,
  presentFirstMessage,
  programUpdates,
  type YourRepos,
} from './present';
import { SPONSOR_NOT_OPEN, escrowEnabled } from './escrow';
import { createSponsorDraft, prepareAward, sponsorStatus } from './sponsor';
import { AwardPicks, DraftInput, SponsorError } from './sponsor-rules';
import {
  ProjectInfo,
  rememberedWalletQuestion,
  prepareSubmission,
} from './submission';
import { OWNERSHIP_FILE } from './ownership';
import {
  CANT_PUSH_RETRY_NOTE,
  LaunchTokenInput,
  SKIPPED_ENTRY,
  confirmToken,
  hasBuilderBonus,
  launchReplyMs,
  launchToken,
  pendingOutcome,
  submissionToken,
  tokenProposalBlock,
  type TokenFlowDeps,
} from './token-launch';
import { RAW_CAP, cleanProject, quoted } from './untrusted-text';
import { tokenLineFor } from './token-gate';
import { READY_TO_SUBMIT, bonusCountsIn, confirmDecision, confirmOffer, proofLineWaiting, walletQuestion, NO_WALLET_HINT, TOKEN_ERROR_CONFIRM } from './confirm';
import { kitAgentNote, submitKit, type SubmitKit } from './submit-kit';
import {
  applicationOf,
  bankFill,
  coachFields,
  coachIntro,
  draftTable,
  fixesLine,
  askableKeys,
  preSubmitCheck,
  questionsFor,
} from './coach';
import { projectKey, readBank, saveApplication, saveBank } from './answer-bank';
import type { FieldKind } from './program-file';
import type { ProgramRow } from './programs';
import { RateLimitError, enforce } from './rate-limit';
import { roundPoolsWei as readRoundPools } from './bonus-rounds';
import { LAUNCHING, REPO_HAS_TOKEN, launchClaimedAt, repoCoinPrograms, tokenLaunchesAvailable, type TokenOutcome } from './tokens';

/** Who is calling: the installation behind the MCP connection. */
export type ToolContext = {
  installationId: number;
  /** Test and e2e injection only; never set by the MCP route. */
  tokenDeps?: TokenFlowDeps;
  /** Test and e2e injection only; never set by the MCP route. */
  entryDeps?: EntryDeps;
  /**
   * The open rounds' builder bonus pools in wei, by program id (null: the program's round froze);
   * defaults to roundPoolsWei.
   */
  roundPoolsWei?: (programIds: string[]) => Promise<Map<string, bigint | null>>;
  /** Ruling 25: the program each normalized repo's coin is entered in; defaults to repoCoinPrograms. */
  repoCoins?: (repoKeys: string[]) => Promise<Map<string, { program_id: string; title: string }>>;
  /** Test and e2e injection only; never set by the MCP route. */
  matchProjects?: typeof matchProjects;
};

/**
 * The open rounds' builder bonus pools so far, by program id, in one grouped read (Ruling 3; the
 * bonus ledger). A program with no pool yet shows "new pool" (v2.6 §1).
 */
export const roundPoolsWei = (programIds: string[]): Promise<Map<string, bigint | null>> => readRoundPools(programIds);

/** One batched pool read per list_programs; it never fails the tool: on any error, no pools. */
async function poolsOf(read: (ids: string[]) => Promise<Map<string, bigint | null>>, ids: string[]) {
  if (ids.length === 0) return new Map<string, bigint | null>();
  try {
    return await read(ids);
  } catch (err) {
    console.error('[list_programs] builder bonus pools:', err);
    return new Map<string, bigint | null>();
  }
}

/** Ruling 25: one read of where the builder's matched repos already have a coin; never fails the tool. */
async function repoCoinsOf(
  read: (keys: string[]) => Promise<Map<string, { program_id: string; title: string }>>,
  repos: YourRepos | null,
) {
  const keys = repos && 'fits' in repos ? [...new Set(repos.fits.flatMap((f) => (f.repo_url ? [normalizeRepoUrl(f.repo_url)] : [])))] : [];
  if (keys.length === 0) return new Map<string, { program_id: string; title: string }>();
  try {
    return await read(keys);
  } catch (err) {
    console.error('[list_programs] repo coins:', err);
    return new Map<string, { program_id: string; title: string }>();
  }
}

const ProgramId = z.object({ program_id: z.string() }).strict();

const GetProgramInput = ProgramId.extend({
  /** "owner/repo" or a github.com link: adds an eligibility check for that repo. */
  repo: z.string().optional(),
}).strict();

/**
 * v2.8 Ruling 7 (plan): what the agent can do. `browser` (default false): it drives the builder's
 * own logged-in browser. `can_push` (default true): it can push to the repo; false means no token
 * launch is attempted.
 */
const AgentInput = z.object({ browser: z.boolean().optional(), can_push: z.boolean().optional() }).strict();

const PrepareSubmissionInput = ProgramId.extend({
  project: ProjectInfo.optional(),
  answers: z.record(z.string(), z.string()).optional(),
  agent: AgentInput.optional(),
  /**
   * v2.8 Part D: true once the builder has answered this program's questions, so the coach asks
   * once per program (at most 3 questions for the first, 1 after) and never a second round.
   */
  coach_asked: z.boolean().optional(),
}).strict();

/** v2.8 Ruling 1 (plan): the confirmation step's input. */
const ConfirmEntryInput = z
  .object({
    program_id: z.string(),
    project: ProjectInfo.extend({ name: z.string().max(RAW_CAP).trim().min(1) }),
    answers: z.record(z.string(), z.string()),
    decision: z.enum(['go', 'skip']).optional(),
    builder_confirmed: z.literal(true).optional(),
    token: z.object({ name: z.string().max(200).optional(), symbol: z.string().max(20).optional() }).strict().optional(),
    wallet: z.string().optional(),
    agent: AgentInput.optional(),
  })
  .strict();

/**
 * v2.8 Part C: what the confirmation offer and decision read about a program and repo. `coinIn`
 * (Ruling 5 (plan)): the other program this repo's one token is entered in; a failed read never
 * fails the tool (no offer change).
 */
async function offerFacts(program: ProgramRow, repoUrl: string | null | undefined, ctx: ToolContext) {
  const key = repoUrl ? normalizeRepoUrl(repoUrl) : null;
  let coinIn: string | null = null;
  if (key) {
    const coins = await (ctx.repoCoins ?? repoCoinPrograms)([key]).catch((err: unknown) => {
      console.error('[confirm] repo token lookup', err instanceof Error ? err.name : 'error');
      return new Map<string, { program_id: string; title: string }>();
    });
    const coin = coins.get(key);
    if (coin && coin.program_id !== program.id) coinIn = coin.title;
  }
  return {
    hasBonus: hasBuilderBonus(program),
    coinIn,
    policyOff: program.token_policy === 'off',
    available: (ctx.tokenDeps?.available ?? tokenLaunchesAvailable)(),
  };
}

/**
 * v2.8.1 §A2: the token the confirmation offer names: the builder's own name and ticker when the
 * agent passed both, else EarnKit's proposal (the project name, else the repo name). Null when there
 * is nothing to name it from. The launch re-checks the ticker before it deploys (C6).
 */
async function offerProposal(
  projectName: string | undefined,
  repoUrl: string | null,
  edit: { name?: string; symbol?: string } | undefined,
  ctx: ToolContext,
): Promise<{ name: string; symbol: string } | null> {
  if (edit?.name?.trim() && edit.symbol?.trim()) {
    const name = cleanTokenName(edit.name);
    const symbol = edit.symbol.trim().toUpperCase();
    if ('name' in name && !tickerProblem(symbol)) return { name: name.name, symbol };
  }
  const base = projectName?.trim() || titleCase(repoNameOf(repoUrl ?? undefined) ?? '');
  if (!base) return null;
  const p = await proposeToken(base, ctx.tokenDeps?.check, repoUrl ?? undefined);
  return { name: p.name, symbol: p.symbol };
}

/**
 * Final review I3: the other program this entry's repo token is entered in, or null (no repo, no
 * token, or the token is this program's). A failed read logs the error class and is null.
 */
async function tokenElsewhere(parsed: z.infer<typeof RecordSubmissionInput>, ctx: ToolContext): Promise<string | null> {
  const repoUrl = parsed.project.repo_url ?? answersOf(parsed.submission_data).repo_url ?? null;
  if (!repoUrl) return null;
  const key = normalizeRepoUrl(repoUrl);
  const coins = await (ctx.repoCoins ?? repoCoinPrograms)([key]).catch((err: unknown) => {
    console.error('[record] repo token lookup', err instanceof Error ? err.name : 'error');
    return new Map<string, { program_id: string; title: string }>();
  });
  const coin = coins.get(key);
  return coin && coin.program_id !== parsed.program_id ? coin.title : null;
}

/**
 * v2.8 Ruling 29 (plan): "Also qualifies", right after record_submission records the entry.
 * Chains come from the repo-facts cache for this repo when present, else the entered program's
 * own chains (the repo was just entered there). Never fails the reply: on error the caller logs
 * `[also_qualifies]` with the error class and the whole section is left out.
 */
async function alsoQualifiesBlock(
  parsed: z.infer<typeof RecordSubmissionInput>,
  ctx: ToolContext,
): Promise<{ rows: AlsoRow[]; text: string | null }> {
  const repoUrl = parsed.project.repo_url ?? null;
  const name = parsed.project.name;
  const key = projectKey({ repo_url: repoUrl, name });
  const repoKey = repoUrl ? normalizeRepoUrl(repoUrl) : null;
  const full = repoUrl ? githubRepo(repoUrl) : null;
  const [program, programs, enteredIds, bank, coins, cached] = await Promise.all([
    getProgramRow(parsed.program_id),
    alsoProgramFacts(),
    enteredProgramIds(ctx.installationId, { repoUrl, name }),
    readBank(ctx.installationId, key),
    (ctx.repoCoins ?? repoCoinPrograms)(repoKey ? [repoKey] : []),
    full ? cachedRepoChains(`${full.owner}/${full.repo}`) : Promise.resolve(null),
  ]);
  const rows = alsoQualifies({
    enteredProgramId: parsed.program_id,
    chains: cached ?? program.chains,
    programs,
    enteredIds,
    bank,
    answers: answersOf(parsed.submission_data),
    // Final review I1: fields the project info fills (repo, live link, name) are not "left".
    project: parsed.project,
    // Review fix round 1, item 3: the live-product gate reads the project's own live link.
    hasLiveProduct: Boolean(parsed.project.live_url),
    now: new Date(),
  });
  const coinIn = (repoKey && coins.get(repoKey)?.title) || null;
  return { rows, text: alsoText(rows, coinIn) };
}

/** The agent's note with the token line: commit it with the next push, before the builder confirms. */
const TOKEN_LINE_NOTE = 'Commit this line to earnkit.txt at the repo root with your next push, before the builder confirms.';

/** The first line of confirm_entry's reply once the entry is confirmed, before the kit. Pure. */
function tokenLine(token: TokenOutcome | null, fallback: string) {
  // Final review M8: the ticker, when known, so the builder recognizes and shares their token.
  if (token?.status === 'launched' && token.tokens_fun)
    return `Your token${token.symbol ? ` $${token.symbol}` : ''}: ${token.tokens_fun.replace(/^https?:\/\//, '')}. You earn 40% of its fees.`;
  if (token?.status === 'pending') return token.note ?? LAUNCHING;
  return token?.note ?? fallback;
}

/**
 * v2.8 Part D, Ruling 6 (plan): the answer bank's fill for this installation and project. A field
 * the project info fills (its repo, its live link) is never overwritten from the bank. A failed read
 * never fails the tool and logs the error class only (the bank is private).
 */
async function bankedAnswers(
  installationId: number,
  program: ProgramRow,
  project: { name?: string; repo_url?: string; [k: string]: unknown } | undefined,
  repoUrl: string | null | undefined,
  answers: Record<string, string>,
) {
  const name = project?.name?.trim() || titleCase(repoNameOf(repoUrl ?? undefined) ?? '');
  const none = {} as Record<string, string>;
  if (!name && !repoUrl) return { answers, from_bank: none, suggested: none, first: true, key: null, name };
  const key = projectKey({ repo_url: repoUrl, name });
  let bank = new Map<FieldKind, string>();
  try {
    bank = await readBank(installationId, key);
  } catch (err) {
    console.error('[coach] bank read', err instanceof Error ? err.name : 'error');
  }
  const own = (f: string | undefined) => (f && typeof project?.[f] === 'string' ? String(project[f]).trim() : '');
  const reqs = program.submission_requirements.filter((r) => !own(r.project_field));
  const filled = bankFill(reqs, answers, bank);
  // C15: still the project's first program while the bank filled none of what the coach would ask.
  const first = !askableKeys(program.submission_requirements, answers).some((k) => k in filled.from_bank || k in filled.suggested);
  return { ...filled, first, key, name };
}

/** v2.8 Part D: what the agent does with the coach's guidance. */
const COACH_NOTE =
  "Draft every field from the repo, onchain data and the builder's answers, using each field's judges, pattern and limit. " +
  'Make each of coach.judging visible in the field that fits it. When two fields share a kind, write a distinct answer for each. ' +
  "Never answer a field marked builder_only yourself: only the builder's own words go there. " +
  "Re-angle answers from the bank to this program's judges. Then call again with all answers.";
const QUESTIONS_NOTE =
  "Show show_to_builder as written and wait for the answers. Put each answer under the question's keys (a question can cover several; split the answer). " +
  "When a question offers saved details and the builder says yes, use its suggested values. Then pass coach_asked: true (the coach asks once per program). " +
  COACH_NOTE;
const DRAFT_NOTE = 'The table is the draft; when the builder says "show all", show every answer in full.';
const AGENT_FIXES_NOTE =
  'Before showing show_to_builder, make every agent_fixes change yourself (trim to the limit, add the link you know) and call again.';
const FIXES_NOTE = 'If the builder gives what a fix asks for, add it to that answer and call again.';

/** Every coach note for the agent (the copy review scans them). */
export const COACH_NOTES = { COACH_NOTE, QUESTIONS_NOTE, DRAFT_NOTE, AGENT_FIXES_NOTE, FIXES_NOTE };

const ListProgramsInput = z
  .object({
    agent_can_build: z.boolean().default(true),
    github_user: z.string().optional(),
    repos: z.array(z.string()).optional(),
    local_repos: z.array(ReportedRepoInput).max(20).optional(),
    wallet: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, 'wallet must be a 0x address of 40 hex characters; pass the builder wallet or leave it out.')
      .optional(),
  })
  .strict();

/** v2.8 Ruling 30 (plan): what the agent does with ask_outcome. */
export const ASK_OUTCOME_NOTE =
  'Results for this entry were due. After showing show_to_builder, ask the builder this question once, as written. ' +
  "Then call report_outcome with this project_id, their result, and prize_usd if they won money. If they don't know yet, call nothing.";

/** v2.8 Ruling C21: report_outcome's note to the agent. */
export const OUTCOME_SAVED_NOTE = "Saved as the builder's own report. It never shows publicly or counts; only published results do.";

const Ref = z.string().regex(/^0x[0-9a-f]{64}$/, 'the ref from create');
export const SponsorCampaignInput = z.discriminatedUnion('action', [
  DraftInput.extend({ action: z.literal('create') }).strict(),
  z.object({ action: z.literal('status'), ref: Ref }).strict(),
  z
    .object({
      action: z.literal('award'),
      ref: Ref,
      ...AwardPicks,
    })
    .strict(),
]);

/** Alerts never fail a tool: on any error the reply goes out without them. */
async function alertsFor(
  installationId: number,
  opts: { offer?: boolean; otherWins?: string[] } = {},
) {
  try {
    return await sinceYouLastChecked(installationId, opts);
  } catch (err) {
    console.error('[alerts]', err);
    return { lines: opts.otherWins ?? [], scheduleNote: null };
  }
}

/** v2.4 §4: a builder tool's reply opens with "Since you last checked" when there's news. */
async function withAlerts<T extends object>(installationId: number, result: T) {
  const a = await alertsFor(installationId);
  const line = sinceLine(a.lines);
  return { ...(line && { since_you_last_checked: line }), ...result };
}

/** Campaigns (v2.4): a valid wallet answer or null (still missing); the one rule, isWalletAddress. */
const validWallet = (w: string | undefined) =>
  w && isWalletAddress(w.trim()) ? w.trim() : null;

const GITHUB_LIMITED =
  'Too many GitHub repo checks from this agent (30 an hour), so none were run this time.';

/** The agent tools. The MCP server forwards each call here. */
export const tools = {
  // One answer to "what can I earn?": the builder's projects first, then what's worth building,
  // opening with what changed since their last check.
  list_programs: async (input: unknown, ctx: ToolContext) => {
    const { agent_can_build, github_user, repos, local_repos, wallet } =
      ListProgramsInput.parse(input ?? {});
    if (wallet) await rememberWallets(ctx.installationId, [wallet]);
    const [memory, programs, campaigns] = await Promise.all([
      checkPrograms(ctx.installationId, { github_user, repos, local_repos }),
      listPrograms(),
      earnkitCampaignRows(ctx.installationId),
    ]);
    const { lastCheck } = memory;
    // Remembered from an earlier call when not given now.
    const user =
      github_user ??
      (repos?.length ? undefined : (memory.github_user ?? undefined));
    const repoList = repos?.length
      ? repos
      : github_user
        ? undefined
        : (memory.repos ?? undefined);
    const local = local_repos?.length
      ? local_repos
      : (memory.local_repos ?? undefined);
    // Ruling 11 (plan): a GitHub user or repo list, given now or remembered, turns off "You could".
    // Local repos count too (fix round 1, Minor 5): the spec's gate is "no repos are reported or
    // found", and a repo the agent reported is a repo reported, matching error or not.
    const githubGiven = Boolean(user || repoList?.length || local?.length);
    // EarnKit campaigns are their own table (campaigns), not program cards (v2.4 §1).
    const cards = programs.filter((p) => !p.earnkit_campaign).map((p) => ({
      ...p,
      is_new: lastCheck !== null && p.opened_at !== null && p.opened_at > lastCheck,
      closes_in_days: closesInDays(p.ends_at),
    }));

    let yourRepos: YourRepos | null = null;
    if (user || repoList?.length || local?.length) {
      try {
        // Reading GitHub is limited per installation; reported local repos alone read nothing.
        if (user || repoList?.length)
          await enforce('githubMatching', ctx.installationId, GITHUB_LIMITED);
        yourRepos = await (ctx.matchProjects ?? matchProjects)(
          MatchProjectsInput.parse({
            github_user: user,
            repos: repoList,
            local_repos: local,
          }),
        );
      } catch (err) {
        if (err instanceof GitHubError || err instanceof RateLimitError)
          yourRepos = { error: err.message };
        else console.error('[list_programs] matching failed:', err);
      }
    }
    // v2.8 Ruling 10 (plan): the chains of the repos that fit something, for new program alerts.
    // Never fails the tool; a failed match leaves the last ones.
    if (yourRepos && 'fits' in yourRepos) {
      const fit = yourRepos.fits;
      await setFitChains(ctx.installationId, fit.flatMap((f) => f.chains ?? [])).catch((err: unknown) =>
        console.error('[list_programs] fit chains', err instanceof Error ? err.name : 'error'),
      );
    }

    // The builder's campaign entries: rank (or the sponsor campaign's state), prize once paid.
    const yourEntries = await yourCampaignEntries(ctx.installationId);
    // EarnKit campaign standings are in the campaigns table; only sponsor entries get a section.
    const entries = presentYourEntries(
      yourEntries.filter((e) => e.campaign.kind === 'sponsor'),
      lastCheck,
    );
    // EarnKit wins come from the alerts engine (shown once); sponsor wins from here, placed right
    // after them (money first). Read last, so nothing after it can throw away the news.
    const alerts = await alertsFor(ctx.installationId, { offer: true, otherWins: entries.wins });

    // The builder bonus pools: one read, only for provable programs the message shows.
    const pools = await poolsOf(
      ctx.roundPoolsWei ?? roundPoolsWei,
      bonusProgramIds({ cards, repos: yourRepos }),
    );
    const withPools = cards.map((c) => ({
      ...c,
      bonus_pool_wei: pools.get(c.id) ?? null,
      bonus_closed: pools.has(c.id) && pools.get(c.id) === null,
    }));
    const repoCoins = await repoCoinsOf(ctx.repoCoins ?? repoCoinPrograms, yourRepos);

    const show_to_builder = presentFirstMessage({
      alerts: alerts.lines,
      updates: programUpdates(cards, lastCheck === null),
      campaigns,
      cards: withPools,
      repos: yourRepos,
      githubGiven,
      workingOn: memory.working_on,
      agentCanBuild: agent_can_build,
      sponsorEntries: entries.section,
      now: new Date(),
      repoCoins,
    });

    // v2.8 Ruling 30 (plan): at most one entry per call whose results were due; asked once. Read
    // last (review minor 11), so nothing after marking it asked can lose the question. Never fails
    // the tool (the entry is then asked on a later call).
    const ask = await outcomeToAsk(ctx.installationId).catch((err: unknown) => {
      console.error('[list_programs] outcome ask', err instanceof Error ? err.name : 'error');
      return null;
    });

    return {
      show_to_builder,
      note:
        'Show show_to_builder to the builder exactly as written. ' +
        (user || repoList?.length
          ? 'EarnKit remembers their GitHub username or repos for next time. '
          : local?.length
            ? 'EarnKit remembers the repos you reported for next time. '
            : "Next time, pass local_repos: read the builder's local git remotes (git remote -v in their project folders) and report each repo. Never ask for a GitHub username first. ") +
        'Program facts were checked against their sources on verified_at; within 7 days, no need to re-read them.',
      ...(alerts.scheduleNote && { schedule_daily_check: alerts.scheduleNote }),
      ...(ask && {
        ask_outcome: {
          project_id: ask.project_id,
          question: outcomeQuestion(ask.name, ask.program_title),
          agent_note: ASK_OUTCOME_NOTE,
        },
      }),
      // For planning: what each repo still needs, per program. Details: get_program.
      matches:
        yourRepos && 'fits' in yourRepos
          ? yourRepos.fits.flatMap((f) =>
              f.verdicts.map((v) => ({
                repo: f.repo,
                repo_url: f.repo_url,
                program_id: v.program_id,
                status: v.status,
                missing: v.missing,
                effort: v.effort,
              })),
            )
          : [],
      working_on: memory.working_on,
      programs: programs.map((p) => ({
        id: p.id,
        title: p.title,
        summary: p.summary,
        deadline: p.deadline,
        tag: p.tag,
        verified_at: p.verified_at?.toISOString().slice(0, 10) ?? null,
      })),
    };
  },

  get_program: async (input: unknown, ctx: ToolContext) => {
    const { program_id, repo } = GetProgramInput.parse(input);
    const program = await getProgram(program_id);
    if (!repo) return withAlerts(ctx.installationId, program);
    // Eligibility dry run for one repo: pass/fail plus what's missing.
    try {
      await enforce('githubMatching', ctx.installationId, GITHUB_LIMITED);
      return withAlerts(ctx.installationId, {
        ...program,
        eligibility: await checkEligibility(repo, program_id),
      });
    } catch (err) {
      if (!(err instanceof GitHubError || err instanceof RateLimitError))
        throw err;
      return withAlerts(ctx.installationId, {
        ...program,
        eligibility: { error: err.message },
      });
    }
  },

  prepare_submission: async (input: unknown, ctx: ToolContext) => {
    const { program_id, agent, coach_asked, ...known } = PrepareSubmissionInput.parse(input);
    const program = await getProgramRow(program_id);
    // Campaign entries reach the sponsor: check the name and description now, as record_submission will.
    if (program.campaign && known.project)
      known.project = cleanProject(known.project);
    const open = isOpen(program);
    // Remember it, so list_programs leads with "You're working on".
    if (open) await setWorkingOn(ctx.installationId, program_id, true);
    // This installation's last wallet (Ruling 10 (plan)). Campaign entries: asked about in full and
    // never prefilled (I8: a hosted client sharing one registration shares this memory). Other
    // programs: shown short on the confirmation offer's wallet line.
    const remembered = await rememberedWallet(ctx.installationId);
    // Ruling 22: outside campaigns a wallet the builder gave is valid or the call fails.
    const given = program.campaign
      ? validWallet(known.answers?.payout_wallet)
      : givenWallet(known.answers?.payout_wallet);
    const ask = program.campaign
      ? rememberedWalletQuestion(
          program.submission_requirements,
          known.answers,
          remembered,
        )
      : { wallet: null, note: null };
    // v2.8 Part D, Ruling 6 (plan): outside campaigns, the answer bank fills what this project
    // already answered for another program (never a field the agent or the project info gave).
    const banked = program.campaign
      ? null
      : await bankedAnswers(ctx.installationId, program, known.project, known.project?.repo_url ?? known.answers?.repo_url, known.answers ?? {});
    if (banked) known.answers = banked.answers;
    // v2.7 §3, Ruling 15 (plan): readiness first. While required items are missing, the screen
    // leads with them and there is no token offer, wallet or ticker check yet.
    const prep = prepareSubmission(program.submission_requirements, known);
    // C5: as short to-dos (the program's `todo`, else the label normalized); an item given but
    // invalid says "(check it)", its problem is in missing[].problem for the agent.
    const reqs = new Map(program.submission_requirements.map((r) => [r.key, r]));
    const missing = prep.ready
      ? []
      : prep.missing
          .filter((m) => m.required)
          .map((m) => todoOf(reqs.get(m.key) ?? { label: m.label }, Boolean(m.problem)));
    const repoUrl = known.project?.repo_url ?? known.answers?.repo_url;
    // The proposed token; its creator wallet is the entry's payout wallet when there is one.
    // No token block on a closed program (v2.4 §6, audit C22).
    const token = open && prep.ready
      ? await tokenProposalBlock({
          program,
          projectName: known.project?.name,
          // Campaigns: only a payout wallet given in this call (never the remembered one, which
          // is asked about, not assumed); without one the block asks the builder for the fee
          // wallet. Other programs (v2.6 §3): the wallet given now, else the remembered one.
          creatorWallet: program.campaign ? given : (given ?? remembered),
          remembered: !program.campaign && !given && remembered !== null,
          // The earnkit.txt token line is bound to this agent and the repo; shown only in this reply.
          installationId: ctx.installationId,
          repoUrl,
        })
      : null;
    const payoutWallet = given;
    const sign_to_enter = signToEnter(
      program_id,
      repoUrl,
      payoutWallet,
      known.answers?.contracts,
    );
    // v2.4 §2: the one confirmation the builder sees, prize first. Campaigns: the token is one row.
    const table = confirmTable({
      // Fix round 1 (Minor 6): the repo name, as the token is named, before "Your project".
      project: known.project?.name?.trim() || titleCase(repoNameOf(repoUrl) ?? '') || 'Your project',
      programTitle:
        program.campaign?.kind === 'sponsor'
          ? quoted(program.title)
          : program.title,
      campaign: program.campaign,
      prize: program.summary.split(' · ')[0],
      endsAt: program.ends_at,
      payoutWallet,
      missing,
      askWallet: ask.wallet,
      token: token
        ? {
            symbol: token.proposed.symbol,
            name: token.proposed.name,
            wallet: token.creator_wallet,
            hasBonus: token.has_bonus,
            coinIn: token.repo_coin_program,
          }
        : null,
    });
    if (program.campaign)
      return withAlerts(ctx.installationId, {
        program_id,
        ...(!open && { warning: 'This program is closed or past its deadline.' }),
        show_to_builder: table,
        ...prep,
        ...(ask.note && { payout_wallet_note: ask.note }),
        // v2.8 Ruling 23 (plan): how_to_submit and sign_to_enter only while the campaign is open.
        ...(open && {
          how_to_submit:
            'This is an EarnKit campaign: record_submission is the entry; there is no other site. ' +
            `Commit ${OWNERSHIP_FILE} at the repo root (default branch) with the line "payout_wallet: <the payout wallet>" ` +
            "in one commit, together with the token line if the builder keeps the token. Contracts count when they were deployed from the payout wallet, or from your own wallet if you pass deployer_signature: that wallet's EIP-191 signature (personal_sign) of sign_to_enter, which names this program, the repo, the payout wallet and the contracts (it appears once all are known; a changed contract list needs a new signature).",
          ...(sign_to_enter && { sign_to_enter }),
        }),
        ...(token && { token }),
      });

    // v2.8 Part D, Ruling 26 (plan): the coach. Every answer so far (the agent's draft, the bank and
    // the project info); then at most 3 questions (1 once the project has banked answers) for what
    // only the builder can say. While there are questions, they are the whole screen.
    const values: Record<string, string> = {
      ...(known.answers ?? {}),
      ...Object.fromEntries(prep.complete.map((c) => [c.key, c.value])),
    };
    const coach = {
      fields: coachFields(program.submission_requirements),
      facts: {
        chains: program.chains,
        live_url: known.project?.live_url ?? null,
        repo_url: repoUrl ?? null,
      },
      // C13: the program's judging criteria, for the agent to draft toward (never keyword-checked).
      judging: (program.judging?.criteria ?? []).map((c) => c.text),
      from_bank: banked?.from_bank ?? {},
    };
    const questions = open && !coach_asked
      ? questionsFor({
          reqs: program.submission_requirements,
          answers: values,
          first: banked?.first ?? true,
          project: banked?.name,
          suggested: banked?.suggested,
        })
      : [];
    const intro = coachIntro(program.title, questions);
    if (intro)
      return withAlerts(ctx.installationId, {
        program_id,
        show_to_builder: intro,
        questions,
        coach,
        ready: false,
        missing: prep.missing,
        agent_note: QUESTIONS_NOTE,
      });

    // v2.8 Part C, Ruling 4 (plan): other programs. Once ready, the draft, the check's fixes and the
    // confirmation offer (the builder bonus comes with a token) close the screen; the kit comes only
    // from confirm_entry, so no submission link, prefilled link or paste list here.
    const canPush = agent?.can_push !== false;
    const facts = open && prep.ready ? await offerFacts(program, repoUrl, ctx) : null;
    // Fix round 1 (item 1): the wallet this entry already holds comes first; a "go" without a
    // wallet launches to it, so it is the one shown.
    const stored = given || !facts
      ? null
      : await ownEntryWallet({
          programId: program.id,
          installationId: ctx.installationId,
          repoUrl: repoUrl ?? null,
          name: known.project?.name?.trim() || titleCase(repoNameOf(repoUrl) ?? ''),
        });
    const offerWallet = given ?? stored ?? remembered;
    const offer = facts
      ? confirmOffer({
          hasBonus: facts.hasBonus,
          coinIn: facts.coinIn,
          canPush,
          wallet: offerWallet,
          remembered: !given && offerWallet !== null,
          tokensOff: facts.policyOff || !facts.available,
          proposal: token?.proposed ?? null,
        })
      : null;
    const offersToken = facts !== null && !facts.coinIn && canPush && !facts.policyOff && facts.available;
    // Ruling 25 (plan) / Part C: the token line, once the repo is known, for the agent to push with
    // its work before the builder confirms (an agent that can't push gets none).
    const line = repoUrl && canPush && program.token_policy !== 'off' ? tokenLineFor(ctx.installationId, repoUrl) : null;
    // Part D.4: the check before submitting, never blocking; shown with the draft once ready.
    const checked = prep.ready
      ? preSubmitCheck({
          reqs: program.submission_requirements,
          answers: values,
          judging: program.judging ?? null,
          knownLinks: [repoUrl ?? '', known.project?.live_url ?? ''],
        })
      : [];
    const fixes = checked.filter((f) => f.for === 'builder');
    const agent_fixes = checked.filter((f) => f.for === 'agent');
    const show_to_builder = prep.ready
      ? [
          draftTable(program.submission_requirements, values),
          fixesLine(fixes),
          offer ? (offer.endsWith(READY_TO_SUBMIT) ? offer : `Ready. ${offer}`) : null,
        ]
          .filter((x): x is string => Boolean(x))
          .join('\n\n')
      : table;
    const notes = [
      line && TOKEN_LINE_NOTE,
      ...(prep.ready ? [agent_fixes.length > 0 && AGENT_FIXES_NOTE, DRAFT_NOTE, fixes.length > 0 && FIXES_NOTE] : [COACH_NOTE]),
    ].filter(Boolean);
    return withAlerts(ctx.installationId, {
      program_id,
      ...(!open && { warning: 'This program is closed or past its deadline.' }),
      show_to_builder,
      // Ready: the fixes, and what came from the bank (for the agent to re-angle); else the guidance.
      ...(prep.ready
        ? {
            fixes,
            ...(agent_fixes.length > 0 && { agent_fixes }),
            ...(Object.keys(coach.from_bank).length > 0 && { from_bank: coach.from_bank }),
          }
        : { coach }),
      // Review Minor 7: the final values are the kit's job (confirm_entry); this is the draft check.
      ...prep,
      complete: prep.complete.map((c) => ({ key: c.key, label: c.label, filled_from: c.filled_from })),
      ...(token && {
        token: {
          proposed: token.proposed,
          chain: token.chain,
          creator_wallet: token.creator_wallet,
          has_bonus: token.has_bonus,
          repo_coin_program: facts?.coinIn ?? null,
        },
      }),
      // Ruling 30: the wallet the builder sees on the offer's wallet line, to echo as confirm_entry's
      // wallet once they say yes. confirm_entry never reads the remembered wallet itself.
      ...(offersToken && offerWallet && { shown_wallet: offerWallet }),
      ...(line && { token_line: line }),
      ...(notes.length > 0 && { agent_note: notes.join(' ') }),
    });
  },

  // v2.8 Part C, Rulings 1, 4, 5 and 7 (plan): the confirmation step. Without the builder's yes it
  // returns the offer; on "go" the token launches; the submit kit comes only from here.
  confirm_entry: async (input: unknown, ctx: ToolContext) => {
    // v2.8.1 §A5: the reply comes within 50 s; a deploy still running then answers "launching".
    const deadline = Date.now() + launchReplyMs();
    const i = ConfirmEntryInput.parse(input);
    const program = await getProgramRow(i.program_id);
    if (program.campaign) throw new EntryError('EarnKit campaigns are entered in one step.');
    if (!isOpen(program)) throw new EntryError('This program is closed or past its deadline.');
    // Ruling 22: a wallet given is valid or the call fails (a typo never falls back to another).
    const given = givenWallet(i.wallet);
    const repoUrl = i.project.repo_url ?? i.answers.repo_url ?? null;
    // v2.8 Part D: the bank fills what the draft showed from it, so the kit and the snapshot match it.
    const banked = await bankedAnswers(ctx.installationId, program, i.project, repoUrl, i.answers);
    const answers = banked.answers;
    // Every answer (the agent's, the bank's, plus what the project info fills), in the form's order.
    const filled = prepareSubmission(program.submission_requirements, {
      project: { ...i.project, ...(repoUrl && { repo_url: repoUrl }) },
      answers,
    });
    const values = Object.fromEntries(filled.complete.map((c) => [c.key, c.value]));
    // Part D.4: the check before submitting, run before the decision; never blocking.
    const fixes = preSubmitCheck({
      reqs: program.submission_requirements,
      answers: values,
      judging: program.judging ?? null,
      knownLinks: [repoUrl ?? '', i.project.live_url ?? ''],
    });
    const canPush = i.agent?.can_push !== false;
    const facts = await offerFacts(program, repoUrl, ctx);
    const decision = confirmDecision({
      confirmed: i.builder_confirmed === true,
      decision: i.decision,
      coinIn: facts.coinIn,
      canPush,
      hasRepo: Boolean(repoUrl),
      policyOff: facts.policyOff,
      available: facts.available,
    });
    const tokensOff = facts.policyOff || !facts.available;
    const offersToken = !facts.coinIn && canPush && !tokensOff;
    if (decision.kind === 'offer') {
      // Fix round 1 (item 1): the entry's own wallet first (a "go" without a wallet uses it), then
      // the remembered one; whichever is shown comes back as shown_wallet.
      const stored = given
        ? null
        : await ownEntryWallet({ programId: program.id, installationId: ctx.installationId, repoUrl, name: i.project.name });
      const wallet = given ?? stored ?? (await rememberedWallet(ctx.installationId));
      // v2.8.1 §A2: the Yes line names the token that launches: the builder's own edit, else EarnKit's proposal.
      const proposal = offersToken ? await offerProposal(i.project.name, repoUrl, i.token, ctx) : null;
      return {
        show_to_builder: confirmOffer({ hasBonus: facts.hasBonus, coinIn: facts.coinIn, canPush, wallet, remembered: !given && wallet !== null, tokensOff, proposal }),
        ...(offersToken && wallet && { shown_wallet: wallet }),
        ...(proposal && { token: { proposed: proposal } }),
        agent_note:
          "Show show_to_builder as written. When the builder says yes, call confirm_entry again with builder_confirmed: true, decision: 'go'" +
          (offersToken ? ' and wallet: shown_wallet (or the wallet they name instead)' : '') +
          (proposal ? ', and token: token.proposed (the name and ticker the builder saw)' : '') +
          "; when they say skip, decision: 'skip'.",
      };
    }

    // Each confirmation may read GitHub and tokens.fun: bounded per hour, like record_submission.
    await enforce('entryChecks', ctx.installationId, 'This agent has checked 60 entries in the last hour.');
    const entry = await startEntry({
      program,
      installationId: ctx.installationId,
      project: i.project,
      answers,
      choice: decision.kind === 'skip' ? 'skip' : 'go',
      now: new Date(),
      // A new entry counts against the 20 a day (Ruling 1 (plan)); an update never does.
      charge: () => enforce('recordSubmission', ctx.installationId, 'This agent has recorded 20 submissions today, the daily limit.'),
    });

    // Part D.5, Ruling 6 (plan): the final answers and the check on the entry, and the answer bank
    // for this project's next program. Neither ever fails the confirmation; errors log the class only.
    try {
      await saveApplication(ctx.installationId, entry.id, applicationOf(program.submission_requirements, values, fixes, new Date()));
    } catch (err) {
      console.error('[coach] application', entry.id, err instanceof Error ? err.name : 'error');
    }
    if (banked.key)
      try {
        await saveBank(ctx.installationId, banked.key, program.id, program.submission_requirements, values);
      } catch (err) {
        console.error('[coach] bank save', entry.id, err instanceof Error ? err.name : 'error');
      }

    let token: TokenOutcome | null = null;
    if (entry.token_url)
      // v2.8.1 §A1, §A5: launching (the next call has the result), or stuck past 10 minutes.
      token = entry.token_url === 'pending'
        ? pendingOutcome(entry.token_claimed_at, entry.token_settled)
        : { status: 'launched', tokens_fun: entry.token_url, note: 'This entry already has its token.' };
    else if (decision.kind === 'launch' && entry.confirm_choice === 'go') {
      token = await confirmToken(
        { projectId: entry.id, installationId: ctx.installationId, token: i.token, wallet: given, deadline },
        ctx.tokenDeps,
      );
      // Ruling C24, v2.8.1 §A3: never a dead end. The proof line still isn't on the repo after an
      // earlier "go" stopped on it: the entry records without a token, the kit comes back, and the
      // builder reads exactly what the token waits on (never "open this in another agent": this
      // agent can push). The launch stays open: "go" again launches it.
      if (token.fixable && token.proof_line && entry.proof_line_missed)
        token = {
          status: 'skipped',
          note: proofLineWaiting(token.proof_branch),
          ...(token.agent_note && { agent_note: token.agent_note.replace(CANT_PUSH_RETRY_NOTE, '').trim() }),
        };
      // Fixable (no wallet, a ticker, the proof line, a transient read): no kit; fix it and confirm again.
      else if (token.fixable) {
        // Fix round 2: no wallet passed with this "go": nothing launched. The entry's stored wallet,
        // else the remembered one, is suggested as a question, never used unseen.
        const remembered = token.no_wallet
          ? ((await ownEntryWallet({ programId: program.id, installationId: ctx.installationId, repoUrl, name: i.project.name })) ??
            (await rememberedWallet(ctx.installationId)))
          : null;
        const agentNote = remembered ? 'Pass shown_wallet as wallet once the builder confirms it.' : token.agent_note;
        return {
          project_id: entry.id,
          token,
          show_to_builder: token.no_wallet
            ? remembered
              ? walletQuestion(remembered, facts.hasBonus)
              : NO_WALLET_HINT
            : token.note || TOKEN_ERROR_CONFIRM,
          ...(token.no_wallet && remembered && { shown_wallet: remembered }),
          agent_note: `${agentNote ? `${agentNote} ` : ''}The submit kit comes only in confirm_entry's reply, once this is fixed.`,
        };
      }
    } else if (decision.kind === 'launch' && entry.confirm_choice === 'skip')
      token = { status: 'skipped', note: SKIPPED_ENTRY };

    // v2.8.1 §A5: the deploy runs on past the reply time: "launching", no kit yet; the agent calls
    // again shortly and that call returns the token's link with the kit.
    if (token?.launching)
      return {
        project_id: entry.id,
        token,
        show_to_builder: token.note ?? LAUNCHING,
        agent_note: `${token.agent_note ?? ''} The submit kit comes with that reply.`.trim(),
      };

    const skipLine = facts.hasBonus ? 'No token, no builder bonus.' : 'No token.';
    const first =
      decision.kind === 'skip' && !entry.token_url
        ? skipLine
        : tokenLine(token, decision.kind === 'record_only' ? decision.note : skipLine);
    // Ruling C9: an incomplete entry still gets its token; the kit names what is missing first and
    // marks each missing (or invalid) required answer as a blank, never dropping it.
    const kit: SubmitKit = submitKit(
      program,
      values,
      { browser: i.agent?.browser === true },
      { problems: filled.missing.filter((m) => m.problem).map((m) => m.key) },
    );
    return {
      project_id: entry.id,
      ...(token && { token }),
      kit,
      show_to_builder: `${first}\n\n${kit.show_to_builder}`,
      // Part E, Rulings 7, 27, 28 (plan): how this kit is used (the agent's, never the builder's).
      agent_note:
        `Show show_to_builder as written. ${kitAgentNote(kit, program)} ` +
        'Once the builder has submitted, call record_submission with the final answers and builder_submitted: true' +
        (kit.proof.kind === 'entry_link' ? ', and their entry link as external_submission_url.' : '.'),
    };
  },

  record_submission: async (input: unknown, ctx: ToolContext) => {
    // v2.8.1 §A5: the reply comes within 50 s; a deploy still running then answers "launching".
    const deadline = Date.now() + launchReplyMs();
    const parsed = RecordSubmissionInput.parse(input);
    // Every attempt reads GitHub, Base and the explorer, and (v2.5 §3, external programs) the
    // submission proof page: bounded per hour. Only a recorded entry uses one of the 20 a day
    // (v2.4 §2).
    await enforce(
      'entryChecks',
      ctx.installationId,
      'This agent has checked 60 entries in the last hour.',
    );
    const result = await recordSubmission(parsed, ctx.installationId, {
      ...ctx.entryDeps,
      charge: () =>
        enforce(
          'recordSubmission',
          ctx.installationId,
          'This agent has recorded 20 submissions today, the daily limit.',
        ),
    });
    await setWorkingOn(ctx.installationId, parsed.program_id, false);
    // The token never fails the submission: it is recorded either way. Fix round 1 (I1): an
    // updated entry that already has its coin keeps it (no second launch, no refusal shown).
    // v2.8 Ruling 1 (plan): an entry that passed the confirmation step had its token decided there;
    // no token flow runs here, the row's token is reported.
    const confirmed = 'confirm_choice' in result ? result.confirm_choice : null;
    const hasCoin = 'coin_url' in result && Boolean(result.coin_url);
    // Final review I3: a confirmed "go" with no token, whose repo's one token is entered in another
    // program (Ruling 5 (plan)): no token here by design, said as the confirmation said it.
    const countsIn = confirmed === 'go' && !hasCoin ? await tokenElsewhere(parsed, ctx) : null;
    const token: TokenOutcome = 'coin_url' in result && result.coin_url
      ? result.coin_url === 'pending'
        ? // v2.8.1 §A1: launching, or stuck past 10 minutes (the cron has alerted the owner).
          (({ claimedAt, settled }) => pendingOutcome(claimedAt, settled))(await launchClaimedAt(result.project_id))
        : { status: 'launched', tokens_fun: result.coin_url, note: 'This entry already has its token.' }
      : confirmed
        ? {
            status: 'skipped',
            note: confirmed === 'skip' ? SKIPPED_ENTRY : countsIn ? bonusCountsIn(countsIn) : "This entry's token isn't launched.",
          }
        : await submissionToken(
      {
        projectId: result.project_id,
        installationId: ctx.installationId,
        choice: parsed.token,
        confirmed: parsed.builder_confirmed === true,
        // Ruling 22: the wallet given with this entry goes straight to the token flow (recordSubmission
        // validated it). Ruling 30: it is the only wallet from this call; the remembered one is never
        // read here (the agent echoes prepare_submission's shown_wallet). None: no coin yet.
        givenWallet: 'campaign_entry' in result ? null : (parsed.payout_wallet?.trim() || null),
      },
      ctx.tokenDeps,
      deadline,
    );
    // Campaign entries carry their own table (enteredTable).
    if ('show_to_builder' in result && result.show_to_builder)
      return withAlerts(ctx.installationId, { ...result, token });
    // v2.6 §3: outside campaigns, the reply the builder sees: the coin, then the bonus round.
    // Ruling 29: the round's end as the first message shows it.
    const endsLabel = result.bonus_round?.ends_label ?? null;
    const repoHeld = 'repo_held' in result && result.repo_held === true;
    // M1: a held repo can't get a coin here, so never ask the agent to launch one.
    const tokenOut = repoHeld && token.no_wallet
      ? { status: token.status, note: 'No token: another entry of this repo in this program already has its token (one token per repo).' }
      : token.no_wallet
        ? // Ruling 31's split here too: plain note, the instruction (noCoinYet) for the agent.
          { ...token, note: 'No token yet: no wallet was given.', agent_note: noCoinYet(endsLabel) }
        : token;
    // Skipped: the builder said no, the program has no coins, or (Ruling 25) the repo has its coin.
    const skipped =
      parsed.token === 'skip' ||
      confirmed === 'skip' ||
      countsIn !== null ||
      result.token_policy === 'off' ||
      Boolean(token.note?.startsWith(REPO_HAS_TOKEN));
    const coin: EnteredText['coin'] =
      token.status === 'launched' && token.tokens_fun
        ? { status: 'launched', url: token.tokens_fun }
        : token.no_wallet
          ? { status: 'no_wallet' }
          : skipped
            ? { status: 'skipped' }
            : token.status === 'pending'
              ? { status: 'pending', stuck: !token.launching }
              : { status: 'other', ...(token.needs && { needs: token.needs }) };
    let bonus: EnteredText['bonus'] = null;
    if (result.bonus_round && coin.status !== 'skipped') {
      const pool = (await poolsOf(ctx.roundPoolsWei ?? roundPoolsWei, [parsed.program_id])).get(parsed.program_id);
      // null: the round froze (I2), so no bonus line.
      if (pool !== null)
        bonus = {
          cell: bonusCell({ builder_bonus: true, bonus_pool_wei: pool ?? null }),
          ends: endsLabel!,
          board: boardLink(result.bonus_round.key),
          join: 'bonus_join' in result ? result.bonus_join : null,
        };
    }
    const also = await alsoQualifiesBlock(parsed, ctx).catch((err: unknown) => {
      console.error('[also_qualifies]', err instanceof Error ? err.name : 'error');
      return null;
    });
    const show_to_builder =
      enteredText({ programTitle: result.program_title, coin, bonus, repoHeld, countsIn }) + (also?.text ? `\n\n${also.text}` : '');
    return withAlerts(ctx.installationId, {
      ...result,
      token: tokenOut,
      show_to_builder,
      ...(also?.rows.length && { also_qualifies: also.rows }),
    });
  },

  // v2.8 Ruling C21: the builder's own answer to ask_outcome's question, for their own entry only
  // (another installation's is NotFoundError). Kept apart so list_programs stays read-only.
  report_outcome: async (input: unknown, ctx: ToolContext) => {
    await saveSelfReport(ctx.installationId, ReportOutcome.parse(input));
    return {
      saved: true,
      agent_note: OUTCOME_SAVED_NOTE,
    };
  },

  launch_token: async (input: unknown, ctx: ToolContext) =>
    withAlerts(
      ctx.installationId,
      await launchToken(
        LaunchTokenInput.parse(input),
        ctx.installationId,
        ctx.tokenDeps,
        // v2.8.1 §A5: the reply comes within 50 s; a deploy still running then answers "launching".
        Date.now() + launchReplyMs(),
      ),
    ),

  // Sponsors: create a campaign (returns a funding link and raw txs), check it (status reads the
  // chain for the bound wallet's deposit or award), award it.
  sponsor_campaign: async (input: unknown, ctx: ToolContext) => {
    // Normally unreachable (the tool isn't registered until the escrow is configured).
    if (!escrowEnabled()) throw new SponsorError(SPONSOR_NOT_OPEN);
    const i = SponsorCampaignInput.parse(
      Object.fromEntries(
        Object.entries(input as object).filter(([, v]) => v !== undefined),
      ),
    );
    if (i.action === 'create') {
      const { action: _a, ...draft } = i;
      // Charged only once the draft (and any replaces) is valid; a replacement has its own cap.
      return createSponsorDraft(draft, ctx.installationId, (replacing) =>
        replacing
          ? enforce(
              'sponsorReplace',
              ctx.installationId,
              'This agent has replaced 10 sponsor drafts today, the daily limit.',
            )
          : enforce(
              'sponsorCreate',
              ctx.installationId,
              'This agent has created 5 sponsor campaigns today, the daily limit.',
            ),
      );
    }
    if (i.action === 'award')
      return prepareAward(i.ref, ctx.installationId, {
        winners: i.winners,
        split: i.split,
      });
    // status reads the chain (and may rescore entries).
    await enforce(
      'chainChecks',
      ctx.installationId,
      'Too many status checks from this agent.',
    );
    return sponsorStatus(i.ref, ctx.installationId);
  },
} satisfies Record<
  string,
  (input: unknown, ctx: ToolContext) => Promise<unknown>
>;

export type ToolName = keyof typeof tools;
export const isToolName = (name: string): name is ToolName =>
  Object.hasOwn(tools, name);
