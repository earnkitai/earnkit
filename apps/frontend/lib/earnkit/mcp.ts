import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodError, z } from 'zod';
import { raisingEnabled } from './builder-score-flag';
import { surfaceOf, withFormattedReply } from './reply-format';
import { sql } from './db';
import { CHAINS } from './match';
import { GitHubError } from './match-projects';
import { NotFoundError } from './programs';
import { EntryError } from './campaigns';
import { deployChains, deployEnabled } from './deploy';
import { RateLimitError } from './rate-limit';
import { SanctionsError } from './sanctions';
import { SponsorError } from './sponsor-rules';
import { LaunchError } from './tokens';
import { type ToolContext, type ToolName, tools } from './tools';
import {
  SAFETY_LINES,
  SAFETY_TEXT,
  UntrustedTextError,
} from './untrusted-text';

const project = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    repo_url: z.string().optional(),
    live_url: z.string().optional(),
    demo_url: z.string().optional(),
    token_url: z.string().optional(),
    contracts: z
      .array(z.string())
      .max(2)
      .optional()
      .describe("Up to 2 of the project's contract addresses on the program's chain (mainnet), when it needs a deployed contract"),
  })
  .describe('What you know about the project so far.');

/** v2.8 Ruling 7 (plan): what the agent can do. */
const AGENT = z
  .object({
    browser: z.boolean().optional().describe("true when you can drive the builder's own logged-in browser"),
    can_push: z.boolean().optional().describe("false when you can't push to the builder's repo (default true)"),
  })
  .strict()
  .describe('What you can do in this session');

/**
 * v2.8.1 §C15: what the agent sees for an unexpected error (a database blip, a failed fetch): a
 * plain message with the id the server logged it under, never the raw error. Exported for tests.
 */
export const unexpectedErrorText = (id: string) =>
  `EarnKit hit an unexpected error. Try again in a minute. If it keeps happening, tell the EarnKit team error id ${id}.`;

/** v2.14 final fix: an older agent's sign-in code (OLD_CODE) is dropped before the handler's strict input. Pure. */
const withoutOldCode = (input: unknown): unknown => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('signed_in' in input)) return input;
  const { signed_in: _old, ...rest } = input as Record<string, unknown>;
  return rest;
};

/** v4.0 Task 6: the installation's free-text client name (its own token's row), or null when unknown. */
async function clientNameOf(ctx: ToolContext): Promise<string | null> {
  try {
    const rows = await sql()<{ client_name: string | null }[]>`SELECT client_name FROM installations WHERE id = ${ctx.ownInstallationId ?? ctx.installationId}`;
    return rows[0]?.client_name ?? null;
  } catch {
    return null;
  }
}

async function run(ctx: ToolContext, tool: ToolName, input: unknown = {}, format = true) {
  try {
    // v3.1 reply format: show_to_builder reads well in Grok Bot's markdown and in plain chat apps (reply-format.ts).
    const raw = await tools[tool](withoutOldCode(input), ctx);
    const result = format ? withFormattedReply(raw, surfaceOf(await clientNameOf(ctx))) : raw;
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  } catch (err) {
    if (
      err instanceof ZodError ||
      err instanceof NotFoundError ||
      err instanceof GitHubError ||
      err instanceof LaunchError ||
      err instanceof EntryError ||
      err instanceof SponsorError ||
      err instanceof SanctionsError ||
      err instanceof RateLimitError ||
      err instanceof UntrustedTextError
    ) {
      const text =
        err instanceof ZodError
          ? `Invalid input: ${err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`
          : err.message;
      return { content: [{ type: 'text' as const, text }], isError: true };
    }
    // v2.8.1 §C15: logged on the server with an id; the agent gets a plain message.
    const id = randomBytes(4).toString('hex');
    // Final fix wave (M6): only the name, message and stack, never the whole object (a database
    // error carries its query and parameters, which may hold answers, emails or wallets).
    console.error(`[mcp] ${tool} error ${id}`, errorSummary(err));
    return { content: [{ type: 'text' as const, text: unexpectedErrorText(id) }], isError: true };
  }
}

