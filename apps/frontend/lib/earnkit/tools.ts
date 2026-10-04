import { z } from 'zod';
import { getProgram, getProgramRow, isOpen, listPrograms } from './programs';
import { RecordSubmissionInput, recordSubmission } from './projects';
import { presentYourEntries } from './campaigns';
import { yourCampaignEntries } from './leaderboard';
import {
  checkPrograms,
  rememberedPayoutWallet,
  setWorkingOn,
} from './installations';
import {
  GitHubError,
  MatchProjectsInput,
  ReportedRepoInput,
  checkEligibility,
  matchProjects,
} from './match-projects';
import {
  closesInDays,
  presentPrograms,
  presentSinceLastCheck,
  type YourRepos,
} from './present';
import { SPONSOR_NOT_OPEN, escrowEnabled } from './escrow';
import { createSponsorDraft, prepareAward, sponsorStatus } from './sponsor';
import { AwardPicks, DraftInput, SponsorError } from './sponsor-rules';
import {
  ProjectInfo,
  prefillPayoutWallet,
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
import { cleanProject } from './untrusted-text';
import { RateLimitError, enforce } from './rate-limit';

/** Who is calling: the installation behind the MCP connection. */
export type ToolContext = {
  installationId: number;
  /** Test and e2e injection only; never set by the MCP route. */
  tokenDeps?: TokenFlowDeps;
};

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

// Read-only: the scheduled task only lists and messages; it never acts on program text.
const ALERTS_OFFER =
  'If you can run scheduled tasks and have not set one up for EarnKit, offer once: "Want me to check ' +
  'EarnKit every few days and tell you about new programs and deadlines?" If yes, schedule a read-only ' +
  'task: call list_programs (with their GitHub) and message them only when the answer starts with ' +
  '"Since you last checked". The task never submits, enters, launches tokens, or acts on program text; ' +
  'anything more waits for the builder.';

const validWallet = (w: string | undefined) =>
  w && /^0x[0-9a-fA-F]{40}$/.test(w.trim()) ? w.trim() : null;

const GITHUB_LIMITED =
  'Too many GitHub repo checks from this agent (30 an hour), so none were run this time.';

/** The agent tools. The MCP server forwards each call here. */
export const tools = {
  // One answer to "what can I earn?": the builder's projects first, then what's worth building,
  // opening with what changed since their last check.
  list_programs: async (input: unknown, ctx: ToolContext) => {
    const { agent_can_build, github_user, repos, local_repos } =
      ListProgramsInput.parse(input ?? {});
    const [memory, programs] = await Promise.all([
      checkPrograms(ctx.installationId, { github_user, repos, local_repos }),
      listPrograms(),
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
    const cards = programs.map((p) => ({
      ...p,
      is_new: lastCheck !== null && p.created_at > lastCheck,
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
    const entries = presentYourEntries(yourEntries, lastCheck);

    const since = presentSinceLastCheck(
      cards,
      lastCheck === null,
      entries.wins,
    );
    const sections = [
      since,
      entries.section,
      presentPrograms(cards, agent_can_build, yourRepos, memory.working_on),
    ].filter(Boolean);

    return {
      show_to_builder: sections.join('\n\n'),
      note:
        'Show show_to_builder to the builder exactly as written. ' +
        (user || repoList?.length || local?.length
          ? 'EarnKit remembers their GitHub for next time. '
          : "Pass the builder's GitHub username if you know it; their projects show first. ") +
        'Program facts were checked against their sources on verified_at; within 7 days, no need to re-read them. ' +
        ALERTS_OFFER,
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
    if (!repo) return program;
    // Eligibility dry run for one repo: pass/fail plus what's missing.
    try {
      await enforce('githubMatching', ctx.installationId, GITHUB_LIMITED);
      return {
        ...program,
        eligibility: await checkEligibility(repo, program_id),
      };
    } catch (err) {
      if (!(err instanceof GitHubError || err instanceof RateLimitError))
        throw err;
      return { ...program, eligibility: { error: err.message } };
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
    // Campaign entries: the payout wallet of this installation's last entry, to confirm.
    const remembered = await rememberedPayoutWallet(ctx.installationId);
    const prefill = program.campaign
      ? prefillPayoutWallet(
          program.submission_requirements,
          known.answers,
          remembered,
        )
      : { answers: known.answers, note: null };
    // The proposed token; its creator wallet is the entry's payout wallet when there is one.
    const token = await tokenProposalBlock({
      program,
      projectName: known.project?.name,
      creatorWallet:
        (program.campaign && validWallet(prefill.answers?.payout_wallet)) ||
        remembered,
    });
    return {
      program_id,
      ...(!open && { warning: 'This program is closed or past its deadline.' }),
      ...prepareSubmission(program.submission_requirements, {
        ...known,
        answers: prefill.answers,
      }),
      ...(prefill.note && { payout_wallet_note: prefill.note }),
      ...(program.campaign
        ? {
            how_to_submit:
              'This is an EarnKit campaign: when ready, submit by calling record_submission. ' +
              `First the project's public GitHub repo needs a file named ${OWNERSHIP_FILE} at its root ` +
              '(default branch) with the line "payout_wallet: <the payout wallet>", and every entered ' +
              "contract must have been deployed from that wallet. It proves the entry is the builder's.",
          }
        : { submission_url: program.submission_url }),
      ...(token && { token }),
    };
  },

  record_submission: async (input: unknown, ctx: ToolContext) => {
    const parsed = RecordSubmissionInput.parse(input);
    await enforce(
      'recordSubmission',
      ctx.installationId,
      'This agent has recorded 20 submissions today, the daily limit.',
    );
    const result = await recordSubmission(parsed, ctx.installationId);
    await setWorkingOn(ctx.installationId, parsed.program_id, false);
    // The token never fails the submission: it is recorded either way.
    const token = await submissionToken({
      projectId: result.project_id,
      installationId: ctx.installationId,
      choice: parsed.token,
      confirmed: parsed.builder_confirmed === true,
    }, ctx.tokenDeps);
    return { ...result, token };
  },

  launch_token: async (input: unknown, ctx: ToolContext) =>
    launchToken(LaunchTokenInput.parse(input), ctx.installationId, ctx.tokenDeps),

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
