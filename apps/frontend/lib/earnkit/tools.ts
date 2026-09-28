import { z } from 'zod';
import { getProgram, getProgramRow, isOpen, listPrograms } from './programs';
import { RecordSubmissionInput, recordSubmission } from './projects';
import { MatchProjectsInput, matchProjects } from './match-projects';
import { presentPrograms } from './present';
import { ProjectInfo, prepareSubmission } from './submission';

const ProgramId = z.object({ program_id: z.string() }).strict();

const PrepareSubmissionInput = ProgramId.extend({
  project: ProjectInfo.optional(),
  answers: z.record(z.string(), z.string()).optional(),
}).strict();

/** The four agent tools. The MCP server forwards each call here. */
export const tools = {
  list_programs: async (input: unknown) => {
    const { agent_can_build } = z
      .object({ agent_can_build: z.boolean().default(true) })
      .parse(input ?? {});
    const programs = await listPrograms();
    return {
      show_to_builder: presentPrograms(programs, agent_can_build),
      note: 'Show show_to_builder to the builder exactly as written. Use programs for follow-up questions.',
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
      submission_url: program.submission_url,
    };
  },

  match_projects: async (input: unknown) =>
    matchProjects(MatchProjectsInput.parse(input)),

  record_submission: async (input: unknown) =>
    recordSubmission(RecordSubmissionInput.parse(input)),
} satisfies Record<string, (input: unknown) => Promise<unknown>>;

export type ToolName = keyof typeof tools;
export const isToolName = (name: string): name is ToolName =>
  Object.hasOwn(tools, name);
