import { z } from 'zod';
import { getProgram, getProgramRow, isOpen, listPrograms } from './programs';
import {
  RecordSubmissionInput,
  recordSubmission,
  ownEntryWallet,
  startEntry,
  type EntryDeps,
} from './projects';
import { EntryError, givenWallet, isWalletAddress, normalizeRepoUrl, presentYourEntries } from './campaigns';
import { signToEnter } from './entry-proof';
import { boardLink, confirmTable, enteredText, noCoinYet, todoOf, type EnteredText } from './entry-text';
import { repoNameOf, titleCase } from './token-proposal';
import { earnkitCampaignRows, yourCampaignEntries } from './leaderboard';
import {
  checkPrograms,
  rememberWallets,
  rememberedWallet,
  setWorkingOn,
} from './installations';
import { sinceLine, sinceYouLastChecked } from './alerts';
import {
  GitHubError,
  MatchProjectsInput,
  ReportedRepoInput,
  checkEligibility,
  matchProjects,
} from './match-projects';
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
  LaunchTokenInput,
  SKIPPED_ENTRY,
  confirmToken,
  hasBuilderBonus,
  launchToken,
  submissionToken,
  tokenProposalBlock,
  type TokenFlowDeps,
} from './token-launch';
import { RAW_CAP, cleanProject, quoted } from './untrusted-text';
import { tokenLineFor } from './token-gate';
import { READY_TO_SUBMIT, confirmDecision, confirmOffer, walletQuestion, NO_WALLET_HINT, TOKEN_ERROR_CONFIRM } from './confirm';
import { submitKit, type SubmitKit } from './submit-kit';
import type { ProgramRow } from './programs';
import { RateLimitError, enforce } from './rate-limit';
import { roundPoolsWei as readRoundPools } from './bonus-rounds';
import { REPO_HAS_TOKEN, repoCoinPrograms, tokenLaunchesAvailable, type TokenOutcome } from './tokens';

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

/** The agent's note with the token line: commit it with the next push, before the builder confirms. */
const TOKEN_LINE_NOTE = 'Commit this line to earnkit.txt at the repo root with your next push, before the builder confirms.';