/** What the unexpected-error log prints: name, message and stack only. Pure; exported for tests. */
export function errorSummary(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, ...(err.stack && { stack: err.stack }) };
  return { name: typeof err, message: 'non-Error thrown' };
}

/** Review minor 5: a chain as local_repos takes it ("base", 8453, { chain, mainnet }); unknown ones are dropped by the tool. */
const TELL_CHAIN = z.union([
  z.string(),
  z.number(),
  z.object({ chain: z.union([z.string(), z.number()]), mainnet: z.union([z.boolean(), z.string()]).optional() }),
]);

/** v2.14 spec 2: a token's repo is proven by the read-only GitHub App (never an earnkit.txt line or a proof branch). */
export const OWNERSHIP_FOR_TOKEN = 'A token needs a repo proven yours; EarnKit gives you the install link when it needs one.';

/**
 * v2.13 spec "Tools": find takes the one project the agent is in (identity.project) and every agent
 * note is followed. Under 800 characters (mcp.test.ts 2.8).
 */
export const FIND_DESCRIPTION_BENCH =
  'Where the builder stands, how to get funded. Pass identity.project (name, what (README), repo (git remote), live_url; never a list) and identity.github_login (not github_user or repos); never ask. ' +
  'Follow every agent_note. A yes or no to the question goes to tell move_up. program_id: one program\'s guide. ' +
  'more: true for what can I earn, what fits me, show programs. ' +
  SAFETY_TEXT;

/** v2.13: find's identity field: the one project, never a list. */
const BENCH_IDENTITY_WORDS =
  "Fill it yourself, never ask the builder: { github_login (gh auth status), project: the builder's project { name, what: a few plain words like 'a recipe planner' (README or package file), repo: git remote, live_url: README, package homepage or deploy config }, wallets }. One project, never a list.";

/**
 * v2.10 item 4, v3.1 (spec 3.4): prepare's description. prepare only drafts (draft-application.ts); the builder sends
 * the form. The host and build sentences only while those fields are registered (build: deploys on, review M2).
 */
const prepareDescription = (buildOn: boolean) =>
  'Draft an application from the ship log. Pass program_id, project (name, repo_url, live_url) and answers you drafted from the repo, by requirement key; ' +
  'the first call without answers lists the requirements. It never submits: the builder sends the form. Follow agent_note. ' +
  'host: true hosts a static build with no live link (show host.show_to_builder, never upload_url).' +
  // v2.11 T8: the build path starts from a build_offer yes; named only with the build field (review M2).
  (buildOn ? ' build: a build_offer yes.' : '');

/** v3.1 (spec 3.4, D1): confirm only opens Backing (the coin launch), registered only while EARNKIT_RAISING is on. */
export const CONFIRM_BACKING_DESCRIPTION =
  "The builder's yes to opening Backing. Pass project_id, yes: true, wallet and token exactly as tell coin returned them; check: true reads a launching coin. Then follow agent_note.";

/**
 * v2.10 item 4 (R16), v2.13: tell's description: also this week's line (or a week to hide), v2.14 spec 3:
 * a private repo's titles on or off, and coin { raising } (T9); launch ready L2: main_project, the repo to rank
 * instead; v3.1 Used by: builder_code, the Base Builder Code they named; under 800 characters (mcp.test.ts 5.11).
 */
export const TELL_DESCRIPTION_BENCH =
  "What the builder told you; call it only with what they said. submitted: { program_id, external_submission_url? } once they submitted on the program site; a shared agent adds project_id. " +
  'update: { text } adds their line to this week; { hide: "YYYY-MM-DD" } hides that week. ' +
  'updates: { titles }: show or hide a private repo\'s commit titles. ' +
  'main_project: owner/repo to rank instead. ' +
  "wallet: 'change' to add or change a wallet. " +
  'coin: their coin answer, or { raising } to open or close backing. ' +
  "token: 'ask' when they ask about a token. " +
  'builder_code: their Base Builder Code. ' +
  'move_up: their answer, with its kind and project_key. profile (hide, show, delete), card (yes, skip): their answers. ' +
  'program_status (applied, accepted, won and the rest), repo_facts, weekly_email: what they said; private.';

