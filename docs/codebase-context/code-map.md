# Code Map — where everything lives

```
contracts/                     Foundry project (v2.1 sponsor escrow; not part of the Next build)
  foundry.toml                 solc 0.8.28, evm cancun, remappings, fuzz/invariant runs
  src/EarnKitCampaigns.sol     factory: config (timelocked owner), createCampaign, pause
  src/EarnKitCampaign.sol      one clone per campaign: award, refund (snapshots operator/treasury)
  test/mocks/MockERC20.sol     6-decimal mintable token; FeeOnTransferERC20 (rejected by createCampaign)
  test/mocks/E2EMocks.sol      v2.4 campaign e2e only: MockToken18 (mock MINI), Ping (an app),
                               MockSmartAccount (execute, fanOut), MockEntryPoint (getNonce +
                               UserOperationEvent; its code is set at the real v0.7 address)
  test/mocks/BonusMocks.sol    v2.5 bonus ledger anvil test only: MockWETH, MockFeeLocker (StoreTokens,
                               availableFees, claim), MockLpLocker (collectRewards / collectMany:
                               StoreTokens per slot then ClaimedRewards; tokenRewards)
  test/Base.t.sol              shared setup (factory, tokens, actors, helpers)
  test/EarnKitCampaigns.t.sol, test/EarnKitCampaign.t.sol   factory + clone unit tests
  test/invariant/              Handler.sol + Invariants.t.sol: money only moves by the rules
  test/halmos/                 Halmos.t.sol: symbolic checks (flattened contracts)
  test/fork/BaseUsdc.t.sol     real Base USDC on a mainnet fork
  script/Deploy.s.sol          timelock + factory deploy (owner's wallet signs)
  script/export-abi.sh         writes apps/frontend/lib/earnkit/escrow-abi.ts
  README.md                    how to test, analyze (Slither/Halmos/Aderyn), deploy
programs/                      program files (+ README: how Claude Code adds programs/starters)
.github/workflows/earnkit-cron.yml  v2.4: hourly (:15) POST https://earnkit.com/api/cron with the
                               CRON_SECRET repo secret (also workflow_dispatch)
apps/frontend/
  app/page.tsx                 home: hero, investors, footer
  app/components/sections/AddToAgent.tsx   "Add to your agent" install panel (opened from the hero)
  app/campaigns/[slug]/page.tsx  campaign leaderboard (404 unless the program has a campaign; 404 for
                               a taken-down sponsor campaign or a closed EarnKit campaign with no
                               entries). Sponsor kind: "Sponsored · unverified" / "Sponsored ·
                               verified <host>" header, the sponsor wallet's track record, and a
                               plain entry list (links + status, no rank or wallets) until some
                               entry is scored
                               EarnKit kind (v2.4): standing per entry, the review (top N with
                               evidence, removed entries and reasons), the payout wallet and its
                               live balance, the public pause note
  app/p/[id]/page.tsx          campaign entry page (rank only when ranked; status via entryStatus)
  app/api/cron/route.ts        v2.4: POST -> cronPost (Bearer CRON_SECRET; scoring, freeze, review,
                               payout, fee refresh)
  app/api/admin/veto/route.ts  v2.4: POST only -> vetoPost (form: slug, key, entry, reason)
  app/admin/veto/[slug]/page.tsx  v2.4: the owner's review (noindex, ?key= required, rate limited):
                               live balance, pause note, ranked entries with evidence, a Remove
                               form per entry
  app/fund/[ref]/{page.tsx,FundClient.tsx}   sponsor deposit page (noindex; sponsor label): shows pool/prize/fee, sends
                               approve + createCampaign from the bound sponsor wallet only (one
                               signature when the wallet supports EIP-5792 atomic batching), checks
                               the chain on load and polls /check after sending (the open page
                               disables the deposit 10 minutes before the deadline)
  app/award/[ref]/{page.tsx,AwardClient.tsx} sponsor award page (noindex; sponsor label): shows the stored plan (each winner's
                               project name, entry, wallet, reason) and EarnKit's fee, sends the
                               award tx from the bound sponsor wallet only; "Done" once /check reads it
  app/api/sponsor/[ref]/check/route.ts  POST (no body) -> checkChain: reads the chain for the bound
                               wallet's deposit or the escrow's award; {state, campaign_url, paid,
                               problem}; 60/min per IP (429); 503 when the escrow isn't configured
  app/components/wallet.ts     browser wallet: useAccount (eth_accounts + accountsChanged), sendAll
                               (in order, from the bound wallet only), sendBatched (fund page:
                               getCapabilities -> one wallet_sendCalls batch if atomic, else in
                               order), pollCheck (every 3 s, up to 2 min)
  app/components/WalletGate.tsx  shows a page's action only for the bound wallet, else "Connect
                               0xABCD…1234 to continue"
  app/sponsor-terms/page.tsx   sponsor terms (linked from the fund page)
  app/api/projects/[id]/image/ serves a token image the agent uploaded (token image_data)
  app/api/projects/[id]/token-image/  the default token logo: a 512x512 next/og PNG monogram of the
                               stored ticker (validated A-Z0-9 only) on a colour from the project id;
                               the link carries ?s=SYMBOL and 404s unless it matches the stored ticker
  app/mcp/route.ts             hosted MCP server (Streamable HTTP, stateless, Bearer token)
  app/oauth/{register,authorize,token}/   anonymous OAuth for MCP clients
  app/.well-known/             OAuth discovery metadata
  lib/earnkit/
    db.ts                      postgres.js pool (DATABASE_URL)
    dates.ts(+test)            formatDeadline: the one human date format ("Oct 6, 2026, 06:51 UTC");
                               machine fields stay ISO
    cli.ts(+test)              pure helpers for scripts/campaign.mts: USAGE, cliErrorLine (one
                               readable line per error), operatorKeyProblem, fallbackProblem,
                               parseFallbackPicks (--winners ranking [--split] or id:amount[:reason])
    program-file.ts            zod format of programs/*.json (+ starter limits, optional max_award_usd,
                               token_policy encouraged|allowed|off, default encouraged; tokenPolicyLine)
    programs.ts(+test)         list/get/upsert programs (source: 'file' | 'sponsor'); build_help
                               (kits/starter + one start command), trust() (verified_at: skip
                               re-reading sources within 7 days), trustFor (sponsor programs: an
                               escrow note, no verified_at), perWinnerUsd (tie-break amount); programCard/
                               programDetails (pure): sponsor campaigns get quoted title/name,
                               generic rules and a neutral description, their own text only
                               in sponsor_content
    submission.ts(+.test.ts)   prepareSubmission, rememberedWalletQuestion (pure)
    projects.ts(+test)         recordSubmission (campaigns: no self-entry, required fields
                               (missingAnswersProblem), sanctions, ownership proof; one entry per
                               repo and per contract, checked under a per-campaign advisory lock;
                               stores repo_key (unique index projects_campaign_repo_key) and
                               live_key (not unique: shared ones are flagged, sponsor.ts
                               sameLiveLink) and the repo's GitHub dates;
                               remembers installations.payout_wallet)
    ownership.ts(+test)        builder ownership proof: earnkit.txt at the repo root (raw GitHub,
                               5 s, 4 KB, no redirects; EARNKIT_OWNERSHIP_BASE_URL in dev/test only):
                               parseOwnershipFile (payout_wallet; plus creator_wallet and token lines
                               for token launches, malformed ones ignored), githubRepo,
                               ownershipProblem (pure),
                               deployerOf (creation tx sender), checkOwnership (fork refusal via
                               GitHub repoFacts, fetcher and Blockscout DeployerLookup injectable;
                               recordSubmission passes deps through for the e2e)
    sanctions.ts(+test)        Chainalysis isSanctioned oracle on Base mainnet only (skipped with a
                               note elsewhere; injectable): screenWallet (entry, create),
                               screenWinners (award plans, fallback execute,
                               campaign payout), planScreenProblem (the award page re-screens the
                               stored plan); production fails closed on a wrong or failing
                               RPC; clean results cached 10 min
    untrusted-text.ts(+test)   the one sanitizer for sponsor/builder text (cleanText: NFKC, then an
                               allowlist of letters/numbers/fixed punctuation/emoji, quotes -> ',
                               reject links incl. defanged/IP/confusable-dot/bare domains and HTML
                               entities; single-line fields also @ and 7+ digit runs; TEXT_LIMITS),
                               SponsorUrl, BuilderUrl/canonicalBuilderUrl/builderUrlProblem/
                               shownUrl (builder links, canonical form), untrusted()
                               (zod), cleanProject
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
                               4 KB; resolver and transport injectable. safeProbe: the token gate's
                               live-link check (any 2xx, body unread, one same-site redirect,
                               User-Agent EarnKit-linkcheck/1)
    sponsor-identity.ts(+test) pure: sponsorLabel ("Sponsored · unverified" / "Sponsored · verified
                               <host>"), earnkitTxtNames (earnkit.txt parsing), reserved brand
                               names (reservedBrands/reservedNameProblem: confusable skeleton,
                               whole words incl. split letters; brand -> official domains),
                               mixedScriptProblem, trackRecordOf/trackRecordText (100+ USDC pools;
                               sponsor-made awards apart from fallback, self-paid and off-plan)
    confusables.ts(+test)      pure: skeleton (NFKD, marks dropped, UTS #39 look-alikes + stroke
                               letters -> ASCII), mixedScriptWords and DOT_LOOKALIKES (read as "."
                               by the sanitizer)
    confusables-table.ts       generated (scripts/gen-confusables.mts) from Unicode confusables.txt
                               (letter, digit and full-stop prototypes)
    sponsor-verify.ts(+test)   domain verification over safe-fetch, cached in sponsor_verifications
                               (24 h pass, 1 h failure): verifySponsor, domainCheck (create/status),
                               sponsorIdentity (funded campaigns only; pages, campaign sync),
                               cachedIdentities (cache only; list_programs, get_program), trackRecord
    rate-limit.ts(+test)       Postgres fixed-window counter (rate_windows; atomic upsert) + clientIp
                               (X-Real-IP from Railway's edge, else rightmost x-forwarded-for;
                               IPv6 keyed on its /64). LIMITS (v2.2 §5): sponsor create 5/day
                               (replacements 10/day), record_submission 20/day and token launches
                               (tokenLaunch) 3/day per installation, OAuth register
                               20/hour, authorize 60/hour and new installations 10/hour + 30/day
                               per IP (oauth-routes.ts; replayed codes free), GitHub matching (list_programs with a user/repos,
                               get_program's repo check) 30/hour per installation, chain checks
                               60/min (/check per IP, sponsor status per installation).
                               enforce() throws RateLimitError ("… Try again in 18 minutes.");
                               routes answer 429 + Retry-After. ENTRIES_PER_CAMPAIGN = 3
                               (recordSubmission counts under the campaign's entry lock)
    repo-cache.ts(+test)       GitHub repo facts for matching (chains, commits since each window
                               start) in github_repo_facts, 1 h per (repo, pushed_at)
    installations.ts           save / touch installation by token hash or (v2.4) OAuth client key
                               (client_key); memory (GitHub, working_on, last payout wallet);
                               rememberWallets, installationWallets (installation_wallets)
    oauth-routes.ts(+limits test) token + authorize handlers (app/oauth/* re-export them)
    oauth.ts(+.test.ts)        stateless OAuth: register (v2.4: a random nonce in every client id),
                               authorize, code -> token, metadata, clientKeyOf;
                               publicOrigin = EARNKIT_URL (production throws without it; no Host
                               fallback)
    mcp.ts(+test)              MCP server: the 5 builder tools, plus sponsor_campaign only when the
                               escrow is configured; descriptions and schemas
    present.ts(+test)          presentFirstMessage (v2.5): alerts, "EarnKit matches you to $X in
                               open money" (openMoneyUsd: per-winner prizes of fitted programs) with
                               a Builder bonus column (bonusCell), open EarnKit campaigns only, at
                               most 5 others, BONUS_NOTE (not affiliated, earnkit.com/policy), ideas
                               when the builder has no repo, sponsored last, one offer (keep going /
                               campaign entry / fastest fit / build one / build something new);
                               markdown tables, no emojis; sponsor campaigns never offered
    match.ts(+test)            pure: chain detection (IDs + RPC hosts), repo x program verdicts
    match-projects.ts          repo matching for list_programs + get_program's eligibility check
                               (public GitHub reads, GITHUB_TOKEN; complete reads cached via
                               repo-cache.ts)
    http.ts(+test)             CORS + small response helpers; secretMatches, bearerMatches
                               (timing-safe; v2.4 cron and veto)
    tools.ts                   tool name -> handler + input validation (+ caller's installation);
                               includes sponsor_campaign (create/status/award). ToolContext.tokenDeps
                               (gate/check/deploy fakes) is test and e2e injection only; the MCP
                               route never sets it. ToolContext.roundPoolsWei overrides the builder
                               bonus pools read (default bonus-rounds.ts roundPoolsWei)
    tokens.ts(+test)           deployToken via tokens.fun /api/v1/deploy (TOKENSFUN_DEPLOY_API_KEY;
                               EARNKIT_TOKENSFUN_TIMEOUT_MS, default 120000): atomic claim
                               (token_url='pending', token_repo_key; refused when another project on
                               the repo has a token: repoTokenUrl/repoHasTokenNote), released only
                               on a 4xx with a JSON body
                               (outcomeOf; a 429 quotes tokens.fun and its retryAfter);
                               tokenLaunchesAvailable (deploy key set); TokenStatus/TokenOutcome,
                               setTokenStatus (only rows with token_url IS NULL), EARNINGS_LINE,
                               TOKEN_TERMS, decodeImage, xProfileUrl
    token-proposal.ts(+test)   v2.3 proposal: cleanTokenName (text + brand rules), tickerProblem
                               (3-6 A-Z0-9, TICKER_RESERVED, brands), tickerCandidates, proposeToken
                               (tokens.fun check-ticker; unreachable -> first clean candidate, noted),
                               monogramFor (12-colour palette)
    token-gate.ts(+test)       tokenGate: policy, public non-fork repo with commits, ownership
                               (ownerProblem: earnkit.txt, read for every launch, names the creator
                               wallet on payout_wallet: or creator_wallet: and has the agent's
                               "token: <SYMBOL> <code>" line: tokenLineCode/tokenLineFor, an HMAC of
                               installation, repo and ticker under EARNKIT_AUTH_SECRET),
                               live link via safeProbe, sanctions screen; first failure as a reason
                               with the fix; GitHub/owner/probe/screen injectable (GateDeps)
    token-launch.ts(+test)     the token flow: tokenProposalBlock (prepare_submission's token),
                               decideToken (pure rules; record_submission needs the confirmed
                               symbol), submissionToken (record_submission's token part, never
                               throws; loose token object, image ignored), launchToken (launch_token,
                               with live_url/repo_url overrides); runTokenFlow: launches configured,
                               decideToken, one token per repo, gate, LIMITS.tokenLaunch, deploy;
                               TokenFlowDeps (gate, check, deploy, store, limit, available) for tests
    campaigns.ts(+test)        CampaignConfig union ('earnkit' | 'sponsor'; earnkit: prize_usd_total,
                               amount_each, priced_at), prizeColumn/wonUsdText, entry checks
                               (entryFieldProblems: every problem at once; isWalletAddress),
                               normalizeRepoUrl/sameRepoEntry, scoring v2 (scoreEntry: walletsUsing
                               + internalCallers on Blockscout, walletHistory, UserOp sender +
                               EntryPoint getNonce for smart accounts, ENTRY_POINTS;
                               EARNKIT_BLOCKSCOUT_URL in dev/test only), FINAL_GRACE_MS, REVIEW_MS,
                               payoutBy, scoreIsFinal/needsScore, entryStatus, "Your campaign
                               entries" text (sponsor entries)
    campaign-score.ts(+test)   the scoring loop (scoreCampaignEntries): per-entry isolation
                               (score_error), oldest attempt first, deadline; storeScore
                               (entry_wallets, code_share, score_partial)
    leaderboard.ts(+test)      data for the leaderboard and entry pages (incl. sponsor state and
                               award_onchain), yourCampaignEntries, entryNames; v2.4:
                               earnkitCampaignRows, campaignRow, campaignCandidates, reviewRows,
                               payingCampaign, publicNote; the board's review and funds
    prices.ts(+test)           DefiLlama price (llamaPrice), for golive
    campaign-text.ts(+test)    generated EarnKit campaign texts (earnkitTexts), ceilSig, goLive
    builder-code.ts(+test)     EARNKIT_BUILDER_CODE (default "earnkit"), codesIn (ERC-8021 suffix)
    entry-proof.ts(+test)      entryMessage ("EarnKit entry: <program> <repo key> <wallet> <contracts>"),
                               signToEnter, entrySigner (EIP-191)
    winners.ts(+test)          rankEntries, pickWinners (one prize per wallet and installation,
                               vetoes, refusals), standingText, RunState
    entry-text.ts(+test)       confirmTable, enteredTable, keyTable, tokenRow, TOKEN_FOOTNOTE, siteUrl
    fees.ts(+test)             Clanker FeeLocker WETH reads (setFeeSource), the 6 h cache (token_fees),
                               feeAlert (>= $100, per $100 step), refreshFees, launchedCreatorWallets
    funds.ts(+test)            prizeFunds: the payout wallet's balance for the pages (60 s memo, 15 s
                               after a failure, 3 s timeout, no retries)
    alerts.ts(+test)           alertLines (pure, money first), alertFacts, sinceYouLastChecked
                               (seen ids in alert_state, one transaction, 1.5 s budget),
                               sinceLine, SCHEDULE_NOTE
    payout.ts(+test)           payoutAccount (CAMPAIGN_PAYOUT_PRIVATE_KEY), payoutRpc, payWinner (sign,
                               store, broadcast; stale/manual handling), payCampaign, dbPayoutStore,
                               termsOf/fromTerms/sameTerms, MANUAL_CHECK, TOP_UP, NO_PAYOUT_KEY, NOT_MAINNET,
                               needsOwner (the 503 notes); the page balance is funds.ts
    cron.ts(+test)             nextStep (the state machine), scoreMaxAge, runCron (one step per
                               campaign under its lease, then the builder bonus ledger, then the fee
                               refresh; needs_owner incl. PAY_FAILED_RUNS failed pay steps in a row
                               and a MANUAL_CHECK bonus sweep), cronPost
    bonus-rounds.ts(+test)     roundFor (windowed / UTC-month rounds), bookingFor (round or Safe, with
                               the reason), roundPoolsWei (one grouped read, open rounds only)
    bonus-ledger.ts(+test,     v2.5 builder bonus ledger: BASE_BONUS (FeeLocker, lockers, WETH, Safe),
      +anvil.test)             STORE_TOKENS/CLAIMED_REWARDS, bonusDeposits (attribution: next
                               ClaimedRewards of the sending locker), bonusRpc, scanForward (adaptive
                               getLogs), indexDeposits (cursor), bookDeposit, collectNearEnd,
                               claimFees, sweepToSafe (payWinner + sweepStore), worthIt (10x gas),
                               indexedThrough, runBonusLedger (the cron step)
    fixtures/                  clanker-base-launch.json (a real Base receipt, from tokens.fun),
                               bonus-db-lock.ts (test-only advisory lock for the bonus test files)
    veto.ts(+test)             vetoKey, vetoLink, vetoEntry (FOR SHARE on the run), vetoPost, VETO_ERRORS
    escrow.ts                  read-only escrow client: chain/token config (ESCROW_*, validated by
                               escrowConfigProblem/escrowEnabled, which gate the sponsor tool), builds
                               approve/createCampaign/award transactions; chain reads: chainReader
                               (EscrowReader: campaignOf, clone facts), readEscrow (state + pending
                               fallback), readAwardedLog (+ awardSearchFrom, scanLogsNewestFirst:
                               2,000-block getLogs ranges that shrink on a range-limit refusal,
                               back off on a rate limit; logError). Never signs.
    escrow-abi.ts               generated by contracts/script/export-abi.sh; campaignsAbi/campaignAbi
    wallet-batch.ts(+test)     pure: atomicBatching (EIP-5792 "supported" only, chain or 0x0),
                               batchUnsupported (57xx -> send in order), batchStatusProblem
    sponsor-rules.ts(+test)    pure rules: create's five answers and defaults (DraftInput,
                               withDefaults: what_to_build, theme alias, defaults listed),
                               ranked awards (AwardPicks, splitPrize: exact, remainder to first
                               place; resolvePicks: default reason "Picked by <sponsor>"),
                               draft validation (checkDraft/toUnits), the 90/10
                               pool/prize split (splitUnits), the program file sponsors get
                               (sponsorProgramFile), award planning (planAward), matching an
                               onchain award back to entries (matchAwardToPlan, mapOffPlanAward),
                               and the sponsor's replies (createReply/statusReply/awardReply:
                               show_to_sponsor + next_step)
    sponsor.ts(+test)          DB + chain: createSponsorDraft (binds sponsor_wallet; replaces: retires
                               an unfunded draft as 'replaced' in the same transaction; rate limit
                               charged via a callback only after validation), loadCampaign
                               (lazy draft expiry: 7 days unfunded, or under 10 minutes to the
                               deadline; draftExpiry), checkChain = findFunding (matchFunding over
                               campaignOf(wallet, ref); row-locked publish; rescues expired drafts)
                               + findAward (Awarded log -> recordAward vs plan / fallback_plan /
                               off-plan; Refunded -> refunded), excludedWinners (all escrow clones,
                               sponsor wallet, token, factory), sponsorStatus (survives scoring and
                               RPC failures), prepareAward (guarded UPDATE)
  db/schema.sql                the whole schema, idempotent (sponsor_campaigns, projects.prize_*,
                               projects.repo_key + its partial unique index, projects.token_* and
                               token_repo_key + projects_token_repo_key (one token per repo),
                               sponsor_verifications,
                               rate_windows, github_repo_facts, scoring_leases, projects.score_partial and
                               scored_through; v2.4: programs.opened_at, installations.client_key and
                               alert columns, installation_wallets, entry_wallets, projects.deployers/
                               score_error/code_share/score_final/vetoed_at/payout_status/
                               prize_raw_tx/payout_reverts/payout_stale_at, campaign_runs (with
                               terms), token_fees; v2.5: programs.ideas/submission_proof,
                               projects.coin_address (unique)/coin_collected_at, bonus_rounds,
                               bonus_ledger, bonus_sweeps, bonus_cursor)
  scripts/                     db-migrate.mts, programs-sync.mts (load .env.local)
    db-check.mts                v2.4: applies main's schema + rows, then db/schema.sql twice, on a
                                local Postgres only; checks backfills, defaults, opened_at via sync,
                                and the v2.5 bonus tables' constraints
    token-e2e.mts               v2.3 token flows through the tools layer against a local Postgres
                                and a mock tokens.fun on 127.0.0.1 (gate faked via
                                ToolContext.tokenDeps): default launch, edited ticker, skip, gate
                                failures, policy off, retry with a fixed live_url, 400 refusal (claim
                                released), unconfirmed, monogram PNG (?s= checked), timeout and 502
                                (pending, claim kept), omitted token, existing token, no earnkit.txt,
                                no token: line, a copied wallet, links changed before the claim,
                                one token per repo (incl. the unique index), the 3-a-day limit, no
                                deploy key, token.proposed echoed through the MCP server; the mock
                                also serves earnkit.txt; `pnpm token:e2e`
    campaign-e2e.mts            v2.4 lifecycle on a local Postgres + anvil (chain id 8453, 2 s blocks,
                                reset each run), mock MINI/EntryPoint/Blockscout/raw GitHub, a shifted
                                clock: first message, signed entry, two cron days through the real
                                /api/cron route, freeze + review, veto through /api/admin/veto,
                                payout (short wallet, top-up), winner alert, no double pay;
                                `pnpm campaign:e2e`
    payout-fork-check.mts       v2.4 payout on a Base mainnet anvil fork (reset each run) with real
                                MINI and the real sanctions oracle; historic-state reads (nonce,
                                code, getNonce at a past block; the public RPC too);
                                `pnpm campaign:fork-check`
    campaign.mts                golive|rank|payout (dry run)|veto-link (EarnKit's own campaigns) and
                                fallback propose|execute|veto, refund, sync [<ref>] (sponsor
                                campaigns; local only; sync reads the chain for one ref or sweeps
                                draft/expired/live; refund --escrow refunds a stray escrow);
                                errors are one line + exit 1; propose refuses before endsAt + 7
                                days onchain, refund names who gets the money
    sponsor-e2e.mts             full sponsor flow (wallet-bound draft -> fund -> status finds it ->
                                entries -> award read onchain; front-run and wrong-amount deposits,
                                fallback propose/re-propose/execute and propose/veto, the operator
                                CLI, entry statuses, sponsor replies without hashes, five-answer
                                create, ranked awards and fallback) against a local
                                anvil + Postgres; `pnpm sponsor:e2e`
```

