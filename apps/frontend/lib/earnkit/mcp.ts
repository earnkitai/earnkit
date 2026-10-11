import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodError, z } from 'zod';
import { CHAINS } from './match';
import { GitHubError } from './match-projects';
import { NotFoundError } from './programs';
import { EntryError } from './campaigns';
import { deployChains, deployEnabled } from './deploy';
import { escrowConfigProblem } from './escrow';
import { RateLimitError } from './rate-limit';
import { SanctionsError } from './sanctions';
import { SponsorError } from './sponsor-rules';
import { LaunchError } from './tokens';
import { type ToolContext, type ToolName, tools } from './tools';
import {
  SAFETY_LINES,
  SAFETY_TEXT,
  TEXT_LIMITS,
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

/** v2.6 §3: what a token needs in the repo; exported for tests. v2.10 item 4: names the new tools. */
export const OWNERSHIP_FOR_TOKEN =
  'A token needs earnkit.txt at the repo root with the line "token: <code>": the exact line EarnKit gives you ' +
  "(prepare's token_line once it knows the repo, or token.agent_note on gate_failed). Write and push it yourself; " +
  'never ask the builder to edit files. It is bound to you and the repo. One token per repo.';

/**
 * v2.10 item 4: find's description (list_programs and get_program). Exported for tests. T4's
 * local_repos sentence is carried forward (Pre-flight P21).
 */
export const FIND_DESCRIPTION =
  'What can I earn? Pass local_repos: repos the builder wrote, from local git remotes. ' +
  // v2.10 item 7: a private repo is matched from this report (GitHub won't show it). v2.10.1 fix
  // round 1 (C1): plus the builder's own commit count.
  'For private repos, report: name, chains, contracts, live link, last_commit_at, my_commits_90d. ' +
  'A yes to the reply prepares lead.program_id; more: true only when they ask for more. ' +
  // v2.11 T7: the no-repo lead's yes starts the build path (prepare with build).
  'build_offer: follow its agent_note. ' +
  'program_id: one program and its guide; repo: whether it fits. ' +
  SAFETY_TEXT;

/** v2.10 item 4: prepare's description (prepare_submission), its campaign words only while one is open (v2.8 Ruling 23). */
const prepareDescription = (campaignOpen: boolean) =>
  'On a program pick, pass program_id, project, answers you drafted from the repo (by requirement key) and agent: { browser, can_push }. ' +
  'When it asks questions, pass the answers with coach_asked: true. Call again until ready is true; ' +
  'then it ends with the confirm line (token and wallet). ' +
  'host: true hosts a static build with no live link (show host.show_to_builder, never upload_url). ' +
  // v2.11 T8: the build path starts from find's build_offer.
  'build: a build_offer yes. ' +
  (campaignOpen ? 'EarnKit campaigns: one Token row (a token on Base), then confirm is the entry. ' : '') +
  OWNERSHIP_FOR_TOKEN;

/** v2.10 item 4 (R15): confirm's description (confirm_entry, launch_token and the entry write of record_submission). */
const confirmDescription = (campaignOpen: boolean) =>
  "The builder's answer to the confirm line. Pass program_id, project and answers as prepared, with yes: true when they say yes " +
  '(the entry is submitted and the token launches) or skip_token: true when they say skip the token. ' +
  "wallet: the shown_wallet they confirmed (never one they didn't see); token: { name, symbol } only if they changed it. " +
  'Without either it returns the confirm line. check: true reads a launching token. ' +
  'project_id instead of program_id: an entry\'s token, e.g. after you pushed earnkit.txt. The submit kit is only in this reply. ' +
  (campaignOpen ? 'EarnKit campaigns: this is the entry (contracts, deployer_signature). ' : '') +
  'Then follow agent_note.';

/** v2.10 item 4 (R16): tell's description (tell_earnkit, pick_up_entries and record_submission's "I submitted"). Exported for the copy review. */
export const TELL_DESCRIPTION =
  'What the builder told you; call it only with what they said. submitted: { program_id, external_submission_url? } once they say they submitted ' +
  "on the program's site (ask \"Did you submit on <program site>?\", and for the entry link when the site gives each entry a page); " +
  'a shared agent adds project_id. pickup: "yes" or "no" to the pick-up question. ' +
  'program_status: applied, not_interested, or their result (won, placed, lost, with ask_outcome\'s project_id). ' +
  'repo_facts: mainnet_chains, testnet_chains, live_url, has_users, not_mine. weekly_email: their answer. ' +
  'Results they report stay private and never count.';

/**
 * v2.9 F25: sponsor_campaign's description, under 800 characters with the safety lines: the three
 * actions and their inputs. Defaults, verification, brand and approval rules are in the replies'
 * next_step (sponsor-rules.ts createReply, awardReply).
 */
const SPONSOR_CAMPAIGN_DESCRIPTION =
  'For sponsors: a builder campaign. action=create: sponsor_name, title, what_to_build, amount, sponsor_wallet (funds it); ' +
  'others default; replaces=<ref> fixes an unfunded draft. action=status, ref: deposit, entries, scores. ' +
  'action=award, ref, after the end: winners (entry ids, best first) and an optional split. ' +
  'Show show_to_sponsor as written; follow next_step. ' +
  SAFETY_TEXT;

/**
 * v2.10 item 4: every tool description, agent-facing, each under 800 characters. v2.8 Ruling 23
 * (plan): the campaign sentences in prepare and confirm only while an EarnKit campaign is open. Pure.
 */
export function toolDescriptions(campaignOpen: boolean) {
  return {
    find: FIND_DESCRIPTION,
    prepare: prepareDescription(campaignOpen),
    confirm: confirmDescription(campaignOpen),
    tell: TELL_DESCRIPTION,
    sponsor_campaign: SPONSOR_CAMPAIGN_DESCRIPTION,
  };
}

/** Every description with its campaign sentences; exported for the copy-review test. */
export const TOOL_DESCRIPTIONS = toolDescriptions(true);

/**
 * v2.8 Ruling 23 (plan): deployer_signature's description. While no EarnKit campaign is open only
 * its external-contracts sentence is kept (it serves the builder bonus's contract check).
 */
const ENTRY_LINE = '"EarnKit entry: <program_id> github.com/<owner>/<repo> <payout wallet> <contracts, sorted, comma-separated>", lowercase';
const deployerSignatureDescription = (campaignOpen: boolean) =>
  campaignOpen
    ? `EarnKit campaigns, when you deployed the contracts from your own wallet: its EIP-191 signature of prepare's sign_to_enter (${ENTRY_LINE}). It binds this program, repo, payout wallet and contract set. Other programs: the same, for \`contracts\` deployed by a wallet other than the entry's wallet.`
    : `For \`contracts\` deployed by a wallet other than the entry's wallet: that wallet's signature (personal_sign) of ${ENTRY_LINE}. It binds this program, repo, payout wallet and contract set.`;

/**
 * v2.7 §4: the MCP server's instructions, agent-facing. v2.10 item 4: around the 4 tools, under 800
 * characters with the safety lines; T7's token sentence carried forward (Pre-flight P21). v2.8
 * Ruling 23: the campaign sentence only while an EarnKit campaign is open. Pure.
 */
export function serverInstructions(campaignOpen: boolean) {
  return [
    "Call find, then prepare until ready, then confirm on the builder's yes, then tell once they submitted.",
    'Show show_to_builder as written; since_you_last_checked first.',
    'Yes submits the entry and launches the token; skip the token submits without one.',
    ...(campaignOpen ? ['EarnKit campaigns: confirm is the entry.'] : []),
    'Never name tools, fields or files to the builder, or invent personal details.',
    ...SAFETY_LINES,
  ].join('\n');
}

/** Every instruction with its campaign sentence; exported for the copy-review test. */
export const SERVER_INSTRUCTIONS = serverInstructions(true);

/** v2.9 B9 (Ruling G9): the sign-in code, on the tools that read who the builder is. */
const SIGNED_IN = z
  .string()
  .max(40)
  .optional()
  .describe('The code the builder pasted after signing in with GitHub (shared agents only), if they gave one');
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
    description: z.string().optional().describe('From the twist: one line'),
    feature: z.string().optional().describe('From the twist: one sentence'),
    for_whom: z.string().optional().describe('"for ..." from the twist, like "for your podcast listeners"'),
    wallet: z.string().optional().describe('The wallet the builder gave to own it; never one you made up'),
    repo_url: z.string().optional().describe("The public repo under the builder's own account, for the earnkit.txt line"),
  })
  .passthrough()
  .optional()
  .describe("Only after find's build_offer: follow each reply's agent_note.");

