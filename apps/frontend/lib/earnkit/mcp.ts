import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodError, z } from 'zod';
import { NotFoundError } from './programs';
import { type ToolName, tools } from './tools';

const project = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    repo_url: z.string().optional(),
    live_url: z.string().optional(),
    demo_url: z.string().optional(),
    token_url: z.string().optional(),
  })
  .describe('What you know about the project so far.');

async function run(tool: ToolName, input: unknown = {}) {
  try {
    const result = await tools[tool](input);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (err) {
    if (err instanceof ZodError || err instanceof NotFoundError) {
      const text = err instanceof ZodError ? `Invalid input: ${JSON.stringify(err.issues)}` : err.message;
      return { content: [{ type: 'text' as const, text }], isError: true };
    }
    throw err;
  }
}

/** The EarnKit MCP server: the four agent tools and nothing else. */
export function createMcpServer() {
  const server = new McpServer(
    { name: 'earnkit', version: '1.0.0' },
    {
      instructions:
        'EarnKit: where agents earn. It lists live builder programs with rewards. ' +
        'If the builder already has projects (local repos, GitHub), check them against open programs whose ' +
        'existing_work is "allowed": for each close match, say what already qualifies and what is missing ' +
        '(e.g. "deploy to Arc mainnet"), then continue the normal flow. Programs marked "new_work_only" ' +
        'only count work done during the program. ' +
        'Flow: list_programs -> builder picks one -> get_program -> build with your own tools ' +
        '(starters are optional ideas) -> when the builder says "submit this", call prepare_submission, ' +
        "ask the builder only for what is missing, submit on the program's own site with your own " +
        'browser/tools (or hand the builder the answers and link if you cannot), then call ' +
        'record_submission once it is actually submitted. EarnKit does not build, judge, or pay out.',
    },
  );

  server.registerTool(
    'list_programs',
    {
      description:
        'List open builder programs with rewards. Use when the builder asks what is worth building, or ' +
        'whether any of their existing projects could earn. Returns id, title, organizer, reward, deadline (or "rolling"), ' +
        'key_requirement, existing_work ("allowed" = already-built projects can be submitted, ' +
        '"new_work_only" = only work done during the program counts, "unknown"), and track names.',
      annotations: { readOnlyHint: true },
    },
    () => run('list_programs'),
  );

  server.registerTool(
    'get_program',
    {
      description:
        'Full details for one program: description, reward, deadline, tracks, rules, requirements, ' +
        'submission requirements, source and submission links, and optional starters. Starters are ' +
        'only ideas; the builder can build anything that meets the requirements.',
      inputSchema: { program_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (input) => run('get_program', input),
  );

  server.registerTool(
    'prepare_submission',
    {
      description:
        'Call when the builder wants to submit. Pass everything you know about the project and any ' +
        'answers to program questions (keyed by submission requirement key). Returns what is complete, ' +
        'what is missing, and the submission link. Draft project-based answers yourself and confirm ' +
        'them; ask the builder for personal info. Never invent names, emails, wallets, or handles. ' +
        "Call again with the new answers until ready is true, then submit on the program's site.",
      inputSchema: {
        program_id: z.string(),
        project: project.optional(),
        answers: z.record(z.string(), z.string()).optional().describe('Answers by submission requirement key.'),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run('prepare_submission', input),
  );

  server.registerTool(
    'record_submission',
    {
      description:
        "Record the project on EarnKit. Only call AFTER the project was actually submitted on the program's " +
        'own site (by you or by the builder). Pass the final answers that were submitted.',
      inputSchema: {
        program_id: z.string(),
        project: project.extend({ name: z.string() }),
        submission_data: z.record(z.string(), z.unknown()).describe('The final submitted answers, by key.'),
        external_submission_url: z.string().optional().describe('Link to the submission, if the site gave one.'),
      },
    },
    (input) => run('record_submission', input),
  );

  return server;
}
