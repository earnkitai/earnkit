// Archived v2.12 (spec 9). Paste back into mcp.ts on restore (README.md, Restore).
// Needs `import { escrowConfigProblem } from './escrow';` in mcp.ts.
// 1. Put SPONSOR_CAMPAIGN_DESCRIPTION above toolDescriptions and add
//    `sponsor_campaign: SPONSOR_CAMPAIGN_DESCRIPTION,` to its returned object.
// 2. Put registerSponsorTool at the end of the file.
// 3. Put the registration block just before `return server;` in the server builder.

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


// --- registration block ---
  // Sponsor campaigns are offered only once EarnKit's escrow is configured on this deployment
  // (ESCROW_FACTORY_ADDRESS set, ESCROW_CHAIN valid). Until then the server has the 4 builder
  // tools, so no agent is ever offered a tool that can only fail.
  const escrowProblem = escrowConfigProblem();
  if (escrowProblem && process.env.ESCROW_FACTORY_ADDRESS)
    // Partially configured: say so in the logs (a typo in ESCROW_CHAIN, say), without exposing it.
    console.error(`[sponsor] sponsor_campaign disabled: ${escrowProblem}`);
  if (!escrowProblem) registerSponsorTool(server, ctx);


// --- registerSponsorTool ---
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