/** Final fix (controller ruling): EARNKIT_RAISING off: coin takes no { raising }. */
export const TELL_DESCRIPTION_BENCH_NO_RAISING = TELL_DESCRIPTION_BENCH.replace(
  'coin: their coin answer, or { raising } to open or close backing. ',
  'coin: their coin answer. ',
);

/** v2.12.1 T8: score's description. */
export const SCORE_DESCRIPTION =
  "Where the builder stands: their Shipping score, their rank (every ranked builder sees one), their page, and the one step up. Call it when they ask how they're doing. " +
  'Show show_to_builder as written; a yes or no to its question goes to tell move_up (with move_up.kind and project_key). ' +
  SAFETY_TEXT;

/**
 * v2.10 item 4: every tool description, agent-facing, each under 800 characters. v3.1 (spec 3.4): no text varies by
 * an open campaign any more (the argument is kept for the route); confirm only while EARNKIT_RAISING is on.
 * v2.11 T8 review M2: prepare names `build` only while the field is listed (deploys on).
 */
export function toolDescriptions(_campaignOpen: boolean, buildOn: boolean = deployEnabled() && deployChains().length > 0): {
  find: string; prepare: string; confirm?: string; tell: string; score: string;
} {
  return {
    find: FIND_DESCRIPTION_BENCH,
    prepare: prepareDescription(buildOn),
    // v3.1 (spec 3.4, D1): confirm is listed only while EARNKIT_RAISING is on, and only for Backing.
    ...(raisingEnabled() && { confirm: CONFIRM_BACKING_DESCRIPTION }),
    tell: raisingEnabled() ? TELL_DESCRIPTION_BENCH : TELL_DESCRIPTION_BENCH_NO_RAISING,
    score: SCORE_DESCRIPTION,
  };
}

/** Every description with its build sentence (the longest), confirm always; exported for the copy-review test. */
export const TOOL_DESCRIPTIONS = { ...toolDescriptions(true, true), confirm: CONFIRM_BACKING_DESCRIPTION };

/**
 * v2.7 §4, v2.13.1 O2: the MCP server's instructions, agent-facing: the Bench's flow, not the v2.10
 * entry-and-token one (the agent must never read a yes to "post updates" as a token launch). Under
 * 800 characters with the safety lines.
 */
export const BENCH_INSTRUCTION_LINES = [
  'Call find first. If the builder asked something, answer it in one short line from facts in the reply, never invented; then show show_to_builder exactly as written and follow every agent_note.',
  'A yes or no to the question goes to tell move_up.',
  'Call score when they ask where they stand.',
  'Never name tools, fields or files to the builder, or invent personal details.',
];

export function serverInstructions() {
  return [...BENCH_INSTRUCTION_LINES, ...SAFETY_LINES].join('\n');
}

/** The instructions; exported for the copy-review test. */
export const SERVER_INSTRUCTIONS = serverInstructions();

/**
 * v2.14 final fix (T6-2): the shared client's GitHub sign-in code is gone. confirm and tell are strict, so an older
 * agent still sending its code would get a validation error: the key is accepted there and dropped by the
 * handler's input (find and prepare already strip unknown keys).
 */
const OLD_CODE = z.unknown().optional().describe('Not used any more; ignored.');
const CHECK =
  'true only when checking back after "Your token is launching": it reads the result and never starts a launch';