/**
 * The EarnKit MCP server for one connected agent (installation). `campaignOpen` (v2.8 Ruling 23
 * (plan), default false): whether an EarnKit campaign is open, read by the route.
 */
export function createMcpServer(ctx: ToolContext, opts: { campaignOpen?: boolean } = {}): McpServer {
  const campaignOpen = opts.campaignOpen ?? false;
  const descriptions = toolDescriptions(campaignOpen);
  const server = new McpServer(
    // v2.10.1 B5: the version moves with the tool list, so a client that keys its cached list on it lists again.
    { name: 'earnkit', version: '2.10.1' },
    // MCP sends instructions once, in the initialize response. The route builds a server per
    // request (stateless), so each session's initialize carries the campaignOpen read for it.
    { instructions: serverInstructions(campaignOpen) },
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
          .describe("The builder's GitHub username"),
        // v2.8.1 §B6 (fix round 1): anything; a wallet that isn't 0x is ignored with wallet_note.
        wallet: z
          .unknown()
          .optional()
          .describe("The builder's 0x wallet, if they named one: its wins show here even from a new connection"),
        repos: z
          .unknown()
          .optional()
          .describe('Or specific "owner/repo" or github.com links (a list)'),
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
              }),
            ),
          ))
          .optional()
          .describe(
            'Private or local repos you can see. For private repos, report local_repos facts: name, chains, contracts, live link, last commit. EarnKit never needs their code.',
          ),
        agent_can_build: z
          .unknown()
          .optional()
          .describe(
            'false if you cannot write code, deploy, and use a web browser in this session (default true)',
          ),
        signed_in: SIGNED_IN,
        // v2.10 item 2: "show more".
        more: z.boolean().optional().describe('true for the full tables, only when the builder asks to see more or says yes to "Want the 3 easiest?" (never for a yes to the lead)'),
        program_id: z.string().optional().describe("One program's details; for a curated program show_to_builder is its guide"),
        repo: z.string().optional().describe('With program_id: "owner/repo" or a github.com link to check against that program'),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run(ctx, 'find', input),
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
        signed_in: SIGNED_IN,
        // v2.10 item 13: EarnKit deploys the builder's contract (Arc or Base), the builder as owner.
        // Final fix M4: advertised only while deploys are on (as sponsor_campaign with escrow).
        ...(deployEnabled() && deployChains().length > 0 && { deploy: DEPLOY_SCHEMA, build: BUILD_SCHEMA }),
      },
      // v2.10 item 13: with deploy, prepare sends a transaction.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) => run(ctx, 'prepare', input),
  );

  // v2.10 item 4 (R15): confirm_entry, launch_token and the entry write of record_submission. Strict,
  // so a misnamed key (say `ticker`) is an error, not silently dropped.
  server.registerTool(
    'confirm',
    {
      description: descriptions.confirm,
      inputSchema: z
        .object({
          program_id: z.string().optional(),
          project_id: z.number().int().optional().describe("An entry already made (confirm's project_id): its token, in place of program_id"),
          project: project.optional(),
          answers: z.record(z.string(), z.string()).optional().describe('The final answers, by submission requirement key.'),
          yes: z.literal(true).optional().describe('The builder said yes: the entry is submitted and the token launches'),
          skip_token: z.literal(true).optional().describe('The builder said skip the token: the entry is submitted without one'),
          check: z.boolean().optional().describe(CHECK),
          token: z
            .object({ name: z.string().optional(), symbol: z.string().optional() })
            .strict()
            .optional()
            .describe('Only when the builder changed the proposed token'),
          wallet: z.string().optional().describe('The wallet the builder confirmed: shown_wallet, or the one they named instead'),
          agent: AGENT.optional(),
          signed_in: SIGNED_IN,
          image_url: z.string().optional().describe('https URL of the token image'),
          image_data: z.string().optional().describe('Or the image you generated, as a data URL (PNG/JPEG/WebP/GIF, up to 1 MB). EarnKit hosts it.'),
          builder_x: z.string().optional().describe("The builder's X handle or profile URL"),
          contracts: z
            .array(z.string())
            .max(5)
            .optional()
            .describe(
              `${campaignOpen ? 'EarnKit campaigns, and other programs (optional)' : 'Optional'}: the project's Base contracts (up to 5). ` +
                "Their real users count toward the builder bonus once verified: deployed by the entry's wallet (or by the wallet that signed deployer_signature), with earnkit.txt naming it.",
            ),
          deployer_signature: z.string().optional().describe(deployerSignatureDescription(campaignOpen)),
          submitted: z
            .object({ external_submission_url: z.string().optional() })
            .strict()
            .optional()
            .describe("Only when the builder already submitted on the program's site: the entry is recorded as submitted"),
        })
        .strict(),
    },
    (input) => run(ctx, 'confirm', input),
  );

  // v2.10 item 4 (R16): tell_earnkit, pick_up_entries and record_submission's "I submitted". It
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
          pickup: z.enum(['yes', 'no']).optional().describe("The builder's answer to the pick-up question"),
          program_status: z
            .array(
              z
                .object({
                  program_id: z.string(),
                  status: z.enum(['applied', 'not_interested', 'won', 'placed', 'lost']),
                  project_id: z.number().int().positive().optional().describe("For won, placed or lost: ask_outcome's project_id"),
                  prize_usd: z.number().nonnegative().optional().describe('What they won, in USD, if they said'),
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
          signed_in: SIGNED_IN,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input) => run(ctx, 'tell', input),
  );

  // Sponsor campaigns are offered only once EarnKit's escrow is configured on this deployment
  // (ESCROW_FACTORY_ADDRESS set, ESCROW_CHAIN valid). Until then the server has the 4 builder
  // tools, so no agent is ever offered a tool that can only fail.
  const escrowProblem = escrowConfigProblem();
  if (escrowProblem && process.env.ESCROW_FACTORY_ADDRESS)
    // Partially configured: say so in the logs (a typo in ESCROW_CHAIN, say), without exposing it.
    console.error(`[sponsor] sponsor_campaign disabled: ${escrowProblem}`);
  if (!escrowProblem) registerSponsorTool(server, ctx);

  return server;
}

