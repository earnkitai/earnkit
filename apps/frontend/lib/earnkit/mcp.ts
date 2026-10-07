import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodError, z } from 'zod';
import { CHAINS } from './match';
import { GitHubError } from './match-projects';
import { NotFoundError } from './programs';
import { EntryError } from './campaigns';
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
    throw err;
  }
}

const TO_LAUNCH =
  "To launch, pass token with the name and symbol the builder confirmed (token.proposed from prepare_submission, or their changes); 'skip' if they said no token.";
/** v2.6 §3: what a coin needs in the repo; exported for tests. */
export const OWNERSHIP_FOR_TOKEN =
  'A token needs earnkit.txt at the repo root with the line "token: <code>": the exact line EarnKit gives you ' +
  "(prepare_submission's token_line once it knows the repo_url, or token.agent_note on gate_failed). Write and push it " +
  'yourself; never ask the builder to edit files. It is bound to you and the repo; never reuse a line from ' +
  'someone else. One token per repo.';

const LIST_PROGRAMS_DESCRIPTION =
  'What can I earn? Use for any question about earning, programs, rewards, or what to build. ' +
  "First read the builder's local git remotes (git remote -v in their project folders) and pass " +
  'them as local_repos with what you see (chains, mainnet, live link, last commit); never ask for ' +
  'a GitHub username first (github_user is optional). EarnKit remembers them for later calls. ' +
  'Returns show_to_builder: show it exactly as written, with no extra summary or advice. ' +
  'It leads with "EarnKit matches you to $X in prizes you qualify for" when their repos fit, ' +
  'or "$X in prizes open right now" with ideas you can build when there is no repo. Every program shows ' +
  'its difficulty; the token and builder bonus line closes the message. ' +
  'matches lists, per repo and program, what is missing (live_url, mainnet_deploy, new_work, ' +
  'real_users) and the effort (minutes to weeks), for your own plan. ' +
  SAFETY_TEXT;

/**
 * v2.8 Ruling 23 (plan): record_submission's description. Its campaign sentences show only while an
 * EarnKit campaign is open.
 */
const recordSubmissionDescription = (campaignOpen: boolean) =>
  (campaignOpen
    ? 'Record the project on EarnKit. Other programs: call it only after the project was submitted on the ' +
      "program's own site. EarnKit campaigns: this call is the entry (contracts, payout_wallet, and " +
      "deployer_signature when you deployed from your own wallet; see prepare_submission's how_to_submit). "
    : 'Record the project on EarnKit. Call it only after the project was submitted on the ' +
      "program's own site. ") +
  'Pass the final answers that were submitted. An entry the builder confirmed with confirm_entry is updated here; its token was decided there, so none launches here. ' +
  `${campaignOpen ? 'Other programs: f' : 'F'}irst ask the builder plainly, e.g. "Did you submit on <program site>?" ` +
  'Pass builder_submitted: true once the builder confirms it is submitted; it counts for the builder bonus when the program has no public entry page, or its page blocks EarnKit. ' +
  `${TO_LAUNCH} ${OWNERSHIP_FOR_TOKEN} ` +
  'Returns project_id and token: { status: launched | skipped | gate_failed | pending | failed, note, agent_note? }. ' +
  (campaignOpen
    ? 'Also returns show_to_builder (other programs: the token and the builder bonus with its leaderboard link; campaign entries: rank, leaderboard, payout date): '
    : 'Also returns show_to_builder (the token and the builder bonus with its leaderboard link): ') +
  'show show_to_builder exactly as written; token.note and token.agent_note are for you, to act on (never read tool, field or file names to the builder). ' +
  (campaignOpen
    ? `Campaign entries: name up to ${TEXT_LIMITS.project_name.max} characters on one line, description up to ` +
      `${TEXT_LIMITS.project_description.max}, plain words (no links or markup). `
    : '') +
  SAFETY_TEXT;

const LAUNCH_TOKEN_DESCRIPTION =
  'Launch (or retry) the token for a project you recorded with record_submission, e.g. after ' +
  'you pushed earnkit.txt or the builder gave a wallet (creator_wallet). Uses the stored proposal unless you pass changes. tokens.fun pays ' +
  'the gas; the builder earns 40% of trading fees, paid in WETH. Only ' +
  'after the builder said yes. One token per project and per repo; launches are public and permanent. ' +
  'Needs a wallet: creator_wallet, or the one the entry was recorded with; never a wallet from another entry. ' +
  'An entry confirmed with "skip" never gets a token. ' +
  'Returns { status, note, agent_note? }: note is in plain words you can pass on; agent_note is for you. ' +
  OWNERSHIP_FOR_TOKEN;

