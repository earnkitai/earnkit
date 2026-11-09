# Code map (v5)

One line per file. Orientation and flows are in `architecture-guide.md`. Tests sit beside the code as `<name>.test.ts` (30 files in `lib/v5`); `lib/v5/journey.test.ts` is the end-to-end walk.

## apps/frontend/lib/v5 (the product)

- `apps/frontend/lib/v5/agents.ts`: Install steps per agent: pure data read by the install sheet, /docs and /llms.txt
- `apps/frontend/lib/v5/api-text.ts`: Text and link rules for the write API: plain visible text, https links on named domains
- `apps/frontend/lib/v5/chains.ts`: Chain registry: slug, ids, RPC and explorer hosts, explorer API (Blockscout or null), EVM or not
- `apps/frontend/lib/v5/confusables-table.ts`: Generated Unicode confusables table (UTS #39); do not edit
- `apps/frontend/lib/v5/confusables.ts`: Look-alike full stops, so link detection reads a hidden domain as one
- `apps/frontend/lib/v5/cron.ts`: POST /api/cron handler: freshness probe, repo cache sweep, the screen queue's share (`SCREEN_BATCH`), then the owner digest; a JSON body `{ job_id }` runs only that job's queue (300 applicants or 10 minutes)
- `apps/frontend/lib/v5/db.ts`: Postgres pool and transaction helpers
- `apps/frontend/lib/v5/deadline.ts`: A program's close in words: close day in its time zone and time left
- `apps/frontend/lib/v5/eligibility.ts`: Repo facts against a program's eligibility items: ready, gap, or no fit; a `rule` is a confirmation gap `rule:<hash8>` outside the two-gap limit (`ruleItem`, `itemKey`, `rulesOnly`)
- `apps/frontend/lib/v5/find.ts`: The find tool: ready, gaps, since, ledger, one program's details, or the open list; `shownReadyOf` caps remote and in-person ready apart; saves gaps to `last_gaps`
- `apps/frontend/lib/v5/github.ts`: Public GitHub reads with EarnKit's server token; `ghResponse` and `ghPage` expose the link and rate-limit headers
- `apps/frontend/lib/v5/guide-page.ts`: Data for /programs/[id]: the guide plus page context, as plain JSON
- `apps/frontend/lib/v5/guide.ts`: A program's guide: money, close, who can apply, form fields, rules, sources
- `apps/frontend/lib/v5/health.ts`: Daily freshness probe: links, page text changes (under 80% words shared), stale flags, passed deadlines
- `apps/frontend/lib/v5/http.ts`: Route helpers: JSON and CORS answers, `readParams` (form or JSON under a cap, null over it), secret and Bearer checks, `readCapped` (a request's or response's body under a byte cap)
- `apps/frontend/lib/v5/installations.ts`: Installation rows: save a token, connect a token, stamp last_find_at and `last_gaps` (`markFind`), read them (`lastGaps`), and `newlyLinkedLogin` (the GitHub login when the installation was linked after its last find, for the one-time linked notice)
- `apps/frontend/lib/v5/landing.ts`: Landing and /programs data: one tile per listed program and the hero money chip
- `apps/frontend/lib/v5/ledger.ts`: The ledger: applications, history, closed gap items (`gap_done` takes only the program's own items or `users`), the summary
- `apps/frontend/lib/v5/llms.ts`: The text of /llms.txt
- `apps/frontend/lib/v5/mail.ts`: Owner emails over Resend, idempotent; a no-op without RESEND_API_KEY
- `apps/frontend/lib/v5/mcp.ts`: The MCP server: find and track, their descriptions, the server instructions, the per-installation and per-IP tool-call limits
- `apps/frontend/lib/v5/oauth-routes.ts`: OAuth register, authorize and token handlers with rate limits; register and token bodies read under `MAX_OAUTH_BODY` (16 KB, else 413)
- `apps/frontend/lib/v5/oauth.ts`: OAuth 2.1 with PKCE and dynamic client registration, anonymous approval
- `apps/frontend/lib/v5/owner-digest.ts`: The owner's daily email: closures, failed links, changed pages, program changes with revert links
- `apps/frontend/lib/v5/prefill.ts`: Form pre-fill: EarnKit values, agent prose with sources, builder-only fields
- `apps/frontend/lib/v5/program-checks.ts`: Every problem with a program, for programs:check, the sync and the write API
- `apps/frontend/lib/v5/program-file.ts`: The program record schema (programs/*.json and API writes)
- `apps/frontend/lib/v5/programs-api.ts`: The write API: upsert or close, audit log, approve and revert
- `apps/frontend/lib/v5/programs-pending.ts`: Link check, owner email and signed approve/revert links for pending writes
- `apps/frontend/lib/v5/programs-read.ts`: Public GET /api/programs list; `moneyOf`, the card money (pool first, then the per-winner award, then the summary)
- `apps/frontend/lib/v5/programs-sync.ts`: Reads and checks programs/*.json and writes them (an expired active file as closed), for programs:check and programs:sync
- `apps/frontend/lib/v5/programs.ts`: The programs table: list open programs, read one, write one
- `apps/frontend/lib/v5/project-input.ts`: Lenient parse of the project an agent reports
- `apps/frontend/lib/v5/rank.ts`: Ordering of ready and gap verdicts (real changes before rule-only); `shownGapsOf` shows at most one rule-only program
- `apps/frontend/lib/v5/rate-limit.ts`: Fixed-window counters in Postgres
- `apps/frontend/lib/v5/reply.ts`: The words of a find reply: show_to_builder and agent_note
- `apps/frontend/lib/v5/repo-facts.ts`: Repo facts: public read, 7-day cache, 10 uncached reads a day per installation, the 30-day sweep, merged with agent-reported facts
- `apps/frontend/lib/v5/code-signals.ts`: Shared source-text signals: known token contracts and Builder Codes detection (used by repo-facts and v6/integrations)
- `apps/frontend/lib/v5/safe-fetch.ts`: SSRF-safe GETs and link probes on third-party hosts
- `apps/frontend/lib/v5/secrets.ts`: Scrubs secret keys from tool-call bodies before anything sees them
- `apps/frontend/lib/v5/old-tools.ts`: Old (pre-v5) tool names answered with a refresh message in `app/mcp/route.ts`
- `apps/frontend/lib/v5/since.ts`: What is new, changed or closing since the last find
- `apps/frontend/lib/v5/site-copy.ts`: Every site string that is not data, and the card formatters
- `apps/frontend/lib/v5/site-theme.ts`: Colour tokens mirrored in globals.css and Tailwind
- `apps/frontend/lib/v5/stats.ts`: GET /api/stats: nine public counts
- `apps/frontend/lib/v5/submit-hosts.ts`: Host rules for submission links: registrable domains, submit platforms, shared hosts
- `apps/frontend/lib/v5/track.ts`: The track tool: validate, write the ledger, answer in two lines; `started` names what `last_gaps` says is missing
- `apps/frontend/lib/v5/untrusted-text.ts`: Sanitizer for open-web text that reaches agents and people

## apps/frontend/lib/v5/fixtures (test support)

- `apps/frontend/lib/v5/fixtures/test-guard.ts`: Preloaded by tests: clears vendor keys, blocks the network, one database per file
- `apps/frontend/lib/v5/fixtures/test-db.ts`: Per-test-file database creation and cleanup
- `apps/frontend/lib/v5/fixtures/test-db-template.mjs`: Builds the worktree's template database (schema twice, programs synced)
- `apps/frontend/lib/v5/fixtures/test-db-create.mjs`: Creates one test database from the template
- `apps/frontend/lib/v5/fixtures/test-db-drop.mjs`: Drops one test database
- `apps/frontend/lib/v5/fixtures/local-postgres.mjs`: Refuses any database that is not local
- `apps/frontend/lib/v5/fixtures/github.ts`: Replays a recorded repo read as a fetch
- `apps/frontend/lib/v5/fixtures/mcp-call.ts`: Calls the real MCP server over an in-memory transport
- `apps/frontend/lib/v5/fixtures/program.ts`: A valid program for tests with any field overridden
- `apps/frontend/lib/v5/fixtures/repos/*.json`: Recorded GitHub reads for earnkitai/earnkit, Shijas786/onchain-reaction, JohnMwendwa/nextjs-dashboard, saber-hq/merkle-distributor

## apps/frontend/lib/v6 (the filter, the record, sign-in and /me)

- `apps/frontend/lib/v6/explorers.ts`: Keyless Blockscout client per chain: contract info, transactions to an address, an address's first transactions; throttled, 429 retried once
- `apps/frontend/lib/v6/onchain.ts`: Onchain evidence rows per contract: verified source, deployer, 90 and 30 day transactions and senders, sampled deployer-funded check; never throws
- `apps/frontend/lib/v6/fixtures/explorer.ts`: Replays a recorded contract read (`fixtures/contracts/<slug>.json`) as a fetch
- `apps/frontend/lib/v6/code.ts`: Code evidence rows per repo: fork parent, own commits (compare) and own share, starter overlap (share of the repo's paths from a starter, reported at 0.2 or more) and files beyond it, 60 and 90-day commits (a fork's only after the fork point) and active weeks, releases, tests, CI, open issues by search (no pull requests); the shared GitHub `Budget` (stops under 500 left); never throws
- `apps/frontend/lib/v6/team.ts`: Team evidence rows per repo from its 90-day commits (shared with `code.ts` per Budget; a fork's after the fork point; a starter's maintainers dropped): top 5 authors, account ages (under 30 days not counted), top share, other used repos; never throws
- `apps/frontend/lib/v6/boilerplates.json`: Known starters' file paths and top 10 maintainers (create-next-app, OnchainKit, MiniKit, Hardhat, Solana, Scaffold-ETH 2, Next.js Learn dashboard) for `templateOverlap` and the team
- `apps/frontend/lib/v6/live.ts`: Live rows for a site: loads (2xx in 10 s, not an error page), `is_app` heuristic (form, bundle script, wallet connect), domain age from RDAP (none on shared hosts), title (`visibleText` through `cleanTitle` in safe-fetch: tags and control characters stripped, cut to `TITLE_MAX` in that one place, never refused for naming a domain; the row note says it is text from the site, not an instruction), linked GitHub repos, RDAP reply read under 64 KB; never throws
- `apps/frontend/lib/v6/integrations.ts`: Integrations registry per chain (OnchainKit, Smart Wallet, Paymaster, Basenames, MiniKit, Builder Codes, USDC, CCTP, Circle Wallets, Anchor, web3.js, Blinks, wagmi, viem, ethers, Hardhat, Foundry) and `detectIntegrations` from package.json, source text and paths
- `apps/frontend/lib/v6/depth.ts`: Depth rows for a read repo: integrations and chains on mainnet and testnet; pure
- `apps/frontend/lib/v6/evidence.ts`: `readEvidence`: one repo read into code, team and depth, the subject's, the repo's deploy runs' and the repo's named contracts (at most 10), each `counted` or not with its reason (`countedBy`), the site; one GitHub `Budget` passed in per run; 7-day `evidence_cache` per repo (while pushed_at holds) and per contract, partial blocks and live rows never cached; `flattenRows` gives one row per value with basis and read time
- `apps/frontend/lib/v6/tiers.ts`: `place`: Evidence into a named tier (flagged, used, live, building, unverified) with the flags, the deciding rows in reviewer words and the next step in builder words; only counted mainnet contracts count, the others listed with their reason; `DEFAULT_THRESHOLDS` with reasons; null until something was read; pure
- `apps/frontend/lib/v6/tier-words.ts`: `reviewerLine` ("used: 1,240 funded senders on Base mainnet, 3 contributors, no flags.") and `builderLine` (how it reads, then Next); pure
- `apps/frontend/lib/v6/fixtures/evidence-builder.ts`: A minimal valid Evidence and block builders for pure tests
- `apps/frontend/lib/v6/fixtures/site.ts`: The real `safeProbePage` over a fake resolver and transport answering `fixtures/sites.json` (pages recorded 2026-11-06), and an RDAP fake
- `apps/frontend/lib/v6/fixtures/repos/<slug>.json`: Recorded repo, code and team reads (`record-repo-fixture.mts --v6`), replayed by the v5 `replayFetch`
- `apps/frontend/lib/v6/applicants.ts`: `parseApplicants` (a program's CSV, columns by name, each bad link or address nulled with a problem line), `resolveRepo` (a repo from the site's GitHub links, starter and SDK owners skipped, a matching word first), `identicalPitches` (5-word shingles, 90%, under 10 words ignored) and `sharedContributors`, inside one list; pure
- `apps/frontend/lib/v6/screen-report.ts`: `markdownReport` (totals, a section per tier, what could not be read) and `csvReport` (one row per applicant, formula cells defused); public evidence only, never a pitch; pure
- `apps/frontend/lib/v6/screen.ts`: `run`: the screening pilot: arguments, the list read one applicant at a time, placements with the counts across the list, both reports into one folder
- `apps/frontend/lib/v6/fixtures/applicants.csv`: Eight applicants for the pilot: the four recorded repos, a site-only row (abi.ninja), three bad rows, four sharing one pitch
- `apps/frontend/lib/v6/own-evidence.ts`: The builder's own project for find: `ownEvidence` (reads at most once in 24 hours), `usageLine` (EarnKit's one fixed usage template from counted mainnet contracts, else null), `evidenceSummary` (tier and `builderLine`)
- `apps/frontend/lib/v6/claims.ts`: `claim` (a 'started' applications row; a second within 24 hours by any of the builder's agents answers `already` with the claiming agent's client name), `releaseStale`, `appliedOvernight` (agent-submitted since the last find)
- `apps/frontend/lib/v6/find-record.ts`: The record side of find: linked, `pickProject`, `recordSide` (record, own tier under the 24-hour rule, `evidence_read_at` and `last_tier` written by EarnKit), `tierGate` (min_tier: a ready program below the bar becomes one 'tier' gap), `notNever`, `withinApproval`, `blockersOf`, `missingFor`; unlinked (and linked before any own tier is read), `provisionalTier` (live from a code homepage, live URL or mainnet contract; building for any other read repo; null unread, so no bar) and `provisionalGate` (the gap line names the bar: "Link GitHub so EarnKit can confirm your product has users / is live / has code."), and `blockersOf` against `EMPTY_RECORD`
- `apps/frontend/lib/v6/reviewers.ts`: A program's reviewers (`program_reviewers`): `addReviewer` (a signed-in builder by GitHub id, else by a login only one account has used; an existing program), `removeReviewer`, `reviewerPrograms`, `reviewersPost` (programs bearer, 404 while the API is off)
- `apps/frontend/lib/v6/screen-jobs.ts`: Screen jobs: `ScreenApplicant`, `createJob` (12-byte id, identical pitches counted then dropped, 30 days), `jobStatus`, `jobResults` (sorted by tier, public rows only; the site title row carries `SITE_TEXT_NOTE`), `recordOutcomes` (`screen_outcomes`; won or rejected into a matching builder's ledger only after their applied row), `xpCounts` (other programs' screens in 90 days by repo or deployer, and their outcomes), `sweepScreens` (jobs over 90 days)
- `apps/frontend/lib/v6/screen-worker.ts`: `workQueue`: queued applicants (the oldest job first, or only a named job), each taken atomically before it is read (a budget stop requeues and ends the run; a retryable null tier is retried up to 3 times), as the pilot reads them, on one Budget per call; placed with the job's thresholds, shared contributors inside the job and `xpCounts`; a failed read is `failed` with a one-line error and the job still advances
- `apps/frontend/lib/v6/screen-tool.ts`: The `screen` MCP tool: reviewers only (one-line refusals), 10 jobs a day per reviewer, queue, results with the totals line, outcomes
- `apps/frontend/lib/v5/fixtures/record-owner.json`: A sample owner record (EarnKit project, approved answers) for `replay.mts --linked`
- `apps/frontend/lib/v6/builders.ts`: Builders (one row per GitHub account): `upsertBuilder`, `getBuilder`, `ownerKey` ('b:' or 'i:'), `getRecord`, `saveRecord`, `withRecord` (a locked read-merge-save), `linkInstallation` (re-keys the installation's ledger to the builder), `deleteBuilder`
- `apps/frontend/lib/v6/github-auth.ts`: GitHub sign-in (read:user): `oauthConfigured`, `authorizeUrl`, the signed state (link code and browser nonce, 15 minutes), `exchangeCode`
- `apps/frontend/lib/v6/link-routes.ts`: `/link/<code>` (confirm page, then GitHub) and `/auth/github/callback` (starts a session, lands on /me?link=<code>; links nothing); `createLinkCode` (15 minutes, hash stored); `consumeLinkCode` (marks used and links in one transaction) and `denyLinkCode` for POST /me/link; per-IP limit
- `apps/frontend/lib/v6/sessions.ts`: Browser sessions for /me: the `ek_me` HttpOnly cookie (hash stored, 30 days), `sessionBuilder`, `endSession`, `clearCookie`, `cookieValue`
- `apps/frontend/lib/v6/record.ts`: The record: `BuilderRecord` schema, `mergeRecord` (bad leaves dropped with a problem line, `set_by` stamps, policy builder only), `approvePath`, `unapprovePath`, `isApproved`, `APPROVABLE`, `answerFor`, `recordMissing`, `completeness`, `KIND_WORDS`; pure
- `apps/frontend/lib/v6/record-tool.ts`: The `record` MCP tool: get, set (merged as the agent, never approved), brief; unlinked, the sign-in link
- `apps/frontend/lib/v6/answer-brief.ts`: The brief behind one answer kind: the reviewer's question, record and repo facts as lines, the length band and the style contract; pure
- `apps/frontend/lib/v6/reply-words.ts`: Words shared by the find reply and the record tool: the list joiner, `signInLine` (record and find's open list), `signInSentence` (the unlinked find's closing block, after the closing line), `confirmLine` (the unlinked tier gap per bar), `EVIDENCE_NOT_READ`; pure `linkedNoticeLine` (the one-time sentence after a link: linked to GitHub account X, unlink at earnkit.com/me).
- `apps/frontend/lib/v6/me-view.ts`: /me's data: `meData` (the record as blocks of fields in builder words, pending approvals, the ledger, linked agents, the ?link= banner), `csrfToken` and `verifyCsrf` (HMAC of builder, session cookie value and UTC day, today or yesterday), `problemSig`
- `apps/frontend/lib/v6/me-routes.ts`: /me's handlers: `meGet` (the session gate, 302 to /docs#record), `editPost`, `approvePost`, `policyPost`, `unlinkPost`, `linkPost` (confirm or refuse a link code), `deletePost`, `signoutPost` (web form under 64 KB, session and csrf, else 415, 413 or 403)
- `apps/frontend/lib/v6/fixtures/github-oauth.ts`: A fetch fake for GitHub sign-in (token exchange and user read)

## apps/frontend/app (routes and components)

- `apps/frontend/app/.well-known/oauth-authorization-server/route.ts`: OAuth authorization server metadata
- `apps/frontend/app/.well-known/oauth-protected-resource/[[...path]]/route.ts`: OAuth protected resource metadata for /mcp
- `apps/frontend/app/HomeView.tsx`: The landing page view: hero, steps, open programs, footer
- `apps/frontend/app/api/cron/route.ts`: POST /api/cron: the daily freshness probe, screen queue and owner digest; `{ job_id }` triggers one job
- `apps/frontend/app/api/programs/approve/route.ts`: GET/POST approve link: applies a pending write
- `apps/frontend/app/api/programs/revert/route.ts`: GET/POST revert link: undoes a live write
- `apps/frontend/app/api/programs/route.ts`: GET /api/programs: the public list of listed programs
- `apps/frontend/app/api/programs/write/route.ts`: POST /api/programs/write: the owner bot adds, updates or closes a program
- `apps/frontend/app/api/programs/writes/route.ts`: GET /api/programs/writes: the write audit log and pending writes
- `apps/frontend/app/api/programs/reviewers/route.ts`: POST /api/programs/reviewers: the owner marks a signed-in builder as a program's reviewer (or removes them)
- `apps/frontend/app/api/stats/route.ts`: GET /api/stats: nine public counts
- `apps/frontend/app/components/common/Button.tsx`: Button
- `apps/frontend/app/components/common/Footer.tsx`: The full footer with the painting
- `apps/frontend/app/components/common/Header.tsx`: The site header
- `apps/frontend/app/components/common/InstallButton.tsx`: The install button that opens the install sheet
- `apps/frontend/app/components/landing/Hero.tsx`: Landing hero: statement, money chip, install picker
- `apps/frontend/app/components/landing/HeroArt.tsx`: The hero painting and its light
- `apps/frontend/app/components/landing/Opportunities.tsx`: The open programs list on the landing
- `apps/frontend/app/components/landing/Steps.tsx`: The three steps on the landing
- `apps/frontend/app/components/sections/AddToAgent.tsx`: The install sheet content
- `apps/frontend/app/components/sections/agents.tsx`: Agent tab data and rendering for the install surfaces
- `apps/frontend/app/components/site/AgentMarks.tsx`: Agent logos
- `apps/frontend/app/components/site/FooterLight.tsx`: The light footer for inner pages
- `apps/frontend/app/components/site/Money.tsx`: Money text with sans currency signs
- `apps/frontend/app/components/site/NavLinks.tsx`: Header navigation links
- `apps/frontend/app/components/site/SegTabs.tsx`: Tab rail used by the install tabs
- `apps/frontend/app/components/site/ui.ts`: Shared class strings: cards, pills, page columns, headings
- `apps/frontend/app/components/site/useReducedMotion.ts`: Hook for prefers-reduced-motion
- `apps/frontend/app/components/ui/Logo.tsx`: The EarnKit logo
- `apps/frontend/app/components/ui/SchemaOrg.tsx`: JSON-LD structured data
- `apps/frontend/app/docs/DocsNav.tsx`: The docs side navigation
- `apps/frontend/app/docs/DocsView.tsx`: The docs page: install card, how a session goes, your record, screening for programs, how programs are checked
- `apps/frontend/app/docs/InstallCard.tsx`: The per-agent install tabs on /docs
- `apps/frontend/app/docs/page.tsx`: /docs route and metadata
- `apps/frontend/app/globals.css`: Tailwind layers, fonts and the --ek-s-* colour variables mirrored from site-theme.ts
- `apps/frontend/app/install/page.tsx`: Permanent redirect from /install to /docs#install (old links)
- `apps/frontend/app/layout.tsx`: Root layout: fonts, metadata, global styles
- `apps/frontend/app/lib/cached.ts`: Small time-based cache for server data
- `apps/frontend/app/lib/landing-cache.ts`: The landing data, cached
- `apps/frontend/app/lib/links.ts`: Shared site links
- `apps/frontend/app/llms.txt/route.ts`: /llms.txt from lib/v5/llms.ts
- `apps/frontend/app/mcp/route.ts`: The /mcp endpoint: bearer check, body cap and secret scrub, then the MCP server with the client IP (tool calls are rate limited per installation and per IP in mcp.ts)
- `apps/frontend/app/not-found.tsx`: The 404 page
- `apps/frontend/app/oauth/authorize/route.ts`: Re-exports the OAuth authorize handler
- `apps/frontend/app/oauth/register/route.ts`: Re-exports the OAuth client registration handler
- `apps/frontend/app/oauth/token/route.ts`: Re-exports the OAuth token handler
- `apps/frontend/app/page.tsx`: Landing route; data from lib/landing-cache, revalidated every 10 minutes
- `apps/frontend/app/programs/[id]/AskAgent.tsx`: The "ask your agent" box on a guide page
- `apps/frontend/app/programs/[id]/GuideView.tsx`: One program's guide: money, close, who can apply, fields, rules, sources
- `apps/frontend/app/programs/[id]/page.tsx`: /programs/[id] route, metadata and structured data
- `apps/frontend/app/programs/page.tsx`: /programs: every listed program
- `apps/frontend/app/sitemap.ts`: /sitemap.xml: site pages plus every listed program guide
- `apps/frontend/app/terms/page.tsx`: /terms: what EarnKit reads, stores and never does, the record, what programs see
- `apps/frontend/app/link/[code]/route.ts`: GET and POST /link/<code> (via lib/v6/link-routes.ts)
- `apps/frontend/app/auth/github/callback/route.ts`: GET /auth/github/callback (via lib/v6/link-routes.ts)
- `apps/frontend/app/me/page.tsx`: /me: the signed-in builder's record, server-rendered from `meData`, noindex
- `apps/frontend/app/me/MeView.tsx`: /me's markup: pending approvals, one panel per block, standing approval, applications, agents, delete; plain forms, no client script
- `apps/frontend/app/me/{edit,approve,policy,unlink,link,delete,signout}/route.ts`: POST handlers (via lib/v6/me-routes.ts)

## apps/frontend/scripts and db

- `apps/frontend/scripts/db-migrate.mts`: pnpm db:migrate: runs schema.sql
- `apps/frontend/scripts/env.mts`: Loads .env.local for admin scripts
- `apps/frontend/scripts/programs-sync.mts`: pnpm programs:check and programs:sync: validate and write programs/*.json (via lib/v5/programs-sync.ts)
- `apps/frontend/scripts/record-repo-fixture.mts`: Records a public repo's GitHub reads as a test fixture; `--v6` adds the code and team reads into `lib/v6/fixtures/repos`
- `apps/frontend/scripts/record-boilerplate.mts`: Records one starter's tree paths and top 10 contributors (maintainers) into `lib/v6/boilerplates.json`
- `apps/frontend/scripts/record-contract-fixture.mts`: Records a contract's Blockscout reads as a test fixture (keyless)
- `apps/frontend/scripts/screen.mts`: pnpm screen: the screening pilot over a program's applicant CSV into a markdown and a CSV report (via lib/v6/screen.ts)
- `apps/frontend/scripts/replay.mts`: Replay: find, track applied, find on a scratch database for a recorded repo (--monday)
- `apps/frontend/scripts/v4-tables.mts`: pnpm db:v4-tables: lists v4 tables with row counts and prints DROP statements
- `db/schema.sql`: The whole schema, additive and safe to run twice

## apps/frontend (config)

- `next.config.ts`: Security headers, noindex on /me, /link and /auth, the legal-page redirects, program logo CSP
- `proxy.ts`: The /me gate: no session is a 302 to /docs#record (lib/v6/me-routes.ts `meGet`)
- `tailwind.config.ts`: Tailwind with the s-* colour tokens from site-theme.ts
- `DESIGN.md`: The v5 site design system
- `package.json`: Dependencies and scripts

## programs/

- `programs/<id>.json`: One curated program each (the owner override; 17 files); validated by `pnpm programs:check`
- `programs/README.md`: How to add a program from a URL, field by field

## Elsewhere

- `docs/programs-api.md`: The Grok Bot's instructions and the write API reference
- `docs/design-docs-and-implementation-plans/`: v5 design, plan, ledger and go-live; older designs are history
- `.github/workflows/earnkit-cron.yml`: The one daily job (POST /api/cron)
- `README.md`: What EarnKit is and how to connect an agent
- `docs/screening-pilot.md`: The screening pilot for a program in one page: the CSV, the command, the tiers, what is read, the message to send
