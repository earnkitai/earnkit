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
  app/policy/page.tsx          v2.5 Task 9: the public policy (matching, fee split table, builder bonus
                               funding/eligibility/ranking/review/payout, coin optional, no
                               affiliation, contact); numbers from lib/earnkit/policy.ts
  app/bonus/[round]/{page.tsx,BoardView.tsx}  v2.5 Task 9: the public builder bonus leaderboard
                               (bonus-board.ts data; BoardView is pure and markup-tested; Ext links
                               only shownUrl https forms, tx links only 32-byte hashes)
  app/api/stats/route.ts       v2.5 Task 9: GET public stats JSON (revalidate 600, prerendered when
                               the build has a DATABASE_URL; plus unstable_cache 600 s on the read,
                               for builds without one, where it renders per request); 503 no-store
                               on a failed read
  app/components/common/Panel.tsx  Panel (the rounded navy section) and Eyebrow
  app/sitemap.ts               force-dynamic: home, /policy, every non-empty bonus round
  app/api/cron/route.ts        v2.4: POST -> cronPost (Bearer CRON_SECRET; scoring, freeze, review,
                               payout, fee refresh)
  app/api/admin/veto/route.ts  v2.4: POST only -> vetoPost (form: slug, key, entry, reason; v2.5: round
                               instead of slug for a builder bonus round)
  app/admin/bonus/[round]/page.tsx  v2.5 Task 7: the owner's builder bonus round review (noindex,
                               ?key= = bonusVetoKey, rate limited): pool, amounts, note, rank/project/
                               score/signals/flags/place amount, a Remove form per entry
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
                               remembers installations.payout_wallet); v2.5 §3: non-campaign
                               programs with submission_proof check external_submission_url via
                               submission-proof.ts (never fails the entry; stores
                               submission_proof_url/submission_proof_ok_at, a bonus_note on
                               failure); bonusEligible (pure: coin_address and
                               submission_proof_ok_at both set, not a later same-repo entry; never
                               stored; SQL twin traction.ts eligibleSql); Ruling 13: stores
                               bonus_repo_key and, via verifiedBonusContracts, an external entry's
                               verified contracts (+ payout_wallet as creator_wallet); entry-time
                               notes use the open round's end (M12) and, Ruling 25, say "no builder
                               bonus: this repo's coin is entered in <program>" (repoCoinPrograms)
    submission-proof.ts(+test) v2.5 §3 builder bonus eligibility #3: proofProblem(program, url,
                               repoUrl, liveUrl, deps) checks the url is https, on
                               submission_proof.host, path matching path_pattern, then fetches it
                               via safeFetchText (safe-fetch.ts LARGE_PAGE_MAX_BYTES, 512 KB) and
                               looks for the entry's normalized repo link (required when the entry
                               has a repo, Ruling 22) or, repo-less only, its live host unless
                               sharedHost (proof host, platforms, code/social sites, hosting
                               apexes: SHARED_SITES/SHARED_APEXES), case- and form-insensitive; any fetch failure reads as "couldn't check yet;
                               we retry daily" (never throws; a malformed liveUrl is guarded with
                               URL.canParse, fix round 1 I1); recheckSubmissionProofs(now, deadline,
                               deps), called from cron.ts's runCron: the daily re-check of a failed
                               proof (submission_proof_checked_at, at most once a day) while the
                               program stays active and its round is open (roundFor,
                               bonus-rounds.ts); ended or closed, it's skipped with no fetch;
                               filtered in SQL, at most RECHECK_BATCH (50) a run (M11)
    ownership.ts(+test)        builder ownership proof: earnkit.txt at the repo root (raw GitHub,
                               5 s, 4 KB, no redirects; EARNKIT_OWNERSHIP_BASE_URL in dev/test only):
                               parseOwnershipFile (payout_wallet; plus creator_wallet and token lines
                               for token launches, malformed ones ignored), githubRepo (moved to
                               campaigns.ts v2.6, re-exported here: match.ts needs it too and
                               importing it from here would cycle back through match-projects.ts),
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
                               4 KB (LARGE_PAGE_MAX_BYTES, 512 KB, for a whole HTML page like a
                               submission proof: passed explicitly, the 4 KB default is unchanged
                               for every other caller); resolver and transport injectable. safeProbe: the token gate's
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
    installations.ts(+test)    save / touch installation by token hash or (v2.4) OAuth client key
                               (client_key); memory (GitHub, working_on, last payout wallet);
                               rememberWallets, installationWallets (installation_wallets);
                               testInstallationIds (v2.6 Ruling 6 (plan)): EARNKIT_TEST_INSTALLATIONS,
                               comma-separated ids, malformed parts dropped with one console.warn per
                               distinct value naming positions only, never the text
    oauth-routes.ts(+limits test) token + authorize handlers (app/oauth/* re-export them)
    oauth.ts(+.test.ts)        stateless OAuth: register (v2.4: a random nonce in every client id),
                               authorize, code -> token, metadata, clientKeyOf;
                               publicOrigin = EARNKIT_URL (production throws without it; no Host
                               fallback)
    mcp.ts(+test)              MCP server: the 5 builder tools, plus sponsor_campaign only when the
                               escrow is configured; descriptions and schemas
    present.ts(+test)          presentFirstMessage (v2.6 §1): alerts, "EarnKit matches you to $X in
                               open money you qualify for" (openMoneyUsd: per-winner prizes of
                               fitted programs; $0 keeps "Your repos fit these open programs:") with
                               repos, else "$X is open right now" (youCould/githubGiven, Ruling 11;
                               that table's "Prize" column becomes "You could win") with a Builder
                               bonus column (bonusCell: "new pool", "<x> ETH so far", or "—" only
                               when builder_bonus is false (Ruling 7) or bonus_closed; Ruling 25: a
                               repo whose coin is entered in another program, repoCoins, shows "no
                               builder bonus: …"), open EarnKit campaigns only, at most 5 others,
                               BONUS_NOTE (not affiliated, earnkit.com/policy), ideas (one per line)
                               when the builder has no repo, sponsored last, one offer (keep going /
                               campaign entry / fastest fit / "Pick one and I'll start." / build
                               something new);
                               markdown tables, no emojis; sponsor campaigns never offered
    match.ts(+test)            pure: chain detection (IDs + RPC hosts), repo x program verdicts;
                               reportedFacts(ReportedRepo) turns an agent's local_repos report into
                               RepoFacts, keeping url only when campaigns.ts githubRepo parses it
                               (Ruling 13), else ''
    match-projects.ts          repo matching for list_programs + get_program's eligibility check;
                               gh (the authenticated GitHub GET, also used by traction.ts)
                               (public GitHub reads, GITHUB_TOKEN; complete reads cached via
                               repo-cache.ts); ReportedRepoInput.url (optional, max 300, validated
                               by githubRepo not zod, Ruling 13)
    http.ts(+test)             CORS + small response helpers; secretMatches, bearerMatches
                               (timing-safe; v2.4 cron and veto)
    tools.ts                   tool name -> handler + input validation (+ caller's installation);
                               includes sponsor_campaign (create/status/award). ToolContext.tokenDeps
                               (gate/check/deploy fakes) is test and e2e injection only; the MCP
                               route never sets it. ToolContext.roundPoolsWei overrides the builder
                               bonus pools read (default bonus-rounds.ts roundPoolsWei; null = the
                               round froze), ToolContext.repoCoins the repo-coin read (default
                               tokens.ts repoCoinPrograms), ToolContext.matchProjects overrides the
                               GitHub/local-repo matcher (default match-projects.ts matchProjects);
                               list_programs passes githubGiven (a GitHub user or repo list given
                               now or remembered) to presentFirstMessage for youCould (Ruling 11)
    tokens.ts(+test)           deployToken via tokens.fun /api/v1/deploy (TOKENSFUN_DEPLOY_API_KEY;
                               EARNKIT_TOKENSFUN_TIMEOUT_MS, default 120000): atomic claim
                               (token_url='pending', token_repo_key; refused when another project on
                               the repo has a token: repoTokenUrl/repoHasTokenNote), released only
                               on a 4xx with a JSON body
                               (outcomeOf; a 429 quotes tokens.fun and its retryAfter);
                               tokenLaunchesAvailable (deploy key set); TokenStatus/TokenOutcome,
                               setTokenStatus (only rows with token_url IS NULL), EARNINGS_LINE,
                               TOKEN_TERMS, decodeImage, xProfileUrl; v2.5: coin_address written
                               with the launch, Base only (M9, Ruling 24); repoCoinPrograms
                               (Ruling 25: the program each repo's coin is entered in)
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
    token-launch.ts(+test)     the token flow: tokenProposalBlock (prepare_submission's token;
                               TokenBlock.has_bonus, .repo_coin_program: Ruling 25), hasBuilderBonus (v2.5 §3, Task 8: pure,
                               active && submission_proof != null), decideToken (pure rules;
                               record_submission needs the confirmed symbol), submissionToken
                               (record_submission's token part, never throws; loose token object,
                               image ignored), launchToken (launch_token, with live_url/repo_url
                               overrides); runTokenFlow: launches configured, decideToken, one
                               token per repo, gate, LIMITS.tokenLaunch, deploy; TokenFlowDeps
                               (gate, check, deploy, store, limit, available) for tests
    campaigns.ts(+test)        CampaignConfig union ('earnkit' | 'sponsor'; earnkit: prize_usd_total,
                               amount_each, priced_at), prizeColumn/wonUsdText, entry checks
                               (entryFieldProblems: every problem at once; isWalletAddress),
                               normalizeRepoUrl/sameRepoEntry, githubRepo (owner/repo from a GitHub
                               link, case preserved; v2.6: lives here, not ownership.ts, so match.ts
                               can use it without a circular import through match-projects.ts),
                               scoring v2 (scoreEntry: walletsUsing
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
    entry-text.ts(+test)       confirmTable, enteredTable, keyTable, tokenRow (hasBonus: v2.5 §3,
                               Task 8, "· skip: no builder bonus"; coinIn: Ruling 25),
                               repoCoinNote, TOKEN_FOOTNOTE, siteUrl
    fees.ts(+test)             Clanker FeeLocker WETH reads (setFeeSource), the 6 h cache (token_fees),
                               feeAlert (>= $100, per $100 step), refreshFees, launchedCreatorWallets
    funds.ts(+test)            prizeFunds: the payout wallet's balance for the pages (60 s memo, 15 s
                               after a failure, 3 s timeout, no retries)
    alerts.ts(+test)           alertLines (pure, money first; v2.5 §3 Task 8 adds builder bonus
                               wins and its own top-10 tracking), alertFacts, sinceYouLastChecked
                               (seen ids in alert_state, one transaction, 1.5 s budget),
                               sinceLine, SCHEDULE_NOTE, paidBonusWins (paid bonus_payouts rows;
                               table check memoized, M15; wins seen by payout id, M2)
    payout.ts(+test)           payoutAccount (CAMPAIGN_PAYOUT_PRIVATE_KEY, with or without 0x: Ruling 7), payoutRpc, payWinner (sign,
                               store, broadcast; stale/manual handling; optional place), payRanked
                               (per-place amounts, any ERC-20, every v2.4 rule, openSends nonce
                               floor, a caller's shared `nonces`; follow-only done in the same
                               run, M14), payCampaign (wrapper), openStoredSends, dbPayoutStore,
                               PAY_FAILED/PAY_FAILED_RUNS/STEP_FAILED,
                               termsOf/fromTerms/sameTerms, MANUAL_CHECK, TOP_UP, NO_PAYOUT_KEY, NOT_MAINNET,
                               needsOwner (the 503 notes); the page balance is funds.ts
    cron.ts(+test)             nextStep (the state machine), scoreMaxAge, runCron (one step per
                               campaign under its lease, then builder bonus scoring (scoreOpenRounds),
                               the ledger with its rounds step (bonus-payout advanceRounds), then the fee
                               refresh; needs_owner incl. PAY_FAILED_RUNS failed pay steps in a row
                               and a MANUAL_CHECK bonus sweep; BONUS_WALLET_UNSET when the ledger is
                               skipped (key missing or malformed, off mainnet) while bonusLive,
                               Rulings 19-20; an ended round's scoring failure once, Ruling 23), cronPost
    bonus-rounds.ts(+test)     roundFor (windowed rounds keyed by start day, windowKey, Ruling 21;
                               UTC-month rounds), bookingFor (round or Safe, with the reason),
                               roundPoolsWei (one grouped read, open rounds only; null = the round
                               froze)
    bonus-ledger.ts(+test,     v2.5 builder bonus ledger: BASE_BONUS (FeeLocker, lockers, WETH, Safe),
      +anvil.test)             STORE_TOKENS/CLAIMED_REWARDS, bonusDeposits (attribution: next
                               ClaimedRewards of the sending locker), bonusRpc, scanForward (adaptive
                               getLogs), indexDeposits (cursor), bookDeposit (an open round follows
                               the program window), collectNearEnd (isRevert: only a revert skips a
                               locker), claimFees (M10: also when the sweep waits on it),
                               sweepToSafe (payWinner + sweepStore), worthIt (10x gas),
                               indexedThrough, roundsCovered, sendCall (run nonce floor, I5),
                               runBonusLedger (the cron step; a malformed key is a skip, Ruling 19;
                               one `nonces` floor per run; `rounds` hook after the claims, before
                               the sweep)
    bonus-payout.ts(+test,     v2.5 Task 7: BONUS_SPLIT_BPS, splitPool, placesFor, freezeRound,
      +anvil.test)             bonusPayoutStore (bonus_payouts), roundRows, advanceRounds (freeze,
                               review, claim-before-pay (a pending claim is CLAIM_PENDING, not a
                               top-up, M3), pay per place, rest to the Safe, empty)
    bonus-lifecycle.anvil.test.ts  v2.5 Task 10 e2e: the whole builder bonus lifecycle from
                               record_submission to the WETH transfer, through cronPost/runCron on
                               anvil + Postgres (mock tokens.fun, raw GitHub and Blockscout on one
                               local HTTP server; GitHub API, probe, proof pages, sanctions
                               injected): coin vs no coin, proof re-check, fees over 2 days (tokens.fun
                               batch collect, EarnKit's own near-end collect), scoring with no
                               onchain users, freeze, veto, payout split, post-end sweep, winner
                               alert, idempotent re-run. Skips without BONUS_ANVIL_URL/DATABASE_URL
    policy.ts                  v2.5 Task 9: FEE_SPLIT_BPS (a copy of tokens.fun's split), SAFE_ADDRESS, FEE_ROWS / SIGNAL_ROWS (traction
                               WEIGHTS) / PLACE_ROWS (BONUS_SPLIT_BPS) for /policy
    stats.ts(+test)            v2.5 Task 9: readStats (one aggregate query) / statsFrom (pure):
                               open_money_usd (max_award_usd of open programs), programs_open,
                               bonus_programs_open (v2.6 Ruling 16 (plan): open programs with
                               builder_bonus AND campaign IS NULL, bonusOn's SQL twin),
                               coins_launched (token_status launched), fees_to_safe_eth (v2.5-split coins
                               only, accrued: 1.5x real indexed bonus deposits of EarnKit coins (M5),
                               never round-rest: rows, + bonus money routed to the Safe),
                               bonus_paid_eth, installs; STATS_LABELS for jenil.ai; v2.6 Ruling 6/16
                               (plan): installs, coins_launched and the bonus_deposits_wei coin
                               subquery all exclude owner test installations (installations.ts
                               testInstallationIds, EARNKIT_TEST_INSTALLATIONS)
    bonus-board.ts(+test)      v2.5 Task 9: bonusBoard (open/frozen: live ranking from bonus_scores
                               with eligibility in words; review/paying/paid: frozen bonus_payouts
                               minus vetoes, renumbered, top 10 + place holders, amounts, mined tx);
                               openRows/frozenRows/daysLeft/ethText pure; no wallets, flags or
                               veto reasons; a not-yet-booked open round shows with pool 0;
                               OpenEntry.test (v2.6 Ruling 6 (plan)): an owner test installation,
                               listed with the ineligible rows as "Test entry: not ranked"
    public-pages.test.ts       markup tests of /policy, BoardView and the footer link
    traction.ts(+test)         v2.5 traction score: signalsFor (users, live ratio, commit days,
                               contributors, interest, holders, market cap), rankNormalize, rankRound,
                               liveRatio (live_checks), dbStore (bonus_commits, github_users),
                               GitHubBudget, CLANKER_ADDRESSES, scorableContracts, ownContracts,
                               eligibleSql (v2.6 Ruling 6 (plan): excludes an owner test
                               installation, EARNKIT_TEST_INSTALLATIONS, for both the entry and the
                               earlier entry it would otherwise be blocked by), review_flags (single_commit_streak),
                               resolveBonusWallet, scoreRound (daily cache in bonus_scores, batched),
                               scoreOpenRounds (needsOwner: an ended round's scoring failure, once),
                               canFreeze/readyToFreeze (+24 h escape, flagged; no final read also
                               escapes, Ruling 23), finalRanking (eligible at the round end,
                               re-ranked; unread entries last, score 0, NO_FINAL_READ_FLAG)
    fixtures/                  clanker-base-launch.json (a real Base receipt, from tokens.fun),
                               bonus-db-lock.ts (test-only advisory lock for the bonus test files)
    veto.ts(+test)             vetoKey, vetoLink, vetoEntry (FOR SHARE on the run), vetoPost, VETO_ERRORS;
                               v2.5: bonusVetoKey, bonusReviewLink, vetoBonusEntry (bonus_vetoes)
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
    bonus-fork-check.mts        v2.5 Task 10: the bonus ledger against Clanker v4's real Base
                                contracts, read-only (never signs): a real collect receipt decoded
                                by bonusDeposits and cross-checked (tokenRewards, ClaimedRewards
                                rewards, storeLogs topic filter); collectRewards on each LP locker
                                and claim on the FeeLocker simulated with eth_call; skips without
                                BASE_RPC_URL or network; BONUS_FORK_TX pins the receipt;
                                `pnpm bonus:fork-check`
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
script's header), `pnpm bonus:fork-check` (v2.5; read-only; skips without `BASE_RPC_URL`). The v2.5
bonus e2e is a test file: `BONUS_ANVIL_URL=<local anvil, --chain-id 8453> DATABASE_URL=<local> pnpm test`.
Railway runs `pnpm predeploy` (= `db:migrate` + `programs:sync`) before every deploy.
Env: `DATABASE_URL`, `EARNKIT_AUTH_SECRET`, `EARNKIT_URL` (public origin, prod only),
`GITHUB_TOKEN` (one server-side read-only token for repo matching), `TOKENSFUN_DEPLOY_API_KEY`
(tokens.fun deploy key for token launches; `TOKENSFUN_API_URL` overrides the host for tests;
`EARNKIT_TOKENSFUN_TIMEOUT_MS` bounds the deploy call, default 120000),
`BASE_RPC_URL` (optional; default public Base RPC; must serve historic state for scoring),
`CRON_SECRET` (32+ characters; also the GitHub Actions secret), `ADMIN_VETO_SECRET` (32+
characters; also in the owner's shell for veto-link), `CAMPAIGN_PAYOUT_PRIVATE_KEY` (the campaign
payout wallet: the only key on Railway; v2.5: also the builder bonus wallet, which pays WETH and
gas), `EARNKIT_BUILDER_CODE` (optional, default `earnkit`),
`BONUS_INDEX_START_BLOCK` (v2.5: the Base block the bonus index starts from when it has no cursor;
set it at merge time, else the first run reads 2 days back), `EARNKIT_BONUS_WALLET` (optional
v2.5: the bonus wallet's address for traction's exclusions; default derived from the payout key).
Test only: `EARNKIT_BLOCKSCOUT_URL` and `EARNKIT_OWNERSHIP_BASE_URL` (honored only when NODE_ENV is
development or test).

Sponsor escrow (v2.1), also never on Railway's write path — the server only reads the chain:
`ESCROW_CHAIN` (`base` | `base-sepolia` | `local`), `ESCROW_FACTORY_ADDRESS`, `ESCROW_RPC_URL`
(falls back to `BASE_RPC_URL` on `base`), `ESCROW_LOCAL_TOKEN` (the mock token address, `local`
chain only). `OPERATOR_PRIVATE_KEY` (fallback propose/execute, refund) and `GUARDIAN_PRIVATE_KEY`
(fallback veto) are local only, never on Railway.
