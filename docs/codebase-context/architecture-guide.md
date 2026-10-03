# Architecture Guide

## Core terminology

- **Program**: a live builder program run by someone else (hackathon, grant, bounty). Has a
  reward, a deadline, rules, and submission requirements. Curated by hand in `programs/*.json`.
- **existing_work / chains / starts_at**: per-program facts list_programs uses to match a
  builder's public repos (`allowed` / `new_work_only` / `unknown`).
- **Alerts**: EarnKit can't message anyone, so list_programs opens with "Since you last checked"
  (new programs by programs.created_at vs installations.programs_checked_at, and deadlines within
  3 days), and asks the agent to offer a recurring check with its own scheduler.
- **setup / each_time**: what only the builder can do (one-time vs every entry); everything else
  is the agent's job. list_programs turns this into short "Me / You" lines on the server.
- **Memory**: per installation (no account), EarnKit keeps the last GitHub user/repos and
  agent-reported local_repos given, and
  `working_on` (programs passed to prepare_submission, cleared by record_submission), so
  list_programs needs no arguments later and leads with "You're working on". It also keeps the
  payout wallet of the last campaign entry (`installations.payout_wallet`), prefilled by
  prepare_submission with a confirm note.
- **verified_at**: the day a program's facts were last checked against its source. Within 7 days
  agents are told not to re-read the source.
- **Track**: a category inside a program with its own requirements.
- **Starter**: an optional idea to start quickly. Max 1 per track, or 2 when there are no tracks.
  Which starter a builder used is never tracked.
- **Installation**: one anonymous agent connection. Identified only by a token hash.
- **Project / submission**: recorded after the agent submitted to the program's own site.
- **Campaign**: a program with a `campaign` block. `CampaignConfig` (`lib/earnkit/campaigns.ts`)
  is a discriminated union on `kind`: `'earnkit'` (EarnKit's own: fixed amount per winner, top
  scores win, paid by `pnpm campaign payout`) or `'sponsor'` (v2.1: a sponsor's pool held in a
  Base escrow clone, sponsor picks winners — see
  `sponsor_campaigns` in `db/schema.sql`). record*submission \_is* the entry (payout wallet
  always; Base contracts required for `earnkit`, optional for `sponsor`). See
  `docs/design-docs-and-implementation-plans/v2-earnkit-campaigns.md`.