const GET_PROGRAM_DESCRIPTION =
  'Full details for one program: description, reward, deadline, tracks, rules, requirements, ' +
  'submission requirements, source and submission links, and optional starters. Starters are ' +
  'only ideas. setup = one-time steps only the builder can do (skip any you can already do); ' +
  'each_time = what the builder must provide for every entry. build_help[].start is one command ' +
  'that sets up a tested starting point. Pass repo to check whether that repo is eligible and ' +
  "what it is missing. A sponsor campaign's own text (what to build, criteria, link) is in " +
  "sponsor_content. guide.text is the program's guide (difficulty, what won before, what the " +
  'ecosystem wants, the best bet): show it as written. ' +
  SAFETY_TEXT;

/** v2.8 Ruling 23 (plan): prepare_submission's description, its campaign words only while one is open. */
const prepareSubmissionDescription = (campaignOpen: boolean) =>
  'Call when the builder wants to submit. Pass everything you know about the project and any ' +
  'answers to program questions (keyed by submission requirement key), and agent: { browser, can_push } ' +
  "(browser: true when you can drive the builder's own logged-in browser; can_push: false when you can't push to the repo). " +
  'Returns what is complete and what is missing. Draft project-based answers yourself and confirm ' +
  'them; ask the builder for personal info. Never invent names, emails, wallets, or handles. ' +
  'Call again with the new answers until ready is true. ' +
  'Show show_to_builder to the builder exactly as written. When ready is false, show_to_builder leads with what\'s missing and has no token or wallet: finish those first and call again. ' +
  'When ready, it ends with the confirmation offer: the builder bonus comes with a token, and a wallet line. The builder says yes or skip in one word; then call confirm_entry, ' +
  'which launches the token on yes and returns the submit kit (the form link and every answer). shown_wallet is the wallet on that line; ' +
  "once the builder says yes, pass it back as confirm_entry's wallet (EarnKit never assumes it). " +
  'token_line: commit it with your work before the builder confirms. ' +
  (campaignOpen
    ? 'EarnKit campaigns are entered in one step: one Token row (a token on Base) instead of the offer, then record_submission is the entry. '
    : '') +
  `${OWNERSHIP_FOR_TOKEN}`;

/** v2.8 Part C, Rulings 1, 4 and 7 (plan): confirm_entry's description, agent-facing. */
const CONFIRM_ENTRY_DESCRIPTION =
  'The confirmation step, once prepare_submission says ready (not for EarnKit campaigns). Pass the same program_id, project and answers. ' +
  "Call it with builder_confirmed: true and decision: 'go' once the builder says yes: the token launches now. " +
  "decision: 'skip' only when the builder says skip: no token and no builder bonus for this entry. " +
  "Also pass wallet (the shown_wallet the builder confirmed, or the wallet they named instead; never one they didn't see), " +
  'token: { name, symbol } only when the builder changed the proposed token, and agent: { browser, can_push }. ' +
  'Without builder_confirmed and a decision it returns the offer to show. ' +
  'A problem you can fix now (no wallet, a taken ticker, the token line not pushed yet, a failed read) returns token.fixable: true and no kit: ' +
  'show show_to_builder, fix it, and call confirm_entry again. ' +
  'Otherwise the reply has kit: the submit kit (form link, every answer in form order, how to prove the entry). The kit is only in this reply; never show a kit any other way. ' +
  'If required answers are still missing, the token still launches and the kit lists them first, as blanks: fill them with the builder before they submit. ' +
  'Show show_to_builder exactly as written; token.note and agent_note are for you. ' +
  'Once the builder has submitted, call record_submission (it updates this entry).';

