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
  test/mocks/DeployMocks.sol   v2.10 item 13 deploy anvil test only: OwnedTipJar (deployer is first owner),
                               MockGasPriceOracle (getL1Fee, set at Base's 0x420...0F predeploy)
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
archive/                       v2.12 spec 9 (R18): archived features. The app never imports from here. Each
                               folder: MANIFEST.txt (original repo paths), files/<original path> (the moved
                               files), README.md (what it did, its flag, restore), TABLES.md (its tables, kept
                               with COMMENT 'archived v2.12'). apps/frontend/scripts/archive-restore.mts
                               <feature> moves the files back (git mv).
  sponsor-campaigns/           EARNKIT_SPONSOR_CAMPAIGNS: the sponsor_campaign tool (mcp-sponsor.ts,
                               tools-sponsor.ts snippets), sponsor.ts(+test), sponsor-text.ts, /fund, /award,
                               /api/sponsor/[ref]/check, app/components/{wallet.ts,WalletGate.tsx},
                               scripts/sponsor-e2e.mts. contracts/ untouched; read-side modules stay live
  starters/                    EARNKIT_STARTER_REGISTRY: programs-starters.ts(+test) (build_help: KITS,
                               AGENT_SERVICE_STARTER, CAMPAIGN_STARTER; the starters table's writes/reads)
  tool-aliases/                EARNKIT_TOOL_ALIASES: README + MANIFEST only; aliases.ts moves on or after
                               2026-11-09 (scripted in the README)
  program-leaderboards/        EARNKIT_PROGRAM_LEADERBOARDS: README + MANIFEST only; /campaigns/[slug] and
                               campaign-page-text.ts move at go-live
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
  app/llms.txt/route.ts        v2.13: GET /llms.txt, the agent-readable summary (install, "What can I
                               earn?", program guides earnkit.com/programs/<id>, the tools, live numbers
                               (C9)): lib/earnkit/llms/v213.txt (no builder bonus, "The leaderboard" section, earnkit.com/leaderboard);
                               v2.14 T3 deleted v212.txt with the Bench switch
  app/leaderboard/{page.tsx,BenchView.tsx,BenchRowItem.tsx,Podium.tsx,bench-load.ts}  v3.1 site T8 (Leaderboard board):
                               SegTabs All/Base/Backed (filterTabs; old ?chain=arc/?weekly=1 filter, mark no tab), Podium
                               (page 1 rows 1-3: blue/navy/rust, METAL place pills), panel rows (BenchRowItem: one link,
                               XHandle link={false}, Backed tag, streak, ScoreText 30), Pager (?page=, LEADERBOARD_PAGE 20,
                               pageHref); under RANK_MIN_POOL no "#N"/metal pills, and (solo launch) no podium, no SegTabs,
                               every builder a plain row, countLine says BENCH_EARLY (no number), the panel ends with one
                               InviteRow (BENCH_INVITE + install CTA); emptyLine (Base, Backed, else BENCH_EMPTY);
                               FilterChip deleted. History below:
                               scoring and clarity T3 (R9),
                               v3 Stage 3 T4 (spec 5.8): /leaderboard ("Leaderboard"; moved from app/bench, identifiers kept):
                               H1, benchLine ("N builders. Ranked by Shipping."; BENCH_TOP_EMPTY at 0), the filters as hairline
                               pills (FilterChip: links with aria-pressed, 44px on a phone, on = white fill with black text;
                               chain/weekly/Backed under EARNKIT_RAISING; filterHref: /leaderboard?...), 16 cached variants
                               (unstable_cache, 60 s, PROFILE_TAG), then one ROWS list. BenchRowItem: a hairline row,
                               `[2.5rem_1fr_auto]` on a phone (project and fact on a second line), `md:[3rem_1fr_1fr_5rem]`:
                               "#N" in Display 24px (the rank line sr-only), photo + name (the link is the whole row) with
                               @handle, chain logos and the Backing pill under it, the project over its best fact (two lines,
                               no middle dot), the Shipping number in NUM 24px; names and projects wrap (R11, no truncate,
                               no nowrap); BENCH_EMPTY + BENCH_SHOW_ALL only for a filtered view with no rows
  app/feed/{page.tsx,FeedView.tsx,FeedStats.tsx,FeedRow.tsx}  v3.1 site Task 9 (Feed board): /feed: H1, week tabs
                               (FEED_TABS 3, ?week=<monday>, pickWeek falls back to the newest), FeedStats (feedWeekStats,
                               cached ['feed-stats-v31', monday]), full-width dark FeedRows, FEED_PAGE 10 a page (?page=);
                               FEED_EMPTY on a neutral card with "See the leaderboard"; solo launch: FeedStats only from
                               FEED_FEW (3) builders shipped, and a week under FEED_FEW rows ends with one InviteRow
                               (ACTIVITY_INVITE_TITLE/TEXT + install CTA)
  app/[handle]/{BenchProfileView,ShareButton}.tsx, app/[handle]/site/*  v3.1 site Task 7 (Profile, BackedBuilder,
                               NewBuilder boards): BenchProfileView({ data, site, page }) lays out two wrapping rows:
                               HeroCard (blue: photo, Kaftan name, metal standing pill from site.standing, @handle, X,
                               GitHub, white Share; the inset project panel with the EarnKit mark or a letter tile, the
                               Base tile, about, link; noProjectLine / confirmingCardLine instead), ScoreCard (navy,
                               ScoreRing), StreakCard (rust, 12 squares from the grid, this week lit from site.thisWeek by
                               lib/earnkit/site-streak.ts withThisWeek,
                               streakNote, weekLine), ActivityCard (white, live dot "Shipped <ago>", 3 week cards a page
                               via ?page=, Pager, dashed nextUpdateLine under 3 cards), TokenCard (only site.token, v4.0: the builder's token, X photo in the circle, "Trade" / "holders"),
                               HighlightsCard (a linked item is an <a> in a new tab with an arrow); then Footer minimal. No points, Originality, 52-week grid, rank number,
                               Earned, tabs, visitor row or badge (plan S15; MoneyTab and ProjectTab deleted).
                               BenchProfileSkeleton: flat s-panel shapes with the name. ShipGrid/BadgeCopy stay (unused
                               on the page; shippedWords and the badge route remain)
  app/components/site/Money.tsx  v3.1 Task 7 fix 1: money text whose currency signs render in Funnel Sans (Kaftan's "$"
                               reads as "S"); used by the Token card, the landing chip and Opportunities' numbers
  app/components/ui/{ChainLogo,UpdateCard}.tsx (v4.0 Task 11: RaisingPill deleted)  v2.13: chain logo chips, the Raising pill, the
                               long and square update cards (v2.14 T8: card.titles as plain text, one on the square)
  public/images/chains/{base,arc,robinhood}.svg  v2.13: chain logos (arc and robinhood are monograms until
                               the owner supplies the brand SVGs)
  app/page.tsx                 home (v2.7 §1): revalidate 600; getLanding() then HomeView
  app/HomeView.tsx             v3.1 site T6 (Landing board): data-ek-deep root, PAGE_COL_WIDE column: landing/Hero, Steps,
                               Activity, Opportunities (#earn), full Footer; landing null (failed read) → hero (no chip) and Steps
  app/components/landing/      v3.1 site T6: Hero (chip to #earn, one-line Kaftan H1, HERO_SUB, CTA_INSTALL InstallButton,
                               AGENT_MARKS), HeroArt (client: painting srcSet + SVG arch clip ARCH_PATH, dusk tint, sunset
                               glow at the pointer via getScreenCTM, drift; nothing moves under reduced motion), Steps (STEPS;
                               Earn adds backing only with raisingEnabled), Activity (landing.activity cards, activityMeta,
                               invite card once at 1 to 2, md:col-span-2 beside one card, none at 0; the cards are one a
                               builder, landing.ts oneEach), Opportunities (landingPrograms cards, #earn, EARN_FOOT)
  app/lib/landing-cache.ts     v2.7: getLanding() = unstable_cache(readLanding, 600 s); failure → logs
                               [landing], await connection() (never prerendered), null;
                               getGuidePage(id) (React cache): gatedGuidePage — id ^[a-z0-9-]{1,64}$ and in
                               the cached curated id set ['guide-ids-v27'] (landing key 'landing-v3-<featured handle>'), else null with no per-id read;
                               then readGuidePage ['guide-v27'], 600 s; failure → [guide], connection(), 'error'
  app/docs/{page,DocsView,DocsNav,InstallCard}.tsx  v3.1 site T10 (Docs board): /docs, force-dynamic (W9, no DB read); every string in
                               lib/earnkit/docs-copy.ts, the agents' steps and commands only from sections/agents.tsx: side nav
                               (five anchors; DocsNav, client: the lit item follows the hash and the section in view, readingNow
                               pure, aria-current="location"), the light install card (InstallCard, client: SegTabs 'light' tabs in AGENTS order,
                               wrapping, CONNECTOR_LINE above; AgentPanel shows the EarnKit link first for a paste-the-link agent, the note,
                               the steps (numbered from two), the command, copy button + aria-live
                               "Copied"; three numbered steps; GitHubHelp #github "No GitHub yet?" from docs-copy DOCS_GITHUB: Lovable,
                               Bolt, the v0 note), the
                               week / score / money cards (Backing only while raisingEnabled), the blue selectors strip
  app/programs/page.tsx        v3.1 W10: permanentRedirect('/#earn') (the landing's Earning opportunities)
  app/programs/[id]/page.tsx   v2.7 §2: the guide page; revalidate 600; null → notFound(); 'error' →
                               the Unavailable panel (HTTP 200, never a 404); generateMetadata
  app/programs/[id]/GuideView.tsx  pure guide render, v3 Stage 3 T4: the 56px ProgramLogo beside the H1, the facts as
                               separate muted spans (guide.header split on " · ": the award, "ends <date>" / "rolling" /
                               "closed" / "not open yet", then GuidePage.chain or ANY_CHAIN; stacked on a phone, hairline
                               dividers from md), an upcoming program's opens_note, the Difficulty line, AskAgent (open
                               programs only), the parts as one ROWS list (What won, What X wants now chips, Your best bet;
                               H2 left, content right from md), "All programs" as a TEXT_LINK and the Sources links spaced
                               apart (shownUrl); exports askPrompt, ANY_CHAIN and Unavailable
  app/programs/[id]/AskAgent.tsx   client button opening AddToAgent with "What can I earn on <title>?"
  app/components/sections/AddToAgent.tsx   "Add to your agent" install panel (hero, the Open programs
                               "Ask your agent", the guide's AskAgent with "What can I earn on <program>?"); START_PROMPT;
                               v2.8 Task 5: AGENTS (Grok Bot, Claude Code, Cursor, Codex, Muse) with
                               local icons in public/images/agents/ (sources in the comment;
                               v2.8.1: grok-bot.png is Grok Bot's own app icon, shown in color, not
                               Grok's logomark; muse.svg is Muse's logo from muse.ai; SVG marks
                               take the tab's one color),
                               `after` approve lines
  app/components/sections/{ProgramCards,ProgramLogo}.tsx  ProgramLogo (v3 Stage 3 T4): the local <img> (path re-checked)
                               on a white disc, or the Ruling 1 monogram (monogram() is shared with landing/Opportunities);
                               ProgramCards (v3.1 T6): a shim (money line + Opportunities) kept only because copy-review.test.ts
                               (P0-owned) imports it; nothing under app/ renders it. ProgramRow.tsx is gone (v3.1 T6)
  app/components/sections/carousel.ts  v2.8 Ruling 20: pure scrollStep (one card + gap, clamped) and
                               arrowState (prev/next enabled; both off when nothing overflows); v3 Stage 3: no caller
                               (UpdateCarousel is gone), kept with carousel.test.ts. StatsStrip.tsx is gone (v2.7.1);
                               BuilderBonus.tsx ("Win twice") is gone (v2.8); HowItWorks.tsx is gone (v2.14 T3)
  app/components/sections/agents.tsx  v3 Stage 3 T5: a plain module (no 'use client') read by the install sheet (client) and
                               /docs (server): MCP_URL, CONNECTOR_LINE, tabKeyTarget (both tab rails), AGENTS (name, local icon, optional note, the install steps per agent;
                               v3.1 GTM W1: Grok Bot, Muse, OpenClaw, Hermes, Claude, Claude Code, Cursor, Codex; fields install +
                               installLabel + installNote (one-click), stepsLead, message (a copy-message box), last), GROK_BOT_PROMPT,
                               grokBotPromptLink (grokbot://app/v1/prompt?text=, at most 1000 chars), MUSE_MESSAGE, Command
  app/components/common/InstallButton.tsx  v2.7 fix round 1: a button that opens AddToAgent; v3.1 T5: `label` prop
                               (NAV_INSTALL in the nav, CTA_INSTALL in the footer)
  app/components/common/Footer.tsx  v3.1 site T5 (Foot board): variant 'full' (default: a rounded card over the Panini
                               painting, lazy <img srcSet> of public/art/foot-panini-*, FooterLight, FOOT_CTA in Kaftan, the
                               install pill, the bar: wordmark, FOOTER_COLUMNS links, ART_CREDIT, EarnKit's X) or 'minimal'
                               (profile: the bar only, "Get your page" and Leaderboard); the Tokenfi line under both
  app/components/common/Header.tsx  v3.1 site T5 (Nav board): transparent, not sticky, 1200px column: wordmark, NavLinks
                               (Leaderboard, Feed, Docs; no Programs), the blue install pill; two rows under 640px
  app/not-found.tsx            launch ready L10, v3.1 T10 (NotFound board): the rust card, NOT_FOUND_BIG/TEXT/HOME/METADATA (site-copy.ts), full footer
  app/components/common/Button.tsx  v3 Stage 3 T1: BTN_PRIMARY (pill, ek-brand fill, white text, ek-accent hover),
                               BTN_SECONDARY (pill, ek-line-strong outline, ek-chip hover); both 48px
  apps/frontend/DESIGN.md      v3 Stage 3 T1: the one-page rulebook of the flat system (black page, white type, one
                               accent, hairline rows, type scale, contrast table, the profile's PART_COLORS kept)
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
                               v2.10 item 5: one footer line with the token terms links (TOKEN_TERMS).
                               v2.11 T12: a footer link to /terms#what-earnkit-records (RECORDS_HREF).
  app/terms/page.tsx           v2.9 F22 (Task 11): the one legal page, metadata title "Terms", canonical
                               https://earnkit.com/terms; a section nav (v2.11 T12: + What EarnKit records; v2.12 T15: + Builder
                               profiles), then PolicySection (#policy), ProfilesSection (#builder-profiles, always
                               since v2.14 T3, which made the page static),
                               RiskSection (#risk-disclosure), SponsorTermsSection (#sponsor-terms), Footer.
                               /policy, /risk-disclosure, /sponsor-terms 301 here (next.config.ts
                               LEGAL_REDIRECTS, statusCode 301, never permanent: true = 308)
  app/terms/sections/ProfilesSection.tsx  v2.12 T15 (spec 8): /terms#builder-profiles, a Panel laid out as
                               "What EarnKit records" with policy.ts PROFILES_POINTS as a list (v2.14 final fix: the page
                               is made at the X sign-in (install or the one-time link) and public from then on; same X =
                               same page, no question, nothing merged; the read-only App is the only proof; App repos,
                               private too, read with short-lived installation tokens never stored; weekly commit and PR
                               titles, a private repo facts only until titles are on, hidden not deleted when turned off;
                               only confirmed counts; "hide my page"; X read at each sign-in; merger; removal by email).
                               RECORDS_WITH: the login only as the App checked it (or a pre-App check).
  app/terms/sections/RiskSection.tsx  Tokenfi Inc.'s risk disclosure (was app/risk-disclosure/page.tsx),
                               text unchanged, restyled onto the site's panel and ek tokens
  app/terms/sections/SponsorTermsSection.tsx  sponsor terms (was app/sponsor-terms/page.tsx; the fund
                               page's checkbox links /terms#sponsor-terms)
  app/terms/sections/PolicySection.tsx  (was app/policy/page.tsx) v2.5 Task 9: the public policy (matching, fee split table then MINI_LINE (v2.9 F24), coin optional, no
                               affiliation, contact); numbers from lib/earnkit/policy.ts; v2.6: the
                               bonus on every program unless opted out, page / confirmation /
                               unverified-page eligibility, the coin's earnkit.txt token line; v2.8: the
                               (v2.14 T3: the builder bonus section is gone);
                               v2.11 T12: "What EarnKit records" (#what-earnkit-records, before Contact)
  app/bench/page.tsx           scoring and clarity T3 (R9): permanentRedirect('/leaderboard') (308)
  app/[handle]/page.tsx        v2.12.1 T6/T11: earnkit.com/<x-handle> (force-dynamic); HandleView
  app/[handle]/handle-view.tsx  HandleView (resolveHandle: hidden/unclaimed 404, case or a 90-day rename 308 to
                               pagePath) renders BenchProfileView (v2.14 T3: ProfileView and ProjectCards deleted);
                               v3.1: BenchPage reads profileSite and passes it with pageOf(?page=); tabOf parsed, ignored;
                               handleMetadata (title, og card)
  app/[handle]/ScoreRing.tsx   v3.1 Task 7: the profile's Shipping ring (132px, viewBox 148, r 62, stroke 12, navy track,
                               the band's light-to-deep gradient, round caps, .ek-arc draw; null: track and DASH)
  app/[handle]/Avatar.tsx      the X picture, else (clarity batch) the GitHub one of builder_profiles.github_login
                               (avatarUrl(x, login): pbs.twimg.com, then avatars.githubusercontent.com/<login>?s=200 only), or the first letter
  app/[handle]/card-response.tsx  cardResponse (next/og 1200x630, Funnel Display from assets/fonts, the X
                               picture with a 3 s timeout, CARD_CACHE) and shareResponse (card_shared once a day,
                               302 to the X intent); both check the live row (no-store 404, 308 to pagePath).
                               v3 Stage 3 Task 6: benchCard on THEME (black, CardWordmark, the Backing pill, the
                               rank line as the 64px headline, CardNumber for Shipping and Earned, project and
                               streak, the URL); loadFonts and CardWordmark are shared with scripts/og.mts.
                               v3.1 one-tap posts Task 5: loadFonts adds Kaftan Serif (assets/fonts/kaftan-serif.woff);
                               cardResponse(handle, path, m) draws a post's card (post-card.ts postCardFacts) for ?m=<code>,
                               else the page's; a rename's 308 keeps a well-formed ?m
                               GTM W4: benchCard(ShareCardFacts, avatar, grid, art) is the v3.1 profile in small (blue
                               hero, up to two fact cards, a public/art painting in a free slot; loadArt); shareCardRead
                               reads profileData + profileSite; avatarData drops GitHub's default picture (githubDefault:
                               a 420x420 PNG); fonts Funnel Sans 400/600 + Kaftan; nameSize, factsLine; re-exports CardWordmark
  app/[handle]/card-facts.ts   GTM W4: shareCardFacts (pure): the share card's facts from the page's reads (Highlights'
                               words, the rank helpers' line): project + live host + quiet facts, tiles (score, backing,
                               won, streak, commits; at most 2), or the idle line ("Building with AI" / STARTING_ON_BASE)
  app/[handle]/card-parts.tsx  GTM W4: pieces both cards draw: CardWordmark, CardMark, CardPhoto (initial when no
                               picture), CardRing (the Shipping ring for satori), DISPLAY/SANS
  app/[handle]/post-card-image.tsx  v3.1 one-tap posts Task 5: postCard (pure): the number, milestone and text layouts on
                               the v3.1 SITE tokens, Kaftan headline and numbers, the 12 weeks as squares, the live Backing
                               pill; clip, textHeadSize. GTM W4: each layout one rounded card on the page ground, Funnel
                               Sans, labels 24px+, card-parts CardPhoto
  app/[handle]/{card.png/route.tsx,share/route.ts}  thin routes over card-response.tsx (live is exported for post-response.ts);
                               card.png passes ?m
  app/[handle]/handle-view.tsx  (v3.1 one-tap posts) postOf (?m, a well-formed code), handleMetadata(handle, post): og:image
                               card.png?m=<code> for this person's draft; HandleView countVisit (visitFrom + noteVisit)
  app/[handle]/post-response.ts  v3.1 one-tap posts Task 4: postResponse (code checked first, live row as the card: 404 or
                               308 to <page>/post/<code>; another builder's or unknown code 404; expired 302 to the page;
                               else tapDraft and a no-store 302 to postIntent: x.com/intent/post with the row's text and
                               url https://earnkit.com<page>?m=<code>, built from the row only)
  app/[handle]/post/[code]/route.ts  thin route over postResponse
  app/[handle]/BadgeCopy.tsx   launch-ready L8, v3 Stage 3: the badge image, then "Badge for your README" as a details/summary
                               that opens to the markdown and a Copy button (client)
  app/badge/[file]/{route.ts,badge-load.ts}  launch-ready L8: GET /badge/<handle>.svg (badgeResponse, always 200) over
                               cachedBadge (unstable_cache per file, 1 h, PROFILE_TAG)
  app/b/[slug]/page.tsx        v2.12.1: a reserved handle's page (HandleView at /b/<handle>); a claimed person's
                               v2.12 slug (live or old) 308s to /<handle>; else 404
  app/b/[slug]/{card.png/route.tsx,share/route.ts}  v2.12.1 T12: thin wrappers: a reserved handle through
                               cardResponse/shareResponse at /b/<handle>; a claimed v2.12 slug 308s to
                               pagePath(handle)/card.png or /share; else 404
  app/b/[slug]/post/[code]/route.ts  v3.1 one-tap posts: a reserved handle through postResponse at /b/<handle>; a claimed
                               v2.12 slug 308s to pagePath(handle)/post/<code>; a bad code or anything else 404
  app/claim/wallet/page.tsx    v3.1 wallet proof: the signing page (site design; walletPageState), WalletView.tsx (the card),
                               WalletSign.tsx (client: EIP-1193 personal_sign, Copy link, Done); proof/route.ts POST
                               (walletPost), x/route.ts GET (walletXStart: the X sign-in to change the reward wallet)
  app/admin/scores/page.tsx    v2.12 T6 (spec 5): the owner's review of held scores (noindex, ?key= =
                               builder-score.ts scoresAdminKey, link from `pnpm campaign scores-link`; array key
                               404; veto rate limit): each held day's parts and top outcome beside the public
                               score, Release; v2.12.1: pending live rescores (builder_live.pending, released by
                               version); X handle conflicts (v2.14 T7: the contested-logins list and rule_login are gone)
                               (v2.12 rows only) with Clear X handle; X handles you cleared
                               (x_owner_clears) with Release
  app/api/admin/scores/route.ts  v2.12 T6: POST -> builder-score.ts scoresPost (release a held day as a
                               score_releases row, or action=clear_x / release_x); wrong key 404; 303 back
  app/api/programs/route.ts    v4.9 T3: GET, the public program list (programs-read.ts programsListGet over a
                               60 s unstable_cache of readListedPrograms); ?category, ?status; at most 200
  app/api/programs/writes/route.ts  v4.9 T3: GET, the last 100 program_writes rows without body
                               (programs-read.ts programWritesGet; the write API's token gate)
  app/api/programs/write/route.ts  v4.9 T2: POST, the programs write API (lib/earnkit/programs-api.ts); 404 until
                               EARNKIT_PROGRAMS_TOKEN is set, or with EARNKIT_PROGRAMS_API=off
  app/api/programs/approve/route.ts  v4.10.1 T4: GET confirm page, POST approve of a pending program write
                               (lib/earnkit/program-approve.ts; signed token, 7 days, single use); 404 while the API is off
  app/api/programs/revert/route.ts  v4.10.2 T4: GET confirm page, POST revert of an applied API write, from the daily
                               digest (lib/earnkit/program-revert-page.ts; "program-revert:v1" token, 7 days, single use)
  app/api/stats/route.ts       v2.5 Task 9: GET public stats JSON (revalidate 600, prerendered when
                               the build has a DATABASE_URL; plus unstable_cache 600 s on the read,
                               for builds without one, where it renders per request); 503 no-store
                               on a failed read
  app/components/common/Panel.tsx  v3 Stage 3 T1: the flat primitives: COLUMN (1120px), SECTION, H1 (56/36), H2 (32/24),
                               LEDE, NUM (tabular Funnel Display), ROWS/ROW (hairline rows), SURFACE (a flat block
                               that opens with a hairline; kept for callers) and Panel
  app/components/site/         v3.1 site T1 primitives: ui.ts (CARD_NEUTRAL/BLUE/NAVY/RUST/LIGHT/PANEL, PILL_WHITE/BLUE,
                               PAGE_COL_WIDE 1240, PAGE_COL 1200, H1_SITE 72/48, H2_SITE 64/44), Serif (Kaftan, .ek-serif),
                               ScoreText (band colour via site-copy.ts scoreBand), InviteRow (optional Kaftan title, a line,
                               the white install pill via InstallButton; leaderboard and feed with few builders), XHandle (X glyph + @handle link; link={false} text, navy tone T8), Pager
                               (links; disabled ends aria-disabled at 35%; "N of M" or numbers), SegTabs (pill rail of links,
                               aria-current; segRail/segTab for the agent tabs, which wrap ('sheet', 'light'); RAIL_FADE masks a link rail's cut edge),
                               FadeRail (client: useEdgeFade sets data-fade end/start/both while a rail overflows; FadeNav), useReducedMotion and
                               useMediaQuery (client). T5: NavLinks (client, usePathname, aria-current), FooterLight (client,
                               pointer light on the footer; nothing under reduced motion or on touch), AgentMarks (AGENT_MARKS
                               from the Landing board, lobehub MIT + muse.svg; AgentMark)
  lib/earnkit/site-theme.ts    v3.1 site T1: SITE tokens (mirrored as --ek-s-* in globals.css, Tailwind s-*) and siteVar
  lib/earnkit/site-data.ts     v4.0 Task 9: tokenCard reads builder_tokens (launched only): symbol, tradeUrl, holders (backersOfCoin),
                               fees_usd (community.ts allTimeCommunityUsd), 12 weeks of new holders, the builder's X photo (https
                               only), never a project's coin. v3.1 site T3: the profile's reads beyond profileData: lastShippedAt (ship reading pushed_at),
                               thisWeekCommits (commit_counts via weekCounts), highlights (W8; v3.1 Highlights competence
                               2026-10-25, each linking its proof: live + liveSub, contracts on every chain (contractsOf
                               over wallet_contracts), products (productsOf, from 2 hosts), consistency (consistencyItem,
                               weeks with code), won only + guide link, experience filler (github_users); siteHref,
                               explorerHref (now in wallet-chains.ts, re-exported), githubRepoHref, githubFileHref build
                               the escaped links; v3.1 Used by: usedByOf/usedByItem, second row, from USED_MIN over
                               app_usage's newest fresh day per source), standingPill/pillOf (GTM W3: the one rank line, whole pool, metal by percentile),
                               backerWeeks (coin_backers.first_block by BASE_GENESIS_UNIX), profileSite (one call per view;
                               Token card only with EARNKIT_RAISING and never for EARNKIT_ORGS repos)
  app/fonts/kaftan-serif.woff2 Kaftan Serif 400 (owner-owned licence), --font-kaftan in layout.tsx
  public/earnkit.txt           v3.1 site proof: the owner's `profile:` line for https://earnkit.com (builder 17)
  public/art/                  hero-eckersberg-{800,1600,3200}.jpg, foot-panini-{700,1400,2800}.jpg (pre-sized, plain srcSet)
  app/sitemap.ts               force-dynamic: home, /terms (v2.9) and the Bench pages (v2.14 T3: no bonus rounds)
  app/api/cron/route.ts        v2.4: POST -> cronPost (Bearer CRON_SECRET; scoring, freeze, review,
                               payout, fee refresh)
  app/api/host/upload/route.ts  v2.9 C12: POST -> hostUploadPost (?t= one-time token, one zip, 503 when R2 off)
  app/api/host/takedown/route.ts  v2.9 C14: POST -> hostTakedownPost (Bearer ADMIN_VETO_SECRET; kill or approve)
  app/api/digest/unsubscribe/route.ts  v2.9 E19: GET confirm page (POST button), POST one-click (RFC 8058) -> digest.ts
  app/api/builder-tokens/route.ts  v4.0 Task 10: GET /api/builder-tokens -> builder-tokens-json.ts (60 s cache, CORS tokens.fun, OPTIONS)
  app/api/builders/[handle]/route.ts  v3 Stage 2: GET /api/builders/<handle>.json -> builder-json.ts (60 s cache, CORS tokens.fun)
  app/api/week/route.ts         v3 Stage 1: GET the week's page (one POST button), POST Looks right / Hide -> week-links.ts
  app/api/admin/veto/route.ts  v2.4: POST only -> vetoPost (form: slug, key, entry, reason; v2.5: round
                               instead of slug for a builder bonus round)
  app/admin/veto/[slug]/page.tsx  v2.4: the owner's review (noindex, ?key= required, rate limited):
                               live balance, pause note, ranked entries with evidence, a Remove
                               form per entry
  app/fund/[ref]/{page.tsx,FundClient.tsx}   ARCHIVED v2.12 (archive/sponsor-campaigns/files/, as are /award, the
                               check route, wallet.ts and WalletGate.tsx below; not routed). Was: sponsor deposit page (noindex; sponsor label): shows pool/prize/fee, sends
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
  app/api/projects/[id]/image/ serves a token image the agent uploaded (token image_data), or
                               (v2.10 item 12) the site or repo logo resolved at launch
  app/api/projects/[id]/mark/  v2.10 item 12: the default token logo sent to tokens.fun: a 512x512
                               next/og PNG, one shape on a gradient from token-logo.ts markFor(id),
                               no letters; 404 without token_symbol; immutable; sandbox CSP
  app/api/projects/[id]/token-image/  (old links only since v2.10) a 512x512 next/og PNG monogram of the
                               stored ticker (validated A-Z0-9 only) on a colour from the project id;
                               the link carries ?s=SYMBOL and 404s unless it matches the stored ticker
  app/mcp/route.ts             hosted MCP server (Streamable HTTP, stateless, Bearer token); v2.10 item 4:
                               withAliases rewrites old tool names (aliases.ts) before the transport and logs
                               "[mcp] alias <old> -> <new>" (names only); imports lib/earnkit relatively (tests load it);
                               v2.10.1 B5 (fix round 1 I3): forOldNames answers an old-name call as plain JSON, each tool
                               named in both forms (forOldClient), with tools_note; v4.8.1 Task 4 (R6): withAliases
                               scrubs tools/call arguments first (secrets.ts scrubToolCalls, logs "[mcp] scrubbed {n}"),
                               withScrubNotes puts SCRUB_LINE on those calls' replies
  app/oauth/{register,authorize,token}/   OAuth for MCP clients (v2.14 T4: authorize signs in with X,
                               x-install.ts; authorize/route.ts calls authorizeGet(request) only)
  app/x/callback/route.ts      v2.14 T4: xSignInCallback (install sign-in; T5: a link sign-in shows the paste code); else 404 (T7: the claim flow is gone)
  app/signin/[code]/route.ts   v2.14 T5: the fallback sign-in link's page (x-link.ts signinGet)
  app/github/verify/(route, callback/route)  v2.9 B9: the sign-in link (GET confirm page, POST to GitHub) and
                                             GitHub's callback; re-export github-verify.ts handlers
  app/github/verify/app/route.ts  v2.10 item 7b: the read-only GitHub App's setup URL (github-app.ts appSetup);
                               404 unless the App is configured
  app/.well-known/             OAuth discovery metadata
  lib/earnkit/
    db.ts                      postgres.js pool (DATABASE_URL)
    dates.ts(+test)            formatDeadline: the one human date format ("Oct 6, 2026, 06:51 UTC");
                               machine fields stay ISO
    deadline.ts                v4.7 T1: programZone (file tz, else the summary's ET/PT/CT/UTC/GMT suffix, else UTC),
                               closeDay (ends_at's day in that zone: the one close day for the site tiles and replies;
                               ends_at wins over summary text). v4.8.1 final fix (R-3): hoursLeft ("in N hours" under
                               48 h), submitBy ("Nov 1, 11:59 PM PT (in 20 hours)") and cardSubmitBy (emails) live here. Program files take an optional IANA `tz` (programs.tz).
                               Tested in v47-numbers.test.ts with the stats-figure hero chip (heroChipText(open_money_usd))
    standing.ts                v4.7 T2: where the builder stands. Standing type; standingParagraph (exact copy: "Score 77 · #1 of 40
                               v4.7 final review: toldAppliedSql (group "applied" rule, applicationCounts and alert-mail.ts)
                               builders. 6 weeks shipping in a row. $5,000 won so far. 2 applications in, 1 draft ready. Next:
                               X closes Nov 1."); pageScore (the page's score rule, used by bench-data profileData too);
                               applicationCounts (R3: Task 3's token gate reuses it); wonUsdOf (earned.ts prizesWonSql);
                               nextDeadline (deadline.ts closeDay over the fits); readStanding; personal (the person gate,
                               shared with reply-facts.ts); streakOnly (signed out or a non-person shared client: the weeks
                               only, nothing read); standingLeads. bench-find benchView puts it in every find/score reply's
                               fields (standingFields), and benchScore leads with it (view.standingLed) only with a score or
                               streak part and never over the Monday block or a post offer.
                               Tested in v47-standing.test.ts
    cli.ts(+test)              pure helpers for scripts/campaign.mts: USAGE, cliErrorLine (one
                               readable line per error), operatorKeyProblem, fallbackProblem,
                               parseFallbackPicks (--winners ranking [--split] or id:amount[:reason])
    program-file.ts            zod format of programs/*.json (v4.9 R5: optional category grant|hackathon|
                               investment|bounty, categoryOf derives it; + starter limits, optional max_award_usd,
                               final fix I4: starterAgeWarnings, programs:check's 23-day warning, never an error;
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
                               the EarnKit rating { level: Easy, rated_by: earnkit, source_url } (Ruling 12;
                               v2.10 item 10: refused over $1,000 per winner without a past round with
                               submissions and winners);
                               any_chain (default false; chains [] only then, Ruling 13); isOptimismUrl
                               refuses optimism.io hosts (Ruling 15); v2.8 Task 12: results { url (https),
                               expected (date) } (optional; programs.results; Arc 2026-10-21);
                               v2.11 T5: fresh_build { starter } (optional, strict slug; owner-set only) and
                               freshBuildProblems (programs:check and sync: a known starter, on the program's
                               chains and its needs_contract chain, tested_at set and at most 30 days before
                               verified_at, STARTER_TEST_MAX_AGE_DAYS)
    fresh-build.ts(+test)      v2.11 T7: the no-repo lead (pure). freshPick (Easy/Medium, <= $5,000, closes in
                               v2.14 T6: buildKit(starter, fields, attribution?) carries no proof file, line or branch.
                               1 to 14 days or rolling, a tested starter on a chain EarnKit deploys to with
                               hosting on, or off with the starter's pages_fallback (T9); never a long shot, needs a live product, investment, hidden or
                               entered), contextLine ("$X in prizes is open right now across N programs."),
                               freshLeadLine (builds / chat-only). v2.11 T8: twistQuestion, BUILD_CHAT_ONLY,
                               buildingLine, buildCheck (plain words, limits, kit names, the twist's words in name,
                               description and feature), buildFix, PUBLIC_TEST_WALLETS / publicTestWallet, buildKit.
                               v2.11 T10: buildKit.order (github_user to find, copy, create the repo, commit, push at once).
                               fixtures/fresh-build.ts: TESTED_STARTERS,
                               FRESH_ON, fileCards (real program files as cards), withFreshBuild, withoutFreshBuild
    starters.ts(+test)         v2.11 T5: the starter registry STARTERS (pure, import-free; id, chain, repo degit
                               path, what (builder copy), minutes 60, contract { artifact, owner_arg }, site_dir,
                               usage_event, usage_read view_total | recent_logs, usage_view { call, selector,
                               words }, kit_twist (the kit's own twist.json slots, T8), pages_fallback (T9), tested_at (null until the
                               starter's test passes), test_cmd). Today only
                               arc-tipjar (chain-kits arc/tipjar, tested 2026-10-11, stats() view); base-checkin
                               left out (owner decision 4)
    programs.ts(+test)         v2.8.1 §B8 card needs_repo (the program file's needs_repo, column
                               programs.needs_repo; programs:check requires it, needsRepoMissing); list/get/upsert programs (source: 'file' | 'sponsor'); v2.7.1 pool_usd and
                               poolFacts (card pool_usd/pool_plus/pool_line); (build_help and
                               program starters archived v2.12: archive/starters, EARNKIT_STARTER_REGISTRY), trust() (verified_at: skip
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
                               v2.11 T5: ProgramRow.fresh_build (programs.fresh_build jsonb, upserted from the
                               file, null when absent) and Card.fresh_build (null on any campaign)
    submission.ts(+.test.ts)   prepareSubmission, rememberedWalletQuestion (pure)
    projects.ts(+test)         v2.10 item 3 (P23): hasProgramEntry (any row for the program; the guide never re-shows)
                               T11 fix: entry UPDATEs never clear contract_verified_at (COALESCE with the new check)
                               v2.10 item 4 (R16): submittedEntry (tell.submitted's entry: by id, else the newest in the program; its saved answers)
                               v2.8.1 §B9 openEntries (this installation's entries in open,
                               non-campaign programs, with submitted); v2.8 Task 8: startEntry (the entry at confirmation: ownEntry or insert,
                               confirmed_at/complete_at set once, "skip" never on a row with a token;
                               proof_line_missed, Ruling C24: the last "go" stopped at the proof line);
                               recordSubmission (v2.14 final fix 10: keepWallet false, a shared client, writes no
                               installations.payout_wallet or installation_wallets row; campaigns: no self-entry, required fields
                               (missingAnswersProblem), sanctions, ownership proof; one entry per
                               repo and per contract, checked under a per-campaign advisory lock;
                               stores repo_key (unique index projects_campaign_repo_key) and
                               live_key (not unique: shared ones are flagged, sponsor.ts
                               sameLiveLink) and the repo's GitHub dates;
                               remembers installations.payout_wallet); v2.5 §3: non-campaign
                               programs with submission_proof check external_submission_url via
                               submission-proof.ts (deleted in v2.14 T3; the columns stay);
                               bonusEligible (pure: coin_address and
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
    ownership.ts(+test)        (final fix M6: fetchLinePusher's everDerived, github-verify.ts repoEverDerived,
                               url_checks ghrepo:<key>: once a fork or template, always refused)
                               builder ownership proof: earnkit.txt at the repo root (raw GitHub,
                               v2.11 T9 security fix: fetchLinePusher (the activity actor of the push that added the line; R4 ownWork, PUSHER_WINDOW)
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
                               GitHub repoFacts, fetcher and Alchemy DeployerLookup (alchemyDeployer) injectable;
                               recordSubmission passes deps through for the e2e)
    secrets.ts                 v4.8.1 Task 4 (R6): SECRET_PATTERNS, scrubPem (linear PEM pass), SCRUB_LINE,
                               readCapped + MAX_MCP_BODY_BYTES + BODY_TOO_LARGE (1 MB, 413), scrubSecrets (pure walk, removed count),
                               scrubToolCalls (tools/call arguments, single/batch, ids), withScrubNote(s) (scrub_note
                               on JSON replies and SCRUB_LINE leading show_to_builder (final fix 7), else a prefixed
                               line); Stripe: a digit and 16+, or 24+ characters; tests in v481-secrets.test.ts
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
                               shownUrl (builder links, canonical form), untrusted(); wholeWords (R11: a cap that keeps whole words)
                               (zod), cleanProject
                               (campaign entries), quoted() (sponsor names/titles in EarnKit's
                               sentences), SAFETY_LINES (server instructions + tool descriptions; the fourth
                               says "use only EarnKit's own build steps" since the v2.12 final review)
    sponsor-text.ts            ARCHIVED v2.12 (archive/sponsor-campaigns/files/). Was: client-safe sponsor texts (DEADLINE_PASSED, DRAFT_EXPIRED, the fixed
                               FUND_WARNING / AWARD_PROVENANCE scam copy, awardWarnings: red flags
                               for a winner that is the sponsor or a repeated wallet) and the
                               10-minute deadline margin (used by sponsor.ts and FundClient)
    placeholder.ts             v2.9 A5, pure: placeholderHost / placeholderLink (reserved names,
                               short list, IPs, earnkit.com, github.com/earnkitai) and the builder
                               lines PLACEHOLDER_LINE, LIVE_FAILED_LINE, liveErrorLine (v2.10: the
                               link loads an error page; final fix M2: the phrase cleaned, word-capped, quoted), contractMissingLine,
                               contractUncheckedLine (G15: a contract check that couldn't run)
    verify.ts(+test)           v2.9 A5: liveVerified (safeProbe) and contractDeployed (getCode via
                               v2.10 item 13: markDeployed (a fresh getcode:<chain>:<addr> pass for a deploy EarnKit made).
                               rpcFor), cached in url_checks (pass 24 h, failure 1 h; v2.10:
                               liveCheckDetail keeps an error page's phrase in url_checks.note,
                               Verified.liveError; url_checks.n holds a count; a getCode
                               error is null and never cached, G15), bounded by
                               CheckBudget (ENTRY_BUDGET, LIST_BUDGET; v2.10 item 6: txCounts 1 / 2);
                               v2.10 item 6: txCount (Alchemy alchemyTxCount, capped TX_COUNT_CAP 100, Base only, txcount:base:<a>,
                               CheckDeps.txCounter; peekTxCount, H5); addressesFrom, entryVerified,
                               checkDefaults (tests: fixtures/no-network-checks.ts)
    chains.ts                  CHAINS, Chain, CHAIN_NAMES (import-free; match.ts re-exports them)
    token-logo.ts(+test)       v2.10 item 12: iconCandidates/pickIconHref (touch icon, raster icon
                               >=128 px, og:image; no SVG/ICO/http), resolveLogo (site, then the
                               preview; 8 s budget; bytes via imageTypeOf), githubPreview (one GraphQL
                               read, GITHUB_TOKEN only, public custom images), launchLogo (H6: preview
                               only for a non-private repo with a fresh public read), logoDefaults,
                               markFor (shape + gradient from the id)
    safe-fetch.ts(+test)       SSRF-safe GET (safeFetchText, v3.1 plainText: text/plain only; v2.10 safeFetchBytes for images, 1 MB,
                               same rules; the request path keeps the query): https on 443, domain names only, DNS
                               resolved once via a cancellable c-ares Resolver (not dns.lookup) and every address public (isPublicAddress: IPv4
                               special-purpose ranges; IPv6 only 2000::/3 minus special ranges, so
                               mapped/NAT64/6to4 are refused), connects to the vetted IP with SNI,
                               cert check and Host on the hostname (pinnedLookup), no redirects, 5 s,
                               4 KB (LARGE_PAGE_MAX_BYTES, 512 KB, for a whole HTML page like a
                               submission proof: passed explicitly, the 4 KB default is unchanged
                               for every other caller); resolver and transport injectable. safeProbe: traction's daily
                               live-link check (v2.6: no longer a coin gate) and the entry live check (any 2xx, one same-site redirect,
                               User-Agent EarnKit-linkcheck/1; v2.10: reads the first 64 KB,
                               PROBE_MAX_BYTES, accept PROBE_ACCEPT, and a short HTML page
                               (isHtmlResponse, Ruling H4) showing an error phrase throws
                               ErrorPageError: errorPageText, visibleText; no JS runs)
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
                               v2.10 item 13: LIMITS.deployDay (1 per <login or repo key>:<chain> a day; the 30-day cap is in deploy.ts, P16).
                               (X-Real-IP from Railway's edge, else rightmost x-forwarded-for;
                               IPv6 keyed on its /64). LIMITS (v2.2 §5): sponsor create 5/day
                               (replacements 10/day), record_submission 20/day, token launches
                               (v2.8.1: tokenLaunchWallet 10/day per creator wallet, tokenLaunch
                               10/day per installation; v2.8.1 §E17: tokenLaunchShared 500/day for a
                               hosted agent), authorize 60/hour per IP, new installations
                               500/day per registration (installClient), OAuth register a
                               10,000/day ceiling per agent host (oauthRegisterHost, warned at
                               8,000) + 50/hour per IP (oauthRegister, installHour; Ruling G25:
                               500/hour per IP for a known hosted redirect host, oauthRegisterHosted,
                               installHourHosted, which refuses), hostUpload 10/hour per IP
                               (oauth-routes.ts; replayed codes free), GitHub matching (list_programs with a user/repos,
                               get_program's repo check) 30/hour per installation, chain checks
                               60/min (/check per IP, sponsor status per installation).
                               enforce() throws RateLimitError ("… Try again in 18 minutes.");
                               countHit counts without a verdict (hit wraps it);
                               routes answer 429 + Retry-After. ENTRIES_PER_CAMPAIGN = 3
                               (recordSubmission counts under the campaign's entry lock)
    repo-cache.ts(+test)       GitHub repo facts for matching (chains, commits since each window
                               start, v2.9 A2 product: the repo's own signals and contract
                               candidates; v2.10 item 6: starter, traction, odds) in github_repo_facts,
                               1 h per (repo, pushed_at); v2.10 R10: via_app (read through the App; once set, kept); fix round 1:
                               loadRepoFacts({ viaApp }) (App rows only through the App), Ruling H6 repo_public_reads:
                               markRepoPublic, publicRepoKeys, publicRepoUrl, PUBLIC_READ_DAYS (7), sweepPublicReads
    installations.ts(+test)    v2.11 T7: markFreshOffer (fresh_offer_at, set once). v2.11 T8: StoredBuild,
                               readBuild / saveBuild (installations.build, plan S6).
                               save / touch installation by token hash or (v2.4) OAuth client key
                               v2.10 item 3: setWorkingOn returns true only when it added the program
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
                               own id, shared_client; v2.14 T4: x = the bound X id, id = the page holding it first), sharedGroup,
                               saveInstallation(..., shared, name, { keepToken }) (v2.14: returns the id; T7 keepToken:
                               a known client keeps its token_hash), setInstallationToken (T7: after the X bind)
    identity.ts(+test)         rootOf (installations.builder_id, the group root); v2.14 T7: lockPerson (advisory
                               `person:<root>`, taken by attachToX, proveByApp and discovery's verdicts) and the global
                               lock order (x_* / repo_hold, then person:<root> sorted, then source_proof, then
                               installation rows by id, then profiles). No pickup, no proven-tie or claim-page join,
                               no group merge (linkInstallations, linkInTx and profiles.ts mergeProfiles deleted).
    oauth-routes.ts(+limits test) register + token + authorize handlers (app/oauth/* re-export them);
                               v2.14 T4: authorizeGet(request, deps?) (X on and not servesMany: startInstallSignIn;
                               else the anonymous code with iss); tokenPost binds an X-signed token (attachToX; refused: invalid_grant, no token;
                               T7: the new token replaces a known installation's only after the bind, so a refusal keeps the old one);
                               logLimited; ipFloor (Ruling G25): a known hosted service's redirect
                               host gets the 500/hour per-IP floor (refuses), everyone else 50/hour
    ref-cookie.ts              v3.1 GTM W1 (client-safe, pure): REF_COOKIE ek_ref (30 days, first page keeps it), cleanRef,
                               refFromCookieHeader, refCookieToSet; set by app/[handle]/RefMark.tsx, read by oauth-routes authorizeGet;
                               installations.ts noteReferral stores installations.ref_builder_id once (referral.test.ts).
                               v4.0 Task 10: REF_SOURCES ['tokensfun'], isRefSource, refSourceOfQuery: a source (never a handle) is
                               stored in installations.ref_source instead (first stays), set by app/components/common/RefSourceMark.tsx
                               from ?ref=tokensfun on any page (no middleware: site-proof SP10)
    oauth.ts(+.test.ts)        stateless OAuth: register (v2.4: a random nonce in every client id;
                               v2.8.1: s=1 for hosted clients), isSharedClient, HOSTED_CLIENT_NAMES,
                               HOSTED_REDIRECT_HOSTS, hostedRedirectHost (v2.9 T12), clientLimitKey, registrationLimitKey,
                               code -> token (+ shared, limitKey), metadata, clientKeyOf (v2.14 final fix: authorize() gone;
                               the route is authorizeGet, tests compose checkAuthorize + issueCode as it does);
                               v2.14 T4: checkAuthorize, issueCode(req, x, iss) (x in the signed code),
                               redirectClass (AGENT_REDIRECT_URIS exact, loopback, AGENT_APP_SCHEMES app, other; v3.1 GTM W1 adds
                               Grok Bot's bot/grok.com callbacks stay untrusted), servesMany; the code's `rf` (referring handle) -> exchangeCode ref
                               (MANY_USER_HOSTS), exchangeCode's x + per-X client key, RFC 9207 iss flag;
                               publicOrigin = EARNKIT_URL (production throws without it; no Host
                               fallback)
    mcp.ts(+test)              v4.0 Task 11: registers find, prepare, tell, score only (confirm unregistered); tell
                               still accepts an older agent's coin { project_key, answer, wallet, raising } and token
                               'ask', undocumented (no description). v3.1 Task 10: confirm was Backing only.
                               v2.12: registers find, prepare, confirm, tell, score (always since v2.14 T3,
                               with the Bench descriptions only; serverInstructions() takes no flag); sponsor_campaign is archived
                               (archive/sponsor-campaigns) and never registered.
                               v2.10 item 4: registers find, prepare, confirm, tell (+ sponsor_campaign with escrow, until v2.12);
                               v2.10 item 13: prepare's deploy schema (chain, bytecode, abi, constructor_args, owner_wallet); readOnlyHint false.
                               v2.10.3: the deploy field is listed only while deployEnabled() and DEPLOY_CHAINS names a chain
                               (v2.11: the build field and toolDescriptions' buildOn the same).
                               v2.11 T8: prepare's build schema (BUILD_SCHEMA, passthrough), listed with deploy only.
                               FIND_DESCRIPTION, TELL_DESCRIPTION, toolDescriptions, serverInstructions, OWNERSHIP_FOR_TOKEN all
                               under 800 characters (mcp.test 9.1, 9.2; 9.7 the route alias end to end).
                               v2.10 item 2: find takes more; its description says one line first
                               v2.9 F25: CONFIRM_ENTRY_DESCRIPTION and SPONSOR_CAMPAIGN_DESCRIPTION under 800 characters (mcp.test 11.8).
                               v2.9 A3: tell_earnkit registered (TELL_EARNKIT_DESCRIPTION, not read-only);
                               report_outcome removed (8 builder tools).
                               v2.8.1 §C15: run() logs an unexpected error as "[mcp] <tool> error <id>"
                               and returns unexpectedErrorText(id), never the raw error.
                               v2.8 Task 5: createMcpServer(ctx, { campaignOpen }) and
                               toolDescriptions(campaignOpen) (campaign sentences only while one is open).
                               MCP server: the 5 builder tools, plus sponsor_campaign only when the
                               escrow is configured (both superseded: see v2.10 item 4 and v2.12 above); descriptions and schemas; v2.6:
                               OWNERSHIP_FOR_TOKEN (the agent writes and pushes `token: <code>`
                               itself), record_submission's builder_submitted (ask "Did you submit on
                               <site>?" first), local_repos[].url (Ruling 13), builder text never
                               names a tool; v2.7: SERVER_INSTRUCTIONS exported (scanned by
                               copy-review), list_programs' description leads with "What can I earn?", all say "token", never name Clanker
                               (Ruling 18), get_program describes the guide
    guide.ts(+test)            v2.10 item 3: Guide.rules_wants (first 2 rules, no focus/past rounds) prints "What it wants" in guideText only
                               v2.9 A4: rowDifficulty (row = max(program level, distance), real_users rule),
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
    v2101.test.ts              v2.10.1: the owner's 5 live bugs (B1 to B5), each with the owner's real project shapes
                               (tokens.fun, earnkitai/earnkit, the tipjar starter).
                               v2.10.2 (v2.11 8a, 8b): tokens.fun without my_commits_90d (unknown, asked), the real
                               World's Fair file (a starter missing new work is low); journey 11.6. Fix round 1: C1 (Arc
                               submitted: tokens.fun asked, never the starter), I1, M6; journey 11.7 (real program files)
                               Fix round 2: own public tokens.fun and my_commits_90d: 5 asked; the 6-day tipjar never
    present.ts(+test)          v4.3 Task 2: fullProgramTable (every shown card, ranked find {more: true}); layout returns rest;
                               the more path drops noFitLine above the shown table and updates naming a tabled program (by id: programUpdates
                               returns ProgramUpdate { text, program_id }, fix round 1).
                               scoring and clarity R12 fix 1: byDeadline (find's and score's one fit order: soonest
                               ends_at, rolling last, then award, then id). v2.11 T7: FreshOn, FirstMessage.fresh, freshLead (the short reply's no-repo lead when
                               nothing else leads; context line + fresh lead), Card.winners_per_round.
                               v2.10.2 fix round 2: starterRepo/STARTER_DAYS (under 30 days old, or a template or EarnKit
                               starter), usersAsk skips starters and a starter's lead yields to a product's question.
                               v2.10.2 fix round 1: usersAsk ranks every candidate (unknown, then products at traction 4+,
                               a grant first), never a starter; usersAskLine "up to" for range prizes; bestFit skips unknown.
                               v2.10.2 (v2.11 8a): usersAsk also takes unknown repos; the "users unknown" cell; Fit.real_use and
                               byOdds (good, unknown, low, then real use) rank layout, betterFit and bestFit.
                               v2.10.1 fix round 1: usersAsk/usersAskLine (one users question for a product EarnKit can't measure).
                               v2.10.1: submitStep/submitStepLine (a confirmed entry leads with its submission site),
                               skippedLine ("Not matched: ..."), every entry counts as entered. v2.10 item 2: FirstMessage.more ("show more": the v2.9 body), holdQuestion (H10), leadRow, leadLine, MORE_QUESTION;
                               without more, the short first reply (news, entries, deadline, private lines, one lead)
                               v2.10 item 7: YourRepos.unseen (with the App link) and fromLocal; privateRepoLines
                               v2.10 items 1, 5, 15: bonusLine (the one bonus line; H8: the offered program's pool), Card.bonus_tokens, FirstMessage.deadline;
                               v2.12 final review: FirstMessage.noBonus (under the token pitch score: no bonus line);
                               no first-reply token offer (tokenOffer, tokenOfferFit, bonusClose, TOKEN_LINE removed).
                               (one line per local match, one can't-see line) before the matched table.
                               v2.10 item 6: Fit.odds/traction/low_reason (rowOdds), lowOddsCell, LOW_ODDS_HEADING;
                               layout picks per program and ranks by good odds then traction; qualifies,
                               tokenOfferFit and bestFit need good odds.
                               v2.8.1 T7: enterableWithoutRepo (the no-repo offer's pick, for tools.ts); v2.10
                               Ruling H1: noRepoPick (no repo needed, never "needs a live product", lowest
                               difficulty, then prize; none: no line).
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
    earnkit-orgs.ts            v2.9 A1: EARNKIT_ORGS (import-free; programs.ts re-exports it); v2.10 R7:
                               EARNKIT_STARTER_NAMES (earnkitai/chain-kits examples; v2.11 adds arc/tipjar's)
    host-names.ts              v2.9 C12 (Task 7), import-free: HOST_RESERVED, HOST_CSP, HOST_HEADERS,
                               SITE_PREFIX 'sites/', STATE_PREFIX 'state/'; imported by the host Worker
                               (relative path) and the hosting code
                               (Task 8: contentTypeFor moved here from the Worker, shared by both)
    hosting.ts(+test)          v2.9 C12-C15 (Task 8): HOST_LIMITS, STATIC_EXT, slugFor (P40/P41/G19),
                               v2.14 T6: issueUpload proves with token-gate.ts proveRepo; the login is the App installer
                               (appHost, basis 'app'); unproven: the App link as sign_in_url; a shared client is not hosted.
                               zipProblems, stripTopFolder, readZip (central directory + streaming
                               Inflate with byte caps), abuseFlags, usesStorage, withBadge, siteExpiry,
                               builder lines (liveLine, HOST_FULL, HOST_REVIEW, HOST_LINES); issueUpload
                               (Ruling 8, P11), deploySite (staged review, reserved rows, tracked
                               writes), expireSites, cleanDeploys (deps.only: a test slug filter), takedown, approveSite,
                               sitesInReview, refreshSiteExpiry, STAGING_PREFIX; hostUploadPost
                               (10/hour per IP, the token attempt taken before the body read),
                               hostTakedownPost. v2.11 T9 (S9): issueUpload off a shared client takes
                               proofLineHost (earnkit.txt line + the builder's own User account + githubUser's
                               public read; deps.gate, proofLine), HostBasis on tokens and deploys, the upload
                               re-checks a proof-line link with proofLineGate, hosted events carry the basis.
                               T9 security fix: proofLineHost needs proofLineLogin (the owner pushed the line),
                               LIMITS.hostProof, otherLoginsSite (never replace another login's site)
    r2.ts                      v2.9 C12: r2Enabled (4 env vars), r2Client (aws4fetch S3: put, list,
                               del, copy; Class A taken from free-tier first, FreeTierFull), R2Error
    free-tier.ts(+test)        v2.9 C13: FREE_CAPS (r2Writes 900k/month, resend 100/day, 3,000/month;
                               v2.10 item 13: deploysDay 20, deployGasMonth 10,000,000 micro-USD),
                               periodKey, takeFreeTier (atomic hard cap), freeTierRoom, FreeTierFull,
                               giveBackFreeTier (never below 0), forceFreeTier (an overage, uncapped)
    events.ts(+test)           v2.11 Task 2 (T3 adds proofLink, noteEvent): the builder event log. recordEvent (zod-checked, lowercases
                               login/wallet/repo_key, detail over 2 KB -> { truncated: true }, optional at, ON CONFLICT
                               DO NOTHING, errors logged as '[events] <type> <ErrorName>' and return false).
                               Off until EARNKIT_EVENT_LOG=on (after the /terms disclosure, T12)
                               v2.11 Task 3: noteEvent (lazy build, flag-gated, waits <= EVENT_WAIT_MS, never
                               throws), eventRepoKey, eventDbForTests. Writers: deploy.ts (deployed), hosting.ts
                               deploySite/approveSite (hosted), projects.ts recordSubmission/startEntry (entered),
                               recordSubmission also (submitted), outcomes.ts sync/self-report (won, lost)
                               v2.11 Task 11: usageChecks (30/90-day usage_check per deployed event, <= USAGE_LIMIT 20
                               a run, oldest first; getCode everywhere, Alchemy txCount on Base, the starter's logs on
                               Arc: the starter's view (view_total: one eth_call, totals { tips, total, tippers },
                               viewTotals) else its logs over the recent window only: recentChunks, 50 x ARC_LOG_CHUNK 10,000 blocks ending at
                               the head, newest first -> recent { blocks, tips, unique }; Base tx_scope 'lifetime'; one try per
                               20 h while failing (the cron is hourly), 5 failures in a row skip 7 days via the
                               usage_check_failures table), the rule from STARTERS (usage_read, usage_view), usageTopic,
                               logSender, UsageDeps
    events-backfill.ts(+test)  v2.11 Task 3: backfillEvents (contract_deploys, host_deploys, projects, submissions,
                               entry_outcomes; source time as at; live dedupe keys; owner-run only); final fix I1:
                               built (installations.build + its first contract_deploys row) and GitHub Pages hosted
                               (projects.live_url via pagesLinkOf, a deployed contract, probe: false); M1 host basis
    pages-link.ts              v2.11 final fix: githubPagesOwner, pagesLinkOf (pure; tools.ts re-exports them)
    deploy.ts(+test, +anvil)   v2.10 item 13: EarnKit deploys the builder's contract on Arc or Base
                               v2.14 T6: the repo proven by token-gate.ts proveRepo (a fresh App proof; never a shared
                               client), its owner the per-owner cap key (contract_deploys.line_owner); DeployDeps.gate gone.
                               v2.11 T9: starter label (initcodeHash vs initcode_hash), lineOwner, beforeSend; caps per repo/wallet/pusher
                               final fix M8: settlePendingDeploy (an unknown build deploy settled read-only from its
                               receipt on the same call again; F1: only its row's starter + build wallet, the
                               contract_deploys.starter column set at reservation on the exact bytecode); M5:
                               OWNER_PROOF_NOTE asks for a fresh push
                               (DEPLOYER_PRIVATE_KEY, read only here). DEPLOY_CAPS, ERC20_SELECTORS,
                               DEPLOY_LINES (+ factory), DEPLOY_PENDING, DEPLOY_UNCONFIRMED, TRANSFER_GAS,
                               deployedLine, initcode, deployRefusal, runtimeRefusal (the simulated runtime:
                               24 KB, ERC-20, CREATE/CREATE2), deployerAccount, keySeparate, deployEnabled,
                               DeployChain (viemDeployChain: queued sends, simulate, Base L1 fee, capped
                               writes), OWNER_ABI/HAS_ROLE_ABI/TRANSFER_ABI (raw probes), nativeUsd,
                               weiToMicroUsd, deployForBuilder (builder_key, caps with the transfer and L1
                               fee reserved, sendAttempted, owner probes, markDeployed). Fix round 2 (H12):
                               v2.10.3: deployChains (DEPLOY_CHAINS: unset/blank both, any case, garbage
                               ignored and logged once by name, none left = no chain), deployChainOn,
                               deployOffLine/deployOffNote; viemDeployChain null and deployForBuilder
                               refuses for an unlisted chain before any read.
                               ETH_USD_BAND ($500-$20,000, nativeUsd), simulate after the estimate with its
                               gas and fee, DeployChain.nonce (above 1: flagged, contract_deploys.blocked,
                               DEPLOY_LINES.blocked), DeployDeps.installationLogin (tools seam; fails closed)
    shared-contracts.ts        v2.10.1 fix round 1 (I1): SHARED_BASE_CONTRACTS, sharedContract (never a builder's own; import-free)
    match.ts(+test)            v2.10.2 fix round 1: rowOdds per the owner rule (new work, users: low for all; deploy, link:
                               low below product tier), NOT_ON_MAINNET, deployReason, OWNER_UNCHECKED (403 copy).
                               v2.10.2 (v2.11 8a, 8b): Odds adds 'unknown', oddsRank, USERS_UNKNOWN, MISSING_REASON; productOdds
                               takes { ownerHidden, saidNoUsers } (a 404'd possible product is unknown); rowOdds is low on
                               any missing requirement. v2.10.1 fix round 1: hasRealUse (measured or a users claim). v2.10.1: REAL_USE_TX (50), realUse, withRealUse (measured use makes a product), a
                               products-only program needs real use (NEEDS_USERS), rowOdds low on real_users. pure: chain detection (IDs + RPC hosts), repo x program verdicts;
                               v2.10 item 9: Detection.basis (Basis: deployed | deploy_config | mention;
                               absent = mention, R6), detectChains(files, paths) over detectMentions +
                               deployConfigChains (Ruling H2: hardhat `networks` entries, foundry [rpc_endpoints],
                               comments stripped, >2 mainnets = template; deploy folders at any depth),
                               creditsMainnet, DEPLOY_FIRST; confirmMainnets sets basis deployed;
                               RepoFacts.commits_90d (v2.10 item 8); v2.10 item 6: traction, productOdds,
                               rowOdds, onlyMentioned, GOOD_ODDS_TRACTION, Odds, TractionFacts;
                               v2.9 A1, A2: ownerOk, productScore (tiers), TUTORIAL, DEFAULT_README,
                               SIGNAL_WORDS, INVESTMENT_NOTE; matchRepo applies the tiers when scored;
                               fitsWideProgram (G15: any_chain/investment need an original product);
                               v2.9 A3: applyBuilderFacts (lowering wins; claims), Claim, CLAIMED_MAINNET;
                               matchRepo: an unverified claim keeps a row at after_step "confirm: ...";
                               reportedFacts(ReportedRepo) turns an agent's local_repos report into
                               RepoFacts, keeping url only when campaigns.ts githubRepo parses it
                               (Ruling 13), else ''
    match-projects.ts          v2.10.2 (v2.11 8a): ownerHidden (404 only) into checkLocal/scored; fits sort by odds, real
                               use, then traction; a missing last_commit_at is an unknown commit count (null).
                               v2.10.1: skipped + SKIP_REASONS (no named repo dropped silently), ownerUnknown (a
                               private org repo's owner is unchecked), tx_count in RepoFacts. v2.10 item 7: named repos read one by one (mapLimit); a 404 goes through
                               MatchDeps.appToken (7b), else the local report (fromLocal), else unseen; other errors
                               skip that repo and its local view; all non-404 throws the first. PRIVATE_LOCAL_LINE,
                               CANT_SEE_LINE. gh/repoByName/repoCodeFacts take a token (an App token reads a private
                               repo, never refused); with a token, files come from the contents API (P10) and the
                               cache row is via_app.
                               v2.10 item 6: runChecks reads Alchemy counts (budget passed in, P27),
                               checkRepo/checkLocal score traction and odds (R3 for local), starterRepo
                               (MatchDeps.starters), fits sorted by good odds then traction.
                               v2.9 A3: MatchProjectsInput.said applied before the checks (P15); not_mine skipped.
                               v2.10 item 8: commitsRead (one 90-day read, any author; author= only on another
                               owner's repo, which counts only those commits, Ruling H1; on an owned repo an
                               empty or failed read falls back to pushed_at; commits_90d);
                               item 9: readRepoChains passes the tree paths; creditedMainnets for fits and
                               cachedRepoChains; withReportedChains marks reported mainnets as claims (P8).
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
    aliases.ts(+test)          v2.10 item 4 (R17): OLD_TOOL_NAMES, ALIASES_UNTIL (2026-11-09), aliasCall (an old call
                               as its new tool and arguments; Pre-flight P15 rules), rewriteAliases (a JSON-RPC
                               message or batch). Pure. v2.10.1 B5: withOlderNames, forOldClient (each tool named in both
                               forms, plus STALE_TOOLS_NOTE), aliasedIds (old names by JSON-RPC id); old names accept new args.
                               v2.12 (R23): aliasesOn(now, env) (before ALIASES_UNTIL, or EARNKIT_TOOL_ALIASES=on);
                               yesNo moved to yes-no.ts (re-exported); the move is staged in archive/tool-aliases/.
                               v2.14 T7: pick_up_entries dropped from OLD_TOOL_NAMES (an unknown tool now).
    tools.ts                   v4.0 Task 11: no `confirm` tool, no launch_token handler, no coinAnswer or tokenPitch;
                               tell coin { answer } and token 'ask' are benchMoveUp kind 'token' (the builder token);
                               prepare_submission, confirm_entry and record_submission never offer or launch a token
                               (READY_TO_SUBMIT; the token step is skipped). token-launch.ts's launch functions are
                               unreachable from tools now (kept with their tests; deletion is follow-up).
                               v3.1 Task 10: confirm refuses program_id (CONFIRM_ENTRY_GONE), else confirmByProjectId;
                               find passes fresh: undefined (no build_offer). buildWalletAgain is gone.
                               v2.11 T7: find's build_offer (BUILD_NOTE / PLAN_NOTE), freshSwitches (deploys +
                               RPC + R2; ctx.freshDeps in tests), fresh_offer_at on the first build lead.
                               v2.10.2 (v2.11 8a): matchRows ranks by odds (oddsRank), real use, traction, score.
                               v2.11 T8: prepare's build (plan S7, prepareBuild: BuildStart / BuildTwist strict,
                               BuildMark goes on to the usual path), buildStart (twistQuestion, stores the build),
                               buildTwist (buildCheck, wallet given or remembered, never a public test wallet,
                               rememberWallet, buildingLine, buildKit with tokenLineFor), buildPick (freshPick on one
                               program: fail closed), BUILD_SHARED_NOTE, twistNote, KIT_NOTE, WALLET_NEEDED_NOTE.
                               v2.11 T9: buildShip (the build mark: deploys off line, owner = the build wallet and
                               constructor_args[0], the earnkit.txt check, builtEvent, deployStep with the starter,
                               hostBlock with the proof line, else the GitHub Pages note; without deploy,
                               pagesHostedEvent for a github.io link), githubPagesOwner, BUILD_NOT_READY,
                               BUILD_DEPLOYS_OFF_NOTE, buildOwnerNote, buildChainNote, buildProofNote,
                               BUILD_UPLOAD_NOTE, BUILD_PAGES_NOTE (final fix I3: site_dir to the root of gh-pages,
                               gh api POST repos/<o>/<r>/pages; I2: 15-minute fallback, BUILD_NO_LIVE_NOTE;
                               M8: BUILD_PENDING_NOTE). hostBlock needs R2 only (sign-in only on shared).
                               v2.11 T10: the deploy reply holds its line (BUILD_HOLD_NOTE); buildJoin (after the
                               live link: the entry from the build, derivedDescription / derivedProfile) and
                               buildLiveLine / pagesLiveLine feed prepare_submission's `join` (BuildJoin: the live
                               and deployed lines, then the confirm line with the build wallet, one reply, `entry`
                               for confirm, BUILD_ENTRY_NOTE); buildWalletAgain (confirm on the build path launches
                               only to the wallet its confirm line showed; another is shown first, BUILD_WALLET_NOTE;
                               owner ruling on M4); M7 a kept wallet is remembered; BUILD_OWNER_NOTE
                               (a fresh push and github_user).
                               v2.12 final review: withoutBonusLine (find with a program_id drops the guide's bonus
                               line under the pitch score; confirm's bonus line too unless the token is live).
                               v2.12: `tools` = find, prepare, confirm, tell, score (score-tool.ts scoreReply); find's
                               line 2 (score-tool.ts secondLine), the first find's profile, consent line and discovery
                               queue, tell's profile/x_handle/card, the token pitch gate (pitchAllowed) and odds from
                               verifiedProject (always since v2.14 T3, which deleted the flag-off find, pickup and bonus paths); sponsor_campaign archived.
                               v2.10 item 4: `tools` = find, prepare, confirm, tell, sponsor_campaign (until v2.12), thin dispatchers
                               over `handlers` (the v2.9 functions: list_programs ... launch_token); FindInput,
                               PrepareInput, ConfirmInput (R15), TellToolInput (R16), markSubmitted (tell.submitted),
                               eligibilityLine; launchFromOffer deleted (launch_token with offer throws).
                               T11 fix: `prepare` with `deploy` deploys first and adds the address to
                               project.contracts before the draft (its contract check sees it).
                               Fix round 2: confirmByProjectId (I-a shown pair and wallet via token-offers.ts
                               readShownOffer/offered_wallet; I-b shared clients: noted, CONFIRM_SHARED_NOTE), projects.ts launchEntry.
                               tool name -> handler + input validation (+ caller's installation);
                               v2.10 items 2, 3: list_programs more (pools only then), lead + LEAD_NOTE, one question (H10); prepare_submission prepends the guide on the first call
                               v2.10: withAlerts(ctx, result) puts the deadline line first (none on a shared client); ToolContext.roundPools;
                               no firstTokenOffer/token_offer. v2.14 final fix: no signed_in anywhere (sharedLogin, SIGN_IN_CODE_NOTE gone);
                               a shared client keeps no memory, entries, weekly email or wallet (memoryKey null); list_programs asks
                               createVerifyLink only for a caller with a page (pageHandle).
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
                               v2.8.1 §E: ToolContext.ownInstallationId / sharedClient;
                               walletMemory (no remembered wallet on a hosted agent); v2.14 T7: no pick_up offer,
                               pick_up_entries, withProbation / ToolContext.probation, join asks or tell pickup;
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
                               included sponsor_campaign (create/status/award; archived v2.12). ToolContext.tokenDeps
                               (gate/check/deploy fakes) is test and e2e injection only; the MCP
                               route never sets it. (v2.14 T3 removed the roundPoolsWei and repoCoins
                               seams with the builder bonus), ToolContext.matchProjects overrides the
                               GitHub/local-repo matcher (default match-projects.ts matchProjects);
                               list_programs passes githubGiven (a GitHub user or repo list given
                               now or remembered) to presentFirstMessage for youCould (Ruling 11);
                               prepare_submission returns shown_wallet (Ruling 30: the wallet line's
                               wallet, for the agent to echo as record_submission's payout_wallet;
                               record_submission never reads the remembered wallet)
                               v2.10 item 13: PrepareInput.deploy (DeployField, P9 owner_wallet), deployStep (the deployed line, reply.deploy), deployWalletLine.
                               Final fix M3, v2.14 final fix: deployStep on a shared client needs sign-in on and has no login (deployForBuilder refuses: no person, no proof).
                               v2.10.3: deployStep refuses a chain not in DEPLOY_CHAINS first (deployOffLine), before the wallet ask or any read.
                               v2.11 on v2.10.3: freshSwitches' deployOn is deployChainOn (a chain off in DEPLOY_CHAINS is never offered);
                               buildShip refuses a listed-off starter chain the same way (deployOffLine, deployOffNote).
    tokens.ts(+test)           tokensFunUrl() (v2.9 T12: TOKENSFUN_API_URL read per call, never at import);
                               v2.10 item 11: tokenDescription (plain description, else the entry's
                               one-liner, else "<Name> on <Chain>" for a one-chain program, else "<Name>"; at most 280 characters), deployToken's description;
                               v2.10 item 12: imageTypeOf (PNG/JPEG/WebP bytes, else null); no upload or
                               logo sends /api/projects/<id>/mark, never token-image;
                               deployToken via tokens.fun /api/v1/deploy (TOKENSFUN_DEPLOY_API_KEY;
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
                               (TICKER_SHAPE 3-10 A-Z0-9, TICKER_MAX 10 = tokens.fun's limit; TICKER_RESERVED, brands),
                               tickerCandidates (R11: the whole first word up to 10, a longer one its first 10, else initials), proposeToken
                               (Task 4 fix 1: OwnBrand { ownEarnkit }, default false; tickerProblem, cleanTokenName, proposeToken
                               and token-launch.ts decideToken/editsOf/storedProposal take it; set only by own-brand.ts),
    own-brand.ts               Task 4 fix 1: earnkitOwnRepo(id, repoUrl): an EarnKit-org repo that is a github_app-proven,
                               verified source of this builder (else false); the only way to EarnKit's own brand on a token
                               (tokens.fun check-ticker; unreachable -> first clean candidate, noted),
                               monogramFor (12-colour palette); v2.7 Ruling 16: proposeToken(projectName,
                               check, repoUrl) never null — name: project, "<name> Token", repo name (repoNameOf), v2.8.1
                               the name without brand words (nameCandidates, unbranded: "ArcPay" → "Pay Token"), "<TICKER>
                               Token"; tickers: a fallback name's first, then project, repo, initialsCandidates, ENTRY…; ≤12
                               checks in parallel batches of 4 (v2.8.1), a taken ticker never
                               proposed (C6), else "ticker not checked for duplicates"; titleCase
    token-offers.ts            DELETED in v4.0 Task 11 (token_offers and token_declines stay in the schema, read by nothing).
    builder-token.ts(+test)    v4.0 (2026-10-28): the builder token, one per builder and per X account (builder_tokens: builder_id PK,
                               x_user_id UNIQUE, status declined|launching|launched|unknown|existing, name, symbol, wallet, coin_address (v4.4: unique WHERE status <> 'existing'),
                               tx_hash, told_at, created_at, updated_at). builderTokensOn (EARNKIT_BUILDER_TOKENS === 'on', off by
                               default until tokens.fun v4.1 is live), builderToken, declineBuilderToken (a no is kept forever; 'no_x' /
                               'x_taken'), builderTicker (TickerPick: a ticker from the X handle, tokens.fun checked; 'ticker_check_down' /
                               'no_ticker'), launchBuilderToken (the row is the claim; tokens.ts outcomeOf: released only on a pre-mint
                               refusal, else 'unknown' and never retried; Base only, Safe 60 / builder 40), stuckBuilderTokens (unknown, or
                               launching > STUCK_LAUNCH_MS: runCron lists builder-token:<builder id> in needs_owner, never quiet), tradeUrl
                               (Uniswap on Base). Launched only from the builder's yes (v4.7 T3: wallet-proof.ts launchOnProof is gone;
                               the retry needs standing_seen.token_yes, set by bench-find.ts markTokenYes). Creator fees: bonus-ledger.ts claimForOthers claims for each
                               launched row's wallet (sponsored claims, first). Final review 1: retryDroppedBuilderTokens (runCron: offered,
                               proven recipient wallet, no row, flag on; BUILDER_TOKEN_RETRIES_PER_RUN 5 a run, never tried first then oldest
                               offer, standing_seen.token_retry_at; no API key / 4xx / no_ticker / x_taken set standing_seen.token_blocked),
                               blockedBuilderTokens (runCron lists builder-token-blocked:<builder id>, alerting); LaunchResult released
                               carries retry for a pre-mint 503 or 429. Tests builder-token.test.ts, v4-setup.test.ts, cron.test.ts
                               v4.2: reopenDeclinedToken (the builder's own "launch my token" after a no: the declined row deleted,
                               token_offered set). v4.2 final review 1/9: the retry (and launchOnProof) launch only on
                               standing_seen.token_offered, which only step 3's shown token sentence or the builder's yes
                               (bench-find.ts markTokenYes) sets; the legacy offer's show writes token_offer_legacy, and a wallet
                               skip with no row removes token_offered (token_skipped). Tests v42-legacy-offer.test.ts, v4-setup.test.ts
                               v4.4 Task 2: status 'existing' (the builder's own token, named: coin_address only, no wallet; schema.sql
                               -- v4.4 rebuilds builder_tokens_status_check). recordExistingToken(builderId, address, { isToken }) ->
                               recorded | not_token | has_token (launching/launched/unknown, unchanged)
                               | no_x; a declined row becomes existing. Fix round 1: coin_address unique only WHERE status <> 'existing'
                               (index builder_tokens_coin_address_launch), so a claim never blocks another builder or a launch. baseTokenCheck (alchemy.ts isToken; revert = no, failed read = null,
                               accepted; Alchemy off accepted). launchBuilderToken returns exists for it; the retry never selects it; every
                               launch reader filters status 'launched'. Tests v44-setup-order.test.ts
    token-answers.ts           v4.2 Task 1: the token answer in each state. tokenAnswerState (row, handle, communityUsd, walletStepOpen,
                               signLink, hasWallet), tokenAnswerText (pure; TokenAnswerOpts justLaunched, offerQuestion), tokenAnswerFor.
                               Copy: TOKEN_EXPLAINER, TOKEN_GOES_LIVE_ON_SIGN, TOKEN_OFF (final review 2: a statement, no question),
                               tokenSignLine, tokenPageLine. Tests v42-token-answers.test.ts
                               v4.4: TOKEN_AFTER_WALLET (step 3 open, no v4.0 sentence shown); existingTokenText ("Your token is <short>.
                               EarnKit didn't launch it, so its fees aren't claimed here."). Setup order (bench-find.ts): step 3 asks for
                               the wallet only (bench-reply.ts walletSetupAsk(project, link); walletSetupToken gone); its sign is followed by
                               setupOffer (setupTokenOffer, stored ask { kind 'token', setup: true }); the answer is setupDoneFor's reply
                               (SetupOutcome launched|on_its_way|declined|existing). tell token { existing } -> bench-find.ts tokenExisting
                               (existingTokenLine, EXISTING_NOT_TOKEN in bench-reply.ts; TOKEN_ASK_NOTE names it)
    community.ts               v4.0 Task 7/9: weekCommunityUsd(builderId, weekStart, now, price) = this week's and last week's creator
                               fee_claims paid to the builder token's wallet, priced with cachedWethUsd ({0,0} with no token, wallet or
                               price); allTimeCommunityUsd (the Token card's "fees earned"). Tests v4-weekly.test.ts, v4-token-card.test.ts
    builder-tokens-json.ts     v4.0 Task 10: GET /api/builder-tokens body: launched tokens of claimed, visible builders with a handle
                               (coin, symbol, handle, name, photo, shipping, streak, page), shipping desc, never a test installation's
                               (EARNKIT_TEST_INSTALLATIONS: the builder or any installation in its group); builderTokensResponse (60 s
                               cache, PROFILE_TAG, CORS https://tokens.fun). Test v4-public-read.test.ts
    token-gate.ts(+test)       tokenGate (v2.6 §3, v2.14 T6): policy, a GitHub repo with code (codeProblem over
                               match-projects.ts repoCodeFacts; on "not found" GateDeps.appToken reads it through the
                               App, ok: { private: true }), then the App proof (GateDeps.appProven: off a shared client
                               repo-proof.ts repoProof forAction; on one, none: v2.14 final fix removed GateInput.verifiedLogin),
                               else appInstallReason with GateDeps.appLink (repo-proof.ts installLink), then the
                               sanctions screen. proveRepo (branded ProvenRepo { installationId, repoKey, owner }) for
                               builds, deploys and hosting. v2.14 T6 deleted the earnkit.txt token line (tokenCode,
                               tokenLineFor, legacyTokenLineCode, ownerProblem, proofLineOwner, PROOF_LINE_PREFIX),
                               repoOwnershipPasses, repoSignedIn, proveRepoByBranch, the sign-in reasons and OwnershipDeps.
    token-launch.ts(+test)     v2.8.1 §A: launchReplyMs (EARNKIT_LAUNCH_REPLY_MS, 40 s), withinReply
                               v2.10 item 5: TokenBlock has no earnings, terms, paired_with or say_to_builder.
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
    builder-code.ts(+test)     EARNKIT_BUILDER_CODE (default "earnkit"), codesIn (ERC-8021 suffix); v3.1 Used by:
                               BUILDER_CODE (^[a-z0-9_]{1,64}$), codesFromText (suffix literals, codes arrays)
    used-by.ts                 v3.1 Used by: contractsUsage (Alchemy, anti-farming exclusions), usageSql + codesUsage
                               (one CDP SQL query a day, CDP_CLIENT_API_KEY), verifyCodes/payoutOf (Base's Builder
                               Codes registry: owned only when the payout is a proven wallet; builder_code_claims),
                               ownedCodes, tellBuilderCode (tell builder_code), contractsDue, runUsedBy (the cron's
                               daily step); app_usage rows. Tests: v31-used-by.test.ts
    entry-proof.ts(+test)      entryMessage ("EarnKit entry: <program> <repo key> <wallet> <contracts>"),
                               signToEnter, entrySigner (EIP-191)
    winners.ts(+test)          rankEntries, pickWinners (one prize per wallet and installation,
                               vetoes, refusals), standingText, RunState
    confirm.ts(+test)          v2.8 Task 8: the confirmation offer (confirmOffer: the builder bonus
                               v2.10 item 5: confirmLine (the one pitch, inside the single yes), SKIP_TOKEN; confirmOffer is that
                               line or Ready to submit?; yesLine, offerWalletLine, SKIP_LINE removed.
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
                               platforms by host; v3.1 final review: SHARED_HOSTS, MULTI_SUFFIXES, proofHostAllowed
                               (program-file.ts proof_hosts). Pure, no imports. v4.10.1 T4: LINK_PLATFORMS,
                               linkPlatformName, sameSite, linkChecksOut (R4's link check)
    coach.ts(+test)            v2.8 Task 9: the application coach. DEFAULT_GUIDANCE per field kind,
                               guidanceFor, coachFields, askableKeys, questionsFor (Ruling 26,
                               C15), coachIntro,
                               bankFill and bankEntries (the answer bank's fill and rows),
                               preSubmitCheck, draftTable, fixesLine, applicationOf. Pure.
                               v2.8.1 §C11: questionsFor's `wallet` (WALLET_KEY payout_wallet,
                               walletAsk: joined to contact, else its own item, else the last);
                               §C15: the proof-link fix only on a proof field (links, demo, how it works)
                               v2.10 item 11: PlainKind, plainProblem (addresses, hashes, hex runs,
                               key: value lists, number dumps, links, length), PLAIN_FIX, PLAIN_NOTE;
                               preSubmitCheck's not_plain agent fix (tools.ts plainRefusal refuses
                               confirm_entry, and a campaign's record_submission, while one stands)
                               v2.11 T10: derivedProfile (a required GitHub profile link from the proven
                               login, never invented), derivedDescription (the build's description).
    answer-bank.ts(+test)      v2.8 Task 9: projectKey, v2.9 repoKey (owner/repo), readBank, saveBank (table answer_bank,
                               Ruling 6: per installation, never public), saveApplication
                               (projects.application); final review M6: bankKeepsContact, contact
                               never banked or read under a name: key
    also-qualifies.ts(+test)  v2.8 Task 11, Ruling 29: alsoQualifies (at most MAX_ALSO=3 other
                               v2.10 item 1: alsoText(rows) has no bonus sentences.
                               open, curated, non-campaign, non-investment (C23) programs the project qualifies for;
                               reuses coach.ts bankFill, then counts with prepareSubmission and the entry's project, so
                               project-known fields are filled, final review I1), alsoText (the table + v2.8.1 §C13
                               "Your builder bonus rides on your <program> entry." with coinIn: the bonus note's one place). Pure. Wired into tools.ts
                               record_submission (non-campaign only) with programs.ts
                               alsoProgramFacts, projects.ts enteredProgramIds, and
                               match-projects.ts cachedRepoChains; v2.9 T12 (G15 M1): canWin (tools.ts
                               alsoCanWin: alerts.ts repoCanWin over installations.ts readFitRepos, else
                               users said for "needs a live product"), testnet-only chains dropped
    entry-text.ts(+test)       v2.10 item 2 (P1): closeDayOf (the program's own close day for "by"; v4.7: deadline.ts
                               closeDay when ends_at is set); deadlineLabel(ends, zone) names ET/PT/CT when known
                               confirmTable, enteredTable, keyTable, tokenRow (hasBonus: v2.5 §3,
                               v2.10: enteredText's bonus is { line } (bonusLine, no board); tokenRow uses the confirm line's words;
                               COIN_FOOTNOTE, tokenFootnote, coinRow, walletLine, BONUS_MOVES removed; SKIP_TOKEN lives here.
                               Task 8, "· skip: no builder bonus"; coinIn: Ruling 25),
                               repoCoinNote, TOKEN_FOOTNOTE, siteUrl; v2.6 §3: coinRow and
                               walletLine (one yes for coin and wallet; "(used last time)", M8),
                               COIN_FOOTNOTE, enteredText (record_submission's reply: the coin,
                               then "Builder bonus: <pool> · ends <Mon D> · <leaderboard>", or the
                               one step that joins, or the no-wallet line; M4: a coin not launched
                               yet joins once it is; M1: REPO_HELD), noCoinYet (the agent's
                               no-wallet note, "by <Mon D>"), v4.8.2 Task 3: closesIn/summaryIn/withClosesIn/endsCell (an agent's
                               program object: closes_in and "closes in N hours" under 48 h), roundEndLabel/summaryCloses/
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
    alerts.ts(+test)           v2.10.2 (v2.11 8a): repoCanWin refuses an unknown-odds repo as it does a low one.
                               2026-10-22: programVerdict (the matcher's verdict for a remembered repo and one program, base-qualify.ts)
                               v2.9 A7: FitRepo, fitRepoOf, alertFit/alertable (new programs only when a
                               v2.10 item 15: AlertFacts.entries, DeadlineEntry, deadlineLine, DEADLINE_DAYS, takeDeadlineLine
                               (installations.deadline_shown, once per entry per UTC day); no "(as WETH)" in the bonus win alert.
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
    match-loop.ts(+test)       v2.9 A8: recordShown (match_shown, one row per day; v2.10 item 6: traction), saveEntryScore
                               (projects.product_score at confirmation), matchStats (pure, 30 labelled
                               minimum), updateMatchFloors (programs:sync: match_floor, match_precision)
    github-verify.ts(+test)    v2.9 B9: Sign in with GitHub. githubVerifyEnabled (both OAuth vars), createVerifyLink
                               v2.14 T6: only the App link is made (createVerifyLink throws for other purposes; S7: not
                               without the person's page handle, pageHandle); the confirm page names the page the repo is
                               added to (appConfirmDestination, APP_CONFIRM_ONLY_YOURS); completeVerify serves only the
                               App's sign-in hop (any other stored nonce: expired); saveVerification joins and queues
                               nothing; entryVerifyLink, proofLineLogin, provenOwnerLogin, noteLineIssued, lineIssuedAt,
                               takeHostVerification, ownershipPasses, OWNER_GATE deleted; loginBasisFor reads
                               verifications only (no proof line); verifiedEntryIds kept for shared clients' old entries.
                               (github_verify_nonces, sha256 only, 15 min), peekNonce/takeNonce (atomic, single use),
                               nonceDetails, ownershipPasses, githubOAuth (exchange, user, repoPerms), completeVerify,
                               verifiedFor, takeHostVerification (P11), verifiedEntryIds (v2.14 final fix: callerLogin,
                               codeLine, formatCode, normalizeCode and the paste code gone; saveVerification returns nothing),
                               entryVerifyLink (G11: needs the entry's wallet), VERIFY_PAGE (+ orgRepo), CONFIRM_WARNING; route handlers
                               verifyStart (confirm page + __Host- cookie), verifyConfirm (POST, 303 to GitHub),
                               verifyCallback (code + state + cookie only).
                               v2.10 item 7b: purpose 'app' (createVerifyLink refuses it while the App is off, no
                               wallet); completeVerify branches for an app nonce before takeNonce (appSignIn: stores
                               login, account_created_at, public_repos on the nonce; 303 to the install page, cookie
                               kept, P3); takeNonce({ purpose: 'app' }) returns those columns; saveVerification (shared
                               insert, G9 code, via/github_installation_id); verifiedFor excludes 'app' rows unless
                               asked (P11); APP_CONFIRM_LEAD; limited/cookieValue/clearCsrf exported for the App; fix round 1:
                               nonce = HMAC(EARNKIT_AUTH_SECRET, seed), an open link reused (not on shared clients),
                               sweepVerifyNonces (cron cleanup step)
                               v2.10 fix round 1 (I6): installationLogin (the installation's last verified login; deploy limits).
                               v2.11 T3: loginBasisFor (a step's login and login_basis: signin, app, proof_line only for
                               the builder's own User account; shared clients only the caller's or the entry's sign-in),
                               githubUser (S9: GET /users/<login>, cached 24 h in url_checks ghuser:<login>)
                               Launch ready L2: PICK_REPOS ('*', the repo picker's repo_key); createVerifyLink repoKey null
                               makes it (same S7 page handle, cookie, expiry, single use); confirmPage for it: APP_PICK_LEAD,
                               APP_PICK_REPOS, appPickDestination ("This connects your repos to earnkit.com/<handle>."); pageWith
                               (fix round 1: a setup success page with its one link)
    github-app.ts(+test)       v2.10 item 7b: the optional read-only GitHub App. githubAppEnabled (GITHUB_APP_ID,
                               2026-10-22: PICK_HINT, TEMPLATE_HINT in PICK_PAGE.none/noneCounted and APP_PAGE.notListed;
                               GITHUB_APP_SLUG, a PEM GITHUB_APP_PRIVATE_KEY, and the v2.9 sign-in on, P17), appJwt
                               (RS256, iat now-60 s, 10 min), installationToken (POST access_tokens: one repo, contents
                               and metadata read; never stored or logged), appProof (R8: listed, and own account or
                               admin), appTokenFor (a via='app' proof scoped like verifiedFor, then a fresh token;
                               null when off), installUrl, APP_PAGE, appSetup (the setup URL handler; v2.14 T6: then
                               repo-proof.ts proveByApp for the person's root)
                               Launch ready L2: installationToken(id, null) (the installation's repo list, metadata read);
                               pickedRepos (GET /installation/repositories, PICK_LIST_MAX 100, newest push first; own account
                               or admin, R8; PICK_ADMIN_CHECKS 30 in batches of PICK_ADMIN_BATCH 5; stops at PICK_PROVE_MAX 20; returns org: an organization's installation proves
                               only the one project's repo, final fix I2);
                               pickSetup (appSetup for a PICK_REPOS nonce, one PICK_BUDGET_MS 25 s deadline through
                               budgetedFetch: repo-proof.ts proveOne per repo, the verification only for a proven one; the one
                               project kept when picked, else setMainProject(newest proven); connectProven in what is left);
                               PICK_PAGE (always names the one project and its page; remove line), GITHUB_INSTALLATIONS_URL;
                               fix round 1: the single-repo path is proveOne, then the verification, then connectProven
    builder-memory.ts(+test)   v2.9 A3: TellInput (strict; program_status, repo_facts; v2.9 E19 weekly_email
                               { answer yes/no, email? }, which alone is enough), BuilderMemory, MemoryKey
                               (memoryKey: own installation login '', a shared client null),
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
    v211-journey.test.ts       v2.11 Task 13 DB-gated success-metric journey in its own throwaway database:
                               real program files, starter registry and switches (deployer key and R2 set
                               in the file only); fakes for GitHub (account, repos, push record, earnkit.txt),
                               DeployChain, R2, the probe, the logo and tokens.fun. 13.0 the registry is
                               fresh; 13.1 a no-repo connection: one yes, the twist, deploy and host, the
                               joined live/deployed/confirm reply, yes, the kit, tell submitted (every line
                               exact; built, deployed, hosted, entered, submitted once each, proof_line);
                               13.2 a rerun writes nothing; 13.4 skip the token, the Pages fallback, fail
                               closed (v2.10.2 byte for byte); 13.3 the sweep; 13.5 v211-metric.mts
    v29-journey.test.ts        v2.9 Task 12 (Part 1) DB-gated journeys in their own throwaway database: owned
                               repos and noise, Arc Easy and the first-reply token offer, Grok Bot with
                               GitHub sign-in on (the real verify routes, GitHub OAuth mocked) and off,
                               tell_earnkit lowering and raising, placeholders and links that don't load,
                               offer then skip then confirm ("40%" once), cron claims for creator and MINI;
                               Part 2: hosting (12.3: R2 in memory, the Worker's handle over it), Also
                               qualifies precision (12.6b), the won line (12.8), one money figure
                               (12.9), the weekly email (12.10, Resend recorded), /terms (12.11);
                               the cross-reply copy scan
    v27/v28/v210-journey.test.ts  deleted in v2.14 T3 (every case was flag-off parity)
    campaign-page-text.ts      v2.7 §4: every human-facing string of app/campaigns/[slug]/page.tsx as pure
                               functions (campaignEyebrow, closesText, sponsorDisclosureParts, earnkitCampaignBlurb,
                               removedLine…), so copy-review scans them
    logo-check.ts(+test)       v2.7: checkLogoFile(logo, publicDir) reads the file and runs
                               program-file.ts logoFileProblem (used by programs-sync.mts --check)
    program-checks.ts          v4.9 T1: programProblems(p, { publicDir }), the one set of program checks for
                               programs-sync.mts and the programs write API: the schema rerun (schemaProblems,
                               "<path or (program)>: <message>"; Optimism, shared proof_hosts, any_chain
                               min_product_score, ...), then todo, kind, needs_repo, fresh_build and the logo
                               file. Tests: v49-programs-api.test.ts
    programs-api.ts            v4.9 T2: programsWritePost (POST /api/programs/write, the Grok Bot's write API):
                               token (bearerMatches), LIMITS.programsWrite, 256 KB readCapped, ProgramFile + R4
                               allowlist (api-program-text.ts), programProblems, apiRuleProblems,
                               curated 409 (programs/ file or non-api row), probeLink (safeProbe; 401/403/429 pass), then upsertProgram(p,
                               'api') in a tx with an unchanged snapshot check; program_writes audit rows;
                               noteFileTakeover for programs-sync. v4.9 T3: programsAuthFailure (the 404/401 gate
                               shared with GET /api/programs/writes). Tests: v49-programs-api.test.ts. v4.10.1 T4:
                               applyUpsert holds a create or new submission_url whose link doesn't check out as a
                               pending write (202); approveWrite applies one; urlRuleProblem; official_url
    program-pending.ts         v4.10.1 T4: approve token (approveToken/approveTarget/approveExpiry, HMAC under
                               EARNKIT_AUTH_SECRET), linkAnchors, pendingReason, the owner's email (mailPending)
    program-approve.ts         v4.10.1 T4: programApproveGet (confirm page) and programApprovePost (approve).
                               Tests: v4101-link-check.test.ts. Exports page/line/escapeHtml/notFound (v4.10.2 T4)
    program-revert.ts          v4.10.2 T4: revert token (revertToken/revertTarget/revertExpiry, "program-revert:v1"),
                               changeLine, revertDigest (the cron's once-a-UTC-day owner digest, owner_alerts
                               'program-revert-digest'), revertPreview, revertWrite
    program-revert-page.ts     v4.10.2 T4: programRevertGet (confirm page), programRevertPost (revert).
                               Tests: v4102-revert-digest.test.ts
    programs-cache.ts          v4.9 T3 fix 1: PROGRAMS_TAG and programsChanged(id) (revalidateTag + the home, guide,
                               sitemap and (final fix F2) /api/stats paths) after an API write changes a program
    api-stale.ts               v4.9 final fix: API_STALE_DAYS (14), apiStale(row, now), freshSql(db, alias, now?) (the
                               discovery filter), connectedSql(db, installationId) (entered, applied or drafted ids)
                               and hiddenFor(row, installationId) (the by-id gate). Tests: v49-programs-api.test.ts
    programs-read.ts           v4.9 T3: readListedPrograms (landing listedCards + landingTiles, money = site-copy
                               tileMoney), byListOrder, programsListGet (GET /api/programs), programWritesGet (GET
                               /api/programs/writes; v4.10.1 T4 adds `pending`). Tests: v49-programs-api.test.ts
    api-program-text.ts        v4.9 T2: API_FIELDS/API_REQUIREMENT_FIELDS (the write allowlist, notWritableFields),
                               apiTextProblems (hidden/format characters and non-NFKC text refused, no < >, markdown links, cleanText link detection, title 120 and
                               organizer 80 caps; stored as written), API_CONTENT (the written-by envelope on find,
                               list_programs, get_program and prepare)
    payout.ts(+test)           payoutAccount (CAMPAIGN_PAYOUT_PRIVATE_KEY, with or without 0x: Ruling 7), payoutRpc, payWinner (sign,
                               store, broadcast; stale/manual handling; optional place), payRanked
                               (per-place amounts, any ERC-20, every v2.4 rule, openSends nonce
                               floor, a caller's shared `nonces`; follow-only done in the same
                               run, M14), payCampaign (wrapper), openStoredSends, dbPayoutStore,
                               PAY_FAILED/PAY_FAILED_RUNS/STEP_FAILED,
                               termsOf/fromTerms/sameTerms, MANUAL_CHECK, TOP_UP, NO_PAYOUT_KEY, NOT_MAINNET,
                               needsOwner (the 503 notes); the page balance is funds.ts
    cron.ts(+test)             v4.0 final review 1: runCron runs retryDroppedBuilderTokens (CronDeps.builderTokenRetry; `builder_token_retry`
                               in the result) before stuckBuilderTokens and lists builder-token-blocked:<builder id> (blockedBuilderTokens).
                               v4.0: runCron also runs stuckBuilderTokens (after token-pending) and the gas mail (owner-mail.ts; the
                               deployer address read inside a try) and safe_watch (safe-watch.ts) after the weekly email, all in the
                               same hourly run. nextStep (the state machine), scoreMaxAge, runCron (one step per
                               v2.10 item 13: deployerGas (v2.10.3: only the chains in DEPLOY_CHAINS; deployer-gas:<chain> TOP_UP, deployer-price:<chain>, deploy-owner:<id>, deploy-unknown:<id>; H11: :quiet after 24 h, QUIET_OWNER, no 503 in cronPost); CronDeps.deployer.
                               campaign under its lease, then the ledger (v2.14 T3: no bonus scoring, rounds,
                               proof re-check or collect step; every deposit books to the Safe), then the fee
                               refresh, then v2.9 Task 8 expireSites (R2 on; `hosting` in the result),
                               then (v3: after the score steps) v2.9 Task 10 sendDigests (RESEND_API_KEY set; `digest` in the result);
                               needs_owner incl. host-review:<slug> (P46), PAY_FAILED_RUNS failed pay steps in a row
                               and bonusWaitsOnOwner (a MANUAL_CHECK or TOP_UP bonus sweep, failed
                               index runs, v2.9 D17 gas low or a claim/collect out of gas); BONUS_WALLET_UNSET when the ledger is
                               skipped (key missing or malformed, off mainnet) while bonusLive (v2.14 final fix: an EarnKit coin exists),
                               v2.14 final fix: missingPrerequisites / PREREQ_VARS (env-missing:<VAR>, env-invalid:GITHUB_APP_PRIVATE_KEY
                               on a full run: X sign-in and the GitHub App are hard prerequisites),
                               Rulings 19-20; an ended round's scoring failure once, Ruling 23; v2.8.1
                               token-pending:<id> for a launch claim pending > 10 min, CronDeps.stuckLaunches; v4
                               builder-token:<builder id> for a builder token unknown or launching > 10 min,
                               CronDeps.stuckBuilderTokens), cronPost
                               v2.11 Task 11: the usage step after deployerGas (CronDeps.usage; `usage_checks` in the
                               result; never needs_owner)
                               v2.12 T6: last (always since v2.14 T3), builder-score.ts runScoreSteps
                               (CronDeps.builderScore: reader, login, only) inside scoreSliceEnd (40% of what
                               remains); `builder_score` in the result; needs_owner score-hold:<id> and X conflicts
                               v3.1 Used by: used-by.ts runUsedBy after the Builder Codes step, its own slice
                               (CronDeps.usedBy; `used_by` in the result)
    bonus-rounds.ts            deleted in v2.14 T3 (with bonus-payout.ts and bonus-board.ts): every deposit books to the Safe
    bonus-ledger.ts(+test,     v4.0: claimForOthers claims only for creators (each launched builder_tokens wallet first, final review 2,
                               then each launched project token's creator, newest first, 10x gas, within othersMs); final review 3:
                               indexSafeFees also books launched builder_tokens coins: sponsored claims, so builders never
                               claim; MINI is never claimed (its 10% ended; claimOwners' mini is null); feeRecipients reads a 2-slot
                               split (Safe 60 / creator 40). v2.5 builder bonus ledger: BASE_BONUS (FeeLocker, lockers, WETH, Safe),
      +anvil.test)             STORE_TOKENS/CLAIMED_REWARDS, bonusDeposits (attribution: next
                               ClaimedRewards of the sending locker), bonusRpc, scanForward (adaptive
                               getLogs), indexDeposits (cursor), bookDeposit (v2.14 T3: always the Safe,
                               round_key NULL, with the reason logged; a booked deposit is never moved), claimFees (bonus wallet then Safe; M10: also when the sweep
                               waits on it), v2.9 D16: claimForOthers (step claim_others after the
                               sweep, OTHERS_CLAIM_MS slice, MINI then creators newest first),
                               claimOwners (each owner once), feeRecipients (EARNKIT_SPLIT_BPS only,
                               cached on projects.fee_recipients); D18 fee_claims ops log,
                               v2.9 D17: GAS_LOW, gasMinWei, NEEDS_GAS, BonusRpc.rewardInfo/ethBalance,
                               sweepToSafe (payWinner + sweepStore), worthIt (10x gas),
                               indexedThrough, sendCall (run nonce floor, I5),
                               runBonusLedger (the cron step; v2.9: `gas` check first; a malformed key is a skip, Ruling 19;
                               one `nonces` floor per run; v2.14 T3: no rounds hook or near-end collect); v2.13.2: indexSafeFees + safeIndexStep (step safe_index, last,
                               always since v2.14 T3, SAFE_INDEX_MS 30 s slice, SAFE_INDEX_CALLS_PER_RUN 10: the
                               Safe's own deposits from EarnKit coins into safe_fees, cursor 'safe';
                               BonusRpc.safeStoreLogs first, claimLogs only across their blocks, no
                               receipt reads; safe_index_failures -> cron bonusWaitsOnOwner;
                               test v2132-safe-fees.test.ts)
    policy.ts                  v2.5 Task 9: FEE_SPLIT_BPS (a copy of tokens.fun's split), SAFE_ADDRESS, FEE_ROWS / SIGNAL_ROWS (traction
                               WEIGHTS) / PLACE_ROWS (BONUS_SPLIT_BPS) for /policy; v2.9 re-exports
                               MINI_FEE_RECIPIENT and GAS_WALLET_MIN_WEI_DEFAULT; v2.11 T12: RECORDS_* and
                               RECORD_STEPS (the /terms "What EarnKit records" copy, checked against the writes);
                               v2.12 T15: PROFILES_TITLE, PROFILES_ANCHOR ('builder-profiles'), PROFILES_POINTS
                               (the /terms#builder-profiles copy; lawyer review before go-live)
    policy-constants.ts        v4.0: EARNKIT_SPLITS_BPS adds [6000, 4000] (Safe 60 / creator 40, no MINI slot); launches are Base only.
                               v4.7 final review: DECLINE_MS (bench-find re-exports it) and draftedRecently (find and the alerts)
                               v2.9 D16, D17: MINI_FEE_RECIPIENT (Ruling 17, confirmed read-only),
                               GAS_WALLET_MIN_WEI_DEFAULT, EARNKIT_SPLIT_BPS (slot order); a leaf so bonus-ledger.ts can import them
                               (policy.ts once imported bonus-payout/traction, which import bonus-ledger)
    landing.ts(+test)          v2.7 §1, v2.7.1: landingFrom (pure: curated cards by prize → Tile JSON:
                               prize = pool_line, else "up to $X per winner", else the curated text;
                               prize_note "up to $X per winner" when different; v2.8: has_bonus and bonus_amount = bonusAmount ("0.42 ETH", "<0.01 ETH", else null);
                               open_text = openGrantsText(openMoneyUsd(kept)) (v3 Stage 2: "$115K in grants and prizes open", null when
                               nothing is open) and open_more = openMoneyWords; tiles sorted by byRelevance (open first, Base,
                               then any chain, then the rest; grants before investments; then deadline, then award), carry status / in_person, days_left "not open yet"
                               for upcoming; GuidePage.upcoming; v2.9 E20 won_line = wonLine
                               (Hero shows it under the stats line); stats_line = statsLine
                               (installs ≥100, bonus paid >0); v2.8: no bonus_pools / bonus_every /
                               bonusPoolsText (Win twice removed); v3 Stage 2: byPool removed (byRelevance orders the tiles));
                               readGuidePage adds the "prize pool" source
                               and readLanding (listPrograms, roundPoolsWei, readStats; rejects when
                               the DB is unreachable); GuidePage.has_bonus / bonus_amount;
                               v2.7 §2: readGuidePage(id) → GuidePage (curated only, else null; rejects
                               on a DB failure, never null)
    pool.ts(+test)             v2.11 T7: openCurated (the filter openMoneyUsd sums; the context line counts it).
                               v3 Stage 2: openMoneyUsd skips investments; openMoneyWords ("Plus 1 accelerator and 1
                               hackathon."); openGrantsText ("$115K in grants and prizes open").
                               v2.9 F21 (P18): openMoneyUsd (the top prize of every open curated program,
                               summed; never an EarnKit campaign (campaign / earnkit_campaign), a sponsor's
                               (sponsored / source 'sponsor'), closed, not started or ended) and moneyText
                               ("$1.1M+", null at 0), the one money figure; stats.ts re-exports both
                               (present.ts can't import stats.ts). openFigure is gone; poolTotalText is
                               imported nowhere else (human-text.test.ts 11.3).
                               v2.7.1 (pure): usdCompact ("$1.3M", "$840K", rounded down), poolStated (the
                               pool in a program's reward: "$840,000"/"$840K"/"10,000 USDC", its "+"),
                               v2.9 E20: wonLine ("Builders using EarnKit won $X", null at 0).
                               poolLine (a card's big line), poolTotal/poolTotalText (moneyText's formatter;
                               poolTotal no longer feeds /api/stats (open_pools_* dropped in v4.7.1); "+" when rounding drops value),
                               statedPool (a row's pool), amountStated, isGrant, eachLine ("per grant" /
                               "per winner", "$5K–$100K per grant", "500 USDC per grant")
    stats.ts(+test)            v2.5 Task 9: readStats (one aggregate query) / statsFrom (pure):
                               v3.1 one-tap posts Task 7: posts_drafted, posts_tapped, backers_after_post (post_x_visits dropped: internal only)
                               (within 7 days of a first tap, open backing, flag on; correlation only), after shared;
                               launch-ready L9: activated, weekly_active and shared from the weekly moment's approvals
                               (approvedWeek: project_updates.facts.approved + approved_at; shared: approved_via 'share'; notTest);
                               open_money_usd (v2.9 F21: openMoneyUsd over the active rows, open_rows) +
                               open_money_text (moneyText), (v4.7.1: open_pools_usd/_plus and points_total dropped from the JSON), programs_open,
                               bonus_programs_open (v2.6 Ruling 16 (plan): open programs with
                               builder_bonus AND campaign IS NULL, bonusOn's SQL twin),
                               coins_launched (token_status launched), fees_to_safe_eth (v2.5-split coins
                               only, accrued: 1.5x real indexed bonus deposits of EarnKit coins (M5),
                               never round-rest: rows, + bonus money routed to the Safe; v2.13.2 under
                               the Bench: safe_fees_wei + 1.5x bonus_unmatched_wei + bonus money to the
                               Safe, so 3-slot coins count and nothing twice; v4.0 final review 3: safe_fees_wei also counts
                               launched builder_tokens coins, never a test installation's),
                               bonus_paid_eth, installs; STATS_LABELS for jenil.ai; v2.6 Ruling 6/16
                               (plan): installs, coins_launched, the bonus_deposits_wei coin
                               subquery and (final review M2) bonus_to_safe_wei's coin rows all
                               exclude owner test installations (installations.ts
                               testInstallationIds, EARNKIT_TEST_INSTALLATIONS); v2.7 Ruling 20:
                               bonus_pools_eth (open rounds' `destination = 'round'` bookings, test installations' coins
                               excluded, final review M7), STATS_LABELS.coins_launched
                               = "tokens launched" (key kept); docs.earnkit.com's LiveNumbers reads /api/stats;
                               v4.2 F18: coins_launched adds launched builder_tokens, tokens_declined (declined builder_tokens), both
                               without test installations (final review 6: installations.ts testBuilderSql, the one SQL fragment,
                               also used by wallet-offer.ts tokenOfferDue);
                               v2.8 Ruling 30: labelled_entries (never 'unknown', C22) and entries_won
                               (announcement rows of entry_outcomes only, test installations excluded), WIN_RATE_MIN_LABELLED = 30
                               (documentation only, no win-rate claim); v2.9 E20 (Task 10):
                               builders_won_usd (announced won/placed prizes > 0, test installations
                               excluded; wonUsdSql shared with readWonUsd), wonLine (re-exported from
                               pool.ts), readWonUsd (10-minute in-process cache, 0 on error), wonSource
                               (list_programs' seam; fixtures/no-network-checks pins it to 0)
    owner-mail.ts              v4 Task 12: the owner's emails over digest.ts resendMailer, to CONTACT_EMAIL from
                               DIGEST_FROM_DEFAULT: ownerMail (no-op without RESEND_API_KEY), gasAlerts (the
                               needs_owner gas lines with their wallets), ownerGasMail (once a UTC day per line,
                               owner_alerts 'gas:<line>')
    safe-watch.ts              v4 Task 12: safeWatch (cron step safe_watch): the Safe's WETH + ETH on Base at
                               cachedWethUsd; >= $5,000 mails once per crossing (owner_alerts 'safe_5k' sent/below)
                               with SAFE_SWAP_URL; no price, a failed read or send: skipped (v4-safe-watch.test.ts)
    digest.ts(+test)           v2.9 E19 (Task 10): the weekly email. digestEnabled (RESEND_API_KEY),
                               DIGEST_FROM_DEFAULT/DIGEST_FROM, EMAIL_QUESTION/EMAIL_NOTE/EMAIL_REASK_DAYS,
                               DIGEST_HOUR_UTC 16, weekStart (Monday 16:00 UTC), digestDue (P17), digestBody
                               (v3: the week's moment and Looks right / Hide links first), SubKey (G21:
                               installation + login), unsubToken/unsubTarget (HMAC, timing-safe),
                               unsubHeaders, idempotencyKey, MAX_SEND_FAILURES, Mailer/MailError/
                               resendMailer, entryEmail/cleanEmail, askWeeklyEmail (Ruling 13, P16),
                               saveWeeklyEmail, unsubscribe, digestFacts, sendDigests (row lock,
                               free-tier caps; v3: a week not written yet is `pending`), digestUnsubscribeGet/Post;
                               v3.1 Task 12: DigestFacts.money (moneyLines: the Best fit's draft via best-fit.ts, new
                               backers via backers.ts newBackers) leads the body, above the week.
                               v4.0 Task 7: digestWeek's lines are mondayLines (weekly-moment.ts: Shipping score, Streak, From your
                               community from community.ts weekCommunityUsd)
                               v4.7 T5: EMAIL_QUESTION asks for deadline alerts and the Monday summary; resendMailer
                               sends reply_to CONTACT_EMAIL; DigestFacts.standing (best-fit.ts standingFor, shown with
                               standingLeads) is the body's top paragraph (R16: then the week drops its Shipping score
                               line and the subject its score); mailFooter (R17, both emails); digestFrom exported
    alert-mail.ts              v4.7 T5: the alert emails. alertEvents (accepted outcome post > closing fit or draft
                               within DEADLINE_DAYS via deadline.ts closeDay > new fit via alerts.ts alertFit),
                               alertBody (exact copy), pickAlert, runAlertMail (cron step alert_mail in every cron
                               run, no hour gate; longest-unmailed builders first: one email a builder a UTC day, each event once in alert_mail_sent, Resend room after
                               every digest still due). Tests: v47-reach-out.test.ts
                               v4.8 Task 5 (target D): tellLine, alertAction; each body ends in one line, Tell your agent:
                               "EarnKit, {action}." (draft / finish my {program} draft / what's next after {program}).
    best-fit.ts                v3.1 Task 12: bestFitFor, the Best fit outside a reply (bench-find.ts scoreApplies + bestApplies)
                               v4.7: openFitsFor (alert closing fits; final review R19 withoutSilentDeclines: only an explicit no drops one)
    ship-log-facts.ts          v3 Stage 2: shipLogFacts/shipLogBlock/SHIP_LOG_NOTE, the ship log's facts in prepare's draft
    builder-json.ts            v3 Stage 2: builderJson/builderResponse/builderPreflight, the public builder JSON
    backers.ts                 v3 Stage 2: indexBackers (coin_backers from pool-side Transfers), backersOf/backersOfCoin;
                               v3.1 Task 12: coin_backers.first_seen_at ('epoch' before v3.1), newBackers (v4.0: the launched builder token's coin)
                               v4.0 Task 9: indexBackers also indexes launched builder_tokens coins (start block from tx_hash's receipt,
                               else from builder_tokens.created_at, set when the claim starts and never after the mint; the token's
                               wallet counts as the creator, never a holder); a coin in both tables is read once
    earned.ts                  v3 Stage 2: indexCreatorFees (creator_fees, capped by creator_deposits), prizesWonSql (v4.7 T2: the
                               announced-prize sum, shared with standing.ts), earnedUsd (v4.0 final review 9:
                               plus the creator fee_claims paid to the builder token's wallet, not already in creator_fees)
    week-links.ts              v3 Stage 1 (spec 5.4): the Monday email's links. weekToken/weekTarget/weekVerify (HMAC,
                               the key only in the mac), weekUrl, WEEK_TEXT, weekGet (page, no change) / weekPost
                               (approveWeek via 'email', un-hiding; or an UPDATE setting hidden on the week's row); v3-monday-email.test.ts
    public-pages.test.ts       markup tests of /terms (11.4: section ids, MINI line; 11.5 redirects 301; 11.6 Tokenfi line; 11.7 no /fund or /award in builder navigation) and the footer link
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
    test-guard.test.ts         Part 2 final review I3: the preloaded guard clears vendor keys, fetch is local only
    fixtures/                  test-guard.ts (the `--import` preload above; no network, no vendor keys),
                               test-db.ts + test-db-template/create/drop.mjs (v2.14 T2: each test file runs in its own
                               ek_t_<hash>_<pid> database copied from this worktree's ek_test_template_<key>; databases
                               are tagged per worktree and only this worktree's dead leftovers are ever dropped),
                               Needs Postgres 15+ (STRATEGY FILE_COPY) and a local server (localhost, 127.0.0.1 or ::1 only),
                               mcp-call.ts (v2.14 T2: mcpCall / mcpListTools, tools/call through the real MCP server),
                               clanker-base-launch.json (a real Base receipt, from tokens.fun),
                               bonus-db-lock.ts (test-only advisory lock for the bonus test files),
                               fake-github-branch.ts (v2.13.2: fakeGitHub, idOf: the proof branch fake API),
                               private-github.ts (v2.13.4: APP, TOKEN, privateGitHub, installApp: the App on, a private org repo),
                               find.ts claimX (v2.13.4: claim a test person with X before testing what follows the claim),
                               program-file.ts (committedProgram: a programs/*.json without its
                               id-bound logo, for tests that clone files under test ids),
                               programs-cleanup.ts (v2.13 T17: dropPrograms; dropRunPrograms, which each
                               DB test file calls at its end so the programs it made (ids carrying its pid)
                               never outlive the run in the shared test DB)
    builder-score-flag.ts      v2.14 T3: archiveFlag(name) for SPONSOR_CAMPAIGNS, STARTER_REGISTRY,
                               PROGRAM_LEADERBOARDS, TOOL_ALIASES; xSignInEnabled; (v4.0 Task 11: RAISING_FLAG and raisingEnabled removed)
                               (EARNKIT_RAISING was the one product switch left); the builder-score and Bench
                               switches are retired (flags-retired.test.ts); import-free
    score-calibration.ts       v2.12 T2: Calibration, CALIBRATIONS ('v1-launch': users 500, money $5,000,
                               13 weeks, 60 days, package_users 100, pr_target_users 2, since 2026-10-12),
                               LIVE_CALIBRATION, calibration(id); pure
    score.ts(+test)            v2.12 T2: formula v1 (FORMULA, MAX 45/20/15/10/10), ProjectInput, Parts,
                               Scored, computeScore, percentileOf, topPercent, TOP_SHOWN_MAX 50, shownTop (null
                               above 50: the score alone); pure; golden farmed-vs-honest
    anti-farming.ts(+test)     v2.12 T3 (spec 5): RULES, countProject (self-exclusion, one per account,
                               10% fee cap, spread, fresh accounts, rings, cluster cap), moneyOf, ringWeights
                               (ring + ringOwner + clusterCap); pure
    discovery-clues.ts(+test)  v2.12 T4: pure clue parsers (cnameSite, vercelSites, wranglerSites, pagesSite,
                               npmPackage, pypiPackage, foundryBroadcast, hardhatDeployment, githubProfileClues,
                               githubRemote, ownPagesSite), CLUE_PATHS, CLUE_FILE_MAX 64 KB, CLUE_JSON_MAX 1 MB,
                               profileCode / profileCodesIn (the earnkit.txt `profile:` line, HMAC under
                               EARNKIT_AUTH_SECRET)
    discovery.ts(+test)        v2.12 T4, T6: localGitInput, noteLocalGit (remotes and live_urls proposed,
                               v2.14 T6: provenLogin is the App installer's login only (one across the group); clue 2
                               (owned/remote repos, top contributor), the proof-line check, x_match and loginStands
                               are gone; clue 3 scans App-proven repos with their own token (repo-proof.ts appClient).
                               agent), enqueueDiscovery, enqueueClue (wallet, signin; flag on, not shared),
                               LoginOf, provenLogin (R4), proofLineCheck, discover (DISCOVER_PER_RUN 20,
                               DISCOVER_CAPS; reads first, verdicts after), publicHttpsOrigin, homepageOrigin
                               v2.12.2: REPORTED_REPOS_MAX (a reported login's own repos proposed, not
                               confirmed), proofLineCheck skipShort/onSkip (discoverPerson, the refresh;
                               a skipped check re-queues 'proof_line' for the cron)
    source-readers.ts(+test)   v2.12 T5: ReaderDeps, readSite, probeSite, readNpm, readPypi, readContractOrigin,
                               walletCreationsFrom (R16b removed readRepo, readContract, readCoin, readMergedPrs and
                               the Blockscout/Arc/price deps), budgetedGh (GH_RATE_FLOOR, GH_RUN_CAP 1500 calls a run),
                               GitHubBudgetStop, soft, READ_CAPS,
                               defaultReaderDeps (one per run; v2.14 final fix 8: ghFetch skips the run cap and the rate watch
                               for appCredential requests, an installation token or the App JWT)
    weeks.ts(+test)            v2.13 T1: ISO weeks (isoWeekOf, mondayOf, lastFinishedMonday, last52, streakOf,
                               weeksShipping)
    main-project.ts(+test)     v2.13 T2: the one project (main_project_key): mainProjectOf, setMainProject,
                               v2.14 T6: confirming, confirmingFast, CONFIRMING_*, MAIN_PROOF_MIN_MS and clearOpenCodes deleted.
                               benchConfirmedSql (repo key needs a confirmed repo proof), CONFIRMING_WINDOW_MS
                               (1 h fast refresh), PROOF_NOTE (names proof.repo), proofFor (the line, or the
                               sign-in link: can't push, owner not github_user, an org, or the hour passed;
                               SIGN_IN_OWNER_NOTE; v2.13.1: null under the flag), pickMainProject
                               (Bench-confirmed only, else null); v2.13.1 O2: setMainProject replaces an
                               unconfirmed one (old key's open proof code cleared), dropMainProject (tell
                               repo_facts not_mine on the unconfirmed one project); launch ready L2: rankRepo (tell
                               main_project: the one project moves, even a confirmed one, only to a repo this person proved
                               with the App)
    repo-proof.ts              GTM W2: proveCovered (a repo on a GitHub login this person proved, that GitHub names an App
                               installation for: proveByApp + a verification row; never asked to install again).
                               v2.14 T6 (spec 2): the App as the only proof (the proof-branch module and its test were
                               deleted; proof_branches and proof_line_issues stay, unused). APP_PROOF 'github_app', APP_REMOVED,
                               APP_CHECK_PER_RUN 50, APP_CHECK_EVERY_MS 1 day, APP_PROOF_FRESH_MS (a day + 2 h);
                               repoProof(builderId, key, db?, { forAction? }) (app / kept / none / taken / copy;
                               forAction: only a github_app proof GitHub confirmed within APP_PROOF_FRESH_MS: coins,
                               deploys, hosting); proveByApp (appSetup's last step: GitHub names this installation for
                               the repo, one read with its token, fork/template -> derived, then ONE transaction under
                               repo_hold:<key> and source_proof:<id> locks: heldByOther, verify github_app with gh ids,
                               public_at from GitHub's private flag; then source_verified, the connect read, rescore, and
                               on the first proof R13's backfill within the connect budget); installLink (the App
                               link, null with the App off or no page); appClient (one token, GETs); appCheckStep (cron
                               step app_check: GitHub still names an installation this person proved, else proposed +
                               APP_REMOVED + rescore); moved here: heldByOther, ORG_PROOF_MAX_AGE_MS, ORG_PROOF_PER_RUN,
                               STALE, STALE_RETRY, expireOrgProofs, orgProofExpiryStep (re-proof is the App);
                               Fix round 1: appProofLive (an installation this person proved; an org's prover still admin;
                               held / gone / unknown), recheckAppSource (applies it; appCheckStep and repoProof forAction on
                               a proof older than APP_PROOF_FRESH_MS use it; v2.14 final fix: no login option, sharedAppProven
                               gone: a shared client has no proof), REPLACED_BY_APP (an App proof replaces another person's non-App hold;
                               heldByOther counts App holds only).
                               Launch ready L2: proveByApp = proveOne (the checks and the one transaction; returns Proven) +
                               connectProven (replaced people rescored, events, one connect read of every proven row,
                               rescore, backfill for first proofs; one REFRESH_BUDGET_MS, or less: o.deadline); pickLink (the repo picker's link).
                               tests: v214-app-proof.test.ts, repo-picker.test.ts (fixtures fake-github.ts, app-install.ts)
    v214-journey.test.ts       v2.14 T12: acceptance 1 to 5 end to end on fake X and GitHub (fetch throws; every fake call routed)
    v214-removed.test.ts       v2.14 T7: the claim page, join route and join modules gone (wallet page stays), the tables
                               kept, tell takes no pickup, bindX never asks, the S4 detach migration, a refused re-auth keeps
                               the old token
                               tests v2132-followups.test.ts (fakeGitHub in fixtures/fake-github-branch.ts)
                               v2.13.3: appBearer (the App's per-call installation token for a repo this person installed it on) on the probe and the branch check.
    reply-wait.ts              v2.13.1 O5 N1: REPLY_WAIT_MS (1.5 s), settleWithin, inTime/ReplyLate: the Bench
                               reply never waits longer on the refresh, matching or the proof check
    week-facts.ts(+test)       v2.13 T4: WeekFacts, weekFactsFor (R16b: no users_up or earned), factChips, startedLine, upsertWeekFacts,
                               launch-ready: shipReading (one LATERAL: the newest good reading, a reader-2 one first),
                               weeklyFactsStep (Mondays from 15:00 UTC); v2.14 T8: the step reads an App-proven repo's
                               week titles (appClient, ghFetch) and upsertWeekFacts stores them (project_updates.titles);
                               scoring and clarity R13: writeWeek (the per-week body: facts, titles, row, events; shared
                               by weeklyFactsStep and the backfill), BACKFILL_WEEKS 3, BACKFILL_PER_RUN 20,
                               BACKFILL_TRIES_A_DAY 3, backfillMondays, backfillWeeks, backfillOnConnect (repo-proof.ts
                               proveByApp, first proof only), backfillStep (cron step backfill, after weekly; facts
                               titles_read marks a completed titles read); fix round 1: weekFactsFor's shipped_code
                               passes person-score.ts weekCounts (one floor for both paths), setShipTitles clears
                               titles_read on the backfill weeks; tests backfill.test.ts
    ship-titles.ts(+test)      v2.14 T8: TITLES_MAX 3, TITLE_MAX 80, cleanTitle (final fix 13: TITLE_MIN 3 by letter and digit
                               code points, a Han, kana or Hangul character counting 2), shipTitles (checkUpdate on each),
                               readWeekTitles (2 calls), namesRepo, titlesShown (S9: a private repo's titles show only
                               while builder_profiles.ship_titles_at is set, never naming the repo); week-facts.ts
                               weekTitles calls readWeekTitles; tests ship-titles.test.ts, v214-ship-log.test.ts
    week-summary.ts(+test)     weekly updates: weekSummary (Haiku aiSummary when ANTHROPIC_API_KEY, else ruleSummary; checkUpdate;
                               privateRepo: AI only, never naming the repo or a file), summaryShown (read-time privacy rule;
                               `approved` shows a private repo's stored summary), namesPath, SummaryCreate, tidySummary, clauseOf
                               GTM W3: boastsFix (never stored or shown), BUG clauses read "Fixed"; the prompt forbids it
    past-verb.ts               GTM W3: pastVerb (moved from week-summary; also ship-titles cleanTitle's asFix for "fix:" titles)
    project-name.ts(+test)     GTM W3: refKey, reportedProject, reportedNameIn, reportedName: the builder-given project name
                               (identity.projects, loose ref match) for replies and person-score's row name
    update-text.ts(+test)      v2.13 T5: checkUpdate (280 characters, no @, secrets, own links only), notes
    update-links.ts            v2.13.1 O4: RENDERED_LINK / RENDERED_TRAILING, the card's link rule; update-text
                               re-scans stored text with it (no hidden-character parser differential)
    updates.ts(+test)          v2.13 T5: postUpdate, hideUpdate, ownLinks (tell update); v2.14 T8: setShipTitles;
                               2026-10-22: titlesAskDue (main project, App-proven, private on GitHub's word, titles off, never asked),
                               takeTitlesAsk (standing_seen.titles_asked, once)
                               (tell updates { titles }; T9: on only when the main project's own repo is App-proven), UPDATE_LINES.auto/titlesOn/titlesOff; no setUpdates or weekly-task note;
                               UPDATE_POSTS_PER_DAY 20 a person (rate window updatePost:<root>); v2.14 T7: no probation
                               option (posted_by still written)
    feed.ts(+test)             v2.13 T6: pointsOf (R16b: went live, win, commits, streak only), feedRankStep (daily, feedRank:<day>), rankFeed, feedWeeks,
                               carouselCards, setFeedFlag (pin/hide); v2.14 T8: FeedCard.titles (titlesShown)
    bench-rank.ts(+test)       v2.13 T7: benchPool (re-export from person-score), chainPools, rankLines ({ bench: rank line,
                               line: score line, chains }; chain lines from one ranked project, R16e; R10: empty unless the one
                               project counts as confirmed now, so a stale builder_live.ranked never shows a rank)
    bench-reply.ts(+test)      v4.0 (Tasks 3-7, 8): setup in the approved copy: INTRO_LINE, introWhat, grantOpenLine, STATE_COPY.signed_out
                               (1 Sign in with X, 2 Connect your code, 3 Add your wallet), youreIn, pickRepoAsk(link, noGithub) with
                               NO_GITHUB_HINT (the Lovable/Bolt line only without GitHub), ask kind wallet_setup + walletSetupAsk (step 3:
                               the wallet and the token sentence; TOKEN_NO_LINE, WALLET_SETUP_SKIPPED), the setup-done reply (SetupOutcome
                               launched|set|declined|skipped, setupDoneLead, programsTable "| Program | Up to | Closes |", bestFitAsk,
                               setupDoneReply; BenchView.setupDone), mondayReply (opener, table with a blank header, cheer line, "Your
                               post is ready to share: {link}", MOMENT_ASK 'Looks right?'), firstName, BenchView.nudge (nudges.ts).
                               Tests v4-setup.test.ts, v4-weekly.test.ts. v4.2: shipLine (no points; shipPointsLine removed),
                               TITLES_NO_LINE, closestAsk / checkFitsAsk in setupDoneReply, TOKEN_OFFER (LEAD + QUESTION) and ask kind
                               token (stateAsk tokenOffer); final review 3: ask kinds closest and check_fits (setup done's own, so their
                               no never writes declined qualify:<key>); final review 4: ConnectOffer is { weeks } (no points);
                               final review 5: WALLET_DONE_HEAD removed. Tests v42-setup-done.test.ts, v42-legacy-offer.test.ts.
                               Older notes: v3.1 Task 16: the reply in the owner-approved copy (2026-10-21), pure; no headers. ReplyState
                               (signed_out, no_project, not_counted, ranked), Variant (taken, copy, no_repo, app_off),
                               replyState, rankedState; stateAsk (kinds sign_in, start, pick_repo, install_app,
                               other_project, repo_behind, connect, apply, backing, share, titles, qualify, ship, suggest);
                               benchReply per step: signed out (INTRO_LINE, introWhat(OpenGrant), grantHook; no points line,
                               2026-10-22), step 2 (youreIn, pickRepoAsk with NO_GITHUB_HINT; namesAccount), connect (connectStanding, qualifyLine,
                               connectAsk, "+P points"), ranked (standingLine, applyAsk / moneyLine, TITLES_ASK, the no-fit
                               path: v4.3 qualifyHead + qualifyGap + alsoLine(AlsoOpen[]) (or BenchView.fullTable, Task 2) + qualifyAsk(g, steps, name, hosted = false), no ship
                               or money line; else SHIP_ASK; shipLine), qualifySteps(g, steps, ask = true) (the qualify yes for use first; base first: ask false, QUALIFY_BASE_YES_NOTE;
                               QUALIFY_STEPS, BUILDER_CODES_GUIDE), qualifyCodesYes(name, missing = true) + QUALIFY_CODES_NOTE (v4.3: the codes-first yes), the moment (momentHead with no points, postLines or pageLine, MOMENT_ASK); v3.1 one-tap posts: POST_HEAD, POST_ASK,
                               PROOF_ASK, postReply, eventHead, redraftLine, PostOffer/EventPost, ask kind 'post' (after connect). awardAmount, BestFit,
                               ConnectOffer, MomentView, STATE_COPY, VARIANT_COPY, upcomingLine, backingLine,
                               displayName. 2026-10-23 Base onboarding: kinds base_start, next_step, new_repo;
                               BASE_START_ASK, BASE_START_STEPS, NEXT_STEP_ASK, TEMPLATE_NOTICE (BenchView.notice),
                               STALE_WEEKS, NEW_REPO_ASK; stateAsk inputs githubNo, baseAsk, newRepo. At most one https link, exactly one question, the points line last.
                               tests bench-reply.test.ts, reply-states.test.ts, v31-reply-copy.test.ts (mcpCall),
                               v31-reply-fixes.test.ts (2026-10-22 fixes)
    v31-cold-read.test.ts      v3.1 cold-read fixes (2026-10-23, v3.1-cold-read-fixes.md): the approved copy, the bugs, the coin
                               ask paths, the throttles, the wallet gate. Cold read in brief: bench-reply.ts youreIn once (welcome,
                               welcomeFits), CONNECT_LEAD/pickRepoAsk, grantProgramName/grantHook, builtWith/liveNoGithub,
                               baseStartSteps/LOVABLE_PROMPT_ASK, connectAsk(page), newBackersLine, BenchView standingShown/
                               nagShown/liveTool, ask kinds coin_publish and backers_post; bench-find.ts realFit, status_seen/
                               nag_week/backers_seen/github_no_app/welcomed, liveNoAnswer, connectNotYet (NOT_ON_GITHUB_YET),
                               tokenAsk paths (tokenConnectFirst, tokenPublishFirst, coinPublishAnswer, backersLine,
                               backersPostAnswer, TOKEN_NO_WEEK, TOKEN_LOG_PENDING), mainProjectName(For), rememberProjectName,
                               localReportOf; coin-moments.ts coinName, coinBlocked/COIN_BLOCKED, coinPreview, askedCoinOffer;
                               present.ts moneyHeader, noFitLine; submit-kit.ts siteFormLine; tools.ts chainFitLine;
                               builder-memory.ts factsAck; post-reply.ts proofAsk, weekPostReply; wallet-offer.ts
                               FEE_WALLET_QUIET_DAYS; stand-text.ts ANSWER_FIRST_NOTE; chains.ts CHAIN_EXPLAINED
    base-qualify.ts            2026-10-22: the no-fit path to Base Builder Grants. grantOf (organizer, award, one chain),
                               qualifyStatus (each step met/missing/unknown from alerts.ts programVerdict and the Builder
                               Codes answer), qualifyPlan (null when all met), qualifyOffer (open and shown, not declined
                               or told, not answered within DECLINE_MS; starts the Builder Codes check; never throws). tests v31-reply-fixes.test.ts
                               GTM W3: onBaseKnown + qualifyStatus(onBaseSaid): never "Put your app on Base" to a project on Base
                               v4.3: QualifyOffer carries title + when (fundWhen) for the reply's head (qualifyPlan's `head`)
    reply-format.ts            v3.1 (2026-10-23): formatReply (a blank line between lines, list items and table rows together, no
                               emphasis) and withFormattedReply; mcp.ts run applies it to every show_to_builder.
                               v4.0 Task 6: Surface 'rich' | 'plain', surfaceOf(client_name) (the caller's installation client; Grok Bot
                               and unknown clients rich, WhatsApp-style agents plain), formatReply(text, surface): rich keeps tables and
                               bold, plain turns table rows into "Label: a, b" lines, drops header/separator rows, strips **; tests reply-format.test.ts
    reply-facts.ts             v3.1 answerable replies (2026-10-23): replyFacts(ctx) -> ReplyFacts { page {url, public}, points
                               {total, this_week, what_for}, rank {line, score}, streak, shipped_last_week, wallet (short), coin
                               {symbol, url, backers, fees_to_you} | null (Backing on only), earned {usd}, applications, about };
                               the builder's own data via bench-data.ts profileData (its visibility rules); a shared client
                               without an X-bound own installation gets `about` only; aboutFacts (existing site-copy/docs-copy
                               lines only). tools.ts withFacts adds `facts` (and ANSWER_FIRST_NOTE) to every find and score
                               reply. tests v31-answerable.test.ts
    agent-reach.ts             GTM W2 (2026-10-23): agentReach(own, builder) -> { hosted, schedules } from installations.client_name
                               (hosted: grok, muse, meta, instinct, openclaw; schedules: grok, cursor, openclaw, hermes) and
                               standing_seen.no_folder (find told agent_can_build: false: rememberNoFolder; both true); reachOf (pure)
    conversation.ts(+test v48-conversation.test.ts)  v4.8 Task 1 (the launch conversation): Stage (hook, gap, draft,
                               submit, track), Path { stage, program_id, at, picked? } in standing_seen.path (readPath, setPath;
                               a program may be set before ranking: Task 4's pick), the session (SESSION_MS 2 h; sessionOf ->
                               { fresh, said }, markSaid into standing_seen.said { at, keys }), MENTOR_NOTE (the agent rewords in a
                               mentor's voice), bestMove (v4.8.1 R1 order: fit closing first; a grant with no gap closing in
                               48 h; a grant one agent-doable step away, a passed step not counted; the closest grant by gaps, a
                               passed one-gap step raised once (standing_seen.path_raised); only with none of those, an investor
                               program (difficulty_override.basis odds) or long shot (MoveProgram.longShot, the program file's
                               tag) closing within 7 days; a picked or past-the-hook program keeps its place; else quiet), pathReply
                               (Task 1: the hook only: A's opener for a fit or investor, "Want the steps?" for a gap; a hook said
                               this session is pointerReply: v4.8.1 R4, the reason once, then "more" (v4.8.2: no short
                               "Still {Program}. Reply no ..."; final fix F1: a second "more" sets `again`, so
                               bench-find.ts adds bench-reply.ts WAIT_NOTE to the agent note; v482-fixes.test.ts)), closeWords (v4.8.1 R2: "in N hours" under 48 h, else the zone's day),
                               moneyLine/closingSoon/withMoneyLine/MONEY_SAID (v4.8.1 R3: "Open now: $X in grants." once a
                               session, before the easy reply; v4.8.2 Task 2: then "Closing soon: {A} (...) and {B} (...)."
                               within 48 h, at most 2, from bench-find.ts closingPrograms; v481/v482-fixes.test.ts), proofLine, programName. bench-find.ts pathView
                               gathers the facts (pathSkip: entered, hidden, told, drafted, 'apply:'/'path:' nos) and stores
                               the hook's ask as apply, qualify or check_fits (path: true; a no also parks 'path:<id>').
                               fixtures/wallet-step.ts pathQuiet / pathUnquiet park every program for a test of an older ask.
                               v4.8 Task 2: gapReply (the steps, "I can do this." marks, Go? / first one / help), gapClosedReply,
                               draftReply, blanksAsk, draftShape (was draftBlanks; founder brief for an investor program with no public
                               questions, else required builder-only fields not held), FOUNDER_BLANKS. bench-find.ts gapYes,
                               gapDoYes, pathDraft, heldAnswers, codesConfirmed (re-check after the do-it yes: gap_did),
                               pathClosedCommit; bench-reply.ts qualifyGapSteps.
                               Fix round 1: gapStillReply / pathGapCommit (mid-gap "Still on ..."), gapProof, GapStep.offer.
                               Fix round 2: CODES_OFFER (hook "Go?"), draftShape { brief, drafted } (v4.10.2 final fix I1: the asks are bench-find.ts builderAsks + pathRound, rounds of 4; roundAsk), andComma,
                               blanksAgain; bench-find.ts codesConfirmed ('found'|'missing'|'checking',
                               RECHECK_WAIT), pathCheckingView, draftYes; base-qualify.ts qualifyOffer `allMet`.
                               v4.8 Task 3: SENT_ASK, submitBy, submitReply, submitPointer, TRACK_ACK, trackLead, agoWords (removed v4.8.2),
                               passedLine (GapGrant.passedAt), sinceDay, SinceFacts, sinceLine, stillOpenLine, DRAFT_NOW_ASK.
                               bench-find.ts pathSubmit (draft -> submit), SENT_NOTE, submitAsked, pathTrack (-> track),
                               submitWaiting / pathSubmitCommit (the submit pointer), sinceFor + withSince (fresh session);
                               tools.ts tell runs find after "sent" and leads with trackLead.
                               Fix round 1: SENT_AGAIN, MoveCtx.raisedNow, passedLine(them), seenBefore; tell move_up answer 'sent'.
                               v4.8 Task 4 (target B): OpenerProgram, openerHead, openerReply, openerAgain, pickedReply,
                               resolvePick, connectedLine, noFitWhy, OPENER_NOTE, PathCtx.steps. bench-find.ts openerPrograms,
                               openerView (signed out), takePick (find {program} -> path picked), pickWhy, connectedCommit
                               (standing_seen.opener { ids, titles, at }), PathPlan.ctx, pathCommit `pre`. Test fixture:
                               fixtures/opener.ts (assertOpener, isOpener).
                               Fix round 0: investorLater, connected_said, PUSHED_ASK (gapDoYes), x-install.ts attachOnce
                               carries path + opener to the joined page.
                               Fix round 1: pickHook, Path.steps, GENERIC_PICK; bench-find.ts openerRecord, pickGoneLine,
                               ViewIn.ahead, SetupDone.then_find; tools.ts tell runs find after a then_find reply.
                               v4.8 Task 5 (target C): ASK_SAID, StandingFacts, standingAnswer, standingAgain, PROGRAMS_AGAIN,
                               PREPARE_LINE, fitCell, programsAnswer, whatItIs. bench-find.ts directAnswer (find {ask}),
                               ViewIn.question/answer, linkHost; the path block's answered() wrapper.
                               Fix round 1: grantFact/GrantFact, fitOrder, standingSaid, ANSWERED_FIRST, TABLE_FROM, PathCtx.brief;
                               bench-find.ts cardFact, myChains, listHash, pathPlan {wide} + PathPlan.met, ViewIn.brief.
                               v4.8 Task 6 (the merge gate): fixtures/converse.ts (conversation, converse, transcript, gateFailures,
                               PROOF_PATTERNS, askMismatch, lazyNext, BOTH); the A, B and help walks in v48-conversation.test.ts;
                               scripts/converse-replay.mts. Fix round 1: conversation.ts proofOf, gapProofOf, Proof, PathCtx.baseSteps,
                               HELP_DONE_ASK, helpReply, helpNotYet, helpParked; bench-find.ts Seen bench_ask help/checks.
    bench-find.ts(+test)       GTM W2 (2026-10-23): link-only projects (a Lovable or Bolt live_url, no repo) take the no-GitHub path
                               (noCode: the picker link, github_no, the walk-through; linkName/YOUR_APP, reportedName: never the
                               host); backing before hot post and apply (boundedBacking first), connectBacking in the connect yes;
                               the Monday check-in (checkin_asked, CHECKIN_NOTE / CHECKIN_YES_NOTE, checkinAnswer); ship asked at
                               most once in SHIP_ASK_DAYS (ship_asked; else ask kind none, no move_up); hosted notes
                               (SHIP_STEP_NOTE_HOSTED, SHIP_NOTE_HOSTED, QUALIFY_STEPS_NOTE_HOSTED); base_help (baseHelpAnswer,
                               BASE_HELP_NOTE); NEXT_STEP_LATER for the no-GitHub nos; repo_behind no routed to githubAnswer; the
                               email question as move_up weekly_email (emailMoveUp, EMAIL_ASK_NOTE, emailAnswer); coveredRead and
                               rankAnswer prove a repo the builder's App already covers (repo-proof.ts proveCovered); appConnected
                               (installMoreAsk, never "Step 2 of 2" again); tokenAsk answers a launched, backed coin with backersLine.
    bench-find.ts(+test)       2026-10-23 Base onboarding: githubAnswer (pick_repo no/yes), connectAfterAll, restAnswer
                               (next_step), baseStartAnswer, afterGithubNo, walletStep, restStep, baseOpenFor, baseGrantOpen,
                               staleRepo, connectedSince (NEW_REPO_GRACE_DAYS), takeOnce, takeTemplateNotice, KINDLESS_ROUTED, BASE_START_NOTE,
                               BASE_STEPS_NOTE, NEXT_STEP_NOTE, NEW_REPO_NOTE, NEW_REPO_YES_NOTE.
    bench-find.ts(+test)       v2.13 T8/T9: benchFind, benchScore, benchAsked, benchMoveUp; v3.1 Task 12: scoreApplies
                               (score's matcher-less candidates) and bestApplies (told filter + applyCandidates); scoring and clarity R8:
                               tokenAsk (tell token: 'ask', the only path to the coin or community-round line:
                               showRaisingLine, an open offer again via openCoinLine, else backingOffer; EARNKIT_RAISING
                               off is tokenUnavailable (v3.1 final fix 1: confirm only exists with it on);
                               TOKEN_NOT_YET, tokenUnavailable, tokenHasCoin, RAISE_NOTE), SHIP_STEP_NOTE; R12: fitWhy
                               (the chain: deployed on / deploy to / build for, any chain, a live app) and whyFacts;
                               v2.14 T9: benchView builds the state (repoProof for taken/copy, installLink for the
                               install link, the sign-in link minted for the caller's own installation, D14), the
                               money (R12: up to 3 fits; Task 16: openGrant for the signed-out reply, connectMoment's
                               ConnectOffer with connectOfferPoints, weeklyMoment's MomentView), the stored ask; a held question (find's outcome question or
                               submission step, A17) replaces the state's, except signed out (signedOutNow: the
                               sign-in question wins; find skips outcomeToAsk until the bind; a failed mint asks to retry). "Signed in as @<handle>." once on the
                               first reply after an X bind (installations.x_signed_in_unseen; takeSignedIn clears it only with a
                               handle; signedOutNow reads a DB error as signed out, final fix 11, 12). benchMoveUp: taken-once
                               kinds incl. sign_in (SIGN_IN_YES_NOTE), repo_behind (REPO_BEHIND_NOTE), ship (SHIP_NOTE), pick_repo (PICK_REPO_YES_NOTE);
                               retired kinds (OLD_ASKS: enter, coin, raise, go_live, build, grants) are "Okay."; no grants ask,
                               no build-in-progress view. v2.13.4: reportedLive, liveOf (fundNeeds, needsPicks and NEEDS_MAX
                               were removed in v3.1 T16), START_NOTE, INSTALL_APP_NOTE, BENCH_OUTCOME_NOTE, SHIP_NOTE.
                               Launch ready L2: no_project carries repo-proof.ts pickLink (PICK_REPO_NOTE); rankAnswer (tell
                               main_project: main-project.ts rankRepo, rescore; else that repo's installLink), RANK_LINES,
                               RANK_SET_NOTE, RANK_INSTALL_NOTE. Launch ready L5, L6: benchView sets the ranked target
                               (weekly-target.ts targetFor, ranks only) and weeklyMoment (momentDue, lastWeekOf, takeMoment:
                               the moment's lines lead find's and score's show_to_builder, after "Signed in as"; the share
                               link is the ranked link; momentReady gates it; openShare keeps the offer open all week);
                               benchMoveUp kind share goes to answerShare (once, that week only; APPROVED_LINE); SHARE_NOTE.
                               tests v214-replies.test.ts (through mcpCall), v2131-o5.test.ts, v2133-owner-test.test.ts,
                               repo-picker.test.ts, weekly-moment.test.ts. 2026-10-22: benchView asks titles (updates.ts
                               titlesAskDue/takeTitlesAsk) then qualify (base-qualify.ts qualifyOffer, no fit only);
                               benchMoveUp kinds titles (setShipTitles on) and qualify (qualifySteps, QUALIFY_STEPS_NOTE;
                               v4.3: stored qualify.first 'codes' answers qualifyCodesYes(name) + QUALIFY_CODES_NOTE);
                               v4.3 alsoOpen (the qualify reply's Also open: two showable grants by byRelevance);
                               v4.3 Task 2: BenchFindArgs.more (find {more: true}): ranked only (else null, tools.ts keeps present.ts),
                               view.fullTable = present.ts fullProgramTable;
                               connectTitles in the connect yes; TITLES_NOTE, QUALIFY_NOTE
    raising.ts                 DELETED in v4.0 Task 11 (Backing retired; EARNKIT_RAISING is read nowhere).
    bench-data.ts(+test)       v2.13 T10/T11: parseBenchFilter, benchRows (safe names, pill in the same read),
                               launch-ready L3: BenchFilter is { chain, weekly } (v3 Stage 2 adds backed, ?backed=1),
                               profile and project tab data, logCards (v2.13.1 O3: the start is a "Started
                               tracking" chip on its week's card), gridWeeks (ship weeks + weeks with checked commits);
                               v2.14 T8: profile log cards carry titles (titlesShown, S9); launch ready L5: ProfileData.target
                               (weekly-target.ts targetFor, ranks only, voice 'page' since L10), shown under the why by BenchProfileView
    v213-final-fix.test.ts     v2.13 final fix wave: private names, lazy pick, proof repo and sign-in, the
                               Bench gate, the update limit, EARNKIT_RAISING off and on
    llms/{v212,v213}.txt       v2.13: the two /llms.txt bodies (flag off / on)
    v213-journey.test.ts       v2.13 T16: acceptance steps 1 to 7 (the runbook) on fakes in its own database,
                               plus Review Focus 3 (a Confirming claimant of the same repo) and 4 (flag off);
                               fixtures/claim-x.ts (claimThroughX), fixtures/arc-chain.ts (fakeArc, TIPJAR_ABI)
    sources.ts(+test)          v2.12 T5: Proof (v2.14 final fix: repoOwned gone), packageOwned, siteOwnedByText, contractOwnership
                               (fail strict), contractConflicts, proposeSource, verifySource, recheckSite,
                               rejectSource, dueSources (R16b: never contract, coin or merged_pr), previousSignals,
                               readSources (READS_PER_RUN 200; no org contributors call); v3.1 site proof: proveSite
                               (a proposed site, after its daily reading: the latest homepage of the App-proven
                               repo of its own project -> repo_link, else its origin's text/plain /earnkit.txt
                               profile: code -> earnkit_txt; site-proof.test.ts)
    builder-score.ts(+test)    v2.12 T6, T8, T9: SCORE_SLICE 0.4, scoreSliceEnd, LATE_HOUR_UTC 22, HOLD,
                               buildInputs (v1 rules, kept as history with its tests), holdReason, sourceShares,
                               profileEmpty, heldPeople, runScoreSteps (discover, read, score = person-score.ts
                               scorePeopleV2, empty), publicRow, heldForReview (R16b removed verifiedProject,
                               scoreContext, ringEdges),
                               (T12 removed scoreBuilders, percentiles, publicScore, emptyReasonOf)
                               siteShowsUse, scoresAdminKey (v2.12.1 T10: pitchAllowed removed, coin-moments.ts),
                               scoresAdminLink (pnpm campaign scores-link), scoresPost
    coin-moments.ts            DELETED in v4.0 Task 11 (the per-project coin offers; builder-token.ts replaced them).
    profiles.ts(+test)         v2.12 T7, v2.12.1: X_HANDLE, randomSlug (the internal key until the claim),
                               profileOf, ensureProfile (never a shared group), setFallback (login + basis; the
                               slug no longer follows it), releaseLogin, setHidden (HIDDEN_LINE, SHOWN_LINE with
                               the page link), deleteAsk (tell profile 'delete': only DELETE_OFFER, the offer to
                               hide the page; owner ruling 2026-10-24), clearXHandle (owner: sticky via x_owner_clears), releaseXClear,
                               ownerClears, xHandleConflicts (reads v2.12 rows; no new writes),
                               resolveSlug (claimed only), resolveHandle (HANDLE_REDIRECT_DAYS 90),
                               mergeProfiles (older group keeps its page; hidden/held either side)
    profile-cache.ts           v2.12 T10: PROFILE_TAG, profileChanged() (revalidateTag; no-op outside Next)
    share.ts                   v2.12.1: CARD_CACHE, SKIPPED_LINE, POST_LINE, signInFirstLine (v2.14 T7), cardYes(root, own) (the
                               share link of a page signed in with X, else "Sign in with X first: <x-link.ts signInLink>"); the
                               v2.12 offer is gone (T12)
    score-tool.ts(+test)       v2.12.1 T8: scoreReply (benchScore: where you stand, up to 3 fits, one step; score_viewed),
                               SCORE_SHARED, SEND_LINK_NOTE (v2.12's reply removed in T12)
    reserved-routes.ts(+test)  v2.12.1 T1: RESERVED_ROUTES (every top-level route; the test fails on a new one),
                               isReserved, pagePath (/b/<handle> for a reserved one), pageUrl
    score-v2.ts(+test)         scoring and clarity: computeScoreV2 (one Shipping score: round(90 x weighted active
                               weeks / 78) + 10 live bonus; parts { shipping }, room for originality), weekMask,
                               shippingOf, storedShipping (old four-part rows read as none), scoreWhy (the why
                               sentence: the weeks with code only, launch ready L5), weekGains (L5: active, gain, next, read
                               as of now's week); R16b removed countUse
    weekly-target.ts(+test)    launch ready L5: weeklyTarget (pure, ranks only, never a name: pass #k / N behind #k / hold #1 /
                               done this week; L10: voice 'page' for the profile, v3.1 F4: the rank only, never points: "Ship code this week to pass #2.",
                               page voice "Code this week passes #2."; shortOf stays exported, unused by copy), weekStartLine ("This week starts at Shipping S: ...") (the moment's "This week starts empty: ..." line), poolPlace
                               (benchPool: rank, and the score and rank just above), targetIn / targetFor (never throw)
    nudges.ts                  v4.0 Task 8 (approved copy 6): takeNudge / nudgeFor(builderId, now, { project, best }): at most one
                               nudge an ISO week (standing_seen.nudge_week = its Monday, one guarded UPDATE). Order: accepted or
                               funded (an unexpired, untapped verified post_drafts outcome, once a program in nudge_outcomes; one
                               drafted this week is the week's nudge, no line), a users milestone 10/100/1000 crossed this week
                               (app_usage, once ever: nudge_users), a confirmed unsubmitted entry closing within DEADLINE_DAYS
                               (v4.8.1 R-3 closesWhen: "closes in N hours" under 48 h, else the program-zone day), nothing shipped Friday to Sunday UTC with a streak of 2+ (streaksFor).
                               bench-find.ts benchView leads a ranked reply with it (BenchView.nudge), never with a held question,
                               setup step 3, the Monday block, a post offer or connect; the closing nudge drops that reply's deadline line.
                               Fix round 1: pickNudge / claimNudge split; a nudge with a question (closing: apply ask for its
                               program; accepted: 'outcome_share' ask, its yes outcomeShareLine) owns the reply's one question
                               (no other ask made or stored); the closing nudge for the submit step's own program stands in for
                               that held question (benchFind); only its own deadline line is dropped. outcomeNudgeShown: the
                               tell's accepted/funded reply (post-reply.ts acceptedReply) is the approved line and the week's nudge.
                               Test: v4-nudges.test.ts.
    weekly-moment.ts(+test)    launch ready L6: momentLines ("Last week you finished at Shipping 72 (+6), #3 (up 2)." + up to 2
                               titles + weekStartLine), momentReady (row checked or Monday 15:00 UTC passed), titleHasLink,
                               shareText, shareLink (page-data shareIntentText), lastWeekOf (builder_scores' last ranked day
                               of last week and the week before, rank among that day's listed rows; titlesShown, then checkUpdate again),
                               momentDue / takeMoment (installations.moment_week, one UPDATE ... RETURNING), approveWeek
                               (facts.approved, approved_at, approved_via 'share'; the existing row matched case-insensitively,
                               else inserted), openShare / answerShare (standing_seen.share_open), SHARE_NOTE, APPROVED_LINE;
                               weekly-moment.test.ts through mcpCall, weekly-target.test.ts pure;
                               v4.0 Task 7 (pure): MondayFacts, CHEER_LINE, communityRow (null under $1; cheer at $100 or twice last
                               week), mondayRows (Shipping score "82, up 4", Streak, From your community), mondayOpener, mondayLines
                               (the email's "Label: value" lines), momentSummary (moved here). SHARE_NOTE (agent-facing): show_to_builder
                               gives the week and its one-tap post link and asks one question; show it exactly as given, never rewrite it;
                               fixtures/ranked-step.ts (RANKED_STEP, endsOnRankedStep) for tests of the ranked step
    post-drafts.ts(+test)      v3.1 one-tap posts Task 1: the post_drafts store. POST_MOMENTS, newCode (10 base32 chars,
                               CODE_PATTERN), createDraft (per-person advisory lock; 1 offered a 7 days, 1 asked a 24 hours,
                               3 in all a 7 days; 14-day expiry; post_drafted event), draftByCode, tapDraft (own, unexpired;
                               taps capped at TAP_CAP 100; first_tap_at; post_tapped on the first; no IP or UA), noteVisit
                               (visits and x_visits, VISIT_CAP), recentDrafts (newest first); Task 5 visitFrom (UA and
                               referrer: bot null, t.co/x.com 'x', else 'web'); PAST_OFFER_LIMIT (went_live, won, funded skip
                               the one offered a week; controller ruling); fix round: NewDraft.hold (the moment's hold
                               under the lock), rewordDraft (news in new words, in place)
    post-card.ts(+test)        v4.0 Task 9: LiveFacts.backing = the launched builder token {symbol, holders}; the pill reads "$SYMBOL · N
                               holders" from 5 holders, else "$SYMBOL". v3.1 one-tap posts Task 5: freezeCard (project, streak, score, rank from RANK_MIN_POOL, 12-week
                               grid, frozen at drafting), cardWeeks, postCardView (pure: layouts, stats, BACKERS_SHOWN_FROM 5,
                               never a price, proof needed for accepted/funded/won), postCardFacts (live pillCoin + backers)
    post-reply.ts              v3.1 one-tap posts Task 6: shortLink, weeklyPost (the Monday moment's post), eventPost (hot:
                               went live or won under HOT_HOURS; else any event), isHot, newsPost (tell update), outcomePost
                               (tell program_status with proof_url, else PROOF_ASK + PROOF_NOTE; OUTCOME_NOTED when the program
                               lists no proof hosts or X accounts), redraftAnswer (the yes to "Want a different version?"),
                               POST_NOTE; final review: eventPost tries each offered moment in turn and remembers nothing to
                               draft for the UTC day under eventStamp; v31-post-replies.test.ts through mcpCall. GTM W2:
                               outcomePost leads with outcomeCongrats (never nothing); coinLaunchedReply (confirm's launched
                               reply: coinLiveLine + the coin_intro post, else the coin's page); draftedReply takes a head
    post-writer.ts(+test)      v3.1 one-tap posts Task 2: the pure writer. POST_SHAPES (note, name_week, change, this_week,
                               count, bare, live/live_alt, won/won_alt, accepted/accepted_alt, funded/funded_alt, coin_intro),
                               writePost(input, history) (rotation: never one of the last 2 shapes nor the last opening word,
                               relaxed to not the last shape; weekly null when nothing fits, an event its first passing
                               wording), postProblems (banned hype and shill words, hashtags, cashtags but the coin intro's one
                               ticker, links but the shown name, emoji, em dash, "!", repeat, "just shipped" twice; "?" in
                               our wording reads "." and a note with "?" is not used), openingWord, isMilestone,
                               POST_MAX 200; copy-review.test.ts sweeps every shape
    post-moments.ts(+test)     v3.1 one-tap posts Task 3: which moments get a post. holdOf (pure cooldowns: weekly 13 days
                               after a tapped one unless a big week, one offer a week; once a project or program; one kind in
                               28 days; news 24 h; coin intro once ever), liveTiming (settles 2 days, stale after 14),
                               proofUrlOk (owner ruling 3: https X post or the program's own site; never earnkit, the
                               builder's site or repo), weeklyCandidate, wentLiveCandidate (week-facts firstLiveAt),
                               announcedWinCandidates (entry_outcomes announcement + source_url), verifiedOutcomeCandidate,
                               coinIntroCandidate (pillCoin), newsCandidate (checkUpdate), offeredMoment (won, went live,
                               coin intro, weekly; { weekly: false } the events only), draftMoment (writer + freezeCard +
                               createDraft; an asked redraft skips the hold); Task 6: MomentCandidate.at, HOT_HOURS 48,
                               weeklyCandidate(..., { week }) numbered as the moment names it; fix round: proofUrlOk
                               (ProofContext: listings, xHandles, builderHandle; SHARED_HOSTS, public suffixes, never the
                               listing page), hasEntry, upNow/UP_WITHIN_DAYS, coin intro within 14 days of launch; final
                               review: ProofContext.proofHosts (program proof_hosts only, never the listing hosts),
                               'no_proof_source', offeredMoments (every offerable moment in order), eventStamp
    embed-worker.mjs           scoring and clarity R3 fix round 2: the child process that loads transformers.js MiniLM q8
                               (EARNKIT_MODEL_DIR), JSON texts on stdin, vectors on stdout, batches of 4, then exits
    originality.ts(+test)      scoring and clarity R3: Originality (0 to 100, never ranked): originalityOf (the formula),
                               cosine, stripMarkdown, originalityText, textHash, nearestOf, workerEmbed (spawns
                               embed-worker.mjs once a step, killed at the deadline; EARNKIT_EMBED_OFF in tests), workerScript,
                               originalityStep (the cron
                               step: due query, README via appClient (on404), embed on hash change, written per project, rescore affected),
                               boundedEmbed/EmbedDeadline, readOriginality;
                               tables project_embeddings and known_idea_embeddings; ideas in programs/ideas/known-ideas.json
    sources.ts (fix round 2)   anti-backdating: withPastWeeks/withPastCounts (only this and last week new after a
                               reading), storedCommits (pushes_checked), needsPushCheck, pushedWeeks, readPushes, firstPushes
                               (/activity until verified: newest page, then the oldest page when full; unbacked weeks only in the gap between two full pages), previousRepoSignals (rename: repo id, else owner + created_at)
    rank.ts(+test)             scoring and clarity, v3 Stage 3 (spec 5.2: never "this week"): rankLine (the one rank phrase:
                               "#N of M builders", from 20 "Top P% of builders" in the top half; chains named), scoreLine ("Shipping 72 ·
                               <rank line>"; thousands separators), benchPercent, BENCH_CHAINS; rankSplit (lead number and
                               words, for the profile and the leaderboard rows)
                               v4.8 Task 5: rankWords ("#N of M builders so far" at any pool size, the direct standing answer)
    person-github.ts(+test)    v2.12.1 T3: PERSON_GITHUB_QUERY (one GraphQL query a person), reposQuery
                               (aliased by name, REPOS_MAX 25), readPersonGithub, readGithubRepos
                               v2.13.3: readAppRepos (a repo EarnKit's token can't read, through the App, keyed by source id).
                               R16b: REPO_FIELDS has no stars or forks; no org contributors call.
                               Launch-ready: readGithubRepos returns { repos, failed } (one busy repo's failed weekly
                               call fails only it; a repo refused on its own alias is in refused, aliasErrors); needsAllWeeks (the 52-week call only without a reader-2 baseline or
                               when last week isn't fully read); no weekly call past ReaderDeps.deadline.
    badge.ts(+test)            launch-ready L8 (v3 Stage 3 Task 6: THEME colours, black label, brand value, white text): badgeSvg, badgeValue (personFacts: rank only in the pool, else "not
                               ranked"), badgeMarkdown, badgeFor ("not found" for unknown, unclaimed, hidden), badgeResponse
                               final fix M6: badgeFileOk / badgeMiss (a name that can't be a handle never reaches the cache or DB)
    read-usage.ts(+test)       v2.12.1 T3: FREE_LIMITS, countingDeps, flushReadUsage (read_usage per provider/day)
    person-score.ts(+test)     v2.12.1 T4: personInputsV2, rescorePerson (builder_live, pending holds, the
                               25-project cap TRACKED_MAX), listedRanked (the one ranked population),
                               benchPool (listed ranked + benchConfirmedSql: the leaderboard's pool),
                               standingOf (ranks over benchPool), streak = commit weeks in a row, refreshPerson (REFRESH_MS 10 min, REFRESH_BUDGET_MS 8 s),
                               pageViewRefresh (page views: PAGE_REFRESH_MS a day, LIMITS.pageRefresh
                               200/h global, pageRefreshIp 20/h per IP),
                               readPersonLive (source_live; R16b: repos, sites, packages only), scorePeopleV2
                               (cron; v2 history rows); R16b: no people, money or ring
                               (rescorePerson(id, now, { cron }))
    read-cost.test.ts          R16b: the outside calls of one daily read and one refresh, by kind (before/after in the guide)
    confirmed.ts               v2.12.1 T4: CONFIRMED_PROOFS, isConfirmedProof; owner batch 2026-10-23: SITE_PROOFS,
                               CONFIRMED_SITE_PROOFS, isConfirmedSource (earnkit_txt and dns_txt confirm a site only)
    identity-input.ts(+test)   v2.12.1 T5: identityInput (find's identity, lenient), mergeIdentity (reports
                               merge by project, never wiped), noteIdentity (proposes agent sources, at
                               most 25 projects; remembers wallets, never proof)
                               v2.13.3: benchIdentity (github_user, repos, local remotes, a live link fill identity under the Bench).
                               R11: a project name keeps up to 60 characters (NAME_MAX), whole words (wholeWords), never cut mid-word.
    x-oauth.ts(+test)          v2.12.1 T6: X_SCOPES, pkcePair, xAuthorizeUrl, xUserFrom, xOAuth (token + /2/users/me)
    x-install.ts               v2.14 T4 (tests: v214-x-install.test.ts): SIGNIN_TEXT, signinCookie, signinPage,
                               newSignin (x_signins row + __Host-eki- cookie), startInstallSignIn (straight to X or
                               the page naming the host), xSignInCallback (cookie-bound, one use, /2/users/me once,
                               code with x), attachToX (one tx: row lock, checks, attach alone or page from X,
                               bindXIn, x_user_id last; T5: always the installation alone: a root's members detached
                               first, a member leaves its old root when no page holds the X); T7: the X profile writer
                               moved here from the deleted claim module: BindResult, bindX (no held or join_pending branch; an X another
                               page holds is refused by the unique index), BoundX, bindXIn, afterBind (cache dropped in a
                               finally), errText (pg code + message for logs)
    x-link.ts                  v2.14 T5 (tests: v214-signin-link.test.ts): the fallback link. LINK_TTL_MS, PASTE_TTL_MS,
                               LINK_TEXT, SIGN_IN_NOTES, signInLink (HMAC(seed) code, hash kept, reused while open),
                               signinGet (GET /signin/<code>), linkSignedIn (callback 'link' branch: paste code hash,
                               15 min), pasteCode/formatPaste/normalizePaste, bindFromPaste (minting installation
                               only, one use, attachToX, signed_in_by_code event), agoText;
                               tools.ts find reads sign_in_code first (findReply is the rest of find)
                               fix 1: signinGet rate limit (signinLink), exact link via x_signins.link_hash,
                               code given back on a thrown error, a bound retry is ok
    live-check.ts              v2.13.4 R3: liveDefaults, parkedPage, checkLive, liveSite (standing_seen.live_check, a day)
    wallet-proof.ts(+test)     v2.12.1 T7, v3.1 wallet proof: upgradeToken/upgradeOf (30 min, random part), WALLET_TEXT,
                               walletMessage, walletLink, provenWallet (the recipient: newest recipient_at), provenSince,
                               tokenUseKey, verifierOn (viem on Base; a no is checked against the RPC), proveWallet (each
                               link once; EOA locally; replacing a recipient needs wallet_x_checks), walletPageState,
                               walletXStart, walletXSignedIn (sets the __Host-ekwx- browser cookie), walletTokenCookie, walletXCookie, walletPost.
                               v4.0 Task 4: ProveResult.first (a fresh proof that made the first reward wallet); walletPost then runs
                               launchOnProof (v4.7 T3: deleted; a proof never launches a token)
    wallet-offer.ts            v3.1 wallet proof: walletOfferDue, takeWalletAsk (claimed when shown), answerWallet (by
                               state: wallet_link_at), walletChangeReply (v4.0 final review 4: WALLET_COIN_FEES also for a launched
                               builder token), takeWalletNotice, WALLET_NOTE.
                               v4.0 Task 4: setup step 3 asks everyone for the wallet: walletSetupDue (X claimed, step 2 done or
                               github_no, no person_wallets row, wallet_asked unset), walletSetupNote(), takeWalletAsk(…, setup) stamps
                               standing_seen.wallet_setup. v4.4: walletSetupToken removed (step 3 asks for the wallet only); its no is the
                               wallet skip (WALLET_SETUP_SKIPPED), the token's no only for a builder shown v4.0's sentence (token_offered);
                               answerWallet's WalletAnswer carries wallet and step3 for afterStep3's setup offer; signedToken is null for
                               an existing row
                               v4.2: contractsOnBase (the only time "Your contracts on Base will show" is said); tokenOfferDue /
                               takeTokenOffer (the legacy offer, Task 6; final review 1: the show writes token_offer_legacy only, never
                               token_offered); answerWallet returns WalletAnswer (final review 5: a typed signed flag for afterStep3;
                               signedToken's typed launched for the one "Done." line); final review 9: a wallet no with no token row
                               removes token_offered (keeps token_skipped). Tests v42-legacy-offer.test.ts, v42-setup-done.test.ts, v4-setup.test.ts
    gtm-w2-replies.test.ts     GTM W2 (2026-10-23), through mcpCall: value before the ask, the Lovable live-link path and the
                               walk-through (no "Okay.", no host as the name), hosted notes and the weekly ship question, the
                               check-in, an App already installed, tell submitted, an acceptance's congrats + post + Highlight,
                               backing above apply and in the connect yes, a private repo's coin under its public name, the
                               launch reply, the backers answer, the email move_up
    v31-base-onboarding.test.ts 2026-10-23 Base onboarding: the GitHub no remembered (github_no), the Base walk-through once
                               (BASE_START_ASK / BASE_START_STEPS, base_walk), the wallet step after the GitHub no, the
                               resting reply (next_step), the profile's "Getting started on Base", the picker's template
                               notice (template_refused), the old-repo nudge (new_repo, staleRepo)
    v42-token-answers.test.ts  v4.2 Task 1: each token state's copy; "launch my token" after a no; final review 2 (no question, stale ask cleared)
    v42-legacy-offer.test.ts   v4.2 Task 6: the legacy offer once, yes/no/silence, never in setup or for a test installation; final review
                               1 (a shown, unanswered offer + the cron: zero deploys; the yes: one) and 7 (move_up + token ask: one question)
    v42-setup-done.test.ts     v4.2: setup-done copy and endings (closest, check, check-in), the one "Done." on a sign; final review 3
                               (a no to closest is never Base's qualify no)
    v42-journey-fixes.test.ts  v4.2 Task 10: the fit-check question (check_fits yes and no), told facts over stored ones in scoreFits
    v42-fit.test.ts            v4.2 Task 4 (F5-F7): odds from told facts, one lead, a submitted entry stays submitted (markSubmitted entryId)
    v42-prepare.test.ts        v4.2 Task 5 (F8, F14): drafts show only real answers, x_handle from X, the nudge yes opens the draft (readyDraft)
    v31-wallet-proof.test.ts   v3.1 wallet proof: offer timing, one link one question, skip, change, recipient,
                               discovery and On Base since, the hero's GitHub button
    fixtures/wallet-step.ts    v3.1: walletOffered (a ranked-step test past the wallet step), walletXSignIn (the page's X
                               sign-in as a browser does it; returns the X-check cookie)
    v3-shells.test.ts          v3 Stage 3 Task 6: the shell pages, the unsubscribe pages, the card, the badge and the OG PNG on THEME
    docs-copy.ts               v3.1 site T10: every string on /docs (DOCS_NAV, DOCS_STEPS, DOCS_WEEK, DOCS_SCORE with score-v2
                               LIVE_BONUS, DOCS_MONEY, DOCS_SELECTORS, docsNav/docsMoney drop Backing with raising off,
                               DOCS_DESCRIPTION); pinned by v31-site-docs.test.ts and v3-docs.test.ts (under 250 words)
    v3-tokens.test.ts          v3 Stage 3 T1: THEME values and the globals.css mirror, contrast, no gradient/shadow/marquee, the
                               primitives and buttons, PART_COLORS kept, the shell button, DESIGN.md as the one-page rulebook
    v31-site-tokens.test.ts    v3.1 site T1: SITE mirror (globals.css, tailwind), contrast pairs, no s-dim on cards, the six
                               paintings (width, budget), Kaftan, reduced motion, body page/deep, Pager, ScoreText bands
    v31-site-landing.test.ts   v3.1 site T6: the landing (hero order, chip, Activity cards and invite, Opportunities #earn, the
                               raising-gated Earn step, the hero srcset and arch clip path, landing tokens)
    v3-landing.test.ts         v3 Stage 3 T2, v3.1 T6: HomeView order, one hero install button, no video/uppercase, empty landing,
                               the hero, Opportunities, the install sheet, the /NN scan
    v3-profile.test.ts         v3 Stage 3 T3: the three numbers row, the grid, the tabs, the Money tab rows, Share, the badge line, empty states
    v3-pages.test.ts           v3 Stage 3 T4 (T7: a rank 100 row, the 3rem phone rank column, capitalised guide facts): the
                               leaderboard, the chips, the feed, ProgramCards/ProgramRow/ProgramLogo, the guide states, the 404, rankLine
    v3-docs.test.ts            v3 Stage 3 T5: the Docs page's sections, the agents' steps shared with the sheet, the word budget
    brand-page.ts              v2.12.1 T11, v3 Stage 3 Task 6: the flat shell of every route-handler page (CSS from THEME: black page, the slim header, no panel, hairline rows, BTN_PRIMARY button; Funnel Display woffs via fontFile and Funnel Sans woff2 via sansFile as data: fonts), X_ICON, GITHUB_ICON; the unsubscribe pages (digest.ts) and the week page use it too
                               Scoring and clarity R14: the one shell for every sign-in and verify page (verifyPage, signinPage, the 404s, OAuth authorize 429/400, wallet 405); page-shells.test.ts checks each carries the slim top bar
    stand-text.ts              v2.14 T3 (was where-you-stand.ts): EARN_NOTE, newsOpener, standingNews, NOTED_LINE
                               (Task 4 removed the dead step, project and money-line types and helpers)
    stand-view.ts              v2.12.1 T8/T9: startRefresh, standBase ({ standing, claimed, handle, signInLink }: v2.14 T7
                               signInLink for the caller's own installation; Task 4 dropped the projects read and the
                               count-past and tip-jar steps), takeNews, earnPrize, earnWhen, fundWhen (R12: "closes Oct
                               30" or "rolling"; v4.8.1 R-3: with now, "closes in N hours" under 48 h), showable, biggestPick, scoreFits (score's apply candidates from
                               fit_repos and alerts.ts repoCanWin { apply }; v3.1 F1: bench-find.ts fitLines takes FITS_MAX 3)
    attribution.ts(+test)      v2.12.1 T9: personCode (ek_...), attributionSuffix (ERC-8021), baseBuilderCode
                               (EARNKIT_BASE_AGENT_CODES), attributionFor, chainOf
    page-data.ts(+test)        v2.12.1 T11: every public sentence (SOURCES_LINE, NOT_CONFIRMED, NOT_TRACKED,
                               NONE_CONFIRMED, NOTHING_YET, BOARD_TITLE, boardLine, topLine, peopleLine,
                               cardHeadline, shareIntent), money, avatarUrl, displayName, personFacts,
                               pageHead, pageCards, bestProject, boardRows
    v2121-journey.test.ts      v2.12.1 T12: the flag-on journey on its own database (fresh install to page,
                               count, coin, card, board); v2121-find.test.ts T8; v2121-schema.test.ts T1;
                               fixtures/banned-words.ts (BANNED_WORDS, bannedIn: copy-review 12.1, 12.2)
    scoring-lock.ts            v2.12 T13 (R19): withScoringLock, moved out of the archived sponsor.ts
    sponsor-cli.ts             v2.12 T13: sponsorCommandBlock (campaign.mts refund/fallback refuse with the
                               sponsor flag off)
    yes-no.ts                  v2.12 (R23): yesNo, moved out of aliases.ts (tools.ts re-exports it)
    v212-journey.test.ts       v2.12 T15: the end-to-end journey on its own database (see the
                               architecture guide's v2.12 section); v212-schema.test.ts T1's schema checks;
                               archive.test.ts T13/T14's flags-off checks; card-route.test.ts T11
    veto.ts(+test)             vetoKey, vetoLink, vetoEntry (FOR SHARE on the run), vetoPost, VETO_ERRORS
                               (v2.14 final fix: the bonus round branch, bonusVetoKey, bonusReviewLink and vetoBonusEntry are gone;
                               bonus_vetoes stays, unused; no `pnpm campaign bonus-link`)
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
    sponsor.ts(+test)          ARCHIVED v2.12 (archive/sponsor-campaigns/files/; withScoringLock moved to
                               scoring-lock.ts). Was: DB + chain: createSponsorDraft (binds sponsor_wallet; replaces: retires
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
                               v2.14 T7 (bind block, before the bind UPDATE): preflight S4 detaches the members of every
                               page_joins row still attached with no eligible answer (builder_id back to from_root, their
                               updates since the join hidden, the row stamped detached; no deletes, a rerun is a no-op);
                               v2.10 item 13: contract_deploys (reservation row, builder_key, tx_hash, status, owner_ok, blocked, cost_micro_usd).
                               v2.11 T3: contract_deploys.owner_wallet, block (nullable), code_differs; submissions_project index.
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
                               v2.9 Task 9: projects.fee_recipients (jsonb), fee_claims (ops log, never revenue);
                               v2.10, additive: url_checks.n and note, match_shown.traction,
                               github_repo_facts.via_app, installations.deadline_shown, projects.repo_private,
                               github_verify_nonces.login/account_created_at/public_repos/seed,
                               github_verifications.via ('oauth' | 'app') and github_installation_id,
                               repo_public_reads (H6), token_offers.offered_wallet, contract_deploys)
                               v2.11 (all additive): the table builder_events (append-only event log,
                               dedupe_key UNIQUE, no FKs; trigger builder_events_append_only() refuses
                               UPDATE/DELETE/TRUNCATE; the owner redaction may only null login/wallet and
                               change detail, with earnkit.events_redact = 'on:<current txid>');
                               usage_check_failures (failed usage checks in a row per deployed event);
                               proof_line_issues (installation_id, repo_key, first_at: the line's first issue).
                               Columns: installations.fresh_offer_at (the metric's start, set once) and
                               installations.build (the build in progress, S6); programs.fresh_build (jsonb);
                               host_upload_tokens.basis and host_deploys.basis (signin | app | proof_line);
                               contract_deploys.owner_wallet, block, code_differs, line_owner; indexes
                               contract_deploys_repo_day and _wallet_day, submissions_project
                               v2.12 (all additive): builder_profiles (builder_id PK = group root; x_handle,
                               fallback_handle, github_login (unique lower), slug (unique), hidden, held,
                               twitter_prefill, card_offered_at, x_asked_at, first_find_at, empty_checked_at,
                               consent_shown_at, created_at, updated_at), profile_slug_history (old_slug PK,
                               builder_id, moved_at), builder_sources (kind, ref, project_key, proof, state,
                               reject_reason, proposed_by, last_read_day, deployer, verified_at; unique
                               builder_id+kind+ref; index builder_sources_due), source_readings and
                               builder_scores (append-only via v212_append_only(); builder_scores.projects,
                               held, parts, top_outcome, formula, calibration), score_releases, builder_ranks,
                               discovery_queue, x_handle_conflicts; programs.agent_completable (default true);
                               builder_events.type gains the 14 v2.12 types (incl. x_cleared); COMMENT
                               'archived v2.12' on sponsor_campaigns, sponsor_verifications, chain_checks, starters
  scripts/                     db-migrate.mts, programs-sync.mts (load .env.local); v2.7: programs-sync
                               writes the guide columns; --check (pnpm programs:check) also checks each logo file
                               (logo-check.ts) and the required items' todo; v2.8 Task 12: also validates
                               programs/outcomes/*.json and sync matches them (syncOutcomeFile);
                               v28-complete-at-window.mts: the Ruling C7 ship step (dry run by default)
                               events-backfill.mts: v2.11 T3, the owner's one-off event backfill (needs
                               EARNKIT_EVENT_LOG=on; never predeploy or cron)
                               scripts/feed.mts: v2.13 T6, pnpm feed:pin|feed:hide <update-id> [--off] (owner-run); scripts/feed-summaries.mts: pnpm feed:summaries [--dry] [--redo]
                               scripts/og.mts: v3 Stage 3 Task 6, ogImage() / `npx tsx apps/frontend/scripts/og.mts` writes public/og.png (1200x630) from the hero words through the card's renderer
                               v211-metric.mts: v2.11 T13, the success metric, shown, never a target
                               (owner-run, read-only; never predeploy or cron): of no-repo builders who said
                               yes to the build (fresh_offer_at, not shared, installations.build set), the
                               share with deployed, hosted and entered within 24 h of the lead (--as-of)
                               events-redact.mts: v2.11 T12, the owner's redaction of one builder's login
                               and wallet in builder_events (--login/--wallet, dry run unless --apply);
                               lists the main other tables, keys and repo columns holding them, never changes them (lib/earnkit/
                               events-redact.test.ts runs it as a child process); v2.14 T7: the profile clear also unbinds the
                               person's installations (x_user_id) and deletes their x_signin_links rows; v2.12: also the profile's login,
                               X handle, fallback, slug and slug history, sources' ref/project_key/deployer; v3.1 one-tap
                               posts: post_drafts (project_key, text, moment_key listed; its rows deleted with the page data)
                               v212-metric.mts: v2.12 T15, the empty-profile rate for new installs per UTC day
                               (`<day>: N new, E empty (P%)`; --as-of, --days 14), shown, never a target
                               (owner-run, one READ ONLY transaction; v212-journey.test.ts 15.5 runs it)
                               v2121-metric.mts: v2.12.1 T10, per ISO week `Coin offers: shown N, accepted A,
                               launched L`, reads per day per source against read-usage.ts FREE_LIMITS, claimed
                               pages, `Leaderboard: N real builders (goal 20, shown, not a target)` (--as-of,
                               --days 7; owner-run, one READ ONLY transaction; v2121-metric.test.ts runs it)
                               v2121-prod-check.mts: deleted in v2.14 T3 (with lib/earnkit/v2121-prod-check.ts)
                               v2121-seed.mts: v2.12.1 T11, seeds a local v2121_shots database for the design
                               screenshots (refuses any other database)
                               archive-restore.mts: v2.12 T13, `<feature>` moves archive/<feature>/files back
                               (git mv, refuses if a target exists) and names the feature's flag
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
                                re-run survival; v2.14 T7: the JOIN_TABLES coverage and pending_joins consent
                                checks are gone (nothing moves rows by table); checks installations.x_user_id,
                                x_signins, x_signin_links, builder_sources.app_checked_at instead
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
    campaign.mts                v2.12: scores-link (the /admin/scores link; ADMIN_VETO_SECRET, no database);
                                refund/fallback refuse while EARNKIT_SPONSOR_CAMPAIGNS is off (sponsor-cli.ts).
                                golive|rank|payout (dry run)|veto-link (EarnKit's own campaigns) and
                                fallback propose|execute|veto, refund, sync [<ref>] (sponsor
                                campaigns; local only; sync reads the chain for one ref or sweeps
                                draft/expired/live; refund --escrow refunds a stray escrow);
                                errors are one line + exit 1; propose refuses before endsAt + 7
                                days onchain, refund names who gets the money
    sponsor-e2e.mts             ARCHIVED v2.12 (archive/sponsor-campaigns/files/; `pnpm sponsor:e2e` removed). Was: full sponsor flow (wallet-bound draft -> fund -> status finds it ->
                                entries -> award read onchain; front-run and wrong-amount deposits,
                                fallback propose/re-propose/execute and propose/veto, the operator
                                CLI, entry statuses, sponsor replies without hashes, five-answer
                                create, ranked awards and fallback) against a local
                                anvil + Postgres; `pnpm sponsor:e2e`
```

Root commands: `pnpm programs:check` (validate program files, logo files, and a `todo` on every
required submission item), `pnpm test` (v2.9 T12: runs `pnpm host:typecheck` first, P42; Part 2 final review I3: it and
`token:e2e`, `campaign:e2e` and `sponsor:e2e` preload `lib/earnkit/fixtures/test-guard.ts`, which
clears the tokens.fun, Resend, R2 and GitHub OAuth keys and makes `fetch` throw for any host but
localhost, 127.0.0.1, ::1 and `BONUS_ANVIL_URL`; `LINK_CHECK=1` keeps the real fetch; v2.14 T2: it first rebuilds
this worktree's test template, and the guard gives every test file its own database),
`pnpm campaign --help`, `pnpm campaign scores-link` (v2.12: the owner's /admin/scores link), `pnpm campaign golive|rank|payout|veto-link <slug>` (EarnKit's own
campaigns; payout is a dry run only, the cron pays), `pnpm campaign fallback propose|execute|veto <ref>`, `refund <ref>` (sponsor
campaigns; dry run without `--execute`; `OPERATOR_PRIVATE_KEY`, the veto `GUARDIAN_PRIVATE_KEY`;
`refund <ref> --escrow <address>` refunds a stray escrow for that ref), `pnpm campaign sync [<ref>]`
(reads the chain and updates the database: one campaign, or every draft/expired/live one; v2.12: refund and
fallback refuse while EARNKIT_SPONSOR_CAMPAIGNS is off), `pnpm sponsor:e2e` (archived in v2.12 with the sponsor
flow; restore with `archive-restore.mts sponsor-campaigns`),
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
v2.11 (each off when unset): `DEPLOYER_PRIVATE_KEY` (deploys; with it the no-repo lead and the build
path run, hosting on GitHub Pages without R2), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `EARNKIT_RESERVED_SUBDOMAINS` (EarnKit hosting, optional),
`EARNKIT_EVENT_LOG=on` (the event log and usage checks; only once `/terms#what-earnkit-records` is
live). The owner's go-live order is in the architecture guide's v2.11 section.
Test only: `EARNKIT_BLOCKSCOUT_URL` and `EARNKIT_OWNERSHIP_BASE_URL` (honored only when NODE_ENV is
development or test).

Sponsor escrow (v2.1), also never on Railway's write path — the server only reads the chain:
`ESCROW_CHAIN` (`base` | `base-sepolia` | `local`), `ESCROW_FACTORY_ADDRESS`, `ESCROW_RPC_URL`
(falls back to `BASE_RPC_URL` on `base`), `ESCROW_LOCAL_TOKEN` (the mock token address, `local`
chain only). `OPERATOR_PRIVATE_KEY` (fallback propose/execute, refund) and `GUARDIAN_PRIVATE_KEY`
(fallback veto) are local only, never on Railway.

v2.13 changed entry points: `tools.ts` `list_programs`/find branch to `benchFind` and `tell` takes `update`,
`updates` (always since v2.14 T3, which retired `EARNKIT_BENCH` and `EARNKIT_BUILDER_SCORE`) and `coin { raising }`
under `EARNKIT_RAISING` (`moveUpAnswer` goes to `benchMoveUp`); `builder-score.ts runScoreSteps` gains `weekly` and
`feed` steps; v2.14 T3 deleted the bonus steps and bonus-rounds.ts; `policy-constants.ts EARNKIT_SPLITS_BPS` holds
both fee splits; `app/llms.txt/route.ts` replaces `public/llms.txt`; `schema.sql` adds
`builder_profiles.main_project_key/updates_on_at`, `project_updates`, `builder_projects.chains/streak/
weeks_shipping`, `projects.raising_at/coin_tx/coin_chain_id`, `programs.pitch` and the new event types.

v2.14 T10: `app/layout.tsx` loads Funnel Display and Funnel Sans through `next/font/local` from `app/fonts/*.woff2`
(SIL OFL 1.1, `app/fonts/OFL.txt`), same `--font-funnel-display`/`--font-funnel-sans` variables; no Google fetch at
build. `fonts` is in `reserved-routes.ts` (the folder has no page).

v3 Stage 1 (the founder's loop; see the architecture guide's "v3 Stage 1" section): `points.ts` (the `builder_points`
ledger: `awardWeekPoints`, `pointsForRank`, `CONNECT_POINTS`, `pointsTotal`, `POINTS_LINE`; `POINTS_PAGE_LINE` removed v4.3),
`connect-moment.ts` (every unconfirmed week with facts, at most 12, in the first ranked reply and the one yes; `backfillComplete`), `week-links.ts` (signed
"Looks right" and "Hide this week" links), `app/api/week/route.ts` (GET shows the button, POST acts). Changed:
`week-facts.ts` (`pointsOf`, `UNCONFIRMED_LABEL`; `upsertWeekFacts` awards an approved week's points when its facts arrive late), `weekly-moment.ts` (`approveWeek` via), `digest.ts` (Monday email, `EMAIL_QUESTION`),
`oauth.ts`/`x-install.ts` (hosted clients), `scripts/feed.mts` (`rank`). New tests: `v3-hosted-client.test.ts`,
`v3-week-points.test.ts`, `v3-unconfirmed.test.ts`, `v3-points.test.ts`, `v3-connect.test.ts`,
`v3-monday-email.test.ts`.

v3 Stage 2 Task 1 (programs, `upcoming`, the honest total, Base first; see the architecture guide's "v3 Stage 2: money",
Part 1): `program-file.ts` (`status` adds `upcoming`, `opens_note`, `in_person`), `db/schema.sql` (widened status
check, two columns), `programs.ts` (`listPrograms` lists upcoming; `programCard` status/opens_note/in_person),
`present.ts` (`byRelevance`; `presentFirstMessage` drops upcoming), `pool.ts` (`openMoneyUsd` skips investments,
`openMoneyWords`, `openGrantsText`), `landing.ts`, `stats.ts`, `guide.ts`, `bench-find.ts` (`UPCOMING_STREAK`),
`bench-reply.ts` (`FundLine` `upcoming`, `upcomingLine`), `tools.ts`, `submit-kit.ts` (`continuesLine` null without
steps), `ProgramCard.tsx`, `ProgramCards.tsx` (`more`), `GuideView.tsx`. Programs: `alliance-all19`,
`ethglobal-mumbai`, `monad-nitro`, `base-batches-005`. New test: `v3-programs.test.ts`.

v3 Stage 2 Task 2 (the drafted application and the outcome loop; see the architecture guide's "v3 Stage 2 (Task 2)"
section): new `ship-log-facts.ts` (`ShipLogFacts`, `shipLogFacts`, `shipLogBlock`, `SHIP_LOG_NOTE`). Changed:
`bench-reply.ts` (`BenchAskKind` `apply`, `BenchAsk.program_id`, `APPLY_WINDOW_DAYS`, `applyAsk`, `ApplyPick`;
`stateAsk` order connect > [backing slot] > apply > share > ship), `bench-find.ts` (`Fit.ends_at`, `applyPick`,
`APPLY_NOTE`, `APPLY_YES_NOTE`, `APPLY_OUTCOME_NOTE`, `DECLINE_MS`; benchMoveUp `apply`), `stand-view.ts` (keeps
`apply_asked`), `tools.ts` (prepare's ready draft opens with the ship log block, `ship_log`; `askOutcome`,
`APPLY_ASK_OUTCOME_NOTE`), `mcp.ts` and `builder-memory.ts` (`PROGRAM_STATUSES`, `MEMORY_STATUSES`: accepted, funded,
rejected), `outcomes.ts` (`OutcomeAsk`, `outcomeLine`, `applyAsk`, `APPLY_OUTCOME_DAYS`; outcomeToAsk falls back to an
application), `page-data.ts` (`ProgramLabel`, `programLabel`), `bench-data.ts` (`liveSite` exported),
`app/[handle]/ProjectTab.tsx` ("Won X" / "Applied to X"), `stats.ts` (`applications`, `accepted`), `db/schema.sql`
(widened `builder_program_status` CHECK, `asked_at`). New test: `v3-apply.test.ts`.

v3 Stage 2 Task 3 (Backing; see the architecture guide's "v3 Stage 2: money", Part 3): new `builder-json.ts`
(`BuilderJson`, `builderJson`, `builderResponse`, `builderPreflight`) and `app/api/builders/[handle]/route.ts`
(GET `/api/builders/<handle>.json`, 60 s unstable_cache keyed by EARNKIT_RAISING, CORS https://tokens.fun). Changed:
`policy-constants.ts` (`BACKING_EXCLUDED_REPOS`), `coin-moments.ts` (`Moment` `first_week`, `BACKING_OFFER`,
`raiseLine` = the backing offer, `backingOfferable`, `backingOffer`), `raising.ts` (Backing copy), `bench-reply.ts`
(`BenchAskKind` `backing`, `FundLine` `backing`, `backingLine`; `stateAsk` connect > backing > apply > share > ship),
`bench-find.ts` (`BACKING_NOTE`; benchView's backing offer and fund line; benchMoveUp `backing` -> tools.ts
`coinAnswer`, now exported), `mcp.ts` (descriptions), `bench-data.ts` (`ProfileData.backing`, `BenchRow.backing`,
`BenchFilter.backed`/`?backed=1`, the project tab's coin line only with the flag), `policy.ts` (`BACKING_TITLE`,
`BACKING_POINTS`), `app/terms/sections/PolicySection.tsx` (the Backing section with the flag; "The token is optional"
removed), `app/terms/page.tsx` (revalidate 600), `RaisingPill.tsx` ("Backing · $X", `data-pill="backing"`),
`BenchProfileView.tsx` (the `Back <project>` button, `data-ek-back`), `BenchView.tsx`/`FilterChip.tsx`
(`FILTER_BACKED`), `BenchRowItem.tsx`, `card-response.tsx`, `llms/v213.txt` and `app/llms.txt/route.ts`,
`fixtures/banned-words.ts` (`community round` banned; the offer's own risk words allowed), `db/schema.sql` (the
`coin_moments` CHECK lists `first_week` in both re-adds). New test: `v3-backing.test.ts`.

v3 Stage 2 Task 4 (Backers, Earned and "waiting"; see the architecture guide's "v3 Stage 2: money", Part 4): new
`backers.ts` (`indexBackers`, `backersOf`, `backersOfCoin`, `launchBlock`, `BACKER_EXCLUDED`, `POOL_MANAGER`,
`INDEXER_MS`, `INDEX_CHUNK`, `CALLS_PER_COIN`, `RECIPIENTS_PER_RANGE`) and `earned.ts` (`indexCreatorFees`, `earnedUsd`, `Earned`, `feesCursor`). Changed:
`bonus-ledger.ts` (`CLAIM_TOKENS`, `ERC20_TRANSFER`; `BonusRpc.transferLogs/poolHooks/claimTokenLogs`; runBonusLedger
steps `backers_index`, `creator_fees_index`), `fees.ts` (`cachedWethUsd`, `PRICE_WAIT_MS`, `creatorWalletSql`),
`bench-data.ts` (`ProfileData.earned`, backing counts), `BenchProfileView.tsx` (`Earned`, `dollars`, `waitingLine`),
`bench-reply.ts` (`earnedWords`, `BenchView.earned`), `bench-find.ts` (earned and the backing counts),
`builder-json.ts` (`earned`), `stats.ts` (`backing_open`, `backers`, `earned_usd`), `db/schema.sql` (`coin_backers`,
`coin_backer_cursor`, `creator_fees`, `creator_deposits`), `raising.ts` (`pillCoin`, `RaisingCoin.coin`). New test:
`v3-earned.test.ts`.

v3 Stage 2 summary. Programs schema (`program-file.ts`, `programs/README.md`): `status` `upcoming`, `opens_note`,
`in_person`; `pool_usd` is set only when the source states a pool. New files: `ship-log-facts.ts`, `backers.ts`,
`earned.ts`, `builder-json.ts`, `app/api/builders/[handle]/route.ts`. New tests: `v3-programs.test.ts`,
`v3-apply.test.ts`, `v3-backing.test.ts`, `v3-earned.test.ts`. New programs: `alliance-all19`, `ethglobal-mumbai`,
`monad-nitro`, `base-batches-005`; `a16z-speedrun` has its deadline.

v3 Stage 2 final review: `present.ts` (`canApply`: qualifies without the investment rule; `byRelevance` Base > any
chain > rest, grants before investments), `bench-find.ts` (`ViewIn.applies`, `Fit.investment`: the apply step's
candidates include an open investment, never a fit line), `stand-view.ts` (`scoreFits({ investments })`, `earnPrize`
"investment"), `alerts.ts` (`repoCanWin(..., { apply })`), `bench-data.ts` (`fundLines` skips in person), `pool.ts`
(`openMoneyWords` hackathon rule: in person, pool or prize text, never summed; `OpenMoneyRow.in_person`, `reward`),
`stats.ts` (`testProject`: backing_open, backers, earned_usd group-aware). `ethglobal-mumbai` has no `max_award_usd`.

v3 Stage 3 Task 7 (copy pass, the visual check and the docs; see the architecture guide's "v3 Stage 3: the site"): `ChainLogo`
round at every size and `public/images/chains/base.svg` a solid Base-blue circle; `BenchRowItem` phone rank column 3rem;
`landing-cache.ts` guide key `guide-v3`; `ProgramCards` without the dead `bench` prop; `GuideView` facts capitalised and keyed by
position; `brand-page.ts` embeds Funnel Display 500 only; `card-response.tsx` 28px number labels and `/share` without the Earned
read (`benchCardFacts(id, { money: false })`, as `landing.ts readFeatured`); `scripts/og.mts` `OG_HOST`; `badge.ts` not-found value
as muted text on the raised spot; `Button.tsx INLINE_LINK` on the terms and Docs links; the terms' risk headings in sentence case;
`app/leaderboard/page.tsx` description "Ranked by Shipping."; `copy-review.test.ts` Task 7 rule (builder strings and every literal
under `app/`); `v3-landing.test.ts` (i) scans divide/fill/stroke/outline/shadow/via too.

v3.1 P0 Task 1 (F1, the owner's repo gets its fits): `alerts.ts` (`FitGate`, `fitGate(p, r, { apply })`: the first gate
that drops a pair, `repoCanWin` is `fitGate === null`; with `apply` the close and Hard gates are skipped, only new work
drops), `present.ts` (`Fit.repo_odds`; `canApply` also takes a row whose only low reason is "no users yet" on a
good-odds repo; `qualifies` keeps the old rule), `bench-find.ts` (`Fit.card`, `fitCard`, `fitLines`: every apply
candidate, investments included, byRelevance, at most FITS_MAX; lead and recordShown use its grants), `stand-view.ts`
(`scoreFits` returns every apply candidate, byDeadline; no `investments` option), `match-projects.ts`
(`MatchDeps.ownEarnkit`: an EarnKit-org repo proven the builder's own is matched, never skipped as EarnKit's),
`tools.ts` (find's Bench match passes `ownEarnkit` when `own-brand.ts earnkitOwnRepo` holds). New:
`fixtures/earnkit-repo.ts`, `v31-fit-gates.test.ts`.

v3.1 P0 Task 4 (F4, fewer words): `bench-reply.ts benchReply` drops the why sentence, Originality and the points line,
and shows the upcoming line only with no `fits` line; `bench-find.ts benchView` no longer reads `pointsTotal`. New:
`v31-reply-trim.test.ts`.

v3.1 P0 Task 10 (spec 3.4, D1, the agent drafts, never submits): `mcp.ts` (`prepareDescription(buildOn)` draft-only,
`CONFIRM_BACKING_DESCRIPTION`, `confirm` registered only under `raisingEnabled()` with the Backing-only strict schema,
`toolDescriptions().confirm` only under the flag, `TOOL_DESCRIPTIONS` keeps it), `tools.ts` (`CONFIRM_ENTRY_GONE`,
confirm refuses `program_id`, find `fresh: undefined`), `present.ts` (no ideas section; `ideaLines` gone),
`bench-find.ts` (no `idea` FundLine for no_project; `noProjectIdea`/`ideaFitsOffer` gone). New: `v31-mcp-surface.test.ts`.

v3.1 P0 Task 2 (F2): `bench-reply.ts connectAsk` (later Task 16) says where the connected weeks go; `connect-moment.ts` re-exports it.
v3.1 P0 Task 3 (F3, no rank below 10): `rank.ts` (`RANK_MIN_POOL = 10`, `shownRankLine`), `bench-rank.ts`, `stand-text.ts`,
`ship-log-facts.ts`, `page-data.ts`, `bench-data.ts`, `badge.ts`, `builder-json.ts` (keeps the number), `card-response.tsx` and
`BenchProfileView.tsx` (a dash for Rank) read it. New: `fixtures/rank-pool.ts` (`padPool`), `v31-rank-pool.test.ts`.
v3.1 P0 Task 5 (F4, rank only): `weekly-target.ts` names the rank, never the points ("Ship code this week to pass #2.").
v3.1 P0 Task 6 (Best fit leads): `bench-find.ts` (`applyCandidates`, `claimApply`, `openCandidates`, `Fit` exported), `bench-reply.ts`
(`BestFit`, `bestFitLine`, later `moneyLine`; `applyAsk(title, when | null)` for a rolling program). New: `v31-best-fit.test.ts`.
v3.1 P0 Task 7 (Builder Codes for Base): new `builder-codes-check.ts` (`checkBuilderCodes`, `codePaths`, `appProvenRepo`: the
App reads the repo's tree and at most 30 code files, once a day, results in `repo_builder_codes`), `builder-code.ts`
(`builderCodesIn`, `BUILDER_CODES_FIRST`, `builderCodesFound`, `BASE_GRANTS_ID`); `scripts/events-redact.mts` lists the table;
`fixtures/fake-github.ts`. New: `v31-builder-codes.test.ts`.
v3.1 P0 Task 8 (unlisted programs): `programs.status` allows `unlisted` (`db/schema.sql`), `program-file.ts`, `programs.ts`,
`landing.ts`, `leaderboard.ts`, `present.ts`, `also-qualifies.ts` skip it; `submit-kit.ts` and `submission.ts` take
`multi_choice` requirements; `programs/base-builder-grants.json` prefills its primary challenge; Avalanche and ETHGlobal
Mumbai are unlisted; `programs/README.md` documents both. New: `v31-programs.test.ts`.
v3.1 P0 Task 9 (prepare drafts, never submits): new `draft-application.ts` (`draftApplication`, `DRAFT_FIRST_NOTE`, `DRAFT_NOTE`,
`withPageLink`, `BUILDER_CODES_WAIT_MS`), `submit-kit.ts draftKit` (`draftReadyLine`, `PASTE_LEFT`, `OPEN_PREFILLED`, `SENT_ASK`),
`tools.ts` (prepare on a curated program goes to the draft; an unlisted or upcoming program is refused), `programs.ts`.
New: `v31-draft.test.ts`.
v3.1 P0 Task 16 (every reply rewritten): `bench-reply.ts` (see its entry above), `points.ts` (`connectOfferPoints`, `weekPointsNow`, `weekAwarded`, `MAX_WEEK_POINTS`), `bench-reply.ts` (`POINTS_ON_SIGN_IN`,
`POINTS_ON_CONNECT`), `connect-moment.ts` (`pointsAddedLine`, `connectApplyAsk`), `weekly-moment.ts` (`weekNumber`,
`momentPlace`), `bench-find.ts` (`openGrant`, `connectApply`, `takeApplyAsk`). Removed: `BENCH_HEADS`, `NOT_ON_BENCH`,
`NO_MONEY_LINE`, `noFitLine`, `fitsLine`, `ideasLine`, `needsLine`, `shippingStand`, `SHIP_STEP`, `shareAsk`, `CONNECT_HEAD`,
`fundNeeds`, `needsPicks`, `NEEDS_MAX`. New: `v31-reply-copy.test.ts`, `bench-reply.test.ts` rewritten.

v3.1 release 2 Task 12 (Monday email money): new `best-fit.ts` (`bestFitFor`), `digest.ts` (`moneyTexts`, `moneyLines`,
`DigestFacts.money`), `backers.ts` (`newBackers`, `first_seen_at` on insert), `bench-find.ts` (`scoreApplies`, `bestApplies`
extracted from `benchView`), `db/schema.sql` (the `coin_backers.first_seen_at` append), `scripts/db-check.mts` (its checks).
New: `v31-monday-email.test.ts`; `digest.test.ts` and `v3-monday-email.test.ts` follow `money: []`.
v3.1 release 2 Task 14 (copy sweep): `copy-review.test.ts` (`v31Texts`, per-label `allowed` map). Site UX batch: `site-copy.ts`
(`NOT_FOUND_TITLE`, `NOT_FOUND_METADATA`; `not-found.tsx` exports it as `metadata`) used by `generateMetadata` in `p/[id]`, `b/[slug]`,
`campaigns/[slug]`, `programs/[id]` and `[handle]` (via `handleMetadata`, which also serves `/b/<reserved>`);
`landing/Opportunities.tsx` lazy logos; `FadeRail.tsx`, `DocsNav.tsx` (see the site entries below).

v3.1 site (Tasks 1 to 11, commits a9b72676 to d4a8757d; every file under `apps/frontend/`):

New, tokens and data:
- `lib/earnkit/site-theme.ts`: `SITE` colours (mirrored `--ek-s-*`, Tailwind `s-*`), `siteVar`.
- `lib/earnkit/site-copy.ts`: every page string, `scoreBand`, `standingTier`, `compactUsd`, `monthDay`, `agoWords`, `heroChipText` ("$5K in Base grants open now", over `landing.ts openToBase` programs only), `programKind`, `logoColor`.
- `lib/earnkit/site-data.ts`: `profileSite` and its parts (`lastShippedAt`, `thisWeekCommits`, `highlights`, `standingPill`, `backerWeeks`, `tokenAllowed`), `feedWeekStats`.
- `lib/earnkit/site-streak.ts`: `withThisWeek`, the page's one streak (grid and count).
- `app/fonts/kaftan-serif.woff2`: Kaftan Serif (moved from `public/fonts`).
- `public/art/{hero-eckersberg,foot-panini}-{...}.jpg`: the pre-sized paintings (hero 800/1600/3200, footer 700/1400/2800).

New, primitives (`app/components/site/`):
- `ui.ts` card, pill, column, title and metal class strings; `Serif.tsx` Kaftan wrapper; `Money.tsx` currency signs in Funnel Sans.
- `ScoreText.tsx` score in its band colour; `XHandle.tsx` X glyph and handle; `Pager.tsx`; `SegTabs.tsx` pill rail;
  `FadeRail.tsx` the overflow edge fade for sideways link rails (SegTabs: feed weeks, leaderboard filters); the agent tabs wrap instead.
- `NavLinks.tsx` active-link nav; `FooterLight.tsx` pointer light; `AgentMarks.tsx` the four hero marks.
- `useReducedMotion.ts` (with `useMediaQuery`).

New, landing (`app/components/landing/`): `Hero.tsx`, `HeroArt.tsx` (painting, arch light, drift), `Steps.tsx`, `Activity.tsx`, `Opportunities.tsx`.
New, profile (`app/[handle]/site/`): `HeroCard.tsx`, `ScoreCard.tsx`, `StreakCard.tsx`, `ActivityCard.tsx`, `TokenCard.tsx`, `HighlightsCard.tsx`.
New, lists: `app/leaderboard/Podium.tsx`; `app/feed/FeedStats.tsx`, `app/feed/FeedRow.tsx`.
New, tests (`lib/earnkit/`): `v31-site-tokens`, `v31-site-copy`, `v31-site-data`, `v31-site-lists`, `v31-site-chrome`, `v31-site-landing`, `v31-site-profile`, `v31-site-leaderboard`, `v31-site-feed`, `v31-site-docs`, `v31-site-sweep` (`.test.ts`).

Rewritten in place (same path): `app/HomeView.tsx`, `app/[handle]/{BenchProfileView,handle-view,ScoreRing,Avatar,ShareButton}.tsx`, `app/leaderboard/{BenchView,BenchRowItem,page}`,
`app/feed/{FeedView,page}`, `app/docs/*`, `app/not-found.tsx`, `app/components/common/{Header,Footer,Button,InstallButton}.tsx`, `app/components/sections/AddToAgent.tsx`,
`app/programs/page.tsx` (a permanent redirect to `/#earn`), `app/programs/[id]/GuideView.tsx` and `app/terms/*` (column and Kaftan titles only), `app/layout.tsx`, `app/globals.css`, `tailwind.config.ts`,
`lib/earnkit/{landing,feed,bench-data,page-data,week-facts,docs-copy,footer-links,brand-page}.ts`, `app/lib/landing-cache.ts` (key `landing-v31-*`), `scripts/og.mts`.

Deleted: `app/[handle]/MoneyTab.tsx`, `app/[handle]/ProjectTab.tsx`, `app/components/sections/{BackedBy,BenchTop,FeaturedCard,FeedRows,Hero,ProgramRow}.tsx`,
`app/leaderboard/FilterChip.tsx`, `public/art/eckersberg-colosseum-arches.jpg`, `public/art/panini-pantheon-dome.jpg`.
`app/components/sections/ProgramCards.tsx` stays as a shim because `copy-review.test.ts` imports it.

Docs: `apps/frontend/DESIGN.md` rewritten for the v3.1 system (pinned by `v3-tokens.test.ts` T1.8).

v3.1 site clarity batch (branch `v3.1-site-clarity`, 2026-10-22; every file under `apps/frontend/`):
- `Footer.tsx` CompanyLine centred (full and minimal).
- Hero: `HeroArt.tsx` painting at brightness 0.95; `Hero.tsx` SHADE is an ellipse behind the words plus a low band
  (`SITE.heroHalo`, `heroHaloMid`, `heroBand`; `heroShade`, `heroShadeDeep`, `heroShadeEnd` removed); `HERO_TITLE`
  "Get funded for shipping." at `clamp(28px,9.6vw,96px)`, one line down to 320px; `layout.tsx` TITLE follows;
  `public/art/*` re-exported (byte budgets in `v31-site-tokens.test.ts` raised).
- `site-copy.ts`: STEPS (Connect, Ship, Get funded; backing line), `SCORE_UNIT`, `streakRun`, `BENCH_VERIFIED`,
  `SCORE_SOURCE`, `SCORE_HOW`, `SCORE_HOW_HREF` (/docs#score), `ROLLING`. `Steps.tsx` icon box + fixed title gap.
- `ScoreText.tsx` `unit` prop (a quiet "Shipping" caption) used by `landing/Activity.tsx`, `feed/FeedRow.tsx`,
  `leaderboard/BenchRowItem.tsx`; `BenchRowItem` and `Podium` use `streakRun`; `BenchView.countLine` appends
  BENCH_VERIFIED; `[handle]/site/ScoreCard.tsx` adds SCORE_SOURCE and the "How it's scored" INLINE_LINK.
- `page-data.ts avatarUrl(raw, githubLogin?)` (X, then GitHub, then null); `feed.ts`, `bench-data.ts` (benchRows,
  profileData) read `github_login`. `benchCardFacts`/`personFacts` (the share card) stay X-only.
- Few builders (solo launch: one builder, `jenilt`): `site/InviteRow.tsx`; `BenchView` (no podium, no rail, BENCH_EARLY,
  invite under RANK_MIN_POOL; `emptyLine`), `FeedView` (FEED_FEW), `landing/Activity.tsx` (wide invite), `landing.ts
  oneEach`; copy `BENCH_EARLY`, `BENCH_INVITE`, `BENCH_EMPTY_BASE`, `BENCH_EMPTY_BACKED` in `site-copy.ts`.
- `landing.ts Tile.organizer` and `when` ROLLING; `landing/Opportunities.tsx` shows the organizer's name on the white
  tile when there is no logo file (no monogram). `fixtures/banned-words.ts` allows the owner's new phrases.

v3.1 Highlights redesign (2026-10-22): `site-data.ts` (highlights in the new order, `uptimeOf`, `repoItem`, link
builders, `Highlight.href`), `app/[handle]/site/HighlightsCard.tsx` (links, `repo` icon), `builder-codes-check.ts`
(`path` stored, `storedBuilderCode`, `builderCodesDue`, `runBuilderCodes`), `cron.ts` (`builder_codes` step, deps
`builderCodes`), `page-data.ts` (`projectProgramsDated` carries `guide`), `sources.ts claimContract`
(`deployed_at`), `person-github.ts` (`default_branch`, `commits_year`), `source-readers.ts RepoSignals`; schema
appends `repo_builder_codes.path` and `builder_sources.deployed_at` (`db-check.mts`, `schema-rerun.test.ts`). New:
`v31-highlights.test.ts`; `v31-site-data.test.ts (c)-(c4)`, `v31-builder-codes.test.ts (i)-(j)`.
Highlights fix round 1: `guide-pages.ts` (`GUIDE_ID`, `guideProgramSql`: one guide predicate for `landing.ts
readGuideIds` and `page-data.ts` links), `contract-origins.ts` (`backfillContractOrigins`), `builder-codes-check.ts`
(`claimAttempt`, attempts stored in `repo_builder_codes_attempts`; the in-memory backoff is gone), `cron.ts` (both steps
after the email, `builderCodesSliceEnd`), `site-data.ts` (`liveSub`, newest ok reading up (a failed read never hides a live site), date only when all dated),
`HighlightsCard.tsx` (guide links in the same tab with a chevron), `streak.ts` (updates grouped once),
`bench-find.ts` (no streak read: no weeks, never the cache). Schema: `repo_builder_codes_attempts`,
`builder_sources.origin_read_at`.

v3.1 owner batch (2026-10-23): `site-copy.ts STEPS` (shorter step copy, backing line "Fans can back you with your
coin."); `week-facts.ts weekTitles` (a private repo with titles off is read for its AI summary only with a model,
`summarize` or ANTHROPIC_API_KEY; its titles are not stored; `writeWeek` passes `d.summarize`), `week-summary.ts`
(`privateRepo`, `approved`, `namesPath`), `feed.ts feedRows` and `bench-data.ts profileData` (rule `approved` from
facts.approved), `weekly-moment.ts weekLineRule` (`asking` for the builder's own approval prompts: `lastWeekOf`,
`connect-moment.ts connectWeeks`; `u.approved` for posts: `post-moments.ts weeklyCandidate`, `newsCandidate`);
`confirmed.ts isConfirmedSource` (`person-score.ts confirmedSrc`, `updates.ts ownLinks`); `site-data.ts mainReading`
(commits_year from the newest reading that has it). Tests: `week-summary.test.ts` W5b/W6b, `v214-ship-log.test.ts`
8.10b/8.10c, `week-facts.test.ts` 4.11b, `person-score.test.ts` 4.0, `updates.test.ts` 5.7d, `v31-site-data.test.ts`
(c5), `v31-site-copy.test.ts` (i), `v31-site-landing.test.ts` (f).
Owner batch fix round (2026-10-23): `week-summary.ts summaryConsented` (facts.approved_summary), `weekly-moment.ts`
(`weekRules` { line, current }, `approveWeek(..., seen)`, `LastWeek.summary`, `ShareOpen.summary`),
`connect-moment.ts` (`ConnectWeek.summary`, `ConnectOpen.seen`), `week-links.ts` (`SEEN_FIELD`, `summaryHash`,
`weekPage`, `WEEK_TEXT.changed`), `sources.ts recheckSite` (`SITE_PROOF_MISSES_MAX`, `SITE_PROOF_LOST`), schema
`builder_sources.proof_misses`, `proof_checked_day`; `confirmed.ts SITE_PROOFS` is earnkit_txt only. Tests:
`week-summary.test.ts` W6c, `v214-ship-log.test.ts` 8.10b/8.10d/8.10e, `v3-monday-email.test.ts` (d2),
`site-proof.test.ts` SP5/SP11-SP13, `person-score.test.ts` 4.0, `week-facts.test.ts` 4.11b.
Owner batch fix wave (2026-10-23): `outcome-proof.ts` (new: `ProofFetch`, `defaultProofFetch`, `mentionsBuilder`,
`proofNamesBuilder`, `X_HOSTS`); `post-moments.ts proofEntryMatches`, `verifiedOutcomeCandidate(..., { proofFetch })`;
`post-reply.ts outcomePost` and `tools.ts ToolContext.proofFetch`; `program-file.ts proof_hosts` "host/path/" form;
`bench-find.ts momentSummary` and `MomentView.summary` (bench-reply.ts); `weekly-moment.ts markOffered`,
`LastWeek.stored`; `sources.ts` (`recheckSite(s, up, d, day)`, `SITE_PROOF_EXEMPT_MAX`, revoke to proposed, lost sites
read; `proveLinkedSite` removed); schema `builder_sources.proof_exempt_days`. Tests: `post-moments.test.ts` (proof),
`v31-post-replies.test.ts` (fixture proof sources), `program-file.test.ts`, `site-proof.test.ts` SP11/SP14/SP15,
`week-facts.test.ts` 4.11c, `weekly-moment.test.ts` (fix wave), `v3-connect.test.ts` (b2), `week-summary.test.ts` W6d.
Owner batch last fix wave (2026-10-23): `outcome-proof.ts` (`ProofWho`, `namesBuilder`: verified @handle or x.com link,
site host, public repo URL; no project name); `post-moments.ts proofUrlOk` (path hygiene, query and fragment dropped);
`sources.ts` (`SITE_PROOF_LOST_READ_DAYS`, `proof_lost_at`, `proposeSource` re-propose of a lost site, exempt count kept
past the cap); `person-score.ts` (lost sites skipped); `week-summary.ts` (`BARE_FILE`, more extensions); schema
`builder_sources.proof_lost_at`; base-builder-grants proof_hosts `["www.base.org/blog/"]`. Tests: `post-moments.test.ts`,
`v31-post-replies.test.ts`, `site-proof.test.ts` SP15/SP15b/SP16, `week-facts.test.ts` 4.11d, `week-summary.test.ts` W6d.
v3.1 owner people view (2026-10-23): `people-signals.ts` (new: `peopleSignals`, `githubAgesStep`, `walletSignalsStep`,
`walletSignalsFrom`, caps `GH_AGES_PER_RUN`, `WALLET_SIGNALS_PER_RUN`), wired in `cron.ts` (`people_signals`);
`x-oauth.ts` (`XUser.createdAt`, `followers`), `x-install.ts bindXIn`, `x-link.ts` (carry them); schema
`builder_profiles.x_created_at/x_followers/x_checked_at`, `x_signin_links.x_created_at/x_followers`,
`person_wallets.first_tx_at/funder/signals_checked_at`, view `owner_people`; `events-redact.mts` lists `person_wallets.funder`. Tests: `people-signals.test.ts`, `x-oauth.test.ts`, `events-redact.test.ts` (base tables only).

v3.1 owner tracker (2026-10-23): `owner_people` gains appended columns for jenil.ai /people (project name, repo + private, site, public score/rank, streak and 12-week commit weeks, last activity, avatar, coin + backers + creator fees ETH, programs applied/accepted/won, check-in and email opt-in). Test: `owner-tracker.test.ts`; `people-signals.test.ts` and `referral.test.ts` follow the new column order.
v3.1 answerable replies (2026-10-23, design v3.1-answerable-replies.md): new `reply-facts.ts`; `tools.ts` (`withFacts` on
find and score, `CHECKIN_INSTEAD_NOTE`, a weekly_email yes without an address asks `WHICH_EMAIL`); `stand-text.ts
ANSWER_FIRST_NOTE` (answer from show_to_builder and facts); `bench-find.ts` (`coinLinkLine`: the token ask with a live coin
leads "$SYM is live: <tokens.fun>"; `standing_seen.pitch_day`: the connect step's full pitch once a UTC day, else
`bench-reply.ts pickRepoAgain`; kept by `stand-view.ts takeNews`); `bench-reply.ts` (`backingLine(..., symbol)` "Your coin
$SYM is live.", exported `isStep2`); `digest.ts` (`EMAIL_ON`, `WHICH_EMAIL`), `weekly-moment.ts APPROVED_LINE`;
`entry-text.ts` (`AMOUNT_HEADER` "Up to", `upToCell`) in `present.ts` and `also-qualifies.ts` tables; `guide.ts guideText`
(never "(estimate)"); `mcp.ts FIND_DESCRIPTION_BENCH` (more: true for what can I earn / what fits me / show programs).
Tests: `v31-answerable.test.ts`.

v3.1 Highlights competence (2026-10-25, design v3.1-highlights-competence.md): new `wallet-chains.ts` (`WALLET_CHAINS`:
base, ethereum, arbitrum, optimism, polygon with Alchemy network, explorer, label; `WalletContract`, `walletChain`);
`alchemy.ts` (`alchemyCall(deadline, network)` Base by default, `AlchemyNetworkOff` for "not enabled for this app",
`contractCounts` (not a token, used by another address), `alchemyWalletContracts`); `source-readers.ts`
(`ReaderDeps.walletContracts`, Alchemy only, ticks `alchemy`); `read-usage.ts` (provider `alchemy`); `discovery.ts`
(`walletContractsOf`: upserts `wallet_contracts`, feeds the T7 Base claims from the same read); schema `wallet_contracts`
(+ index on wallet); `events-redact.mts` lists `wallet_contracts.wallet`. `site-data.ts` Highlights rebuilt (no Builder
Code, wallet, commit count or "Applied to" rows; `contractsOf`, `productsOf`, `consistencyItem`, `explorerHref`,
`HIGHLIGHTS_MAX`, `PRODUCTS_MIN`; `repoItem`, `basescanHref`, `githubFileHref` removed); `HighlightsCard.tsx` icons
`products` (layers), `consistency` (calendar-check), `experience` (terminal); `card-facts.ts` reads "Building since"
from the consistency sub and drops the commits tile (`card-response.tsx`). Tests: `alchemy.test.ts`, `discovery.test.ts`
7.4c, `v31-highlights.test.ts`, `v31-site-data.test.ts (c)-(c5)`, `v31-wallet-proof.test.ts`, `v3-shells.test.ts`,
`v31-site-profile.test.ts`, `gtm-w2-replies.test.ts`, `v3-apply.test.ts`.

v3.1 Used by (2026-10-27, design v3.1-used-by.md): new `used-by.ts` (`contractsUsage`, `usageSql`, `codesUsage`,
`verifyCodes`, `payoutOf`, `ownedCodes`, `tellBuilderCode`, `BUILDER_CODES_REGISTRY`, `contractsDue`, `runUsedBy`, `USED_CONTRACTS`, `USED_PAGES`, `USED_PER_RUN`, `CDP_SQL_URL`, `cdpOn`);
`alchemy.ts` (`isToken` split out of `contractCounts`, `contractSends`, `fundedBy`, `logNetworkOff`, `AlchemyReverted`);
`mcp.ts` + `tools.ts` (tell `builder_code`, `BUILDER_CODE_SAVED`/`BUILDER_CODE_INVALID`; TELL_DESCRIPTION_BENCH shortened
to fit); schema `builder_code_claims`; `events-redact.mts` lists `builder_code_claims.payout`; `wallet-chains.ts`
(`explorerHref` moved here); `builder-code.ts` (`BUILDER_CODE`, `codesFromText`); `builder-codes-check.ts` (stores
`codes`, reads on to the file naming the code); `cron.ts` (`CronDeps.usedBy`, `used_by`); `site-data.ts` (`usedByOf`,
`USED_MIN`, `USED_STALE_DAYS`, `UsageRow`, `githubFileHref` back, `users` icon type); `HighlightsCard.tsx` (`users`
icon); schema `repo_builder_codes.codes`, `app_usage`; `test-guard.ts` clears `CDP_CLIENT_API_KEY`; `db-check.mts`.
Tests: `v31-used-by.test.ts`, `v31-builder-codes.test.ts (c6)`, `v31-site-data.test.ts (c3b)`, `v31-highlights.test.ts`,
`schema-rerun.test.ts`.


No Blockscout (owner ruling, 2026-10-27): `alchemy.ts` `alchemyCreationOf` (a contract's creating transaction and its
sender: archive `eth_getCode` binary search, the block's receipts, else `trace_block`; null without code) feeds
`source-readers.ts` `contractOrigin` and `ownership.ts` `alchemyDeployer`; `alchemyTxCount` (capped at `verify.ts`
`TX_COUNT_CAP` = 100, seam `CheckDeps.txCounter`) replaces the Blockscout counters; wallet reads and people signals are
Alchemy only. Still on Blockscout, dormant: `campaigns.ts` sponsor scoring and `traction.ts` coin holders.

v4.3 (first answer): `bench-reply.ts` qualifyHead/qualifyGap/alsoLine/qualifyAsk/qualifyCodesYes (qualify reply = head, gap, Also open,
one question; hosted asks for steps); `BenchView.fullTable` + `present.ts fullProgramTable` (ranked `find {more: true}` through the
Bench reply, no table on nudge or step 3, never setup-done; the old present.ts path drops "doesn't fit" above a table and updates for
shown programs); `bench-find.ts` `alsoOpen`, `standingFields` (find fields: `streak`, `standing`, `rank_lines` only when non-empty, no
`points_total`); `reply-facts.ts` no points facts; `stand-text.ts` `ANSWER_FIRST_NOTE` (no points or rank list, points answer).
Tests: `v43-first-answer.test.ts`.

v4.5 verified traction (2026-10-29): `discovery-clues.ts ignitionClues` (Task 1, Hardhat Ignition deployed_addresses +
journal sender); `revenue.ts` (Task 2: `contractsRevenue`, `runRevenue` the cron's daily step, `latestRevenue`, per-contract
pass-through `passesThrough`; `app_revenue` in schema.sql; private, never public; v4.4 `existing` token claims are never
a source); `site-data.ts usageRows`/`bestUsage` (Used by's read and pick, shared); `ship-log-facts.ts tractionFacts`,
`REVENUE_MIN`, the usage, came-back and revenue lines in `shipLogBlock`; `reply-facts.ts` `used_by_30d`,
`revenue_30d_usd`. Tests: `v45-traction.test.ts`.

v4.6 Task 1 (verified Stripe revenue, key store): `secret-box.ts` (`seal`/`open`, AES-256-GCM keyed from EARNKIT_AUTH_SECRET per
purpose); `stripe.ts` (`StripeCall`, `keyKind`, `checkKey` with the ownership rule and the v4.7.1 write-access probes, `connectStripe`, `disconnectStripe`,
`stripeKey`, `stripeLink`, `stripePageState`, `stripePost`; `stripe_connections` in schema.sql, private); `app/connect/stripe/` (page, StripeForm, `key/route.ts` POST)
(page, StripeForm, POST at key/route.ts); `wallet-proof.ts upgradeToken/upgradeOf` take a `purpose` ('upgrade' wallet, 'stripe');
`rate-limit.ts` `stripePage`/`stripeConnect`. Tests: `v46-stripe.test.ts`.
v4.7.3 Task 1: `secret-box.ts` keys the 'stripe' purpose from EARNKIT_STRIPE_SECRET (no fallback; `boxReady`); `stripe.ts`
`STRIPE_TEXT.off`/`used`, `stripeUseKey` (one-use mark in `wallet_proof_uses`, written in the store transaction); StripeForm is a
password field. Tests: `v473-stripe.test.ts`.

v4.6 Task 2 (daily Stripe read): `stripe.ts` adds `stripeRevenue` (30-day net from balance transactions, MRR, payers/top share from charges),
`runStripeRevenue` (once per UTC day, `stripeDue`, 401/403 marks `broken`), `latestStripe`, `STRIPE_PAGES`; `fx.ts` `usdRate` (Frankfurter, cached in
`fx_rates`); `stripe_revenue` and `fx_rates` in schema.sql (private); `cron.ts` runs the step after `runRevenue` (`deps.stripe`, result key `stripe`).


v4.6 Task 3 (drafts, replies, the ask): `ship-log-facts.ts` (`stripe` in `ShipLogFacts`/`tractionFacts`, the Stripe line in `shipLogBlock`), `reply-facts.ts`
(`stripe_30d_usd`, `stripe_mrr_usd`), `stripe.ts` (`stripeAskDue`, `STRIPE_DECLINED_KEY`), `bench-reply.ts` (`stripeAsk`, copy, `stateAsk` kind `stripe`),
`bench-find.ts` (claims the ask, its yes), `tools.ts`/`mcp.ts` (`tell { stripe }`, `stripeReply`); tests in `v46-stripe.test.ts`.

v4.7 Task 3 (the first reply is money only): `bench-find.ts` (`again`/`applyPickOf`: an open unapplied fit is asked again,
the quieter asks wait; `apply_yes`; no Stripe in the reply order; `markTokenYes` sets `token_yes`), `bench-reply.ts` (apply
reply is the money alone; `stripeDraftLine`, `stripeDraftNote`; `stripeAsk`/`STRIPE_ASK_NOTE` removed), `stripe.ts`
(`takeStripeDraftLink`), `tools.ts draftWithSteps` (the draft's Stripe note), `program-file.ts`/`programs.ts`
(`wants_revenue`, column in schema.sql), `wallet-offer.ts tokenOfferDue` (applicationCounts gate, `asked`),
`wallet-proof.ts` (no launch), `builder-token.ts retryDroppedBuilderTokens` (`token_yes`), `llms/v213.txt`,
`fixtures/wallet-step.ts moneyStepDone`. Tests: `v47-money-first.test.ts`.

v4.7 (reach out, 2026-10-30), all five tasks: T1 `deadline.ts` (`closeDay`, program `tz`; site tiles and replies share
one close day); T2 `standing.ts` (the `standing` fact and paragraph in find and score); T3 `bench-find.ts` money first
(`again`, `apply_yes`, the Stripe line moved to drafts, `tokenOfferDue` after the first application, proofs launch
nothing); T4 `bench-reply.ts` why lines (`askWhy`, `move_up.why`, `ASKS_HINT`); T5 `alert-mail.ts` (alert emails,
`alert_mail_sent`), `digest.ts` (new ask, reply_to, standing on top), `best-fit.ts` (`openFitsFor`, `standingFor`),
`cron.ts` (`alert_mail` step), `mcp.ts` (session-start instruction; ruling R1 dropped the move_up and score lines),
`llms/v213.txt`. Tests: `v47-numbers`, `v47-standing`, `v47-money-first`, `v47-why` (T4's), `v47-reach-out`.

v4.7.1 Task 1 (money always shows): `bench-find.ts` `openNowGrants` (up to two open grants, soonest deadline first,
rolling last) sets `view.openNow` in a ranked reply with no unapplied fit; the ranked `check_fits` ask (once,
`standing_seen.check_fits_asked` via `takeOnce`; after a still-due qualify, ahead of checkin/wallet/token/new_repo/titles/
ship; never names Base's grant; its yes `checkNeedsNote`). `bench-reply.ts` `openNowLine`, `checkFitsWhy`, `checkNeedsAsk`,
`shortTitle`; rankedBody leads every non-money ask and the quiet reply with the open grants (a fit's reply unchanged);
`standingText` (standing.ts `standingParagraph`) replaces `standingLine` in replies (the line stays the change key);
`askWhy` is null for `none`. Fixture `fixtures/wallet-step.ts checkFitsAsked`. Tests: `v471-money.test.ts`.
v4.7.2 Task 2: `bench-find.ts` `programNeeds` (pure), `needsKnown`, `needsAskable`, `needsOf` (reads `getProgramRow`),
`countNeedsShown`/`resetNeedsShown`/`needsStandAside`, `declineKeyOf` ('needs:<id>' for the ranked check_fits no);
`base-qualify.ts` `onChainKnown` (`onBaseKnown` wraps it); `bench-reply.ts` `needsWhy`, `needsAsk`, `NeedsAsk`,
`BenchView.checkFits` `{ id, title, needs }`, `quietHint` (ASKS_HINT ends the quiet reply); `checkFitsWhy`/`checkNeedsAsk`
removed. Fixture `checkFitsAsked` now declines the needs ask for every program. Tests: `v472-next-step.test.ts`.
Final review: `needsYesNote` replaces `checkNeedsNote`; `openMoneyNow` (the /api/stats total); `needsKnown(id, key, also)`
(one chains read, public repo only); `needsOf` uses Card `needs_contract`/`needs_live` (present.ts Card, programs.ts
programCard), else `getProgramRow` in parallel; `standing_seen.needs_silent`.

## v4.10 Task 2: ready set

`ready-set.ts` `readySet`, `worthUpTo`, `READY_MAX`, `ReadyProgram` (uses `conversation.ts` `INVESTOR_WINDOW_MS`,
`NOW_WINDOW_MS`, `MoveProgram.max_usd`/`why`; `pool.ts` `usdCompact`); `bench-find.ts` `moveProgram` sets `max_usd`,
`pathPlan` sets a long-shot grant's `why`. Tests: `v410-ready.test.ts`.
- **`ready-copy.ts`** (v4.10 Task 3): `READY_ASK`, `shortName`, `readyLine`, `readyOpener`, `readyYesReply`, `skipReply`.
  Uses `conversation.ts` `programName`/`closeWords`, `bench-reply.ts` `BUILDER_CODES_GUIDE`. `fixtures/converse.ts` imports
  `READY_ASK` (easyReply) and `lazyNext` takes `skip?`. Tests: `v410-ready.test.ts`.
- **v4.10 Task 4**: `bench-find.ts` `readyView` (in `benchView`), `readyCommit`, `readyAgainCommit`,
  `readyWaitingCommit`, `readyAnswer`/`readyYes`/`readyPark` (from `benchMoveUp`), exported `readySent`, `readyTracked`
  (tools.ts tell), `READY_SET` (test switch), `READY_CODES_NOT_YET`, `ReadyState` in `standing_seen.ready`, `bench_ask`
  ids/codes/sent/need, `PathPlan.longShots`, `bankKeyOf`. `conversation.ts` `builderOnly`. `ready-copy.ts` adds
  `READY_NOTE`, `READY_ASK_NOTE`, `READY_YES_NOTE`, `READY_SENT_NOTE`, `READY_NEEDS_NOTE`, `READY_AGAIN_ASK`,
  `readyAgain`, `needsPhrase`, `readyOpenList`, `readySentAsk`, `readySentAgain`, `readyNeedsAsk`, `readyNoLine`,
  `readyTrackLead`. `bench-reply.ts` `BenchAskKind` 'ready'. tools.ts/mcp.ts `move_up` answer 'skip', `skip`,
  `sent_ids`. Tests: `v410-find.test.ts`, `v410-ready.test.ts`. Fix 1: `FOUNDER_REQS`, `program-file.ts` FIELD_KINDS 'raised' (coach.ts
  `DEFAULT_GUIDANCE.raised`), `readyNeedsAsk(title, needs, count)`.
- **v4.10 Task 5**: `scripts/converse-replay.mts` `walkR` (`WALK=R`, `VARIANT=skip`); `fixtures/converse.ts` gateFailures
  (ready ask paragraph repeats); `bench-find.ts` `readyWaitingCommit` (proof line, no repeated list), `readyYes`.
- **v4.10 final fix**:
  - `bench-find.ts`: `READY_NEED_MAX`, `readyNeeds` (exported), `NeedItem`, `ReadyNeed` (the set's one ask),
    `ReadyState.given`, `ReadyDraft.only`/`ends_at`, `askKey`, `answerKind`, `needAsk`, `needFields`, `readyBank`,
    `readySettle`, `needStored`, `codesStored`, `openRows`, the exported type `ReadyAnswers`. `pathPlan` adds chain
    mismatches to `longShots`. `readyYes` returns null on a state conflict, and `readyAnswer` retries once.
  - `ready-copy.ts`: `needsList`, `readyNeedsAsk(titles, needs, count)` (plural-safe), `readyNeedsLater` (removed in v4.10.2),
    `readyStillNeeds`; `readyYesReply` takes `codes`; `readyOpener` says "Every other answer" when needed.
  - `program-file.ts` `READY_ANSWERS` (tools.ts and mcp.ts `move_up.answers`; `skip` up to 10).
  - `fixtures/test-guard.ts` sets `EARNKIT_TEST_GUARD`. `fixtures/converse.ts` `BLANKS_REPLY` (finish them) and
    `lazyNext` `answers`. `scripts/converse-replay.mts` `ANSWERS`.
  - Tests: `v410-find.test.ts` (I1 to I5, M3, M7, M8 hosted, the I2 cross-check) and `v410-ready.test.ts` (the pure
    pieces). `v481-fixes.test.ts` `soonestIsTheCopy` date-proofs F6 and R-4.

## v4.10.1 Task 1: honest needs

- `conversation.ts` `mustGive`, `builderOnly`. `programs/circle-developer-grants.json` `integrations`.
- `bench-find.ts` `readyDrafts` (contact first), `askKey(r, only)`, `draftAsks`, `itemPhrase`, `readyNeeds` (first
  program's rest in `later`; gone in v4.10.2), `needFields` (contact `slots`), `readyBank` (per-slot contact, keyed `other:`),
  `heldAnswers` (email, revenue, contract address), `readyCommit` (`rest`).
- `ready-copy.ts` `contactPhrase`, `needsPhrase` (wh- and "the" todos as written), `readyOpener({ rest })` (v4.10.2: `{ asks, also }`).
- `program-file.ts` `READY_ANSWERS` and `ReadyAnswers`. `coach.ts` `slotOf` (exported).
- `fixtures/converse.ts` `lazyNext` (contact slots); `scripts/converse-replay.mts` `ANSWERS`.
- Tests: `v410-find.test.ts` (`v4.10.1 (1)`, `(2)`), `v410-ready.test.ts` (pure).

## v4.10.1 Task 2: money and the repeat reply

- `ready-set.ts` `worthUpTo` (long shots out), `longShotWorth`. `ready-copy.ts` `worthClause` (used by `readyOpener`),
  `AgainProgram`, `readyAgain(set, now, hosted)`, `readySentAgain(set, now)`.
- `bench-find.ts` `againRows`; `readyAgainCommit` (re-drafts the needs; null when all closed; `readyView` falls through);
  `readyWaitingCommit`'s sent fallback.
- Tests: `v410-ready.test.ts` (`v4.10.1 Task 2` pure), `v410-find.test.ts` (`v4.10.1 Task 2 (5)`, test 1's repeat).
- Fix round 1: `readyOpener` verb ("drafted" with needs); `readyView` drops the ready ask when all closed;
  `fixtures/converse.ts` `READY_STATUS` (gate repeat exemption).

## v4.10.1 Task 3: one score per session

- `stand-view.ts` `startRefresh` (`within` returns `Promise<boolean>`; joins a running refresh via `RUNNING`).
- `bench-find.ts` `UPDATING_LINE`, `UPDATING_SAID`, `UPDATING_NOTE`, `hasNumbers`, `withoutNumbers`, `updatingReply`;
  `ViewIn.updating`, `BenchFindArgs.updating`; `readyRecord(id, now, updating)`; `directAnswer` (no standing answer
  while updating); the weekly moment skipped while updating.
- `bench-reply.ts` `BenchView.updating`; `shipWhy(null)` / `shipWhyOf(target, null)`: "Shipping this week lifts your score."
- `tools.ts` find passes `updating`; `withFacts` drops rank and streak facts on `numbers_updating`.
- `fixtures/converse.ts` `noRecord` (the `updating` part).
- Tests: `v4101-score.test.ts` (pinned Monday clock, gated fake reader).

## v4.10.1 Task 4: programs API link check

- `submit-hosts.ts` `linkChecksOut`, `sameSite`, `registrableDomain`, `LINK_PLATFORMS`, `API_SHARED_SITES`, `MULTI_SUFFIXES`,
  `submissionChecksOut` (pure).
- `program-pending.ts` `linkAnchors` (owner-curated only), `pendingReason`, `approveToken` / `approveTarget` / `approveExpiry`,
  `mailPending`; `program-approve.ts` `programApproveGet`, `programApprovePost`, `approveWrite`.
- `programs-api.ts` `applyUpsert` (pending write, approve mode, `official_url` split off), `api-program-text.ts` `API_CHECK_FIELDS`,
  `officialUrlProblem`; `programs-read.ts` and `app/api/programs/writes/route.ts` add `pending`;
  `app/api/programs/approve/route.ts` (GET confirm page, POST approve).
- Tests: `v4101-link-check.test.ts`, `v49-programs-api.test.ts`.

## v4.10.2 Tasks 1 to 3: fits one reply, eligibility, agent deadlines

- **Task 1**: `ready-set.ts` `READY_ANSWERS_MAX`, `READY_CANDIDATES`, `fitReadySet`, `readySet(ctx, max)`. `bench-find.ts`
  `answerKeys`, `answersIn`, `readyCommit` (fit, `also`), `readyNeeds` (caps on answers; `ReadyNeed.later` gone),
  `heldBuilderCode`, `preparedHeld`, `openEntry` (`prefilled`, `expand`). `ready-copy.ts` `readyAlsoLine`,
  `readyOpener({ asks, also })`, `needsPhrase` (Builder Code, GTM one line); `readyNeedsLater` removed. `conversation.ts`
  `isGtm` exported, GTM out of the `mustGive` exemption. `draft-application.ts` fills blanks from `preparedHeld`.
  Tests: `v410-find.test.ts`, `v410-ready.test.ts`.
- **Task 2**: `program-file.ts` `chain_required`; `programs/circle-developer-grants.json`; `programs/README.md`;
  `db/schema.sql`, `programs.ts` (upsert, list, `programCard`), `present.ts` `Card.chain_required`. `bench-find.ts`
  `notEligible`, `GapGrant.notEligible`; `conversation.ts` `MoveProgram.notEligible`; `ready-copy.ts`
  `readyNotEligibleLine`. arbitrum: `chains.ts`, `match.ts` SIGNALS, `verify.ts` `ARBITRUM_RPC_URL`,
  `programs/arbitrum-open-house-sao-paulo.json`. Tests: `v4102-eligible.test.ts`, `v410-find.test.ts`.
- **Task 3**: `deadline.ts` `timeLeftWords`; `entry-text.ts` `agentCloses`; `tools.ts`/`mcp.ts`/`app/api/programs` closes_in;
  `reply-facts.ts` `shippedLastWeek`. Tests: `v482-fixes.test.ts`, `v31-answerable.test.ts`.

## v4.10.2 Task 4: daily revert digest

- `program-revert.ts` `revertDigest` (cron.ts step `revert_digest`), `changeLine`, `revertToken` / `revertTarget`,
  `revertWrite`, `revertPreview`; `program-revert-page.ts` and `app/api/programs/revert/route.ts`.
- `programs-api.ts` `NEWER_RESULTS` adds `reverted`. Tests: `v4102-revert-digest.test.ts`.

## v4.10.2 Task 5: replay fixes (the next step after the Monday block)

- `bench-reply.ts` `MOMENT_ASK` is "Add last week to your page?" (was "Looks right?").
- `bench-find.ts` `Seen.also_open` / `AlsoOpenLead`, `keepAlso` (written by `readyCommit` when nothing fits, dropped by
  `readyView` on an empty candidate list), `alsoLeadCommit` (the quiet reply's money lead, stored as the path's start
  ask). The Monday block marks the session said (`older`, `proof:streak=N`); the share yes without the email question
  returns `then_find`.
- `ready-copy.ts` `alsoLeadLine`, `ALSO_START_ASK`, `alsoAgainAsk`. Tests: `v4102-next-step.test.ts`,
  `v410-find.test.ts` ("v4.10.2 Task 5"), `weekly-moment.test.ts`.

## v4.10.1 Task 5: date-proofed tests

- `fixtures/pin-programs.ts` `pinPrograms` / `withProgramsPinned`: moves every dated active program out by the same whole
  years (close order and each close's day kept), restored after. Used by `v2131-o5.test.ts` (O5), `v2131-onboarding.test.ts`
  (O2), `v31-best-fit.test.ts` (whole file, `before`/`after`), `v31-reply-copy.test.ts` (Task 16), `v481-fixes.test.ts` (R3).
