import { z } from 'zod';
import { getProgram, getProgramRow, isOpen, listPrograms } from './programs';
import { RecordSubmissionInput, recordSubmission } from './projects';
import { presentYourEntries, type YourEntry } from './campaigns';
import { sql } from './db';
import { checkPrograms } from './installations';
import {
  GitHubError,
  MatchProjectsInput,
  matchProjects,
} from './match-projects';
import {
  closesInDays,
  presentPrograms,
  presentSinceLastCheck,
  type YourRepos,
} from './present';
import { ProjectInfo, prepareSubmission } from './submission';
import { LaunchTokenInput, launchToken } from './tokens';

/** Who is calling: the installation behind the MCP connection. */
export type ToolContext = { installationId: number };

const ProgramId = z.object({ program_id: z.string() }).strict();

const PrepareSubmissionInput = ProgramId.extend({
  project: ProjectInfo.optional(),
  answers: z.record(z.string(), z.string()).optional(),
}).strict();

const ListProgramsInput = z
  .object({
    agent_can_build: z.boolean().default(true),
    github_user: z.string().optional(),
    repos: z.array(z.string()).optional(),
  })
  .strict();

const ALERTS_OFFER =
  'If you can run scheduled tasks and have not set one up for EarnKit, offer once: "Want me to check ' +
  'EarnKit every few days and tell you about new programs and deadlines?" If yes, schedule a call to ' +
  'list_programs (with their GitHub) and message them only when the answer starts with "Since you last checked".';

/** The agent tools. The MCP server forwards each call here. */
export const tools = {
  // One answer to "what can I earn?": the builder's projects first, then what's worth building,
  // opening with what changed since their last check.
  list_programs: async (input: unknown, ctx: ToolContext) => {
    const { agent_can_build, github_user, repos } = ListProgramsInput.parse(
      input ?? {},
    );
    const [lastCheck, programs] = await Promise.all([
      checkPrograms(ctx.installationId),
      listPrograms(),
    ]);
    const cards = programs.map((p) => ({
      ...p,
      is_new: lastCheck !== null && p.created_at > lastCheck,
      closes_in_days: closesInDays(p.ends_at),
    }));

    let yourRepos: YourRepos | null = null;
    if (github_user || repos?.length) {
      try {
        yourRepos = await matchProjects(
          MatchProjectsInput.parse({ github_user, repos }),
        );
      } catch (err) {
        if (err instanceof GitHubError) yourRepos = { error: err.message };
        else console.error('[list_programs] matching failed:', err);
      }
    }

    // The builder's entries in EarnKit campaigns: rank while running, prize once paid.
    const yourEntries = await sql()<YourEntry[]>`
      SELECT e.name, e.campaign_title, e.campaign, e.score, e.rank, e.entries, e.prize_tx, e.prize_paid_at
      FROM (
        SELECT p.name, p.installation_id, p.score, p.prize_tx, p.prize_paid_at, pr.title AS campaign_title,
          pr.campaign, row_number() OVER (PARTITION BY p.program_id ORDER BY p.score DESC NULLS LAST, p.submitted_at)::int AS rank,
          count(*) OVER (PARTITION BY p.program_id)::int AS entries
        FROM projects p JOIN programs pr ON pr.id = p.program_id
        WHERE pr.campaign IS NOT NULL AND p.contracts IS NOT NULL
      ) e
      WHERE e.installation_id = ${ctx.installationId}`;
    const entries = presentYourEntries(yourEntries, lastCheck);

    const since = presentSinceLastCheck(
      cards,
      lastCheck === null,
      entries.wins,
    );
    const sections = [
      since,
      entries.section,
      presentPrograms(cards, agent_can_build, yourRepos),
    ].filter(Boolean);

    return {
      show_to_builder: sections.join('\n\n'),
      note:
        'Show show_to_builder to the builder exactly as written. ' +
        (github_user || repos?.length
          ? ''
          : "Pass the builder's GitHub username if you know it; their projects show first. ") +
        ALERTS_OFFER,
      programs,
    };
  },

  get_program: async (input: unknown) =>
    getProgram(ProgramId.parse(input).program_id),

  prepare_submission: async (input: unknown) => {
    const { program_id, ...known } = PrepareSubmissionInput.parse(input);
    const program = await getProgramRow(program_id);
    const open = isOpen(program);
    return {
      program_id,
      ...(!open && { warning: 'This program is closed or past its deadline.' }),
      ...prepareSubmission(program.submission_requirements, known),
      ...(program.campaign
        ? {
            how_to_submit:
              'This is an EarnKit campaign: when ready, submit by calling record_submission.',
          }
        : { submission_url: program.submission_url }),
    };
  },

  record_submission: async (input: unknown, ctx: ToolContext) =>
    recordSubmission(RecordSubmissionInput.parse(input), ctx.installationId),

  launch_token: async (input: unknown, ctx: ToolContext) =>
    launchToken(LaunchTokenInput.parse(input), ctx.installationId),
} satisfies Record<
  string,
  (input: unknown, ctx: ToolContext) => Promise<unknown>
>;

export type ToolName = keyof typeof tools;
export const isToolName = (name: string): name is ToolName =>
  Object.hasOwn(tools, name);
