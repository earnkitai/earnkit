/**
 * The MCP server: four tools, find, track, record and screen, and the server instructions. Built per request
 * (the route is stateless). Each tool call counts against the installation's and the IP's hourly
 * limits; over either it is the busy result, with the minutes the window has left. A tool's reply is its JSON;
 * arguments nested past MAX_ARG_DEPTH are the plain line; an unexpected error (a database blip) is one plain
 * line, logged by name only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FindArgs, find, type FindContext } from './find';
import { LIMITS, busyText, hit } from './rate-limit';
import { MAX_ARG_DEPTH, tooDeep } from './secrets';
import { COULD_NOT_READ, TOO_DEEP_NOTE, lenient } from './tool-input';
import { TrackInput, track } from './track';
import { RecordInput, recordTool } from '../v6/record-tool';
import { ScreenInput, screenTool } from '../v6/screen-tool';
import { SERVER_INSTRUCTIONS, FIND_DESCRIPTION, TRACK_DESCRIPTION, RECORD_DESCRIPTION, SCREEN_DESCRIPTION } from './tool-text';

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

/** The server's own words live in tool-text.ts, shared with llms.txt (v6.1.15); every importer keeps importing them here. */
export { SERVER_INSTRUCTIONS, FIND_DESCRIPTION, TRACK_DESCRIPTION, RECORD_DESCRIPTION, SCREEN_DESCRIPTION } from './tool-text';
export const BUSY = 'EarnKit is busy. Try again in a minute.';
/** Over an hourly limit: the window's seconds left as minutes (or hours) (v6.1.7, C8). */
export const BUSY_HOUR = busyText;

/** Counts one tool call against the IP floor and the installation's limit; the seconds to wait when over either, else null. */
async function refusedFor(ctx: McpContext, now: Date): Promise<number | null> {
  const count = (name: 'mcp' | 'mcpIp', who: string | number) => hit(`${name}:${who}`, LIMITS[name].limit, LIMITS[name].windowSeconds, now);
  if (ctx.ip) {
    const ip = await count('mcpIp', ctx.ip);
    if (!ip.allowed) return ip.retryAfter;
  }
  const own = await count('mcp', ctx.installationId);
  return own.allowed ? null : own.retryAfter;
}

const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

async function run(ctx: McpContext, name: string, args: unknown, fn: () => Promise<unknown>) {
  try {
    // Before any walk of the arguments (v6.1.7, B4); the route refuses these before the transport too.
    if (tooDeep(args, MAX_ARG_DEPTH)) return reply({ show_to_builder: COULD_NOT_READ, agent_note: TOO_DEEP_NOTE });
    const wait = await refusedFor(ctx, ctx.now ?? new Date());
    if (wait !== null) return { content: [{ type: 'text' as const, text: BUSY_HOUR(wait) }], isError: true };
    return reply(await fn());
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
      // L25-5 (v6.1.16): a title for each tool; find only reads.
      title: 'Find what you can earn',
      annotations: { readOnlyHint: true },
      description: FIND_DESCRIPTION,
      // L13-4 (v6.1.14): registered leniently like the others; find reads its arguments itself (findInputOf).
      inputSchema: lenient(FindArgs),
    },
    (args) => run(ctx, 'find', args, () => find({ installationId: ctx.installationId, builderId: ctx.builderId, now: now(), gh: ctx.gh, evidence: ctx.evidence, linkUrl: ctx.linkUrl }, args)),
  );
  server.registerTool(
    'track',
    { title: 'Track an application', description: TRACK_DESCRIPTION, inputSchema: lenient(TrackInput) },
    (args) => run(ctx, 'track', args, () => track({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  server.registerTool(
    'record',
    { title: 'Your record', description: RECORD_DESCRIPTION, inputSchema: lenient(RecordInput) },
    (args) => run(ctx, 'record', args, () => recordTool({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  server.registerTool(
    'screen',
    { title: 'Screen applicants', description: SCREEN_DESCRIPTION, inputSchema: lenient(ScreenInput) },
    (args) => run(ctx, 'screen', args, () => screenTool({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  return server;
}
