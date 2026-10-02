# Code Map — where everything lives

```
contracts/                     Foundry project (v2.1 sponsor escrow; not part of the Next build)
  foundry.toml                 solc 0.8.28, evm cancun, remappings, fuzz/invariant runs
  src/EarnKitCampaigns.sol     factory: config (timelocked owner), createCampaign, pause
  src/EarnKitCampaign.sol      one clone per campaign: award, refund (snapshots operator/treasury)
  test/mocks/MockERC20.sol     6-decimal mintable token; FeeOnTransferERC20 (rejected by createCampaign)
  test/Base.t.sol              shared setup (factory, tokens, actors, helpers)
  test/EarnKitCampaigns.t.sol, test/EarnKitCampaign.t.sol   factory + clone unit tests
  test/invariant/              Handler.sol + Invariants.t.sol: money only moves by the rules
  test/halmos/                 Halmos.t.sol: symbolic checks (flattened contracts)
  test/fork/BaseUsdc.t.sol     real Base USDC on a mainnet fork
  script/Deploy.s.sol          timelock + factory deploy (owner's wallet signs)
  script/export-abi.sh         writes apps/frontend/lib/earnkit/escrow-abi.ts
  README.md                    how to test, analyze (Slither/Halmos/Aderyn), deploy
programs/                      program files (+ README: how Claude Code adds programs/starters)
apps/frontend/
  app/page.tsx                 home: hero, investors, footer
  app/components/sections/AddToAgent.tsx   "Add to your agent" install panel (opened from the hero)
  app/campaigns/[slug]/page.tsx  campaign leaderboard (404 unless the program has a campaign)
  app/p/[id]/page.tsx          campaign entry page
  app/fund/[ref]/{page.tsx,FundClient.tsx}   sponsor deposit page: shows pool/prize/fee, sends
                               approve + createCampaign from the sponsor's browser wallet
  app/award/[ref]/{page.tsx,AwardClient.tsx} sponsor award page: shows the stored plan, sends
                               the award tx from the sponsor's browser wallet
  app/api/sponsor/[ref]/confirm/route.ts  POST {tx} -> confirmTx (funding or award, by the receipt's
                               contents); 503 when the escrow isn't configured
  app/sponsor-terms/page.tsx   sponsor terms (linked from the fund page)
  app/api/projects/[id]/image/ serves a token image the agent uploaded (launch_token image_data)
  app/mcp/route.ts             hosted MCP server (Streamable HTTP, stateless, Bearer token)
  app/oauth/{register,authorize,token}/   anonymous OAuth for MCP clients
  app/.well-known/             OAuth discovery metadata
  lib/earnkit/
    db.ts                      postgres.js pool (DATABASE_URL)
    program-file.ts            zod format of programs/*.json (+ starter limits)
    programs.ts(+test)         list/get/upsert programs (source: 'file' | 'sponsor'); build_help
                               (kits/starter + one start command), trust() (verified_at: skip
                               re-reading sources within 7 days)
    submission.ts(+.test.ts)   prepareSubmission (pure)
    projects.ts                recordSubmission
    installations.ts           save / touch installation by token hash; memory (GitHub, working_on)
    oauth.ts(+.test.ts)        stateless OAuth: register, authorize, code -> token, metadata
    mcp.ts(+test)              MCP server: the 5 builder tools, plus sponsor_campaign only when the
                               escrow is configured; descriptions and schemas
    present.ts(+test)          builder-facing text for list_programs: your repos' fits, then "Also open",
                               one line per program, who-does-what said once
    match.ts(+test)            pure: chain detection (IDs + RPC hosts), repo x program verdicts
    match-projects.ts          repo matching for list_programs + get_program's eligibility check
                               (public GitHub reads, GITHUB_TOKEN)
    http.ts                    CORS + small response helpers
    tools.ts                   tool name -> handler + input validation (+ caller's installation);
                               includes sponsor_campaign (create/status/award)
    tokens.ts(+test)           launch_token via tokens.fun /api/v1/deploy (TOKENSFUN_DEPLOY_API_KEY)
    campaigns.ts(+test)        CampaignConfig union ('earnkit' | 'sponsor'), minScore/prizeText/wonText,
                               entry checks (contracts optional for 'sponsor'), unique_wallets scoring
                               (Base Blockscout + Base RPC), "Your campaign entries" text
    leaderboard.ts             data for the leaderboard and entry pages (incl. sponsor award_onchain)
    escrow.ts                  read-only escrow client: chain/token config (ESCROW_*, validated by
                               escrowConfigProblem/escrowEnabled, which gate the sponsor tool), builds
                               approve/createCampaign/award transactions, decodes CampaignCreated
                               and Awarded from receipts. The server never signs a transaction.
    escrow-abi.ts               generated by contracts/script/export-abi.sh; campaignsAbi/campaignAbi
    sponsor-rules.ts(+test)    pure rules: draft validation (checkDraft/toUnits), the 90/10
                               pool/prize split (splitUnits), the program file sponsors get
                               (sponsorProgramFile), award planning (planAward), matching an
                               onchain award back to entries (matchAwardToPlan, mapOffPlanAward)
    sponsor.ts(+test)          DB + chain: createSponsorDraft, loadCampaign (lazy 7-day draft
                               expiry), confirmFunding/confirmAward (atomic, row-locked, idempotent;
                               confirmFunding also rescues an expired draft a late receipt proves was
                               funded), confirmTx + routeReceipt/fundingDecision (route a tx by
                               its receipt; re-confirm live; flag a second escrow for the same
                               ref), sponsorStatus (survives a scoring failure), prepareAward
                               (guarded UPDATE so it can't clobber an already-awarded plan)
  db/schema.sql                the whole schema, idempotent (sponsor_campaigns, projects.prize_*)
  scripts/                     db-migrate.mts, programs-sync.mts (load .env.local)
    campaign.mts                score|rank|payout (EarnKit's own campaigns) and
                                award|refund|sync (sponsor campaigns; operator-signed, local only;
                                sync --tx repairs, refund --escrow refunds an untracked escrow)
    sponsor-e2e.mts             full sponsor flow (draft -> fund -> entries -> award, plus the
                                operator CLI) against a local anvil + Postgres; `pnpm sponsor:e2e`
```

