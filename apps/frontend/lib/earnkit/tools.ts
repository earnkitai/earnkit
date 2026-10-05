import { z } from 'zod';
import { getProgram, getProgramRow, isOpen, listPrograms } from './programs';
import {
  RecordSubmissionInput,
  recordSubmission,
  type EntryDeps,
} from './projects';
import { normalizeRepoUrl, presentYourEntries } from './campaigns';
import { signToEnter } from './entry-proof';
import { confirmTable } from './entry-text';
import { earnkitCampaignRows, yourCampaignEntries } from './leaderboard';
import {
  checkPrograms,
  rememberWallets,
  rememberedPayoutWallet,
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
  launchToken,
  submissionToken,
  tokenProposalBlock,
  type TokenFlowDeps,
} from './token-launch';
import { cleanProject, quoted } from './untrusted-text';
import { RateLimitError, enforce } from './rate-limit';
import { roundPoolsWei as readRoundPools } from './bonus-rounds';
import { repoCoinPrograms } from './tokens';

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
};

/**
 * The open rounds' builder bonus pools so far, by program id, in one grouped read (Ruling 3; the
 * bonus ledger). A provable program with no pool yet shows "opens with your entry".
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

const PrepareSubmissionInput = ProgramId.extend({
  project: ProjectInfo.optional(),
  answers: z.record(z.string(), z.string()).optional(),
}).strict();

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

const validWallet = (w: string | undefined) =>
  w && /^0x[0-9a-fA-F]{40}$/.test(w.trim()) ? w.trim() : null;

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
        yourRepos = await matchProjects(
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
    const { program_id, ...known } = PrepareSubmissionInput.parse(input);
    const program = await getProgramRow(program_id);
    // Campaign entries reach the sponsor: check the name and description now, as record_submission will.
    if (program.campaign && known.project)
      known.project = cleanProject(known.project);
    const open = isOpen(program);
    // Remember it, so list_programs leads with "You're working on".
    if (open) await setWorkingOn(ctx.installationId, program_id, true);
    // Campaign entries: the payout wallet of this installation's last entry, asked about in full
    // and never prefilled (I8: a hosted client sharing one registration shares this memory).
    const remembered = await rememberedPayoutWallet(ctx.installationId);
    const ask = program.campaign
      ? rememberedWalletQuestion(
          program.submission_requirements,
          known.answers,
          remembered,
        )
      : { wallet: null, note: null };
    // The proposed token; its creator wallet is the entry's payout wallet when there is one.
    // No token block on a closed program (v2.4 §6, audit C22).
    const token = open
      ? await tokenProposalBlock({
          program,
          projectName: known.project?.name,
          // Campaigns: only a payout wallet given in this call (never the remembered one, which
          // is asked about, not assumed); without one the block asks the builder for the fee
          // wallet. Other programs, v2.3 unchanged: the remembered wallet, named in full in the footnote.
          creatorWallet: program.campaign
            ? validWallet(known.answers?.payout_wallet)
            : remembered,
          // The earnkit.txt token line is bound to this agent and the repo; shown only in this reply.
          installationId: ctx.installationId,
          repoUrl: known.project?.repo_url ?? known.answers?.repo_url,
        })
      : null;
    // v2.4 §2: the one confirmation the builder sees, prize first; the token is one row.
    const repoUrl = known.project?.repo_url ?? known.answers?.repo_url;
    const payoutWallet = validWallet(known.answers?.payout_wallet);
    const sign_to_enter = signToEnter(
      program_id,
      repoUrl,
      payoutWallet,
      known.answers?.contracts,
    );
    const show_to_builder = confirmTable({
      project: known.project?.name?.trim() || 'Your project',
      programTitle:
        program.campaign?.kind === 'sponsor'
          ? quoted(program.title)
          : program.title,
      campaign: program.campaign,
      prize: program.summary.split(' · ')[0],
      endsAt: program.ends_at,
      payoutWallet,
      askWallet: ask.wallet,
      token: token
        ? {
            symbol: token.proposed?.symbol ?? null,
            wallet: token.creator_wallet,
            hasBonus: token.has_bonus,
            coinIn: token.repo_coin_program,
          }
        : null,
    });
    return withAlerts(ctx.installationId, {
      program_id,
      ...(!open && { warning: 'This program is closed or past its deadline.' }),
      show_to_builder,
      ...prepareSubmission(program.submission_requirements, known),
      ...(ask.note && { payout_wallet_note: ask.note }),
      ...(program.campaign
        ? {
            how_to_submit:
              'This is an EarnKit campaign: record_submission is the entry; there is no other site. ' +
              `Commit ${OWNERSHIP_FILE} at the repo root (default branch) with the line "payout_wallet: <the payout wallet>" ` +
              "in one commit, together with the token line if the builder keeps the token. Contracts count when they were deployed from the payout wallet, or from your own wallet if you pass deployer_signature: that wallet's EIP-191 signature (personal_sign) of sign_to_enter, which names this program, the repo, the payout wallet and the contracts (it appears once all are known; a changed contract list needs a new signature).",
            ...(sign_to_enter && { sign_to_enter }),
          }
        : { submission_url: program.submission_url }),
      ...(token && { token }),
    });
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
    // The token never fails the submission: it is recorded either way.
    const token = await submissionToken(
      {
        projectId: result.project_id,
        installationId: ctx.installationId,
        choice: parsed.token,
        confirmed: parsed.builder_confirmed === true,
      },
      ctx.tokenDeps,
    );
    return withAlerts(ctx.installationId, { ...result, token });
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