/** The first line of confirm_entry's reply once the entry is confirmed, before the kit. Pure. */
function tokenLine(token: TokenOutcome | null, fallback: string) {
  if (token?.status === 'launched' && token.tokens_fun)
    return `Your token: ${token.tokens_fun.replace(/^https?:\/\//, '')}. You earn 40% of its fees.`;
  if (token?.status === 'pending') return 'Your token is launching.';
  return token?.note ?? fallback;
}

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
    const { program_id, agent, ...known } = PrepareSubmissionInput.parse(input);
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

    // v2.8 Part C, Ruling 4 (plan): other programs. Once ready, the confirmation offer (the builder
    // bonus comes with a token) closes the screen; the kit comes only from confirm_entry, so no
    // submission link, prefilled link or paste list here.
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
        })
      : null;
    const offersToken = facts !== null && !facts.coinIn && canPush && !facts.policyOff && facts.available;
    // Ruling 25 (plan) / Part C: the token line, once the repo is known, for the agent to push with
    // its work before the builder confirms (an agent that can't push gets none).
    const line = repoUrl && canPush && program.token_policy !== 'off' ? tokenLineFor(ctx.installationId, repoUrl) : null;
    const show_to_builder = offer
      ? `${table}\n\n${offer.endsWith(READY_TO_SUBMIT) ? offer : `Ready. ${offer}`}`
      : table;
    return withAlerts(ctx.installationId, {
      program_id,
      ...(!open && { warning: 'This program is closed or past its deadline.' }),
      show_to_builder,
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
      ...(line && { token_line: line, agent_note: TOKEN_LINE_NOTE }),
    });
  },

  // v2.8 Part C, Rulings 1, 4, 5 and 7 (plan): the confirmation step. Without the builder's yes it
  // returns the offer; on "go" the token launches; the submit kit comes only from here.
  confirm_entry: async (input: unknown, ctx: ToolContext) => {
    const i = ConfirmEntryInput.parse(input);
    const program = await getProgramRow(i.program_id);
    if (program.campaign) throw new EntryError('EarnKit campaigns are entered in one step.');
    if (!isOpen(program)) throw new EntryError('This program is closed or past its deadline.');
    // Ruling 22: a wallet given is valid or the call fails (a typo never falls back to another).
    const given = givenWallet(i.wallet);
    const repoUrl = i.project.repo_url ?? i.answers.repo_url ?? null;
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
      return {
        show_to_builder: confirmOffer({ hasBonus: facts.hasBonus, coinIn: facts.coinIn, canPush, wallet, remembered: !given && wallet !== null, tokensOff }),
        ...(offersToken && wallet && { shown_wallet: wallet }),
        agent_note:
          "Show show_to_builder as written. When the builder says yes, call confirm_entry again with builder_confirmed: true, decision: 'go'" +
          (offersToken ? ' and wallet: shown_wallet (or the wallet they name instead)' : '') +
          "; when they say skip, decision: 'skip'.",
      };
    }

    // Each confirmation may read GitHub and tokens.fun: bounded per hour, like record_submission.
    await enforce('entryChecks', ctx.installationId, 'This agent has checked 60 entries in the last hour.');
    const entry = await startEntry({
      program,
      installationId: ctx.installationId,
      project: i.project,
      answers: i.answers,
      choice: decision.kind === 'skip' ? 'skip' : 'go',
      now: new Date(),
      // A new entry counts against the 20 a day (Ruling 1 (plan)); an update never does.
      charge: () => enforce('recordSubmission', ctx.installationId, 'This agent has recorded 20 submissions today, the daily limit.'),
    });

    let token: TokenOutcome | null = null;
    if (entry.token_url)
      token = entry.token_url === 'pending'
        ? { status: 'pending', note: "This entry's token is launching." }
        : { status: 'launched', tokens_fun: entry.token_url, note: 'This entry already has its token.' };
    else if (decision.kind === 'launch' && entry.confirm_choice === 'go') {
      token = await confirmToken(
        { projectId: entry.id, installationId: ctx.installationId, token: i.token, wallet: given },
        ctx.tokenDeps,
      );
      // Fixable (no wallet, a ticker, the proof line, a transient read): no kit; fix it and confirm again.
      if (token.fixable) {
        const remembered = token.no_wallet ? await rememberedWallet(ctx.installationId) : null;
        // Review Minor 5: the remembered wallet wasn't passed back: ask about it, never use it unseen.
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

    const skipLine = facts.hasBonus ? 'No token, no builder bonus.' : 'No token.';
    const first =
      decision.kind === 'skip' && !entry.token_url
        ? skipLine
        : tokenLine(token, decision.kind === 'record_only' ? decision.note : skipLine);
    // The kit: every answer (the agent's, plus what the project info fills), in the form's order.
    const filled = prepareSubmission(program.submission_requirements, {
      project: { ...i.project, ...(repoUrl && { repo_url: repoUrl }) },
      answers: i.answers,
    });
    // Ruling C9: an incomplete entry still gets its token; the kit names what is missing first and
    // marks each missing (or invalid) required answer as a blank, never dropping it.
    const kit: SubmitKit = submitKit(
      program,
      Object.fromEntries(filled.complete.map((c) => [c.key, c.value])),
      { browser: i.agent?.browser === true },
      { problems: filled.missing.filter((m) => m.problem).map((m) => m.key) },
    );
    return {
      project_id: entry.id,
      ...(token && { token }),
      kit,
      show_to_builder: `${first}\n\n${kit.show_to_builder}`,
      agent_note:
        'Show show_to_builder as written. Once the builder has submitted, call record_submission with the final answers and builder_submitted: true' +
        (kit.proof.kind === 'entry_link' ? ', and their entry link as external_submission_url.' : '.'),
    };
  },

  record_submission: async (input: unknown, ctx: ToolContext) => {
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
    const token: TokenOutcome = 'coin_url' in result && result.coin_url
      ? result.coin_url === 'pending'
        ? { status: 'pending', note: 'This entry\'s token is launching.' }
        : { status: 'launched', tokens_fun: result.coin_url, note: 'This entry already has its token.' }
      : confirmed
        ? { status: 'skipped', note: confirmed === 'skip' ? SKIPPED_ENTRY : "This entry's token isn't launched." }
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
      parsed.token === 'skip' || confirmed === 'skip' || result.token_policy === 'off' || Boolean(token.note?.startsWith(REPO_HAS_TOKEN));
    const coin: EnteredText['coin'] =
      token.status === 'launched' && token.tokens_fun
        ? { status: 'launched', url: token.tokens_fun }
        : token.no_wallet
          ? { status: 'no_wallet' }
          : skipped
            ? { status: 'skipped' }
            : token.status === 'pending'
              ? { status: 'pending' }
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
    const show_to_builder = enteredText({ programTitle: result.program_title, coin, bonus, repoHeld });
    return withAlerts(ctx.installationId, { ...result, token: tokenOut, show_to_builder });
  },

  launch_token: async (input: unknown, ctx: ToolContext) =>
    withAlerts(
      ctx.installationId,
      await launchToken(
        LaunchTokenInput.parse(input),
        ctx.installationId,
        ctx.tokenDeps,
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