Root commands: `pnpm programs:check` (validate program files), `pnpm test`,
`pnpm campaign score|rank|payout <slug>` (EarnKit's own campaigns; payout is a dry run without
`--execute`), `pnpm campaign award|refund|sync <ref>` (sponsor campaigns; dry run without
`--execute`, needs `OPERATOR_PRIVATE_KEY`; `sync <ref> --tx <hash>` repairs from a receipt,
`refund <ref> --escrow <address>` refunds a specific escrow for that ref), `pnpm sponsor:e2e` (full sponsor flow on a local
anvil + Postgres, see `contracts/README.md` and `sponsor-e2e.mts`'s header for the exact env).
Railway runs `pnpm predeploy` (= `db:migrate` + `programs:sync`) before every deploy.
Env: `DATABASE_URL`, `EARNKIT_AUTH_SECRET`, `EARNKIT_URL` (public origin, prod only),
`GITHUB_TOKEN` (one server-side read-only token for repo matching), `TOKENSFUN_DEPLOY_API_KEY`
(tokens.fun deploy key for launch_token; `TOKENSFUN_API_URL` overrides the host for tests),
`BASE_RPC_URL` (optional; default public Base RPC). `PAYOUT_PRIVATE_KEY` is local only, never on
Railway.

Sponsor escrow (v2.1), also never on Railway's write path — the server only reads the chain:
`ESCROW_CHAIN` (`base` | `base-sepolia` | `local`), `ESCROW_FACTORY_ADDRESS`, `ESCROW_RPC_URL`
(falls back to `BASE_RPC_URL` on `base`), `ESCROW_LOCAL_TOKEN` (the mock token address, `local`
chain only). `OPERATOR_PRIVATE_KEY` is local only (used by `pnpm campaign award|refund`), never on
Railway.