- **Sponsor campaign**: a `sponsor_campaigns` row, keyed by a random `ref` (bytes32), that walks
  `draft -> live -> awarded | refunded | taken_down` (or `expired` for an unfunded draft after 7
  days, or once its deadline is under 10 minutes away, since `createCampaign` would revert). The sponsor deposits into a one-per-campaign escrow clone (`EarnKitCampaigns.createCampaign`)
  that snapshots the factory's `operator`/`treasury` at creation, so a later factory rotation never
  touches an already-funded campaign. Each draft is bound to its `sponsor_wallet` at create.
  Going live, awarding, and refunding are never signed by EarnKit's server: it builds the
  transaction (`escrow.ts`), the sponsor signs it in their own wallet, and EarnKit reads the
  outcome from the chain (`sponsor.ts`'s `findFunding`/`findAward`, run by `checkChain`). A `live` sponsor campaign is also a
  `programs` row (`source = 'sponsor'`), so it shows up in list_programs/get_program/record_submission
  like any other campaign.

For other organizers' programs EarnKit does not build, evaluate, host, or pay. For its own
campaigns it scores, ranks, and pays (after a human approves winners). Sponsor campaigns: the
sponsor funds an escrow and picks winners; EarnKit's score is shown as a guide only.

## Apps at a glance

- `apps/frontend`: Next.js. Landing page, public activity section, the agent API, and all
  EarnKit logic (`lib/earnkit/`). Postgres via `DATABASE_URL`.
  It also hosts the EarnKit MCP server at `/mcp` and its anonymous OAuth (`/oauth/*`,
  `/.well-known/*`). There is no separate MCP package: every client connects to the URL.

## Data flow

```
agent (Grok Bot, Muse, Claude, Cursor…) ──HTTPS──> /mcp
  first connect: 401 + WWW-Authenticate -> /.well-known/oauth-protected-resource/mcp
    -> /.well-known/oauth-authorization-server -> POST /oauth/register
    -> GET /oauth/authorize (approves instantly, no account) -> POST /oauth/token
    -> token = installation row; the client stores the token
  then: Bearer token -> /mcp -> lib/earnkit/mcp.ts -> lib/earnkit/tools.ts -> Postgres
stdio-only clients: npx mcp-remote https://earnkit.com/mcp
Claude Code ──> programs/<slug>.json ──push to main──> deploy: pnpm programs:sync ──> Postgres
```

## Separation of concerns

- Business logic lives only in `apps/frontend/lib/earnkit/`. Routes, scripts, and the page call it.
- Matching returns keys as well as words: each verdict has `missing` (live_url, mainnet_deploy,
  new_work, real_users) and `effort` (none to weeks); list_programs returns them as `matches`, and
  get_program(repo) as `eligibility`. The text leads with the count and the fastest win, then one
  offer.
- Which repos count as the builder's: their own public repos plus public repos owned by others
  (orgs) they committed to in the last year (GitHub commit search). Private or local repos are
  never read: the agent reports what it sees (`local_repos`: chains + mainnet, live link, last
  commit) and EarnKit matches those facts the same way.
- Repo matching (list_programs with github_user) reads only public GitHub data with one server-side token; nothing about the
  builder is stored. Verdicts are hints from code (chain IDs/RPC hosts, commit dates, repo
  homepage); anything unconfirmed is labeled "check".
- launch_token calls tokens.fun's deploy API server-side (tokens.fun pays gas). It only works on
  a project the same installation recorded (projects.installation_id), once per project: the
  project is claimed atomically (token_url='pending') and the claim is kept if tokens.fun's
  response is lost, so a retry can never mint a second token. Requires builder_confirmed=true.
- `prepareSubmission` is pure (no DB) and never invents values. It reports what is filled,
  what is missing, and whether the agent drafts it (`from: project`) or asks the builder
  (`from: builder`).
- OAuth is stateless: client ids and codes are HMAC-signed with `EARNKIT_AUTH_SECRET`; the
  access token is derived from the code, so a replayed code can't create a second installation.
  Rotating the secret invalidates unused codes and client ids, not issued tokens.
- Program files in git are the source of truth for programs/tracks/starters. Every deploy syncs
  them to the database (upsert replaces all three). Programs drop out of list_programs
  automatically after ends_at; there is no scheduled re-check.
- Campaigns: entries are checked at submission (contracts, when required, must have no code at
  the start block, via Base RPC; one entry per contract and one per repo — `normalizeRepoUrl`
  lowercases and drops the scheme, `www.`, query, fragment, a GitHub `/tree/…` suffix, a trailing
  `/` and `.git` — both checked inside the insert's transaction under a per-campaign advisory lock;
  the normalized repo is stored as `projects.repo_key` with a partial unique index on
  `(program_id, repo_key)`, and a violation maps to the same error; `requireContracts` is `true` for
  `kind: 'earnkit'`, `false` for `kind: 'sponsor'` — sponsor entries only need a payout wallet).
  **Entry hygiene (v2.2 §1 Builders, T5):** before anything is stored, `recordSubmission` refuses
  the sponsor's own installation ("You created this campaign…") and the sponsor wallet as payout
  wallet (`selfEntryProblem`), enforces every required submission field (`missingAnswersProblem`
  over `prepareSubmission`'s ready/missing), checks the payout wallet (`isWalletAddress`: not zero,
  mixed case must be EIP-55; never one of the entry's contracts), screens it for sanctions, then
  requires **ownership proof** (`ownership.ts`, `checkOwnership`): the entry's repo must be a public
  GitHub repo whose `earnkit.txt` (root, default branch, fetched from
  `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/earnkit.txt`, 5 s, 4 KB, no redirects) says
  `payout_wallet: <the entry's wallet>`; each entered contract counts only if the transaction that
  created it was sent by that wallet (Base Blockscout: `creation_transaction_hash`, then that tx's
  `from.hash`; direct and factory/CREATE2 deploys alike), else "Contract <0x…> was deployed by a
  different wallet. Enter contracts deployed from your payout wallet." A `contracts:` line in the
  file is accepted but ignored (listing proves nothing). Errors name the exact file and line to
  add. This makes the first-entry-wins repo and contract dedupe owner-wins: only someone who can
  push to the repo can enter it, and only the deployer's wallet can claim a contract. Copied work:
  repos GitHub reports as forks are refused (`repoFacts`, one GitHub API read, injectable), one
  entry per live link per campaign (`normalizeLiveUrl` -> `projects.live_key`, unique index
  `projects_campaign_live_key`, checked under the same lock), and the repo's GitHub `created_at` /
  `pushed_at` at entry are stored (`projects.repo_created_at/repo_pushed_at`) and shown to the
  sponsor in status entries and the award plan (`repo_label`: "repo created <date>"). A non-fork
  clone with another live link remains a documented risk (spec, Risks). `.wiki` repos are refused.
  `EARNKIT_OWNERSHIP_BASE_URL` replaces raw.githubusercontent.com only when `NODE_ENV` is
  `development` or `test` (the e2e serves files from a local server); refused otherwise. The payout
  wallet requirement is `from: 'builder'` ("ask the builder; never derive it from the code"); a
  successful entry saves it as `installations.payout_wallet`, and `prepare_submission` prefills it
  next time with `payout_wallet_note` ("Using <wallet> from your last entry; confirm with the
  builder"). **Sanctions** (`sanctions.ts`): Chainalysis's oracle
  (`0x3A91A31cB3dC49b4db9Ce721F50a9D076c8D739B`, `isSanctioned`) over `BASE_RPC_URL`, on Base
  mainnet (chain 8453) only — elsewhere it is skipped with a logged note. For a Base mainnet
  payment the RPC must report chain 8453: in production a mismatched or failing RPC refuses ("Can't
  check this wallet right now; try again shortly."), outside production it is logged and skipped.
  Clean results are cached for 10 minutes. Screened: payout wallets at entry (on the prize chain; Base for EarnKit
  campaigns), the sponsor wallet at create (the escrow chain), and every winner of an award plan
  (`prepareAward`, `campaign fallback propose` and `execute`) and every winner of EarnKit's own
  `campaign payout` (before the dry-run print, so it fails too). A listed wallet gets "This wallet can't
  receive prizes on EarnKit." (or "…can't fund campaigns…"); an unreadable oracle fails closed
  ("try again in a minute"). The oracle is injectable (`setSanctionsOracle`) for tests.
  `pnpm campaign score` counts distinct senders of successful txs to the contracts in the window
  (Blockscout, paced + retried; throttling throws, never reads as empty) whose nonce at the start
  block was > 0. An ended window is read from its last block back (Blockscout's `block_number`
  keyset cursor), up to 500 pages (25,000 txs) per contract; a capped read is stored as
  `projects.score_partial` and named in the sponsor's `scores_note`. Sponsor status rescoring
  (`refreshScores`) runs under a per-campaign advisory lock (a concurrent call gets the stored
  scores and "Scoring in progress"), with a 20 s deadline passed into every Blockscout and RPC
  read, including the per-wallet history loop. `projects.scored_through` records the window end
  a score covers. A score is final (`scoreIsFinal`) only when it covers `ends_at` and was taken
  at least 15 minutes after it (explorer lag); earlier scores are provisional, refreshed when over
  6 h old and replaced after the grace. A read cut short by the deadline is saved only where
  there is no score yet, as provisional (`scored_through` null), and retried. Status entries
  carry `score_final`. Rank is computed on read (score, then earlier entry). `pnpm campaign
payout`/`rank` refuse on sponsor campaigns (`minScore`/`prizeText`/`wonText` in campaigns.ts
  branch on `kind` instead). `pnpm campaign payout` runs locally only, refuses before the
  deadline, below min_score, or if already paid, and records prize_tx + prize_amount;
  list_programs then tells the winner.
- Entry status (`entryStatus`, board and entry page): EarnKit kind "won / eligible / building";
  sponsor kind "entered" (live), "won <amount>", "not picked" (awarded), "no winners — sponsor
  refunded" (refunded); taken-down campaigns are 404. A sponsor board shows rank and wallets only
  once some entry is scored, and "Your campaign entries" never says "#N of M" for an unscored
  sponsor entry (it joins `sponsor_campaigns.state`). A closed EarnKit campaign with no entries
  (Campaign #1) has no public page.
- Human-facing dates use one format (`dates.ts` `formatDeadline`, "Oct 6, 2026, 06:51 UTC");
  machine fields (`ends_at`, `deadline`) stay ISO.
- "Fastest" and per-repo ordering in list_programs: quickest first; between equally quick fits,
  the larger known per-winner award (`perWinnerUsd`: a USDC sponsor campaign's prize /
  max(winners, 3), so one big single-winner prize can't buy the top spot, or a program file's
  optional `max_award_usd`; unknown is 0). Within a repo's list, unverified sponsor campaigns
  come last.
- No auth beyond the installation token. Anyone can get one (by design), so the agent count
  can be inflated by someone scripting the sign-in flow.
- **Sponsor campaigns** (v2.1): the escrow (`contracts/`) is the only place a sponsor's funds
  move; EarnKit's server only reads the chain (`escrow.ts`) and holds no private key at all.
  The `sponsor_campaign` tool is registered only when the escrow is configured
  (`escrowConfigProblem()` is null: `ESCROW_FACTORY_ADDRESS` set, `ESCROW_CHAIN` one of
  base|base-sepolia|local); otherwise the server has the 5 builder tools, `/fund` and `/award`
  404, and the check API returns 503. Each campaign is a clone (`EarnKitCampaigns.createCampaign`) that snapshots
  the factory's `operator`, `treasury` and `pauser` (the clone's `guardian`) at creation, so a
  factory owner who later rotates any of them can't redirect an already-funded campaign's payouts
  or fees. **Wallet binding (v2.2 §1):** `create` requires `sponsor_wallet` (EOA or contract;
  mixed case must be a valid checksum; stored lowercase in `sponsor_campaigns.sponsor_wallet`).
  Funding and awards are found by reading the chain, never from a reported tx hash:
  `findFunding` reads `factory.campaignOf(sponsor_wallet, ref)` (only the factory writes it, so a
  non-zero entry is a genuine clone) and requires the clone's sponsor, token, `prize + fee` and
  `endsAt` to equal the draft's and its state to be Funded (`matchFunding`/`fundingMismatch`); a
  match publishes the program in one row-locked (`FOR UPDATE`) transaction (`publishFunding`), so
  concurrent checks publish once; a lazily-expired draft is still rescued. A deposit from the
  bound wallet with other terms is refused and named to the sponsor (status `fundingProblem`),
  and the operator refunds it with `pnpm campaign refund <ref> --escrow <address>`. Another
  wallet's deposit for the same ref (refs are unique per sender) is its own escrow: EarnKit never
  looks at it, so front-running can't hijack or block a campaign. `findAward` reads the clone's
  `state()`: Awarded → its `Awarded` log, searched from the estimated block at `endsAt` (2 s
  blocks, 300 blocks slack, 9,000-block chunks; `readAwardedLog`), recorded against the sponsor's
  plan, else the operator's `fallback_plan`, else off-plan (`mapOffPlanAward`, non-entry wallets
  flagged in `award_onchain`); Refunded → the row is marked `refunded` (only `live` rows are
  checked, so `taken_down` stays). `checkChain` runs from `status` (every state; an RPC failure
  becomes `chain_note`), the `/fund` and `/award` page loads, `POST /api/sponsor/[ref]/check` (no
  body; the pages poll it every 3 s for up to 2 minutes after sending) and `pnpm campaign sync`.
  Chain reads are throttled: a ref is read at most once per 15 s (`chain_checks`, claimed
  atomically so it holds across instances; checks in between reuse the stored result; the CLI
  passes `fresh`), `/check` allows 60 requests per IP per minute and sponsor `status` 60 per
  installation per minute (`rate-limit.ts`), and the
  `Awarded` log search goes newest-first, at most 6 `getLogs` chunks per check, resuming from
  `chain_checks.award_scan_hi` (status says it's still searching meanwhile).
  `/fund` and `/award` show their action only while the connected wallet is the bound wallet
  (`WalletGate`: "Connect 0xABCD…1234 to continue"). Because anyone's agent can bind someone
  else's wallet and send them the link, `/fund` shows a fixed warning (only fund a campaign your
  own agent created) and "This campaign can only be funded from <wallet>", and `/award` says the
  winners were proposed by the creating agent, links each to EarnKit's own `/p/<id>` page, and
  flags in red a winner that is the sponsor's wallet or a wallet paid twice. Award plans (`planAward`'s `excluded`) refuse
  any EarnKit escrow clone, the sponsor wallet, the token and the factory as a winner — the
  contract only excludes the clone itself and its own parties. EarnKit's score is shown to the
  sponsor only as a guide, never binding. **Operator fallback (contract v2.2 §4):** the operator
  can't award; `pnpm campaign fallback propose <ref> --winners …` (`OPERATOR_PRIVATE_KEY`, after
  `endsAt + 7 days`, same plan checks; stores `fallback_plan`, prints the 72 h execute time),
  `fallback execute <ref>` (after the delay; checks the stored plan hashes to the onchain
  proposal) and `fallback veto <ref>` (`GUARDIAN_PRIVATE_KEY`; sticky: no re-propose after it).
  Status says when a fallback is pending and when it becomes payable. All signing keys live in a
  local shell, never on Railway. Program ids are `sponsor-<first 16 hex of the ref>`, and
  `publishFunding` refuses to publish over an existing program id. Every `sponsor_campaign`
  reply carries `show_to_sponsor` (shown to the sponsor as written) and, where there is one,
  `next_step` for the agent, with no tx hashes; the text is built by pure functions in
  `sponsor-rules.ts`. Sponsor programs make no `verified_at` claim: `get_program` says they are
  set by the sponsor and backed by the escrow. The operator CLI turns every error into one
  readable line (contract reverts named, e.g. "…reverted: NotAllowed.") and checks the escrow
  onchain before signing (refund only a Funded escrow, naming who receives it).
- **Sponsored isn't curated** (v2.2 §3): every sponsor campaign carries a fixed label, "Sponsored ·
  unverified" or "Sponsored · verified <host>" (`sponsor-identity.ts` `sponsorLabel`), in the
  list_programs line, get_program (`description` and `campaign.sponsor`: name, label, verified,
  host, track_record) and on the campaign, `/fund` and `/award` pages (the latter two are noindex).
  Verified means `https://<sponsor_url host>/.well-known/earnkit.txt` has a line
  `earnkit-sponsor: <sponsor_wallet>`; it is fetched by `safe-fetch.ts` (https/443, domain names
  only, every resolved address public, the socket pinned to the vetted address while SNI, the
  certificate check and Host stay on the hostname, no redirects, 5 s, 4 KB) and cached per
  (host, wallet) in `sponsor_verifications` (pass 24 h, failure 1 h). DNS goes through c-ares
  (`dns.promises.Resolver`, resolve4 + resolve6, 2 s timeout, 1 try, cancelled at the deadline),
  never `dns.lookup`, so slow nameservers can't tie up libuv's threadpool. It fetches at create (a
  failure is always re-fetched), on status (the creating agent retries a failure after 1 minute),
  on the pages and in `pnpm campaign sync`; list_programs and get_program read the cache only (one
  query) and never wait on a fetch: missing or stale entries are refreshed in the background
  (fire-and-forget, deduped per (host, wallet), at most 4 at once). A safe A answer is used
  without waiting for AAAA. Any error reads as unverified. Only a funded campaign (live, awarded,
  refunded, taken down) shows an identity: a draft can bind anyone's wallet, so an unfunded
  draft's `/fund` page shows only the title and "Draft: the sponsor's identity is confirmed only
  after it is funded from the bound wallet." `sponsor_url` reaches
  agents only once verified. A sponsor name using a reserved brand (or a title that reads as by or
  official to one: "Official", "by/from [the] <brand>", "<brand> Grant/Foundation/Labs/
  Hackathon…" or glued "BaseGrants", or just the brand; "Build on Base" is fine, and USDC never
  counts in a title) (EarnKit, Base,
  Coinbase, Circle, USDC, Arc, Tempo, Monad, Robinhood, tokens.fun; whole words of the confusable
  skeleton in `confusables.ts` — NFKD, marks dropped, lowercase, the UTS #39 table generated into
  `confusables-table.ts` by `scripts/gen-confusables.mts` plus stroke letters and small capitals,
  other non-ASCII as word breaks, "d"→"cl", "l"→"i", "rn"→"m" — incl. split letters like
  "B.A.S.E") is refused at create unless the verified host is that brand's official domain (apex or www). A
  name or title with a word mixing plain ASCII letters and any other letter after NFKD and
  dropping marks ("Mɵnad", "Bаse"), or any non-ASCII Latin letter outside the common European
  set even with no ASCII letter ("ɱɵɲɑɖ"), is refused outright ("Use plain letters in names and
  titles"); accented words ("Café", "Zürich"), common European letters the skeleton maps (ß ø æ œ
  ł đ þ ð ı ħ ŋ: "Straße", "Łódź") and whole words in another script pass. The brand check also
  runs on a second skeleton reading ß/ẞ as b, þ as p and ð as o ("Coinßase", "Temþo", "Mðnad"). Unverified sponsor campaigns are listed but are
  never the "Fastest" headline or the closing offer (`present.ts`), and sort after curated
  programs in "Also open"; the "Since you last checked" line names only curated or verified
  programs and counts new unverified ones ("2 new sponsored campaigns (unverified)"). The track
  record counts a sponsor wallet's funded USDC campaigns of 100 USDC or more (drafts never count,
  since anyone can bind any wallet to a draft); "awarded" is only awards the sponsor made
  (`sponsor_campaigns.award_source`) that paid nothing to the sponsor wallet, with the operator
  fallback, self-paid and refunded counts shown apart. A pool must be at least 50 USDC
  (`checkDraft`; `SPONSOR_MIN_POOL` lowers it on the local chain only).
