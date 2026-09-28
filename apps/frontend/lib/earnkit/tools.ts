import { z } from 'zod';
import { getProgram, getProgramRow, isOpen, listPrograms } from './programs';
import { RecordSubmissionInput, recordSubmission } from './projects';
import { ProjectInfo, prepareSubmission } from './submission';

const ProgramId = z.object({ program_id: z.string() }).strict();

const PrepareSubmissionInput = ProgramId.extend({
  project: ProjectInfo.optional(),
  answers: z.record(z.string(), z.string()).optional(),
}).strict();

/** The four agent tools. The MCP server forwards each call here. */
export const tools = {
  list_programs: async () => ({ programs: await listPrograms() }),

  get_program: async (input: unknown) => getProgram(ProgramId.parse(input).program_id),

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

  record_submission: async (input: unknown) => recordSubmission(RecordSubmissionInput.parse(input)),
} satisfies Record<string, (input: unknown) => Promise<unknown>>;

export type ToolName = keyof typeof tools;
export const isToolName = (name: string): name is ToolName => Object.hasOwn(tools, name);