/** v2.10 item 13: prepare's `deploy` (registered only while deployEnabled(), final fix M4, and DEPLOY_CHAINS names a chain, v2.10.3). */
const DEPLOY_SCHEMA = z
  .object({
    chain: z.enum(['arc', 'base']),
    bytecode: z.string().describe('The compiled creation bytecode (0x...), from the repo you built'),
    abi: z.array(z.object({ type: z.string() }).passthrough()).describe("The contract's ABI"),
    constructor_args: z.array(z.unknown()).optional().describe('Constructor arguments in ABI order (integers as decimal strings)'),
    owner_wallet: z.string().optional().describe('The wallet that should own the contract, as the builder gave it'),
  })
  .strict()
  .optional()
  .describe(
    'Only when the builder asks EarnKit to deploy their contract and you compiled it. EarnKit pays the gas and makes the builder the owner; ' +
      'once a day per chain. Put deploy.address from the reply in contracts, never in a description.',
  );

/**
 * v2.11 T8 (plan S7): prepare's `build`, registered with `deploy` (only while deploys are on: the
 * build path needs them). Passthrough, so the handler's strict check names an unknown key.
 */
const BUILD_SCHEMA = z
  .object({
    program_id: z.string(),
    start: z.literal(true).optional().describe("true on the builder's yes to build_offer: EarnKit asks them one question first"),
    twist: z.string().optional().describe("The builder's answer, in their words"),
    name: z.string().optional().describe('From the twist: 3 to 40 characters, a word of the twist in it'),
    description: z.string().optional().describe('From the twist: one line, a word of the twist in it'),
    feature: z.string().optional().describe("From the twist: one sentence, not the kit's default"),
    for_whom: z.string().optional().describe('"for ..." from the twist, like "for your podcast listeners"'),
    wallet: z.string().optional().describe('The wallet the builder gave to own it; never one you made up'),
    repo_url: z.string().optional().describe("The repo under the builder's own account; EarnKit proves it with the read-only GitHub App"),
  })
  .passthrough()
  .optional()
  .describe("Only after find's build_offer: follow each reply's agent_note.");

/**
 * The EarnKit MCP server for one connected agent (installation). `campaignOpen` (v2.8 Ruling 23
 * (plan), default false): whether an EarnKit campaign is open, read by the route (v3.1: no tool text uses it).
 */
