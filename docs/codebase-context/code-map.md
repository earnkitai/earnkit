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
infra/host-worker/              v2.9 C12/C14 (Task 7): Cloudflare Worker for <slug>.earnkit.com (free plan;
                               the owner deploys by hand, never CI). wrangler.toml (earnkit-host, R2
                               BUCKET earnkit-sites, ZONE, RESERVED; routes commented), tsconfig.json
                               (no Node types) + tsconfig.test.json (pnpm host:typecheck, P42),
                               README (owner setup)
  src/route.ts(+test)          pure: siteSlug (one label, not reserved), objectKey (sites/<slug>/...,
                               traversal null), contentTypeFor, handle (state/<slug>.json kill switch
                               and end page, 410; G17 301 /dir to /dir/; Cache API: state 60 s,
                               files 240 s, 404/301 60 s; HOST_HEADERS on every response)
  src/index.ts                 fetch wrapper: handle(req, env, caches.default, ctx.waitUntil)
programs/                      program files (+ README: how Claude Code adds programs/starters)
  programs/outcomes/           v2.8 Part G, Ruling 30: announced results, <program-id>.json (OutcomeFile;
                               README has the format); written by the weekly routine, validated by
                               programs:check, matched to entries by programs:sync (counts only)
.github/workflows/earnkit-cron.yml  v2.4: hourly (:15) POST https://earnkit.com/api/cron with the
                               CRON_SECRET repo secret (also workflow_dispatch)
