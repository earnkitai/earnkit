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
  app/campaigns/[slug]/page.tsx  campaign leaderboard (404 unless the program has a campaign; 404 for
                               a taken-down sponsor campaign or a closed EarnKit campaign with no
                               entries). Sponsor kind: "Sponsored · unverified" / "Sponsored ·
                               verified <host>" header, the sponsor wallet's track record, and a
                               plain entry list (links + status, no rank or wallets) until some
                               entry is scored
  app/p/[id]/page.tsx          campaign entry page (rank only when ranked; status via entryStatus)
  app/fund/[ref]/{page.tsx,FundClient.tsx}   sponsor deposit page (noindex; sponsor label): shows pool/prize/fee, sends
                               approve + createCampaign from the bound sponsor wallet only, checks
                               the chain on load and polls /check after sending (the open page
                               disables the deposit 10 minutes before the deadline)
  app/award/[ref]/{page.tsx,AwardClient.tsx} sponsor award page (noindex; sponsor label): shows the stored plan (each winner's
                               project name, entry, wallet, reason) and EarnKit's fee, sends the
                               award tx from the bound sponsor wallet only; "Done" once /check reads it
  app/api/sponsor/[ref]/check/route.ts  POST (no body) -> checkChain: reads the chain for the bound
                               wallet's deposit or the escrow's award; {state, campaign_url, paid,
                               problem}; 60/min per IP (429); 503 when the escrow isn't configured
  app/components/wallet.ts     browser wallet: useAccount (eth_accounts + accountsChanged), sendAll
                               (from the bound wallet only), pollCheck (every 3 s, up to 2 min)
  app/components/WalletGate.tsx  shows a page's action only for the bound wallet, else "Connect
                               0xABCD…1234 to continue"
  app/sponsor-terms/page.tsx   sponsor terms (linked from the fund page)
  app/api/projects/[id]/image/ serves a token image the agent uploaded (launch_token image_data)
  app/mcp/route.ts             hosted MCP server (Streamable HTTP, stateless, Bearer token)
  app/oauth/{register,authorize,token}/   anonymous OAuth for MCP clients
  app/.well-known/             OAuth discovery metadata
  lib/earnkit/
    db.ts                      postgres.js pool (DATABASE_URL)
    dates.ts(+test)            formatDeadline: the one human date format ("Oct 6, 2026, 06:51 UTC");
                               machine fields stay ISO
    cli.ts(+test)              pure helpers for scripts/campaign.mts: USAGE, cliErrorLine (one
                               readable line per error), operatorKeyProblem, fallbackProblem
    program-file.ts            zod format of programs/*.json (+ starter limits, optional max_award_usd)
    programs.ts(+test)         list/get/upsert programs (source: 'file' | 'sponsor'); build_help
                               (kits/starter + one start command), trust() (verified_at: skip
                               re-reading sources within 7 days), trustFor (sponsor programs: an
                               escrow note, no verified_at), perWinnerUsd (tie-break amount); programCard/
                               programDetails (pure): sponsor campaigns get quoted title/name,
                               generic rules and a neutral description, their own text only
                               in sponsor_content
    submission.ts(+.test.ts)   prepareSubmission, prefillPayoutWallet (pure)
    projects.ts(+test)         recordSubmission (campaigns: no self-entry, required fields
                               (missingAnswersProblem), sanctions, ownership proof; one entry per
                               repo and per contract, checked under a per-campaign advisory lock;
                               stores repo_key, backed by the unique index projects_campaign_repo_key;
                               remembers installations.payout_wallet)
    ownership.ts(+test)        builder ownership proof: earnkit.txt at the repo root (raw GitHub,
                               5 s, 4 KB, no redirects; EARNKIT_OWNERSHIP_BASE_URL in dev/test only):
                               parseOwnershipFile, githubRepo, ownershipProblem (pure),
                               deployerOf (creation tx sender), checkOwnership (fetcher and
                               Blockscout DeployerLookup injectable; recordSubmission passes deps
                               through for the e2e)
    sanctions.ts(+test)        Chainalysis isSanctioned oracle on Base mainnet only (skipped with a
                               note elsewhere; injectable): screenWallet (entry, create),
                               screenWinners (award plans), fails closed
    untrusted-text.ts(+test)   the one sanitizer for sponsor/builder text (cleanText: NFKC, then an
                               allowlist of letters/numbers/fixed punctuation/emoji, quotes -> ',
                               reject links incl. defanged/IP/confusable-dot/bare domains and HTML
                               entities, TEXT_LIMITS), SponsorUrl, untrusted() (zod), cleanProject
                               (campaign entries), quoted() (sponsor names/titles in EarnKit's
                               sentences), SAFETY_LINES (server instructions + tool descriptions)
    sponsor-text.ts            client-safe sponsor texts (DEADLINE_PASSED, DRAFT_EXPIRED, the fixed
                               FUND_WARNING / AWARD_PROVENANCE scam copy, awardWarnings: red flags
                               for a winner that is the sponsor or a repeated wallet) and the
                               10-minute deadline margin (used by sponsor.ts and FundClient)
    safe-fetch.ts(+test)       SSRF-safe GET (safeFetchText): https on 443, domain names only, DNS
                               resolved once via a cancellable c-ares Resolver (not dns.lookup) and every address public (isPublicAddress: IPv4
                               special-purpose ranges; IPv6 only 2000::/3 minus special ranges, so
                               mapped/NAT64/6to4 are refused), connects to the vetted IP with SNI,
                               cert check and Host on the hostname (pinnedLookup), no redirects, 5 s,
                               4 KB; resolver and transport injectable
    sponsor-identity.ts(+test) pure: sponsorLabel ("Sponsored · unverified" / "Sponsored · verified
                               <host>"), earnkitTxtNames (earnkit.txt parsing), reserved brand
                               names (reservedBrands/reservedNameProblem: confusable skeleton,
                               whole words incl. split letters; brand -> official domains),
                               mixedScriptProblem, trackRecordOf/trackRecordText (100+ USDC pools;
                               sponsor-made awards apart from fallback and self-paid)
    confusables.ts(+test)      pure: skeleton (NFKD, marks dropped, UTS #39 look-alikes + stroke
                               letters -> ASCII) and mixedScriptWords
    confusables-table.ts       generated (scripts/gen-confusables.mts) from Unicode confusables.txt
    sponsor-verify.ts(+test)   domain verification over safe-fetch, cached in sponsor_verifications
                               (24 h pass, 1 h failure): verifySponsor, domainCheck (create/status),
                               sponsorIdentity (funded campaigns only; pages, campaign sync),
                               cachedIdentities (cache only; list_programs, get_program), trackRecord
    rate-limit.ts(+test)       minimal Postgres fixed-window counter (rate_windows) + clientIp
                               (rightmost x-forwarded-for); /check allows 60 per IP per minute
    installations.ts           save / touch installation by token hash; memory (GitHub, working_on,
                               last payout wallet)
    oauth.ts(+.test.ts)        stateless OAuth: register, authorize, code -> token, metadata
    mcp.ts(+test)              MCP server: the 5 builder tools, plus sponsor_campaign only when the
                               escrow is configured; descriptions and schemas
    present.ts(+test)          builder-facing text for list_programs: your repos' fits, then "Also open",
                               one line per program, who-does-what said once; equally quick fits
                               ordered by the larger known per-winner award (byFit); unverified
                               sponsor campaigns are never "Fastest" or the closing offer and sort
                               last in "Also open"
    match.ts(+test)            pure: chain detection (IDs + RPC hosts), repo x program verdicts
    match-projects.ts          repo matching for list_programs + get_program's eligibility check
                               (public GitHub reads, GITHUB_TOKEN)
    http.ts                    CORS + small response helpers
    tools.ts                   tool name -> handler + input validation (+ caller's installation);
                               includes sponsor_campaign (create/status/award)
    tokens.ts(+test)           launch_token via tokens.fun /api/v1/deploy (TOKENSFUN_DEPLOY_API_KEY)
    campaigns.ts(+test)        CampaignConfig union ('earnkit' | 'sponsor'), minScore/prizeText/wonText,
                               entry checks (contracts optional for 'sponsor'; isWalletAddress:
                               mixed-case payout wallets must be EIP-55), normalizeRepoUrl/
                               sameRepoEntry (repo dedupe), unique_wallets scoring (Base Blockscout +
                               Base RPC), entryStatus (public status), "Your campaign entries" text
                               (sponsor entries: state-based, no rank unless scored)
    leaderboard.ts             data for the leaderboard and entry pages (incl. sponsor state and
                               award_onchain), yourCampaignEntries (list_programs), entryNames
    escrow.ts                  read-only escrow client: chain/token config (ESCROW_*, validated by
                               escrowConfigProblem/escrowEnabled, which gate the sponsor tool), builds
                               approve/createCampaign/award transactions; chain reads: chainReader
                               (EscrowReader: campaignOf, clone facts), readEscrow (state + pending
                               fallback), readAwardedLog (+ awardSearchFrom). Never signs.
    escrow-abi.ts               generated by contracts/script/export-abi.sh; campaignsAbi/campaignAbi
    sponsor-rules.ts(+test)    pure rules: draft validation (checkDraft/toUnits), the 90/10
                               pool/prize split (splitUnits), the program file sponsors get
                               (sponsorProgramFile), award planning (planAward), matching an
                               onchain award back to entries (matchAwardToPlan, mapOffPlanAward),
                               and the sponsor's replies (createReply/statusReply/awardReply:
                               show_to_sponsor + next_step)
    sponsor.ts(+test)          DB + chain: createSponsorDraft (binds sponsor_wallet), loadCampaign
                               (lazy draft expiry: 7 days unfunded, or under 10 minutes to the
                               deadline; draftExpiry), checkChain = findFunding (matchFunding over
                               campaignOf(wallet, ref); row-locked publish; rescues expired drafts)
                               + findAward (Awarded log -> recordAward vs plan / fallback_plan /
                               off-plan; Refunded -> refunded), excludedWinners (all escrow clones,
                               sponsor wallet, token, factory), sponsorStatus (survives scoring and
                               RPC failures), prepareAward (guarded UPDATE)
  db/schema.sql                the whole schema, idempotent (sponsor_campaigns, projects.prize_*,
                               projects.repo_key + its partial unique index, sponsor_verifications)
  scripts/                     db-migrate.mts, programs-sync.mts (load .env.local)
    campaign.mts                score|rank|payout (EarnKit's own campaigns) and
                                fallback propose|execute|veto, refund, sync [<ref>] (sponsor
                                campaigns; local only; sync reads the chain for one ref or sweeps
                                draft/expired/live; refund --escrow refunds a stray escrow);
                                errors are one line + exit 1; propose refuses before endsAt + 7
                                days onchain, refund names who gets the money
    sponsor-e2e.mts             full sponsor flow (wallet-bound draft -> fund -> status finds it ->
                                entries -> award read onchain; front-run and wrong-amount deposits,
                                fallback propose/re-propose/execute and propose/veto, the operator
                                CLI, entry statuses, sponsor replies without hashes) against a local
                                anvil + Postgres; `pnpm sponsor:e2e`
```

Root commands: `pnpm programs:check` (validate program files), `pnpm test`,
`pnpm campaign --help`, `pnpm campaign score|rank|payout <slug>` (EarnKit's own campaigns; payout is a dry run without
`--execute`), `pnpm campaign fallback propose|execute|veto <ref>`, `refund <ref>` (sponsor
campaigns; dry run without `--execute`; `OPERATOR_PRIVATE_KEY`, the veto `GUARDIAN_PRIVATE_KEY`;
`refund <ref> --escrow <address>` refunds a stray escrow for that ref), `pnpm campaign sync [<ref>]`
(reads the chain and updates the database: one campaign, or every draft/expired/live one), `pnpm sponsor:e2e` (full sponsor flow on a local
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
chain only). `OPERATOR_PRIVATE_KEY` (fallback propose/execute, refund) and `GUARDIAN_PRIVATE_KEY`
(fallback veto) are local only, never on Railway.
