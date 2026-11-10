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
  "Call find first in every session with the project you are in, unless the builder is only screening applicants. Call record with get after that, and only when find's reply has linked true. Open with find's reply in your own words. Draft every form from find's fields: 'earnkit' and 'record' values as given, 'agent' values you draft from the field's sources, 'builder' values you ask the builder for once, all together; approved answers fitted by cutting, never by adding. Anything the builder tells you that a form could ask, save with record before using it. Submit in your own browser only after track started, and only when the builder said yes or their standing approval covers it. After each submission call track applied. When find's reply carries a sign-in link, show it once as the reply gives it; until the builder signs in, nothing is saved across agents. Never write a sentence about traction yourself. Never name tools, fields or files. Never invent an amount, a deadline or a rule.";
export const FIND_DESCRIPTION =
  "What can this repo earn: the programs it fits with every field pre-filled, the ones one change away, and the ledger. Call it first in every session with the project you are in, and again when the builder asks about money or programs. Pass every project fact you can read before the first call: chains with contract addresses, live_url, users (true only if you know), first_commit_at. Programs match on them, and a missing fact shows as a gap. With program_id: whether the project fits that program, and its details and form.";
export const TRACK_DESCRIPTION =
  "What the builder did: started (a claim before filling), applied (with submitted_by, and fields_used: the field keys from find's fields), won (with amount_usd; a second payment of one win is won again with that payment's amount, and it adds to the total), rejected, no_result, skipped, unskip (a skipped program may come back), or gap_done (item: the gap's item from find, copied exactly as given; project: the same object you passed to find). Call started before filling and applied after every submission. The started reply's application_id is the application's id at EarnKit: put it in the form's reference field when there is one, and give it when the program asks for an EarnKit id.";
export const RECORD_DESCRIPTION =
  "The builder's record: facts, links, documents and answers, kept once and read by every agent of theirs. Call it with get after find, once find's reply has linked true; call it with set for every new fact the builder gives; with brief for the question and facts behind one answer kind.";
export const SCREEN_DESCRIPTION =
  "For a program's reviewer: hand EarnKit the applicant list, each { ref (your id for them, required), name, repo_url, live_url, contracts: [{ chain, address }], pitch, application_id (the EarnKit id the applicant gave you, if any), requeue ({ job_id, ref } of the earlier row this one replaces, when you queue an applicant again; that row must be in this program's screens with the same application_id) }, and get it back in named tiers with public evidence; with job_id, progress and results, 25 applicants a page (page, from 1; next_page names the next, null on the last); with outcomes, who won (a second won on one applicant is a second payment and adds). Every reviewer of the program reads and continues its screens.";
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
      description: FIND_DESCRIPTION,
      // L13-4 (v6.1.14): registered leniently like the others; find reads its arguments itself (findInputOf).
      inputSchema: lenient(FindArgs),
    },
    (args) => run(ctx, 'find', args, () => find({ installationId: ctx.installationId, builderId: ctx.builderId, now: now(), gh: ctx.gh, evidence: ctx.evidence, linkUrl: ctx.linkUrl }, args)),
  );
  server.registerTool(
    'track',
    { description: TRACK_DESCRIPTION, inputSchema: lenient(TrackInput) },
    (args) => run(ctx, 'track', args, () => track({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  server.registerTool(
    'record',
    { description: RECORD_DESCRIPTION, inputSchema: lenient(RecordInput) },
    (args) => run(ctx, 'record', args, () => recordTool({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  server.registerTool(
    'screen',
    { description: SCREEN_DESCRIPTION, inputSchema: lenient(ScreenInput) },
    (args) => run(ctx, 'screen', args, () => screenTool({ installationId: ctx.installationId, builderId: ctx.builderId, now: now() }, args)),
  );
  return server;
}
