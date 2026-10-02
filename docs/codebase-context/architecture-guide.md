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
  list_programs needs no arguments later and leads with "You're working on".
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
  `sponsor_campaigns` in `db/schema.sql`). record_submission *is* the entry (payout wallet
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
  `pnpm campaign score` counts distinct senders of successful txs to the contracts in the window
  (Blockscout, paced + retried; throttling throws, never reads as empty) whose nonce at the start
  block was > 0. Rank is computed on read (score, then earlier entry). `pnpm campaign
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
  the larger known per-winner award (`perWinnerUsd`: a USDC sponsor campaign's prize / winners,
  or a program file's optional `max_award_usd`; unknown is 0).
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
  `/fund` and `/award` show their action only while the connected wallet is the bound wallet
  (`WalletGate`: "Connect 0xABCD…1234 to continue"). Award plans (`planAward`'s `excluded`) refuse
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
