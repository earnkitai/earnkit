import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodError, z } from 'zod';
import { GitHubError } from './match-projects';
import { NotFoundError } from './programs';
import { LaunchError } from './tokens';
import { type ToolContext, type ToolName, tools } from './tools';

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

async function run(ctx: ToolContext, tool: ToolName, input: unknown = {}) {
  try {
    const result = await tools[tool](input, ctx);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  } catch (err) {
    if (
      err instanceof ZodError ||
      err instanceof NotFoundError ||
      err instanceof GitHubError ||
      err instanceof LaunchError
    ) {
      const text =
        err instanceof ZodError
          ? `Invalid input: ${JSON.stringify(err.issues)}`
          : err.message;
      return { content: [{ type: 'text' as const, text }], isError: true };
    }
    throw err;
  }
}

/** The EarnKit MCP server for one connected agent (installation). */
export function createMcpServer(ctx: ToolContext) {
  const server = new McpServer(
    { name: 'earnkit', version: '1.0.0' },
    {
      instructions: [
        'EarnKit lists live builder programs with rewards, checked against official sources.',
        'When a tool returns show_to_builder, show it exactly as written.',
        'When the builder picks a program: ask for its setup steps once, do everything else yourself,',
        "confirm once before the final submit, and submit on the program's own site. Call",
        'record_submission only after it was really submitted, then follow its `next`. Never invent',
        'personal details, and never launch a token without the builder saying yes.',
      ].join('\n'),
    },
  );

  server.registerTool(
    'list_programs',
    {
      description:
        'List open builder programs with rewards. Use when the builder asks what is worth building or ' +
        'what their projects can earn. Returns show_to_builder: show it to the builder exactly as written, ' +
        'with no extra summary or advice. Use the programs data only for follow-up questions.',
      inputSchema: {
        agent_can_build: z
          .boolean()
          .describe(
            'true only if you yourself can write code, deploy, and use a web browser in this session',
          ),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run(ctx, 'list_programs', input),
  );

  server.registerTool(
    'get_program',
    {
      description:
        'Full details for one program: description, reward, deadline, tracks, rules, requirements, ' +
        'submission requirements, source and submission links, and optional starters. Starters are ' +
        'only ideas. setup = one-time steps only the builder can do (skip any you can already do); ' +
        'each_time = what the builder must provide for every entry.',
      inputSchema: { program_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (input) => run(ctx, 'get_program', input),
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
        answers: z
          .record(z.string(), z.string())
          .optional()
          .describe('Answers by submission requirement key.'),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run(ctx, 'prepare_submission', input),
  );

  server.registerTool(
    'match_projects',
    {
      description:
        "Check what a builder's existing projects can earn. Give their GitHub username (or up to 30 " +
        'repo links). EarnKit reads their public repos, detects which chains each uses, and returns per ' +
        'repo and program: likely qualifies, qualifies after one step, or no. Returns show_to_builder: ' +
        'show it exactly as written.',
      inputSchema: {
        github_user: z.string().optional().describe('GitHub username'),
        repos: z
          .array(z.string())
          .optional()
          .describe('"owner/repo" or github.com links'),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run(ctx, 'match_projects', input),
  );

  server.registerTool(
    'record_submission',
    {
      description:
        "Record the project on EarnKit. Only call AFTER the project was actually submitted on the program's " +
        'own site (by you or by the builder). Pass the final answers that were submitted. Returns ' +
        'project_id and `next`: offer the builder a tokens.fun token for the project (launch_token).',
      inputSchema: {
        program_id: z.string(),
        project: project.extend({ name: z.string() }),
        submission_data: z
          .record(z.string(), z.unknown())
          .describe('The final submitted answers, by key.'),
        external_submission_url: z
          .string()
          .optional()
          .describe('Link to the submission, if the site gave one.'),
      },
    },
    (input) => run(ctx, 'record_submission', input),
  );

  server.registerTool(
    'launch_token',
    {
      description:
        'Launch a token for a project you recorded with record_submission, on tokens.fun. tokens.fun ' +
        "pays the gas; 40% of trading fees go to the builder's wallet. Only call after the builder " +
        'explicitly said yes and confirmed the name, ticker, wallet, and image. One token per project; ' +
        'launches are public and permanent.',
      inputSchema: {
        project_id: z
          .number()
          .int()
          .describe('project_id returned by record_submission'),
        name: z.string().describe('Token name, up to 50 characters'),
        symbol: z.string().describe('Ticker, up to 10 letters or digits'),
        creator_wallet: z
          .string()
          .describe("The builder's wallet that receives creator fees"),
        image_url: z.string().describe('https URL of the token image'),
        builder_x: z.string().describe("The builder's X handle or profile URL"),
        chain: z
          .enum(['base', 'robinhood', 'arbitrum'])
          .optional()
          .describe('Default base'),
        builder_confirmed: z
          .literal(true)
          .describe('The builder explicitly said yes to this launch'),
      },
    },
    (input) => run(ctx, 'launch_token', input),
  );

  return server;
}
