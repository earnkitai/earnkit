/**
 * The MCP server: four tools, find, track, record and screen, and the server instructions. Built per request
 * (the route is stateless). Each tool call counts against the installation's hourly limit, and only when that allows
 * it, the IP's; over either it is that limit's line, with the minutes the window has left and retry_after_seconds. A tool's reply is its JSON;
 * arguments nested past MAX_ARG_DEPTH are an input error; a refusal (L29-9, v6.1.16) is isError true with its usual JSON; an unexpected error (a database blip) is one plain
 * line, logged by name only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FindArgs, find, type FindContext } from './find';
import { LIMITS, LIMIT_ADDRESS, LIMIT_OWN, hit, uncountHit } from './rate-limit';
import { MAX_ARG_DEPTH, tooDeep } from './secrets';
import { TOO_DEEP_NOTE, inputError, isRefused, lenient } from './tool-input';
import pkg from '../../package.json';
import { track, trackAdvertised, trackDescription } from './track';
import { withCatalog } from './catalog-page';
import { RecordAdvertised, recordTool } from '../v6/record-tool';
import { ScreenInput, screenTool } from '../v6/screen-tool';
import { SERVER_INSTRUCTIONS, FIND_DESCRIPTION, RECORD_DESCRIPTION, SCREEN_DESCRIPTION } from './tool-text';
import { errorReply, replyFieldsOn, withReplyFields, type ToolName } from './reply-fields';

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

/**
 * Counts one tool call against the installation's own hourly limit first, then the IP floor (v6.1.16 Task 12, L26-1):
 * a call the installation's own limit refuses returns before the address window, so one looping agent never locks out
 * its colleagues on the same network. L35-25 (v6.1.17): a refused call never counts, whichever window refused it: an
 * own-limit refusal is taken back from the agent's window, an address refusal from both. Who refused and the seconds
 * to wait, else null.
 */
export async function refusedFor(ctx: McpContext, now: Date): Promise<{ retryAfter: number; who: 'installation' | 'address' } | null> {
  const key = (name: 'mcp' | 'mcpIp', who: string | number) => `${name}:${who}`;
  const count = (name: 'mcp' | 'mcpIp', who: string | number) => hit(key(name, who), LIMITS[name].limit, LIMITS[name].windowSeconds, now);
  const uncount = (name: 'mcp' | 'mcpIp', who: string | number) => uncountHit(key(name, who), LIMITS[name].windowSeconds, now);
  const own = await count('mcp', ctx.installationId);
  if (!own.allowed) {
    await uncount('mcp', ctx.installationId);
    return { retryAfter: own.retryAfter, who: 'installation' };
  }
  if (ctx.ip) {
    const ip = await count('mcpIp', ctx.ip);
    if (!ip.allowed) {
      await Promise.all([uncount('mcpIp', ctx.ip), uncount('mcp', ctx.installationId)]);
      return { retryAfter: ip.retryAfter, who: 'address' };
    }
  }
  return null;
}

/** v3.8 E13: the agent note on a busy reply and on a limit reply, with `reply_fields` on. */
export const BUSY_NOTE = 'Nothing was changed. Call again in a minute with the same arguments.';
export const LIMIT_NOTE = 'Nothing was changed. Call again after retry_after_seconds.';

/**
 * A refused call (L26-5): its limit line, with the seconds to wait for agents in `structuredContent`. v3.8 E13: with
 * `reply_fields` on, the text is the JSON shape of a tool reply, status refused.
 */
export const limitReply = (r: { retryAfter: number; who: 'installation' | 'address' }) => {
  const line = (r.who === 'installation' ? LIMIT_OWN : LIMIT_ADDRESS)(r.retryAfter);
  return {
    content: [{ type: 'text' as const, text: replyFieldsOn() ? JSON.stringify(errorReply(line, LIMIT_NOTE, 'refused', { retry_after_seconds: r.retryAfter })) : line }],
    structuredContent: { retry_after_seconds: r.retryAfter },
    isError: true,
  };
};

/** L29-9 (v6.1.16 Task 15): a refusal (`refuse`, `inputError`) is isError true with the same content. */
const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isRefused(value) ? { isError: true } : {}) });
/** v3.8 E13: a plain error line, or with `reply_fields` on its JSON (`errorReply`). Always isError. */
const errorLine = (line: string, note: string) =>
  ({ content: [{ type: 'text' as const, text: replyFieldsOn() ? JSON.stringify(errorReply(line, note, 'error')) : line }], isError: true });

async function run(ctx: McpContext, name: ToolName, args: unknown, fn: () => Promise<unknown>) {
  // v3.8 E13: `status` and `state` on every reply with `reply_fields` on; off, the reply is unchanged.
  const fields = (value: unknown) => (replyFieldsOn() ? withReplyFields(name, value, args) : value);
  try {
    // Before any walk of the arguments (v6.1.7, B4); the route refuses these before the transport too.
    if (tooDeep(args, MAX_ARG_DEPTH)) return reply(fields(inputError(TOO_DEEP_NOTE)));
    const refused = await refusedFor(ctx, ctx.now ?? new Date());
    if (refused !== null) return limitReply(refused);
    return reply(fields(await fn()));
  } catch (err) {
    if (err instanceof z.ZodError) {
      const detail = err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
      return replyFieldsOn() ? reply(fields(inputError(detail))) : { content: [{ type: 'text' as const, text: `Invalid input: ${detail}` }], isError: true };
    }
    // Only the error's name: a database error carries its query and parameters.
    console.error(`[mcp] ${name} failed`, err instanceof Error ? err.name : typeof err);
    return errorLine(BUSY, BUSY_NOTE);
  }
}

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: 'earnkit', version: pkg.version }, { instructions: SERVER_INSTRUCTIONS });
  const now = () => ctx.now ?? new Date();
  server.registerTool(
    'find',
    {
      // L25-5 (v6.1.16): a title for each tool; find only reads.
      title: 'Find what you can earn',
      annotations: { readOnlyHint: true },
      description: FIND_DESCRIPTION,
      // L13-4 (v6.1.14): registered leniently like the others; find reads its arguments itself (findInputOf).
      inputSchema: lenient(withCatalog(FindArgs)),
    },
    (args) => run(ctx, 'find', args, () => find({ installationId: ctx.installationId, builderId: ctx.builderId, now: now(), gh: ctx.gh, evidence: ctx.evidence, linkUrl: ctx.linkUrl }, args)),
  );
  server.registerTool(
    'track',
    { title: 'Track an application', description: trackDescription(), inputSchema: lenient(trackAdvertised()) },
    (args) => run(ctx, 'track', args, () => track({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  server.registerTool(
    'record',
    { title: 'Your record', description: RECORD_DESCRIPTION, inputSchema: lenient(RecordAdvertised) },
    (args) => run(ctx, 'record', args, () => recordTool({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  server.registerTool(
    'screen',
    { title: 'Screen applicants', description: SCREEN_DESCRIPTION, inputSchema: lenient(ScreenInput) },
    (args) => run(ctx, 'screen', args, () => screenTool({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  return server;
}