- **Third-party text is data** (v2.2 §2): anything a sponsor or builder writes reaches other
  people's agents, so it goes through one sanitizer (`untrusted-text.ts` `cleanText`: after NFKC
  an allowlist — letters, numbers, a fixed punctuation set, dashes, emoji — so invisible, tag,
  bidi and markup characters are dropped; then links in any form and HTML entities are rejected;
  per-field limits) at the input boundary; `sponsor_url` is https, at most 100 characters, a plain
  host, no query or fragment (`SponsorUrl`): `DraftInput`
  (sponsor_name, title, theme, criteria), `AwardWinner.reason`, and campaign entries' project
  name/description (`cleanProject` in record_submission and prepare_submission; other programs'
  projects go only to the builder's own submission, so they are not restricted). Where it is
  shown, it is either quoted single-line (`quoted()`: list lines, "Fastest", get_program
  title/organizer, show_to_sponsor) or inside an envelope that says who wrote it:
  `get_program.sponsor_content` (theme, criteria, sponsor_url) and `sponsor_campaign` `entries`
  with `note`; award reasons come back in prepareAward's `sponsor_content.reasons`. Errors refer
  to other entries by number only, never by name. Sponsor programs' description, summary and rules are EarnKit's words only, rebuilt
  at read time (`programCard`/`programDetails`), so rows published before v2.2 read the same; the
  theme is stored in `campaign.what_to_build` (legacy rows: `description`) for the campaign page.
  `SAFETY_LINES` go in the server instructions and the descriptions of list_programs,
  get_program, record_submission and sponsor_campaign. The scheduled-check offer is read-only.

## Abuse limits and response headers (v2.2 §5)

- **Rate limits** live in one place, `lib/earnkit/rate-limit.ts` (`LIMITS`, `enforce`), backed by
  Postgres `rate_windows` so they hold across instances: sponsor create 5/day and
  record_submission 20/day per installation; at most 3 entries per installation per campaign
  (counted in `recordSubmission` under the campaign's advisory lock); OAuth client registration
  20/hour, authorize 60/hour and new installations 10/hour and 30/day per IP (the token endpoint
  counts only codes that create an installation; a replayed code is free), since installations
  are the identity every per-installation limit keys on; GitHub matching 30/hour per installation (when refused, list_programs still
  answers, with the readable reason in place of "your repos"); chain checks 60/min. MCP tools turn
  `RateLimitError` into a readable error; HTTP routes answer 429 with `Retry-After`. The client IP
  is `X-Real-IP` (set by Railway's edge, which serves earnkit.com directly), else the rightmost
  `x-forwarded-for` entry; IPv6 is keyed on its /64. Fixed windows can pass up to 2x a limit
  across a boundary; daily windows reset at UTC midnight.
- **Response headers** (`next.config.ts`): every response gets `X-Frame-Options: DENY`,
  `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and in production `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains` yet: add it, and consider `preload`, only once every earnkit.com subdomain is confirmed to serve HTTPS, since browsers then refuse plain http on all of them for a year). Config headers replace
  a route's own, so the token image route's stricter CSP is repeated there as a later rule. There
  is no `script-src` policy: Next's inline bootstrap/RSC scripts and the JSON-LD block would need
  per-request nonces (a `proxy.ts` that sets them, and dynamic rendering).
- **Public origin:** OAuth discovery and `WWW-Authenticate` use `EARNKIT_URL`; outside
  development and test a missing `EARNKIT_URL` is an error, never a fallback to the request Host.
- **GitHub matching cache:** repo facts (detected chains; commits since each program's start) are
  cached for an hour per (repo, `pushed_at`) in `github_repo_facts`; a new push is a new key, and
  incomplete reads (a failed tree, file or commits call) aren't cached.