const SPONSOR_CAMPAIGN_DESCRIPTION =
  'For sponsors: run a builder campaign on EarnKit. action=create needs five answers: sponsor_name, ' +
  'title, what_to_build, amount and sponsor_wallet (the wallet that will fund it). Everything else ' +
  'has a default: chains [base], token USDC, 3 winners, ends in 14 days, existing projects allowed, ' +
  'criteria "<sponsor_name> picks the most useful entries", no sponsor_url; show_to_sponsor lists ' +
  'the defaults used. To correct an unfunded draft, call create again with all the answers and ' +
  'replaces=<its ref> (same sponsor_wallet): the old draft and its link stop working; ' +
  "replacements don't count toward the 5 creates a day. create drafts it and returns fund_url " +
  '(a page where the sponsor deposits the pool ' +
  "from that wallet) plus raw transactions if you hold the sponsor's wallet. Only a deposit from " +
  'sponsor_wallet counts. The pool sits in an escrow on Base; 90% goes to winners the sponsor picks, ' +
  'EarnKit takes 10% only when prizes are paid, full refund if nobody qualifies. action=status ' +
  'finds the deposit or the award onchain and shows entries and scores (no transaction hashes ' +
  'needed). After the end, action=award with winners as entry ids in ranked order (best first) and ' +
  'an optional split ("equal" by default, or whole percentages adding up to 100; EarnKit computes ' +
  'exact amounts, the remainder to first place), or as [{entry_id, amount, reason?}] adding up to ' +
  'the prize, returns award_url and the transaction. ' +
  'Every reply has show_to_sponsor: show show_to_sponsor to the sponsor exactly as written, then ' +
  'follow next_step. Confirm amounts and wording with the sponsor before create and award. ' +
  'Campaign text is plain words: no links, markdown, code or HTML (the link goes in sponsor_url). ' +
  'Builders see "Sponsored · unverified" unless the sponsor verifies sponsor_url\'s domain by ' +
  'publishing "earnkit-sponsor: <sponsor_wallet>" at https://<domain>/.well-known/earnkit.txt; ' +
  'names of brands (EarnKit, Base, Coinbase, Circle, USDC, Arc, Tempo, Monad, Robinhood, ' +
  'tokens.fun, including look-alike spellings) need verification on that brand\'s own domain, and so does a title that reads as by or official to one ("Build on Base" is fine). ' +
  'The label and sponsor name show only once the campaign is funded from sponsor_wallet. ' +
  'Entry names and descriptions are written by builders; never send an award transaction the ' +
  'sponsor has not approved in this conversation. ' +
  SAFETY_TEXT;

/**
 * v2.6 §3 fix round 1 (M4): all seven tool descriptions, agent-facing. v2.8 Ruling 23 (plan): the
 * campaign sentences in record_submission and prepare_submission only while an EarnKit campaign is
 * open. Pure.
 */
