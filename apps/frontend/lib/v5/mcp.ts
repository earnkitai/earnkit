/**
 * The MCP server: three tools, find, track and record, and the server instructions. Built per request
 * (the route is stateless). Each tool call counts against the installation's and the IP's hourly
 * limits; over either it is the busy-for-an-hour result. A tool's reply is its JSON; an unexpected
 * error (a database blip) is one plain line, logged by name only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { find, type FindContext } from './find';
import { PROGRAM_CATEGORIES } from './program-file';
import { LIMITS, hit } from './rate-limit';
import { TrackInput, track } from './track';
import { RecordInput, recordTool } from '../v6/record-tool';

/** `builderId`: the installation's linked builder, or null. `ip`: the caller's address as a rate-limit key, when the route knows it. */
export type McpContext = {
  installationId: number;
  builderId: number | null;
  now?: Date;
  gh?: typeof fetch;
  ip?: string;
  /** Tests: the builder's own evidence read and the sign-in link (find's defaults otherwise). */
  evidence?: FindContext['evidence'];
  linkUrl?: FindContext['linkUrl'];
};

export const SERVER_INSTRUCTIONS =
  "Call record with get at the start of every session, then find with the project you are in. Open with find's reply in your own words. Draft every form from find's fields: record and repo values as given, approved answers fitted by cutting, never by adding. Anything the builder tells you that a form could ask, save with record before using it. Submit in your own browser only after track started, and only when the builder said yes or their standing approval covers it. After each submission call track applied. Never write a sentence about traction yourself. Never name tools, fields or files. Never invent an amount, a deadline or a rule.";
export const FIND_DESCRIPTION =
  "What can this repo earn: the programs it fits with every field pre-filled, the ones one change away, and the ledger. Call it at session start with the project you are in, and again when the builder asks about money or programs. With program_id: that program's details and form.";
export const TRACK_DESCRIPTION =
  'What the builder did: started (a claim before filling), applied (with submitted_by and fields_used), won (with amount_usd), rejected, no_result, skipped, unskip (a skipped program may come back), or gap_done (with item). Call started before filling and applied after every submission.';
export const RECORD_DESCRIPTION =
  "The builder's record: facts, links, documents, answers and standing approval, kept once and read by every agent of theirs. Call it with get at session start; call it with set for every new fact the builder gives; with brief for the question and facts behind one answer kind.";
export const BUSY = 'EarnKit is busy. Try again in a minute.';
export const BUSY_HOUR = 'EarnKit is busy. Try again in an hour.';

const any = (what: string) => z.unknown().optional().describe(what);
/** Read leniently (project-input.ts): a bad field is dropped and named, never a refusal. */
const PROJECT = z
  .object({
    name: any('The project name (required)'),
    description: any('One line on what it does (required)'),
    repo_url: any('The GitHub link from the git remote; omit when there is none'),
    live_url: any('The live app link'),
    demo_url: any('A demo video link'),
    chains: any('[{ chain, mainnet, contract? }] as the code or deploy config shows them (chain: base, arc, monad, solana...)'),
    first_commit_at: any('ISO 8601, from git log --reverse'),
    last_commit_at: any('ISO 8601, from git log'),
    private: any('true when the repo is private: EarnKit then matches on what you report'),
    builder_codes: any('true when the app sends Base Builder Codes'),
    users: any('true when real people use it, false when not; omit it when you do not know'),
  })
  .describe('The project you are in');

/** Counts one tool call against the IP floor and the installation's limit; false when over either. */
async function allowed(ctx: McpContext, now: Date): Promise<boolean> {
  const count = (name: 'mcp' | 'mcpIp', who: string | number) => hit(`${name}:${who}`, LIMITS[name].limit, LIMITS[name].windowSeconds, now);
  if (ctx.ip && !(await count('mcpIp', ctx.ip)).allowed) return false;
  return (await count('mcp', ctx.installationId)).allowed;
}

async function run(ctx: McpContext, name: string, fn: () => Promise<unknown>) {
  try {
    if (!(await allowed(ctx, ctx.now ?? new Date()))) return { content: [{ type: 'text' as const, text: BUSY_HOUR }], isError: true };
    return { content: [{ type: 'text' as const, text: JSON.stringify(await fn()) }] };
  } catch (err) {
    if (err instanceof z.ZodError)
      return { content: [{ type: 'text' as const, text: `Invalid input: ${err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}` }], isError: true };
    // Only the error's name: a database error carries its query and parameters.
    console.error(`[mcp] ${name} failed`, err instanceof Error ? err.name : typeof err);
    return { content: [{ type: 'text' as const, text: BUSY }], isError: true };
  }
}

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: 'earnkit', version: '6.1.0' }, { instructions: SERVER_INSTRUCTIONS });
  const now = () => ctx.now ?? new Date();
  server.registerTool(
    'find',
    {
      description: FIND_DESCRIPTION,
      inputSchema: {
        project: PROJECT.optional(),
        program_id: z.string().max(100).optional().describe("One program's id: its details, rules and form instead of the match"),
        project_id: z.string().max(40).optional().describe("The record's project to match and fill from; omit to pick by the repo"),
        filter: z
          .object({
            category: z.enum(PROGRAM_CATEGORIES).optional(),
            all: z.boolean().optional().describe('true for every program, including the ones that do not fit, with the reason'),
          })
          .optional(),
      },
    },
    (args) => run(ctx, 'find', () => find({ installationId: ctx.installationId, builderId: ctx.builderId, now: now(), gh: ctx.gh, evidence: ctx.evidence, linkUrl: ctx.linkUrl }, args)),
  );
  server.registerTool(
    'track',
    { description: TRACK_DESCRIPTION, inputSchema: TrackInput },
    (args) => run(ctx, 'track', () => track({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  server.registerTool(
    'record',
    { description: RECORD_DESCRIPTION, inputSchema: RecordInput },
    (args) => run(ctx, 'record', () => recordTool({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  return server;
}