apps/frontend/
  public/programs/             v2.7 Ruling 23: program logos (<id>.svg|png, ≤200 KB, checked by
                               programs:check), served under a scoped image CSP (next.config.ts IMAGE_CSP); rendered
                               only via <img> (ProgramLogo, GuideView). v2.8.1: a16z-speedrun.png (the
                               "sr" mark from speedrun.a16z.com's apple-touch-icon)
  public/llms.txt              agent-readable summary: install, "What can I earn?", program guides
                               (earnkit.com/programs/<id>), the tools, live numbers (C9)
  app/page.tsx                 home (v2.7 §1): revalidate 600; getLanding() then HomeView
  app/HomeView.tsx             v2.7 §1, v2.8 Part A: the pure home render (Hero with stats_line,
                               ProgramCards (every open program, carousel), HowItWorks, BackedBy, Footer);
                               landing null (failed read) → hero without stats line, no cards (Ruling 21)
  app/components/sections/Hero.tsx  v2.8: HERO_TITLE, HERO_SUBTITLE, BonusPill lg → #how-you-earn-3, the
                               install and demo buttons, statsLine; nothing else
  app/lib/landing-cache.ts     v2.7: getLanding() = unstable_cache(readLanding, 600 s); failure → logs
                               [landing], await connection() (never prerendered), null;
                               getGuidePage(id) (React cache): gatedGuidePage — id ^[a-z0-9-]{1,64}$ and in
                               the cached curated id set ['guide-ids-v27'] (landing key 'landing-v28'), else null with no per-id read;
                               then readGuidePage ['guide-v27'], 600 s; failure → [guide], connection(), 'error'
  app/programs/page.tsx        v2.7 Ruling 22: /programs, every open curated program as ProgramCards
                               (layout="grid", heading h1, v2.7.1 figure = landing.open_text, the landing's pool
                               total); getLanding() null → "Programs are unavailable…"
  app/programs/[id]/page.tsx   v2.7 §2: the guide page; revalidate 600; null → notFound(); 'error' →
                               the Unavailable panel (HTTP 200, never a 404); generateMetadata
  app/programs/[id]/GuideView.tsx  pure guide render (header, Difficulty with the v2.7.1 builder bonus
                               pill (page.bonus_pill → the leaderboard), one Panel per part, AskAgent (open programs only), All programs,
                               Sources via shownUrl, Footer); exports askPrompt and Unavailable
  app/programs/[id]/AskAgent.tsx   client button opening AddToAgent with "What can I earn on <title>?"
  app/components/sections/AddToAgent.tsx   "Add to your agent" install panel (hero, the Open programs
                               "Ask your agent", the guide's AskAgent with "What can I earn on <program>?"); START_PROMPT;
                               v2.8 Task 5: AGENTS (Grok Bot, Claude Code, Cursor, Codex, Muse) with
                               local icons in public/images/agents/ (sources in the comment;
                               v2.8.1: grok-bot.png is Grok Bot's own app icon, shown in color, not
                               Grok's logomark; muse.svg is Muse's logo from muse.ai; SVG marks
                               take the tab's one color),
                               `after` approve lines, <BonusPill size="sm" /> under the steps
  app/components/sections/{ProgramCards,ProgramLogo,HowItWorks}.tsx  v2.7 §1 landing sections;
                               ProgramLogo: local <img> (path re-checked) or the Ruling 1 monogram;
                               v2.8 ProgramCards: h2/h1, `figure` "open right now", one "Ask your agent",
                               then every tile as a ProgramCard: layout "carousel" (home: scroll-snap row,
                               md+ Previous/Next arrows) or "grid" (/programs); no eyebrow, no "See all";
  app/components/sections/ProgramCard.tsx  v2.8 Ruling 21: one slim card, a whole-card link to
                               /programs/<id> (aria-label "<title>, <prize>"): logo, title, big line,
                               per-winner line, days-left and difficulty-word chips, BonusPill sm; no buttons
  app/components/sections/carousel.ts  v2.8 Ruling 20: pure scrollStep (one card + gap, clamped) and
                               arrowState (prev/next enabled; both off when nothing overflows);
                               HowItWorks exports HOW_TITLE "How you earn" and STEPS, a Panel with a
                               visible h2 #how-it-works and steps #how-you-earn-1..3. StatsStrip.tsx is
                               gone (v2.7.1); BuilderBonus.tsx ("Win twice") is gone (v2.8)
  app/components/common/InstallButton.tsx  v2.7 fix round 1: the header's "Add to your agent" (opens AddToAgent);
                               v2.7.1: Header shows "Docs" (links.ts DOCS) beside it, desktop and mobile;
                               the X link (now an icon button to x.com/jenilt, v2.8 Ruling 22) is in the
                               Footer only
  app/components/common/Footer.tsx  v2.8 Ruling 22: one rounded card (wordmark, FOOTER_TAGLINE, a
                               grid of FOOTER_COLUMNS), the faded wordmark (v2.8.1: the navbar's
                               ui/Logo.tsx Wordmark SVG, mark and letters, full width at 10%, decorative), the copyright
                               line; renders from lib/earnkit/footer-links.ts; real links only
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
  app/terms/page.tsx           v2.9 F22 (Task 11): the one legal page, metadata title "Terms", canonical
                               https://earnkit.com/terms; a section nav, then PolicySection (#policy),
                               RiskSection (#risk-disclosure), SponsorTermsSection (#sponsor-terms), Footer.
                               /policy, /risk-disclosure, /sponsor-terms 301 here (next.config.ts
                               LEGAL_REDIRECTS, statusCode 301, never permanent: true = 308)
  app/terms/sections/RiskSection.tsx  Tokenfi Inc.'s risk disclosure (was app/risk-disclosure/page.tsx),
                               text unchanged, restyled onto the site's panel and ek tokens
  app/terms/sections/SponsorTermsSection.tsx  sponsor terms (was app/sponsor-terms/page.tsx; the fund
                               page's checkbox links /terms#sponsor-terms)
  app/terms/sections/PolicySection.tsx  (was app/policy/page.tsx) v2.5 Task 9: the public policy (matching, fee split table then MINI_LINE (v2.9 F24), builder bonus
                               funding/eligibility/ranking/review/payout, coin optional, no
                               affiliation, contact); numbers from lib/earnkit/policy.ts; v2.6: the
                               bonus on every program unless opted out, page / confirmation /
                               unverified-page eligibility, the coin's earnkit.txt token line; v2.8: the
                               builder bonus heading has a BonusPill (md) beside it (Section aside)
  app/bonus/[round]/{page.tsx,BoardView.tsx}  v2.5 Task 9: the public builder bonus leaderboard
                               (bonus-board.ts data; BoardView is pure and markup-tested; Ext links
                               only shownUrl https forms, tx links only 32-byte hashes); v2.6
                               Ruling 12 (plan): the segment is the slug (<program>-<YYYY-MM-DD|
                               YYYY-MM>) or the v2.5 ':' form, via bonus-rounds.ts
                               resolveRoundParam (a malformed escape is a 404)
  app/api/stats/route.ts       v2.5 Task 9: GET public stats JSON (revalidate 600, prerendered when
                               the build has a DATABASE_URL; plus unstable_cache 600 s on the read,
                               for builds without one, where it renders per request); 503 no-store
                               on a failed read
  app/components/common/Panel.tsx  Panel (the rounded navy section) and Eyebrow
  app/components/ui/BonusPill.tsx  v2.8 Ruling 19: the builder bonus brand pill (BONUS_PILL_TEXT, bonusPillLabel, BONUS_PILL_COLORS; sm/md/lg, optional amount and href); cards and the guide page so far
  app/sitemap.ts               force-dynamic: home, /terms (v2.9), every non-empty bonus round (v2.6: by
                               boardSlug)
  app/api/cron/route.ts        v2.4: POST -> cronPost (Bearer CRON_SECRET; scoring, freeze, review,
                               payout, fee refresh)
  app/api/host/upload/route.ts  v2.9 C12: POST -> hostUploadPost (?t= one-time token, one zip, 503 when R2 off)
  app/api/host/takedown/route.ts  v2.9 C14: POST -> hostTakedownPost (Bearer ADMIN_VETO_SECRET; kill or approve)
  app/api/digest/unsubscribe/route.ts  v2.9 E19: GET confirm page (POST button), POST one-click (RFC 8058) -> digest.ts
  app/api/admin/veto/route.ts  v2.4: POST only -> vetoPost (form: slug, key, entry, reason; v2.5: round
                               instead of slug for a builder bonus round)
  app/admin/bonus/[round]/page.tsx  v2.5 Task 7: the owner's builder bonus round review (noindex,
                               ?key= = bonusVetoKey, rate limited): pool, amounts, note, rank/project/
                               score/signals/flags/place amount, a Remove form per entry; v2.6: a
                               Submission column (page checked / unverified page / builder
                               confirmed, from projects.submission_basis, with the entry page link),
                               the unverified_page flag in words, and ": Test entry: not paid" on an
                               owner test installation's row
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
  app/api/projects/[id]/image/ serves a token image the agent uploaded (token image_data)
  app/api/projects/[id]/token-image/  the default token logo: a 512x512 next/og PNG monogram of the
                               stored ticker (validated A-Z0-9 only) on a colour from the project id;
                               the link carries ?s=SYMBOL and 404s unless it matches the stored ticker
  app/mcp/route.ts             hosted MCP server (Streamable HTTP, stateless, Bearer token)
  app/oauth/{register,authorize,token}/   anonymous OAuth for MCP clients
  app/github/verify/(route, callback/route)  v2.9 B9: the sign-in link (GET confirm page, POST to GitHub) and
                                             GitHub's callback; re-export github-verify.ts handlers
  app/.well-known/             OAuth discovery metadata
  lib/earnkit/
    db.ts                      postgres.js pool (DATABASE_URL)
    dates.ts(+test)            formatDeadline: the one human date format ("Oct 6, 2026, 06:51 UTC");
                               machine fields stay ISO
    cli.ts(+test)              pure helpers for scripts/campaign.mts: USAGE, cliErrorLine (one
                               readable line per error), operatorKeyProblem, fallbackProblem,
                               parseFallbackPicks (--winners ranking [--split] or id:amount[:reason])
    program-file.ts            zod format of programs/*.json (+ starter limits, optional max_award_usd,
                               v2.7.1 optional pool_usd (stated in reward with a pool word, never on a campaign),
                               pool_source_url (only with pool_usd), min_award_usd (below max, in reward),
                               token_policy encouraged|allowed|off, default encouraged; tokenPolicyLine);
                               v2.6 §4: builder_bonus (default true; false opts out); Ruling 8 (plan):
                               a windowed program with the bonus on (not opted out, not a campaign)
                               needs starts_at; v2.7 §2: guide facts with their own source_url —
                               logo (GuideLogo, programs/<id>.svg|png, Ruling 23; logoFileProblem), past_rounds
                               (PastRound: newest first, ≤5, counts nullable C2, own C4, themes_of ≤ winners M3), focus (Focus, ecosystem Ruling 7),
                               best_bet (ShortText, only with past_rounds or focus, Ruling 8), difficulty_override
                               (DifficultyOverride, Ruling 5), winners_per_round (Ruling 6); requirements' `todo` (C5) and
                               requiredWithoutTodo (programs:check refuses a required item without one);
                               v2.8 Task 6: DifficultyOverride is a stated level (optional estimate: true) or
                               the EarnKit rating { level: Easy, rated_by: earnkit, source_url } (Ruling 12);
                               any_chain (default false; chains [] only then, Ruling 13); isOptimismUrl
                               refuses optimism.io hosts (Ruling 15); v2.8 Task 12: results { url (https),
                               expected (date) } (optional; programs.results; Arc 2026-10-21)
    programs.ts(+test)         v2.8.1 §B8 card needs_repo (the program file's needs_repo, column
                               programs.needs_repo; programs:check requires it, needsRepoMissing); list/get/upsert programs (source: 'file' | 'sponsor'); v2.7.1 pool_usd and
                               poolFacts (card pool_usd/pool_plus/pool_line); build_help
                               (kits/starter + one start command), trust() (verified_at: skip
                               re-reading sources within 7 days), trustFor (sponsor programs: an
                               escrow note, no verified_at), perWinnerUsd (tie-break amount); programCard/
                               programDetails (pure): sponsor campaigns get quoted title/name,
                               generic rules and a neutral description, their own text only
                               in sponsor_content; v2.6: ProgramRow.builder_bonus (upserted from
                               the file), Card.builder_bonus = bonusOn minus the status check
                               (false for every campaign); v2.7: ProgramRow/Card gain logo, past_rounds,
                               focus, best_bet, difficulty_override, winners_per_round, chains and Card.difficulty
                               (difficultyOf); upsertProgram writes them; get_program's guide block (guideBlock: guide
                               { text, difficulty, best_bet, sources } + guide_note, curated programs only) with
                               guideBonus (the open round's pool so far); v2.8 Task 6: ProgramRow/Card/
                               openProgramFacts carry any_chain (landing tile "Any chain", guide page
                               "· Any chain"); match.ts CHAINS gains avalanche (43114 / Fuji 43113) and
                               matchRepo skips chain and mainnet checks for any_chain programs; fix round 1:
                               investment (card "up to $1M investment", pool.ts eachLine, Ruling C5);
                               present.ts byEase/byEaseThenPrize sort Easy first in the agent's tables (C4)
    submission.ts(+.test.ts)   prepareSubmission, rememberedWalletQuestion (pure)
    projects.ts(+test)         v2.8.1 §B9 openEntries (this installation's entries in open,
                               non-campaign programs, with submitted); v2.8 Task 8: startEntry (the entry at confirmation: ownEntry or insert,
                               confirmed_at/complete_at set once, "skip" never on a row with a token;
                               proof_line_missed, Ruling C24: the last "go" stopped at the proof line);
                               recordSubmission (campaigns: no self-entry, required fields
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
                               bonus: this repo's coin is entered in <program>" (repoCoinPrograms);
                               v2.6 §3: every bonusOn program checks the submission
                               (submissionBasis, pure: page / unverified_page / confirmed, stored in
                               submission_basis; builder_submitted: true -> submission_confirmed_at,
                               Ruling 5), bonus_join (the one step that joins, for the reply),
                               bonus_round (the open round, for the reply's link, with ends_label:
                               entry-text.ts roundEndLabel, Ruling 29); repo_held (final review M1:
                               an earlier eligible entry, or the repo's coin on another entry here,
                               holds the repo; bonus_round is then null); Ruling 23: the
                               same installation re-recording the same project in a non-campaign
                               program updates its row (ownEntry, under an advisory lock; no daily
                               charge; coin_url returned); Ruling 10: a valid payout_wallet is the
                               installation's last wallet (givenWallet: an invalid one fails the
                               call, Ruling 22); owner test installations never block a repo
    submission-proof.ts(+test) v2.6: proofCheck -> ProofOutcome (ok | unreachable: any fetch failure,
                               non-2xx such as 405, oversize, Ruling 15 | refused, `loaded` when the
                               page loaded without the link); recheckUpdate (pure, Ruling 4: page /
                               no longer eligible + confirmation cleared / no change; a confirmed
                               entry still unreachable becomes unverified_page); the daily re-check
                               also re-reads unverified_page entries, only on active bonusOn
                               programs with a pattern. v2.5 §3 builder bonus eligibility #3: proofProblem(program, url,
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
                               v2.6 fetchOwnershipViaApi (the coin gate's read: GitHub contents API
                               with GITHUB_TOKEN, raw only when rate-limited: 429, 403 + remaining 0,
                               secondary limit; 404 missing; the token never logged, Rulings 14, 20);
                               v2.8.1 fetchOwnershipLatestBranch (push activity, newest first, then
                               the file at that commit from raw; null on any failure), shownBranch;
                               parseOwnershipFile (payout_wallet; plus creator_wallet and token lines
                               for token launches, v2.6 `codes`: ticker-free 16-hex token lines,
                               malformed ones ignored), githubRepo (moved to
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
    placeholder.ts             v2.9 A5, pure: placeholderHost / placeholderLink (reserved names,
                               short list, IPs, earnkit.com, github.com/earnkitai) and the builder
                               lines PLACEHOLDER_LINE, LIVE_FAILED_LINE, contractMissingLine,
                               contractUncheckedLine (G15: a contract check that couldn't run)
    verify.ts(+test)           v2.9 A5: liveVerified (safeProbe) and contractDeployed (getCode via
                               rpcFor), cached in url_checks (pass 24 h, failure 1 h; a getCode
                               error is null and never cached, G15), bounded by
                               CheckBudget (ENTRY_BUDGET, LIST_BUDGET); addressesFrom, entryVerified,
                               checkDefaults (tests: fixtures/no-network-checks.ts)
    chains.ts                  CHAINS, Chain, CHAIN_NAMES (import-free; match.ts re-exports them)
    safe-fetch.ts(+test)       SSRF-safe GET (safeFetchText): https on 443, domain names only, DNS
                               resolved once via a cancellable c-ares Resolver (not dns.lookup) and every address public (isPublicAddress: IPv4
                               special-purpose ranges; IPv6 only 2000::/3 minus special ranges, so
                               mapped/NAT64/6to4 are refused), connects to the vetted IP with SNI,
                               cert check and Host on the hostname (pinnedLookup), no redirects, 5 s,
                               4 KB (LARGE_PAGE_MAX_BYTES, 512 KB, for a whole HTML page like a
                               submission proof: passed explicitly, the 4 KB default is unchanged
                               for every other caller); resolver and transport injectable. safeProbe: traction's daily
                               live-link check (v2.6: no longer a coin gate) (any 2xx, body unread, one same-site redirect,
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
                               (replacements 10/day), record_submission 20/day, token launches
                               (v2.8.1: tokenLaunchWallet 10/day per creator wallet, tokenLaunch
                               10/day per installation; v2.8.1 §E17: tokenLaunchShared 500/day for a
                               hosted agent), authorize 60/hour per IP, new installations
                               500/day per registration (installClient), OAuth register a
                               10,000/day ceiling per agent host (oauthRegisterHost, warned at
                               8,000) + 50/hour per IP (oauthRegister, installHour)
                               (oauth-routes.ts; replayed codes free), GitHub matching (list_programs with a user/repos,
                               get_program's repo check) 30/hour per installation, chain checks
                               60/min (/check per IP, sponsor status per installation).
                               enforce() throws RateLimitError ("… Try again in 18 minutes.");
                               countHit (v2.9 T12) counts without a verdict (hit wraps it);
                               routes answer 429 + Retry-After. ENTRIES_PER_CAMPAIGN = 3
                               (recordSubmission counts under the campaign's entry lock)
    repo-cache.ts(+test)       GitHub repo facts for matching (chains, commits since each window
                               start, v2.9 A2 product: the repo's own signals and contract
                               candidates) in github_repo_facts, 1 h per (repo, pushed_at)
    installations.ts(+test)    save / touch installation by token hash or (v2.4) OAuth client key
                               (client_key); memory (GitHub, working_on, last payout wallet);
                               rememberWallets, installationWallets (installation_wallets);
                               v2.9 A7: setFitRepos/readFitRepos (installations.fit_repos);
                               v2.8 Ruling 10: setFitChains (installations.fit_chains, the matched repos'
                               chains, written by list_programs, read by new program alerts);
                               v2.6 Ruling 10 (plan): rememberWallet/rememberedWallet (the
                               installation's last wallet, payout_wallet; rememberedPayoutWallet is
                               its v2.4 alias);
                               testInstallationIds (v2.6 Ruling 6 (plan)): EARNKIT_TEST_INSTALLATIONS,
                               comma-separated ids, malformed parts dropped with one console.warn per
                               distinct value naming positions only, never the text;
                               v2.8.1 §E: connectInstallation (the group root to act as, the token's
                               own id, shared_client), sharedGroup, saveInstallation(..., shared)
    identity.ts(+test)         v2.8.1 §E18: findEarlier / offerPickup ("Pick up your N earlier
                               entries?" from what this call states), answerPickup (yes needs this
                               agent's proof line in an earlier entry's repo), linkInstallations
                               (installations.builder_id, rows move to the oldest root); v2.9 T12 (G0):
                               provedRepos picks the proof repo a group proved (N1), pickup.read caps
                               earnkit.txt reads at one an hour (N2), the duplicate with the token stays (N3)
    oauth-routes.ts(+limits test) register + token + authorize handlers (app/oauth/* re-export them);
                               logLimited; v2.9 T12 (G0) ipFloor: a known hosted service's redirect
                               host is counted, never refused, at the per-IP floor (logged once)
    oauth.ts(+.test.ts)        stateless OAuth: register (v2.4: a random nonce in every client id;
                               v2.8.1: s=1 for hosted clients), isSharedClient, HOSTED_CLIENT_NAMES,
                               HOSTED_REDIRECT_HOSTS, hostedRedirectHost (v2.9 T12), clientLimitKey, registrationLimitKey,
                               authorize, code -> token (+ shared, limitKey), metadata, clientKeyOf;
                               publicOrigin = EARNKIT_URL (production throws without it; no Host
                               fallback)
    mcp.ts(+test)              v2.9 F25: CONFIRM_ENTRY_DESCRIPTION and SPONSOR_CAMPAIGN_DESCRIPTION under 800 characters (mcp.test 11.8).
                               v2.9 A3: tell_earnkit registered (TELL_EARNKIT_DESCRIPTION, not read-only);
                               report_outcome removed (8 builder tools).
                               v2.8.1 §C15: run() logs an unexpected error as "[mcp] <tool> error <id>"
                               and returns unexpectedErrorText(id), never the raw error.
                               v2.8 Task 5: createMcpServer(ctx, { campaignOpen }) and
                               toolDescriptions(campaignOpen) (campaign sentences only while one is open).
                               MCP server: the 5 builder tools, plus sponsor_campaign only when the
                               escrow is configured; descriptions and schemas; v2.6:
                               OWNERSHIP_FOR_TOKEN (the agent writes and pushes `token: <code>`
                               itself), record_submission's builder_submitted (ask "Did you submit on
                               <site>?" first), local_repos[].url (Ruling 13), builder text never
                               names a tool; v2.7: SERVER_INSTRUCTIONS exported (scanned by
                               copy-review), list_programs' description leads with "What can I earn?", all say "token", never name Clanker
                               (Ruling 18), get_program describes the guide
    guide.ts(+test)            v2.9 A4: rowDifficulty (row = max(program level, distance), real_users rule),
                               harder, levelRank; difficultyFrom floors (investment Hard, "needs a live
                               product" at least Medium, then match_precision under 5% one step harder)
                               v2.7 §2 (pure): difficultyOf/difficultyFrom (Rulings 2–5: odds from the
                               newest round with both counts, ODDS_BANDS Easy ≥0.25 / Medium ≥0.08 / Hard; else an
                               estimate, never Easy; the override wins), difficultyLabel, programGuide → Guide (Ruling 9
                               header, difficulty, "What won last time/before" + event C3/C12, ecosystem focus, best bet,
                               builder bonus), v2.8 difficultyBasis/difficultyText ("Medium (estimate). Basis."), guideText (the agent's text), guideSources/guideSourceList, wonHeading;
                               final review M3: wonLines drops "of N" when a round's themes_of is below its winners
    human-text.ts(+test)       v2.8 Ruling 16: humanStrings (string/template/JSX text of a source file, via the TypeScript AST) and humanTextFiles; the test bans the em dash in all human text;
                               final review M1: notHumanText skips .test.ts/.test.tsx/.test.mts, and walkDir never enters a fixtures directory
    no-cell.ts                 NO_CELL (''), the empty table cell or chip; import-free so the client ProgramCard shares it (final review M1); present.ts re-exports it
    present.ts(+test)          v2.8.1 T7: enterableWithoutRepo (the no-repo offer's pick, for tools.ts).
                               v2.9 E20: FirstMessage.wonUsd; withWonLine joins "Builders using EarnKit won $X."
                               to the money headline, else puts it first in the body (once; absent at 0).
                               v2.9 A3: FirstMessage.hidden drops programs from tables and the offer;
                               entriesLine lists "<title>: applied outside EarnKit" (APPLIED_OUTSIDE).
                               presentFirstMessage (v2.7 §3): alerts, v2.8.1 §B: "Your entries"
                               (entriesLine, right after any news), "(entered)" / "(needs a repo)" in the
                               Program cell, $X leaves out investment and new-work rows (qualifies), the offer
                               is the best repo fit (bestFit: Easy first, then top prize, Ruling F5; never an investment
                               or an entered program); buildNew only when no repo fits; no repo: needs_repo false only), "EarnKit matches you to $X in
                               top prizes you qualify for" (v2.9 F21: moneyText(openMoneyUsd) of the qualifying rows; per-winner prizes of
                               fitted programs; $0 keeps "Your repos fit these open programs:") with
                               repos, else "$X in top prizes is open right now" (youCould/githubGiven, Ruling 11;
                               that table's "Prize" column becomes "You could win") with a Difficulty
                               column (difficultyCell: guide.ts difficultyLabel, or NO_CELL ('') with none;
                               Ruling 25: a repo whose coin is entered in another program, repoCoins,
                               shows "no builder bonus: …" in its own repo cell instead of a bonus
                               column, Ruling 13 (plan)), open EarnKit campaigns only, at most 5
                               others, ideas (one per line) when the builder has no repo, sponsored
                               last, one offer (keep going / campaign entry / fastest fit / "Pick one
                               and I'll start." / build something new; final review M9: the no-repo
                               close is never "qualify", even with an open campaign) closed by the
                               builder bonus sentence (bonusClose: sum of the pools already read for
                               the programs on screen with a bonus; a campaign offer never earns the
                               bonus, so the sentence becomes its own paragraph above it instead,
                               Ruling 10 (plan); final review M4: so does an offer whose row says
                               "no builder bonus" (Offer.noBonusId, its pool left out of the sum)); endsOf uses entry-text.ts
                               summaryCloses/deadlineDay (Ruling 29); markdown tables, no emojis;
                               sponsor campaigns never offered; no per-row bonus column or
                               affiliation note any more (BONUS_NOTE removed, Ruling 14 (plan); the
                               policy page keeps that text, linked from the footer and the guide page)
    earnkit-orgs.ts            v2.9 A1: EARNKIT_ORGS (import-free; programs.ts re-exports it)
    host-names.ts              v2.9 C12 (Task 7), import-free: HOST_RESERVED, HOST_CSP, HOST_HEADERS,
                               SITE_PREFIX 'sites/', STATE_PREFIX 'state/'; imported by the host Worker
                               (relative path) and the hosting code
                               (Task 8: contentTypeFor moved here from the Worker, shared by both)
    hosting.ts(+test)          v2.9 C12-C15 (Task 8): HOST_LIMITS, STATIC_EXT, slugFor (P40/P41/G19),
                               zipProblems, stripTopFolder, readZip (central directory + streaming
                               Inflate with byte caps), abuseFlags, usesStorage, withBadge, siteExpiry,
                               builder lines (liveLine, HOST_FULL, HOST_REVIEW, HOST_LINES); issueUpload
                               (Ruling 8, P11), deploySite (staged review, reserved rows, tracked
                               writes), expireSites, cleanDeploys, takedown, approveSite,
                               sitesInReview, refreshSiteExpiry, STAGING_PREFIX; hostUploadPost,
                               hostTakedownPost
    r2.ts                      v2.9 C12: r2Enabled (4 env vars), r2Client (aws4fetch S3: put, list,
                               del, copy; Class A taken from free-tier first, FreeTierFull), R2Error
    free-tier.ts(+test)        v2.9 C13: FREE_CAPS (r2Writes 900k/month, resend 100/day, 3,000/month),
                               periodKey, takeFreeTier (atomic hard cap), freeTierRoom, FreeTierFull
    match.ts(+test)            pure: chain detection (IDs + RPC hosts), repo x program verdicts;
                               v2.9 A1, A2: ownerOk, productScore (tiers), TUTORIAL, DEFAULT_README,
                               SIGNAL_WORDS, INVESTMENT_NOTE; matchRepo applies the tiers when scored;
                               fitsWideProgram (G15: any_chain/investment need an original product);
                               v2.9 A3: applyBuilderFacts (lowering wins; claims), Claim, CLAIMED_MAINNET;
                               matchRepo: an unverified claim keeps a row at after_step "confirm: ...";
                               reportedFacts(ReportedRepo) turns an agent's local_repos report into
                               RepoFacts, keeping url only when campaigns.ts githubRepo parses it
                               (Ruling 13), else ''
    match-projects.ts          v2.9 A3: MatchProjectsInput.said applied before the checks (P15); not_mine skipped.
                               repo matching for list_programs + get_program's eligibility check; v2.9 A1, A2:
                               droppedRepo pre-filter (forks, templates, archived, EarnKit; a tutorial name only
                               costs original, G15), contributed repos by ownerOk share, repoKey merge,
                               SCORE_LIMIT 8 scored under one LIST_BUDGET, MatchDeps seam,
                               cachedRepoAddresses (file contracts for entry checks); v2.8.1 §B6:
                               ReportedRepoInput never fails (reportedChain(s): any chain string, unknown ones
                               dropped, chain ids via match.ts chainOfId, truncated at 20; reportedDate: no timezone
                               = UTC; reportedUrl: bare host gets https://), LocalReposInput skips an unreadable repo
                               (a bare string is a name; no name takes the GitHub link's) and keeps the first 20;
                               mcp.ts list_programs' inputSchema is lenient to match (wallet, name, chains, github_user, repos,
                               agent_can_build: unknown; reportedGithubUser, reportedRepos, tools.ts canBuild);
                               gh (the authenticated GitHub GET, also used by traction.ts)
                               (public GitHub reads, GITHUB_TOKEN; complete reads cached via
                               repo-cache.ts); ReportedRepoInput.url (optional, max 300, validated
                               by githubRepo not zod, Ruling 13); v2.6 Ruling 3 (plan):
                               repoCodeFacts -> RepoCode {fork, hasCommits, aheadOfParent} for the
                               coin gate (repo + commits reads together, the parent compare only for
                               a fork; a private repo reads as "not found (or private)";
                               ForkCheckError when the compare fails); v2.8 Task 11: cachedRepoChains
                               (github_repo_facts only, no GitHub call, for "Also qualifies")
    http.ts(+test)             CORS + small response helpers; secretMatches, bearerMatches
                               (timing-safe; v2.4 cron and veto)
    tools.ts                   tool name -> handler + input validation (+ caller's installation);
                               v2.8.1 T7: prepare_submission leads the coach's questions with
                               needsRepoLine when the program needs a repo and none is known ("<X> needs a
                               public repo … No repo yet? <Y> doesn't need one", Y = present.ts
                               enterableWithoutRepo); tokenProposalBlock gets ctx.tokenDeps' check and
                               availability (the same ticker check as the rest of the flow)
                               v2.8 Task 12: list_programs writes fit_chains (setFitChains) after
                               matching and returns ask_outcome (outcomeToAsk, read last,
                               ASK_OUTCOME_NOTE) at most once per entry; v2.9 A3: tell_earnkit (it
                               replaced report_outcome; builder-memory.ts tell; MCP readOnlyHint false)
                               so list_programs stays read-only; list_programs reads the builder
                               memory once (memoryOf), passes `said` to matchProjects and `hidden` to
                               presentFirstMessage, drops hidden programs from matches; Also
                               qualifies reads it too (TELL_SAVED_NOTE);
                               v2.8.1 §E: ToolContext.ownInstallationId / sharedClient / pickupDeps;
                               walletMemory (no remembered wallet on a hosted agent); list_programs'
                               pick_up offer (PICKUP_NOTE); pick_up_entries (yesNo, PICKUP_TEXT);
                               final review: record_submission's tokenElsewhere (I3: "Builder bonus
                               counts in <program>." for a later program's entry), confirm_entry's
                               C24 kit after a second proof-line miss, tokenLine with the ticker (M8);
                               v2.8 Task 8: confirm_entry (the confirmation step: offer, or startEntry +
                               confirmToken + submitKit); prepare_submission ends with the offer, returns
                               token_line, never a kit or submission_url; record_submission reports a
                               confirmed row's token (no token flow);
                               v2.7: prepare_submission checks readiness first (Ruling 15): not ready → "Before you
                               submit: …" (notReadyLine/todoOf), no token block, shown_wallet or ticker check; ready → the
                               token block (tokenProposalBlock) and the Token row; list_programs closes on bonusClose;
                               includes sponsor_campaign (create/status/award). ToolContext.tokenDeps
                               (gate/check/deploy fakes) is test and e2e injection only; the MCP
                               route never sets it. ToolContext.roundPoolsWei overrides the builder
                               bonus pools read (default bonus-rounds.ts roundPoolsWei; null = the
                               round froze), ToolContext.repoCoins the repo-coin read (default
                               tokens.ts repoCoinPrograms), ToolContext.matchProjects overrides the
                               GitHub/local-repo matcher (default match-projects.ts matchProjects);
                               list_programs passes githubGiven (a GitHub user or repo list given
                               now or remembered) to presentFirstMessage for youCould (Ruling 11);
                               prepare_submission returns shown_wallet (Ruling 30: the wallet line's
                               wallet, for the agent to echo as record_submission's payout_wallet;
                               record_submission never reads the remembered wallet)
    tokens.ts(+test)           deployToken via tokens.fun /api/v1/deploy (TOKENSFUN_DEPLOY_API_KEY;
                               EARNKIT_TOKENSFUN_TIMEOUT_MS, default 120000): atomic claim
                               (token_url='pending', token_repo_key; refused when another project on
                               the repo has a token: repoTokenUrl/repoHasTokenNote; v2.8.1
                               token_claimed_at), released only when tokens.fun said, in JSON with
                               no tx hash or token address, it stopped before minting (outcomeOf: a
                               4xx, minted:false, or a 503 with one of tokens.fun's exact pre-mint texts,
                               knownPreMint503); the 503/revert
                               ones retried once (RETRY_PAUSE_MS) under the same claim, then
                               NOT_LAUNCHED_YET; unknown outcomes kept (LAUNCH_STUCK +
                               launchStuckAgent); a 429 says when (retryAtOf: retry_after ISO or
                               seconds, retry_after_seconds, retryAfter, Retry-After; tryAgainAfter,
                               walletLimitNote); LAUNCHING/LAUNCHING_AGENT; v2.8.1 stuckLaunches
                               (claims pending > STUCK_LAUNCH_MS, for the cron's needs_owner),
                               launchStuck, launchClaimedAt;
                               tokenLaunchesAvailable (deploy key set); TokenStatus/TokenOutcome,
                               setTokenStatus (only rows with token_url IS NULL), EARNINGS_LINE,
                               TOKEN_TERMS, decodeImage, xProfileUrl; v2.5: coin_address written
                               with the launch, Base only (M9, Ruling 24); repoCoinPrograms
                               (Ruling 25: the program each repo's coin is entered in)
    token-proposal.ts(+test)   v2.3 proposal: cleanTokenName (text + brand rules), tickerProblem
                               (3-6 A-Z0-9, TICKER_RESERVED, brands), tickerCandidates, proposeToken
                               (tokens.fun check-ticker; unreachable -> first clean candidate, noted),
                               monogramFor (12-colour palette); v2.7 Ruling 16: proposeToken(projectName,
                               check, repoUrl) never null — name: project, "<name> Token", repo name (repoNameOf), v2.8.1
                               the name without brand words (nameCandidates, unbranded: "ArcPay" → "Pay Token"), "<TICKER>
                               Token"; tickers: a fallback name's first, then project, repo, initialsCandidates, ENTRY…; ≤12
                               checks in parallel batches of 4 (v2.8.1), a taken ticker never
                               proposed (C6), else "ticker not checked for duplicates"; titleCase
    token-offers.ts            v2.8.1 fix round 1 (§A2): the pair the Yes line showed (token_offers:
                               offerKey, saveOffer, readOffer); confirm_entry's "go" launches exactly it.
                               v2.9 B10: recordDecline, declines (token_declines, per login and
                               owner/repo; once per offerIdentity, G12), DECLINES_MAX = 2;
                               saveOffer(firstReply) and firstReplyShown (first_reply_at, G14)
    token-gate.ts(+test)       tokenGate (v2.6 §3): policy, a public repo with code (codeProblem over
                               match-projects.ts repoCodeFacts: commits, a fork only when ahead of
                               its parent, Ruling 3), ownership (ownerProblem: earnkit.txt, read via
                               the contents API (ownership.ts fetchOwnershipViaApi) or the dev/test
                               override, must carry the agent's ticker-free "token: <code>":
                               tokenCode/tokenLineFor(installationId, repoUrl), the first 16 hex of
                               an HMAC of "token-line:v2:<installation>:<normalized repo>" under
                               EARNKIT_AUTH_SECRET, TOKEN_CODE_LENGTH; the v2.5 "token: <SYMBOL>
                               <code10>" line still counts for that ticker, legacyTokenLineCode,
                               PROOF_LINE_PREFIX (Ruling C24: how the proof-line miss starts),
                               Ruling 1; no wallet line needed), sanctions screen; no live-link
                               check; first failure as a reason in plain builder words (never the
                               file or the line) plus agent_note with the technical detail (final
                               review M7: the exact line to write and push); repo/owner/screen
                               injectable (GateDeps); v2.8.1 §A3: GateDeps.latest (the most recently
                               pushed other branch, ownership.ts fetchOwnershipLatestBranch; off with
                               an injected owner or the dev/test override), ownerProblem's agent note
                               says what was found where, the reason names the default branch
                               (GateResult.branch → TokenOutcome.proof_branch)
    token-launch.ts(+test)     v2.8.1 §A: launchReplyMs (EARNKIT_LAUNCH_REPLY_MS, 40 s), withinReply
                               (past it: LAUNCHING once deploying, else STILL_CHECKING /
                               STILL_CHECKING_LAUNCH; the flow runs on), pendingOutcome (an own
                               pending claim: launching, or LAUNCH_STUCK when settled or > 10 min),
                               launchLimit (10/wallet + 10/agent a UTC day, "Try again after HH:MM
                               UTC"), WALLET_LIMITED/AGENT_LIMITED; confirmToken, launchToken and
                               submissionToken take a deadline.
                               v2.8 Task 8: confirmToken (runTokenFlow mode 'confirm'; fixable outcomes:
                               no kit, "say go", the agent note names confirm_entry; a proof-line miss adds
                               CANT_PUSH_RETRY_NOTE and proof_line, Ruling C24; a launch returns name and symbol, M8);
                               the token flow: tokenProposalBlock (prepare_submission's token;
                               TokenBlock.has_bonus, .repo_coin_program: Ruling 25; v2.6: outside
                               campaigns coinRow + walletLine (the remembered wallet prefilled,
                               Ruling 10) + COIN_FOOTNOTE, the agent's note with the token line to
                               push), hasBuilderBonus (v2.6: bonusOn), decideToken (pure rules;
                               a missing wallet at submission is `no_wallet`, Ruling 18; a kept
                               creator wallet is remembered, saveCreatorWallet;
                               record_submission needs the confirmed symbol), submissionToken
                               (record_submission's token part, never throws; loose token object,
                               image ignored), launchToken (launch_token, with live_url/repo_url
                               overrides; Rulings 28, 30: the call's wallet or the entry's own
                               only, never the remembered one, in either mode, else NO_WALLET;
                               Ruling 31: plain notes, technical detail in agent_note,
                               TECHNICAL_TERMS, plainProblem);
                               runTokenFlow: launches configured, decideToken, one
                               token per repo, gate, LIMITS.tokenLaunch, deploy; TokenFlowDeps
                               (gate, check, deploy, store, limit, available) for tests; v2.7:
                               tokenProposalBlock always has a proposal (no project name → the repo name; neither → no
                               block), C6: the final ticker is re-checked after the one-token-per-repo check (M8) and
                               before the gate (taken → no launch, plain note; unreachable → launch); plainProblem says
                               "Token name"; C7: entryMissing (prepareSubmission over FlowProject.requirements, on
                               record_submission's `known` input or the stored project + latest submissions row) runs
                               first: missing required items → skipped/failed, notReadyTokenNote, `needs`,
                               notReadyAgentNote, nothing proposed or deployed (campaigns, skip, policy off exempt)
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
    leaderboard.ts(+test)      v2.8 Task 5: earnkitCampaignOpen() (one query, memoized 10 min).
                               data for the leaderboard and entry pages (incl. sponsor state and
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
    confirm.ts(+test)          v2.8 Task 8: the confirmation offer (confirmOffer: the builder bonus
                               comes with a token; no-bonus, no-wallet (NO_WALLET_HINT), token
                               elsewhere (Ruling 5) and can't-push (CANT_PUSH) variants) and
                               confirmDecision (offer | skip | record_only | launch). Pure. v2.8.1:
                               yesLine ("Yes: launches $TIP (TipJar) on Base. You earn 40% …",
                               OfferInput.proposal; v2.8.1 §F19: the entry flow's only "40%"),
                               proofLineWaiting (a second proof-line miss); v2.8.1 §C13: token
                               elsewhere is "Ready to submit?" alone (record_only note ''); T7:
                               OfferInput.again (a taken ticker or an unseen pair offered again)
                               names the token without the 40% figure
    submit-kit.ts(+test)       v2.8 Tasks 8, 10: submitKit (the submit kit, returned only by
                               confirm_entry, in four modes), submitModeFor, hostOf, proofFor
                               (Ruling 28), googlePrefill/airtablePrefill/tallyPrefill
                               (MAX_PREFILL_URL), AGENT_FILL_STEPS, kitAgentNote, v2.9 F25 kitReplyNote (confirm_entry's whole kit agent_note: the kit only here, the mode rules, the builder clicks submit, missing answers, then record_submission); v2.8.1 §C14:
                               continuesLine (an investment program's kit: "After the email step,
                               the application continues on a16z's site."). Pure
    submit-hosts.ts            v2.8 Task 10: HOST_MODES and ENTRY_LINK_HOSTS (Rulings 27, 28),
                               the no-agent hosts (DoraHacks, Questbook), prefill and agent-API
                               platforms by host. Pure, no imports
    coach.ts(+test)            v2.8 Task 9: the application coach. DEFAULT_GUIDANCE per field kind,
                               guidanceFor, coachFields, askableKeys, questionsFor (Ruling 26,
                               C15), coachIntro,
                               bankFill and bankEntries (the answer bank's fill and rows),
                               preSubmitCheck, draftTable, fixesLine, applicationOf. Pure.
                               v2.8.1 §C11: questionsFor's `wallet` (WALLET_KEY payout_wallet,
                               walletAsk: joined to contact, else its own item, else the last);
                               §C15: the proof-link fix only on a proof field (links, demo, how it works)
    answer-bank.ts(+test)      v2.8 Task 9: projectKey, v2.9 repoKey (owner/repo), readBank, saveBank (table answer_bank,
                               Ruling 6: per installation, never public), saveApplication
                               (projects.application); final review M6: bankKeepsContact, contact
                               never banked or read under a name: key
    also-qualifies.ts(+test)  v2.8 Task 11, Ruling 29: alsoQualifies (at most MAX_ALSO=3 other
                               open, curated, non-campaign, non-investment (C23) programs the project qualifies for;
                               reuses coach.ts bankFill, then counts with prepareSubmission and the entry's project, so
                               project-known fields are filled, final review I1), alsoText (the table + v2.8.1 §C13
                               "Your builder bonus rides on your <program> entry." with coinIn: the bonus note's one place). Pure. Wired into tools.ts
                               record_submission (non-campaign only) with programs.ts
                               alsoProgramFacts, projects.ts enteredProgramIds, and
                               match-projects.ts cachedRepoChains; v2.9 T12 (G15 M1): canWin (tools.ts
                               alsoCanWin: alerts.ts repoCanWin over installations.ts readFitRepos, else
                               users said for "needs a live product"), testnet-only chains dropped
    entry-text.ts(+test)       confirmTable, enteredTable, keyTable, tokenRow (hasBonus: v2.5 §3,
                               Task 8, "· skip: no builder bonus"; coinIn: Ruling 25),
                               repoCoinNote, TOKEN_FOOTNOTE, siteUrl; v2.6 §3: coinRow and
                               walletLine (one yes for coin and wallet; "(used last time)", M8),
                               COIN_FOOTNOTE, enteredText (record_submission's reply: the coin,
                               then "Builder bonus: <pool> · ends <Mon D> · <leaderboard>", or the
                               one step that joins, or the no-wallet line; M4: a coin not launched
                               yet joins once it is; M1: REPO_HELD), noCoinYet (the agent's
                               no-wallet note, "by <Mon D>"), roundEndLabel/summaryCloses/
                               deadlineDay (Ruling 29: one round date everywhere, the first
                               message's; v2.8.1 §C15: a program deadline in its own time zone,
                               "Oct 14, 11:59 PM ET", from the summary, else deadlineLabel in UTC), boardLink (earnkit.com/bonus/<boardSlug>), shortWallet;
                               v2.7: prizeOf/endsOf (moved from present.ts; prizeOf adds "investment" for an
                               investment program, Ruling C23), bonusRidesOn (v2.8.1 §C13, was bonusCountsIn: said once, in
                               Also qualifies or after "Entered in…"; enteredText's countsIn adds nothing), coinRow is the `Token` row "Your entry gets a
                               token on Base, $X: you earn 40% of its trading fees[, and it joins the builder bonus] · skip:
                               …" (Ruling 17; skip text "say skip for no token (and no builder bonus)", C19), notReadyLine
                               ("Before you submit: …", ≤3 then "and N more"), todoList and todoOf (C5), notReadyTokenNote
                               and enteredText's coin `needs` (C7: "Your token isn't launched yet: the entry still needs …"),
                               confirmTable(missing) shows only Entry and Prize while not ready; no Clanker (Ruling 18)
    fees.ts(+test)             Clanker FeeLocker WETH reads (setFeeSource), the 6 h cache (token_fees),
                               feeAlert (>= $100, per $100 step), refreshFees, launchedCreatorWallets
    funds.ts(+test)            prizeFunds: the payout wallet's balance for the pages (60 s memo, 15 s
                               after a failure, 3 s timeout, no retries)
    alerts.ts(+test)           v2.9 A7: FitRepo, fitRepoOf, alertFit/alertable (new programs only when a
                               remembered repo could win; v2.9 T12: its per-repo rule is repoCanWin,
                               also used by Also qualifies; openCuratedRows), NewProgram (matching facts, difficulty,
                               match floor/precision); installations.ts setFitRepos/bestFitRepos (fit_repos)
                               alertLines (pure, money first; v2.5 §3 Task 8 adds builder bonus
                               wins and its own top-10 tracking), alertFacts, sinceYouLastChecked
                               (seen ids in alert_state, one transaction, 1.5 s budget),
                               sinceLine, SCHEDULE_NOTE, paidBonusWins (paid bonus_payouts rows;
                               table check memoized, M15; wins seen by payout id, M2); v2.6 §3,
                               Rulings 25-26: lines are clauses ("you were paid a <x> ETH builder
                               bonus (as WETH) for <program>, sent to <wallet> (basescan.org/tx/…)
                               · <leaderboard>", "you have $X in coin fees to claim on tokens.fun",
                               top-10 lines with their leaderboard link): one colon in the joined
                               sentence; final review M3: the top-10 standings read only entries
                               eligibleSql(r.ends_at) counts (never a test installation's);
                               v2.8 Task 12: outcome win lines first among wins (announcement rows
                               only, MAX_OUTCOME_WIN_LINES = 3, AlertState.outcomes), newProgramLines
                               (Ruling 10: open curated programs that fit fit_chains or are Easy,
                               MAX_NEW_PROGRAM_LINES = 3, newest first, AlertState.newPrograms),
                               newProgramOf (C23: "up to $1M investment")
    match-loop.ts(+test)       v2.9 A8: recordShown (match_shown, one row per day), saveEntryScore
                               (projects.product_score at confirmation), matchStats (pure, 30 labelled
                               minimum), updateMatchFloors (programs:sync: match_floor, match_precision)
    github-verify.ts(+test)    v2.9 B9: Sign in with GitHub. githubVerifyEnabled (both OAuth vars), createVerifyLink
                               (github_verify_nonces, sha256 only, 15 min), peekNonce/takeNonce (atomic, single use),
                               nonceDetails, ownershipPasses, githubOAuth (exchange, user, repoPerms), completeVerify,
                               verifiedFor, takeHostVerification (P11), callerLogin (G9 sign-in code), verifiedEntryIds,
                               entryVerifyLink (G11: needs the entry's wallet), VERIFY_PAGE (+ orgRepo), CONFIRM_WARNING, codeLine; route handlers
                               verifyStart (confirm page + __Host- cookie), verifyConfirm (POST, 303 to GitHub),
                               verifyCallback (code + state + cookie only)
    builder-memory.ts(+test)   v2.9 A3: TellInput (strict; program_status, repo_facts, signed_in; v2.9 E19 weekly_email
                               { answer yes/no, email? }, which alone is enough), BuilderMemory, MemoryKey
                               (memoryKey: own installation login '', a shared client's verified login, else null),
                               SaidRepo, readMemory (builder_program_status, builder_repo_facts),
                               tell (all checks first, then one transaction; outcomes via
                               saveSelfReport, lost = not_selected), roundLabel, hiddenPrograms,
                               hiddenIds, saidKey, mergeSaid
    outcomes.ts(+test)         v2.8 Task 12, Part G, Ruling 30: OutcomeFile (complete, Ruling C22;
                               entries_from and entries_until both required when complete: the round window, final review I4, re-review I-A),
                               matchOutcomeAll/matchOutcome (repo, then live link, then a unique
                               name), winLine, ReportOutcome, outcomeQuestion, syncOutcomeFile
                               (labels every submitted entry by the announcement day and inside the round window, never one
                               another round already labelled as unnamed: named results,
                               the rest not_selected when complete else unknown; counts only),
                               saveSelfReport (own entry only, NotFoundError otherwise), outcomeToAsk
                               (one submitted entry per call after results.expected; sets
                               outcome_asked_at). Self-reports never alert or count
    copy-review.test.ts        renamed from copy-v26.test.ts in v2.7: every builder-facing string and
                               joined alert sentence (no emojis, "vault", implied affiliation, tool names or file-edit
                               asks; one colon); v2.7: coinWords (Ruling 19: "coin" banned in human-facing text,
                               identifiers/URLs/stablecoin exempt) over builder, agent (SERVER_INSTRUCTIONS, descriptions,
                               notes), landing, guide and campaign-page text; never "Clanker" (Ruling 18);
                               v2.7.1: v271Texts (header, install modal, /programs figure, pills, steps,
                               statsLine, poolLine, bonusClose forms); v2.9 T12: the Part 1 strings (check
                               lines, product-signal, claim, floor and investment notes, a first reply
                               with the token offer) and never an em dash in builder text
    v281-journey.test.ts       v2.8.1 Task 7: the friction audit's 10 builder journeys plus the agent switch
                               (Grok Bot, then Claude Code with pick_up_entries) through the real tools, in
                               its own throwaway database; mocked tokens.fun (check-ticker, the deploy API
                               behind the real deployToken, a slow-deploy variant) and GitHub (repo facts,
                               earnkit.txt); any other fetch gets a 503. Asserts "40%" once per entry flow,
                               the bonus note at most once per reply, every reply under 50 s ("launching"
                               on the slow deploy, then the check-back), a repo is never led with speedrun,
                               no Arc dead end without a repo, the returning recap with no re-offer, and
                               no "open this in Claude Code or Cursor" for an agent that can push
    v29-journey.test.ts        v2.9 Task 12 (Part 1) DB-gated journeys in their own throwaway database: owned
                               repos and noise, Arc Easy and the first-reply token offer, Grok Bot with
                               GitHub sign-in on (the real verify routes, GitHub OAuth mocked) and off,
                               tell_earnkit lowering and raising, placeholders and links that don't load,
                               offer then skip then confirm ("40%" once), cron claims for creator and MINI;
                               Part 2: hosting (12.3: R2 in memory, the Worker's handle over it), Also
                               qualifies precision (12.6b), the won line (12.8), one money figure
                               (12.9), the weekly email (12.10, Resend recorded), /terms (12.11);
                               the cross-reply copy scan
    v28-journey.test.ts        v2.8 Task 12 DB-gated journey in its own throwaway database: no repo,
                               Arc's coach question, the draft and offer, confirm_entry "go" (fake
                               deploy) and the copy-paste kit, record_submission with Also qualifies
                               (Base), Base's prefilled link with no second token, then an announced
                               outcome (syncOutcomeFile) and the win line; every reply scanned for em
                               dashes, Clanker, "coin" and tool or field names
    v27-journey.test.ts        v2.7 DB-gated journey in its own throwaway database (schema.sql, dropped
                               after): real programs/*.json, "What can I earn?" (Difficulty, the bonus close with stubbed
                               pools), get_program's guide, prepare_submission not ready ("Before you submit:", no token)
                               then ready ("a token on Base", no Clanker); local fetch stub for the ticker check
    campaign-page-text.ts      v2.7 §4: every human-facing string of app/campaigns/[slug]/page.tsx as pure
                               functions (campaignEyebrow, closesText, sponsorDisclosureParts, earnkitCampaignBlurb,
                               removedLine…), so copy-review scans them
    logo-check.ts(+test)       v2.7: checkLogoFile(logo, publicDir) reads the file and runs
                               program-file.ts logoFileProblem (used by programs-sync.mts --check)
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
                               refresh, then v2.9 Task 8 expireSites (R2 on; `hosting` in the result),
                               then v2.9 Task 10 sendDigests (RESEND_API_KEY set; `digest` in the result);
                               needs_owner incl. host-review:<slug> (P46), PAY_FAILED_RUNS failed pay steps in a row
                               and bonusWaitsOnOwner (a MANUAL_CHECK or TOP_UP bonus sweep, failed
                               index runs, v2.9 D17 gas low or a claim/collect out of gas); BONUS_WALLET_UNSET when the ledger is
                               skipped (key missing or malformed, off mainnet) while bonusLive,
                               Rulings 19-20; an ended round's scoring failure once, Ruling 23; v2.8.1
                               token-pending:<id> for a launch claim pending > 10 min, CronDeps.stuckLaunches), cronPost
    bonus-rounds.ts(+test)     roundFor (windowed rounds keyed by start day, windowKey, Ruling 21;
                               UTC-month rounds), bookingFor (round or Safe, with the reason; v2.6:
                               the Safe only when !bonusOn, no open round or not active),
                               roundPoolsWei (one grouped read, open rounds only; null = the round
                               froze); v2.6: bonusOn (Ruling 7 (plan): active, builder_bonus !==
                               false, not a campaign; SQL twin `g.status = 'active' AND
                               g.builder_bonus AND g.campaign IS NULL`), boardSlug /
                               roundKeyFromSlug / resolveRoundParam (Ruling 12 (plan)); v2.8.1 §D:
                               rollsOver (the program ended: window passed or closed), rolloverRounds
                               (earliest end first), rolloverPrograms (the repo's submitted, complete
                               entries by the deposit time), currentBonusRound (the round a token's
                               fees book to now; also the near-end collect's), bonusEntryProgram
                               (its program, for every builder-facing bonus note)
    bonus-ledger.ts(+test,     v2.5 builder bonus ledger: BASE_BONUS (FeeLocker, lockers, WETH, Safe),
      +anvil.test)             STORE_TOKENS/CLAIMED_REWARDS, bonusDeposits (attribution: next
                               ClaimedRewards of the sending locker), bonusRpc, scanForward (adaptive
                               getLogs), indexDeposits (cursor), bookDeposit (an open round follows
                               the program window; v2.8.1 §D: once the coin's program is over, the
                               repo's next open entry via rolloverRound, else the Safe; a booked
                               deposit is never moved), lockRound, collectNearEnd (isRevert: only a revert skips a
                               locker), claimFees (bonus wallet then Safe; M10: also when the sweep
                               waits on it), v2.9 D16: claimForOthers (step claim_others after the
                               sweep, OTHERS_CLAIM_MS slice, MINI then creators newest first),
                               claimOwners (each owner once), feeRecipients (EARNKIT_SPLIT_BPS only,
                               cached on projects.fee_recipients); D18 fee_claims ops log,
                               v2.9 D17: GAS_LOW, gasMinWei, NEEDS_GAS, BonusRpc.rewardInfo/ethBalance,
                               sweepToSafe (payWinner + sweepStore), worthIt (10x gas),
                               indexedThrough, roundsCovered, sendCall (run nonce floor, I5),
                               runBonusLedger (the cron step; v2.9: `gas` check first; a malformed key is a skip, Ruling 19;
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
                               alert, idempotent re-run; v2.6 Task 8: an Arc entry on a 405 page
                               counted on the builder's confirmation (unverified_page flag, no
                               503), then e2e-confirm (rolling, no proof pattern): a confirmed entry
                               paid the whole pool after the month ends, an unconfirmed one never
                               ranked, a test installation (EARNKIT_TEST_INSTALLATIONS) shown as
                               "Test entry: not ranked", never paid, out of /api/stats, a late
                               confirmation updating the same entry, the winner's list_programs
                               paid line, a re-run that signs nothing. Skips without
                               BONUS_ANVIL_URL/DATABASE_URL (both must be local)
    policy.ts                  v2.5 Task 9: FEE_SPLIT_BPS (a copy of tokens.fun's split), SAFE_ADDRESS, FEE_ROWS / SIGNAL_ROWS (traction
                               WEIGHTS) / PLACE_ROWS (BONUS_SPLIT_BPS) for /policy; v2.9 re-exports
                               MINI_FEE_RECIPIENT and GAS_WALLET_MIN_WEI_DEFAULT
    policy-constants.ts        v2.9 D16, D17: MINI_FEE_RECIPIENT (Ruling 17, confirmed read-only),
                               GAS_WALLET_MIN_WEI_DEFAULT, EARNKIT_SPLIT_BPS (slot order); a leaf so bonus-ledger.ts can import them
                               (policy.ts imports bonus-payout/traction, which import bonus-ledger)
    landing.ts(+test)          v2.7 §1, v2.7.1: landingFrom (pure: curated cards by prize → Tile JSON:
                               prize = pool_line, else "up to $X per winner", else the curated text;
                               prize_note "up to $X per winner" when different; v2.8: has_bonus and bonus_amount = bonusAmount ("0.42 ETH", "<0.01 ETH", else null);
                               open_text = moneyText(openMoneyUsd(kept)) (v2.9 F21, "$1.1M+"); v2.9 E20 won_line = wonLine
                               (Hero shows it under the stats line); stats_line = statsLine
                               (installs ≥100, bonus paid >0); v2.8: no bonus_pools / bonus_every /
                               bonusPoolsText (Win twice removed); cards sorted by byPool: pools first by size, then the rest by
                               max_award_usd, then deadline); readGuidePage adds the "prize pool" source
                               and readLanding (listPrograms, roundPoolsWei, readStats; rejects when
                               the DB is unreachable); GuidePage.has_bonus / bonus_amount;
                               v2.7 §2: readGuidePage(id) → GuidePage (curated only, else null; rejects
                               on a DB failure, never null)
    pool.ts(+test)             v2.9 F21 (P18): openMoneyUsd (the top prize of every open curated program,
                               summed; never an EarnKit campaign (campaign / earnkit_campaign), a sponsor's
                               (sponsored / source 'sponsor'), closed, not started or ended) and moneyText
                               ("$1.1M+", null at 0), the one money figure; stats.ts re-exports both
                               (present.ts can't import stats.ts). openFigure is gone; poolTotalText is
                               imported nowhere else (human-text.test.ts 11.3).
                               v2.7.1 (pure): usdCompact ("$1.3M", "$840K", rounded down), poolStated (the
                               pool in a program's reward: "$840,000"/"$840K"/"10,000 USDC", its "+"),
                               v2.9 E20: wonLine ("Builders using EarnKit won $X", null at 0).
                               poolLine (a card's big line), poolTotal/poolTotalText (moneyText's formatter;
                               poolTotal feeds the deprecated open_pools_usd/_plus; "+" when rounding drops value),
                               statedPool (a row's pool), amountStated, isGrant, eachLine ("per grant" /
                               "per winner", "$5K–$100K per grant", "500 USDC per grant")
    stats.ts(+test)            v2.5 Task 9: readStats (one aggregate query) / statsFrom (pure):
                               open_money_usd (v2.9 F21: openMoneyUsd over the active rows, open_rows) +
                               open_money_text (moneyText), v2.7.1 open_pools_usd + open_pools_plus (deprecated, still served, Ruling G23), programs_open,
                               bonus_programs_open (v2.6 Ruling 16 (plan): open programs with
                               builder_bonus AND campaign IS NULL, bonusOn's SQL twin),
                               coins_launched (token_status launched), fees_to_safe_eth (v2.5-split coins
                               only, accrued: 1.5x real indexed bonus deposits of EarnKit coins (M5),
                               never round-rest: rows, + bonus money routed to the Safe),
                               bonus_paid_eth, installs; STATS_LABELS for jenil.ai; v2.6 Ruling 6/16
                               (plan): installs, coins_launched, the bonus_deposits_wei coin
                               subquery and (final review M2) bonus_to_safe_wei's coin rows all
                               exclude owner test installations (installations.ts
                               testInstallationIds, EARNKIT_TEST_INSTALLATIONS); v2.7 Ruling 20:
                               bonus_pools_eth (open rounds' `destination = 'round'` bookings, test installations' coins
                               excluded, final review M7), STATS_LABELS.coins_launched
                               = "tokens launched" (key kept); docs.earnkit.com's LiveNumbers reads /api/stats;
                               v2.8 Ruling 30: labelled_entries (never 'unknown', C22) and entries_won
                               (announcement rows of entry_outcomes only, test installations excluded), WIN_RATE_MIN_LABELLED = 30
                               (documentation only, no win-rate claim); v2.9 E20 (Task 10):
                               builders_won_usd (announced won/placed prizes > 0, test installations
                               excluded; wonUsdSql shared with readWonUsd), wonLine (re-exported from
                               pool.ts), readWonUsd (10-minute in-process cache, 0 on error), wonSource
                               (list_programs' seam; fixtures/no-network-checks pins it to 0)
    digest.ts(+test)           v2.9 E19 (Task 10): the weekly email. digestEnabled (RESEND_API_KEY),
                               DIGEST_FROM_DEFAULT/DIGEST_FROM, EMAIL_QUESTION/emailQuestionFor/EMAIL_NOTE,
                               weekStart (Monday 14:00 UTC), digestDue (P17), digestBody, SubKey (G21:
                               installation + login), unsubToken/unsubTarget (HMAC, timing-safe),
                               unsubHeaders, idempotencyKey, MAX_SEND_FAILURES, Mailer/MailError/
                               resendMailer, entryEmail/cleanEmail, askWeeklyEmail (Ruling 13, P16),
                               saveWeeklyEmail, unsubscribe, digestFacts, sendDigests (row lock,
                               free-tier caps), digestUnsubscribeGet/Post
    bonus-board.ts(+test)      v2.5 Task 9: bonusBoard (open/frozen: live ranking from bonus_scores
                               with eligibility in words; review/paying/paid: frozen bonus_payouts
                               minus vetoes, renumbered, top 10 + place holders, amounts, mined tx);
                               openRows/frozenRows/daysLeft/ethText pure; no wallets, flags or
                               veto reasons; a not-yet-booked open round shows with pool 0;
                               OpenEntry.test (v2.6 Ruling 6 (plan)): an owner test installation,
                               listed with the ineligible rows as "Test entry: not ranked";
                               OpenEntry.pattern: "No: submission page not confirmed yet" vs "No:
                               submission not confirmed yet"; a not-yet-booked round shows only for
                               a bonusOn program; Board.ends_label (Ruling 29: entry-text.ts
                               roundEndLabel, shown by BoardView)
    public-pages.test.ts       markup tests of /terms (11.4: section ids, MINI line; 11.5 redirects 301; 11.6 Tokenfi line; 11.7 no /fund or /award in builder navigation), BoardView and the footer link
    install.test.ts            v2.8 Task 5: the install tabs and order, the Claude Code and Codex
                               commands, local icons (logoFileProblem), no editor tab in the modal,
                               llms.txt, README, app/ or lib/, and llms.txt's token/bonus text
    footer-links.ts(+test)     v2.8 Ruling 22: FOOTER_COLUMNS (Product, Resources, Legal, Contact),
                               FOOTER_TAGLINE, EXTERNAL_ALLOW, footerLinkProblems (internal hrefs
                               against appRoutes, external hrefs against EXTERNAL_ALLOW, labels
                               non-empty), appRoutes (every page.tsx folder under app/, dynamic
                               segments kept as "[id]"). Defines DOCS/FOR_SPONSORS/JENIL_X/
                               CONTACT_EMAIL itself (fix round 1: lib/earnkit never imports from
                               app/); app/lib/links.ts re-exports all four. The LINK_CHECK=1 test
                               (fetch, status < 400, 10 s per external link) is skipped unless that
                               env var is set
    traction.ts(+test)         v2.5 traction score: signalsFor (users, live ratio, commit days,
                               contributors, interest, holders, market cap), rankNormalize, rankRound,
                               liveRatio (live_checks), dbStore (bonus_commits, github_users),
                               GitHubBudget, CLANKER_ADDRESSES, scorableContracts, ownContracts,
                               eligibleSql (v2.6 Ruling 6 (plan): excludes an owner test
                               installation, EARNKIT_TEST_INSTALLATIONS, for both the entry and the
                               earlier entry it would otherwise be blocked by; v2.8.1 §D coinSql:
                               the repo's token carried from an ended program counts for a
                               coinless entry; scoredCoinSql scores it), review_flags (single_commit_streak),
                               resolveBonusWallet, scoreRound (daily cache in bonus_scores, batched),
                               scoreOpenRounds (needsOwner: an ended round's scoring failure, once),
                               canFreeze/readyToFreeze (+24 h escape, flagged; no final read also
                               escapes, Ruling 23), finalRanking (eligible at the round end,
                               re-ranked; unread entries last, score 0, NO_FINAL_READ_FLAG; v2.6
                               UNVERIFIED_PAGE_FLAG in review_flags for an unverified_page entry,
                               never `flagged`, so never needs_owner or a 503)
    fixtures/                  clanker-base-launch.json (a real Base receipt, from tokens.fun),
                               bonus-db-lock.ts (test-only advisory lock for the bonus test files),
                               program-file.ts (committedProgram: a programs/*.json without its
                               id-bound logo, for tests that clone files under test ids)
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
    sponsor-rules.ts(+test)    v2.9 F25: SPONSOR_RULES (confirm first, plain text, verification, brand names, label once funded) end create's next_step; award's next_step ends with the approval rule.
                               pure rules: create's five answers and defaults (DraftInput,
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
                               bonus_ledger, bonus_sweeps, bonus_cursor; v2.6, additive:
                               programs.builder_bonus (default true), projects.submission_basis
                               (CHECK page | unverified_page | confirmed, drop-then-add) and
                               projects.submission_confirmed_at; v2.7, additive: programs.logo,
                               past_rounds (default []), focus, best_bet, difficulty_override, winners_per_round;
                               v2.8, additive: programs.any_chain, investment, judging, submit_host,
                               submit_api, form, results; projects.confirmed_at, confirm_choice,
                               complete_at (one backfill, DO block), own_token_url, application,
                               outcome_asked_at; installations.fit_chains; answer_bank; entry_outcomes
                               (UNIQUE project_id, round_label, basis; basis announcement | self_reported);
                               v2.9 Task 9: projects.fee_recipients (jsonb), fee_claims (ops log, never revenue))
  scripts/                     db-migrate.mts, programs-sync.mts (load .env.local); v2.7: programs-sync
                               writes the guide columns; --check (pnpm programs:check) also checks each logo file
                               (logo-check.ts) and the required items' todo; v2.8 Task 12: also validates
                               programs/outcomes/*.json and sync matches them (syncOutcomeFile);
                               v28-complete-at-window.mts: the Ruling C7 ship step (dry run by default)
    db-check.mts                v2.4: applies main's schema + rows, then db/schema.sql twice, on a
                                local Postgres only; checks backfills, defaults, opened_at via sync,
                                the v2.5 bonus tables' constraints, and (v2.6) the migration over real
                                v2.5 rows (main's 1823018 schema): builder_bonus true, no
                                submission_basis, submission_proof_ok_at kept; the basis CHECK
                                v2.7: the migration over a v2.6 program row: empty past_rounds, NULL logo
                                and guide facts, builder_bonus unchanged; v2.8: the complete_at backfill
                                over f4923fb rows (eligible set unchanged, runs once), the kit and bank
                                columns, and (Task 12) results/outcome_asked_at/fit_chains defaults and
                                entry_outcomes' unique key, CHECKs, re-run survival and cascade;
                                v2.9 Task 9: fee_recipients NULL on old rows, fee_claims role CHECK and
                                re-run survival
    token-e2e.mts               v2.3 token flows through the tools layer against a local Postgres
                                and a mock tokens.fun on 127.0.0.1 (gate faked via
                                ToolContext.tokenDeps): default launch, edited ticker, skip, gate
                                failures, policy off, retry with a fixed live_url, 400 refusal (claim
                                released), unconfirmed, monogram PNG (?s= checked), timeout and 502
                                (pending, claim kept), omitted token, existing token, no earnkit.txt,
                                no token: line, a copied wallet, links changed before the claim,
                                one token per repo (incl. the unique index), the 3-a-day limit, no
                                deploy key, token.proposed echoed through the MCP server; the mock
                                also serves earnkit.txt; v2.6: the ticker-free line, the remembered
                                wallet prefilled, no-live-link launch, empty repo / fork gates, a
                                retry after the push; `pnpm token:e2e`
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

Root commands: `pnpm programs:check` (validate program files, logo files, and a `todo` on every
required submission item), `pnpm test` (v2.9 T12: runs `pnpm host:typecheck` first, P42),
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
`EARNKIT_TOKENSFUN_TIMEOUT_MS` bounds the deploy call, default 120000; v2.8.1
`EARNKIT_LAUNCH_REPLY_MS` is how long a launching tool waits before it answers "launching", default
40000),
`BASE_RPC_URL` (optional; default public Base RPC; must serve historic state for scoring),
`CRON_SECRET` (32+ characters; also the GitHub Actions secret), `ADMIN_VETO_SECRET` (32+
characters; also in the owner's shell for veto-link), `CAMPAIGN_PAYOUT_PRIVATE_KEY` (the campaign
payout wallet: the only key on Railway; v2.5: also the builder bonus wallet, which pays WETH and
gas), `EARNKIT_BUILDER_CODE` (optional, default `earnkit`),
`BONUS_INDEX_START_BLOCK` (v2.5: the Base block the bonus index starts from when it has no cursor;
set it at merge time, else the first run reads 2 days back), `EARNKIT_BONUS_WALLET` (optional
v2.5: the bonus wallet's address for traction's exclusions; default derived from the payout key),
`EARNKIT_TEST_INSTALLATIONS` (optional v2.6: comma-separated installation ids of the owner's test
agents; their entries are never scored, ranked or paid, show as "Test entry: not ranked", and
stay out of `/api/stats`; malformed parts ignored with one warning). `GITHUB_TOKEN` is also the
coin gate's `earnkit.txt` read (contents API) since v2.6.
Test only: `EARNKIT_BLOCKSCOUT_URL` and `EARNKIT_OWNERSHIP_BASE_URL` (honored only when NODE_ENV is
development or test).

Sponsor escrow (v2.1), also never on Railway's write path — the server only reads the chain:
`ESCROW_CHAIN` (`base` | `base-sepolia` | `local`), `ESCROW_FACTORY_ADDRESS`, `ESCROW_RPC_URL`
(falls back to `BASE_RPC_URL` on `base`), `ESCROW_LOCAL_TOKEN` (the mock token address, `local`
chain only). `OPERATOR_PRIVATE_KEY` (fallback propose/execute, refund) and `GUARDIAN_PRIVATE_KEY`
(fallback veto) are local only, never on Railway.