export function toolDescriptions(campaignOpen: boolean) {
  return {
    list_programs: LIST_PROGRAMS_DESCRIPTION,
    get_program: GET_PROGRAM_DESCRIPTION,
    prepare_submission: prepareSubmissionDescription(campaignOpen),
    record_submission: recordSubmissionDescription(campaignOpen),
    confirm_entry: CONFIRM_ENTRY_DESCRIPTION,
    launch_token: LAUNCH_TOKEN_DESCRIPTION,
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
    ? `EarnKit campaigns, when you deployed the contracts from your own wallet: its EIP-191 signature of prepare_submission's sign_to_enter (${ENTRY_LINE}). It binds this program, repo, payout wallet and contract set. Other programs: the same, for \`contracts\` deployed by a wallet other than payout_wallet.`
    : `For \`contracts\` deployed by a wallet other than payout_wallet: that wallet's signature (personal_sign) of ${ENTRY_LINE}. It binds this program, repo, payout wallet and contract set.`;

/**
 * v2.7 §4: the MCP server's instructions, agent-facing. v2.8 Task 5 fix round 1 (Ruling 23): the
 * campaign sentence only while an EarnKit campaign is open. Pure.
 */
export function serverInstructions(campaignOpen: boolean) {
  return [
    'EarnKit finds live grants and hackathons a builder can win, helps them write strong applications, and gives every entry a token whose fees fund the builder bonus.',
    'When a tool returns show_to_builder (or show_to_sponsor), show it exactly as written.',
    'When a reply has since_you_last_checked, show it to the builder first, as written.',
    'When the builder picks a program: ask for its setup steps once, do everything else yourself, and confirm once before the final submit.',
    campaignOpen
      ? "Other programs: before record_submission, ask the builder 'Did you submit on <program site>?' and, when the site gives each entry a public page, ask for that entry link and pass it as external_submission_url. EarnKit campaigns: record_submission is the entry; there is no other site."
      : "Before record_submission, ask the builder 'Did you submit on <program site>?' and, when the site gives each entry a public page, ask for that entry link and pass it as external_submission_url.",
    'Every entry gets a token by default. The builder confirms once: "yes" launches the token and returns the submit kit; "skip" means no token and no builder bonus. Push the token line from prepare_submission with your work, before the builder confirms.',
    "EarnKit remembers the wallet and shows it next time: confirm it, never ask again from scratch. Pass the wallet shown (shown_wallet) back as confirm_entry's wallet. Write and push earnkit.txt yourself; never ask the builder to edit files.",
    'Never name EarnKit tools, fields or files to the builder; say what happens in plain words.',
    'Never invent personal details.',
    ...SAFETY_LINES,
  ].join('\n');
}

/** Every instruction with its campaign sentence; exported for the copy-review test. */
export const SERVER_INSTRUCTIONS = serverInstructions(true);


/**
 * The EarnKit MCP server for one connected agent (installation). `campaignOpen` (v2.8 Ruling 23
 * (plan), default false): whether an EarnKit campaign is open, read by the route.
 */
export function createMcpServer(ctx: ToolContext, opts: { campaignOpen?: boolean } = {}): McpServer {
  const descriptions = toolDescriptions(opts.campaignOpen ?? false);
  const server = new McpServer(
    { name: 'earnkit', version: '1.0.0' },
    // MCP sends instructions once, in the initialize response. The route builds a server per
    // request (stateless), so each session's initialize carries the campaignOpen read for it.
    { instructions: serverInstructions(opts.campaignOpen ?? false) },
  );

  server.registerTool(
    'list_programs',
    {
      description: LIST_PROGRAMS_DESCRIPTION,
      inputSchema: {
        github_user: z
          .string()
          .optional()
          .describe("The builder's GitHub username"),
        wallet: z
          .string()
          .optional()
          .describe("The builder's wallet, if they named one: its wins show here even from a new connection"),
        repos: z
          .array(z.string())
          .optional()
          .describe('Or specific "owner/repo" or github.com links'),
        local_repos: z
          .array(
            z.object({
              name: z.string(),
              chains: z
                .array(
                  z.object({
                    chain: z.enum(CHAINS),
                    mainnet: z.boolean(),
                  }),
                )
                .describe(
                  'Chains the code targets; mainnet false = testnet only',
                ),
              live_url: z.string().optional(),
              last_commit_at: z.string().optional().describe('ISO 8601'),
              url: z
                .string()
                .optional()
                .describe("The repo's GitHub link, if the local remote is on GitHub"),
            }),
          )
          .optional()
          .describe(
            'Private or local repos you can see: report what you find. EarnKit never needs their code.',
          ),
        agent_can_build: z
          .boolean()
          .optional()
          .describe(
            'false if you cannot write code, deploy, and use a web browser in this session (default true)',
          ),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run(ctx, 'list_programs', input),
  );

  server.registerTool(
    'get_program',
    {
      description: GET_PROGRAM_DESCRIPTION,
      inputSchema: {
        program_id: z.string(),
        repo: z
          .string()
          .optional()
          .describe(
            '"owner/repo" or a github.com link to check eligibility for',
          ),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run(ctx, 'get_program', input),
  );

  server.registerTool(
    'prepare_submission',
    {
      description: descriptions.prepare_submission,
      inputSchema: {
        program_id: z.string(),
        project: project.optional(),
        answers: z
          .record(z.string(), z.string())
          .optional()
          .describe('Answers by submission requirement key.'),
        agent: AGENT.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run(ctx, 'prepare_submission', input),
  );

  server.registerTool(
    'confirm_entry',
    {
      description: CONFIRM_ENTRY_DESCRIPTION,
      inputSchema: z
        .object({
          program_id: z.string(),
          project: project.extend({ name: z.string() }),
          answers: z.record(z.string(), z.string()).describe('The final answers, by submission requirement key.'),
          decision: z
            .enum(['go', 'skip'])
            .optional()
            .describe("'go' when the builder said yes; 'skip' only when they said skip"),
          builder_confirmed: z.literal(true).optional().describe('The builder answered the confirmation offer'),
          token: z
            .object({ name: z.string().optional(), symbol: z.string().optional() })
            .strict()
            .optional()
            .describe('Only when the builder changed the proposed token'),
          wallet: z
            .string()
            .optional()
            .describe("The wallet the builder confirmed: shown_wallet, or the one they named instead"),
          agent: AGENT.optional(),
        })
        .strict(),
    },
    (input) => run(ctx, 'confirm_entry', input),
  );

  server.registerTool(
    'record_submission',
    {
      description: descriptions.record_submission,
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
        token: z
          .union([
            z.literal('skip'),
            z
              .object({
                name: z.string().optional(),
                symbol: z.string().optional(),
                image_url: z.string().optional(),
                image_data: z.string().optional(),
                creator_wallet: z.string().optional(),
                builder_x: z.string().optional(),
              })
              // Loose: echoing token.proposed verbatim (with its `image`) must never fail the
              // entry. EarnKit checks the fields in the token flow and names an unknown key.
              .passthrough(),
            // Anything else (a bare ticker, a list) reaches EarnKit, which skips the token with a
            // note instead of failing the entry.
            z.any(),
          ])
          .nullable()
          .optional()
          .describe(TO_LAUNCH),
        builder_confirmed: z
          .any()
          .optional()
          .describe(
            'true once the builder confirmed the summary that includes the token line',
          ),
        builder_submitted: z
          .boolean()
          .optional()
          .describe('true once the builder confirmed the entry is submitted on the program site'),
        deployer_signature: z
          .string()
          .optional()
          .describe(deployerSignatureDescription(opts.campaignOpen ?? false)),
        contracts: z
          .array(z.string())
          .max(5)
          .optional()
          .describe(
            `${opts.campaignOpen ? 'Other programs (not EarnKit campaigns), optional' : 'Optional'}: the project's Base contracts (up to 5).` +
            " Their real users count toward the builder bonus once verified: deployed by payout_wallet (or by the wallet that signed deployer_signature), with earnkit.txt naming payout_wallet. Unverified ones are dropped with a note; the submission never fails.",
          ),
        payout_wallet: z
          .string()
          .optional()
          .describe(
            `${opts.campaignOpen ? 'Other programs: the wallet' : 'The wallet'} the builder confirmed on prepare_submission's wallet line, i.e. its shown_wallet, passed back (the token's fees and any bonus; remembered for next time). EarnKit never uses a remembered wallet here: without one the entry is recorded with no token yet. With contracts, the Base wallet that deployed them.`,
          ),
      },
    },
    (input) => run(ctx, 'record_submission', input),
  );

  server.registerTool(
    'launch_token',
    {
      description: LAUNCH_TOKEN_DESCRIPTION,
      // Strict, so a misnamed key (say `ticker`) is an error, not silently dropped.
      inputSchema: z
        .object({
          project_id: z
            .number()
            .int()
            .describe('project_id returned by record_submission'),
          name: z
            .string()
            .optional()
            .describe(
              'Token name, up to 50 characters; default the stored proposal',
            ),
          symbol: z
            .string()
            .optional()
            .describe(
              'Ticker, 3 to 6 letters or digits; default the stored proposal',
            ),
          creator_wallet: z
            .string()
            .optional()
            .describe(
              "The builder's wallet that receives creator fees (and any builder bonus); default the entry's own wallet. Required when the entry was recorded without one: ask the builder, never reuse a wallet from another entry",
            ),
          image_url: z
            .string()
            .optional()
            .describe('https URL of the token image'),
          image_data: z
            .string()
            .optional()
            .describe(
              'Or the image you generated, as a data URL (PNG/JPEG/WebP/GIF, up to 1 MB). EarnKit hosts it.',
            ),
          builder_x: z
            .string()
            .optional()
            .describe("The builder's X handle or profile URL"),
          chain: z
            .enum(['base', 'robinhood', 'arbitrum'])
            .optional()
            .describe('Default base'),
          live_url: z
            .string()
            .optional()
            .describe(
              "A new live link for the project (e.g. the old one didn't load)",
            ),
          repo_url: z
            .string()
            .optional()
            .describe(
              'A new public GitHub repo link; not for campaign entries (their repo was proven at entry)',
            ),
          builder_confirmed: z
            .literal(true)
            .describe('The builder explicitly said yes to this launch'),
        })
        .strict(),
    },
    (input) => run(ctx, 'launch_token', input),
  );

  // Sponsor campaigns are offered only once EarnKit's escrow is configured on this deployment
  // (ESCROW_FACTORY_ADDRESS set, ESCROW_CHAIN valid). Until then the server has the 5 builder
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