/** `format: false` (tests only): show_to_builder exactly as the tools wrote it, before formatReply. */
export function createMcpServer(ctx: ToolContext, opts: { campaignOpen?: boolean; format?: boolean } = {}): McpServer {
  // v3.1: no tool text depends on an open campaign any more (confirm never enters one); the route still passes it.
  const descriptions = toolDescriptions(opts.campaignOpen ?? false);
  const server = new McpServer(
    // v2.10.1 B5: the version moves with the tool list, so a client that keys its cached list on it lists again.
    { name: 'earnkit', version: '3.1.0' },
    // MCP sends instructions once, in the initialize response. The route builds a server per
    // request (stateless), so each session's initialize carries the campaignOpen read for it.
    { instructions: serverInstructions() },
  );

  // v2.10 item 4: list_programs and get_program. Read-only.
  server.registerTool(
    'find',
    {
      description: descriptions.find,
      inputSchema: {
        // v2.8.1 §B6 (fix round 2): these four are never refused here; tools.ts reads what it can.
        github_user: z
          .unknown()
          .optional()
          // v2.13.3 (1), v2.14 A24: still read (it fills identity.github_login), but not the way to send it.
          .describe('Older field: send identity.github_login instead'),
        // v2.8.1 §B6 (fix round 1): anything; a wallet that isn't 0x is ignored with wallet_note.
        wallet: z
          .unknown()
          .optional()
          .describe("Only the 0x wallet the builder named to add; the reply carries its signing link"),
        repos: z
          .unknown()
          .optional()
          .describe('Older field: send identity.project instead'),
        // v2.13.3 (1): an older agent's live link, read as identity.project.live_url (never dropped).
        live_url: z.unknown().optional().describe('Older field: send identity.project.live_url instead'),
        // v2.8.1 §B6 (fix round 1): lenient here, so no report fails the call; tools.ts list_programs
        // (match-projects.ts LocalReposInput) reads what it can, drops the rest and keeps the limits
        // (20 repos, 20 chains each, 100-character names, 300-character links).
        local_repos: z
          .preprocess((v) => (v == null || Array.isArray(v) ? v : [v]), z.array(
            // Anything that isn't an object (a bare name) is read as { name } before validation.
            z.preprocess(
              (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : { name: v }),
              z.object({
                name: z.unknown().optional().describe("The repo's name"),
                chains: z
                  .unknown()
                  .optional()
                  .describe(
                    `Chains the code targets: a list of names, chain ids or { chain, mainnet } (${CHAINS.join(', ')} count; others are ignored); mainnet false = testnet only`,
                  ),
                live_url: z.unknown().optional(),
                contracts: z
                  .unknown()
                  .optional()
                  .describe("Up to 2 mainnet contract addresses the repo itself deployed, if you see them; never shared ones (routers, PoolManager, Clanker's)"),
                my_commits_90d: z.unknown().optional().describe("The builder's own commits in the last 90 days (git log --author=<their email> --since=90.days)"),
                last_commit_at: z.unknown().optional().describe('ISO 8601; a date alone counts as UTC. Always send it.'),
                first_commit_at: z.unknown().optional().describe('ISO 8601: the first commit (git log --reverse), the repo\'s age'),
                url: z
                  .unknown()
                  .optional()
                  .describe("The repo's GitHub link, if the local remote is on GitHub"),
                // v2.13.4 (production): an agent's `remote` or `repo` is kept (the SDK strips unknown keys), so
                // the old fields' entry still names its repo.
                remote: z.unknown().optional().describe("Or the repo's git remote"),
                repo: z.unknown().optional().describe("Or the repo as 'owner/repo'"),
              }),
            ),
          ))
          .optional()
          .describe(
            'Private or local repos you can see. For private repos, report local_repos facts: name, chains, contracts, live link, last commit. EarnKit never needs their code.',
          ),
        // v2.12.1 spec "1. Connect": what the agent can already see (it replaces v2.12's local_git, still
        // accepted). Read leniently (identity-input.ts identityInput).
        identity: z.unknown().optional().describe(BENCH_IDENTITY_WORDS),
        agent_can_build: z
          .unknown()
          .optional()
          .describe(
            'false if you cannot write code, deploy, and use a web browser in this session (default true)',
          ),
        // v2.14 T5 (A6): the fallback sign-in link's paste-back code; find binds with it before anything else.
        sign_in_code: z.string().max(40).optional().describe('The code the builder pasted after signing in with X from your sign-in link'),
        // v2.10 item 2: "show more".
        more: z.boolean().optional().describe('true for the full tables: when the builder asks what they can earn, what fits them, to see programs or more, or says yes to "Want the 3 easiest?" (never for a yes to the lead)'),
        program_id: z.string().optional().describe("One program's details; for a curated program show_to_builder is its guide"),
        repo: z.string().optional().describe('With program_id: "owner/repo" or a github.com link to check against that program'),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run(ctx, 'find', input, opts.format ?? true),
  );

  // v2.10 item 4: prepare_submission; item 13: plus deploy.
  server.registerTool(
    'prepare',
    {
      description: descriptions.prepare,
      inputSchema: {
        program_id: z.string(),
        project: project.optional(),
        answers: z
          .record(z.string(), z.string())
          .optional()
          .describe('Answers by submission requirement key.'),
        agent: AGENT.optional(),
        coach_asked: z
          .boolean()
          .optional()
          .describe("true only after you showed this program's questions and the builder answered (the coach asks once per program)"),
        host: z
          .boolean()
          .optional()
          .describe('true when the builder has no live link and the project builds to static files: EarnKit hosts it (see host in the reply)'),
        // v2.10 item 13: EarnKit deploys the builder's contract (Arc or Base), the builder as owner.
        // Final fix M4: advertised only while deploys are on (as sponsor_campaign with escrow).
        ...(deployEnabled() && deployChains().length > 0 && { deploy: DEPLOY_SCHEMA, build: BUILD_SCHEMA }),
        // v2.12.1 T9: the tip jar from a move-up yes (deploy only, no entry draft).
        ...(deployEnabled() && deployChains().length > 0 && {
          tips: z.literal(true).optional().describe('true only for the tip jar a move_up yes asked for: deploy alone, never an entry'),
        }),
      },
      // v2.10 item 13: with deploy, prepare sends a transaction.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) => run(ctx, 'prepare', input, opts.format ?? true),
  );

  // v3.1 (spec 3.4, D1): confirm only opens Backing (the coin launch by project_id), and only while EARNKIT_RAISING is
  // on; an entry is never made here (prepare drafts, the builder sends it). Strict, so a misnamed key (say `ticker`) is
  // an error, not silently dropped.
  if (descriptions.confirm !== undefined)
    server.registerTool(
      'confirm',
      {
        description: descriptions.confirm,
        inputSchema: z
          .object({
            project_id: z.number().int().describe("tell coin's project_id"),
            yes: z.literal(true).optional().describe('The builder said yes to opening Backing: the coin launches'),
            check: z.boolean().optional().describe(CHECK),
            token: z
              .object({ name: z.string().optional(), symbol: z.string().optional() })
              .strict()
              .optional()
              .describe('As tell coin returned it, or as the builder changed it'),
            wallet: z.string().optional().describe('The wallet tell coin returned, or the one the builder named instead'),
            image_url: z.string().optional().describe('https URL of the coin image'),
            image_data: z.string().optional().describe('Or the image you generated, as a data URL (PNG/JPEG/WebP/GIF, up to 1 MB). EarnKit hosts it.'),
            builder_x: z.string().optional().describe("The builder's X handle or profile URL"),
            agent: AGENT.optional(),
            signed_in: OLD_CODE,
          })
          .strict(),
      },
      (input) => run(ctx, 'confirm', input, opts.format ?? true),
    );

  // v2.10 item 4 (R16): tell_earnkit and record_submission's "I submitted" (v2.14: no pickup). It
  // writes, so it is not read-only; find stays read-only. Statements are read leniently (TellInput).
  server.registerTool(
    'tell',
    {
      description: descriptions.tell,
      inputSchema: z
        .object({
          submitted: z
            .object({
              program_id: z.string(),
              external_submission_url: z.string().optional().describe('The entry link, if the site gave one'),
              project_id: z.number().int().positive().optional().describe("The entry's project_id (required on a shared agent)"),
              project: project.optional().describe('Only for an entry not recorded yet: the project'),
              submission_data: z.record(z.string(), z.unknown()).optional().describe('Only for an entry not recorded yet: its answers'),
            })
            .strict()
            .optional(),
          // v2.12 spec 7, 8.
          profile: z.enum(['hide', 'show', 'delete']).optional().describe("hide or show their public page, when they say so; 'delete' when they ask to delete their data or account"),
          card: z.enum(['yes', 'skip']).optional().describe('Their answer to "Want a card to share it?"'),
          // Launch ready L2: the repo to rank instead.
          main_project: z.string().max(300).optional().describe('owner/repo (or its GitHub link) when they name another of their repos to rank'),
          // v3.1 wallet proof: a fresh signing link for a new reward wallet.
          wallet: z.string().max(100).optional().describe("'change' (or the address they named) when they want to add a wallet or send their rewards to a different one"),
          builder_code: z.string().max(100).optional().describe('The Base Builder Code they named (lowercase letters, digits, underscores)'),
          move_up: z
            .object({
              kind: z.string().max(20).optional().describe("find's or score's move_up.kind; 'token' when the builder said no to their token, or asked to launch it"),
              project_key: z.string().max(300).nullable().optional().describe("find's or score's move_up.project_key"),
              answer: z.enum(['yes', 'no']),
              live_url: z.string().max(300).optional().describe("Only when a go_live note asks: the app's GitHub Pages link once it loads"),
            })
            .strict()
            .optional()
            .describe('Their answer to the question'),
          // v2.13 T9 (F20): with EARNKIT_RAISING on, coin also takes raising; otherwise byte for byte v2.12.2.
          coin: raisingEnabled()
            ? z
                .object({
                  project_key: z.string().max(300).optional().describe("The coin offer's project_key (move_up.project_key or coin.project_key)"),
                  answer: z.enum(['yes', 'no']).optional(),
                  wallet: z.string().max(100).optional().describe('The 0x address they gave for the fees, if they gave one'),
                  raising: z.boolean().optional().describe('true when they open backing, false when they close it'),
                })
                .strict()
                .optional()
                .describe('Their answer to a coin or backing offer, or opening or closing backing')
            : z
                .object({
                  project_key: z.string().max(300).describe("The coin offer's project_key (move_up.project_key or coin.project_key)"),
                  answer: z.enum(['yes', 'no']),
                  wallet: z.string().max(100).optional().describe('The 0x address they gave for the fees, if they gave one'),
                })
                .strict()
                .optional()
                .describe('Their answer to a coin offer'),
          // Scoring and clarity R8: a token only when the builder asks about one (v3 Stage 2: backing has its own moment).
          token: z.literal('ask').optional().describe("'ask' only when the builder asks about a token or coin; EarnKit never offers one otherwise"),
          // v2.13: the ship log.
          update: z
            .object({
              text: z.string().max(2000).optional().describe("One plain line to add to this week's log, at most 280 characters"),
              hide: z.string().max(20).optional().describe('YYYY-MM-DD, any day of the week to hide'),
            })
            .strict()
            .optional()
            .describe("A line for this week's log, or the week to hide"),
          // v2.14 spec 3 (A12): the log writes itself; titles on or off for a private repo. An older agent's { on, scheduled } is answered.
          updates: z
            .object({
              titles: z.boolean().optional().describe("true: show their commit titles on a private repo's log; false: only the facts"),
              on: z.boolean().optional(),
              scheduled: z.boolean().optional(),
            })
            .strict()
            .optional()
            .describe("A private repo's titles on or off"),
          program_status: z
            .array(
              z
                .object({
                  program_id: z.string(),
                  status: z.enum(['applied', 'not_interested', 'accepted', 'funded', 'rejected', 'won', 'placed', 'lost']),
                  project_id: z.number().int().positive().optional().describe("For won, placed or lost: ask_outcome's project_id (an application's accepted, funded or rejected needs none)"),
                  prize_usd: z.number().nonnegative().optional().describe('What they won, in USD, if they said'),
                  proof_url: z.string().max(2048).optional().describe("For accepted, funded or won: a public page you opened that shows it (the program's X post or results page)"),
                })
                .strict(),
            )
            .max(20)
            .optional(),
          repo_facts: z
            .array(
              z
                .object({
                  repo: z.string().max(300).describe('owner/repo, a github.com link, or the repo name'),
                  mainnet_chains: z.array(TELL_CHAIN).max(20).optional().describe('Chains it is deployed on, e.g. ["base"]'),
                  testnet_chains: z.array(TELL_CHAIN).max(20).optional().describe('Chains it is only on testnet'),
                  live_url: z.string().max(300).optional(),
                  has_users: z.boolean().optional(),
                  not_mine: z.boolean().optional().describe('true when the builder says it is not their repo'),
                })
                .strict(),
            )
            .max(20)
            .optional(),
          weekly_email: z
            .object({
              answer: z.string().describe('yes or no, as the builder answered the weekly email question'),
              email: z.string().max(320).optional().describe('The email they gave, if any'),
            })
            .strict()
            .optional(),
          signed_in: OLD_CODE,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input) => run(ctx, 'tell', input, opts.format ?? true),
  );

  // v2.12 spec 7: the 5th tool.
  server.registerTool(
    'score',
    {
      description: descriptions.score,
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (input) => run(ctx, 'score', input, opts.format ?? true),
  );

  return server;
}