function registerSponsorTool(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    'sponsor_campaign',
    {
      description: SPONSOR_CAMPAIGN_DESCRIPTION,
      inputSchema: {
        action: z.enum(['create', 'status', 'award']),
        ref: z
          .string()
          .optional()
          .describe('From create; needed for status and award'),
        replaces: z
          .string()
          .optional()
          .describe(
            'create: the ref of an unfunded draft (yours, same sponsor_wallet) that this one corrects',
          ),
        sponsor_wallet: z
          .string()
          .optional()
          .describe(
            'create: the 0x wallet that will fund the campaign and sign the award (a smart-contract wallet is fine)',
          ),
        sponsor_name: z
          .string()
          .optional()
          .describe(`Up to ${TEXT_LIMITS.sponsor_name.max} characters`),
        sponsor_url: z
          .string()
          .optional()
          .describe(
            "The sponsor's https site; EarnKit verifies the domain via /.well-known/earnkit.txt",
          ),
        title: z
          .string()
          .optional()
          .describe(`Up to ${TEXT_LIMITS.title.max} characters, one line`),
        what_to_build: z
          .string()
          .optional()
          .describe(
            `What builders should build (20 to ${TEXT_LIMITS.what_to_build.max} characters). "theme" is accepted as its old name`,
          ),
        theme: z.string().optional().describe('Old name of what_to_build'),
        criteria: z
          .string()
          .optional()
          .describe(
            `How the sponsor will pick winners (up to ${TEXT_LIMITS.criteria.max} characters). Default: "<sponsor_name> picks the most useful entries"`,
          ),
        chains: z
          .array(z.enum(CHAINS))
          .optional()
          .describe('Default: ["base"]'),
        token: z
          .string()
          .optional()
          .describe('USDC (the default), or another allowlisted token'),
        amount: z
          .string()
          .optional()
          .describe('Pool size in tokens, e.g. "5000"; at least 50 USDC'),
        winners: z
          .union([
            z.number().int(),
            z.array(z.number().int()),
            z.array(
              z.object({
                entry_id: z.number().int(),
                amount: z.string(),
                reason: z.string().optional(),
              }),
            ),
          ])
          .optional()
          .describe(
            'create: planned number of winners (default 3); award: entry ids in ranked order, or [{entry_id, amount, reason?}]',
          ),
        split: z
          .union([z.literal('equal'), z.array(z.number().int())])
          .optional()
          .describe(
            'award with a ranking: "equal" (default) or whole percentages per winner, first place first, adding up to 100',
          ),
        existing_work: z
          .enum(['allowed', 'new_work_only'])
          .optional()
          .describe('Default: allowed'),
        token_policy: z
          .enum(['encouraged', 'allowed', 'off'])
          .optional()
          .describe(
            'Whether builders\' entries get a token by default at submission: encouraged (default) or allowed (both on by default, builder can skip), or off.',
          ),
        starts_at: z.string().optional(),
        ends_at: z
          .string()
          .optional()
          .describe('ISO 8601, 3 to 90 days out. Default: 14 days from now'),
      },
    },
    (input) => run(ctx, 'sponsor_campaign', input),
  );
}