Root commands: `pnpm programs:check` (validate program files), `pnpm test`,
`pnpm campaign --help`, `pnpm campaign golive|rank|payout|veto-link <slug>` (EarnKit's own
campaigns; payout is a dry run only, the cron pays), `pnpm campaign fallback propose|execute|veto <ref>`, `refund <ref>` (sponsor
campaigns; dry run without `--execute`; `OPERATOR_PRIVATE_KEY`, the veto `GUARDIAN_PRIVATE_KEY`;
`refund <ref> --escrow <address>` refunds a stray escrow for that ref), `pnpm campaign sync [<ref>]`
(reads the chain and updates the database: one campaign, or every draft/expired/live one), `pnpm sponsor:e2e` (full sponsor flow on a local
anvil + Postgres, see `contracts/README.md` and `sponsor-e2e.mts`'s header for the exact env),
`pnpm token:e2e` (v2.3 token flows against a local Postgres and a mock tokens.fun; env in
`token-e2e.mts`'s header), `pnpm campaign:e2e` and `pnpm campaign:fork-check` (v2.4; env in each
script's header).
Railway runs `pnpm predeploy` (= `db:migrate` + `programs:sync`) before every deploy.
Env: `DATABASE_URL`, `EARNKIT_AUTH_SECRET`, `EARNKIT_URL` (public origin, prod only),
`GITHUB_TOKEN` (one server-side read-only token for repo matching), `TOKENSFUN_DEPLOY_API_KEY`
(tokens.fun deploy key for token launches; `TOKENSFUN_API_URL` overrides the host for tests;
`EARNKIT_TOKENSFUN_TIMEOUT_MS` bounds the deploy call, default 120000),
`BASE_RPC_URL` (optional; default public Base RPC; must serve historic state for scoring),
`CRON_SECRET` (32+ characters; also the GitHub Actions secret), `ADMIN_VETO_SECRET` (32+
characters; also in the owner's shell for veto-link), `CAMPAIGN_PAYOUT_PRIVATE_KEY` (the campaign
payout wallet: the only key on Railway), `EARNKIT_BUILDER_CODE` (optional, default `earnkit`).
Test only: `EARNKIT_BLOCKSCOUT_URL` and `EARNKIT_OWNERSHIP_BASE_URL` (honored only when NODE_ENV is
development or test).

Sponsor escrow (v2.1), also never on Railway's write path — the server only reads the chain:
`ESCROW_CHAIN` (`base` | `base-sepolia` | `local`), `ESCROW_FACTORY_ADDRESS`, `ESCROW_RPC_URL`
(falls back to `BASE_RPC_URL` on `base`), `ESCROW_LOCAL_TOKEN` (the mock token address, `local`
chain only). `OPERATOR_PRIVATE_KEY` (fallback propose/execute, refund) and `GUARDIAN_PRIVATE_KEY`
(fallback veto) are local only, never on Railway.
