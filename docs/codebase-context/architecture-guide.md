# Architecture Guide

## Core terminology

- **Program**: a live builder program run by someone else (hackathon, grant, bounty). Has a
  reward, a deadline, rules, and submission requirements. Curated by hand in `programs/*.json`.
- **existing_work / chains / starts_at**: per-program facts list_programs uses to match a
  builder's public repos (`allowed` / `new_work_only` / `unknown`).
- **Alerts** (v2.4 §4, `alerts.ts`, `fees.ts`): EarnKit can't message anyone, so every builder
  tool reply opens with `since_you_last_checked` ("Since you last checked: …") when there's news
  for the installation or any wallet it used. Money first (Ruling 26): prizes paid (amount in USD
  and the basescan link; at most 3 a check, the rest next time), then builder bonus wins (v2.5 §3,
  Task 8: `you won 0.12 ETH builder bonus (<program's factual name>)`, same 3-a-check cap; the data
  is `paidBonusWins`, which reads Task 7's `bonus_payouts` rows that are paid (`paid_at` and
  `tx_hash` set), matched by installation or creator wallet), then sponsor wins, then token fees of $100 or more waiting in Clanker's FeeLocker
  (once per $100 step), then an entry moving into or out of the top N (campaign leaderboard), then
  the builder bonus's own top 10 (from `bonus_scores.rank`: `your entry moved into the top 10 for
  the builder bonus (<program>)`), then EarnKit campaigns opened since (`programs.opened_at`, set
  when a program becomes active). What was shown is remembered as ids (`installations.alert_state`:
  prizes, campaigns, top-N flags, plus `bonusWins`/`bonusTop` for the builder bonus), never by
  time, so nothing is lost to clock or ordering skew.
  The facts are read in one transaction on one connection (`FOR UPDATE` on the installation row,
  `lock_timeout` 500 ms, `statement_timeout` 1.5 s): locked or slow means no alerts this time and
  nothing marked seen. `list_programs` puts them first in `show_to_builder`. New curated
  programs and curated deadlines within 3 days are not alerts (I7): they go in an "Updates:" line
  at the end of the first message, after the tables and just before the one offer
  (`present.ts` programUpdates; new sponsored campaigns only counted; none on a first check). It
  carries `schedule_daily_check` once per
  installation, asking the agent to schedule a daily read-only `list_programs` that messages the
  builder only when that line is there ("a win, a new campaign, your rank"; token fees are never
  advertised there).
- **First message (v2.6 §1; v2.7.1 wording)**: after any alerts, `list_programs` leads with "EarnKit matches you
  to $X in top prizes you qualify for" when the builder's repos fit something ($X = the
  per-winner `max_award_usd` of each program fit, once each; unknown amounts count 0 and show
  their own words; $X = 0 keeps "Your repos fit these open programs:", no "qualify"). With no repo
  known and no GitHub user given or remembered (`youCould`/`githubGiven`, Ruling 11), it instead
  leads with "$X in top prizes is open right now" (every open curated program's per-winner prize) and that
  table's prize column reads "You could win" instead of "Prize". Program tables carry a "Builder
  bonus" column (`bonusCell`): the open round's pool (`roundPoolsWei`, one grouped read of the
  bonus ledger, open rounds only), "new pool", or "—" only when the program opted out
  (`builder_bonus: false`, Ruling 7) or its round froze; a note under them says EarnKit isn't
  affiliated with any organizer (earnkit.com/policy). With no repo it also lists curated `ideas`,
  one per line (`- <program>: <idea>`, 2 per program, 6 in all), labeled "Ideas I can build:" (or
  "Ideas for these programs:" when the agent can't build) and closes with "Pick one and I'll
  start." The EarnKit campaigns table shows only while a campaign is open.
- **setup / each_time**: what only the builder can do (one-time vs every entry); everything else
  is the agent's job. list_programs turns this into short "Me / You" lines on the server.
- **Memory**: per installation (no account), EarnKit keeps the last GitHub user/repos and
  agent-reported local_repos given, and
  `working_on` (programs passed to prepare_submission, cleared by record_submission), so
  list_programs needs no arguments later and leads with "You're working on". It also keeps the
  installation's last wallet (`installations.payout_wallet`). v2.6 Ruling 10 (plan): every
  `record_submission` that names a valid wallet writes it, and so does the token flow whenever it
  keeps a creator wallet (`installations.ts` `rememberWallet`/`rememberedWallet`). Outside campaigns
  it is prefilled on the coin's wallet line (one yes confirms the coin and the wallet). Campaign
  entries still ask about it in full and never prefill it (final review I8). Ruling 22: a wallet
  the builder gives that isn't valid fails the call ("a 0x wallet address (check it for typos)");
  it never falls back to the remembered one.
- **verified_at**: the day a program's facts were last checked against its source. Within 7 days
  agents are told not to re-read the source.
- **Track**: a category inside a program with its own requirements.
- **Starter**: an optional idea to start quickly. Max 1 per track, or 2 when there are no tracks.
  Which starter a builder used is never tracked.
- **Installation**: one anonymous agent connection. Identified only by a token hash. v2.4 §5: one
  installation per OAuth client (installations.client_key = sha256(client_id)[:32]; every
  registration's client id carries a random 128-bit nonce, so apps with one fixed redirect URI
  never share one); re-authorizing the same client re-points the installation to the new token.
  Client ids from before v2.4 (no nonce) keep v2.3 token keying (Ruling 1). Wins and fees also
  show for every wallet in installation_wallets.
- **Project / submission**: recorded after the agent submitted to the program's own site.
- **Campaign**: a program with a `campaign` block. `CampaignConfig` (`lib/earnkit/campaigns.ts`)
  is a discriminated union on `kind`: `'earnkit'` (EarnKit's own: a USD prize (`prize_usd_total`)
  paid in MINI at an amount fixed at go-live, top scores win, paid automatically by the cron after
  a 48 h review) or `'sponsor'` (v2.1: a sponsor's pool held in a
  Base escrow clone, sponsor picks winners — see
  `sponsor_campaigns` in `db/schema.sql`). record*submission \_is* the entry (payout wallet
  always; Base contracts required for `earnkit`, optional for `sponsor`). See
  `docs/design-docs-and-implementation-plans/v2-earnkit-campaigns.md`.
- **Sponsor campaign** (archived in v2.12: `archive/sponsor-campaigns/`, `EARNKIT_SPONSOR_CAMPAIGNS`,
  default off; the tool, `/fund`, `/award` and the check route are no longer in the app, and sponsor
  programs are not listed. What follows describes it as it ran before): a `sponsor_campaigns` row, keyed by a random `ref` (bytes32), that walks
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
campaigns it scores, ranks and pays on its own (v2.4: the cron, after a public 48 h review in
which the owner can remove an entry). Sponsor campaigns: the
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
    -> GET /oauth/authorize (v2.14: Sign in with X; x-install.ts) -> X -> GET /x/callback
    -> the client's redirect with a code carrying the X user (signed) -> POST /oauth/token
    -> token = installation row, bound to the X account (attachToX); the client stores the token
    (a client serving many builders, or X unset: approved at once, anonymous, as before v2.14)
  then: Bearer token -> /mcp (old tool names rewritten: aliases.ts) -> lib/earnkit/mcp.ts
        -> lib/earnkit/tools.ts (find, prepare, confirm, tell -> handlers) -> Postgres
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
  commit, and an optional GitHub `url` kept only when it parses as one, Ruling 13) and EarnKit
  matches those facts the same way.
- Repo matching (list_programs with github_user) reads only public GitHub data with one server-side token; nothing about the
  builder is stored. Verdicts are hints from code (chain IDs/RPC hosts, commit dates, repo
  homepage); anything unconfirmed is labeled "check".
- **Token at submission (v2.3)** (`token-proposal.ts`, `token-gate.ts`, `token-launch.ts`,
  `tokens.ts`). Flow: `prepare_submission` returns a `token` block (EarnKit's proposed name and
  ticker — the project name, ticker candidates checked against brands and tokens.fun's
  `check-ticker` —, creator wallet, the verbatim earnings line, terms links, a `note` with what the
  repo needs, `has_bonus` (`hasBuilderBonus`, which is `bonusOn` since v2.6: active, not opted
  out, not a campaign), and `say_to_builder`, which alone is the complete consent text: the
  one token row (`entry-text.ts` `tokenRow`; on a bonus program it reads "$TIP on tokens.fun, you
  keep 40% of fees · skip: no builder bonus" instead of the generic "say no token to skip" — never
  shown or mentioned past this one row), the footnote naming the builder's own 40%-of-fees split
  only ("you keep 40% of trading fees (after Clanker's 20% protocol cut)"), both terms links, the
  earnkit.txt requirement) unless the program's `token_policy` is
  `off` or launches aren't configured (`TOKENSFUN_DEPLOY_API_KEY` unset). `record_submission`
  records the entry first, then runs the token part (`submissionToken`, which never throws: the
  entry is never failed or rolled back by its token). It launches only with
  `builder_confirmed === true` **and** an explicit `token: { name, symbol }` echoing the ticker the
  builder confirmed (ruling 10); an omitted token, `null`, or one without a symbol is `skipped`
  with a note to pass it, and the proposal is stored for a later `launch_token`. The token object
  is accepted loosely (MCP passthrough; `image` from `token.proposed` is ignored; another unknown
  key or a bad field is `skipped` with a note naming it — never a failed entry). `launch_token
  { project_id, builder_confirmed: true }` (strict schema) launches or retries with the stored
  proposal unless given changes, after applying a fixed `live_url` (any entry) or `repo_url`
  (not campaign entries) to the project row. **Creator wallet** (Rulings 28, 30): the token
  object's `creator_wallet`, then the wallet given in this call (`record_submission`'s
  `payout_wallet` outside campaigns), then the entry's own (`creator_wallet`, `payout_wallet`).
  The installation's remembered wallet is never read by the token flow, in either mode (it may be
  another entry's, another person's on a shared registration, or changed since the builder saw
  it). `prepare_submission` shows it on the wallet line and returns it as `shown_wallet`; the agent
  passes that back as `payout_wallet` after the builder's yes. Omitted: the entry is recorded with
  no coin and the plain no-wallet reply. `launch_token` with no wallet of its own fails with the
  `NO_WALLET` note, nothing saved or deployed.
  **Notes** (Ruling 31): every token outcome's `note` is plain builder text (no tool, field or file
  names; `token-launch.ts` `TECHNICAL_TERMS`); the technical instruction (call launch_token with
  creator_wallet, `repo_url:`/`live_url:` problems, `name:`/`symbol:` rule messages, `image_data`,
  the exact proof line) is in `agent_note`. Name and ticker problems read "Coin name: …" and
  "Ticker: …" (`plainProblem`). Both go through one flow (`runTokenFlow`): launches
  configured; `decideToken` (policy, "skip", an existing token, confirmation, explicit ticker at
  submission, edits, name/ticker rules, creator wallet); one token per repo (another project with
  the same `token_repo_key` and a token or claim); the gate (`tokenGate`, v2.6 §3: see "Coin gate
  (v2.6)" below: policy not off; a public GitHub repo with real code; **ownership** — its
  `earnkit.txt` carries this agent's ticker-free `token: <code>` line for the repo; the creator
  wallet passes the sanctions screen; no live-link check; never cached); the launch limits (v2.8.1
  §A4: `LIMITS.tokenLaunchWallet`, 10 per creator wallet per UTC day, plus `LIMITS.tokenLaunch`, 10
  per installation as an abuse floor; counted only right before a deploy; over either, the note says
  "Try again after 00:00 UTC."); then `deployToken`.
  **Policy:** `encouraged | allowed | off` on programs (program files; sponsor campaigns via
  `sponsor_campaign create` until v2.12 archived it; default `encouraged`); encouraged and allowed both launch by default,
  off never launches; the policy is never displayed (v2.4: tokens are only the one default row in
  the confirmation). **Statuses** (`projects.token_status`, with `token_note`):
  `launched`; `skipped` (no token, unconfirmed, policy off, no symbol, a bad token field, launches
  not configured, or — at submission — an edit refused or the project or repo already has a token);
  `gate_failed` (`note`: the reason in plain builder words, never a file or field name;
  `agent_note`, final review M7: the technical detail for the agent, e.g. the exact `token: <code>`
  line to write and push); `pending` (outcome unknown: claim kept); `failed` (tokens.fun
  refused, the daily limit, or — on `launch_token` — a refused edit or an existing/pending token on
  the project or repo). Status writes from the flow only touch rows with `token_url IS NULL`.
  **Claim:** `deployToken` claims the project atomically (`token_url = 'pending'`, only this
  installation's project, only if NULL, only while its `repo_url`/`live_url` are still exactly the
  ones the gate checked — the flow passes them in; `token_repo_key` and tokens.fun's
  website/appUrl come from them, never a re-read; a row changed in between, e.g. by a concurrent
  `launch_token` override, gives `failed` "The project's links changed during the launch; call
  launch_token again." and nothing is claimed — only if no other project with the same normalized
  repo
  holds a token or claim; it sets `token_repo_key`, and the unique partial index
  `projects_token_repo_key ... WHERE token_url IS NOT NULL` makes two concurrent claims on one repo
  impossible) and releases it only on a 4xx with a JSON body (a refusal before minting); no
  answer, any 5xx (e.g. tokens.fun's 502 "Deployment status unknown") or an unparsed body keeps it
  pending, so a retry can never mint a second token. Only EarnKit's own claims count for "one per
  repo": a `token_url` a builder typed into `record_submission` is unproven and has no
  `token_repo_key`. The deploy is bounded by `EARNKIT_TOKENSFUN_TIMEOUT_MS` (default 120 s);
  v2.8.1: the tool replies after `EARNKIT_LAUNCH_REPLY_MS` (40 s) with "launching" while it runs on.
  **Key:** `TOKENSFUN_DEPLOY_API_KEY` stays server-side (EarnKit's own key on tokens.fun, which
  skips tokens.fun's per-IP limits — hence the ownership proof, one token per repo, and the
  per-installation cap; the 2-a-day per creator wallet cap stays). The image is the agent's upload
  (`/api/projects/:id/image`) or (before v2.10; see "Token logo (v2.10 item 12)") the monogram (`/api/projects/:id/token-image?s=SYMBOL`: drawn only
  from the stored, validated ticker, and 404 unless `s` matches it, so the immutable cache can't
  serve a stale logo). Fees are unchanged (WETH pair; Clanker 20%, then platform 50% / creator
  40% / MINI buyback 10%). **Treasury lock:** `contracts/script/Deploy.s.sol` reverts on chain 8453
  unless `TREASURY` is `0xc8A889577446153e28D42254B75238Ae31EC7D57`. `pnpm token:e2e` runs every
  flow against a local Postgres and a mock tokens.fun (which also serves `earnkit.txt`).
- **The token step (v2.7 §3, Rulings 15–18, C5–C7).** Supersedes the v2.3 wording above where
  they differ.
  - *Readiness first* (Ruling 15). `prepare_submission` runs `prepareSubmission` before anything
    token-related. While a required item is missing, `show_to_builder` leads with
    `Before you submit: <to-do>; <to-do>.` (`entry-text.ts` `notReadyLine`, at most 3, then
    "and N more"; each item is the program file's `todo`, else its label normalized, C5;
    `todoOf`), followed by the Entry and Prize rows only: no `token` block, no `shown_wallet`, no
    wallet line or footnote, and no tokens.fun ticker check. A campaign's remembered
    payout-wallet question still shows. `programs:check` requires a `todo` on every required item.
  - *Always proposed* (Ruling 16, `token-proposal.ts` `proposeToken`, never null). The name: the
    project name, `<name> Token`, the repo name (`repoNameOf`: `-`, `_`, `.` as spaces), then
    `<TICKER> Token`. Tickers: `tickerCandidates(project)`, `tickerCandidates(repo)`,
    `initialsCandidates`, then `ENTRY`, `ENTRY2`…; each must pass `tickerProblem`. At most 12
    tokens.fun checks per proposal; a ticker found taken is never proposed, and past the checked
    list the next candidate is proposed with "ticker not checked for duplicates". With neither a
    project name nor a repo there is no block. C6: `token-launch.ts` re-checks the final ticker
    after the one-token-per-repo check (final review M8: a repo that already has a token is
    refused without a tokens.fun call) and before the gate; taken means no launch and a plain
    note; unreachable launches as v2.3 did.
  - *Launch only when ready* (C7). `runTokenFlow` (record_submission and launch_token) runs
    `entryMissing` first: `prepareSubmission` over the program's requirements, on what
    record_submission was just given (`known`: its project and `submission_data`), or for
    launch_token on the stored project (`name`, `description`, `repo_url`, `live_url`,
    `demo_url`, with launch_token's link fixes applied) and the entry's latest `submissions` row.
    With a required item missing, nothing is proposed, checked or deployed: `skipped` at
    submission, `failed` on launch_token, note "Not launched: the entry still needs <to-do>; …"
    (`notReadyTokenNote`, the C5 to-dos), `needs` (the list, which record_submission's reply
    shows: "Your token isn't launched yet: the entry still needs …"), and an `agent_note` naming
    the keys (record the entry again with every answer, or launch_token with `live_url`/`repo_url`).
    The builder's valid name and ticker and a wallet given now are kept. No gate for EarnKit
    campaigns (refused at entry by `missingAnswersProblem`), a "skip", policy off, or an entry
    that already has a token.
  - *On Base* (Ruling 17, amended by C19). The row's key is `Token` everywhere. Outside campaigns:
    `Your entry gets a token on Base, $TIPJAR: you earn 40% of its trading fees, and it joins the
    builder bonus · say skip for no token (and no builder bonus)` (without a bonus: `… trading
    fees · say skip for no token`). The footnote (`tokenFootnote`, `COIN_FOOTNOTE`) says fees are paid in WETH and
    tokens.fun pays gas.
  - *No Clanker* (Ruling 18). No builder text, agent text (tool descriptions,
    `SERVER_INSTRUCTIONS`, notes) or web page names Clanker; `/policy` and the docs say "The
    launch protocol keeps 20% of trading fees" (`CLANKER_CUT_PCT`). Code comments, identifiers,
    contract tables and logs keep the name. `copy-review.test.ts` scans for it.
- **Coin → token (v2.7 §4, Ruling 19).** Human-facing text says "token", never "coin" (builder and
  agent text, web pages including admin, `/policy`, alerts, `STATS_LABELS.coins_launched` =
  "tokens launched"). Identifiers keep their names (`coin_address`, `coins_launched`, `coinRow`,
  JSON keys), as do URLs (`tokens.fun/coin/0x…`), words that only contain "coin" (stablecoin,
  Coinbase), code comments, logs, SQL, test names, and the decorative `CoinsField` / `coin-float`.
  `copy-review.test.ts` (`coinWords`, renamed from `copy-v26.test.ts`) scans every builder, agent
  and page string for it.
- **No em dash (v2.8 Rulings 16, 17).** No string literal, template literal part or JSX text in
  non-test `.ts`/`.tsx`/`.mts` under `apps/frontend/{app,lib,scripts}`, and no line of `llms.txt`,
  `programs/*.json`, `programs/README.md` or the READMEs, contains an em dash. `human-text.ts`
  (`humanStrings`, a TypeScript AST walk that never sees comments; `humanTextFiles`) feeds
  `human-text.test.ts`, which lists every hit as `path:line`. Empty table cells are
  `present.ts NO_CELL` (`''`), never a dash. Comments and `docs/` are not scanned.
- **Builder bonus pill (v2.8 Ruling 19).** One component, `app/components/ui/BonusPill.tsx`: navy
  fill, 1px orange gradient border, spark mark, orange gradient text, `Builder bonus` or
  `Builder bonus · 0.42 ETH` (never `0 ETH`), sizes sm/md/lg (h-7/h-9/h-11), a link with `href`.
  Data carries only `has_bonus` and `bonus_amount` (`landing.ts bonusAmount`), never pill text.
- **Coin gate (v2.6 §3; `token-gate.ts`, `ownership.ts`, `match-projects.ts`).** A launched coin is
  never re-gated (`runTokenFlow` stops at the existing token first), so no v2.5 coin is affected.
  - *The line* (Ruling 1 (plan)). `token: <code>`, where `code` is the first 16 hex characters of
    `HMAC-SHA256(EARNKIT_AUTH_SECRET, "token-line:v2:<installation>:<normalized repo>")`
    (`tokenCode`/`tokenLineFor(installationId, repoUrl)`, compared timing-safely). It is
    ticker-free: a new ticker needs no new line. The v2.3–v2.5 line `token: <SYMBOL> <code10>`
    (`legacyTokenLineCode`) is still accepted for the ticker being launched, so a builder who pushed
    it before the deploy can still launch; 16 hex characters never parse as a v2.5 symbol (at most
    10), so the two forms can't collide. No secret: the gate refuses ("Token launches aren't
    configured right now."). The line is shown only to the launching agent (prepare_submission's
    token note, the gate_failed `agent_note`), and the agent writes and pushes it itself; the builder
    never edits files. `earnkit.txt` no longer needs a wallet line for a coin (wallet lines stay
    campaign business, `checkOwnership`).
  - *Reading the file* (Ruling 14 (plan), Ruling 20). Through GitHub's contents API with
    `GITHUB_TOKEN` (`ownership.ts` `fetchOwnershipViaApi`, `Accept: application/vnd.github.raw`,
    5 s, 4 KB, no redirects), so a fresh push is seen at once (no raw-CDN cache). The raw URL is
    read only when the API is rate-limited: 429, a 403 with `x-ratelimit-remaining: 0`, or a
    secondary limit (403 with `retry-after`, or a "secondary rate limit"/"abuse" body). An API 404
    is "missing" (no raw read); a redirect, another status or a network failure is a retryable
    error. The token and the `Authorization` header are never logged. With
    `EARNKIT_OWNERSHIP_BASE_URL` set (dev/test only), the override is read instead.
  - *Other branches* (v2.8.1 §A3). When the default branch's file doesn't prove the launch, the
    most recently pushed other branch is read: one GitHub API call (`/repos/<o>/<r>/activity?
    activity_type=push&per_page=10`, newest first; GitHub's branch list has no push dates), then
    `earnkit.txt` at that push's commit from raw.githubusercontent.com (commit-addressed: no cache
    delay, no API quota) (`ownership.ts fetchOwnershipLatestBranch`). A push to any branch needs the
    same access, so it proves the same thing. Not with the dev/test override, or with an injected
    reader (a test double). When neither proves it, the builder hears "I need to add a short proof
    line to your repo's <default> branch first, then say go." (the default branch from the repo
    read, `RepoCode.defaultBranch`, shown only when plain), and the agent note says what was found
    where ("earnkit.txt isn't on the default branch (main); … on the most recently pushed branch
    (feat/x) has a token line, but not this agent's code …") and where to push. A second "go" with
    the line still missing returns the kit with "Your entry is saved. Your token is waiting on a
    short proof line on your repo's main branch; say go once I've pushed it." (`proofLineWaiting`;
    never "open this in Claude Code or Cursor", which stays only for an agent that said
    `can_push: false`); the launch stays open.
  - *Repo with code* (Ruling 3 (plan); `match-projects.ts` `repoCodeFacts`, `codeProblem`). A coin
    needs a public GitHub repo (a private one EarnKit's token can see is refused as "not public")
    that has at least one commit (`/commits?per_page=1`; 409 = empty) and is either not a fork or
    a fork whose default branch is ahead of its parent (`/repos/<parent>/compare/<base>...<owner>:
    <branch>`, `ahead_by > 0`; a failed compare is `ForkCheckError`, "try again"). Commits are not
    checked by author (org-owned repos have no owner author): push access is what the line proves.
  - *No live-link gate.* The live link is a traction signal only; it never blocks a coin.
  - *Cost* (Ruling P2). The spec's "at most one call per launch" is the ownership-file fetch: one
    contents-API read (the raw read only under a rate limit). The repo and commits reads existed
    before v2.6; the compare is new and runs for forks only. All on the one existing `GITHUB_TOKEN`.
- **Launch claims, retries and timeouts (v2.8.1 §A).** `deployToken` claims the row
  (`token_url = 'pending'`, `token_claimed_at = now()`), then POSTs. `outcomeOf` decides:
  - **Released** only when tokens.fun said in a parsed JSON body, with no `txHash` and no
    `tokenAddress`, that it stopped before minting: any 4xx (refusals; a 429 says "Try again after
    HH:MM UTC" from tokens.fun's `retry_after` ISO time or seconds, `retry_after_seconds`, the older
    `retryAfter`, or the `Retry-After` header, else "in a few hours"; tokens.fun T1 sends
    `retry_after: { at, seconds }`); an explicit `minted: false` (Ruling F3); or a 503 whose `error`
    is exactly one of tokens.fun's pre-mint texts (`knownPreMint503`: "Pending transactions
    detected. …", "Server configuration error", "EarnKit fee split isn't configured", "Server wallet
    configuration incomplete (…)", "Cannot price … right now …"), until F3 covers every 503. A
    revert 500 is released only with `minted: false`.
  - Those 5xx releases are **retried once** (10 s pause after "Pending transactions", else 3 s),
    under the same claim; a second such answer releases the claim with "Your token didn't launch
    yet; say go to try again." (`NOT_LAUNCHED_YET`; confirm_entry turns "say 'launch the token'" into
    "say go"). A release after the tool already replied "launching" is stamped `token_released_at`.
  - **Check-back is a read** (fix round 1). The "launching" agent note says to call the same tool
    again with `check_back: true` (confirm_entry, launch_token, record_submission): it reports the
    row (link, "launching", or the stored note) and never starts a launch. Any call within 2 minutes
    of an unseen release is read the same way; reading it clears `token_released_at`, so the
    builder's next "go" relaunches.
  - **Kept** (never retried): no answer, tokens.fun's 502 "Deployment status unknown", its catch-all
    500 "Internal server error" (thrown anywhere, even after a broadcast), any other 5xx, an unparsed
    body, any body with a tx hash or a token address. The builder reads `LAUNCH_STUCK` ("Your token
    didn't launch yet; EarnKit is checking what happened with tokens.fun. Ask me again later."); the
    agent note says it is never retried.
  - **Reply time.** confirm_entry, launch_token and record_submission give the token flow
    `launchReplyMs()` (40 s; `EARNKIT_LAUNCH_REPLY_MS` overrides) from the tool's start, so the
    reply comes within 50 s. Past it (`withinReply`), the flow runs on in the background and writes
    its own result; the reply is "Your token is launching. Ask me again in a minute for its link."
    (`LAUNCHING`, `launching: true`; confirm_entry returns no kit yet) once the deploy was sent, else
    "still checking your repo" (confirm: fixable, no kit). The next call reads the row: a claim whose
    deploy is still running (no `token_note`, under 10 minutes) is "launching"; one whose deploy
    answered without a result, or older than 10 minutes, is `LAUNCH_STUCK` (with the kit).
  - **Owner alert.** The hourly cron (`runCron`) lists every claim pending for over 10 minutes
    (`tokens.ts stuckLaunches`) as `token-pending:<project id>` in `needs_owner`, so the run answers
    503 and GitHub emails the owner within the hour. Claims from before v2.8.1 got the migration's
    time (schema.sql backfill), so they alert at the first cron run 10+ minutes after the deploy.
    **Go-live step:** settle every existing `token_url = 'pending'` row with the runbook below.
    v4: a builder token (`builder-token.ts`) whose launch answer was unclear (`status = 'unknown'`) or that is
    still `'launching'` after 10 minutes (`stuckBuilderTokens`) is listed the same way, as
    `builder-token:<builder id>` (alerting). Launched builder tokens' creators (`builder_tokens.wallet`) join
    `claimForOthers`' creator claims with no locker read, claimed first (v4.0 final review 2). A launch the proof
    dropped (no row) is retried by the same cron (`retryDroppedBuilderTokens`); one blocked on the owner is
    `builder-token-blocked:<builder id>` (alerting).
  - Ticker checks for a proposal run in parallel batches of 4 (3 s each), so a proposal costs at
    most about 9 s.
- **Runbook: a token stuck in `pending`.** A row with `token_url = 'pending'` means EarnKit sent a
  deploy and never learned the outcome (no answer, a 5xx that may have minted, or an unparsed body);
  EarnKit never retries it on its own, and `launch_token` refuses it (as does any other entry of the
  same repo). v2.8.1: the cron's `needs_owner` names it (`token-pending:<id>`) after 10 minutes.
  1. Find it: `SELECT id, name, repo_url, token_name, token_symbol, token_note, payout_wallet,
     installation_id FROM projects WHERE token_url = 'pending';`
  2. Check tokens.fun for a token with that ticker and creator wallet (the creator's tokens on
     tokens.fun, or a Basescan search of the creator wallet's recent Clanker deploys). The deploy
     logs (`[token]`) carry the time.
  3. If the token exists, record it:
     `UPDATE projects SET token_url = 'https://tokens.fun/coin/<address>', token_status = 'launched',
     token_note = NULL WHERE id = <id> AND token_url = 'pending';`
  4. Only after confirming **no** token exists, release the claim so the builder can retry:
     `UPDATE projects SET token_url = NULL, token_status = 'failed', token_note = 'Released after
     checking tokens.fun: no token was launched. Say ''launch the token'' to retry.' WHERE id = <id>
     AND token_url = 'pending';`
     Never release on a guess: a second launch is public and permanent.
- `prepareSubmission` is pure (no DB) and never invents values. It reports what is filled,
  what is missing, and whether the agent drafts it (`from: project`) or asks the builder
  (`from: builder`).
- OAuth is stateless: client ids and codes are HMAC-signed with `EARNKIT_AUTH_SECRET`; the
  access token is derived from the code, so a replayed code can't create a second installation.
  Rotating the secret invalidates unused codes and client ids, not issued tokens.
- v2.4: one installation per OAuth client. Client ids carry a 128-bit registration nonce, and
  `installations.client_key` = first 32 hex of sha256(client_id) (unique). Re-authorizing a known
  client is free of the install rate limit and replaces the installation's token (the old one
  stops working); entries, wins and memory carry over. Client ids from before v2.4 (no nonce,
  shared by every user of a fixed-redirect app like Cursor) get no key and stay keyed by token.
  Client ids are never shown or logged. `installation_wallets` lists every wallet an
  installation used (entry payout wallets, kept creator wallets); `projects.creator_wallet` keeps
  the creator wallet for launch_token retries and fee reads; `programs.opened_at` is when a
  program last went active. `pnpm db:check` proves db/schema.sql is idempotent on main's rows.
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
  created it was sent by that wallet, or (v2.4) by the wallet that signed the entry (Base,
  Alchemy `alchemyCreationOf`: the first block with code by archive `eth_getCode`, then that block's
  receipt or `trace_block` create, and the transaction's sender; direct and factory/CREATE2 deploys alike), else "Contract <0x…> was deployed by <wallet>, not by the wallet that signed the
  entry (…) or the payout wallet." A `contracts:` line in the
  file is accepted but ignored (listing proves nothing). Errors name the exact file and line to
  add. This makes the first-entry-wins repo and contract dedupe owner-wins: only someone who can
  push to the repo can enter it, and only the deployer's wallet can claim a contract. Copied work:
  repos GitHub reports as forks are refused (`repoFacts`, one GitHub API read, injectable); a live
  link is not unique (unproven, so uniqueness let anyone squat it: T9, re-audit M5) but stored
  normalized (`normalizeLiveUrl` -> `projects.live_key`) and an entry sharing an earlier entry's
  is flagged in status entries (`sponsor.ts` `sameLiveLink`, `live_link_note`: "same live link as
  entry #N"); the repo's GitHub `created_at` /
  `pushed_at` at entry are stored (`projects.repo_created_at/repo_pushed_at`) and shown to the
  sponsor in status entries and the award plan (`repo_label`: "repo created <date>"). A non-fork
  clone with another live link remains a documented risk (spec, Risks). `.wiki` repos are refused.
  `EARNKIT_OWNERSHIP_BASE_URL` replaces raw.githubusercontent.com only when `NODE_ENV` is
  `development` or `test` (the e2e serves files from a local server); refused otherwise. The payout
  wallet requirement is `from: 'builder'` ("ask the builder; never derive it from the code"); a
  successful entry saves it as `installations.payout_wallet`. Next time `prepare_submission` asks
  about it in full, under the confirmation table and in `payout_wallet_note` ("Pay prizes to
  <wallet>? Confirm with the builder."), and never puts it in the answers: a hosted client that
  shares one registration shares this memory (final review I8). **Sanctions** (`sanctions.ts`): Chainalysis's oracle
  (`0x3A91A31cB3dC49b4db9Ce721F50a9D076c8D739B`, `isSanctioned`) over `BASE_RPC_URL`, on Base
  mainnet (chain 8453) only — elsewhere it is skipped with a logged note. For a Base mainnet
  payment the RPC must report chain 8453: in production a mismatched or failing RPC refuses ("Can't
  check this wallet right now; try again shortly."), outside production it is logged and skipped.
  Clean results are cached for 10 minutes. Screened: payout wallets at entry (on the prize chain; Base for EarnKit
  campaigns), the sponsor wallet at create (the escrow chain), and every winner of an award plan
  (`prepareAward`, `campaign fallback propose` and `execute`) and every winner the cron pays (and
  the `campaign payout` dry run, before its print, so it fails too). A listed wallet gets "This wallet can't
  receive prizes on EarnKit." (or "…can't fund campaigns…"); an unreadable oracle fails closed
  ("try again in a minute"). The oracle is injectable (`setSanctionsOracle`) for tests.
  EarnKit campaigns are scored, frozen, reviewed and paid by the cron (see "Money first, nothing
  manual"); `pnpm campaign rank <slug>` prints the ranking with its evidence, and `pnpm campaign
  payout <slug>` is a dry run of whom the cron pays. Scoring reads Blockscout (paced + retried;
  throttling throws, never reads as empty); an ended window is read from its last block back
  (Blockscout's keyset cursor), up to 500 pages of transactions and 100 pages of internal calls
  per contract; a capped read is stored as `projects.score_partial` (payable, flagged in the
  review; named in the sponsor's `scores_note`). Sponsor status rescoring (`refreshScores`) runs
  under a per-campaign lease (`withScoringLock`: a `scoring_leases` row claimed and released by
  single statements, 60 s expiry by default; the cron passes its budget); a concurrent call gets
  the stored scores and "Scoring in progress". No transaction or pool connection is held across
  the network reads. A 20 s deadline is passed into every Blockscout and RPC read of a sponsor
  rescore; RPC requests are aborted at it (`baseRpcUntil`). `projects.scored_through` records the
  window end a score covers. A score is final (`scoreIsFinal`) only when it covers `ends_at` and
  was taken at least 15 minutes after it (explorer lag). A read cut short by the deadline is saved
  only where there is no score yet, as provisional (`scored_through` null), and retried. Rank is
  computed on read (score, then earlier entry); unscored entries have no rank.
- Entry status (`entryStatus`, board and entry page): EarnKit kind: the standing (`winners.ts`
  standingText: "not scored yet", "#3, in the top 5", "#7, 4 users behind #5", then "in review",
  "winner", "removed in review" or "not in top 5");
  sponsor kind "entered" (live), "won <amount>", "not picked" (awarded), "no winners — sponsor
  refunded" (refunded); taken-down campaigns are 404. A sponsor board shows rank and wallets only
  once some entry is scored, and "Your campaign entries" never says "#N of M" for an unscored
  sponsor entry (it joins `sponsor_campaigns.state`). A closed EarnKit campaign with no entries
  (Campaign #1) has no public page.
- **First message, v2.8.1 §B.** `list_programs` never fails on what an agent reports: any chain
  string (unknown chains dropped), dates without a timezone (UTC), bare live links, extra keys;
  an unreadable repo is skipped, and a wallet that isn't 0x is ignored with `wallet_note`. After
  any news, a returning builder sees "Your entries: <program> (<repo>, submitted)" (open, non-
  campaign programs; `openEntries`). A submitted entry marks its program "(entered)", sorts it
  last and is never offered or resumed; one confirmed but not submitted stays offerable. With no
  repo, rows whose program needs one (the program file's required `needs_repo`, checked by
  `programs:check`) say "(needs a repo)". The MCP inputSchema is as lenient as `tools.ts`, so the SDK
  never refuses the call first. The offer is never an
  investment program: a fit for the builder's repo first (Easy first, then the top prize; Ruling
  F5), and "build something new" for the Easy program with the most money only when no repo fits;
  with no repo, the best program known not to need one.
  A no-repo builder who picks a program that needs a repo anyway (Arc, from the table) hears it
  with the coach's questions, before answering: "Arc Microgrants needs a public repo with your
  project's code. No repo yet? Avalanche Team1 Mini Grants doesn't need one: say the word and I'll
  start there." (`tools.ts needsRepoLine`, `present.ts enterableWithoutRepo`; v2.8.1 T7). v2.10
  Ruling H1: the pick (`present.ts noRepoPick`, also the no-repo first-reply offer) needs no repo,
  is never tagged "needs a live product", and goes lowest difficulty first, then top prize; when
  nothing fits the line is left out.
  "$X in prizes you qualify for" leaves out investments and rows that still need new work.
- **Applying, v2.8.1 §C and §F.** The coach's one round also asks for the wallet (`questionsFor`'s
  `wallet`, key `payout_wallet`) when the entry would get a token and no wallet is known (given,
  the entry's own, remembered); it joins the contact item, else is its own item. The answer comes
  back as `answers.payout_wallet`: the offer's wallet line and `shown_wallet` show it, so the
  confirmation is one yes; "go" still launches only to the wallet passed with it (Ruling C12).
  Base's Loom demo and Builder Code are `from: builder`, so they are asked in the first round.
  The bonus note for a repo whose token is in another program is said once, in Also qualifies
  ("Your builder bonus rides on your Arc Microgrants entry.", v2.8.1 §D: naming the program the
  fees book to after rollover, followed by "Your builder bonus moves to your next entry when a
  program ends."), or after "Entered in…" without that
  block; never in the offer, the confirmation or the first message's rows. An investment
  program's kit says where the application goes on (`continuesLine`). Program deadlines show in
  the program's own time zone, from the summary ("Oct 14, 11:59 PM ET"). The proof-link fix
  targets only a proof field. Unexpected tool errors are logged with an id; the agent gets a
  plain message with that id. "40%" appears once per entry flow, in the Yes line; the first
  message, the reply after launch and "Entered in…" don't say it (policy and docs keep it).
- Human-facing dates use one format (`dates.ts` `formatDeadline`, "Oct 6, 2026, 06:51 UTC");
  machine fields (`ends_at`, `deadline`) stay ISO.
- "Fastest" and per-repo ordering in list_programs: quickest first; between equally quick fits,
  the larger known per-winner award (`perWinnerUsd`: a USDC sponsor campaign's prize /
  max(winners, 3), so one big single-winner prize can't buy the top spot, or a program file's
  optional `max_award_usd`; unknown is 0). Sponsor campaigns are never in a repo's list.
- No auth beyond the installation token. Anyone can get one (by design), so the agent count
  can be inflated by someone scripting the sign-in flow.
- **Sponsor campaigns** (v2.1; archived in v2.12, see "v2.12 The verified builder score": the
  `sponsor_campaign` tool, `/fund`, `/award` and the check route moved to
  `archive/sponsor-campaigns/` and are not registered or routed at all, escrow or not; the rest of
  this bullet is how it ran before): the escrow (`contracts/`) is the only place a sponsor's funds
  move; EarnKit's server only reads the chain (`escrow.ts`) and holds no private key at all.
  The `sponsor_campaign` tool was registered only when the escrow is configured
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
  blocks, 300 blocks slack; `readAwardedLog`), recorded against the sponsor's
  plan, else the operator's `fallback_plan`, else off-plan (`mapOffPlanAward`, non-entry wallets
  flagged in `award_onchain`); Refunded → the row is marked `refunded` (only `live` rows are
  checked, so `taken_down` stays). `checkChain` runs from `status` (every state; an RPC failure
  becomes `chain_note`), the `/fund` and `/award` page loads, `POST /api/sponsor/[ref]/check` (no
  body; the pages poll it every 3 s for up to 2 minutes after sending) and `pnpm campaign sync`.
  Chain reads are throttled: a ref is read at most once per 15 s (`chain_checks`, claimed
  atomically so it holds across instances; checks in between reuse the stored result; the CLI
  passes `fresh`), `/check` allows 60 requests per IP per minute and sponsor `status` 60 per
  installation per minute (`rate-limit.ts`), and the
  `Awarded` log search goes newest-first (`scanLogsNewestFirst`), at most 8 `getLogs` calls per
  check, resuming from `chain_checks.award_scan_hi` (status says it's still searching meanwhile).
  Ranges start at 2,000 blocks (Base's public RPC refuses more: HTTP 413 / -32614 "limited to a
  2,000 range"), afresh on every check. `logError`: a 429 or rate wording is a rate limit;
  otherwise range or result-limit wording (or a bare 413) retries with the size the RPC names,
  or half, never below 100; a bare -32005/-32614/-32016 is a rate limit. Rate limits are retried
  after 250 ms, 1 s and 3 s, then the check stops with a `chain_note` and resumes next time.
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
- **Less friction** (v2.2 §6): `create` needs five answers (`sponsor_wallet`, `sponsor_name`,
  `title`, `what_to_build` — `theme` is accepted as its old name — and `amount`); `withDefaults`
  (`sponsor-rules.ts`, pure) fills the rest (chains [base], USDC, 3 winners, ends in 14 days,
  existing work allowed, criteria "<sponsor_name> picks the most useful entries" run through the
  same sanitizer, no sponsor_url) and `createReply` lists the defaults used in `show_to_sponsor`.
  Drafts store `what_to_build` (rows from before keep `theme`; `sponsorProgramFile` reads either).
  `existing_work: allowed` also accepts entry contracts deployed before the start
  (`entryRules` → `validateEntry`'s `allowExisting`); scoring still counts only in-window use;
  `new_work_only` refuses them as before. **Correcting a draft:** `create` with `replaces: <ref>`
  (`createSponsorDraft`): the old row must be the same installation's, unfunded (`draft` or
  `expired`, read fresh from the chain first) and keep the same `sponsor_wallet`
  (`replaceProblem`); everything is validated before any limit is charged (the tool passes a
  `charge` callback: `sponsorCreate` 5/day, or `sponsorReplace` 10/day for a replacement), and the
  old row becomes `replaced` (`replaced_by`) in the transaction that inserts the new one, under
  `FOR UPDATE`. A replaced ref is never published: `findFunding` reports a deposit to it as a
  funding problem with its escrow (`strayEscrow`), `status` points at the new draft, its `/fund`
  page shows "This draft was replaced" with a link to the new `/fund/<ref>` and no button, and
  `pnpm campaign sync` (which sweeps replaced rows like expired ones) prints the
  `refund <ref> --escrow <address>` command.
  `award` takes a ranking (`winners: [entry_id, …]`, best first, `split` "equal" or integer
  percentages summing to 100) or explicit `[{entry_id, amount, reason?}]`; `resolvePicks` turns a
  ranking into exact units with `splitPrize` (each share rounded down, the remainder to first
  place) and fills a missing reason with "Picked by <sponsor_name>", then everything goes through
  `planAward` (duplicates, non-entries, excluded wallets, exact sum) and the sanctions screen as
  before. `pnpm campaign fallback propose --winners <id>,<id> [--split …]` does the same
  (`parseFallbackPicks`, default reason "Top entry (EarnKit fallback)"). The fund page asks the
  wallet for EIP-5792 capabilities (`sendBatched` in `app/components/wallet.ts`): if
  `atomic.status` is `supported` on the chain (or on all chains, `0x0`; never `ready`, which
  would upgrade the sponsor's account via EIP-7702 without saying so), approve (of exactly the
  pool) + createCampaign go in one `wallet_sendCalls` batch (one signature,
  `waitForCallsStatus`; a 4xx status is "not sent", 5xx/6xx "reverted"); otherwise, when the
  wallet doesn't know the method, or when it refuses the batch with a 57xx error, they are sent
  in order. The page lists what the wallet will ask to sign before the button. Either way the page then polls `/check`, which
  finds the deposit by reading the chain. The award page sends its single tx with `sendAll`.
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
  runs on a second skeleton reading ß/ẞ as b, þ as p and ð as o ("Coinßase", "Temþo", "Mðnad"),
  and on one reading digits and `@ $ ! |` as letters ("M0nad", "Ba5e"). A name or title word that
  is a brand followed by a fixed suffix (`BRAND_SUFFIXES`: org, app, hq, dev, labs, pay, chain,
  network, foundation, grants, ventures, usdc, xyz, …) is refused ("CoinbaseVentures", "BaseApp");
  there is no general prefix rule ("Baseline", "Arcade" pass), and other glued forms are an
  accepted residual. "EarnKit" in any form (also inside a word, "EarnKitHQ") is refused in names
  and titles for everyone, verified or not; Canadian Syllabics, Coptic and Old Italic letters are
  refused in names and titles (T9, re-audit H3/F1 and fix round 1). Sponsor
  campaigns, verified or not (verification is free and brand-blind: it changes only the label),
  are never the "Fastest" headline, the closing offer or in a repo's fit list (`present.ts`,
  `Card.sponsored`); they are listed one labeled line each in their own "Sponsored" section after
  curated programs, and the "Since you last checked" line names only curated programs and counts
  new sponsored ones ("2 new sponsored campaigns") (T9, re-audit H4/M6). The track
  record counts a sponsor wallet's funded USDC campaigns of 100 USDC or more (drafts never count,
  since anyone can bind any wallet to a draft); "awarded" is only awards the sponsor made
  (`sponsor_campaigns.award_source`) that paid nothing to the sponsor wallet, with the operator
  fallback, self-paid, off-plan (a direct contract call, T9 re-audit M3) and refunded counts
  shown apart. A pool must be at least 50 USDC
  (`checkDraft`; `SPONSOR_MIN_POOL` lowers it on the local chain only).
- **Third-party text is data** (v2.2 §2): anything a sponsor or builder writes reaches other
  people's agents, so it goes through one sanitizer (`untrusted-text.ts` `cleanText`: after NFKC
  an allowlist — letters, numbers, a fixed punctuation set, dashes, emoji — so invisible, tag,
  bidi and markup characters are dropped; then links in any form and HTML entities are rejected;
  per-field limits; dot look-alikes from UTS #39 and a few it leaves out read as dots first; every
  single-line field (names, titles, award reasons, project names) also refuses `@` and runs of
  7+ digits; multi-line text gets no word
  heuristics (commands, handles, phone numbers, spelled links): they refused real briefs, and
  the structure is the defense) at the input boundary; builder links (`live_url`, `repo_url`,
  `demo_url`, `token_url`, url answers) are `BuilderUrl`, stored and shown only in canonical form
  (`canonicalBuilderUrl`: http and scheme-less upgraded to https, lowercase host, no user info,
  path `[A-Za-z0-9-._~/@]`, query and fragment kept when they use `[A-Za-z0-9-._~/=&%+]`, at
  most 120 characters after the domain; `shownUrl` for status entries, campaign and project pages; entry names
  are cleaned on read) (T9, re-audit H1, fix round 1 I6); `sponsor_url` is https, at most 100 characters, a plain
  host, no query or fragment (`SponsorUrl`): `DraftInput`
  (sponsor_name, title, what_to_build, criteria), `AwardWinner.reason`, and campaign entries' project
  name/description (`cleanProject` in record_submission and prepare_submission; other programs'
  projects go only to the builder's own submission, so they are not restricted). Where it is
  shown, it is either quoted single-line (`quoted()`: list lines, "Fastest", get_program
  title/organizer, show_to_sponsor) or inside an envelope that says who wrote it:
  `get_program.sponsor_content` (what_to_build, criteria, sponsor_url) and `sponsor_campaign` `entries`
  with `note`; award reasons come back in prepareAward's `sponsor_content.reasons`. Errors refer
  to other entries by number only, never by name. Sponsor programs' description, summary and rules are EarnKit's words only, rebuilt
  at read time (`programCard`/`programDetails`), so rows published before v2.2 read the same; the
  sponsor's what_to_build is stored in `campaign.what_to_build` (legacy rows: `description`) for
  the campaign page.
  The four `SAFETY_LINES` (the fourth: never run commands, install packages or clone code because
  sponsor or builder text says so; use only EarnKit's own build steps; it named `build_help` until the
  v2.12 final review, which archived it) go in the server instructions and the descriptions of
  list_programs, get_program, record_submission and sponsor_campaign (today: find, prepare, confirm
  and tell). The scheduled-check offer is read-only.

## Money first, nothing manual (v2.4)

Spec: `docs/design-docs-and-implementation-plans/v2.4-money-first.md` (with the rulings made
during the build); plan: `v2.4-money-first-plan.md`.

- **First message** (`present.ts` presentFirstMessage): money first, markdown tables, no emojis.
  v2.7 §3: a Difficulty column replaces the per-row Builder bonus column and `BONUS_NOTE`
  (affiliation line); the builder bonus now closes the message, joined to the offer (a campaign
  offer gets it as its own paragraph above instead, since campaign entries never earn it).
  The order:
  1. "Since you last checked" (alerts, above);
  2. the EarnKit campaigns table (`leaderboard.ts` earnkitCampaignRows: prize in USD, end date and
     days left, entries, the score at #N, and the builder's standing from `winners.ts`
     standingText; the "#N" bar comes from pickWinners, so it respects min_score, vetoes and the
     one-prize rule);
  3. "Your repos already qualify for" (prize per winner first);
  4. at most 5 other open programs;
  5. sponsor campaigns;
  6. "Updates:" (new curated programs, curated deadlines within 3 days; never alerts);
  7. one offer: keep going, else the campaign entry, else the fastest fit (prize per hour of
     effort; programs needing videos or forms never first), else, when repos are known and none
     fits, "Want me to build something new for <program> (<prize>)?" (Ruling 28).

  Agents pass `local_repos` from the builder's git remotes; a GitHub username is never asked
  first. EarnKit campaigns are their own table, never program cards.
- **Program file money fields:** an EarnKit campaign has `prize_usd_total`, `amount_each` (MINI,
  fixed at go-live, rounded up to 3 significant digits) and `priced_at`.
  - Its reward, summary and rules are generated (`campaign-text.ts` earnkitTexts), and
    `programs:check` refuses hand-written ones.
  - `pnpm campaign golive <slug> --write` prices MINI on DefiLlama (`prices.ts`), sets a 14-day
    window from now and `status: active`, regenerates the texts and prints the MINI to fund
    (winners x amount_each). The owner commits and pushes the file. Campaign #1 stays `closed`
    until then.
- **Entering a campaign** (`projects.ts` campaignEntryProblems):
  - Every problem comes back at once (`EntryError.problems`).
  - Contracts count when deployed from the payout wallet, or from a wallet that signs
    `EarnKit entry: <program id> <repo key> <payout wallet> <contracts>` (EIP-191,
    `deployer_signature`, `entry-proof.ts`; the repo key as normalizeRepoUrl writes it, the
    wallet and contracts lowercase, contracts sorted and joined by ","; Ruling 23). The signature
    binds one entry: it can't be replayed for another campaign, repo, wallet or contract set.
    prepare_submission returns the exact text as `sign_to_enter` once the repo, wallet and 1-5
    contracts are known; a wrong signer's error repeats it.
  - The signer is matched to each contract's creation-transaction sender (factory deploys
    included), and stored in `projects.deployers` (never counted as users).
  - `earnkit.txt` needs only `payout_wallet:` (plus the token line when a token is kept).
  - Failed checks don't use the 20-a-day limit (`charge` runs right before the insert); attempts
    are capped at 60 an hour (`entryChecks`).
  - `prepare_submission`'s `show_to_builder` is the one confirmation (`entry-text.ts`
    confirmTable): the prize row first, then one token row and the terms footnote.
  - The entry reply (`enteredTable`) has the standing, the leaderboard link and the payout date.
- **Scoring v2** (`campaigns.ts` scoreEntry, `campaign-score.ts`):
  - EOA users: senders of successful transactions to the contracts whose nonce at the start block
    was at least 3 (an EIP-7702 delegated EOA counts as an EOA).
  - Smart-account users (Rulings 17, 22): an internal `call` to the contracts counts only when its
    caller is the `sender` of a successful UserOperationEvent in that transaction, logged by a known
    ERC-4337 EntryPoint (v0.6, v0.7, v0.8), and that EntryPoint's `getNonce(sender, 0)` was at
    least 3 at the start block. Accounts a UserOp or a plain transaction fans out to never count,
    nor do pre-staged accounts with no UserOp history. A failed receipt or nonce lookup means "not
    counted" (logged), never a failed entry.
  - Never counted: the payout wallet, deployers, the contracts and the EntryPoints.
  - Internal reads use the same window cursor as transaction reads (100 pages); a capped read
    marks the score partial (Ruling 18).
  - Counted wallets are stored in `entry_wallets` with their kind, plus `code_share` (EarnKit's
    Builder Code share of their direct transactions, ERC-8021, `builder-code.ts`; evidence only).
  - One entry's failure is stored in `score_error` and never stops the others; entries are taken
    oldest attempt first (`score_attempted_at`), so a slow one can't starve the rest (Ruling 19).
  - Scoring needs historic state from `BASE_RPC_URL` (a nonce, code and `getNonce` at the start
    block). The public `https://mainnet.base.org` served it in the 2026-10-04 fork check (about
    30 days back); a provider that only keeps recent state would make every user uncountable.
- **Lifecycle** (`cron.ts`, `payout.ts`, `veto.ts`): `.github/workflows/earnkit-cron.yml` calls
  `POST /api/cron` hourly (`:15`) with `Authorization: Bearer $CRON_SECRET` (30 calls an hour per
  IP, timing-safe; a fixed error text in the response, causes in the server log). Per campaign,
  under its scoring lease and with a 4-minute budget, `campaign_runs.state` moves through:
  - `running`: scores refresh once over 20 h old (1 h in the last day);
  - the freeze, 15 min after the end: final scores (`score_final`). The first unfinished entry of
    each call gets the whole budget, rotating by last attempt; others run only with what is left.
    After 3 failed full-budget attempts (`projects.final_attempts`) an entry is frozen with its
    last score, `score_partial` and a `score_error`, flagged in the review (Ruling 35). Once every
    entry is final the review opens in the same call (Ruling 16);
  - `review`: 48 h, the payout terms frozen in `campaign_runs.terms`, the top N public with their
    evidence on `/campaigns/<id>` (users, smart accounts, wallets shared with other entries,
    Builder Code share, partial reads), and the owner's secret `/admin/veto/<id>?key=…` (from
    `pnpm campaign veto-link`; the key is an HMAC of the slug under `ADMIN_VETO_SECRET`), whose
    form POSTs to `/api/admin/veto` to remove an entry with a public reason (the run row is read
    `FOR SHARE`, so a veto and the switch to paying can't interleave; the page and the POST are
    limited to 30 an hour per IP; a wrong key is a 404);
  - `paying`;
  - `paid` (the cron skips it from then on).

  Which campaigns (M6): every active one, plus a closed one whose run is `running` and whose
  `ends_at` has passed, or whose run is in `review` or `paying`. So closing a campaign after it
  ends never stops its freeze, review or payout. A run row exists only once the cron saw the
  campaign active, so a campaign closed before it ever launched is never picked up.

  The payout (`payCampaign`, `payWinner`):
  - It covers only frozen winners from `pickWinners` under the frozen terms: rank order, ties to
    the earlier entry, one prize per payout wallet and per installation, vetoes and
    sanctions-refused wallets skipped (the next entry moves up). If the program file's terms
    change after the review opened, nothing new is signed (`TERMS_CHANGED` note) and transfers in
    flight are still followed.
  - It pays `amount_each` from the frozen terms, from `CAMPAIGN_PAYOUT_PRIVATE_KEY` (the only key
    on Railway), on Base mainnet only (chain id checked), to the winner's payout wallet only, each
    screened against the sanctions oracle first (fails closed in production).
  - Each transfer is signed and stored (`payout_status = 'sending'`, `prize_tx`, `prize_raw_tx`)
    before it is broadcast, so a rerun rebroadcasts the same bytes (one nonce: mined at most once)
    and never pays twice. Gas: the estimate x 1.5; fee caps: twice the base fee plus the tip.
  - A transfer that reverts is cleared and retried; after 2 reverts its entry is refused and the
    next one moves up, with a note.
  - "Nonce too low" is never cleared in the same run (Rulings 32, 33): the row stays `sending`
    with `payout_stale_at`. A later run (30+ min) clears it automatically only when that is
    provably safe: receipt and transaction both a typed not-found, the finalized nonce past it,
    and that nonce used by another entry's paid transfer from this wallet (EarnKit's own payout
    took it), and the finalized block holds the receipt of that paid transfer. Anything else
    stops with "Payouts paused: a transfer needs a manual check." (only reachable when the payout
    key is used outside EarnKit; runbook below). The public page then says "Payouts paused;
    EarnKit is checking a transfer."
  - While a payout waits on the owner, `POST /api/cron` answers 503 with its usual body
    (`needs_owner` lists the campaigns), so the hourly GitHub Actions run fails and GitHub emails
    the owner every hour until it is resolved (final review I6). That is: a manual check, changed
    terms, the payout key unset, `BASE_RPC_URL` not Base mainnet, a payout wallet short of the prize token or of ETH for gas (`needsOwner`), or a pay
    step that failed 6 runs in a row (`campaign_runs.pay_failures`, reset by any pay step that
    completes; PAY_FAILED_RUNS). Every other run answers 200. The public page still reads
    "Payouts paused; they resume automatically." for a short wallet or a failing check.
  - It stops with a note when the wallet holds less than the next prize or too little ETH for gas;
    the next hourly run after the top-up resumes. The campaign page shows the payout wallet and its live balance
    (`funds.ts` prizeFunds: one read per 60 s shared by all views, 15 s after a failure, 3 s
    timeout, no retries).
  - The winner hears it on their next tool call ("Since you last checked: you won $100 in MINI
    with <entry> (basescan.org/tx/…)").
- **End to end:** `pnpm campaign:e2e` runs the whole lifecycle (first message, signed entry, two
  days of scoring through the real `/api/cron` route, freeze and review, a veto through the real
  `/api/admin/veto` route, the automatic payout from a capped wallet, the winner alert, no double
  pay) on a local Postgres and anvil with a mock MINI, a mock EntryPoint and a mock Blockscout.
  `pnpm campaign:fork-check` pays two winners in real MINI on a Base mainnet anvil fork (the
  sanctions oracle real too) and checks the historic-state reads scoring needs.

### Runbooks (v2.4)

- **"Payouts paused: a transfer needs a manual check."** A transfer is stuck in `sending` and
  EarnKit can't prove its nonce was used by its own payout (someone used the payout key outside
  EarnKit, e.g. a manual send from the same wallet). The cron leaves it alone; nothing else is
  paid until it is resolved.
  1. Find it: `SELECT id, name, payout_wallet, prize_tx, prize_raw_tx, payout_stale_at FROM
     projects WHERE program_id = '<slug>' AND payout_status = 'sending';`
  2. Decode it: `cast decode-transaction <prize_raw_tx>` gives its nonce, recipient and amount.
  3. On basescan, open the payout wallet's transaction with that nonce, and check whether this
     winner's payout wallet received `amount_each` of the prize token from the payout wallet in
     any transaction.
  4. If the winner was **not** paid (the nonce went to some other transaction), clear the row;
     the next hourly run signs a new transfer:
     `UPDATE projects SET payout_status = NULL, prize_tx = NULL, prize_raw_tx = NULL,
     payout_stale_at = NULL WHERE id = <id> AND payout_status = 'sending';`
  5. If the winner **was** paid, record that transaction, and NULL `prize_raw_tx` (the stored
     bytes were never mined; kept, their nonce would later be read as one EarnKit's own payout
     used, which could auto-clear another stuck transfer wrongly):
     `UPDATE projects SET payout_status = 'paid', prize_tx = '<paying tx hash>', prize_raw_tx = NULL,
     prize_paid_at = now(), prize_amount = '<amount_each>', payout_stale_at = NULL
     WHERE id = <id> AND payout_status = 'sending';`
  6. Never clear a row whose `prize_tx` is mined: it is paid; the cron marks it on its next run.
  Then stop using the payout key outside EarnKit.
- **A token stuck in `pending`:** see "Runbook: a token stuck in `pending`" above (token at
  submission); unchanged in v2.4.
- **A veto:** during the 48 h review, run `pnpm campaign veto-link <slug>` (needs
  `ADMIN_VETO_SECRET` in your shell; the link never leaves your machine) and open it. The page
  shows the payout wallet's live balance, any pause note, and the ranked entries with their
  evidence, each with a reason box and a Remove button. Type a short public reason ("wash
  activity", "same users as #12") and press Remove (a form POST; opening the link never removes
  anything): the entry is
  marked `vetoed_at`/`veto_reason`, the next eligible entry moves up, and the reason shows on the
  campaign page. It is refused once the review is over, for a paid entry, or for one already
  removed. To undo a veto before the review ends: `UPDATE projects SET vetoed_at = NULL,
  veto_reason = NULL WHERE id = <id> AND prize_tx IS NULL;`. A review can't be extended from the
  page: to hold the payout, set `UPDATE campaign_runs SET review_until = <later> WHERE program_id =
  '<slug>' AND state = 'review';`.

### Known limitations (v2.4)

- **OAuth client ids can appear in platform HTTP logs.** The authorize step carries `client_id`
  in its query string, so Railway's request logs may hold it. EarnKit never shows or logs client
  ids itself.
- **Takeover risk (Ruling 8).** An installation is keyed by its OAuth client (a 128-bit random
  nonce in every client id). Someone who obtains a victim's client id (e.g. from those logs) and
  can complete authorize with the same redirect URI through the same app could re-point the
  installation to a token they hold. Low probability, accepted.
- **Hosted clients reusing one registration merge users.** A hosted agent service that registers
  once and shares that client id across its users gives them all one installation (shared
  memory, entries, limits and alerts). v2.8.1 §E17 narrows what leaks: such installs are flagged
  `shared_client` (see "Hosted agents and identity" below), so saved answers and contact details
  are only shown as a named yes/no, and the remembered wallet is never suggested. Entries and
  alerts are still shared on a truly shared registration.
- **Naming a wallet shows its public entries** (Ruling 15). `list_programs { wallet }` adds the
  wallet to the installation, and wins and standings of entries paid to it show in that agent's
  alerts. These are public facts (the campaign page shows them), but anyone can name any wallet.
- **Multicall and router users aren't counted.** An EOA that reaches the contracts through
  Multicall, a router, a relayer or a Safe executed by its owner appears only as an internal call
  without a UserOp, so it doesn't count.
- **Smart accounts with non-zero nonce keys aren't counted.** History is `getNonce(sender, 0)`;
  an account that only used other nonce keys before the start reads 0.
- **Shared wallets count for each entry.** A user of several entries counts for each; the review
  shows the overlap for the owner to judge.

## Builder bonus ledger (v2.5 §3, Ruling 5)

- **Wallet.** The payout wallet (`CAMPAIGN_PAYOUT_PRIVATE_KEY`) is also the builder bonus wallet:
  every coin launched through EarnKit from v2.5 on pays it 2000 bps of its fees, in WETH, through
  Clanker's FeeLocker. `projects.coin_address` (set when tokens.fun confirms a launch, in the same
  UPDATE as `token_status = 'launched'`; only a duplicate address (23505) is tolerated, logged and
  left out; Base launches only, Ruling 24: tokens.fun gives other chains the pre-v2.5 split) is how
  a deposit is matched to an entry; pre-v2.5 and non-Base coins keep NULL.
- **Rounds** (`bonus-rounds.ts`): a windowed program is one round per window (`starts_at`
  inclusive, `ends_at` exclusive), keyed `<id>:YYYY-MM-DD` (the window's UTC start day, Ruling 21:
  a re-run cohort with a new start is a new round); a rolling program has UTC-month rounds
  `<id>:YYYY-MM`. A windowed program needs `starts_at` for a round (M4; v2.6 Ruling 8 (plan):
  `program-file.ts` refuses a windowed program without `starts_at` unless it opted out with
  `builder_bonus: false` or is a campaign). An `open` round's stored window follows
  the program file until it freezes: `programs:sync` (`upsertProgram`) and every booking
  (`bookDeposit`) move it to the file's dates, so an extended `ends_at` keeps scoring, eligibility
  and deposits in the round; a frozen round never moves. **Booking rule (v2.6 §4):** a deposit goes
  to the round open at its block time unless the program opted out (`builder_bonus: false`), is a
  campaign, or isn't active (`bonusOn`, Ruling 7 (plan)); deposits booked to the Safe under v2.5's
  no-pattern rule stay there (Ruling 2 (plan)). Otherwise it goes to the Safe: no coin, not an
  EarnKit coin, no open round, or a round no longer `'open'` in `bonus_rounds` (`bookingFor`; the
  Safe reason is logged). `bonusOn(p)` = `status === 'active' && builder_bonus !== false &&
  campaign == null`; its SQL twin is `g.status = 'active' AND g.builder_bonus AND g.campaign IS
  NULL`. It is the one rule for booking, list_programs, the coin row, the board, stats and the
  cron; `submission_proof` now decides only *how* a submission is checked, never *whether* a
  program has a bonus. `programs.builder_bonus` (default true) comes from the program file. With
  no retroactive rebooking, a program that had no pattern gets its current round row from its
  first deposit after the v2.6 deploy, and its pool counts from there. `roundPoolsWei` (list_programs) is one grouped query, open
  rounds only; a program whose current round exists but froze maps to null, and its builder bonus
  cell reads "—".
- **Rollover (v2.8.1 §D, option B).** Once a coin's program is over at the deposit's block time
  (`rollsOver`: it has the builder bonus, the deposit is not before its start, and its `ends_at`
  passed or it closed; or its round froze), `bookDeposit` books the deposit to the earliest
  still-open round (`rolloverRounds`: by end, then start, then key) of another builder-bonus
  program in which the same repo (`token_repo_key` = `bonus_repo_key`) has an entry submitted
  (`submission_proof_ok_at`) and complete (`complete_at`) by the block time, never skipped, not a
  test installation (`rolloverPrograms`). A frozen, paid or otherwise not-open round is passed
  over and never touched; none left means the Safe, logged ("no open entry of its repo to roll
  over to"). A deposit already in `bonus_ledger` is returned as booked, never moved, so
  re-indexing is idempotent. That entry has no coin of its own (one token per repo), so
  `eligibleSql(endsAt, roundKey)` counts the carried token (`coinSql`: the repo's token, launched
  before the round end, not an owner test installation's) only in a round that actually received
  a rolled deposit of that coin in `bonus_ledger` (T5 fix round 1: one token competes in one round
  at a time, Ruling F6, whatever its home program does later); a null round key counts own tokens
  only. Scoring reads the carried token's signals (`scoredCoinSql`). **F7:** a rolling (monthly)
  home program never ends by date, so its token keeps funding its own next month; rollover only
  when the home program's window ends or it closes. The Also qualifies note names the program the fees book to now
  (`bonusEntryProgram`; null, the Safe, drops the note) and adds "Your builder bonus moves to your
  next entry when a program ends." (`BONUS_MOVES`) once, right after it. Ruling F6: every
  builder-facing bonus note names that program the same way (`currentBonusRound`, the booking
  rule): the "rides on" note after "Entered in…" and the token note (`tools.ts bonusNoteTitle`;
  fees bound for the Safe read "This repo already has a token."), and the entry-time note
  (`recordSubmission`, read after the entry commits so the three agree; no "rides on" line when
  another entry already holds the repo in that program). The entry-time "earlier entry holds this
  repo" and contract checks count the carried token too (`coinSql` with the round open now). The
  near-end collect (`collectNearEnd`) runs for the round a coin's fees book to now
  (`currentBonusRound`, also when the home round froze), including a round it rolled into; coins
  are prefiltered in SQL to those whose own program's round, or a program where the repo has a
  submitted, complete entry, ends within 24 h, newest first (index `projects_bonus_repo_key_any`).
- **Rollover edge cases (Ruling F6, accepted).** (a) Booking needs the target entry proven and
  complete at the deposit's block time; eligibility then needs that round to hold a rolled deposit
  of the coin (before any deposit, the next entry is not yet eligible). (b) A home round that froze
  inside its window (the file extended it after the freeze) rolls deposits over too. (c) "Submitted" is `submission_proof_ok_at` (`submitted_at` is always set): a
  deposit that lands before the next entry's proof check goes to the Safe for good.
- **Hourly cron step** (`bonus-ledger.ts` `runBonusLedger`, after the campaigns, under the
  `bonus-ledger` lease). `CAMPAIGN_PAYOUT_PRIVATE_KEY` is 64 hex characters with or without `0x`
  (Ruling 7; an error about it names the key's length and shape only, never its value). Skipped without a usable key (missing, or malformed: `skipped` plus
  `problem: 'malformed'`, the key never logged) or off Base mainnet; the cron then answers 503
  whenever the bonus can earn (Rulings 19, 20; see the runbook).
  1. *Index.* `getLogs` of FeeLocker `StoreTokens` with `feeOwner` = bonus wallet and `token` =
     WETH (indexed topics), from `bonus_cursor` up to 30 blocks behind the head, in adaptive
     ranges (escrow.ts `logError` rules), 50 calls per run at most. Each deposit's coin is the
     `ClaimedRewards(token)` of the locker that sent it (`StoreTokens.sender`) that comes **next**
     in the same receipt. This is tokens.fun's onchain-verified order (deposits, then
     `FeesSwapped`, then `ClaimedRewards`). `bonus_ledger` is idempotent on `(tx_hash,
     log_index)`; the cursor moves only after a range is fully booked. At most 200 receipt reads per
     run (`RECEIPTS_PER_RUN`): the cursor stays where it got to, and booked transactions are
     skipped next run. Every Safe booking is logged with its reason. An index step failing 6 runs
     in a row (`bonus_cursor.index_failures`) adds `bonus-ledger` to `needs_owner` (503).
  1b. *Stored sends first.* Before any claim or collect is signed, every open stored send of the
     payout wallet (a sweep or a campaign payout in `'sending'`) is broadcast again. If that fails,
     nothing new is signed this run, and a new signature never takes a nonce at or below an open
     stored one (`openStoredSends`). I5: one nonce floor per run (`BonusDeps.nonces`, seeded once
     from `openStoredSends`) is shared by every claim, collect, round payout and the sweep; each
     signature the node accepts raises it, so the next never relies on the RPC's `pending` count.
  2. *Collect.* tokens.fun's cron collects every coin; EarnKit sends `collectRewards(coin)` itself
     only for an EarnKit coin in its round's last 24 h with no deposit seen, and no EarnKit collect,
     in 12 h, only if Blockscout lists a transfer of the coin in the last 24 h (an explorer error
     counts as traded), through the first locker that simulates cleanly, and only if the coin's
     `rewardRecipients` include the bonus wallet. Only a revert means "this locker doesn't hold
     the coin" (`isRevert`); an RPC error makes that coin `failed` and unstamped, retried next run.
  3. *Claim.* `claimFees`: EarnKit's own claims, `claim(bonus wallet, WETH)` then `claim(Safe,
     WETH)`, when `availableFees` is at least 10x the estimated gas cost (`worthIt`). The bonus
     wallet's claim also goes when the sweep waits on it (M10: the unswept Safe bookings are worth
     10x gas and the wallet can't send them without leaving a round short). No recipient read runs
     before them (v2.9 fix round 1).
  4. *Sweep.* Safe-booked, unswept WETH goes from the bonus wallet to the Safe when it is at
     least 10x the gas, the wallet holds it, and it never leaves a round short: `wallet − amount ≥
     Σ(round bookings of rounds not 'paid' or 'empty') − Σ(their winners already paid) −
     max(0, availableFees(bonus wallet) − Σ(unswept Safe
     bookings))` (FeeLocker WETH that may be the Safe's own unclaimed deposits never counts for the
     rounds). Nothing is reserved after the deadline. The rows are reserved for one `bonus_sweeps` row
     (at most one unfinished), and v2.4's `payWinner` pays it through `sweepStore`: signed and
     stored before broadcast, the same bytes resent after a crash, `MANUAL_CHECK` when it can't
     be proven dead. Paid, every reserved row gets `swept_tx`. A `MANUAL_CHECK` sweep adds
     `bonus-ledger` to the cron's `needs_owner` (503).
  5. *Creator and MINI claims (v2.9 D16, Task 9; fix round 1).* `claimForOthers`, step
     `claim_others`, runs last, after the rounds and the sweep, and only when no stored send waits.
     It has its own slice of the run: at most `OTHERS_CLAIM_MS` (20 s, `BonusDeps.othersMs`), so a
     slow RPC or many creators never takes time from the builder bonus payouts or the sweep. It
     claims `claim(owner, WETH)` for MINI (slot 2) first, then every launched EarnKit token's
     creator (slot 1; test installations' too), newest tokens first, each address once
     (`claimOwners`: an owner that is also the bonus wallet or the Safe is left to `claimFees`),
     each at 10x gas. Owners the slice doesn't reach read `next run`. The FeeLocker always pays the
     owner, so EarnKit never holds a creator's or MINI's WETH. Recipients come from `feeRecipients`:
     the first locker whose `tokenRewards(coin)` knows the coin (Base's lockers return an empty
     split for an unknown coin, the anvil mocks revert; both pass to the next locker), read by slot
     only when its bps are EarnKit's split (`EARNKIT_SPLIT_BPS` = [3000, 4000, 1000, 2000], kept
     equal to `FEE_SPLIT_BPS` by a test), cached on `projects.fee_recipients` (a failed cache write
     keeps the read), at most `RECIPIENT_READS_PER_RUN` (20) reads a run, newest first. A failed
     read (an RPC error, no locker, another split) caches nothing, claims no creator, and MINI falls
     back to `MINI_FEE_RECIPIENT` (policy.ts, Ruling 17, confirmed read-only on Base); one log line
     per run names the unread tokens. A MINI address read from a locker wins over the fallback.
  - *Claims log (v2.9 D18).* Every claim that mines successfully (own or others') inserts a
     `fee_claims` row (tx_hash, owner, role, weth = available at the claim, gas_wei = estimate x
     maxFeePerGas; the signed limit is 1.5x the estimate). It is an ops log only: no revenue figure
     and no public stat reads it (`fees_to_safe_eth` is unchanged; buyback is not revenue).
  - *Gas check (v2.9 D17, Task 9).* Before any step, `runBonusLedger` reads the payout wallet's
     ETH (`BonusRpc.ethBalance`). Under `gasMinWei()` (`GAS_WALLET_MIN_WEI`, default
     `GAS_WALLET_MIN_WEI_DEFAULT` = 0.002 ETH; a malformed value is the default, logged once
     without the value) the output has `gas: { balance_wei, low: true, note: GAS_LOW(address) }`
     (ends with `TOP_UP`). A failed read is `gas: { low: false, note: 'unread' }` and never blocks
     the run. The cron's `bonusWaitsOnOwner` adds `bonus-ledger` to `needs_owner` (503, the
     GitHub Actions email) once when the gas is low, when a claim or collect result contains
     `NEEDS_GAS` ("the payout wallet needs ETH for gas", also in `claim_others`), when the sweep's note does (its gas-out
     note now ends with `TOP_UP`), or after `INDEX_FAILED_RUNS` failed index steps. No new service.
- **Round lifecycle and WETH payouts (Task 7, `bonus-payout.ts`).** The cron scores every run
  (`scoreOpenRounds`, at most half the run's budget, under the `bonus-scoring` lease), then the
  ledger runs `advanceRounds` under its own lease, after the claims and before the sweep. For each
  ended round not yet `paid`/`empty`, oldest end first:
  1. *Freeze* (`open`): only when `readyToFreeze` is ready (the index read past `ends_at`; every
     eligible entry has a final read; 24 h after the end, failed sources stop holding it and are
     `flagged`, and (Ruling 23) an eligible entry with no final read at all is ranked last with
     score 0, flag `no_final_read`, also `flagged`: a round never waits forever). Under the round row's lock (bookDeposit takes it too): the pool = Σ round
     bookings; the final ranking (`finalRanking`, eligible at the end, re-ranked) is stored in
     `bonus_payouts` (rank, score, `creator_wallet` as `wallet` per Ruling 14, installation,
     `flags`: review flags plus `failed:<group>`); `terms` = `{token WETH, pool_wei, amounts, flagged}`
     with `amounts = splitPool(pool, payable)`, payable = entries with a wallet, one per wallet and
     per installation, at most 10 (renormalized). No payable entry: the round's bookings move to
     the Safe (`destination = 'safe'`, `round_key` kept) and it is `empty` (terminal).
  2. *Review* (48 h): `/admin/bonus/<round>?key=…` (key = HMAC of `bonus:<round>`, from `pnpm
     campaign bonus-link <round>`): rank, project, score, signals, flags, the place and frozen
     amount each entry takes (`placesFor`), and Remove buttons that POST `round, key, entry, reason`
     to `/api/admin/veto` (`vetoBonusEntry` inserts into `bonus_vetoes(round_key, project_id,
     reason, at)` only during the review, the round row read `FOR SHARE`). A veto moves the next
     entry up into the same amounts: the split is made once, at review open. Stored live/repo
     links show only through `shownUrl` (https-only canonical; else no link). A round with flagged
     entries is in `needs_owner` (503) once (Ruling 18: `bonus_rounds.flagged_notified_at`, set in
     that run); the page keeps showing the flags. Freeze-side failures are counted
     (`freeze_failures`); 6 in a row → 503.
  3. *Pay* (`paying`): if the wallet holds less than the round still owes (places not paid), it
     claims `claim(bonus wallet, WETH)` first, when that covers what is owed or is worth 10x its
     gas; still short, nothing new is signed (transfers in
     flight are still followed) and the note ends with `TOP_UP` (503). A claim not mined yet is
     not a short wallet (M3): the note is `CLAIM_PENDING`, no 503, retried next run. A follow-only
     pass that follows the last transfer to paid marks the round paid in the same run (M14). Then `payRanked` (payout.ts;
     `payCampaign` is now a wrapper over it) pays one WETH transfer per place to the next best
     payable entry: sanctions screen (a listed wallet is `refused`, the next moves up), signed and
     stored with its place and amount before broadcast (`bonusPayoutStore`), stale/manual rules,
     two reverts refuse the entry, never a nonce at or below another stored send
     (`openStoredSends`, which now includes `bonus_payouts`; payCampaign gets the same floor).
     A pay step that throws sets `PAY_FAILED`; 6 in a row → 503.
  4. *Paid*: what no entry took (vetoes or refusals left a place empty) is booked to the Safe as a
     ledger row `round-rest:<round>` and swept; the round is `paid`. Deposits after the end were
     never the round's (bookDeposit books them to the Safe), so the frozen amounts never change.
  If `settleStoredSends` failed this run, the rounds step only follows transfers in flight (no
  claim, nothing new signed). `needs_owner` entries are `bonus:<round key>` (also, once per
  round, an ended round whose final scoring throws: `bonus_rounds.score_error_notified_at`,
  Ruling 23); when the ledger is skipped (payout key missing or malformed, or off Base mainnet)
  while the bonus can earn (`bonusLive`: an active non-campaign program with the bonus on (v2.6
  Ruling 17 (plan): so any active curated program), an EarnKit coin, or an ended unpaid round; a
  failed check counts as yes), the cron adds `bonus-rounds: payout wallet not configured`
  (Rulings 19, 20). Since v2.6 a missing or malformed payout key is a 503 whenever a program is
  active.
- **Runbook: a stuck bonus payout (`MANUAL_CHECK` on a round).** As a stuck campaign payout, on
  `bonus_payouts` (`tx_hash`, `raw_tx`, `stale_at`, `slot`, `amount_wei`). Not paid: `UPDATE
  bonus_payouts SET status = NULL, tx_hash = NULL, raw_tx = NULL, stale_at = NULL, slot = NULL,
  amount_wei = NULL WHERE id = <id>`. Paid by another tx: `status = 'paid', paid_at = now(),
  tx_hash = '<hash>', raw_tx = NULL` (keep `slot`/`amount_wei`).
- **Runbook: a stuck bonus sweep (`MANUAL_CHECK`).** Same steps as a stuck payout, on
  `bonus_sweeps` (`tx_hash`, `raw_tx`, `stale_at`). Not paid: `UPDATE bonus_sweeps SET status =
  NULL, tx_hash = NULL, raw_tx = NULL, stale_at = NULL WHERE id = <id>` (re-signed for the same
  reserved rows). Paid by another tx: set `status = 'paid'`, `tx_hash = '<hash>'`, `raw_tx = NULL`,
  then `UPDATE bonus_ledger SET swept_tx = '<hash>' WHERE sweep_id = <id>`.
- **Tests:** `bonus-rounds.test.ts`, `bonus-ledger.test.ts`, `bonus-payout.test.ts` (pure, plus
  DB against a fake chain), and `bonus-ledger.anvil.test.ts` / `bonus-payout.anvil.test.ts` (real
  logs and WETH transfers on anvil with `contracts/test/mocks/BonusMocks.sol`; needs
  `BONUS_ANVIL_URL` = an anvil started with `--chain-id 8453`). The bonus test files hold one
  Postgres advisory lock (`fixtures/bonus-db-lock.ts`) because the ledger's tables are singletons;
  `advanceRounds` takes `only` so a test never touches rounds other files create.
- **End to end (Task 10):** `bonus-lifecycle.anvil.test.ts` runs the whole lifecycle with real code
  from `record_submission` to the WETH transfer, through `cronPost` (so the HTTP status is checked
  too). Only the outside world is mocked: anvil with the BonusMocks contracts (two LP lockers; the
  coins sit on the second), one local HTTP server for tokens.fun, raw GitHub and Blockscout, and the
  GitHub API, live probe, proof pages and sanctions screen injected. Story: two coins and one
  entry without a coin; one proof passes on the daily re-check; fees over two days (tokens.fun's
  batch collect, then EarnKit's own near-end collect); scoring with no onchain users; freeze; a
  veto; the payout split; a post-end deposit swept to the Safe; the winner alert; a re-run that
  signs nothing. v2.6 (Task 8) adds to the same story: one Arc entry whose proof page answers 405
  with the builder's confirmation (`unverified_page`: eligible, flagged `unverified_page` in
  `bonus_payouts.flags`, never in `terms.flagged`, no 503); then, on the same chain and cron
  helper, `e2e-confirm` (rolling, `submission_proof: null`, bonus defaulted on): a confirmed entry
  (`builder_submitted: true`, a ticker-free `earnkit.txt`) whose deposit books to
  `e2e-confirm:<YYYY-MM>` and is paid the whole pool in one WETH transfer after the month ends,
  the review and the payout (`needs_owner` empty); an unconfirmed entry never ranked; a test
  installation (`EARNKIT_TEST_INSTALLATIONS`) shown as "Test entry: not ranked", never scored or
  paid, and out of `/api/stats`; a late confirmation that updates the same entry (Ruling 23, no
  second coin); the winner's `list_programs` opening with the paid line and its leaderboard link;
  a re-run that signs nothing. Its round is keyed by the deposit's block time, so it holds on any
  day of the month. It skips without `BONUS_ANVIL_URL` and `DATABASE_URL`, or when either isn't
  local. Note: a round's row is made by its first booking (the index step, which runs after
  scoring), so a new round is first scored on the run after its first deposit.
- **Fork check (Task 10):** `pnpm bonus:fork-check` reads a real Clanker v4 collect receipt on Base
  and checks `bonusDeposits` against it: each deposit's coin is cross-checked with the locker's
  `tokenRewards` and the `ClaimedRewards` rewards, and `storeLogs`' indexed-topic filter returns the
  same logs. It then simulates `collectRewards(coin)` on both real LP lockers and `claim(owner,
  WETH)` on the real FeeLocker with `eth_call`. It never signs anything. It skips without
  `BASE_RPC_URL` or a network (the reachability probe never retries, so that skip is quick). The
  public RPC rate-limits it; use an anvil fork (`anvil --fork-url https://mainnet.base.org
  --chain-id 8453`). `BONUS_FORK_TX` pins the receipt; without it, it looks back in 500-block steps
  (10,000 blocks at most) and, finding nothing, says to set `BONUS_FORK_TX` and skips.
- **Submission proof at entry (Task 5, spec §3 Eligibility):** `submission-proof.ts`'s
  `proofProblem(program, url, repoUrl, liveUrl, deps)` checks a non-campaign program's
  `external_submission_url` at `record_submission` (`projects.ts`): https, on
  `submission_proof.host`, path matching `path_pattern`, then fetched through `safeFetchText` with
  the larger `maxBytes: LARGE_PAGE_MAX_BYTES` (512 KB; `safe-fetch.ts`) and checked for the entry's
  normalized repo link (Ruling 22: required whenever the entry has a repo). Only a repo-less entry
  may match on its live host, and never a shared one (`sharedHost`: the proof host or its
  subdomains, submission platforms, code hosts and social sites, and the bare apex of hosting
  platforms such as vercel.app; a project's own subdomain is fine). The live host matches on host
  boundaries only (`hostLinked`: never inside a longer host such as super-dex.vercel.app). When
  `launch_token` fills a missing repo (`updateLinks`), the entry's proof is cleared
  (`submission_proof_ok_at`, `submission_proof_checked_at`) and the daily re-check must then find
  the repo (N1). A failure never fails the submission: the entry is recorded
  either way, `projects.submission_proof_url` keeps the link, `submission_proof_ok_at` is set only
  on success, and a `bonus_note` tells the agent what to fix. `bonusEligible` (`projects.ts`) is
  never stored, only derived: `coin_address IS NOT NULL AND submission_proof_ok_at IS NOT NULL`
  (ownership was already proven by the token gate to launch the coin), so it can never go stale
  against either column; Tasks 6 and 7 read it this way to rank and pay rounds. **Daily re-check
  (fix round 1, Ruling 11):** the cron's `recheckSubmissionProofs` (also `submission-proof.ts`,
  called from `runCron`) re-runs `proofProblem` for every entry with a `submission_proof_url` and
  no `submission_proof_ok_at`, at most once a day per entry (`submission_proof_checked_at`), while
  its program stays `active` and its bonus round is still open (`roundFor`, bonus-rounds.ts); once
  the round ends (or the program closes), the entry is skipped with no fetch and can never become
  eligible through this path again. M11: that filter is in SQL, with at most `RECHECK_BATCH` (50)
  entries a run, oldest attempt first; a row the guard still skips is stamped. A malformed `liveUrl` (bad stored data) never makes
  `proofProblem` throw (`URL.canParse` guards it); `program-file.ts`'s `submission_proof.path_pattern`
  must be anchored (`^...$`) so it can only match one specific entry path.
- **Submission basis (v2.6 §3, Rulings 4, 5, 9, 15, 23 (plan); `projects.ts` `submissionBasis`,
  `submission-proof.ts` `proofCheck`/`recheckUpdate`).** Every bonus program (`bonusOn`) checks an
  entry's submission; the result is stored in `projects.submission_basis`, and
  `submission_proof_ok_at` stays "counts since" (eligibility is unchanged: coin and
  `submission_proof_ok_at` before the round's end). The three values:
  - `page`: the program has a public entry page (`submission_proof`) and the page links the entry.
    A v2.5 row with `submission_proof_ok_at` set and no basis counted this way.
  - `unverified_page`: the page couldn't be fetched (any fetch failure: network, timeout, any
    non-2xx such as DoraHacks' 405, or an oversize page; Ruling 15) and the builder confirmed the
    submission. It counts and is eligible. At the freeze, `finalRanking` adds the review flag
    `unverified_page` (`traction.ts` `UNVERIFIED_PAGE_FLAG`) to `bonus_payouts.flags` only, never
    to `terms.flagged`, so it never puts a round in `needs_owner` and never makes the cron answer
    503. The review page shows it ("unverified page: the program site blocked EarnKit; the builder
    confirmed it") and links the entry page to check by hand.
  - `confirmed`: the program has no public entry page; the builder's confirmation counts.

  The confirmation is `record_submission`'s optional `builder_submitted` (only `true` counts;
  stored as `projects.submission_confirmed_at`; never derived from `builder_confirmed`, which is
  consent to the coin). Not eligible: a wrong host or path, no repo or live link to match, a page
  that loaded without the entry's link (that also clears the confirmation), or no confirmation on
  a program without a page. A pattern program still needs `external_submission_url`. Pre-v2.6
  entries on programs without a pattern are not back-filled (Ruling 9): the agent calls
  `record_submission` again with `builder_submitted: true`. **Re-recording** (Ruling 23): the same
  installation recording the same project again in the same non-campaign program (same
  normalized repo, or the same name without a repo; `ownEntry`) updates that row instead of
  inserting one, so a late confirmation lands on the entry with the coin (no second coin, no daily
  charge). **Daily re-check** (Ruling 4 (plan), `recheckUpdate`): while the round is open, an
  entry with a page and no count, or an `unverified_page` entry, is re-read at most once a day:
  the page links it → `page` (counting since its first count); the page loads without the link →
  not eligible and the confirmation cleared; still unreachable → no change (a confirmed entry
  that didn't count yet becomes `unverified_page`). An entry counted on `confirmed` alone has no
  page and is never re-read. `/policy` states the rule.
- **Traction score (Task 6, spec §3, Rulings 12-16; `traction.ts`).** Eligible in a round =
  `eligibleSql(ends_at)`: coin launched (`projects.coin_launched_at`, set by tokens.ts) and
  submission proof ok, both before the round's end (Ruling 16: frozen at the end), and no earlier
  entry of its normalized repo in the program that is eligible by the same rule (`projects.bonus_repo_key`; Ruling 15: an ineligible earlier row, a squatter's or the
  builder's own failed attempt, never blocks; a later duplicate of an eligible one is recorded
  with a note, never eligible). A contract backs only the earliest eligible entry of the program
  (`ownContracts`; later entries drop it, noted at entry and logged when scoring).
  `signalsFor(entry, round, deps)` reads seven signals over the round window (start to now, or to
  `ends_at` once ended) in four groups, each failing alone (kept value, retried next run):
  - *users*: v2.4 `scoreEntry` over the entry's verified contracts (`scorableContracts` drops the
    coin and `CLANKER_ADDRESSES`); never the Safe, bonus wallet, payout, creator or deployer
    wallets. External entries get contracts via record_submission's optional `contracts` +
    `payout_wallet` (`projects.ts verifiedBonusContracts`: v2.4 `checkOwnership` per contract,
    signed over the contract list as submitted, and (Ruling 16) a contract counts only when that
    `deployer_signature` recovers to its deployer: naming a public wallet in earnkit.txt is never
    enough; unverified or refused addresses dropped and named in a note with the exact message).
    An entry's recorded `repo_url` never changes (`launch_token` and `updateLinks` refuse: "record
    a new entry for a different repo"; only a missing repo may be filled in, with its
    `bonus_repo_key`), so a repo key can't be squatted and then swapped.
  - *live*: one `safeProbe` per entry per UTC day into `live_checks` (v2.10: an error page is a
    failed day); a failed day is re-probed on
    later runs (`ok = ok OR new`); ratio = ok days / max(7, days since the entry joined).
  - *github* (the authenticated `gh`; 404/409/451 = no activity): each read records commit SHAs
    first seen into `bonus_commits` under that read's day (the round's last day after the end), so
    commit days are never recomputed from forgeable dates; contributors = linked logins 30+ days
    old at that read, cap 10; interest = distinct accounts (star or fork) in the window, 30+ days
    old, not the repo owner or the builder's `github_user`, cap 50. Account ages persist in
    `github_users`. A `GitHubBudget` per run stops GitHub reads when x-ratelimit-remaining < 1000.
  - *coin*: Blockscout holders worth ≥ $1 at `exchange_rate` (no price: 0, list not read),
    excluding the builder's, EarnKit's and Clanker/Uniswap addresses, cap 200; market cap.
  `rankRound` rank-normalizes each signal (rank/n, ties average, 0 stays 0) and scores
  40·users + 20·live + 20·(3·commit days + 1·contributors)/4 + 10·interest + 10·holders; exact ties
  break by market cap, then the earlier entry. Trading volume is never an input. `scoreRound`
  caches each day's signals in `bonus_scores` (one read set per entry per UTC day, at most
  `ENTRIES_PER_RUN` entry reads per run across all rounds, oldest read first; after the end one
  final read with `through = ends_at`). `bonus_scores.review_flags` carries patterns for the review
  page, never scored: `single_commit_streak` = 7+ days in a row with exactly one new commit each. `scoreOpenRounds` scores every open round with one budget and one bonus
  wallet lookup (`resolveBonusWallet`: EARNKIT_BONUS_WALLET, else the payout key). `readyToFreeze`
  = index past `ends_at` (`canFreeze`) and every entry final and clean; 24 h after the end an
  entry whose final read still has failed sources, or has no final read at all (Ruling 23: ranked
  last, score 0), stops holding the freeze and is returned in `flagged` (review page,
  needs_owner). `finalRanking(roundKey)` is the payout's ranking: eligible
  entries only, re-ranked from their final reads (a stored rank is never read as a winner). The
  cron wiring, freeze, review and payout are Task 7's.
- **Submission text and alerts (Task 8).** The coin row (`entry-text.ts` `tokenRow(symbol,
  hasBonus)`) adds `· skip: no builder bonus` instead of the generic `(say "no token" to skip)`
  when the program has a builder bonus (`token-launch.ts` `hasBuilderBonus`; v2.5: `status ===
  'active' && submission_proof != null`, v2.6: `bonusOn`, the same rule `bookingFor` uses); without a bonus the row is
  unchanged from v2.3. `tokenFootnote` now reads "you keep 40% of trading fees (after Clanker's
  20% protocol cut)" — the builder's own share only, never the other v2.5 slots. The coin is never
  advertised past this one row. Ruling 25 (one coin per repo): on a program with a builder bonus,
  a repo whose coin is already entered in a program (`tokens.ts` `repoCoinPrograms`, by
  `token_repo_key`) gets the row "no builder bonus: this repo's coin is entered in <program>" (no
  fee footnote; prepare_submission's `token.repo_coin_program`), record_submission's `bonus_note`
  says the same, and list_programs shows that text in the Builder bonus cell of another program's
  row for that repo (never when the coin is entered in the same program). launch_token on another
  chain, on a program with a builder bonus, adds `NON_BASE_NO_BONUS` to its note (the bonus counts
  Base coins only). **Alerts (`alerts.ts`):** builder bonus wins
  (v2.5 `you won 0.12 ETH builder bonus (<program>)`; v2.6 wording below) join EarnKit prizes and sponsor wins in the
  wins-first block (Ruling 26), same 3-per-check cap and seen-ids memory (`AlertState.bonusWins`,
  by `bonus_payouts.id` (M2): a second round's win of the same entry is news too);
  the builder bonus's own top 10, from `bonus_scores.rank` (`BONUS_TOP_N = 10`, the payout split's
  width; final review M3: only entries `eligibleSql(r.ends_at)` still counts, so a test
  installation's or a no-longer-eligible entry's stale rank never alerts), tracks in/out the same way the campaign top-N does (`AlertState.bonusTop`), as "your
  entry moved into/dropped out of the top 10 for the builder bonus (<program>)". **THE SEAM for
  Task 7:** `paidBonusWins(installationId, db)` is where a round's paid winners reach alerts. It
  checks `information_schema.tables` for a `bonus_payouts` table until it first finds it (M15:
  memoized; a migrated table never goes away), never a failing query —
  this runs inside `sinceYouLastChecked`'s transaction, where an error would abort every other read
  in the same check) and returns `[]` until that table exists. Task 7 ("Round lifecycle and WETH
  payouts") adds it: `bonus_payouts(round_key text, project_id integer, rank integer, amount_wei
  numeric, tx_hash text, paid_at timestamptz)`, one row per paid winner; once it exists,
  `paidBonusWins` starts returning real rows with no change needed in `alerts.ts`. Matched by
  `installation_id` or by `creator_wallet` remembered in `installation_wallets` (a bonus round
  pays `creator_wallet`, Ruling 14 — not `payout_wallet`, which Ruling 13a never sets for external
  entries). Tested with rows injected into a temporary table built to this same contract
  (`alerts.test.ts`), so the query is proven correct ahead of Task 7.
- **Submission text and alerts (v2.6 §3; `entry-text.ts`, `token-launch.ts`, `tools.ts`,
  `alerts.ts`).** Builder text never names a tool (Ruling 22); the agent-facing `note` fields do.
  - *Bonus everywhere.* `hasBuilderBonus` is `bonusOn`, so every curated program's coin row and
    first-message cell show the bonus unless it opted out.
  - *One yes at submission.* Outside campaigns, prepare_submission's block has one coin row
    (`coinRow`: "Your entry gets a coin, $TICKER: you earn 40% of its trading fees, and it enters
    the builder bonus · skip: no coin, no builder bonus"), the wallet line under it (`walletLine`:
    the remembered wallet, in full, once; without one it is the ask) and a one-line footnote
    (`COIN_FOOTNOTE`: WETH after Clanker's cut, gas paid, Terms and Risks). One yes confirms the
    coin and the wallet; the agent passes that wallet as `record_submission`'s `payout_wallet`.
    Campaign entries keep v2.4's `confirmTable`/`tokenRow`/`tokenFootnote`.
  - *Remembered wallet.* The wallet line names it in full with "(used last time)" (final review
    M8: never "yours", since on a shared registration it may not be), and `prepare_submission`
    returns it as `shown_wallet`. Only that echoed wallet reaches the coin (Ruling 30): neither
    `record_submission` nor `launch_token` reads the remembered wallet (see "Token at submission").
    The no-wallet case's `token.note` is plain ("No coin yet: no wallet was given."), with
    `noCoinYet` in `agent_note`.
  - *No wallet* (Ruling 18, Ruling 21, Ruling 22). The entry is recorded and the coin skipped
    (`token.no_wallet`); the builder sees one line, "Reply with a wallet to get your coin and join
    the builder bonus (<pool> · ends <Mon D> · <leaderboard>)"; the agent's note (`noCoinYet`)
    keeps `launch_token` with "by <Mon D>", the round's end label.
  - *Round dates* (Ruling 29). Every builder-facing round end is the day the first message shows:
    `entry-text.ts` `roundEndLabel` (the program summary's "closes Oct 14" for a window ending at
    the program deadline, so Arc's 2026-10-15T03:59Z reads "Oct 14", its real ET deadline; else
    `deadlineDay`: an end at 00:00 UTC is the day before, "Oct 31" for a month ending Nov 1). A
    stored window whose program deadline later moved, at the same clock time, is shifted the way
    the summary's local day differs from the deadline's UTC day (re-review Minor 1).
    `present.ts` `endsOf` uses the same `summaryCloses`/`deadlineDay`. `recordSubmission` returns
    it as `bonus_round.ends_label`; the reply, `noCoinYet` and `/bonus/<round>` (`Board.ends_label`)
    all show it.
  - *The after-submission reply* (`enteredText`, `record_submission`'s `show_to_builder`):
    "Entered in <program>. Your coin: tokens.fun/coin/<address> · you earn 40% of its fees." then
    "Builder bonus: <pool> · ends <Mon D> · earnkit.com/bonus/<slug>" (`bonusCell`, the round's
    last day, `boardLink`). An entry that doesn't count yet gets the one plain step that joins
    instead (Rulings 23, 24): "Tell me once you've submitted on <site>", "Send me your <site> entry
    link" (a public-page program with no link) or "Add your repo link to your <site> entry page".
    No bonus line when the coin was skipped, the program has no open round or bonus, the round
    froze, or the repo's coin is entered elsewhere (Ruling 25). A coin that isn't launched yet
    (the gate failed, or the ticker wasn't confirmed; final review M4) reads "Your coin isn't
    launched yet; it joins the builder bonus once it is (<round>)", or, with a step still to do,
    "<step>. With your coin launched, that joins the builder bonus (<round>)." (re-review Minor 2).
  - *Repo held* (final review M1). When an earlier eligible entry of the same repo holds it in
    this program, or the repo's one coin is on another entry here (`repoCoinPrograms`, not this
    row's own coin), `recordSubmission` returns `repo_held: true` and no `bonus_round`; the reply is
    "Entered in <program>. Another entry of this repo already holds its coin and builder bonus
    here." (`REPO_HELD`), never a wallet ask or a bonus line, and the agent note never asks for a
    launch.
  - *Leaderboard links* (Ruling 12 (plan)): `boardSlug` turns a round key's `:` into `-`
    (`earnkit.com/bonus/arc-microgrants-2026-09-16`, `.../base-builder-grants-2026-10`);
    `/bonus/[round]` accepts the slug and the v2.5 `:` form (`roundKeyFromSlug`,
    `resolveRoundParam`), and the sitemap lists slugs.
  - *Alerts* (Rulings 25, 26, superseding P1's literal wording). Each line is a natural clause, so
    "Since you last checked: a; b." has exactly one colon: "you were paid a 0.12 ETH builder bonus
    (as WETH) for <program>, sent to 0xAB12…ef01 (basescan.org/tx/<hash>) · earnkit.com/bonus/<slug>"
    (the wallet checksummed and shortened; the tx link is the builder's proof of payment), "you
    have $X in coin fees to claim on tokens.fun", and the top-10 in/out lines end with their
    leaderboard link. `copy-review.test.ts` (v2.6's `copy-v26.test.ts`, renamed in v2.7) reviews the joined sentences and every builder string
    (no emojis, no "vault", no implied affiliation, no tool names, no file-edit asks).
  - *Server instructions* (`mcp.ts`): `OWNERSHIP_FOR_TOKEN` (the agent writes and pushes the
    `token: <code>` line itself), `builder_submitted` in `record_submission`'s description (ask
    "Did you submit on <program site>?" first), and `local_repos[].url` (optional; kept only when
    `githubRepo` parses it, Ruling 13). Final review M5/M6: `record_submission` says to show
    `show_to_builder` as written and that `token.note`/`token.agent_note` are for the agent;
    `prepare_submission` describes the Coin row and wallet line (campaigns: one Token row);
    `launch_token` needs `creator_wallet` or the entry's own wallet (Ruling 28) and returns a plain
    `note` plus `agent_note` (Ruling 31); `prepare_submission` and the server instructions tell the
    agent to pass `shown_wallet` back as `payout_wallet` (Ruling 30).

## Ride programs: money flow, owner steps and runbooks (v2.5, v2.6, v2.7)

EarnKit rides programs that already pay builders. It matches a builder to their open money, gives
each entry a coin, and funds a builder bonus per program from the coins' fees. EarnKit runs no
campaign of its own; Campaign #1 stays closed and sponsor campaigns stay dormant.

**Money flow** of one coin launched through EarnKit. Fees are WETH, after Clanker's 20% cut:

| Slot | Share | Paid to | How it moves |
|---|---|---|---|
| 0 platform | 30% | EarnKit Safe | The cron claims it to the Safe. EarnKit's revenue. |
| 1 creator | 40% | The builder's wallet | The builder claims it. |
| 2 MINI buyback | 10% | The buyback wallet | tokens.fun. |
| 3 builder bonus | 20% | The payout wallet | Booked to the program's open round, claimed, paid to the round's top 10. After the round ends, swept to the Safe. |

1. tokens.fun's cron calls `collectRewards(coin)` on the coin's LP locker. The locker stores each
   slot's share in Clanker's FeeLocker (`StoreTokens`).
2. EarnKit's hourly cron indexes the payout wallet's `StoreTokens` and books each deposit to a
   round or to the Safe. In a round's last 24 h, it collects a quiet coin itself.
3. It claims the payout wallet's and the Safe's WETH from the FeeLocker when worth 10x the gas.
4. At a round's end: freeze, a 48 h review, then one WETH transfer per place.
5. Money that is the Safe's (a deposit after the end, an unpaid place) is swept to the Safe.

The payout key is the only key on Railway. Its wallet holds only unpaid round pools, Safe money
waiting for the sweep, and a little ETH for gas.

**Owner steps after merge.** Merge order: tokens.fun first, then EarnKit.

1. Merge the tokens.fun `earnkit-fee-split` change and run its migration
   (`node scripts/run-migration-0023.mjs`: gross-fee views include the builder bonus slot). Set
   `EARNKIT_SAFE=0xc8A889577446153e28D42254B75238Ae31EC7D57` and
   `EARNKIT_BONUS_WALLET=<payout wallet address>` on tokens.fun. The Safe, the bonus wallet and
   `NEXT_PUBLIC_BUYBACK_WALLET` must be three different wallets (else EarnKit launches get a 503);
   an EarnKit creator wallet equal to any of them gets a 400. The 4-way split is Base only.
2. Set `CAMPAIGN_PAYOUT_PRIVATE_KEY` on EarnKit (the dedicated payout wallet; 64 hex characters,
   with or without `0x`) and fund it with about $2 of ETH on Base for gas. WETH comes from fees.
3. Set `CRON_SECRET` on Railway and in GitHub Actions.
4. Merge EarnKit v2.5 the same day as step 1. Coins EarnKit v2.4 launches in between get the
   4-way split but no `coin_address`, so their 20% always goes to the Safe and their entries are
   never eligible. If the merges are days apart, backfill `projects.coin_address` (lowercase) and
   `coin_launched_at` from each such `token_url` (`https://tokens.fun/coin/<address>`, Base only).

Also:
- `EARNKIT_SAFE` must be live on tokens.fun's revenue cron (its fee indexer) before the first
  EarnKit launch. Otherwise the Safe's 30% isn't counted as revenue. Without both variables,
  tokens.fun refuses EarnKit launches (503) before minting. An invalid `EARNKIT_SAFE` on the
  revenue cron fails its run (`earnkitSafeError`) and leaves EarnKit coins uncounted until fixed;
  every other coin still indexes. Its guards (slot 0 moved, deposit from an unknown locker,
  unattributed deposit) watch the Safe like the platform wallets.
- Set `BONUS_INDEX_START_BLOCK` on EarnKit before the first deploy of v2.5, at or before the Base
  block when the tokens.fun change went live (a later block never books or sweeps the WETH paid
  before it). Digits only. It is read only while the index has no cursor, so it is ignored after
  the first run; a non-digit value is logged and the first run reads 2 days back.
- Keep a program file `status: active` until its `ends_at` has passed and one index run has read
  past it (about an hour). Deposits are booked only to an active program's round. Closing it
  early sends in-round deposits that are indexed later to the Safe.

**Owner steps for the v2.6 deploy** (zero friction; spec `v2.6-zero-friction.md`):

1. Confirm `CAMPAIGN_PAYOUT_PRIVATE_KEY` is set on Railway (look at the variable's presence, never
   print its value). With the builder bonus on every program, `bonusLive` is true whenever a
   curated program is active, so a missing or malformed key makes every hourly cron answer 503
   (`bonus-rounds: payout wallet not configured`; Ruling 17 (plan)). Production has had it since
   v2.5.
2. Optional: set `EARNKIT_TEST_INSTALLATIONS` to your own test agent's installation id (see
   "Test the journey (v2.6)" below for how to find it). Comma-separated ids; a malformed part is
   ignored with one warning.
3. Confirm `GITHUB_TOKEN` is set on Railway (presence only, never print it): the coin gate's
   contents-API read of `earnkit.txt` uses it (one read per launch, the raw URL only under a rate
   limit). No new variable is needed.
4. Merge and deploy. `predeploy` (`db:migrate` then `programs:sync`) runs the migration, which is
   additive only: `programs.builder_bonus` (default true), `projects.submission_basis` (NULL, with
   its CHECK) and `projects.submission_confirmed_at` (NULL). Nothing is renamed, dropped or
   rewritten; v2.5 rows keep working (a v2.5 entry with `submission_proof_ok_at` counts as
   `page`). Deposits already booked to the Safe stay there (Ruling 2 (plan)); a program that had
   no pattern (Base, Circle, Monad) gets its round row from its first deposit after the deploy.
   A `token: <SYMBOL> <code>` line pushed before the deploy still launches that ticker.

**Runbook: Test the journey (v2.6).** The whole builder journey on production, with a coin that is
real and permanent, from an agent EarnKit never ranks or pays. Use a **throwaway public repo** and
a wallet you control.

- [ ] **Install.** Open earnkit.com, pick the Claude Code tab on the install page and add EarnKit
  to a coding agent you use only for testing (one agent = one installation; a reused agent's
  memory changes what the first message shows).
- [ ] **First message without GitHub.** In an empty folder (no git remote), ask "anything worth
  building?" and **note the UTC time you sent it**. Expect "$X in top prizes is open right now. I
  can build an entry for you.", a table whose prize column reads "You could win", a Difficulty column,
  "Ideas I can build:" (one per line) and "Pick one and I'll start." closed by the builder bonus
  sentence (v2.7 §3) when a shown program has one. Do this before giving GitHub: a GitHub user or
  repo list, once given, is remembered and turns "You could" off for this installation.
- [ ] **Find the installation id and mark it as a test.** Production EarnKit's database is the
  **Postgres service in the EarnKit project on Railway**. Run the query there: Railway dashboard
  → EarnKit project → Postgres → Data (query), or `railway connect Postgres` from a shell linked to
  the EarnKit project (opens psql). Every `list_programs` stamps the calling installation's
  `programs_checked_at` (`installations.ts` `checkPrograms`), so yours is the row stamped at the
  minute you sent the first message (put that time in both places):
  ```sql
  SELECT id, created_at, programs_checked_at
  FROM installations
  WHERE programs_checked_at BETWEEN timestamptz '2026-10-06 14:05:00+00' - interval '2 minutes'
                                AND timestamptz '2026-10-06 14:05:00+00' + interval '2 minutes'
    AND created_at > now() - interval '1 day'
  ORDER BY programs_checked_at DESC;
  ```
  One row: that `id` is yours. More than one (another new builder in the same minutes): ask the
  agent the same question again, note the new time and run the query with it; yours is the row
  that moved. Set `EARNKIT_TEST_INSTALLATIONS=<id>` on Railway (EarnKit service → Variables;
  append with a comma if it holds other ids) and deploy the change. The list is read on every call, so
  an entry recorded before the redeploy is still excluded once it is set; a frozen round
  re-checks it before paying.
- [ ] **First message with GitHub.** Give your GitHub username (or run it in a folder with your
  repos). Expect "EarnKit matches you to $X in top prizes you qualify for" when a repo fits, or
  "$X in top prizes is open right now." with a "Prize" column (no "could") when none does.
- [ ] **Build.** Pick an idea for **Base Builder Grants or Circle Developer Grants** (rolling, no
  public entry page, so your yes is what counts; Monad Metropolis Hackathon works too while it is open).
  The agent builds it in the throwaway public repo and pushes real commits (an empty repo, or a
  fork with no new commits, gets no coin).
- [ ] **Submit.** The agent shows one block: the entry, one coin row ("Your entry gets a coin,
  $TICKER: … and it enters the builder bonus · skip: no coin, no builder bonus"), the wallet line
  (your wallet in full, or the question) and a one-line footnote. Answer one yes. The agent passes
  that wallet back with the entry; if it doesn't, the reply is "Reply with a wallet to get your
  coin …" and no coin launches (Ruling 30), which is a test failure of the agent, not EarnKit. Don't send a
  throwaway to a real program's form: say yes when asked "Did you submit on <site>?" only for
  this test entry (it is never ranked or paid).
- [ ] **Coin.** The coin launches on tokens.fun. In the repo, `earnkit.txt` holds only
  `token: <16 hex>`, pushed by the agent (you edited nothing).
- [ ] **After-submission reply.** For Base or Circle: "Entered in <program>. Your coin:
  tokens.fun/coin/<address> · you earn 40% of its fees." then "Builder bonus: <pool> · ends
  <Mon D> · earnkit.com/bonus/<slug>", where <Mon D> is the same day as the program's Ends
  column in the first message (for Base or Circle, the month's last day). If you picked a program with a public entry page (Arc
  Microgrants on dorahacks.io, the Crypto World's Fair Hackathon on colosseum.com) and sent no entry link, the second line
  is instead "Send me your <site> entry link to join the builder bonus (<pool> · ends <Mon D> ·
  earnkit.com/bonus/<slug>)." That is expected (Ruling 24), not a failure; the leaderboard link is
  inside it.
- [ ] **Leaderboard.** Open that link: your entry is listed as "Test entry: not ranked" (never a
  rank, score or amount).
- [ ] **Stats.** Proof the coin exists, in the same Railway Postgres:
  `SELECT count(*) FROM projects WHERE installation_id = <id> AND token_status = 'launched';`
  (1). `curl -s https://earnkit.com/api/stats` never counts it in `installs` or `coins_launched`,
  but those numbers can still move between two reads because of other builders, and the read is
  cached 10 minutes, so don't expect a before/after match.
- [ ] **Cleanup.** Keep the id in `EARNKIT_TEST_INSTALLATIONS` for as long as the entry exists
  (removing it makes the entry an ordinary, rankable one). The coin can't be undone; its 40% of
  fees is yours to claim on tokens.fun, and its bonus slot books to the round like any coin's.
  Archive or delete the throwaway repo once the coin is launched (traction never reads a test
  entry). Don't delete database rows. Remove EarnKit from the test agent if you don't keep it for
  the next test.

**Owner steps for the v2.7 deploy** (convert and guide; spec `v2.7-convert-and-guide.md`).
Ruling C1: after the final review, the controller pushes and merges both repos with the owner's go.

1. Merge and deploy `v2.7-convert-and-guide`. The migration only adds columns (six nullable or
   defaulted `programs` columns); `predeploy` runs it, then `programs:sync` loads the backfilled
   program files and their logos. Railway builds before `predeploy`, so this first v2.7 build
   reads the new columns before they exist: expect one `[landing]` error in the build log, and
   `/` and `/programs` served dynamically (still cached 10 minutes) for this deploy. Redeploy once
   after the migration to restore their static ISR (final review M12).
2. Point the weekly re-verification routine's prompt at `programs/README.md` → "Weekly
   re-verification" (Ruling 26). The routine runs outside this repo; no new service.
3. Docs: push `/Users/jenil/earnkit-docs-v27` branch `v2.7-docs`, review the Vercel preview, and
   merge to `main`; Vercel deploys docs.earnkit.com (Ruling 24). Deploy EarnKit first: the docs
   link `earnkit.com/programs`, which 404s until v2.7 is live. Old docs pages
   (`/buyback-and-burn`, `/monetization-sdk`, `/quick-start-guide`, `/sdk-reference`,
   `/engineering-and-design`) redirect (307) to `/`. The docs repo pins pnpm 9.15.9 (`packageManager`); `pnpm build` runs
   pagefind itself and `public/_pagefind` is gitignored, so check search on the preview.
4. Follow "Test the journey (v2.7)" below with a throwaway public repo.

**Runbook: Test the journey (v2.7).** On production, with a throwaway public repo: tokens are real
and permanent. The DB-backed version is `apps/frontend/lib/earnkit/v27-journey.test.ts` (its own
throwaway database, real program files, no network).

1. Open `/` at phone width (390): "$1.1M+ open right now" (v2.9 F21) under "Open programs", the cards swipe
   (arrows at desktop width), and a guide (`/programs/<id>`) opens from a card.
2. Ask "What can I earn?": the tables have a Difficulty column, and the message closes on the
   builder bonus ("Plus the builder bonus: the top 10 on each program also get paid in ETH. …").
3. Submit before going live (no live link): the reply leads with "Before you submit: …" and has
   no Token row.
4. Submit when ready: the Token row reads "Your entry gets a token on Base, $…".

**Runbook: weekly re-verification (v2.7, Ruling 26).** The steps live in `programs/README.md`
("Weekly re-verification"): re-read each active program's sources and refresh `focus` and
`verified_at`; add newly announced winners as the first `past_rounds` entry; re-check `best_bet`;
refresh any live count in a `difficulty_override`; then `pnpm programs:check` and push. Circle
Developer Grants' override ("14 of 850 proposals accepted so far in Cohort 2", from
circle.questbook.app) is a live, moving count: refresh it every week, or remove the override
when it can't be re-confirmed (C14).

**Runbook: a 503 from `/api/cron`.** The GitHub Actions run fails and GitHub emails the owner. The
body's `needs_owner` says what waits:

| `needs_owner` | Meaning | Fix |
|---|---|---|
| `bonus:<round>`, flagged entries | The round froze with entries whose final reads failed. Shown once per round. | Open `pnpm campaign bonus-link <round>`, check the flagged entries, veto if needed. |
| `bonus:<round>`, note ends "Payouts resume once it is topped up." | The payout wallet holds less WETH than the round owes, or too little ETH for gas. (A claim that isn't mined yet is never this: its note says so and the next run continues.) | Send ETH for gas first: the pay step claims the round's WETH itself. Send WETH only if `availableFees` is also short. |
| `bonus:<round>`, "Payouts paused: a transfer needs a manual check." | A payout is stuck in `sending`. | "Runbook: a stuck bonus payout" above. |
| `bonus:<round>`, 6 failed pay or freeze steps | The step throws every run. | Server log `[bonus] round` or `[bonus] freeze`; usually the RPC. |
| `bonus-ledger`, sweep "manual check" | A sweep is stuck. | "Runbook: a stuck bonus sweep" above. |
| `bonus-ledger`, `bonus.index_failures` ≥ 6 | The index failed 6 runs in a row. | Check `BASE_RPC_URL` (`cast block-number`) and the server log `[bonus] index`. The next good run resumes from the cursor; booking is idempotent. |
| `bonus-rounds: payout wallet not configured` | The bonus ledger can't run (`CAMPAIGN_PAYOUT_PRIVATE_KEY` missing, or malformed: `bonus.problem: 'malformed'`; or `BASE_RPC_URL` isn't Base mainnet) while the bonus can earn: an active program has a builder bonus, an EarnKit coin exists, or a round has ended. Nothing is indexed, claimed or paid until fixed. | Set the key: 64 hex characters, with or without `0x`. Check the RPC's chain id is 8453. |
| `bonus:<round>`, entries flagged `no_final_read` | 24 h after the end, an eligible entry still had no final read: it froze ranked last with score 0. Shown once per round. | Check it on the review page; veto or hold if the outage hid real traction. |
| `bonus:<round>`, round scoring failed | An ended round's final scoring threw (server log `[traction] <round>`). Shown once per round; the freeze escape still freezes it 24 h after the end. | Fix the cause (usually the DB or GitHub); the next run retries. |

**Runbook: a stuck collection.** A coin trades but its round's pool doesn't grow. Uncollected fees
sit in the LP position, not in the FeeLocker, so `availableFees` doesn't show them.

1. Find the coin's locker: `cast call <locker> "tokenRewards(address)" <coin>` on each LP locker
   (`0xffa37784…0762`, `0x63d2dfea…3496`); the other one reverts. Its recipients must include the
   payout wallet; if not, the coin was launched before the v2.5 split, or tokens.fun's
   `EARNKIT_BONUS_WALLET` is wrong.
2. Simulate: `cast call --from <payout wallet> <locker> "collectRewards(address)" <coin>`.
3. Anyone may collect. Send it from any funded wallet other than the payout wallet (a manual send
   from the payout key breaks its nonce tracking): `cast send <locker> "collectRewards(address)"
   <coin>`. The next index run books the deposit to the round open at that block's time.
4. EarnKit's own near-end collect waits 12 h after an attempt (`projects.coin_collected_at`). To
   retry sooner: `UPDATE projects SET coin_collected_at = NULL WHERE coin_address = '<coin>'`.
   "the payout wallet needs ETH for gas" in `bonus.collect` means: send ETH.

**Runbook: a stuck claim.** `bonus.claim` keeps saying "failed", or `availableFees` stays high.

1. Read it: `cast call 0xf3622742b1e446d92e45e22923ef11c2fcd55d68
   "availableFees(address,address)(uint256)" <owner> 0x4200000000000000000000000000000000000006`.
2. "under 10x gas" is normal for small amounts; it claims once worth it. At a round's end the pay
   step claims anyway when that covers what the round owes.
3. "the payout wallet needs ETH for gas": send ETH.
4. "failed": read the server log `[bonus] claim`, then simulate `cast call --from <payout wallet>
   0xf362… "claim(address,address)" <owner> <WETH>`. Anyone may claim, and the WETH always goes
   to the owner (the payout wallet or the Safe), so a claim sent from any other funded wallet is
   safe. The books need no change: claims don't touch `bonus_ledger`.
5. "waiting on a stored send": a stored payout or sweep couldn't be rebroadcast. See the stuck
   payout and sweep runbooks.

## Program guides and the landing page (v2.7)

The v2.7 job: convert a visitor into an install, then guide the builder to a winnable entry.
Spec `v2.7-convert-and-guide.md`, plan `v2.7-convert-and-guide-plan.md` (Rulings 1–27 and the
controller's C1–C16 in `.superpowers/sdd/v2.7-convert-and-guide-plan/progress.md`).

### From a program file to the guide (Rulings 2–9)

- **Program files** (`programs/*.json`, `program-file.ts`) gain optional guide facts, each with
  its own `source_url`: `logo` (`programs/<id>.svg|png` under `apps/frontend/public`, Ruling 23),
  `past_rounds` (newest first, at most 5; `submissions`/`winners` null when unpublished, C2;
  `own: true` only for the program's own round, C4; themes and examples with an optional `why`;
  `themes_of`, final review M3: how many winners the source describes when it is fewer than
  `winners`, so theme counts show without "of N" — Colosseum's 26 of 28),
  `focus` (up to 3 areas, optional `ecosystem`, Ruling 7), `best_bet` (EarnKit's curated advice,
  allowed only with `past_rounds` or `focus`, never generated, Ruling 8), `difficulty_override`
  (`{ level, basis, source_url }`, Ruling 5) and `winners_per_round` (Ruling 6). `programs:check`
  (`scripts/programs-sync.mts --check`) validates them, the logo file (`logo-check.ts`
  `checkLogoFile` → `logoFileProblem`: at most 200 KB, PNG signature, SVG without script,
  foreignObject, `on*=` or external/data hrefs) and the required items' `todo`.
- **Database:** six additive columns on `programs` (`logo`, `past_rounds` default `[]`, `focus`,
  `best_bet`, `difficulty_override`, `winners_per_round`), written by `upsertProgram` and read into
  `ProgramRow`/`programCard` (`programs.ts`).
- **`guide.ts`** (pure): `difficultyOf` (Ruling 2: odds = winners ÷ submissions of the newest
  round with both, Easy ≥ 0.25, Medium ≥ 0.08, else Hard; basis "20 of ~160 entries won last
  round" or "… in <label>"; Ruling 3–4: otherwise an estimate from winners, "long shot" and
  barriers, never Easy; the override wins), `difficultyLabel` ("Hard (estimate)"), `programGuide`
  → `Guide` (header "<title> · <prize> · <ends>", Ruling 9; difficulty; "What won last time" for an
  own round, else "What won before" naming the event, C3/C12; what the ecosystem wants now; best
  bet; builder bonus line), `guideText` (the agent's plain text), `guideSourceList`.
- **Where it shows:** `get_program` returns `guide { text, difficulty, best_bet, sources }`
  (v2.10 item 3: no `guide_note`; the first `prepare_submission` for a program shows the guide); the first message's Difficulty column (`present.ts` `difficultyCell`,
  label only, Ruling 12; campaign and sponsored tables have none); the landing cards; and
  `/programs/<id>`. All read the same `programGuide`, so the agent and the web never disagree.

### The first message (v2.7 §3, Rulings 10–14)

- Tables carry a Difficulty column; the message closes on the builder bonus (`bonusClose`;
  v2.7.1 wording): "<offer> Plus the builder bonus: the top 10 on each program also get paid in
  ETH. 0.60 ETH so far." (the sum of pools already read for bonus programs on screen, Ruling 11;
  "Under 0.01 ETH so far."; while every pool is empty the last sentence is dropped). When the offer
  is an EarnKit campaign entry, the sentence comes first as its own paragraph ("Plus the builder
  bonus on the other open programs: the top 10 on each also get paid in ETH. …") and the offer
  stays last (Ruling 10). The same paragraph form is used when the
  offered row carries Ruling 25's "no builder bonus" note, and that program's pool is left out of
  the sum (final review M4, `Offer.noBonusId`). "Top 10" is `BONUS_SPLIT_BPS.length`.
- The affiliation line and `BONUS_NOTE` are gone (Ruling 14); a repo whose token is entered in
  another program says so in its own repo cell (Ruling 13).

### The landing page (v2.7 §1, Rulings 20–21)

- `/` (`app/page.tsx`, `revalidate = 600`) reads `getLanding()` (`app/lib/landing-cache.ts`):
  `readLanding` behind `unstable_cache` for 10 minutes, so at most one DB read per 10 minutes and
  no new service. The cached value is plain JSON (`Landing`: no bigint, no Date).
- Curated programs only (no EarnKit or sponsor campaign): programs with a pool first, highest
  pool first, then the rest by per-winner amount (`landing.ts` `byPool`; the first message keeps
  `byPrize`). **v2.9 F21 replaces this:** the hero's figure is `moneyText(openMoneyUsd)` (see "Simplify" at the end). **v2.7.1 (superseded):** the hero's "$X open right now" was the sum of the cards'
  source-stated pools (`pool.ts` `poolTotalText`, compact and rounded down, "+" when any card has
  no pool or its reward says "+"); `/programs` shows the same figure under its h1. The first
  message keeps the per-winner sum, now called "top prizes". Each card's big line is the pool
  (`poolLine`: "$840K in prizes", "$250K+ in prizes", "10,000 USDC pool", "$200K in grants"), else
  the per-award line, else the curated text; the per-award line (`pool.ts` `eachLine`) sits under
  it when different: "per grant" for a grant program (title contains "grant"), "per winner"
  otherwise; "$5K–$100K per grant" with a stated `min_award_usd`, "500 USDC per grant" when the
  reward states it in USDC, else "up to $X per …". A compact total that rounds value away gets
  "+" ($1,050,000 → "$1M+"). Chips: the deadline, the difficulty (none for "—") and the builder bonus pill
  (`bonusPill`: "+ Builder bonus", "+ 0.42 ETH bonus" once the open round has a pool; none when
  the program opted out or its round froze).
- **v2.7.1 page order:** hero (AGENTS ONLY, title, subtitle, figure, "+ Builder bonus on every
  program" pill → `#builder-bonus` ("+ Builder bonus" unless `landing.bonus_every`: every open
  curated program has the bonus; also on a failed read), the two buttons, "Then ask", and `statsLine` only when
  installs ≥ 100 or bonus paid > 0), Open programs (no line under the title: the pills say it),
  the builder bonus section (`BuilderBonus.tsx`: "Win twice.", three pills ("Top 10 per program"
  unless every program has the bonus), `bonusPoolsText` "0.60 ETH in pools so far" or "Pools
  start with the first entry" after a successful read, and no figure at all when the read failed
  (never a claim we didn't read); "See programs" → /programs), How it works (3 short steps), Backed by, the footer. The stats strip is gone. The
  header is "Docs" (docs.earnkit.com) and "Add to your agent" on every page, desktop and mobile;
  "Follow on X" is in the footer only. The install modal carries (v2.8 Task 5: now `<BonusPill size="sm" />`) "+ Builder bonus on every entry"
  under the steps; guide pages carry the bonus as a pill beside Difficulty ("+ Builder bonus ·
  new pool" or "+ 0.42 ETH bonus"), linking to the leaderboard.
- **v2.8 Part A page order (Task 2):** the hero is the "Agents only" pill (Ruling C3), `HERO_TITLE` "Earn rewards for building",
  `HERO_SUBTITLE` "Find live programs. EarnKit matches your projects and helps you win.", the
  `BonusPill` (lg, no amount) linking to `#how-you-earn-3`, "Add to your agent" and "Watch the demo",
  plus `statsLine` when it shows. The "Win twice" section (`BuilderBonus.tsx`,
  `#builder-bonus`) is gone, and with it `landing.bonus_every`, `landing.bonus_pools` and
  `bonusPoolsText`. How you earn (`HowItWorks.tsx`: `HOW_TITLE`, `STEPS`) is a Panel with a visible h2
  (`#how-it-works`) and three step cards `#how-you-earn-1..3`. /programs has no "By pool" eyebrow.
  /policy's "The builder bonus" heading carries a `BonusPill` (md) beside it (Section's `aside`).
- **v2.8 Part A Open programs (Task 3, Rulings 20, 21):** `ProgramCards` (client) is the h2 "Open
  programs", "$1.1M+ open right now" (`landing.open_text`), one "Ask your agent" (the install modal
  with `START_PROMPT`), then every open curated program (no cap; `HOME_CARDS`, "See all" and "See
  all programs" are gone). Home (`layout="carousel"`): one `<ul>` row with native CSS scroll snap
  (`snap-x snap-mandatory overflow-x-auto`, `tabIndex 0`, `aria-label="Open programs"`; cards
  `w-[85%] sm:w-[48%] lg:w-[31.5%] snap-start`; edge to edge below md so the next card peeks).
  From md, "Previous programs" / "Next programs" arrows (before the scroller in source order) move one
  card and its gap (`carousel.ts scrollStep`) and turn off at the ends (`arrowState`, updated on
  scroll and by a ResizeObserver; both off in the static markup until mounted). /programs:
  `layout="grid"`, no arrows. Each card is `ProgramCard`: one `<a href="/programs/<id>"
  aria-label="<title>, <prize>">` with the logo, title, big line, per-winner line, days-left chip
  (`Tile.days_left`, was `ends`), difficulty chip (`Tile.difficulty` is the level word only, never
  "(estimate)"; the guide keeps the full label) and `BonusPill` sm. No buttons on cards. The
  landing cache key is `landing-v28` (the Tile shape changed).
- **v2.8 Part A install modal and agent text (Task 5, Rulings 18, 23, 24, 25, C1):**
  `AddToAgent.tsx AGENTS` is Grok Bot (default), Claude Code, Cursor, Codex, Muse (C1 keeps Muse
  last). Each tab has a 20px local `<img>` icon from `public/images/agents/` (sources in the comment
  above `AGENTS`, each checked by `logoFileProblem` in `install.test.ts`), SVG marks drawn one color
  per state with CSS filters. v2.8.1 (owner): Grok Bot (SpaceXAI's macOS agent app) shows its own
  app icon, `grok-bot.png` (64px, in color, rounded; from the app bundle), never Grok's logomark;
  Muse (Meta) shows its logo from muse.ai, `muse.svg` (gradient flattened to one blue, since the
  logo checks refuse `url()`), not a placeholder. The editor tab and "Other agents" are gone (the link box above the tabs serves
  any other client). Claude Code: `claude mcp add --transport http --scope user earnkit
  https://earnkit.com/mcp`, then "Then open Claude Code, type /mcp, pick earnkit, choose Authenticate."; Codex: `codex mcp add
  earnkit --url https://earnkit.com/mcp`, then `codex mcp login earnkit`. The pill under the steps
  is `<BonusPill size="sm" />`. `Compatibility.tsx` (unused) is deleted. The MCP route reads
  `leaderboard.ts earnkitCampaignOpen()` (one query, memoized 10 minutes; a failed read logs
  `[mcp] campaign check failed` and uses false) and passes it to `createMcpServer(ctx, {
  campaignOpen })`: while false, `toolDescriptions(false)` drops the campaign sentences from
  record_submission and prepare_submission, and `deployer_signature` keeps only its
  external-contracts sentence. `prepare_submission` returns `how_to_submit`/`sign_to_enter` only for
  an open campaign. `SERVER_INSTRUCTIONS`' first line no longer claims EarnKit runs campaigns. One
  money figure (since v2.9 F21 `moneyText(openMoneyUsd)`, which replaced `pool.ts openFigure`) feeds `landing.open_text`, the no-repo
  first message ("$1.1M+ in prizes open right now.") and the with-repo hook ("EarnKit matches you to
  $X in prizes you qualify for.", the matched programs' pools; "Your repos fit these open programs:"
  without one). `openMoneyUsd` is left only for `/api/stats` `open_money_usd`. `bonusClose`'s head is
  `TOKEN_LINE` ("Every entry gets a token: you earn 40% of its trading fees, and its fees fund the
  builder bonus."), plus " <x> ETH so far."; with no bonus on screen it is "Every entry gets a token:
  you earn 40% of its trading fees."; the campaign paragraph form keeps its wording. llms.txt and the
  README list the same five clients, a token and builder bonus section, and no campaigns section.
- **v2.8 Part A footer (Task 4, Ruling 22):** `app/components/common/Footer.tsx` is one rounded
  card (`rounded-[40px] bg-ek-navy-deep`, `md:rounded-[56px]`) holding the wordmark, `FOOTER_TAGLINE`
  "Earn rewards for building" (same text as `HERO_TITLE`), and a `grid grid-cols-2 md:grid-cols-4`
  of columns from `lib/earnkit/footer-links.ts FOOTER_COLUMNS`: Product (Programs), Resources
  (Docs, For sponsors), Legal (Policy), Contact (`j@earnkit.com` mailto, an X icon button to
  `https://x.com/jenilt` with `aria-label="@jenilt on X"`, `app/components/ui/Icons.tsx XIcon`).
  Below the card: the faded wordmark. v2.8.1 (owner): it is the navbar's logo itself,
  `ui/Logo.tsx Wordmark` (the mark and the "EarnKit" letters in one SVG path) with `decorative`
  (aria-hidden, no role), full width in an `aria-hidden` `div[data-footer-wordmark]` at
  `text-ek-blue-light/10`; never text. Then the copyright line (unchanged,
  "© \<year\> Tokenfi Inc. All rights reserved."). Every link is real; no placeholders. `DOCS`,
  `FOR_SPONSORS`, `JENIL_X`, `CONTACT_EMAIL` are defined in `lib/earnkit/footer-links.ts` (not
  `app/lib/links.ts`) because `EXTERNAL_ALLOW`/`FOOTER_COLUMNS` need them and `lib/earnkit` never
  imports from `app/` (fix round 1, Important #1); `app/lib/links.ts` re-exports all four so every
  existing caller (`Header.tsx`'s `DOCS`, etc.) keeps working. The old `X`/`FOLLOW_X` (EarnKit's
  own account) stay defined in `app/lib/links.ts` for other callers; the footer no longer uses
  them. `footerLinkProblems(columns, routes)` checks every link (internal paths against
  `appRoutes(appDir)`, external links against `EXTERNAL_ALLOW`, labels non-empty); covered for
  `FOOTER_COLUMNS` itself in every `pnpm -s test` run. A live network check of the external links
  (`fetch`, status \< 400, 10 s) runs only with `LINK_CHECK=1`, never in `pnpm -s test`. Because
  the tagline now equals `HERO_TITLE`, the copy-review helpers that used to cut page text at the
  literal string `'Where agents earn.'` (`copy-review.test.ts` `policyText`/`boardText`/`pageText`)
  now cut the raw markup at `<footer` instead, so they still isolate each page's own copy from the
  shared footer. Fix round 1 also: the X contact link is a bordered rounded-square icon button
  (`rounded-xl border-2 border-ek-blue-soft/50`, the carousel arrows' language, not a bare glyph);
  mobile `<footer>` bottom padding is `pb-[calc(10dvh+76px)]` so the copyright and faded wordmark
  clear the fixed mobile bar's real footprint (`Header.tsx`'s `h-[10dvh]` bar plus its
  `.mobile-header-bg` box-shadow, which extends another 60px of solid background below it); the
  footer logo link gained `min-h-11` for a 44px tap target.
- **`pool_usd`** (program file, optional; `programs.pool_usd numeric`, additive): set only where
  the program's own source states a pool; `programs:check` refuses one its `reward` doesn't state
  (`poolStated`: "$840,000", "$840K", "10,000 USDC") or one on a campaign. `programCard` turns it
  into `pool_usd`/`pool_plus`/`pool_line` (`programs.ts` `poolFacts`). Verified 2026-10-07:
  Colosseum 840000, Monad 250000 (+), Arc 10000 USDC, Circle 200000 (Cohort 2 on
  circle.questbook.app, recorded as `pool_source_url`, allowed only with `pool_usd`, stored in
  `programs.pool_source_url` and listed as the guide's "prize pool" source); Base publishes none.
  `poolStated` needs a pool word after the amount ("in prizes", "prize pool", "pool",
  "available", "total"), so a per-winner amount can't pass as a pool. Circle's `max_award_usd` is
  100000 and `min_award_usd` 5000 (additive `programs.min_award_usd`; must be stated in `reward`
  and below the max) ("$5,000 … up to $100,000 in USDC",
  circle.com/grant), so the first message's per-winner total includes it. `/api/stats` added
  `open_pools_usd` and `open_pools_plus` (dropped in v4.7.1; the same total and "+", `pool.ts` `poolTotal`/`statedPool`,
  over listPrograms' open rule, curated only); `open_money_usd` is unchanged. Spec: `v2.7.1-landing-simplify.md`.
- The figure is formatted on the server (`landing.ts`) and passed to the client `Hero` as a string:
  client components must not import `campaigns.ts`, which pulls viem and zod into the browser.
- A failed read (no `DATABASE_URL` at build, a Neon blip) logs `[landing]`, calls
  `await connection()` and renders `HomeView` with `landing = null`: the hero without its figure
  or stats line, no cards, the bonus section with its pills and no figure. Cache keys are
  `landing-v271` and `guide-v271` (bumped with the shapes). Because of `connection()`, a build without the DB makes `/` dynamic instead
  of prerendering the fallback (Ruling 21). Note: a local rebuild reuses `.next/cache`, so test
  this with a clean `.next`.
- Logos are local files only (`/programs/<id>.svg|png`, Ruling 23), rendered through `<img>`;
  without one, the Ruling 1 monogram. The five open programs carry official marks from their
  brand kits (Task 8; `logo.source_url` is the kit page). The frame is a white circle, so a square
  mark needs room in its viewBox (Base's Square is padded) and a gradient SVG that uses `url(#…)`
  fails the check, so Circle's mark is the kit's PNG.

### Guide pages (v2.7 §2, Ruling 22)

- `/programs/<id>` (`app/programs/[id]/page.tsx`) reads `getGuidePage(id)`: `readGuidePage`
  (`lib/earnkit/landing.ts`) behind `unstable_cache` for 10 minutes. It renders the same `Guide`
  as get_program (`programGuide` in `guide.ts`, the bonus line from `programs.ts`'s `guideBonus`),
  so the web and the agent never disagree. The value is plain JSON (`GuidePage`).
- "What won": "What won last time" only for the program's newest own round (`own: true`), else
  "What won before" plus a small line naming the shown round, "in <label>" (`Guide.won.event`,
  Ruling C12). The difficulty basis names its own round, which can be a different one.
- Only curated programs (`source = 'file'`, no campaign) have a page; any other id is null →
  404. The id is gated first (`gatedGuidePage`): a malformed id reads nothing, and an id outside
  the cached curated id set (closed included; one read per 10 minutes in total) is a 404 with no
  per-id read or cache entry, so random ids can't keep Neon awake. A closed or past-deadline program still renders (`· closed`, no "Ask your agent"), so old
  links keep working (Ruling 22).
- `readGuidePage` rejects on a DB failure (never null); `getGuidePage` logs `[guide]`, calls
  `await connection()` and returns `'error'`, which renders the "unavailable" panel with HTTP 200,
  never a 404. The route has no `generateStaticParams`: a runtime `connection()` inside an ISR
  route throws `DYNAMIC_SERVER_USAGE` (a 500), so the route is rendered on demand and the data
  cache does the 10-minute revalidation.
- `/programs` is the cards of `getLanding()` with no limit, under an `h1`. The sitemap lists
  `/programs` and each open curated program's guide.
- Sources are labelled by what they back (`guideSourceList`: program page, past winners,
  priorities, difficulty; numbered within a role) and link through `shownUrl` (canonical https
  only); a test checks every `source_url` in `programs/*.json` survives it. The logo CSP (`IMAGE_CSP`) matches
  only `/programs/<id>.svg|png`, never the page routes.

### Programs: the EarnKit rating, any chain, Avalanche, no Optimism (v2.8 Task 6)

- `difficulty_override` is either a stated level (`basis`, `source_url`, optional
  `estimate: true`, shown as "Hard (estimate)") or the owner's EarnKit rating
  `{ level: "Easy", rated_by: "earnkit", source_url }`. `difficultyOf` gives the rating
  `rated: true` with an empty basis; the guide text, the guide page and the card chip show just
  "Easy". Arc Microgrants, Base Builder Grants and Avalanche Team1 Mini Grants carry it.
- `any_chain: true` (with `chains: []`) marks a program not tied to one chain (a16z speedrun).
  `matchRepo` lets it fit any repo: no chain or mainnet check; existing work, the tag and the live
  link still apply. The landing tile's `chain` is "Any chain"; the slim card shows no chain line
  (Ruling 21), so the guide page appends "· Any chain" to its facts line. Column
  `programs.any_chain boolean NOT NULL DEFAULT false` (additive).
- `avalanche` is a chain (C-Chain 43114, Fuji 43113, Ruling 14). Builder bonus tokens stay on Base.
- `programs:check` refuses any file whose `source_url` or `submission_url` host is `optimism.io`
  or a subdomain (Ruling 15); the weekly re-check closes such programs. The README defines an
  Optimism program (only chain OP Mainnet, or run by Optimism or the Optimism Collective); Base and
  multi-chain programs are never closed under it.
- Fix round 1: the agent's tables (`present.ts layout`) sort Easy programs first, then by prize
  (`byEaseThenPrize`, Ruling C4); the landing carousel keeps `byPool`. `investment: true` (file and
  column `programs.investment`, additive) makes the card read "up to $1M investment", never
  "per winner" (`pool.ts eachLine`, Ruling C5). Chain detection cuts a chain's testnet hosts out
  before matching its mainnet hosts, so `testnet.snowtrace.io` or `sepolia.basescan.org` alone is
  not a mainnet signal; viem `avalanche` / `avalancheFuji` imports count.

### Builder bonus eligibility and its ship step (v2.8 Task 7)

- `traction.ts eligibleSql` (and its pure twin `projects.ts bonusEligible`) requires a launched
  token, `projects.complete_at` before the round's end, and `confirm_choice` not `'skip'`, on top
  of the counted submission, the test-installation exclusion and one entry per repo. The v2.7 C7
  readiness gate no longer blocks the launch; it decides `complete_at`.
- `complete_at` is set once (COALESCE, never cleared) by `record_submission` (from what the call
  was given) and by `launch_token` when the stored entry passes `entryMissing` (Ruling C8).
  `launch_token` and the submission token step refuse a skipped entry ("This entry was entered
  without a token.").
- Schema: `confirmed_at`, `confirm_choice` (`go`/`skip`), `complete_at`. The one backfill
  (`complete_at = coin_launched_at`) sits in a `DO` block that runs only in the deploy that
  creates the column: `schema.sql` runs before every deploy, and re-running it would mark v2.8
  entries launched while incomplete as complete. `db:check` proves the eligible set is unchanged.
- **Ship step (Ruling C7), right after the v2.8 deploy.** The migration runs before the cutover,
  so a token launched by v2.7 code in between passed C7 but has `complete_at` NULL. Note when the
  migration started (T0, from the deploy log), then:

  | Step | Command |
  |---|---|
  | 1. Dry run, counts only | `pnpm exec tsx apps/frontend/scripts/v28-complete-at-window.mts --since <T0 ISO>` |
  | 2. Apply | the same with `--apply` |
  | 3. Check | run step 1 again: `complete entries: 0` |

  It sets `complete_at = coin_launched_at` only for rows whose token launched in the window
  (`--since`, default 24 h ago; `--until`, default now), with `complete_at` NULL, no confirmation
  (v2.7 code never sets one) and a stored entry that passes `entryMissing`. Set-once, so re-running
  is harmless. It logs counts only. Run it before any open round ends.

### The confirmation step: the token launches on "yes" (v2.8 Task 8)

Outside EarnKit campaigns (which keep v2.4's one-step entry) the flow is now
`prepare_submission` → `confirm_entry` → (builder submits) → `record_submission`.

- **prepare_submission** never returns a kit, a submission link, a prefilled link, a paste list or
  agent fill steps (Ruling 4 (plan)). Once ready, `show_to_builder` is the Entry/Prize table, then
  `Ready. ` + `confirm.ts confirmOffer` (the spec's four lines and `COIN_FOOTNOTE`; the wallet short,
  Ruling 17's form). v2.8.1 §A2: the Yes line names the token that launches and is the entry's one
  "40%": "Yes: launches $TIP (TipJar) on Base. You earn 40% of its trading fees, plus a shot at the
  builder bonus." (`yesLine`). Fix round 1: the pair shown is stored per entry (`token_offers`:
  installation, program, normalized repo or "name:<name>"; `token-offers.ts`), by prepare_submission
  and the offer (the pair shown before wins; the agent's partial edits merge over it, `editsOf`; an
  edited ticker already used is replaced by the next suggestion, "$X is taken."). On "go" EarnKit
  launches exactly the stored pair; with none stored, or an agent asking for another name or ticker,
  the Yes line is shown (again) and nothing launches; a stored ticker taken since (C6) gets
  "$X is taken." and a new Yes line (`TokenOutcome.ticker_taken`). Nothing launches unseen. Fallback names (`token-proposal.ts nameCandidates`): the project name, "<name> Token", the
  repo name, then the name without its brand words ("ArcPay" → "Pay Token", ticker $PAY), and only
  then "<TICKER> Token". `confirmTable` no longer renders a Token row outside campaigns. With a repo it
  returns `token_line` (`tokenLineFor`) and an `agent_note` to push it before the builder confirms
  (none with `agent.can_push: false`). `shown_wallet` is the wallet on the offer's line.
- **confirm_entry** (`tools.ts`): refuses campaigns and closed programs. Without
  `builder_confirmed: true` and a `decision` it returns only the offer (+ `shown_wallet`,
  `agent_note`); nothing is written. Otherwise `confirmDecision` (pure) picks:
  - `skip` → the kit, no token, `confirm_choice = 'skip'` (never bonus-eligible, Ruling 3);
  - `record_only` (lasting: the repo's token is entered in another program, Ruling 5; the agent
    can't push, Ruling 7; no repo; tokens off or unavailable) → the kit with one plain line;
  - `launch` → `token-launch.ts confirmToken` (`runTokenFlow` in `confirm` mode). A **fixable**
    outcome (`TokenOutcome.fixable`: no wallet, a name or ticker problem, a taken ticker, the
    proof line missing or unreadable, a transient GitHub read, a wallet the screen refused;
    `GateResult.fixable` marks the gate's) returns no kit; its builder note says "say go" and the
    agent note names confirm_entry. Anything else (a private repo, no real code, one token per
    repo, the daily limit, a tokens.fun refusal) is lasting: the kit comes back with the reason.
  - **The proof line (Ruling C24): never a dead end.** A proof-line miss (`token-gate.ts
    PROOF_LINE_PREFIX`, marked `TokenOutcome.proof_line`) adds `CANT_PUSH_RETRY_NOTE` to the agent
    note (retry with `agent: { can_push: false }`; `CONFIRM_ENTRY_DESCRIPTION` says the same).
    `startEntry` returns `proof_line_missed` (the row's stored `token_status = 'gate_failed'` with
    that note, i.e. the previous "go" stopped there); if the proof line still fails on this "go",
    the entry records without a token and the kit comes back with `CANT_PUSH`, as for
    `can_push: false`. An agent that did push in between launches as usual.
  - **The post-launch line** names the ticker when known (final review M8):
    `Your token $TIPJAR: tokens.fun/coin/0x…. You earn 40% of its fees.` (`runTokenFlow` returns
    the launched token's name and symbol).
- **The entry row** is created at confirmation (`projects.ts startEntry`, Ruling 1): found or
  inserted through `ownEntry` under the same advisory lock as `recordSubmission`, charged against
  the 20 a day only when inserted, `confirmed_at` set once, `complete_at` set once (completeAt's
  rule). No `submissions` row is written at confirmation: only record_submission writes one.
  `confirm_choice`: "skip" never lands on a row that has a token (it stays `go`), and once the
  entry is submitted (`submission_confirmed_at`) the choice is locked; so an eligible entry can
  never drop out of a round. The choice is locked once the entry is submitted or proven
  (`submission_confirmed_at` or `submission_proof_ok_at`), and the deploy claim (`tokens.ts
  deployToken`) refuses a row confirmed with "skip".
- **A token link the builder typed** (an older entry's `token_url` with no EarnKit coin or claim)
  is never reported as EarnKit's token. A "go" moves it to `projects.own_token_url` (Ruling C11:
  builder data is never erased; the column is never shown as EarnKit's token or on a public page)
  so EarnKit's token can launch (one token per repo still holds at the claim).
- **Money safety (Ruling C9 fix round):** the offer shows the entry's own stored wallet first
  (`projects.ts ownEntryWallet`), then the remembered one, and returns it as `shown_wallet`. In
  confirm mode the token launches only to the `wallet` passed with that "go" (the agent echoes
  `shown_wallet`): never the entry's stored wallet or a remembered one. With none passed nothing
  launches and the reply asks "Use 0xab12…0123 for fees and any bonus, or tell me another?" (the
  stored wallet, else the remembered one, as the suggestion). Known gap, fails safe: a confirmed
  entry has no stored answers until record_submission, so launch_token's markComplete check and
  the deploy-window script don't mark it complete before then. A typo'd wallet
  errors before anything is written. The ticker is re-checked right before deploy, one token per
  repo holds (the claim), and a second "go" on an entry with a token launches nothing.
- **The kit** (`submit-kit.ts submitKit`): Task 8 builds `copy_paste` only (every answer that
  `prepareSubmission` fills, in form order, with the form's labels). Ruling C9: an incomplete entry
  still gets its token on "go" (eligibility waits for `complete_at`); the kit opens with "Before you
  submit: …" and every missing or invalid required answer is a "(still needed)" blank, never
  dropped. `prepare_submission`'s `complete` no longer carries the values; `proof` is `entry_link` for
  DoraHacks, ETHGlobal, Devfolio, Colosseum, Akindo, TAIKAI and Karma, else `confirmation`
  (Ruling 28).
- **Submit modes** (Task 10, Part E, Rulings 7, 8, 27 (plan); `submit-hosts.ts` holds the
  registry, pure and import-free so `program-file.ts` can validate against it). `hostOf` is the
  file's `submit_host`, else `submission_url`'s host without `www.`. `submitModeFor` starts from
  `HOST_MODES` (Google Forms, `forms.gle`, Airtable, Tally: `prefilled_link`; ETHGlobal, Devfolio,
  Colosseum, Monad's hackathon site, Akindo, TAIKAI: `agent_fills`; DoraHacks and any
  `*.questbook.app`: `copy_paste`; Superteam Earn, Karma GAP: `api`; any other host: `copy_paste`),
  then: no `form` data means paste; a form with `sign_in: true` (a file question or another sign-in
  cause) is filled in the browser, while `sign_in: "email_only"` (Google's verified email only,
  Ruling C19) keeps the link and the builder's own list starts with "Sign in to Google and tick
  Record my email address." (`builder_steps`, from the form data); `api` needs the
  file's `submit_api`, else the browser; no `agent.browser` means paste; DoraHacks and Questbook
  are always paste (their terms ban automated use).
  - `prefilled_link`: `googlePrefill` / `airtablePrefill` / `tallyPrefill` build the URL from the
    file's `form.fields` (requirement key to `entry.<n>`, Airtable field name, or Tally parameter).
    A choice not exactly one of its options, a file, a key the form no longer has, and anything
    past `MAX_PREFILL_URL` (8000) go to `paste`. The form ids are read once at listing from the
    public form (`programs/README.md`) and re-read weekly; never fetched at request time.
  - `agent_fills`: `agent_steps` is `AGENT_FILL_STEPS` (the builder's own browser; stop at login,
    captcha, wallet signing and uploads; never click submit). `paste` is the file fields and blanks.
  - `api`: `api: { platform, payload }`, the answers by key. The key is the builder's agent's own;
    nothing in the kit or any EarnKit call carries one.
  - Builder text names no tools or fields; the agent's instructions are `kitAgentNote`, joined
    into confirm_entry's `agent_note`. Every mode ends with the proof ask. Columns:
    `programs.submit_host`, `submit_api`, `form` (additive).
- **The public bonus board** (Ruling C10, `bonus-board.ts`) lists a confirmed entry only once it
  is submitted: a recorded submission (a `submissions` row), the builder's word, or a proof.
- **record_submission** on a confirmed row updates it (answers, proof, `builder_submitted`) and
  reports the row's token; it never runs a token flow. An older agent's entry that never passed
  confirm_entry keeps the v2.7 token path. Final review I3: a confirmed "go" with no token whose
  repo's token is entered in another program (`tokenElsewhere`, `repoCoinPrograms` on the repo
  key) reads `Entered in Base Builder Grant Program. Builder bonus counts in Arc Microgrants.`
  (`entry-text.ts bonusCountsIn`, the confirmation's words), is skipped (no bonus line), and never
  says "isn't launched yet" (kept for the no-push and fixable cases).

### The application coach and the answer bank (v2.8 Task 9, Part D)

- **Field kinds** (`program-file.ts FIELD_KINDS`): every requirement in `programs/*.json` has a
  `kind` (`programs:check` enforces it, Ruling 9); `other` is the runtime default. A requirement may
  carry `guidance` (judges, at most 2 questions, pattern, limit_words, source_url) and `max_chars`.
  A program may carry `judging` (1 to 5 criteria in the source's words), only where its source
  states them (Arc, Colosseum). C13: criteria go to the agent (`coach.judging`) and are never
  keyword-matched; a criterion is a builder fix only through a hand-written `fix` (field kind, needs
  link, number or date, the exact thing to add).
- **Guidance** (`coach.ts DEFAULT_GUIDANCE`, `guidanceFor`): a built-in default per kind, the
  program's override on top. It is for the agent only (`coach.fields`, with `builder_only` on fields
  only the builder can answer).
- **Questions** (Ruling 26, C15, `questionsFor`): askable fields (`askableKeys`) are required, empty
  and either `from: 'builder'` (consent, an amount, revenue, handles) or a kind the agent doesn't
  draft. At most 4 items in one round: the work questions in QUESTION_ORDER (past the limit the
  least important merge, "What will you ship...? And who is building it with you?"); contact always
  its own item, naming exactly what the form wants ("Your full name, email, X and Telegram?", or
  "Use a@b.co again? Plus your Telegram?"); money and other builder-only items together in their own
  item, never on contact. A first program shows at most 3 numbered, a 4th as a bullet; a later
  program (the bank filled any askable field) shows short bullets (C17); no question is over 25
  words. The heading counts every item shown, the bullet included (`coachIntro`, Ruling C25:
  "Base Builder Grant Program: 4 quick questions" over 3 numbered and 1 bullet); a later program
  whose questions go beyond the bank asks like a first program (C25, accepted). Nothing only the builder knows is left for a second round. One round per program
  (`coach_asked: true`). The agent never answers a builder-only field.
- **Draft and check** (C14): once ready, `prepare_submission` shows `draftTable` (at most 8 rows,
  cells cut at 60 characters, "show all"), then `fixesLine`, then the offer. `preSubmitCheck` builder
  fixes all read "<Field>: <the exact thing to add>." (traction: how many people used it; milestones
  and the grant's use: one milestone and a date; a claim: the number next to "users"; the proof link
  names its field; a curated criterion), at most 3, never blocking. Agent fixes (`agent_fixes`, never
  shown): a length over a limit the program states, and a proof link the agent already knows.
- **Plain description fields (v2.10 item 11).** `coach.ts plainProblem(text, kind, limit)` checks
  the `name`, `one_liner`, `problem`, `solution` and `how_it_works` fields. It flags a raw address
  (`0x` + 40 hex), a hash (`0x` + 64 hex), a hex run of 16 or more, a `key: value` list, 4 or more
  numbers in one sentence, and a link. `how_it_works` may hold one link, and so may a field a
  program's own criterion asks to link. In that second kind of field, an address inside the link
  (an explorer `/address/0x...` page) is allowed, and an address outside a link still fails. The
  check also flags a text over the form's `max_chars`, else its `limit_words`. A hit is a
  `not_plain` agent fix with the text `PLAIN_FIX(label)`. When length is the only problem, the text
  is `PLAIN_LENGTH_FIX` instead ("<Field>: keep it under N characters, in plain words."). The fix
  replaces that field's `over_limit` fix. `prepare_submission` lists it in `agent_fixes` only.
  `confirm_entry` refuses a go or a skip while any `not_plain` fix stands. It returns only
  `{ ready: false, agent_fixes, agent_note: PLAIN_NOTE }`, before the rate limit, the entry row and
  the token flow, and with no builder text (`tools.ts plainRefusal`). Pre-flight P32: an EarnKit
  campaign is confirmed in `record_submission`, so that tool runs the same check for campaigns.
  The tokens.fun description is `tokens.ts tokenDescription`: the project's description when it is
  plain, else the entry's one-liner answer (`projects.application`, kind `one_liner`), else
  "<Name> on Base". It is cut to 280 characters at a word boundary.
- **Token logo (v2.10 item 12).** tokens.fun writes the image link onchain at launch, so EarnKit
  always sends a link it controls and never the text tile. Order: the agent's `image_data` (stored,
  `/api/projects/:id/image`) or `image_url` (sent as given); else `token-launch.ts` calls
  `TokenFlowDeps.logo` (default `token-logo.ts launchLogo`, via `logoDefaults.launch`, stubbed to
  null in `fixtures/no-network-checks.ts`): the live site's `apple-touch-icon`, its largest
  PNG/JPEG/WebP `rel=icon` of 128 px or more, then `og:image` (`iconCandidates`, tried in turn,
  at most 3, Pre-flight P24; never SVG, ICO or http), then the repo's custom social preview. The
  page is read with `safeFetchText` (512 KB, one same-site redirect); each image with
  `safe-fetch.ts safeFetchBytes` (same SSRF rules, 1 MB, Accept PNG/JPEG/WebP, one redirect with
  every hop re-vetted) and kept only when `tokens.ts imageTypeOf` reads PNG, JPEG or WebP bytes.
  The preview (`githubPreview`) is one GraphQL read with EarnKit's `GITHUB_TOKEN`, never an App
  token, only for a repo that is not `repo_private`, was not read through the App by the gate, and
  has an anonymous public read within 7 days (Ruling H6, fail closed), and only when GitHub says
  `isPrivate: false` and `usesCustomOpenGraphImage`. The whole resolve has an 8 s budget and never
  fails the launch. Found bytes are stored with the claim (`projects.token_image`) and sent as
  `/api/projects/:id/image`; nothing found sends `/api/projects/:id/mark`: a 512x512 next/og PNG
  of one shape (circle, square, diamond, hexagon) on a two-colour gradient, all from the project id
  (`markFor`, no letters), drawn per request, never stored, 404 without a `token_symbol`, cached
  immutable, with the sandbox image CSP (`next.config.ts`). `token-image` stays only for old
  links. `prepare_submission`'s `token.proposed.image` is `site` with a live link, else `mark`.
  Ruling H7: `deployToken` refuses an agent `image_url` with userinfo, a `token`, `sig` or `key`
  query parameter, or a raw.githubusercontent.com link with any query (`tokens.ts unsafeImageUrl`)
  and sends the mark instead. The mark is pinned by golden values (test 6.3): it must never change.
- **One bonus line, the token at confirm, the deadline line (v2.10 items 1, 5, 15).**
  - *Bonus line.* `present.ts bonusLine(pool)` is the only bonus form in replies, at most once per
    reply. Ruling H8: "Builder bonus: 0.18 ETH so far" ("under 0.01 ETH so far") whenever the pool
    holds any value, rolled-over ETH included; "Builder bonus: no tokens yet, so yours would be
    first" only for an empty pool with no token in the round; an empty pool with tokens reads
    "Builder bonus: 3 tokens in, fees coming" ("1 token in", Ruling H9); null for a frozen round.
    `bonus-rounds.ts roundPools` is the one grouped read (Ruling 3) with a token count beside the
    pool: a token counts when its entry is in the program, it launched (`coin_address`) at or after
    the round start (`starts_at`, or the UTC month start of a rolling program), and its installation
    isn't an owner test one. `roundPoolsWei` is it mapped to `wei > 0` (the public pages).
    `ToolContext.roundPools` is the test seam. Ruling H8: the first reply's line is the pool of the
    program the closing offer names (`Offer.programId`), never a sum, right before the offer; no
    line when the offer names no program ("Pick one"), an EarnKit campaign, a program without a
    bonus, or one whose repo's token is elsewhere (M4). `bonusProgramIds` reads the on-screen bonus
    programs and then every other curated one (the offer can name a program off screen), still one
    grouped read. `enteredText` takes `bonus.line`; the guide's bonus
    section is the line (`GuideBonus.pool`), with no board link: the board stays on the guide page,
    whose pill keeps `cell`/`board` (Pre-flight P18; `readGuidePage` drops the bigint pool so
    `unstable_cache` can serialize the guide). Also qualifies and record_submission's token note say
    no "rides on" or "moves to" sentence (P6); `bonusRidesOn` is left only in the agent's
    `bonus_note`. The bonus win alert no longer says "(as WETH)".
  - *Token at confirm.* No first-reply offer (v2.9 B10 is reversed): `firstTokenOffer`,
    `tokenOffer`, `tokenOfferAgain`, `tokenOfferFit`, `TOKEN_OFFER_NOTE`, `token_offer`,
    `TOKEN_LINE`, `COIN_FOOTNOTE`, `tokenFootnote`, `BONUS_MOVES`, `EARNINGS_LINE`, `SKIP_LINE`,
    `yesLine`, `offerWalletLine`, `coinRow` and `walletLine` are gone. `confirm.ts confirmLine` is
    the one pitch: "Yes submits your entry and launches $TIP (Tip Jar): 40% of its fees to you, plus
    the builder bonus. Wallet: 0x12ab…9f3e. yes / skip the token" (no bonus: no ", plus the builder
    bonus"; `again`: no earnings part; no wallet known: "Say yes with your wallet address / skip the
    token"). Fix round 1 (I2): a `token_offers` row for this program and repo means the line was
    shown already in this flow, so a second `prepare_submission` and a `confirm_entry` without a yes
    use `again` ("40%" once per flow). A remembered wallet is shown only off shared clients (G13), since the wallet passed in
    comes from `walletMemory`/`entryWallet`. `confirmOffer` is that line, or "Ready to submit?"
    (token elsewhere, tokens off, skipped twice), or `CANT_PUSH` + "Ready to submit?". "skip the
    token" (`SKIP_TOKEN`) is the only skip word. The prepare token block has no `earnings`,
    `terms`, `paired_with` or `say_to_builder`; a campaign's Token row (`tokenRow`) uses the confirm
    line's words and has no footnote. The terms are one footer line on `/p/[id]` ("Token terms:
    agreement · risks", `TOKEN_TERMS`) and on tokens.fun. `launch_token`'s `offer` path stays until
    T9; its re-ask is `confirmLine({ again: true })` (Pre-flight P5). `serverInstructions` says "The
    builder confirms once: yes submits the entry and launches the token; skip the token submits
    without one."
  - *Deadline line.* `alerts.ts deadlineLine(entries, shown, now)` picks the soonest unsubmitted
    entry closing within `DEADLINE_DAYS` (3) not shown this UTC day: "Arc Microgrants closes in 2
    days; your entry isn't submitted." ("closes tomorrow", "closes today" under 24 h). Days are whole
    days left before the program's own deadline instant, so the line never reads later than the
    program's own close (Pre-flight P1); no date is printed. `takeDeadlineLine` marks it in
    `installations.deadline_shown` (`{ "<project id>": "YYYY-MM-DD" }`) with one conditional UPDATE,
    so two replies at once show it once. The entries come from the read alerts already make
    (`AlertFacts.entries`, the query that builds `skip.entered`; `sinceYouLastChecked` returns them).
    `tools.ts withAlerts(ctx, result, signedIn?)` puts the line first in `show_to_builder` (R12); on
    a shared client only the entries the pasted code's login verified count
    (`verifiedEntryIds` + `openEntries`, Ruling G7), and none without a code (`prepare_submission`
    takes `signed_in` for this). `list_programs` passes it as `FirstMessage.deadline`, after news and
    "Your entries" (P19; T8 reuses it). The weekly email is unchanged.
  - *One thing per reply (v2.10 item 2, R12, R14).* `presentFirstMessage` without `more` is the
    short first reply, one line each: news, "Your entries", the deadline line, the private and
    can't-see lines (T4), any "Couldn't read your repos", then `leadLine`. The lead row is
    `leadRow`: the top `layout` row the builder qualifies for (good odds, never an investment or a
    low-odds row, not new-work-only) and hasn't entered. "Your TipJar can win 500 USDC on Arc by Oct
    14. Want me to finish it?": the prize is `prizeOf` cut at " × " (P7), "on <chain>" is the
    program's first chain (dropped for any_chain), "by" is the program's own close day
    (`entry-text.ts closeDayOf`, the summary's "closes Oct 14", else ends_at's UTC day; dropped when
    rolling; P1). Without a lead: "No repo fits yet. $X is open; want the 3 easiest?" with repos,
    "$X is open. Want the 3 easiest?" (`MORE_QUESTION`) without (or on a matching error). Nothing
    open keeps "Nothing is open right now" (P20). No won line, no bonus line, no tables.
    `list_programs { more: true }` ("show more") renders the v2.9 body unchanged and is the only
    path that reads the bonus pools; `matches` and `programs` are returned either way, and the
    short reply's `note` tells the agent to call again with `more: true` on a yes. `recordShown`
    records only the lead row for the short reply (what was on screen).
  - *The guide after the pick (v2.10 item 3, R13).* `prepare_submission`'s first call for a curated
    program (`source = 'file'`, no campaign, open) prepends `guideText(programGuide(program, null))`
    to whichever `show_to_builder` it returns (the coach questions, the not-ready table or the
    draft), before `withAlerts` adds the deadline line. First = `setWorkingOn` (now
    `Promise<boolean>`, true only when it added the program) said added and the installation has no
    entry for the program (`projects.ts hasProgramEntry`, P23, so recording's `setWorkingOn(false)`
    never re-shows it); on a shared client `working_on` is installation-wide, so first = no
    `coach_asked`. The prepare guide has no bonus line (the confirm line names the bonus when the
    entry can earn it). Without `focus` or `past_rounds`, `Guide.rules_wants` (the first 2 `rules`)
    prints as "What it wants" in `guideText` only; `Guide.wants` is unchanged, so the public
    `/programs/<id>` page is unchanged (P2). `GUIDE_NOTE` and `get_program`'s `guide_note` are gone.
    Ruling H10 (I2): program files keep their sourced wording ("vaults" in Base's focus areas); the
    copy scans' "vault" ban is EarnKit's wording, so the journeys exempt only the guide's quoted
    program facts (`fixtures/quoted-facts.ts withoutQuotedFacts`: the bullets under "What won ...",
    "What <X> wants now" and "What it wants"). On a shared client the guide repeats on each prepare
    without `coach_asked` (R13). Final review M7 (accepted): that is per call, not per builder, so on
    a shared client a builder who re-prepares without `coach_asked` sees a guide that may be stale.
  - *One question per reply (Ruling H10).* Priority: the pickup question, then `ask_outcome`, then
    the lead's question. With a pickup, `outcomeToAsk` isn't read (so the entry isn't marked asked)
    and `FirstMessage.holdQuestion` drops the lead line (short) or the closing offer (more); with
    an outcome to ask, the lead line is dropped. The short reply returns `lead: { program_id, repo }`
    when its lead line is shown; `LEAD_NOTE` (and the list_programs description) say a yes to "Want
    me to finish it?" prepares that program, and `more: true` is only for a builder asking to see
    more or saying yes to "Want the 3 easiest?".
- **The answer bank** (`answer-bank.ts`, table `answer_bank`, Ruling 6): `confirm_entry` (go or
  skip) banks the final answers per installation, project (`projectKey`: normalized repo, else
  `name:<name>`) and kind; `other` is never banked; a kind with two fields banks the first. Contact
  details and links are banked per slot from the label (email, X, Telegram, a live link only from a
  label saying live, website or product). The fill never overwrites; for two fields of one kind it
  fills only the first; contact details are never filled silently (C16): the contact question offers
  them ("Use a@b.co and @alice again?", `questions[].suggested`). Final review M6: a project
  without a repo is keyed by its name, which two builders on one shared agent registration could
  share, so contact details are never banked or read back under a `name:` key
  (`bankKeepsContact`). `confirm_entry` also stores
  `projects.application` (`answers`, `kinds`, `fixes`, `at`).
- **Privacy**: the bank and `projects.application` are read only by these tools for the same
  installation; no public page, stats, admin page or log reads them (errors log the class only).

### "Also qualifies" (v2.8 Task 11, Ruling 29, Part F)

- **`also-qualifies.ts` (pure)**: `alsoQualifies` picks at most `MAX_ALSO` (3) other curated,
  non-campaign, non-sponsor, non-investment (Ruling C23: its form isn't public) programs the
  project already qualifies for: not the program just
  entered, not one this installation already entered for the same project (`enteredIds`; a
  confirmed-but-unsubmitted entry counts, Task 8 carry), not `new_work_only`, not closed, not
  ending within 2 days, and a chain fit or `any_chain`. A program tagged `needs a live product`
  (matchRepo's gate, `tag`) shows only once the project has a live product, or when the live link
  (the requirement with `project_field: 'live_url'`) is the only thing left to answer — then
  `AlsoRow.needsLive` makes `alsoText` say "a live link" instead of a count. Sorted Easy first
  (`difficulty.level`, review fix round 1, item 1/C4), then the larger top prize per winner
  (`max_award_usd`), then fewest required fields the answer bank can't fill (`coach.ts bankFill`,
  reused so a later program shows how little is left). A field the project info fills (repo, live
  link, name, description, demo) counts as filled: the count runs `prepareSubmission` with the
  entry's `project`, as the coach does (final review I1). v2.9 T12 (Ruling G15 M1): a program
  must also pass `canWin`. With the entry's repo remembered in `installations.fit_repos` (never on
  a shared client) that is the alert precision rule, `alerts.ts repoCanWin` (the per-repo half of
  `alertFit`), over what the builder says now and this step's live check: never a row that still
  needs real users or new work, or a small Hard one. Without it, a `needs a live product` program
  shows only once the builder said the repo has users. A chain the builder said is testnet only
  (and never mainnet) is dropped from the chains first. `alsoText` renders the table (`Program`,
  `Prize`, `Ends`, `Still needed`) plus "Say \"enter it here too\"..." and, with `coinIn`
  (Ruling 5), "Your builder bonus is in \<program\>; these entries don't add to it."; null with no
  rows.
- **Wiring (`tools.ts record_submission`, non-campaign only)**: chains come from the repo-facts
  cache (`match-projects.ts cachedRepoChains`, `github_repo_facts` only, no GitHub call, credited
  mainnets only (`creditsMainnet`, v2.10 item 9; a v2.9 row without `basis` is a mention) — the same
  convention `matchRepo` uses, review fix round 1, item 2) when present,
  else the entered program's own chains. Candidate programs, with `difficulty` and `max_award_usd`
  for the sort: `programs.ts alsoProgramFacts`. Already-entered programs for this project:
  `projects.ts enteredProgramIds` (same repo/name match as `ownEntry`, across every program).
  `hasLiveProduct`: whether `record_submission`'s own project has a live link. `coinIn`:
  `repoCoinPrograms` on the project's repo key. Never fails the reply: on error it logs
  `[also_qualifies]` (class only) and the section is left out. The reply carries `also_qualifies`
  (the rows) and the text is appended to `show_to_builder` after a blank line.

### Win engine (v2.8): the whole flow, outcomes and alerts (Task 12)

The v2.8 spec (`docs/design-docs-and-implementation-plans/v2.8-win-engine.md`) in one pass. The
sections above have the details per task; this is how they fit together.

| Step | Tool | Rule |
|---|---|---|
| What can I earn | `list_programs` | `moneyText(openMoneyUsd)` money line (v2.9 F21), Easy first (C4), `TOKEN_LINE` close |
| Coach | `prepare_submission` | at most 3 questions, 1 round per program (Ruling 26, C15, C17); draft table, at most 3 fixes (C13, C14) |
| Confirmation | `prepare_submission` then `confirm_entry` | the offer closes the draft; "yes, go" launches the token; "skip" is final for the bonus (Rulings 3, 31) |
| Kit | `confirm_entry` only | by host (Ruling 27): prefilled link, agent fills, copy paste (DoraHacks, Questbook), api; proof (Ruling 28) |
| Record | `record_submission` | updates the confirmed row, no second token flow (Ruling 1) |
| Also qualifies | `record_submission` | at most 3 rows, the bank fills the rest (Ruling 29) |
| Outcomes | `programs:sync`, `list_programs`, `tell_earnkit` (v2.9 A3; was `report_outcome`) | announcements count; self-reports never (Ruling 30, C21, C22) |

- **The ordering rule (owner, binding).** The ready-to-submit kit (any mode) comes only from
  `confirm_entry` after the builder's "go" or "skip" (Ruling 4). `prepare_submission` never
  returns a kit, a link, a paste list or form data at any depth (tested in `tools.test.ts` 8.1 and
  10.9). Bonus eligibility needs a launched token in SQL (`traction.ts eligibleSql`: a coin,
  `complete_at` before the round's end, `confirm_choice` not `'skip'`; Rulings 2, 3), not in copy.
- **The coach and the answer bank (Ruling 6).** `answer_bank` and `projects.application` are read
  only for the same installation; never by a public page, `/api/stats`, an admin page, the bonus
  board or a log line (errors log ids and error classes only).
- **Submit kit registry (Rulings 27, 28).** `submit-hosts.ts` maps hosts to modes and proof kinds;
  a program file may set `submit_host`, `submit_api` and `form` (Ruling 8).
- **Outcomes (Part G, Ruling 30; `outcomes.ts`).**
  - `entry_outcomes (project_id, program_id, round_label, result, prize_usd, source_url,
    captured_at, basis)`, unique per entry, round and basis. `basis` is `announcement` or
    `self_reported`.
  - Announcements: the weekly routine commits `programs/outcomes/<program-id>.json` (`OutcomeFile`,
    format in `programs/outcomes/README.md`). `programs:check` validates them (and that the program
    file exists); `programs:sync` calls `syncOutcomeFile`. Candidates are the program's submitted
    entries (the C10 rule) made by the announcement day and inside the round's window (final
    review I4 and re-review I-A: `entries_from` and `entries_until`, both required with
    `complete: true`, checked by `programs:check` and the loader through `OutcomeFile`; UTC days,
    inclusive), so only that round's entries can become `not_selected`. An unnamed entry that another round's file already
    labelled (anything but `unknown`) is left alone. Each named result labels every entry it
    matches (`matchOutcomeAll`: repo normalized and decisive; else the live link by host and path;
    else a name only when exactly one entry has it). Ruling C22: every other candidate is labelled
    too, `not_selected` when the file sets `complete: true` (the announcement names every winner),
    else `unknown`. The file is the truth for its round (re-sync overwrites); a committed
    `round_label` never changes. It prints counts only (`Outcomes arc-microgrants.json: 3 matched,
    1 unmatched, 12 others labelled`).
  - Self-report: a program file's `results: { url, expected }` (stored in `programs.results`).
    Once `expected` has passed, `list_programs` picks at most one submitted entry of this
    installation with no outcome and `outcome_asked_at` NULL (`outcomeToAsk`, which sets it in the
    same statement), and returns `ask_outcome` (`project_id`, the question `Did TipJar win anything
    in Arc Microgrants?`, `ASK_OUTCOME_NOTE`); it is read last, after the reply is built. The
    agent passes the answer to the `tell_earnkit` tool (v2.9 A3; it replaced `report_outcome`; Ruling C21: its own tool, not read-only,
    so `list_programs` keeps `readOnlyHint: true` and "What can I earn?" never needs approval);
    `saveSelfReport` stores it as `self_reported` (round label
    `builder report`) for the installation's own entry only (another's is `NotFoundError`).
    Self-reports never alert, never count in stats and never show on a public page.
  - Stats: `labelled_entries` (distinct entries with an announcement row other than `unknown`) and `entries_won`
    (announced `won` or `placed`), both excluding test installations. `WIN_RATE_MIN_LABELLED = 30`
    is documentation only: no code path makes a win-rate claim.
- **Alerts (Ruling 10; `alerts.ts`).** No new cron: alerts are pulled on the builder's calls.
  - Win lines first among wins: announced `won`/`placed` rows of this installation's entries
    (`winLine`: `you won $500 in Arc Microgrants with TipJar`, or `TipJar won in Arc Microgrants`
    without a stated prize), newest first, at most `MAX_OUTCOME_WIN_LINES` (3), each once
    (`AlertState.outcomes`).
  - New program lines where campaign lines go: `newProgramLines` over every open curated program.
    A program is news when it opened since tracking began and the builder could win it
    (v2.9 A7: `alertable`, see "Row difficulty, alert precision and the outcome loop" below; the
    v2.8 chain overlap and "or it is Easy" rule are gone).
    An investment program reads `new: a16z speedrun SR008 (up to $1M investment)` (`newProgramOf`,
    `entry-text.ts prizeOf`, Ruling C23: every builder and agent table too). At
    most `MAX_NEW_PROGRAM_LINES` (3), newest first: `new: Avalanche Team1 Mini Grants (up to
    $10,000, Easy)`. A fitting program over the cap stays unseen and shows next time; one that
    didn't fit when new is marked seen, so a later repo never makes an old program "new". The
    first-ever check is quiet and marks every open program seen; a pre-v2.8 memory (no
    `newPrograms` list) counts programs opened by its last check as seen. The body's "Updates"
    line (`present.ts programUpdates`) no longer names new curated programs, so a program is
    announced once per reply; it keeps the new sponsored count and closing-soon lines.

**Owner steps for the v2.8 deploy.**

1. Merge and deploy `v2.8-win-engine`. `predeploy` runs the additive migration (new columns and
   tables: `confirmed_at`, `confirm_choice`, `complete_at`, `own_token_url`, `application`,
   `outcome_asked_at`; `answer_bank`, `entry_outcomes`; `programs.any_chain`, `investment`,
   `judging`, `submit_host`, `submit_api`, `form`, `results`; `installations.fit_chains`) and the
   one backfill of `complete_at` (Ruling 2), then `programs:sync` loads program and outcome files.
2. Right after the deploy, the ship step (Ruling C7; T0 is when the migration started, from the
   deploy log): `pnpm exec tsx apps/frontend/scripts/v28-complete-at-window.mts --since <T0 ISO>`
   (dry run, counts only); if the count is above 0, the same with `--apply`, then the dry run
   again (`complete entries: 0`). Details: "Builder bonus eligibility and its ship step (v2.8
   Task 7)".
3. Point the weekly re-verification routine at `programs/README.md` "Weekly re-verification". It
   now also reads results when `results.expected` passes, writes outcome files, re-reads forms
   and skips Optimism.
4. docs.earnkit.com (other repo): use the builder bonus pill.
5. Follow "Test the journey (v2.8)" below with a throwaway public repo.

**Runbook: Test the journey (v2.8).** On production, with a throwaway public repo: tokens are real
and permanent. The DB-backed version is `apps/frontend/lib/earnkit/v28-journey.test.ts` (its own
throwaway database, real program files, fakes for tokens.fun and GitHub, no network).

1. With no repo, ask "What can I earn?": it opens with "$1.1M+ in prizes open right now." (v2.9 F21) and
   closes with "Every entry gets a token: …".
2. Pick Arc with a throwaway repo deployed on Arc: the coach asks its questions (Arc: the public
   profile), then the draft table, at most 3 fixes, and "Ready. Want the builder bonus? It comes
   with a token."
3. Say yes with your wallet: "Your token $<TICKER>: tokens.fun/coin/…", then the DoraHacks paste
   list. An agent that can't push says so (`can_push: false`), or says "go" twice with no proof
   line: the kit comes back with "To launch your token, open this in Claude Code or Cursor."
4. Submit on DoraHacks and paste the entry link: "Entered in Arc Microgrants", then "You also
   qualify for:" with Base Builder Grant Program.
5. Enter Base too: its confirmation reads "Builder bonus counts in Arc Microgrants." then "Ready to
   submit?" (no second token), and the kit is a prefilled Google form link. Recording it reads
   "Entered in Base Builder Grant Program. Builder bonus counts in Arc Microgrants."
6. Owner screenshot checks (Task 10, Ruling C19), on Base's prefilled link:
   (a) the prefilled answers survive the Google sign-in redirect (if not, set `form.sign_in: true`
   in `programs/base-builder-grants.json`, which makes Base `agent_fills` or `copy_paste`);
   (b) the `primary_challenge` checkbox options, which stay in the paste list.
7. Owner check (c), on Monad Metropolis: after submitting, the entry link's host matches
   `ENTRY_LINK_HOSTS` (`submit-hosts.ts`), so the kit asks for the entry link as proof.
8. After Arc's results are due (`results.expected`, 2026-10-21): "What can I earn?" asks "Did
   \<name\> win anything in Arc Microgrants?" once. Once the weekly routine commits the outcome
   file (with `entries_from` and `entries_until`, the round's window, when it is `complete`) and it deploys, a
   sourced win leads the next reply: "Since you last checked: you won $500
   in Arc Microgrants with \<name\>."

## Public trust pages (v2.5 §4, Task 9)

- **Footer (v2.8 Ruling 22):** every public page ends with the footer card (Product: Programs;
  Resources: Docs, For sponsors; Legal: Policy; Contact: email and X), from
  `lib/earnkit/footer-links.ts`; `footer-links.test.ts` checks each link (network only with
  `LINK_CHECK=1`). See "v2.8 Part A footer" above.
- **/terms#policy** (v2.9 F22; was /policy, which 301s there) states matching, the fee split (then "10% buys MINI, EarnKit's token", F24), and the builder bonus rules. Its numbers come from
  `lib/earnkit/policy.ts`, which reads the constants the code applies (traction `WEIGHTS`,
  `BONUS_SPLIT_BPS`), so the page can't drift. It is linked from the footer and the guide page
  (v2.7 §3, Ruling 14 (plan): the first message's `BONUS_NOTE` affiliation line is gone; the
  policy page keeps that text). v2.6: every program except EarnKit campaigns has a builder
  bonus unless it opts out; programs with public entry pages need the entry page to link the
  repo or live product, programs without them count the builder's confirmation (the owner reviews
  the top 10 before paying), and an entry page EarnKit can't load counts on the confirmation,
  reviewed too; the coin needs push access (the agent's `earnkit.txt` token line), not a wallet
  line; Safe money is the share of programs that opted out.
- **/policy wording (v2.7):** "The launch protocol keeps 20% of trading fees" (`CLANKER_CUT_PCT`;
  never the protocol's name, Ruling 18), "token" throughout (Ruling 19). docs.earnkit.com's "Money
  and trust" page restates the same facts and links here.
- **/programs** (v2.7 Ruling 22, v2.8 Ruling 20): every open curated program as slim cards in a
  grid, the target of the footer's "Programs"; each card links its guide
  `/programs/<id>` (see "Program guides and the landing page (v2.7)").
- **/bonus/<round>** (`bonus-board.ts`) shows public data only. The URL segment is the slug
  `<program id>-<YYYY-MM-DD | YYYY-MM>` (v2.6 Ruling 12 (plan), `boardSlug`); the v2.5 `:` form
  (also `%3A`) still resolves (`resolveRoundParam`), and a malformed escape is a 404. While a round
  is open it shows the live ranking from `bonus_scores` (ranked rows first, at most 500),
  eligibility in plain words ("No: no coin", "No: submission page not confirmed yet" on a
  pattern program, "No: submission not confirmed yet" otherwise, "No: an earlier entry of this
  repo counts", "Test entry: not ranked"), the pool so far, the days left and the end
  (`ends_label`, Ruling 29: the same day as the first message and the entry reply). An open round with
  no deposit yet (no `bonus_rounds` row) still shows, pool 0, while it is the open round of a
  program with `bonusOn`.
  From the review on, it shows the frozen `bonus_payouts` ranking minus vetoes, renumbered, with
  each place's amount and the mined transaction. Wallets, flags and veto reasons never show.
  Stored links render only through `shownUrl`.
- **/api/stats** gives jenil.ai aggregates only.
  - v2.7 Ruling 20 (plan): `bonus_pools_eth` sums the `destination = 'round'` bookings of rounds in
    state `open` (a frozen round's don't count), never from a test installation's coin (final
    review M7, as `bonus_to_safe_wei`). The first message's per-program pools (`roundPoolsWei`)
    keep those bookings: they are the round's real prize money, which real winners are paid.
  - `fees_to_safe_eth` covers **v2.5-split coins only** and is not all-time Safe revenue.
    Pre-v2.5 coins count 0. It is accrued, so unclaimed FeeLocker balances are included.
  - It is derived: the Safe's 30% slot is 1.5x the indexed real bonus-wallet deposits from EarnKit
    coins (rows with an onchain tx hash and a `coin` some project has as `coin_address`, M5; never
    the synthetic `round-rest:` remainder or a coin EarnKit didn't launch), plus the builder bonus
    money routed to the Safe. The Safe's own claims aren't recorded in the database.
  - Label it "fees to the Safe (v2.5 coins)" (`stats.ts` `STATS_LABELS` has every stat's label).
  - `bonus_programs_open` (v2.6 Ruling 16 (plan)): open programs with the builder bonus on
    (`bonusOn`'s SQL twin, `builder_bonus AND campaign IS NULL`). Label: "programs with a builder
    bonus".
  - `labelled_entries` and `entries_won` (v2.8 Part G, Ruling 30 (plan)): entries with an
    announced result, and of those the ones that won or placed. Announcement rows only (a
    self-report never counts), never a test installation's entry. Labels: "entries with a
    published result", "entries that won". No win-rate claim until 30 labelled entries
    (`WIN_RATE_MIN_LABELLED`, documentation only). Cache key `public-stats-v28`.
  - Caching: with `DATABASE_URL` at build time, the route prerenders and revalidates every 600 s.
    Without it (turbo doesn't pass it), the route renders per request. Either way the read is
    cached for 600 s with `unstable_cache`.
- **Owner test installations (v2.6 §5, Ruling 6 (plan)):** `EARNKIT_TEST_INSTALLATIONS` is a
  comma-separated list of installation ids (`installations.ts` `testInstallationIds`; malformed
  parts are dropped, one `console.warn` per distinct value naming only the count and positions,
  never the text). These installations' entries are excluded everywhere eligibility is computed
  (`traction.ts` `eligibleSql`, for both the entry itself and the earlier entry it would otherwise
  be blocked by — Rulings 13b/15 never let a test entry squat a repo), so they are never scored,
  ranked or paid. `/bonus/<round>` shows them among the ineligible rows as "Test entry: not
  ranked" (`bonus-board.ts` `OpenEntry.test`). `/api/stats` excludes them from `installs`,
  `coins_launched` and both parts of `fees_to_safe_eth` (the bonus deposits and, final review
  M2, the Safe bookings from their coins; a synthetic `round-rest:` row has no coin and stays
  counted) — their coins are real and
  their fees still flow normally into the round or the Safe, they just never show in public
  numbers. The runbook: use a throwaway repo, since the coin it launches is real.
- **Design system:** these pages are built from rounded `bg-ek-navy-deep` panels (40px, 56px from
  md, 16px apart), the uppercase eyebrow, Funnel Display headings, Funnel Sans light body text,
  and the v2.4 campaign table style.

## Hosted agents and identity (v2.8.1 §E)

- **`shared_client` (§E17).** `oauth.ts isSharedClient` flags a hosted agent client by its
  registered name (`HOSTED_CLIENT_NAMES`: Grok, Muse, Meta AI, xAI; whole words) or a redirect
  host (`HOSTED_REDIRECT_HOSTS`: grok.com, x.ai, x.com, meta.ai, claude.ai, chatgpt.com,
  openai.com, and their subdomains). The flag rides in the signed client id (`s: 1`; the name is
  only known at registration), is re-derived from the redirect host for older ids, and is stored
  on `installations.shared_client` at the token exchange (never cleared by a re-authorization;
  installations from before v2.8.1 stay `false` until they re-authorize). The MCP route passes it
  as `ToolContext.sharedClient`; since the final fix wave it is the group's flag (any linked
  installation flagged, as `sharedGroup`), not only the token's own. For flagged installs: `coach.ts bankFill(..., { confirmAll })`
  fills nothing silently (every banked answer the coach asks about comes back as `suggested`,
  asked as `Use "<saved answer>" again?`, and saved contact details by kind only, "Use your saved
  email?"; banked answers for fields the agent drafts are left out); `tools.ts walletMemory` and
  `entryWallet` return no remembered or entry wallet (the wallet is asked in the coach round,
  never suggested); `token-launch.ts launchLimit` uses `tokenLaunchShared` (500/day per
  agent) instead of 10, with the per-wallet 10/day still the real limit.
- **Identity follows the builder (§E18, `identity.ts`).** `installations.builder_id` links an
  installation to its group's root; `installations.ts connectInstallation` returns the root as the
  id the tools act as (plus the token's own id and its flag), so every per-installation read
  (entries, answer bank, memory, wallets, alerts, limits) is the group's with no query changes.
  `list_programs` calls `offerPickup` with what this call states (the GitHub user, the owners of
  repos and local_repos reported now, the wallet), never remembered state; matching earlier
  installations (by github_user, installation wallets, or entries' repo owner or wallets) outside
  the caller's group, with at least one entry in a GitHub repo, prepend "Pick up your N earlier
  entries?" to `show_to_builder` and add `pick_up`. Final fix wave: only the groups with an entry
  in the repo the proof goes in are offered, counted and linked (C1; a stranger naming the same
  public GitHub user or wallet stays out; Ruling F13: a covered group also has to have proven the
  repo itself, by its launched token there or its own installations' line in the repo's
  earnkit.txt, read once at the offer and again at the answer), and a group holding a hosted (`shared_client`)
  installation is never matched, and a hosted caller never offered (C2). Asked once per set; a no is stored in
  `installations.pickup.declined` and never asked again. The answer goes to the `pick_up_entries`
  tool. A yes alone never links (a GitHub user or wallet is public): this agent's proof line
  (`token: <tokenCode(own installation, repo)>`, the token launch's line) must be in the newest
  earlier entry's repo, on the default branch or the latest pushed branch; until then the reply
  tells the agent what to push. v2.9 T12 (Ruling G0): the proof repo is one a matched group
  already proved (its launched token, or a sign-in for it) when there is one, so a newer entry
  anyone records on another of the builder's repos never blocks an honest pickup (N1); the offer
  reads earnkit.txt only when it can change the answer: never once asked, never when tokens and
  sign-ins prove every group, otherwise at most once an hour for the same repo and groups
  (`pickup.read`, N2). `linkInstallations` then merges in one transaction: the smallest
  root stays, other roots' projects, sponsor drafts, answer bank (newer answer wins), wallets and
  token offers move to it, its memory fills gaps from theirs, and every member points to it. Two
  entries of the same program and repo (or no-repo name) keep the one holding the repo's token,
  else the earlier-submitted one, in the group; the other stays on the member installation (M3;
  v2.9 T12, G0 N3).
  Proof codes after a link are the root's (an unlaunched entry made by the new install before the
  link needs its line pushed again).

## v2.8.1 friction fixes: shipping, runbooks and the journey test

Spec: `docs/design-docs-and-implementation-plans/v2.8.1-friction-fixes.md` (implemented). The
pieces are documented where they live: launch claims, retries, limits and the reply time under
"Launch claims, retries and timeouts (v2.8.1 §A)"; the first message (§B) and applying (§C, §F)
under the v2.8 Part C/D sections; rollover (§D) under the builder bonus ledger; hosted agents and
identity (§E) above. What changed for the builder, in one list:

- §A: a launch is never stuck ("didn't launch yet; say go" on a known pre-mint refusal, "launching"
  within 50 s, an owner alert after 10 minutes); the Yes line names `$TICKER (Name)`; the proof
  line is read from the default branch, then the latest pushed branch, and a coding agent is never
  told to open Claude Code; 10 launches per wallet per UTC day with "Try again after HH:MM UTC".
- §B: "What can I earn?" never fails on agent input; investments never lead; no-repo rows say
  "(needs a repo)"; returning builders see "Your entries" and entered programs are never offered.
- §C, §F: the wallet, Loom demo and Builder Code are asked in the one coach round; the bonus note is
  said once, positively; "40%" appears once per entry (the Yes line; a repeat offer in the same
  entry omits it).
- §D: after a program ends, a token's fees book to the repo's next open entry.
- §E: limits per agent client; hosted installs never reuse answers or wallets silently; earlier
  entries are picked up with a yes plus the proof line.

**Ship order.**
1. tokens.fun first (its worktree `tokensfun-earnkit-limit`, commits `cc46fa2` and `f02e616`): the
   EarnKit-key wallet limit, the 429 `retry_after`, and `minted: false` on refusals.
2. EarnKit: `pnpm db:migrate` (additive: `projects.token_claimed_at` (backfilled to the migration
   time on pending rows) and `token_released_at`, the `token_offers` table,
   `installations.shared_client`, `builder_id`, `pickup`, `programs.needs_repo`),
   then `pnpm programs:sync` (needs_repo on every program, the speedrun logo, Monad's links).
3. **Settle pre-v2.8.1 pending launches (ship step).** Before EarnKit v2.8.1 runs its first cron,
   list `SELECT id, name, repo_url, token_name, token_symbol, token_note, payout_wallet,
   installation_id FROM projects WHERE token_url = 'pending';`. The migration backfills `token_claimed_at` on these rows, so the
   first hourly cron 10+ minutes after the deploy names each one in `needs_owner`
   (`token-pending:<id>`), answers 503 and GitHub emails the owner. Settle every row first with
   "Runbook: a token stuck in `pending`" (look the ticker and creator wallet up on tokens.fun; if
   it minted, record its link with step 3; only after confirming no token exists, release the
   claim with step 4 so the builder's next "go" launches). An empty result means nothing to do.
   Pre-v2.8.1 claims are never retried automatically: the old code may have sent a deploy that
   minted.
4. Deploy, then run "Runbook: Test the journey (v2.8)" with a throwaway repo.

**tokens.fun answers EarnKit reads (v2.8.1, Rulings F3, F4).**
- **429 with `retry_after`.** tokens.fun's EarnKit-key wallet limit (10 per wallet per day) answers
  429 with `retry_after: { at: <ISO time>, seconds: <n> }` and a `Retry-After` header. EarnKit
  releases the claim (nothing minted) and says "Your token didn't launch: this wallet reached
  today's launch limit. Try again after HH:MM UTC." (the time rounded up to the minute; the older
  flat `retry_after` ISO or seconds, `retry_after_seconds`, `retryAfter` and the header are read
  too; with none, "in a few hours"). It is never retried at once.
- **`minted: false`.** tokens.fun adds it to every refusal before broadcast. Any answer with
  `minted: false` and no `txHash` or `tokenAddress` releases the claim, retried once for a 5xx;
  the builder hears "Your token didn't launch yet; say go to try again." Anything else that may
  have minted (no answer, 502 "Deployment status unknown", the catch-all 500, an unparsed body, a
  tx hash) keeps the claim pending for the runbook. Against a tokens.fun that predates
  `minted: false`, only its exact known pre-mint 503 texts release.

**The journey test (`v281-journey.test.ts`).** The friction audit ran 10 builder journeys through
the real tools against a throwaway database; the same journeys, plus the agent switch (Grok Bot,
a hosted `shared_client` install, with a repo, then Claude Code: no pickup is offered, and Claude
Code enters on its own with the repo's one token), a reinstall that picks up only the group its
proof covers (J1d), a slow repo check ("still checking"), run as a DB-gated test in their own database with mocked tokens.fun (ticker
check and the deploy API behind the real `deployToken`, plus a slow deploy) and GitHub (repo
facts, `earnkit.txt`); any other fetch gets a 503. It asserts "40%" exactly once per entry flow,
the bonus note at most once per reply, every reply under 50 s (the slow deploy answers
"launching" and the check-back returns the token and kit), a builder with a repo never led with
speedrun, no dead end for a no-repo builder on Arc, the returning recap with no re-offer, and no
"open this in Claude Code or Cursor" for an agent that can push.

## Link and contract checks (v2.9 A5, Task 1)

- **Placeholders are refused where a link is given.** `placeholder.ts` (pure, import-light so
  `untrusted-text.ts` and `submission.ts` stay pure, Pre-flight P48): `placeholderHost` (RFC
  2606/6761 names, `yourdomain.com`-style short list, IP literals, `earnkit.com`) and
  `placeholderLink` (plus `github.com/earnkitai/...`). `canonicalBuilderUrl` returns
  `PLACEHOLDER_LINE` ("Use your real site, not a placeholder."); `shownUrl` still displays stored
  and program links as they are. `reportedUrl` (local_repos) drops placeholders, and a placeholder
  GitHub homepage is no homepage (`checkRepo`).
- **Checks.** `verify.ts`: `liveVerified(url)` probes with `safeProbe` (a 2xx, public address,
  5 s; v2.10 item 14: the probe asks for HTML (`accept: text/html,*/*;q=0.8`), reads the first
  64 KB and, only for an HTML response (content-type text/html, or a body starting `<!doctype` or
  `<html`; JSON and other API bodies pass on any 2xx, Ruling H4), fails a page whose visible text
  is under 5 KB and whose title or text shows a specific error phrase such as "404 Not Found",
  "Page not found", "This page could not be found", "Application error" or "Bad Gateway" (never
  a bare "404" or "not found") with `ErrorPageError`; `liveCheckDetail` caches that phrase as the
  `url_checks.note` and the entry's fix line is `liveErrorLine`: "Your live link loads but shows
  an error (...)". Final fix M2: the phrase is the site's text, so `liveErrorLine` cleans it
  (`plainText`), cuts it to 60 characters at a word boundary and quotes it (`quoted`). There's no JS execution, so an error drawn by client JS isn't caught. The
  builder bonus live signal (traction.ts) uses the same probe, so an error page counts as a down
  day there too, P31), `contractDeployed(chain, address)` runs `eth_getCode` through `rpcFor(chain)` (the
  `<CHAIN>_RPC_URL` variable, else the public default from each chain's docs; no RPC = null,
  never a pass). `hasCode`: `0x`, empty and an EIP-7702 delegation are not deployed. Results are
  cached in `url_checks` (`url:<canonical url>`, `getcode:<chain>:<address>`): a pass 24 h, a
  failure 1 h (`cacheFresh`). Every check takes from a `CheckBudget({ probes, getCodes })`
  (`ENTRY_BUDGET` 1 + 2 per entry step, `LIST_BUDGET` 5 + 6 for list_programs, T2); no budget
  left reads false/null and writes nothing. Errors are failures, logged `[verify] <kind> <class>`,
  except a getCode error (an RPC error, timeout or 429): that is null ("couldn't check") and is
  never cached (Ruling G15, `cachedCheck({ errorIsUnchecked })`). An entry says "No contract found
  on <Chain> mainnet yet." only on a real `0x` (or no address named); an unchecked contract keeps
  the item missing with `contractUncheckedLine` and is checked again at the next step.
  `CheckDeps.cache` (P26) and `checkDefaults` let tests run without the network or the table
  (`fixtures/no-network-checks.ts`, imported by the suites that run the entry tools).
- **Where they run.** `prepare_submission` (once the draft is ready), `confirm_entry` and
  `record_submission` each run `tools.ts entryChecks` (non-campaign programs with a live link or a
  required `live_url` item): the live link, then, when the program file sets `needs_contract`
  (Arc Microgrants: `arc`), up to 2 addresses from `addressesFrom` (the `contracts` /
  `contract_address` answers, an explorer `/address/0x...` live link on that chain's mainnet
  explorer (`match.ts mainnetExplorerHosts`), then `project.contracts` and the contracts
  local_repos reported for the repo, P4). The result is `KnownInfo.verified`: a required item
  filled from `live_url` is missing with `LIVE_FAILED_LINE` or `contractMissingLine(chain)`
  unless it passed. A failed check never blocks the screen or the offer: it is one builder fix
  line and `ready: false`; the entry is not complete. `startEntry` / `recordSubmission` store
  `projects.live_verified_at` / `contract_verified_at` (now on a pass, NULL otherwise).
- **Stored entries (P5).** The token flow's loader and `completeAtWindow` fill
  `FlowProject.verified` from those columns (`withStoredChecks`, only for programs whose
  requirements use `live_url`), so `launch_token` never completes an unverified entry.
  `launch_token`'s new live link clears `live_verified_at`. "Also qualifies" counts a live
  product only when the link loaded (`live_verified`).

## Abuse limits and response headers (v2.2 §5)

- **Rate limits** live in one place, `lib/earnkit/rate-limit.ts` (`LIMITS`, `enforce`), backed by
  Postgres `rate_windows` so they hold across instances: sponsor create 5/day (charged only for a
  valid create), sponsor draft replacements 10/day and
  record_submission 20/day per installation; at most 3 entries per installation per campaign
  (counted in `recordSubmission` under the campaign's advisory lock); authorize 60/hour per IP;
  new installations (v2.8.1 §E17, Ruling F11) 500/day per registration (`oauth.ts
  registrationLimitKey`: the client id, so one agent app's users never share a bucket anyone could
  fill), OAuth client registration a 10,000/day ceiling per agent app (`clientLimitKey`: the first
  https redirect host; a warning is logged at 8,000, before it refuses; a loopback or app-scheme
  client has only the IP floor), and 50/hour per IP as the abuse floor (the token endpoint counts only codes that create an installation; a
  replayed code is free; a refusal logs `[oauth] <route> refused by <limit> (<redirect host>)`;
  Ruling G25, replacing the v2.9 T12 G0 exemption: a client whose redirect host is a known hosted
  service, `oauth.ts hostedRedirectHost`, never its name, has its own higher floor, 500/hour per IP
  (`oauthRegisterHosted`, `installHourHosted`), since many builders share its servers' few IPs; it
  refuses like any other, so one IP can't drain the host ceiling, which still applies),
  since installations are the identity every per-installation limit keys on; GitHub matching 30/hour per installation (when refused, list_programs still
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

## Owned repos and the real-product score (v2.9 A1, A2, Task 2)

- **Owned repos only.** `match.ts ownerOk(owner, builder, contrib?)` (pure): never an owner in
  `EARNKIT_ORGS` (`earnkit-orgs.ts`, import-free, re-exported by `programs.ts` next to `KITS`),
  owner test installs included; the builder's own; else 5+ of the builder's commits that are 30%+
  of the repo's last 100. `match-projects.ts userRepos` drops forks, templates (`is_template`),
  archived repos, EarnKit's repos, and repos neither created nor pushed in 365 days before any
  per-repo call (`droppedRepo`). Ruling G15 (spec A2): a `TUTORIAL` name or topic, or a
  `TUTORIAL_DESCRIPTION` phrase, is scored and only costs `original`; it is never dropped. Repos owned by others
  come from the commit search: only those with 5+ hits, at most 3, get `GET /repos/{r}` (where
  `template_repository` is checked, P49) and one `commits?per_page=100` read for `ownerOk`. A
  `repos` list without `github_user` counts as owned unless EarnKit's (P28); with one, a repo
  owned by someone else gets the same 100-commit read (at most 3). Local repos whose GitHub link
  names an EarnKit org are dropped.
- **One key per repo.** `answer-bank.ts repoKey({ url, name })` = `projectKey` without its
  leading `github.com/` (lowercased `owner/repo`, else `name:<name>`; P7), re-exported by
  match-projects. A local report of a GitHub repo merges into it: GitHub facts win, the local
  report only adds a live link (when GitHub has no homepage), chains GitHub lacks, and contracts.
- **The score.** `productScore(ProductFacts)` (pure): six signals; product = 5+ with active,
  owned and deployed; project = 3 to 4; noise = 2 or less. Inputs (plan Ruling 1): `active` = a
  commit in 90 days or a push in 90 days (v2.10 item 8: `match-projects.ts commitsRead`, one
  `commits?since=<90d>&per_page=100` read by any author, so commits with an unlinked email count;
  `&author=<builder>` only on a repo someone else owns, the v2.9 A1 contribution rule; an empty read
  or a failed one (null) falls back to `pushed_at`, except on a repo someone else owns, where only
  the builder's own commits count (Ruling H1); the count, at most 100, is `RepoFacts.commits_90d`;
  Pre-flight P28: the read also runs when the builder is unknown; local: `last_commit_at`), `young` = created in 365 days or active,
  `original` = not a fork or template and no `TUTORIAL` match (docs repos included, P27),
  `readme` = a root README of 1,536+ bytes (tree size) whose first 2 KB (one raw read) isn't
  `DEFAULT_README` (local repos: false), `deployed` = the live link loads (`liveVerified`) or one
  of up to 2 contract candidates from the files already read has code on a detected mainnet,
  `owned` as above. At most `SCORE_LIMIT` = 8 repos (most recent first) are scored per call,
  under one `CheckBudget(LIST_BUDGET)` (5 probes, 6 getCode).
- **Chain basis (v2.10 item 9).** `match.ts Detection` entries carry `basis`: `deployed` (a
  contract with code there: `confirmMainnets` sets it for every chain in `withCode`), `deploy_config`
  (`deployConfigChains`, Ruling H2: an entry of `networks` in `hardhat.config.*` by its RPC host or
  chain id, or an `[rpc_endpoints]` entry in `foundry.toml` by host, id or name; comments stripped,
  imports and etherscan `customChains` never read; a config naming more than 2 mainnet networks
  (`MAX_CONFIG_MAINNETS`, testnet and local names excluded) is a template and gives nothing; or a tree
  path at any depth outside `node_modules`/`lib`/`vendor`: `broadcast/<script>/<chainId>/` (not
  `dry-run/`), `ignition/deployments/chain-<id>/`, `deployments/<network>/` with `<network>` =
  `<chain>`, `<chain>mainnet`, `<chain>-mainnet` (R6) or `avax`; `readRepoChains` passes every blob
  path, so folder hits are free) or `mention` (any other import, host or id: `detectMentions`). Absent reads as `mention` (v2.9 cached rows, R6).
  `creditsMainnet(entry)` = mainnet and not a mention, or a claim (`CLAIMED_MAINNET`, v2.9 A3).
  `matchRepo`: a program chain whose mainnet is only mentioned gets `after_step`, note
  `DEPLOY_FIRST(chain)` ("deploy to Base first"), missing `mainnet_deploy` (plus `live_url`
  without a homepage), effort `hours`, before the live-product rules (never likely). Fit chains
  (`fits[].chains`, fit_chains alerts) and `cachedRepoChains` count credited mainnets only;
  contract candidates still use every mainnet (`mainnetChains`), so a getCode pass can turn a
  mention into `deployed`: mention and claimed chains (`unverifiedMainnets`) get their pairs first
  and are checked even when the live link loads. On a multi-chain program `matchRepo` takes a
  credited chain before a mentioned one.
- **Traction and odds (v2.10 item 6).** `match.ts traction({ tx_count, live_ok, commits_90d })` =
  3·band(tx: 0, 1-49, 50+) + 2·live + band(commits: 0, 1-9, 10+), 0 to 10 (R1; an unknown count
  scores 0 and is never named). `productOdds` (Ruling H5): not product tier is low (its
  `missingSignalNote`); a copy or starter (`original` missing) is always low; with a known count
  (Base), good = traction 4+ (`GOOD_ODDS_TRACTION`), else "no users yet" (0) or "live link not
  loading"; with the count unknown (another chain, or no read slot), good = a live link and a commit
  in 90 days (an unknown commit count counts), else "live link not loading" or "no commits in 90
  days". Ranking still uses the raw score, so measured users rank first. `rowOdds(product, verdict,
  chains)` adds "not deployed yet" for a row waiting on a mainnet only mentioned (`onlyMentioned`);
  a product without `odds` (unscored, pre-v2.10) reads as low (P26). `checkRepo`/`checkLocal` set
  `Product.traction`, `odds`, `low_reason`. `tx_count` comes from `verify.ts txCount` (Alchemy
  `alchemyTxCount`, transactions to the address capped at `TX_COUNT_CAP` = 100, Base only, `txcount:base:<a>` in
  `url_checks.n` for 24 h, failures not cached): `runChecks` reads it, after the getCode phase, for
  contracts with code on Base, newest repos first, within `LIST_BUDGET.txCounts` = 2
  (`checkEligibility`: `ENTRY_BUDGET`, 1; P27). Ruling H5 (I3): a repo whose live link loads gets
  at most one extra Base getCode (for its count), newest first, only while a count slot remains,
  and none when that address's count is cached (`peekTxCount`; the cached count is used).
  `contractPairs` always keeps one Base pair inside the 2-pair cap (I4). A local repo's commits are
  band 1 when its `last_commit_at` is within 90 days, else 0 (R3); with the H5 rule a live, active
  local Arc product is good odds (P30's cap no longer decides odds). **Starters (R7):** `earnkit-orgs.ts EARNKIT_STARTER_NAMES` (copied from
  `earnkitai/chain-kits` at b068976) against the root `package.json` name and the README's first `#`
  heading (read from the same 2 KB range, also under 1.5 KB), folded (`starterRepo`; a deps seam
  `MatchDeps.starters`): a match loses `original`. **Ranking:** `matchProjects` sorts fits by good
  odds, then traction, then today's order; `present.ts layout` keeps, per program, the good-odds
  repo with the most traction (P12) and sorts rows by entered last, good odds, traction, row level,
  prize, quickness. A low-odds row's repo cell is `<repo>, low odds: <reason>` (`lowOddsCell`); it
  never counts in "$X you qualify for" (`qualifies`), never gets the token offer (`tokenOfferFit`),
  and the closing offer (`bestFit`) takes good odds first. With only low-odds rows the heading is
  "Programs your repos could reach:" (`LOW_ODDS_HEADING`, P14: never "fit"). `alerts.ts repoCanWin`
  is false for `product.odds === 'low'` and for a row on a chain only mentioned (P13), so neither
  alerts nor Also qualifies offer it (a remembered fit repo from before v2.10, without `odds`, still
  passes until the next match rewrites it). `match_shown.traction` (smallint) logs the traction
  shown.
- **Cache (P6).** `github_repo_facts.product` (jsonb) holds only the repo's own signals for that
  version: `{ young, original, readme, addresses }` (v2.10: plus `starter`, and the `traction` and
  `odds` of the last scoring, written in `finish` with one write only when they change; a row
  without `starter` re-reads the files). owned, active and deployed are worked out on
  every call. A pre-v2.9 row (product NULL) re-reads the files. `cachedRepoAddresses(repoUrl)`
  hands the file candidates to `tools.ts entryChecks` after the project's and local_repos'
  contracts (P4).
- **Verdicts.** `matchRepo` with `repo.product` set: noise gets no row; a program's
  `min_product_score` (program file, 0 to 6; `programs:check` requires 5+ on `any_chain`, a16z:
  5) is a floor; an `any_chain` or `investment` program takes an original product only
  (`fitsWideProgram`, Ruling G15: a docs repo or a tutorial never reaches a16z), and an
  investment row is `after_step`, `INVESTMENT_NOTE`, effort weeks; "needs a live product" is
  never likely (`['live_url', 'real_users']`, or `['real_users']` once `live_verified`); a
  project row that would be likely is `after_step` with its most actionable missing signal
  (`SIGNAL_WORDS` in `deployed, active, readme, original, young, owned` order, P29). Without
  `product` (callers that don't score) the v2.8.1 rules hold.
- **Output.** `matchProjects(input, deps?)` returns `checked` (every repo found, dropped ones
  included, so a builder with only clones reads "None of your N repos fits", P12), `scored`, and
  `fits[]` with `key`, `product`, `live_verified` and `facts` (the merged RepoFacts, P13), likely
  first then by score. `MatchDeps` (programs, repo cache, checks, now) is the test seam.
  `tools.ts matchRows` caps list_programs' `matches` at 3 repos per program (1 for an
  `any_chain` program), best `product_score` first.
- **Ruling G3 refinements.** A description counts as tutorial work only on strong phrases
  (`TUTORIAL_DESCRIPTION`: tutorial, course, boilerplate, starter kit, template, follow along,
  homework); names and topics keep `TUTORIAL`. Contract candidates skip `KNOWN_TOKEN_ADDRESSES`
  (USDC, EURC, WETH, USDT from official docs; chains without a sourced address left out). A local
  repo without `last_commit_at` counts as active (the instruction asks agents to send it). Repos
  the builder names in `repos` skip the 365-day age rule (`droppedRepo(r, now, { named: true })`);
  forks, templates and archived repos are still dropped.
- **Ruling G4 (fix round 1).** Keys dropped as a fork, template, archived or EarnKit repo stay
  dropped when the same repo comes back through local_repos. Ruling G5: `runChecks` hands out
  the probe slots, then the getCode slots, to the newest repos first (fresh cached answers,
  `verify.ts peekLive`/`peekContract`, take none), then runs the checks in parallel
  (mapLimit 6), each repo on its own slots; a check with no
  budget left (`verify.ts liveChecked` null, `contractDeployed` null) is `Product.unchecked`,
  never `missing`: the row reads "live link not checked yet" (`UNCHECKED_NOTE`), the tier counts
  it as not deployed, and the next call checks it (passes are cached). A local repo whose GitHub
  link names another owner gets the 5-commit, 30% read when `github_user` is given (shared cap of
  3 with the contributed and named repos); a repo GitHub won't show is not owned (G5: fail
  closed, as the named-repo path), so it caps at project tier.

## Builder memory: `tell_earnkit` (v2.9 A3, Task 3)

- **The tool.** `tell_earnkit` (`tools.ts`, MCP `readOnlyHint: false`) replaced `report_outcome`,
  so the server still has 8 builder tools and `list_programs` stays read-only. Input
  (`builder-memory.ts TellInput`, strict, plan Ruling 3): `program_status: [{ program_id, status:
  applied | not_interested | won | placed | lost, project_id?, prize_usd? }]` and `repo_facts:
  [{ repo, mainnet_chains?, testnet_chains?, live_url?, has_users?, not_mine? }]`, at most 20 each;
  chains read like local_repos (`reportedChains`), the link through `reportedUrl` (a placeholder is
  dropped). `tell()` checks everything first (an unknown program, or an outcome's entry that isn't
  this installation's: `NotFoundError`, nothing stored), then writes in one transaction.
- **Tables.** `builder_program_status (installation_id, program_id)` holds `applied` (with the
  program's `roundLabel` = `<starts_at ISO>|<ends_at ISO>`) or `not_interested`.
  `builder_repo_facts (installation_id, repo_key)` holds the merged statements per repo
  (`saidKey`: `owner/repo`, else `name:<name>`; `mergeSaid`: the latest statement about a chain
  wins, testnet wins within one statement, unnamed fields are kept). `readMemory` = two reads on
  the primary keys, once per `list_programs` (and once per `record_submission`'s Also qualifies);
  a failed read is an empty memory.
- **Outcomes.** won, placed, lost (stored `not_selected`) are self-reports (`saveSelfReport`,
  basis `self_reported`) on the `project_id` given, else the installation's newest entry in that
  program. `ask_outcome` now carries `program_id`; `ASK_OUTCOME_NOTE` names `tell_earnkit`.
  Self-reports never alert and never count (`readStats`).
- **Programs hidden.** `hiddenPrograms(memory, programs)` (pure): `not_interested` for good;
  `applied` while the round label matches and the program hasn't opened again since. They leave
  every table, the offer, "Also open", `matches` and Also qualifies (`alsoQualifies({ hidden })`);
  applied ones are listed in "Your entries" as `<title>: applied outside EarnKit`
  (`present.ts APPLIED_OUTSIDE`, `FirstMessage.hidden`).
- **Repos (lowering wins, raising is a claim).** `match.ts applyBuilderFacts(facts, said)`:
  `not_mine` drops the repo (matchProjects skips it before scoring; it still counts in
  `checked`); testnet clears that chain's mainnet; a mainnet the code doesn't show (evidence
  `CLAIMED_MAINNET`), a live link when there is none, and users are claims (`RepoFacts.claims`).
  Plan Ruling 2: a local report's live link or mainnet that GitHub lacks is a claim the same way.
  v2.10 Pre-flight P8: an agent-reported mainnet (`reportedFacts`, `withReportedChains`) and a
  said mainnet over a chain the files only mention are claims too (`basis: 'mention'`,
  `CLAIMED_MAINNET`).
  `matchRepo` turns a would-be `likely` row whose claim is unverified (a claimed mainnet on the
  program's chain, a claimed link with `live_verified !== true`, users on a "needs a live product"
  program) into `after_step` with `confirm: mainnet | live link | users`. `users` clears
  `real_users` from `missing`.
- **Pre-flight P15.** `matchProjects` applies the statements (`MatchProjectsInput.said`, by repo
  key, else by `name:<repo name>`) in `checkRepo`/`checkLocal` before `runChecks`, so a claimed
  live link is probed from the same `LIST_BUDGET` as a homepage; once it loads the row can be
  `likely`.
- **Shared clients (Ruling G6).** `builder-memory.ts memoryKey(ctx)` is the one seam: `{
  installationId, login: '' }` for an installation's own memory, `{ installationId, login }` on a
  `sharedClient` install whose call carries a valid sign-in code (`ctx.verifiedLogin`, see
  "Sign in with GitHub" below), else null (one hosted agent serves many builders). Both memory
  tables are keyed `(installation_id, login, ...)`. With null, `list_programs` and Also
  qualifies read no memory, `tell` stores no program or repo statement, an outcome needs its
  `project_id` (else `NotFoundError`), and the builder sees `Noted for now.` (`NOTED_FOR_NOW`).
- **Shared clients show nothing remembered (Ruling G7).** `tools.ts remembers(ctx)`
  (`!ctx.sharedClient`) gates, on a shared client: the remembered `github_user`, `repos`
  and `local_repos` fallback and `working_on` in `list_programs`; `outcomeToAsk`/`ask_outcome`;
  `openEntries` ("Your entries"), `yourCampaignEntries` (standing) and alerts, including
  `withAlerts` (now `withAlerts(ctx, result)`) on every tool. Entries are still recorded; the
  builder text says nothing about it.
- **Claims verified (Ruling G6).** `runChecks` checks the contracts on a repo's claimed mainnets
  (`claimedMainnets`, their pairs first within `GETCODE_PER_REPO`) even when the live link loads,
  within `LIST_BUDGET` and recency order; `Deployed.withCode` lists the chains with code, and
  `confirmMainnets` turns those claims into facts, so the row can be `likely`. A mainnet claim the
  builder takes back (testnet) leaves `claims`.
- **Copy.** `TELL_EARNKIT_DESCRIPTION` (agent text, under 800 characters), `TELL_SAVED_NOTE`, and
  the applied line are in the copy review; the builder-text tool-name regex
  (`token-launch.ts`) names `tell_earnkit` and `pick_up_entries` instead of `report_outcome`.

## Sign in with GitHub (v2.9 B9, Task 5; Rulings G6 to G9)

Ownership proof for agents that can't push (Grok Bot). Off, with the v2.8.1 behaviour everywhere,
unless `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` are both set (`githubVerifyEnabled`).
A GitHub OAuth App with no scopes; its callback URL is `<EARNKIT_URL>/github/verify/callback`.

- **The link** (`github-verify.ts createVerifyLink`): `<siteUrl()>/github/verify?n=<nonce>`, 32
  random bytes base64url. Table `github_verify_nonces` keeps only `sha256(nonce)`, bound to the
  installation, the entry (`project_id`, null for `pickup`), the repo (`owner/repo`) and the
  purpose (`entry`, `pickup`, `host`); 15 minutes (`VERIFY_TTL_MS`), consumed once by one atomic
  `UPDATE ... WHERE used_at IS NULL AND expires_at > now RETURNING` (`takeNonce`).
- **The browser flow (Ruling G8).** `GET /github/verify?n=` never redirects: it shows a confirm
  page (`Referrer-Policy: same-origin`, so the POST carries a real Origin) (`confirmPage`: the repo, the entry's `$TICKER` and fee wallet, `CONFIRM_WARNING`) and sets
  a per-link cookie `__Host-ekv-<16 hex of the nonce hash>` (HttpOnly, Secure, SameSite=Lax, Path=/,
  15 minutes). Its button POSTs to `/github/verify` (`verifyConfirm`: same-origin check, the form's
  csrf must equal the cookie, `timingSafeEqual`), which 303s to GitHub's authorize URL with
  `redirect_uri` from `siteUrl()` (never the request Host, P47), `state = <nonce>.<csrf>`,
  `allow_signup=false` and no `scope`. `GET /github/verify/callback` (`verifyCallback`) reads only
  `code` and `state` plus that cookie; a missing or mismatched cookie is refused before the nonce
  is used or the code exchanged. Every page is `text/html`, `no-store`, `no-referrer`, no script.
  Per IP: `LIMITS.githubVerify` (30 an hour) on all three.
- **The check** (`completeVerify`): the nonce first (used whatever happens next), then GitHub's
  code exchange, `GET /user`, and only when the login isn't the owner `GET /repos/{o}/{r}` with the
  user's token. `ownershipPasses`: the login is the owner, or `permissions.push`/`admin`. An org
  repo without `permissions` fails (`notYours`): the proof line stays the way. A pass writes
  `github_verifications` (repo, lowercase login, installation, entry, `account_created_at`,
  `public_repos`, purpose) for the nonce's own repo and entry only. The token is never stored or
  logged; errors log the class only. The page says `VERIFY_PAGE.done`.
- **Shared clients: the sign-in code (Ruling G9).** On a shared (hosted) install the success page
  instead shows `Done. Paste this code to your agent: ABCD-EFGH-JK` (10 random base32 characters;
  only `code_hash` is kept, 24 hours). The agent passes it as `signed_in` on `list_programs`,
  `tell_earnkit`, `confirm_entry` and `launch_token`. `callerLogin(installation, code)` is the only
  way a shared call gets a login (nothing anyone can claim, such as a GitHub user, names it).
- **The token gate.** `GateInput.projectId` and `verifiedLogin`; `GateDeps.verified` defaults to
  `verifiedFor({ projectId, repoKey, login })` while the feature is on and returns the sign-in's
  wallet. A pass needs the launch wallet to equal it (Ruling G11), then skips the earnkit.txt reads
  (`ownerProblem`); the repo code check and the wallet screen still run. On a shared client
  (`verifiedLogin` set by `confirm_entry`/`launch_token` from `signed_in`) only that login's
  sign-in counts, and while the feature is on the proof line is never read there (Ruling G10: the
  line is the whole agent's): `SIGN_IN_FIRST` (`sign_in: 'needed'`). A sign-in for another wallet
  gives `WALLET_CHANGED` (`sign_in: 'wallet_changed'`; the reply adds "Sign in again: <link>").
  Elsewhere any sign-in of that entry, or the proof line. With the OAuth variables absent, the
  proof line works everywhere as before.
- **The wallet binding (Ruling G11).** An `entry` link needs the fee wallet (`createVerifyLink`
  throws without one; the flow asks for the wallet before the gate). The nonce snapshots the wallet
  and ticker; the confirm page shows them (never "none yet"); the verification copies them.
- **The confirmation.** `confirmDecision({ signIn })` returns `sign_in` (not `record_only` with
  `CANT_PUSH`) for `canPush: false`; `confirmOffer({ signIn })` shows the normal token offer (P9).
  `confirm_entry` runs the flow for `sign_in` like `launch`; on the proof-line miss it creates an
  `entry` link and shows `signInLine` ("One click to prove TipJar is yours, then $TIP launches:
  <link>"), `token.fixable`, `token.sign_in`, no kit, `SIGN_IN_NOTE` (plus `SIGN_IN_CODE_NOTE` on a
  shared client). A second "go" still unproven (`proof_line_missed`) returns the kit plus a fresh
  link and the launch stays open (P10). An agent that can push gets the link only after a
  proof-line miss, beside `proofLineWaiting`. `prepare_submission` and the wallet question treat a
  can't-push agent as able to launch while the feature is on. `launch_token` adds `sign_in` and
  `sign_in_line` to a proof-line `gate_failed` (`entryVerifyLink`).
- **Identity linking (P8).** `offerPickup` stores `at` in `PickupState`. `answerPickup` accepts a
  `pickup` verification of the offer's repo by its own installation made after `at` in place of
  its proof line; its `needs_proof` reply carries `sign_in` (the pick_up_entries reply shows
  `PICKUP_TEXT.signIn` and the link). `provenRoots` (F13) also counts a group with a
  `github_verifications` row for the repo. C2 holds: hosted groups never pick up.
- **Hosting (P11, for T8).** `takeHostVerification`: on a shared client a `host` verification is
  single-use (`used_at`) and lasts 15 minutes; elsewhere the installation-plus-repo binding holds.
  `verifiedFor` never counts a used one and is never unscoped.
- **Memory and entries on shared clients (G6, G7).** `list_programs` and `tell_earnkit` resolve
  `signed_in` (`sharedLogin`) into `memoryKey({ ...ctx, verifiedLogin })`: statements are stored
  and read under that login. "Your entries", campaign standing and the outcome question show only
  the entries that login signed in for (`verifiedEntryIds`; `openEntries`, `yourCampaignEntries`
  and `outcomeToAsk` take `onlyIds`). The remembered `github_user` fallback is the login itself.
  Alerts, `working_on`, fit repos and match_shown stay off on shared clients (installation-wide
  state). Outcomes on a shared client still need their `project_id`.
- **Cookies (Ruling 7).** The sign-in cookie is the only one EarnKit sets, and it is `__Host-`
  (a source scan in `security-headers.test.ts`); HSTS keeps no `includeSubDomains`.

## Private repos and the read-only GitHub App (v2.10 items 7, 7b; R8 to R10)

- **Per-repo reads (item 7).** `matchProjects` reads named repos one by one (`mapLimit`, 6 at a
  time), each caught on its own. A 404: `MatchDeps.appToken(fullName)` (the App, below); without a
  token, a `local_repos` report with the same repo key is scored from the local view (`checkLocal`)
  and its name goes in `fromLocal`; with neither, the repo goes in `unseen` (`{ name, full_name }`).
  Any other error (a 403 rate limit, a 5xx) skips only that repo and its local view (Review Focus 1);
  when every named repo failed that way, the first error is thrown (`list_programs` keeps its
  "Couldn't read your repos" line). `present.ts privateRepoLines` puts one `PRIVATE_LOCAL_LINE` per
  `fromLocal` name and one `CANT_SEE_LINE` for the first unseen repo before the matched table; the
  link appears only while the App is on. Final fix M5: the can't-see line is declarative ("I can't
  see TipJar (private?). Allow read access: <link>", no "Describe it"), so the lead keeps the
  reply's one question. The `local_repos` instruction (mcp.ts) asks for name,
  chains, contracts, live link and last commit for private repos. Ruling H5 replaced P30's cap: a
  live, active local-only repo on a chain with no known count is good odds and can lead (journey
  11.1). With a local view (now or remembered) `find` shows the private line, never the App link;
  the link comes with the can't-see line (no local view) and the launch gate's refusal.
- **The App (item 7b).** Off unless `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY`
  (a PEM; `\n` escapes allowed) are set and the v2.9 sign-in is on (`githubAppEnabled`, P17). A
  GitHub App with Contents: read and Metadata: read only. Its setup URL is
  `<EARNKIT_URL>/github/verify/app` (setup on install; turn on "Redirect on update" so a builder who
  already installed it can add a repo). The private key is never stored in the database, logged or
  returned; `appJwt` signs a 10-minute RS256 JWT per call, and `installationToken` mints a 1-hour
  token for one repo (contents and metadata read) per call. Errors carry the HTTP status only.
- **The proof flow (R8, Pre-flight P3).** `list_programs` (first unseen repo) and the gate (a repo
  GitHub won't show) make an `app` nonce (`createVerifyLink`, no wallet: no launch rides on it). The
  v2.9 confirm page and OAuth run as before. In the callback, `completeVerify` sees the `app`
  purpose before `takeNonce`: `appSignIn` exchanges the code, reads `GET /user`, stores `login`,
  `account_created_at` and `public_repos` on the nonce (once: `login IS NULL`), and 303s to
  `installUrl(slug, nonce)` without clearing the `__Host-` cookie. GitHub then sends the builder to
  the setup URL (`appSetup`): no cookie, or an installation id that isn't a number, is refused
  before the nonce is used; `takeNonce({ purpose: 'app' })` takes only an `app` nonce with a stored
  login; `appProof` passes when the installation lists the repo and its account is the login, or
  the login's collaborator permission is `admin`. A pass writes `github_verifications` with
  `purpose = 'app'`, `via = 'app'` and `github_installation_id` (`saveVerification`; on a shared
  client the page shows the one-time code, G9).
- **What it grants (R9, P11).** Reads only. `appTokenFor({ installationId, login, repoKey })`
  finds the newest `via = 'app'` proof for this installation and repo (on a shared client only the
  caller's login; `null` login: none) and mints a token; `list_programs` passes it as
  `MatchDeps.appToken`, and the gate as `GateDeps.appToken`. Through it, `repoCodeFacts(fullName,
  { token })` reads a private repo instead of refusing it, and the tree, README, config files
  (contents API, raw media type, P10) and commit reads all go through the token, so a private repo
  gets full scoring. `verifiedFor` never returns an App row unless `purpose: 'app'` is asked for, so
  the launch still needs the v2.9 proof line or a wallet-bound sign-in (G10, G11 unchanged).
- **Public repo URLs (Ruling H6, fix round 1; supersedes P4 for display).** A public page shows a
  repo URL only when GitHub said the repo is public within the last 7 days (`PUBLIC_READ_DAYS`): a
  read without an App token answering `private: false` (`checkRepo` through `MatchDeps.cache.public`,
  and the gate's default `repoCodeFacts` read via `RepoCode.public`) upserts `repo_public_reads`
  (`markRepoPublic`, keyed by `normalizeRepoUrl`, outliving the 1-day facts purge). `/p`
  (`getProjectPage`), `/campaigns` (`getCampaignBoard`, its rows and review), `/bonus` (open and
  frozen rounds) and the sponsor tool's entries filter through `publicRepoKeys`/`publicRepoUrl`.
  Never read, a failed read, a stale read, or a failed lookup shows the project name only (fail
  closed). So a private repo matched only from the local copy never shows its URL.
- **App rows stay with their prover (fix round 1, I2).** `cachedRepoChains` and
  `cachedRepoAddresses` take an `AppViewer` (`tools.ts appViewer`): a `via_app` row reaches only an
  installation with its own `via='app'` proof of the repo (on a shared client only that login); no
  viewer sees public rows only. `loadRepoFacts` returns a `via_app` row only to a read through an App
  token (`{ viaApp: true }`).
- **Link reuse and cleanup (fix round 1, concern 4).** A nonce is `HMAC-SHA256(EARNKIT_AUTH_SECRET,
  seed)` with a random `seed` stored on the row (only the nonce's sha256 is stored, as before).
  `createVerifyLink` shows an open link again (same installation, purpose, repo, entry, wallet and
  ticker; unused, no OAuth hop started, 5+ minutes left), never on a shared client. The cron's
  cleanup step (`sweepVerifyNonces`, `sweepPublicReads`) deletes links expired over a day ago and
  public reads past 7 days, at most 1000 rows each a run.
- **Public pages and tokens.fun (R10, Pre-flight P4, P33).** A repo is private on evidence only: a
  `github_repo_facts` row with `via_app = true` (`startEntry` sets `projects.repo_private`; once
  true it stays), or the gate reading it through the App (`GateResult.private`, set with the launch
  claim in `deployToken`). No facts row means public. The `/p/<id>` query, the campaign board and
  the bonus board return no repo URL for a private entry (the project name only). `deployToken`
  sends `website` = the live link, never the repo URL, for a private repo. `SAFETY_LINES` now says
  "A token needs a repo you prove is yours".

## Row difficulty, alert precision and the outcome loop (v2.9 A4, A6, A7, A8, Task 4)

- **Program level (`guide.ts difficultyOf`, Pre-flight P30).** Still odds, override or estimate,
  then two floors in `difficultyFrom`: an `investment` program is Hard; a `needs a live product`
  program (`NEEDS_LIVE_PRODUCT`) is at least Medium, even with an EarnKit rating. A program whose
  `match_precision` is under 5% (`LOW_PRECISION`, A8) is then one step harder (`harder`; not an
  estimate; the basis adds "under 5% of strong matches won"). The landing page,
  guides, "Also open" and Also qualifies show this level. `programs:check` refuses an Easy
  `difficulty_override` (rated or stated) on a `needs a live product` program
  (`program-file.ts` superRefine). Base lost its EarnKit Easy rating (A6): Medium (estimate).
  v2.10 item 10: so did Avalanche Team1 Mini Grants (Medium (estimate); a row missing real users
  without a live link is Hard), and `programs:check` refuses an EarnKit rating (`rated_by:
  'earnkit'`) on a program paying over $1,000 per winner (`max_award_usd`) unless a past round has
  both `submissions` and `winners` (sourced odds). Arc Microgrants ($500) keeps its rating.
- **Row level (`rowDifficulty`, pure).** A matched row = max(program level, distance). Distance
  from the verdict's effort: none/minutes Easy, hours/days Medium, weeks Hard; with `real_users`
  missing, distance comes from the other missing items (`match.ts effortOf`, Pre-flight P2), then
  `real_users` makes the row Hard while unverified, Medium after a verified link or a users claim.
  Match precision reaches the row through the program level only.
  `present.ts rowLevel(card, fit, v)` computes it per matched row (`Fit.row`); the matched table's
  Difficulty cell, the row sort and the closing offer (`bestFit`) use it: easiest first, then
  prize, then the quicker fit.
- **Alerts (`alerts.ts alertFit` / `alertable`, pure).** A new curated program is alerted only when
  one remembered repo could win it: tier fits (product for any_chain or investment, project or
  better otherwise); `matchRepo` gives `likely`, or `after_step` with effort hours or less and no
  `real_users`/`new_work` missing; the row is not Hard unless $10,000+ per winner
  (`HARD_ALERT_USD`) and product tier; not entered (any `projects` row of the installation), not
  applied or not interested (`builder_program_status` via `hiddenPrograms`); 3 or more days left
  (`ALERT_MIN_DAYS`). `alertFit` returns the repo (Pre-flight P14, for the weekly email).
  Investment programs are always weeks away, so they are never alerted.
- **Fit repos (`installations.fit_repos`, replaces `fit_chains`).** `list_programs` builds a
  `FitRepo` per matched fit (`alerts.ts fitRepoOf`, from the merged facts, P13; a live link only
  the builder gave stays in `said`, so it remains a claim) and `setFitRepos` keeps the 5 best
  (`bestFitRepos`: owned, project tier or better, highest score). Not written on a shared client
  (Ruling G7). `alertFacts` refreshes each repo's `said` from `builder_repo_facts`, so a later
  "not mine" or "testnet only" wins. A linked installation keeps the root's list, else the other's.
  Only repos that fit some program are remembered (as `fit_chains` before).
- **Outcome loop (`match-loop.ts`, inside `programs:sync`).** `list_programs` records the matched
  rows on screen in `match_shown` (not on a shared client, Ruling G7; `recordShown`, one row per installation, program, repo key and
  UTC day; the latest wins). `confirm_entry` (not on a shared client) stores `projects.product_score` from the latest
  `match_shown` score for that repo (`saveEntryScore`; the GitHub cache keeps no builder-dependent
  signal). `updateMatchFloors` (after the outcome files) takes each entry's latest announced result
  other than `unknown` (never a self-report, never an owner test installation), the status its repo
  was last shown with on or before entry, and per program `matchStats`: `match_floor` = lowest
  winning product score, `match_precision` = wins or places among `likely` rows / `likely` rows.
  Written only at `WIN_RATE_MIN_LABELLED` (30) labelled entries; others are set back to null.
  `matchRepo` caps a repo below `match_floor` at `after_step` (`BELOW_FLOOR_NOTE`: "winners so far
  had a live product and recent commits"), said before the project-tier note.


## The token offer right after the match; only the token is skippable (v2.9 B10, B11, Task 6)

_Retired in v4.0 (coin offers, Backing, the confirm tool; see "v4.0 Task 11" and "v4.0 overview" at the end). Kept as history._

_Superseded by v2.10 item 5: there is no first-reply offer; the token is pitched once, in the confirm line (see "One bonus line, the token at confirm, the deadline line"). The text below is kept as history._

- **The offer (`present.ts tokenOffer`, pure).** The first reply ends with "TipJar fits Arc
  Microgrants: $500. (Ruling G15 M2: "fits" only for a likely row; a row one step away reads
  "TipJar is one step from Arc Microgrants: $500.", `TokenOfferFacts.oneStep`, and a likely row is
  picked before one a step away. On a shared client there is no first-reply offer while the GitHub
  OAuth variables are unset, since a hosted agent could not accept it.) Launch $TIP (TipJar) on Base now? You earn 40% of its trading fees, plus a
  shot at the builder bonus. yes / skip". With no wallet known, the end is "Say yes with your
  wallet address, or skip." `FirstMessage.tokenOffer` replaces the closing offer and the token
  line (`bonusClose`), so the reply has one offer and says "40%" once.
- **The pick (`present.ts tokenOfferFit`, Ruling 12, pure).** It takes the first matched row in
  table order where all of these hold:
  - the repo has a GitHub link, is product tier, and is owned (`owned` not missing);
  - the verdict is `likely` or `after_step`, with effort `none`, `minutes` or `hours`;
  - the program is curated (not sponsored, an EarnKit campaign or an investment), its
    `token_policy` is not `off`, and it has a known per-winner prize;
  - the builder has no entry in the program, and has not hidden it (applied or not interested);
  - the repo has no token (`repoCoins`) and is not blocked (declined twice).
- **`list_programs` (`tools.ts firstTokenOffer`).** It runs only while launches are configured.
  It reads `token_declines` and picks the fit. It names the token with the pair already in
  `token_offers` for this program and repo, else `proposeToken` (`ctx.tokenDeps.check` in tests).
  It stores the pair with `saveOffer`, so later offers name the same token.
  - **Wallet:** "known" only when remembered on a non-shared client (`walletMemory`, G7).
  - **Reply:** `token_offer: { program_id, repo_url, project_name, proposed, agent_note }`.
  - **Errors:** any error drops the offer, never the reply.
- **`launch_token` with `offer` (`tools.ts launchFromOffer`, Ruling G13).** `LaunchTokenInput` takes
  exactly one of `project_id` or `offer`, plus `decision` (default `go`) and `agent: { can_push }`.
  `builder_confirmed` is required for `go` only. `mcp.ts` registers the same fields (P45).
  - **`skip`:** a decline (G12), and no entry is made.
  - **Program check:** the program filters are checked again (open, not a campaign, sponsor's or
    investment, a known prize, tokens on); otherwise "No token for this entry."
  - **The pair:** only an offer stored in `token_offers` launches ("Nothing launched: this token was
    not offered yet." otherwise). A name or ticker other than the one shown is offered again
    (`present.ts tokenOfferAgain`, no "40%") and stored; nothing launches.
  - **The wallet:** a wallet is needed. It is the remembered one the line named (G13 I1:
    `token_offer.shown_wallet`, non-shared only, G7), or one given with the yes. Without it the
    wallet is asked for, and no entry is made.
  - **The gate first:** `tokenGate` runs before any entry is made. A failure returns its words and
    leaves no row. With sign-in on, a sign-in stop also returns an `entry` link with no project,
    bound to the repo, this wallet and the ticker (G11).
  - **After a sign-in:** such a sign-in (`github-verify.ts offerVerification`: this installation,
    repo and wallet, and the caller's login on a shared client) stands in for that first gate.
  - **Once proven:** `startEntry` makes the draft (choice `go`, the 20 a day only for a new row).
    `claimOfferVerification` binds the sign-in to it, and the usual `launchToken` runs, with the
    gate, one token per repo and the limits. A retry returns the existing token.
- **Declines (`token-offers.ts recordDecline`, `declines`, table `token_declines`).** Declines are
  counted per installation, builder `login` and `repoKey` (owner/repo, P7). `confirm_entry` "skip"
  on a token offer also counts one. Ruling G12:
  - **Once per offer shown.** A skip counts once per offer identity (`offerIdentity`: the
    program plus `token_offers.offered_at`). `offers` keeps the identities already counted, so a
    retried skip changes nothing.
  - **Login.** It is '' off shared clients. On a shared client it is the verified login of the
    pasted code (`memoryKey`). Without a code nothing is recorded or read, so one Grok Bot user's
    skips never stop another user's offer.

  Ruling G14 (M2): after one skip, the first reply never offers that repo again; only the
  confirmation offers it once more.

  Ruling G14 (M1): `token_offers.first_reply_at` marks an offer shown by the first reply. It stays
  when a later offer replaces the pair. When set (`firstReplyShown`, `offerFacts.firstShown`), the
  `prepare_submission` and `confirm_entry` offers use the repeat Yes line, so an unanswered first
  offer keeps "40%" at once per flow. A second `list_programs` call before the builder answers
  repeats the first-reply offer without the earnings sentence (`TokenOfferFacts.again`).

  `offerFacts` reads the count:
  - **One or more (P21):** the next Yes line is `again` (no "40%"), in `prepare_submission`, the
    `confirm_entry` offer and the reoffer.
  - **Two (P23):** the first reply never offers that repo again, and `prepare_submission` and
    `confirm_entry` treat the repo as tokens off: "Ready to submit?", and "go" gets the kit with
    "No token for this entry."
- **Token already here.** `offerFacts.tokenHere` is set when the repo's token is this program's
  (launched from the first reply's offer). The later offers are then "Ready to submit?" alone, so
  "40%" stays once per entry flow (test 6.8).
- **Only the token is skippable (B11).** Copy review 6.9: "skip" appears in builder text only in
  token offers (`tokenOffer`, `SKIP_LINE`, `confirmOffer`, `coinRow`, `tokenRow` (P33)). The
  policy page now reads "Say no when your agent offers it". The coach asks only required fields
  (6.10, a regression guard, P34).
- **v2.8.1 journey (P22).** J1's fixtures stay below product tier, so the first reply keeps the
  v2.8.1 close and the first "40%" stays in the Base draft.

## v2.9 Needed, Part 1: what ships, settings, runbooks and the journeys (Task 12, Ruling G1)

Spec: `docs/design-docs-and-implementation-plans/v2.9-needed.md`. Ruling G1 ships it in two parts.
Part 1 (this section) is T1 to T6, T9 and the Part 1 slice of T12. Part 2 (hosting, the weekly
email, one money figure, `/terms`, the G0 minors) is in "v2.9 Needed, Part 2" below. Each piece is
documented in its own section; this is the map.

**Matching (what "What can I earn?" shows).**
- Ownership and the score: only the builder's own repos are scored (never EarnKit's kits, forks,
  templates or archived repos; a tutorial-like name only costs the `original` point, Ruling G15;
  a contributed repo needs 30% of its last 100 commits),
  at most 8, newest first. Each gets the 6-signal real-product score and a tier (product, project,
  noise). See "Owned repos and the real-product score".
- Statements and claims: `tell_earnkit` stores what the builder said. What lowers a match (applied
  outside EarnKit, not interested, testnet only, not mine) counts at once; what raises it (mainnet,
  a live link, users) is a claim, shown as "confirm: ..." until a check clears it. See "Builder
  memory: `tell_earnkit`".
- Row difficulty: a row is never easier than its program and is harder when the repo still needs
  something. Base is no longer Easy; a "needs a live product" program is at least Medium. See "Row
  difficulty, alert precision and the outcome loop".
- Verification and its cache: live links are probed and contracts read with getCode under small
  budgets, cached in `url_checks`. A placeholder link is refused; a link that doesn't load leaves
  the entry not complete. See "Link and contract checks".
- Alert precision and the outcome floor: new program alerts fire only for an owned, scored repo
  that could win (`fit_repos`); `match_shown` and the announced outcomes set each program's
  `match_floor` and `match_precision` in `programs:sync`.

**The GitHub sign-in.** A one-time nonce link (15 minutes, sha256 stored), a confirm page bound to
the browser by a cookie, no scopes asked. It replaces the proof line for agents that can't push. On
a shared (hosted) client the page shows a one-time code (24 hours) that the agent passes as
`signed_in`; only that login's sign-in counts there, and the sign-in names the payout wallet.
See "Sign in with GitHub".

**The token offer.** The first reply ends with one token offer for the best owned, product-tier
fit (never on a shared client while sign-in is off, Ruling G15). A yes launches it (one entry, one launch); one skip ends the first-reply offer for that repo
and the confirmation offers it once more. "40%" shows once per entry flow. See "The token offer
right after the match".

**Claims and the gas alert.** The hourly cron claims creator (40%) and MINI (10%) fees to their own
addresses after EarnKit's own payouts, at 10x gas or more, and logs each claim in `fee_claims`.
`fee_claims` is an ops log, never revenue: no stat reads it. A payout wallet under
`GAS_WALLET_MIN_WEI` puts `bonus-ledger` in `needs_owner`. See the bonus ledger's "Claim" and "Gas
check" steps.

**Settings. Each feature is off while its variables are absent.**

| Variable | Feature | When absent |
|---|---|---|
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | Sign in with GitHub | The routes answer 404; the proof line is the only proof; a can't-push agent hears "open this in Claude Code or Cursor"; a shared client gets no first-reply token offer |
| `GAS_WALLET_MIN_WEI` | The gas alert's floor | 0.002 ETH |
| `ARC_RPC_URL`, `BASE_RPC_URL`, `MONAD_RPC_URL`, `TEMPO_RPC_URL`, `AVALANCHE_RPC_URL`, `ROBINHOOD_RPC_URL` | getCode for contract checks | Each chain's public RPC from its docs |

**Runbooks (Part 1).**
- **At ship (Ruling G16).** The payout wallet held 0.00037 ETH at the final review, under the
  0.002 ETH default. Set `GAS_WALLET_MIN_WEI=100000000000000` (0.0001 ETH) on Railway before the
  deploy, so the first hourly cron does not answer 503, and have the owner top up the payout
  wallet (an owner top-up, never a builder one). Check its Base balance read-only before merging.
- **A 503 from `/api/cron` with `bonus-ledger` and "is low on ETH for gas".** The payout wallet
  holds less than `GAS_WALLET_MIN_WEI`. Send ETH on Base to the address named in the note. The
  note ends with "Payouts resume once it is topped up." and the next run clears it.
- **A 503 with a claim result "the payout wallet needs ETH for gas".** Same fix.
- **A builder says the sign-in link failed.** Links last 15 minutes and work once: have the agent
  ask again for a fresh one. A sign-in only counts for the repo, ticker and wallet it named; a new
  wallet needs a new sign-in.

**The journeys (`v29-journey.test.ts`).** DB-gated, in a throwaway database of its own, every real
program file. Only the outside world is mocked: GitHub (REST, raw files and the OAuth endpoints,
through the real verify routes), tokens.fun (behind the real `deployToken`), the link probe and
getCode (`verify.ts checkDefaults`, with the real `url_checks`), and the chain under the cron's
claims. Every other fetch gets a 503.
- 12.1: a Claude Code builder with a real product on Arc, plus a fork, a tutorial, an archived repo
  and an EarnKit kit. Only TipJar shows; Arc is Easy; the first reply ends with the token offer; the
  yes launches once; the entry completes. 12.1b: noise only, so no row and no offer.
- 12.2: Grok Bot (shared client) with sign-in on. The offer asks for the wallet; the yes gives the
  sign-in line; the browser sign-in returns a code; without it nothing launches; with it `$TIP`
  launches. 12.2b: sign-in off, so no first-reply token offer (Ruling G15), the usual close, and
  an offer never shown launches nothing.
- 12.4: statements lower (applied, not interested, testnet only) and raise (a mainnet claim cleared
  by a contract with code; users stays "confirm"); Base returns once its round changes.
- 12.5: placeholders are refused or dropped and never probed; a link that doesn't load keeps the
  entry not complete.
- 12.6: the offer, a skip, then the confirmation: "40%" once, "skip" only in offers.
- 12.7: a cron run claims every launched token's creator and MINI to themselves, logged in
  `fee_claims`, and no stat moves.
- Across every reply: no emoji, em dash, "coin", "vault", "Clanker" or tool name in builder text,
  every reply under 50 s, and no other network use.

The v2.8.1 journeys (`v281-journey.test.ts`) still pass unchanged on Part 1.

## The host Worker (v2.9 C12, C14 on the Worker side, Task 7)

- **Where.** `infra/host-worker/` is a Cloudflare Worker (free plan) outside the Next build. The
  owner deploys it by hand with `wrangler deploy`; nothing in CI deploys it. Routing lives in the
  pure `src/route.ts` (tested in Node by `pnpm test`, typechecked by `pnpm host:typecheck`, P42:
  Worker code without Node types, then the tests with them);
  `src/index.ts` only passes `caches.default` and `ctx.waitUntil`.
- **Shared names.** `apps/frontend/lib/earnkit/host-names.ts` (import-free) holds `HOST_RESERVED`,
  `HOST_CSP`, `HOST_HEADERS`, `SITE_PREFIX` and `STATE_PREFIX`. The Worker imports it by relative
  path (wrangler bundles it); the hosting code (Task 8) imports it too, so the two never drift.
- **Host to slug.** The `Host` header must be exactly one label under `ZONE` (lowercased; a port
  and a trailing dot are dropped) and not in `HOST_RESERVED` plus the `RESERVED` var (comma list:
  every existing DNS name, the same list as `EARNKIT_RESERVED_SUBDOMAINS`, P41). Anything else is a
  404 before any R2 read or cache lookup. Reserved names also get exclusion routes, so they never
  reach the Worker.
- **Path to key.** `sites/<slug>/<decoded path>`; `/` and a trailing `/` add `index.html`. A path
  with a `.` or `..` segment (also `%2e%2e`), `//`, `\`, a control byte or bad percent-encoding is a
  400 with no read. A missing extensionless path whose `<path>/index.html` exists is a 301 to
  `<path>/` (Ruling G17, so relative links resolve; the path-only `Location` keeps the query);
  otherwise the site's `404.html` (404), then a plain 404.
- **State (Ruling 9).** On a cache miss the Worker reads `state/<slug>.json`, cached per slug for
  60 s under `https://<slug>.<zone>/?earnkit-state` ("none" when absent): `live` serves files;
  `review` and `killed` serve `TAKEN_DOWN_PAGE` and `ended` serves `ENDED_PAGE`, both 410
  (`no-store` to browsers); no state, bad JSON or any other status is a 404 (fail closed).
- **Cache and R2 reads (review I2, "never bills").** Keyed by `https://<slug>.<zone>/<decoded
  path, each segment re-encoded>`, never a query, so Host spelling, query and percent-encoding
  can't split or bypass it, and no file name can reach the state entry. 200s live 240 s, 404s and
  301s 60 s, and the site's `404.html` lookup has its own entry. A takedown shows within 300 s
  (60 s state plus 240 s file). Repeats read nothing; a flood of distinct missing paths costs at
  most 2 reads a request, about 6M a month at the 100k-a-day Worker cap (R2 free: 10M). HEAD
  fills the cache like GET. A new or redeployed slug can show a cached 404 for up to 60 s.
- **Headers.** Every response (files, 400, 404, 405, 410, 500 and cache hits) gets `HOST_HEADERS`
  set last: the sandbox CSP (`sandbox allow-scripts allow-forms allow-popups allow-modals;
  form-action 'self'`), `X-Frame-Options: DENY`, `nosniff` and `no-referrer`, the 301 included.
  Only GET and HEAD are served (405 with `Allow`). Errors are logged by name only. The Content-Type comes from the key's extension (`contentTypeFor`),
  not from R2 metadata.

## Hosting on the server (v2.9 C12 to C15, Task 8)

- **Where.** `lib/earnkit/hosting.ts` (pure rules, the zip reader, the flows and the two route
  handlers), `r2.ts` (an aws4fetch S3 client: put, list, delete; `r2Enabled`), `free-tier.ts`
  (hard caps), and `app/api/host/upload` and `app/api/host/takedown`. Everything is off while any of
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` or `R2_BUCKET` is missing (routes 503,
  `host: { unavailable }`, the cron step skipped), and the upload URL also needs GitHub sign-in on.
- **Getting an upload URL (Ruling 8).** `prepare_submission` with `host: true` returns `host`:
  `{ sign_in_url, show_to_builder, agent_note }` when the repo has no host sign-in (purpose `host`);
  `{ upload_url, expires_at, agent_note }` (one use, 15 minutes, only the sha256 in
  `host_upload_tokens`) once the gate and the limits pass; else `{ unavailable: <plain line> }`. The
  upload URL is never in builder text. P11: on a shared client the host sign-in is consumed by one
  upload URL and must be under 15 minutes old (`takeHostVerification`); elsewhere the installation
  plus repo binding holds. Gate: account 30 days or older, at least 1 public repo.
- **Slug.** `slugFor(project, login)` (P40): `<project>-<login>`, lowercase, runs to `-`, 63 at most,
  never `HOST_RESERVED`, the `EARNKIT_RESERVED_SUBDOMAINS` list (P41) or punycode (G19). A redeploy
  keeps the repo's slug while the same login owns it; a repo has one site (a deploy for a new slug
  ends the old one); a killed site or repo can't come back; another repo's live slug is refused.
- **The upload (untrusted).** The route allows 10 uploads an hour per IP (`LIMITS.hostUpload`, 429),
  refuses a declared `Content-Length` over 25 MB (413), then takes the token's attempt (one of 5)
  before it reads the body (Part 2 final review I2: parallel posts on one token read at most 5
  bodies; an unknown or spent token costs no read), and stops reading past 25 MB (413). `readZip` trusts only the central directory (names, sizes, folders, Unix
  symlink bits), refuses ZIP64, encryption and methods other than stored or deflate, runs
  `zipProblems` (500 files, 10 MB a file, 25 MB total, static extensions only, no archives or
  executables, no `..`, `.`, `//`, leading `/`, `\` or control bytes, no duplicates in any case, an
  `index.html` at the root after `stripTopFolder`), then inflates each file with fflate's streaming
  `Inflate` in 1 KB pushes, stopping as soon as a file passes its declared size or 10 MB, or the
  site passes 25 MB: a zip bomb is never inflated in memory.
- **Checks and writes (fix round 1).** The attempt the route took (5 at most per link), the gate again
  (the login's newest sign-in), UTF-16/32 pages refused, then `abuseFlags` on HTML, JS and SVG (text
  as a reader sees it: tags gone, entities and spaces collapsed) and `withBadge` on HTML (Ruling 11).
  `.xml` is not hostable. Under one advisory lock, before any R2 write: the slug (killed, another
  repo's, or the repo's other live site), one deploy at a time per slug and per login (`deploying`
  under 10 minutes), 3 sites per login (live, review and `deploying` rows), stored bytes under 8 GB
  (published sites plus every `deploying`, `review` or `failed` deploy's bytes), R2 counter room (read
  on the locked transaction, so deploys queued on the lock can't starve it of a pool connection), the
  token's one use, then the `host_deploys` row (`deploying`) and, for a site with nothing live, its
  `hosted_sites` row (`deploying`). A refusal before the token's use never spends it. Each batch of
  keys is recorded on the deploy row (`written`) before it is put.
  - A clean zip for a site with nothing live goes straight into `sites/<slug>/`, stale keys go, and
    the `live` state is written last.
  - A flagged zip, or any redeploy of a live site, goes to `staging/<slug>/<deploy id>/`, which the
    Worker never serves. A clean redeploy is then copied into place (`R2.copy`, Class A); a flagged
    one waits (`host_deploys.status = 'review'`, a new site's row `review` with nothing served, a
    live site untouched) until the owner approves (`approveSite` copies it into place) or kills it.
  - A failure marks the deploy (and a never-published site) `failed`; its bytes count until the
    cron's `cleanDeploys` deletes its recorded keys (never a live site's served files) and marks it
    `cleaned`, but never while another deploy of the slug is `deploying` (final review M3). A deploy
    `deploying` for over 10 minutes counts as failed; if it was only slow, its publish finds it failed
    and leaves it so (502, cleaned by the cron; the repo can deploy again, M2). A takedown that lands
    mid-deploy wins: the publish step sees `killed` and takes the site down again. `approveSite`
    refuses while a deploy of the slug is in flight (M6).
  - Then `hosted_sites` goes `live` (expiry from `siteExpiry`) with a passing `url_checks` row for
    `url:https://<slug>.earnkit.com/` (G19, P39). Replies: `liveLine` (plus `STORAGE_NOTE` for the
    agent), `HOST_REVIEW`, `HOST_FULL` (507), or a plain refusal. Errors log the class only.
  - A new upload link revokes the repo's unused ones; on a shared client the host sign-in is used
    only when a link is issued.
- **Free tier (`free_tier_usage`).** `takeFreeTier(name, n)` moves a counter only while it stays at or
  under its cap, in one statement: `r2Writes` 900k a month (every put and list page takes 1 first;
  deletes are free on R2), `resendDay` 100, `resendMonth` 3,000. A refused take throws
  `FreeTierFull`, which the builder sees as `HOST_FULL`.
- **Expiry (Ruling 10).** `siteExpiry`: the latest end among the programs the repo entered plus 7
  days, null while an entered rolling program is active, else upload plus 7 days, and never before
  upload plus 7 days. Recomputed on deploy and when `confirm_entry` or `record_submission` records an
  entry (`refreshSiteExpiry`). The hourly cron (`expireSites` then `cleanDeploys`, after the fee
  refresh, R2 on) checks 50 sites with no expiry a run, least recently checked first
  (`expiry_checked_at`, so none starves), setting `now + 7 days` once their programs all ended; then
  ends up to 20 due sites a run: `ended` state first, served and staged files deleted, row `ended`,
  the url_checks row removed. `cleanDeploys` cleans 10 failed deploys a run and prunes tokens a day
  past expiry and finished deploy rows over 30 days old. While the R2 counter is full, ends wait for
  the next month (they need a put and a list).
- **Owner.** An upload in review adds `host-review:<slug>` to the cron's `needs_owner` (503 hourly
  until reviewed, P46). `POST /api/host/takedown` (Bearer `ADMIN_VETO_SECRET`, JSON `{ slug, action }`):
  `kill` (default) writes `killed` before deleting served and staged files, also for a slug that has
  R2 objects but no row; `approve` copies the newest upload in review into place and sets it live.
- **Known limits.** A clean redeploy of a live site that fails mid-copy can leave the site a mix of
  old and new clean files until the next deploy (the Worker has no versioned prefix). A takedown of a
  slug with objects but no row writes `killed` in R2 only (no row can hold it).

## The weekly email and "Builders using EarnKit won $X" (v2.9 E19, E20, Task 10)

- **Where.** `lib/earnkit/digest.ts` (all of it), `app/api/digest/unsubscribe`, the cron step in
  `cron.ts`, the question in `bench-find.ts` (`benchMoveUp`, v3 Stage 1), the answer in `tell_earnkit`
  (`weekly_email`), and `digest_subscriptions` plus `installations.digest_asked_at` in the schema.
  Everything is off while `RESEND_API_KEY` or `EARNKIT_AUTH_SECRET` (it signs the unsubscribe
  link) is unset: no question, `tell_earnkit` saves nothing ("The weekly email is not available
  yet."), and the cron skips the step. `DIGEST_FROM` overrides `EarnKit <digest@earnkit.com>`.
- **Whose subscription (Ruling G21).** One row per (installation, login): login `''` on a normal
  install (one subscription), and on a shared client (hosted agent) the GitHub-verified login of the
  pasted `signed_in` code (G9). A row without an email is a question asked or a "no"; an opt-in always
  has an email (CHECK).
- **The question (Ruling 13, P16, G21).** Asked once per installation (`digest_asked_at`, set with
  `UPDATE ... WHERE digest_asked_at IS NULL RETURNING`), on a shared client once per login (the
  row's `asked_at`, `INSERT ... ON CONFLICT DO NOTHING RETURNING`) and never without a code, as the last line of the reply that brings the
  submit kit (`confirm_entry`) or records the entry (`record_submission`), plus the agent note "Pass
  the builder's answer to tell_earnkit as weekly_email." The entry's email answer (a field of type
  email, or a contact field labelled email) is kept unopted with the question. Non-shared clients:
  the question names no address, and a plain yes uses the kept one. Shared clients: the question names
  only an address typed in this entry (never one the answer bank offered back), and the agent note asks
  for `signed_in` too. Every answer changes only the caller's own row; on a shared client without a
  code nothing changes ("The weekly email needs your GitHub sign-in on this agent."). A plain yes with
  no kept address is "Which email should I use?". "no" clears the address and the opt-in (the row
  stays, so the question is not asked again).
- **v3 Stage 1 (spec 5.4): the Monday moment.** The question ("Want the Monday summary by email? Reply with the
  address.") moved from the entry replies to the first yes after activation: the connect yes and the share yes
  (`benchMoveUp`), while the person has no opted-in subscription and `digest_asked_at` is null or over 30 days old (v3 final review), appended to the Done line as the reply's one question.
  An entry no longer asks or keeps its email. `DIGEST_HOUR_UTC` is 16, after the weekly job (`WEEKLY_HOUR_UTC` 15),
  and the cron runs the digest after `runScoreSteps`, so one run writes the week then mails it. `digestFacts` finds
  the person (`COALESCE(profile by x_user_id, i.builder_id, i.id)`) and their main project's last week
  (`lastWeekOf`); a checked week leads the email: subject "Your week on EarnKit: Shipping S · #R of T builders",
  `momentLines`, then "Looks right: <url>" and "Hide this week: <url>" (no links once the week is approved). A ranked
  week of a confirmed main project not written yet is `pending` (not sent, not considered; `pending` counted in the
  step result) until a day after `weekStart`, then the email goes without it. `week-links.ts` signs the links:
  `<builder>.<monday>.<approve|hide>.<HMAC-SHA256("week:v1:<builder>:<key>:<monday>:<action>")>`, the key only inside
  the mac (checked against `main_project_key`, so a changed main project voids old links). `/api/week` GET shows the
  week and one POST button (changes nothing); POST approves (`approveWeek(..., 'email')`, points once; an approved
  week keeps its first approval; approving un-hides the row) or hides the week's row itself (any row, with or
  without a note), then links the page. A bad token is a 400 "This link is not valid."; a link for a week older
  than the one before last finished is a 400 "This link has expired." (`weekLinkLive`). `askWeeklyEmail` no longer
  has a shared-client branch (never asked there) and `entryEmail` is gone. None on a shared client or a per-login subscription.
- **Who is due (P17).** Opted in before this week's start (`weekStart`: Monday 16:00 UTC), not
  unsubscribed, nothing sent and nothing considered since that start. So emails start on Mondays, a
  spillover past the daily cap goes out on later runs that week, and a new opt-in waits for Monday.
- **Sending (hourly cron, after hosting).** `sendDigests` loops with the time left: both counters
  must have room (`freeTierRoom`), then one due row is locked (`FOR UPDATE SKIP LOCKED`, oldest
  `last_sent_at` first, 100 per run at most) in its own transaction. Empty facts set
  `last_considered_at` (never an empty email). Otherwise it takes one `resendDay` then one
  `resendMonth` slot (kept whatever happens), sends through Resend (`POST /emails`, 10 s), and sets
  `last_sent_at` in the same transaction. A refused cap stops the run (`capped: true`); a 429 stops
  it too; another 4xx skips the row this week; a 5xx or network error is retried next run. Every send
  carries Resend's `Idempotency-Key: digest-<id>[-<login>]-<weekStart ISO>`, so a retry of a send whose
  outcome was unknown never mails twice (Resend keeps keys 24 hours; the next run is an hour away).
  Three failed sends (or unreadable rows) in a row stop the run (`stopped: true`), so an outage never
  burns the day's slots; a row that fails to read never blocks the rows behind it.
- **Content (in order).** New programs opened since the last send that one of the installation's
  remembered repos could really win (`alertFit`, the A7 alert rule; none on a shared client); wins by
  EarnKit builders in the last 7 days (announced only, test installations excluded); the
  installation's entered programs closing, or with `results.expected`, in the next 7 days (on a shared
  client only the entries the subscription's login signed in for, `github_verifications`). At most 5 lines each.
  Every builder-supplied name in the email (a winning project, a repo; lines and subject) goes
  through `cleanName`: URLs, bare domains, emails and @handles removed, at most 40 characters (cut at
  a word), else a neutral fallback ("An EarnKit builder", "your repo").
  The text ends with "Ask your agent..." and the unsubscribe link.
- **Unsubscribe.** Every email carries `List-Unsubscribe: <https://earnkit.com/api/digest/unsubscribe?t=...>`
  and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The token is `<installation id>.<HMAC-SHA256
  (EARNKIT_AUTH_SECRET, "digest-unsub:v1:<id>"), base64url>`, or for a login's subscription
  `<id>.<login>.<HMAC of "digest-unsub:v1:<id>:<login>">` (`unsubTarget`), checked timing-safe; it
  unsubscribes exactly that one row. GET shows a confirm
  page with a POST button (a link scanner unsubscribes nobody); POST sets `unsubscribed_at` once
  (idempotent). A bad token is a 400 and changes nothing.
- **The won line (E20).** `stats.ts builders_won_usd`: the sum of `prize_usd` of announced won or
  placed outcomes with a prize, never a self-report or a test installation's entry (also in
  `/api/stats`). `wonLine` (in `pool.ts`, re-exported by `stats.ts`) is "Builders using EarnKit won
  $12,500", or null at 0, so the line is absent, never "$0". The landing page shows `won_line` under
  the stats line (Hero); the first reply joins it to the money headline ("$1.1M+ in prizes open right
  now. Builders using EarnKit won $12,500."), or puts it first in the body when the reply opens with a
  heading. `list_programs` reads it through `wonSource` (`readWonUsd`, cached 10 minutes). Cache keys
  moved to `landing-v29` and `public-stats-v29`.
- **Owner steps.** Create the Resend account, add its DNS records for earnkit.com on Cloudflare, set
  `RESEND_API_KEY` (and `DIGEST_FROM` if the sender differs) on Railway.
- **Known limits.** On a hosted agent a builder is asked only after signing in with GitHub (the code).
  A failing address costs one cap slot per run until it succeeds or a 4xx skips it for the week.

## Simplify: one money figure, one legal page, MINI line, shorter descriptions (v2.9 F21 to F25, Task 11)

- **One money figure (F21).** `openMoneyUsd(programs, now)` sums the top prize (`max_award_usd`) of
  every open curated program: active, started, not ended, never an EarnKit campaign (`campaign` on a
  DB row, `earnkit_campaign` on a card, P19) or a sponsor's (`sponsored`, `source = 'sponsor'`).
  `moneyText(usd)` renders it rounded down ("$1.1M+", "+" when rounding dropped value, null at 0).
  Both live in `pool.ts` (P18; present.ts can't import stats.ts) and `stats.ts` re-exports them. The
  landing (`landing.open_text`), /programs (the same `open_text`), the first reply (no repo: over every
  card; with repos: over the rows the builder qualifies for) and `/api/stats` (`open_money_usd`,
  `open_money_text`) all call it. `readStats` reads the active rows as json (`open_rows`) and
  `statsFrom(r, now)` applies `openMoneyUsd`; the SQL sum is gone. The old pool-based figure
  (`openFigure`) is removed. Ruling G23 kept `open_pools_usd`/`open_pools_plus` served, deprecated;
  v4.7.1 dropped them from `/api/stats`; no page shows them. With the catalogue on
  2026-10-08 the figure is $1,170,500, shown "$1.1M+". Tests: stats 11.1/11.2, human-text and
  copy-review 11.3 (no "$1.3M", "1,170,500" or "1170500" in human or builder text; `openFigure` and
  `poolTotalText` imported only in pool.ts and its test; one fixture catalogue gives one figure on
  every surface).
- **One legal page (F22).** `app/terms/page.tsx` renders `PolicySection` (h2 `#policy`),
  `RiskSection` (`#risk-disclosure`, Tokenfi Inc.'s text unchanged, restyled onto the site's panels)
  and `SponsorTermsSection` (`#sponsor-terms`). `next.config.ts` `LEGAL_REDIRECTS` sends the old
  paths there with `statusCode: 301` (never `permanent: true`, which is 308). The footer's Legal
  column is "Terms" (`/terms`), and the footer adds "EarnKit is a product of Tokenfi Inc." above the
  copyright. BoardView's "How it works" and the fund page's sponsor terms link the anchors; the
  sitemap lists /terms.
- **Sponsor surfaces (F23).** Builder navigation (Header, Footer, HomeView, the guide page,
  llms.txt) links no `/fund` or `/award` page; the routes stay (public-pages 11.7, a regression
  guard that already passed, P34). docs.earnkit.com's sponsor page stays.
- **MINI line (F24).** `policy.ts MINI_LINE` ("10% buys MINI, EarnKit's token") follows the fee split
  table, the only place the split is shown; the split (`FEE_SPLIT_BPS`) is unchanged. llms.txt states
  only the builder's 40%, not the split, so it has no MINI line.
- **Shorter descriptions (F25).** `confirm_entry` (776 characters) keeps when to call it, its inputs,
  "the kit is only in this reply" and "show show_to_builder exactly as written"; the kit rules (modes,
  DoraHacks and Questbook terms, the builder always clicks submit, missing answers) are in the kit
  reply's `agent_note` (`submit-kit.ts kitReplyNote`). `sponsor_campaign` (archived in v2.12; 781, safety lines
  included) kept the three actions and their inputs; the confirm-first, plain-text, verification,
  brand and label rules (`sponsor-rules.ts SPONSOR_RULES`) end create's `next_step`, and award's
  `next_step` ends with "never send an award transaction the sponsor has not approved". mcp.test 11.8.

## v2.9 Needed, Part 2: settings, runbooks, owner go-live and the journeys (Task 12)

Part 2 is T7 (the host Worker), T8 (hosting), T10 (the weekly email and the won line), T11 (one
money figure, `/terms`, the MINI line, shorter descriptions) and the rest of T12: the Part 2
journeys, the Also qualifies precision (Ruling G15 M1), the v2.8.1 minors (Ruling G0), the Worker
typecheck in `pnpm test`, the copy sweep and these runbooks. Each feature has its own section above.

**Settings. Each feature is off while its variables are absent; deploying without them changes
nothing a builder sees.**

| Variable | Feature | When absent |
|---|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Hosting (all four) | `host: { unavailable }`, `/api/host/*` 503, the cron's hosting step skipped |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | Sign-in (also needed for an upload URL) | See Part 1; hosting stays unavailable |
| `EARNKIT_RESERVED_SUBDOMAINS` | Extra names no site may take (every existing DNS name) | Only `HOST_RESERVED` |
| `ADMIN_VETO_SECRET` (32+ characters) | The approve and kill calls | `/api/host/takedown` answers 401 |
| `RESEND_API_KEY` and `EARNKIT_AUTH_SECRET` | The weekly email (the secret signs the unsubscribe link) | No question, nothing saved, the cron step skipped |
| `DIGEST_FROM` | The email's sender | `EarnKit <digest@earnkit.com>` |
| `GAS_WALLET_MIN_WEI` | The gas alert's floor (Part 1) | 0.002 ETH |

**The free-tier caps (`free_tier_usage`, `free-tier.ts FREE_CAPS`).** Hard caps, never billing:
`r2Writes` 900,000 Class A operations a month (each put, list page and copy takes 1 first; deletes
are free), `resendDay` 100 and `resendMonth` 3,000 emails. A refused take is `FreeTierFull`: an
upload answers `HOST_FULL` ("Hosting is full right now; try again tomorrow.", 507) and the email run
stops with `capped: true`. Read the counters:
`SELECT name, period, used FROM free_tier_usage ORDER BY period DESC, name;`

**Runbooks (Part 2).** The admin calls use Bearer `ADMIN_VETO_SECRET`; never paste it anywhere
but your own terminal.
- **A 503 from `/api/cron` with `host-review:<slug>` in `needs_owner` (P46).** An upload was
  flagged (a password form next to a wallet or bank brand, a seed or recovery phrase, a hard-coded
  token approval) and waits in `staging/<slug>/<deploy id>/`, never served. The cron answers 503
  hourly until you decide. Look at the files in R2 (Cloudflare dashboard, bucket `earnkit-sites`,
  prefix `staging/<slug>/`) and the flags: `SELECT id, login, repo_key, flags, at FROM host_deploys
  WHERE slug = '<slug>' AND status = 'review';`
  - Fine: `curl -X POST https://earnkit.com/api/host/takedown -H "Authorization: Bearer $ADMIN_VETO_SECRET" -H 'content-type: application/json' -d '{"slug":"<slug>","action":"approve"}'`
    answers `{"slug":"<slug>","status":"live"}`; the staged files go live and the alert clears.
  - Not fine: the same call with `"action":"kill"` (see the takedown below).
- **A takedown (abuse report to abuse@earnkit.com, or your own call).** `curl -X POST
  https://earnkit.com/api/host/takedown -H "Authorization: Bearer $ADMIN_VETO_SECRET" -H
  'content-type: application/json' -d '{"slug":"<slug>"}'` (kill is the default). It writes the
  `killed` state first, then deletes the served and staged files; visitors get "This site was taken
  down." within 5 minutes (edge cache). A killed slug or repo can never be deployed again. It also
  works for a slug with files but no row. `404 {"error":"no such site"}`: nothing to take down.
- **Expiry.** Nothing to do. A site lives while a program its repo entered is open, then 7 days
  more (at least 7 days after its upload); the hourly cron ends up to 20 due sites a run (`ended`
  state, then its files go; visitors get "This site has ended."). A builder who enters a new program
  with the repo moves the date. Check one: `SELECT slug, status, expires_at, expiry_checked_at FROM
  hosted_sites WHERE slug = '<slug>';` While the R2 counter is full, ends wait for next month.
- **`HOST_FULL` for everyone.** Either the R2 writes counter is at 900,000 this month, or stored
  sites are near 8 GB. Read `free_tier_usage` and `SELECT sum(bytes) FROM hosted_sites WHERE status
  IN ('live','review','deploying');`. It clears on the 1st (UTC) or as sites end.
- **The weekly email.** It runs hourly and sends from Monday 14:00 UTC; each subscription gets one
  email a week. The cron result's `digest` shows `{ sent, skipped, capped, stopped? }`.
  - `capped: true`: the day's 100 or the month's 3,000 is used; the rest go out on the next runs
    that week (day cap) or next month (month cap). Nothing to do; never raise the caps (they are
    Resend's free tier).
  - `stopped: true`: three sends failed in a row (Resend down, or the key revoked). Check the key and
    Resend's status; the next run retries, and the Idempotency-Key keeps it to one mail each.
  - Who gets it: `SELECT count(*) FROM digest_subscriptions WHERE opted_in_at IS NOT NULL AND
    unsubscribed_at IS NULL;` Addresses are never logged.
  - A complaint: the email's one-click link unsubscribes that one subscription. To do it by hand,
    `UPDATE digest_subscriptions SET unsubscribed_at = now() WHERE email = '<address>';`
- **Abuse of the OAuth floor by a fake "hosted" client.** A registration whose redirect host is a
  known hosted service has a 500 an hour per-IP floor (Ruling G25, replacing G0's exemption); a
  refusal logs `[oauth] register refused by oauthRegisterHosted (<host>)` (or `token refused by
  installHourHosted`). The 10,000 a day ceiling per host still holds. If a host's ceiling is being filled by fakes, remove that host from `HOSTED_REDIRECT_HOSTS`
  in `oauth.ts` and deploy.

**Owner go-live (after merge; each step is optional until you want that feature).**
1. **R2 and the Worker (Cloudflare free plan, earnkit.com zone).** Create the R2 bucket
   `earnkit-sites` and an R2 API token scoped to it (Object Read and Write); set `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET=earnkit-sites` on Railway. From your
   machine, in `infra/host-worker`: set `RESERVED` in `wrangler.toml` to every existing DNS name in
   the zone, uncomment the routes, then `wrangler deploy` (never from CI). Add a proxied wildcard
   record `*.earnkit.com` (AAAA `100::`), the Worker route `*.earnkit.com/*`, and an exclusion route
   (Worker: none) for each reserved name (`www`, `docs`, `api`, `mcp`, `app`, `mail`, `admin`,
   `status`, `abuse`, `host`, and every existing record). Set `EARNKIT_RESERVED_SUBDOMAINS` on
   Railway to the same extra names. Route `abuse@earnkit.com` to your inbox (Cloudflare Email
   Routing, free). Set `ADMIN_VETO_SECRET` if it isn't set. Keep the Cloudflare account on the
   Workers Free plan: never Workers Paid, never usage-based billing (the free plan stops at 100k
   requests a day; a paid plan bills for them instead).
2. **GitHub OAuth App.** Callback `https://earnkit.com/github/verify/callback`, no scopes; set
   `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` on Railway. Hosting needs it too.
3. **Resend (free) and DNS.** Create the account, add its DNS records for earnkit.com on Cloudflare,
   verify the domain, set `RESEND_API_KEY` (and `DIGEST_FROM` if the sender is not
   `digest@earnkit.com`) on Railway.
4. **`EARNKIT_AUTH_SECRET`.** Already set in production for OAuth; the email's unsubscribe links are
   signed with it. Never rotate it casually: a new value breaks every sent unsubscribe link and the
   signed OAuth client registrations agents hold.
5. **`GAS_WALLET_MIN_WEI`.** Set at the Part 1 ship (Ruling G16, 0.0001 ETH). Raise it back toward
   the 0.002 ETH default once the payout wallet is topped up.
6. **The docs money switch (optional, Ruling G23).** docs.earnkit.com may switch its live number
   from `open_pools_usd`/`open_pools_plus` to `open_money_text`. The old fields were dropped
   from `/api/stats` in v4.7.1, so docs.earnkit.com must switch.
7. **Test with throwaway repos:** one hosted site end to end (sign-in, upload, the badge, a takedown),
   and one weekly email to yourself (opt in, wait for Monday's run, unsubscribe from the email).

**The G0 minors (from the v2.8.1 re-review).** N1: the pickup proof repo is one a matched group
proved. N2: list_programs reads earnkit.txt for a pickup only when it can change the answer, at most
once an hour otherwise. N3: linking keeps the duplicate holding the token. The OAuth IP floor
exempts known hosted services' servers (counted and logged, host ceiling kept). See "Hosted agents
and identity" and the rate limits.

**A test-only bug the full runs found (fixed).** Since T10 the shared `fixtures/no-network-checks`
imports `stats.ts`, which loads `tokens.ts` before the anvil e2e sets its mock tokens.fun. The
tokens.fun host was read at import, so it froze to `https://tokens.fun` and that test's deploy went
to the real service (refused 401; nothing launched). `tokens.ts tokensFunUrl()` now reads
`TOKENSFUN_API_URL` per call (deploy and check-ticker). Production behaviour is unchanged.

**The Worker typecheck.** `pnpm test` runs `pnpm -s host:typecheck` first, so a type error in
`infra/host-worker` fails the suite (P42). There is no CI test workflow; the owner runs `pnpm test`
before a merge.

**The Part 2 journeys (`v29-journey.test.ts`).** In the same throwaway database as Part 1. R2 is in
memory, and the Worker's real `handle` serves from it; Resend is a recording mailer.
- 12.3 hosting: the sign-in (purpose `host`), then the upload URL (agent only); a `.exe` and a body
  over 25 MB are refused without spending the link; the zip goes live (`TipJar is live:
  tipjar-hana.earnkit.com`), the link is single-use, and the Worker serves it with the badge and the
  sandbox headers. The hosted link counts as live at once: with the edge still showing a cached 404,
  the entry is never probed and completes (G19). A flagged redeploy is staged, never served, puts
  `host-review:tipjar-hana` in `needs_owner`; the approve call (a wrong secret is 401) publishes it.
  Expiry ends it and the Worker shows the end page. An account under 30 days old gets the gate line.
- 12.6b Also qualifies (G15 M1): Circle (needs real users) is never offered; Arc is, until the
  builder says the repo is testnet only on Arc.
- 12.8 the won line: an announced $500 win counts; a builder's own "$10,000" does not; the landing,
  `/api/stats` and the first reply all say "Builders using EarnKit won $500", once.
- 12.9 one money figure: the landing, `/api/stats` and the no-repo first reply say the same figure.
- 12.10 the weekly email: the question closes the first entry's kit reply once; yes; Monday's run
  sends one mail with the one-click headers and an idempotency key; a second run that Monday sends
  nothing; a full day cap sends nothing (`capped`); the email's own link unsubscribes. On a shared
  client: no sign-in, no subscription; two logins are asked once each and get their own mail and
  unsubscribe link.
- 12.11 /terms: each old path 301s to an anchor the page renders; the footer's legal link is `/terms`;
  no reply links an old path.
- 12.6 now also asserts Circle is not in Also qualifies. Across every Part 2 reply (upload replies
  included) the Part 1 scan holds, and "40%" shows once per entry flow.

## v2.10 One thing per reply (Task 11: the whole release, env vars, go-live, journeys)

The owner's v2.9 test run found repeated pitching, private-repo blindness, weak matches ranked as
fits, and sloppy descriptions and logos. v2.10 answers each with the smallest fix. This section is
the map; the detail lives in the sections it names.

- **4 tools (item 4).** `find`, `prepare`, `confirm`, `tell` (`tools.ts tools`) dispatch to the v2.9
  `handlers`; the table and the alias map are in "The 4 builder tools and the 30-day aliases". Old
  names are rewritten in `app/mcp/route.ts` until `ALIASES_UNTIL` (2026-11-09T00:00Z) and logged as
  `[mcp] alias <old> -> <new>`; `tools/list` shows only the 4 (v2.12: plus `score`, always
  since v2.14; `sponsor_campaign` is archived and never listed).
- **The first reply and `more` (item 2).** One line each for news, "Your entries", the deadline
  line and the private/can't-see lines, then one lead line with its question ("Your TipJar can win
  500 USDC on Arc by Oct 14. Want me to finish it?"). `find { more: true }` renders the v2.9 tables.
  See "One thing per reply" under the v2.8 win engine section.
- **The guide on the first `prepare` (item 3)**, before the coach's questions; never again for that
  program once an entry exists.
- **One bonus line (item 1):** `present.ts bonusLine`, at most once per reply.
- **The confirm line (item 5):** the token is pitched once, inside the one yes: "Yes submits your
  entry and launches $TIP (Tip Jar): 40% of its fees to you, plus the builder bonus. Wallet: …. yes /
  skip the token". Later showings in the same flow drop the "40%" part. No WETH, gas or terms line in
  any reply; the terms are a footer on `/p/[id]`.
- **The deadline line (item 15):** "Arc Microgrants closes in 2 days; your entry isn't submitted.",
  once per entry per UTC day, never on a shared client without the builder's code.
- **Traction and odds (item 6):** `traction = 3·band(tx) + 2·live + band(commits_90d)`; good odds per
  Ruling H5; rank = good odds, traction, difficulty, prize. Alchemy tx counts (Base only, capped at 100) at most 2
  per `find` and 1 per entry step, cached 24 h in `url_checks.n`. See "Owned repos and the
  real-product score".
- **Chain basis (item 9):** only `deployed` or `deploy_config` credit a chain; a mention is at most
  "deploy to <chain> first" and low odds.
- **Private repos and the App (items 7, 7b; R8 to R10):** per-repo reads, the local view, the
  can't-see line, and the read-only App. See "Private repos and the read-only GitHub App".
- **Error pages (item 14):** the probe reads 64 KB of HTML and fails a page showing an error. There
  is no JS execution, so an error drawn by client-side JavaScript is not caught.
- **Plain fields (item 11):** `coach.ts plainProblem`; `confirm` refuses `yes` with `agent_fixes`
  only; tokens.fun's description is the project's description, else the form's one-liner, else
  "<Name> on Base" (a form with no one-liner, like Arc's, falls to that when the agent sends no
  `project.description`).
- **Logo order and the mark (item 12):** the agent's upload; the live site's apple-touch-icon, else a
  raster icon of 128 px or more, else og:image; the public repo's custom social preview; the
  generated mark (`/api/projects/<id>/mark`, never the text tile). A fetched image is stored in
  `projects.token_image` and served from `/api/projects/<id>/image`.
- **Deploys (item 13):** caps (1 a day per chain per builder, 3 per 30 days, 20 a day in total,
  $0.25 a deploy, $10 a month), key separation, `TOP_UP`, and the runbooks for `deployer-gas:<chain>`,
  `deploy-owner:<id>` and `deploy-unknown:<id>` are in "EarnKit deploys the builder's contract".
- **A verified contract stays verified (Task 11 fix, journey 11.0).** `projects.ts` entry UPDATEs
  write `contract_verified_at = COALESCE(<this check>, contract_verified_at)`: tell's "I submitted"
  re-records from the stored fields, which carry no contracts, and used to clear the pass a deploy or
  confirm had set. Contract code doesn't go away, so a later step never clears it; the live check
  still can.
- **A live pool read counts a fresh token (Task 11 fix).** `bonus-rounds.ts roundPools` without
  `opts.now` has no upper bound on `coin_launched_at` (the app's millisecond clock against the
  database's microseconds, or clock skew, could hide a token launched a moment before, so a reply
  said "Your token: …" and "no tokens yet" together). An "as of" read keeps the bound.
- **Programs list in one order (Task 11).** `programs.ts` lists open programs by `ends_at`, then `id`.

### Env vars (each feature is off when its vars are absent)

| Var | Turns on | Notes |
|---|---|---|
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` | The read-only GitHub App (item 7b) | All three, a valid PEM (newlines as `\n` allowed), and the v2.9 OAuth app (`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`) |
| `DEPLOYER_PRIVATE_KEY` | Contract deploys (item 13) | 64 hex. Refuses to start when it equals any other key it can see |
| `DEPLOY_CHAINS` | Which chains deploys are on for (v2.10.3) | Comma-separated from `arc`, `base`, any case and spacing. Unset or blank: both. Other entries are ignored and logged once by name. None left: no chain (prepare lists no `deploy`) |
| `BASE_RPC_URL`, `ARC_RPC_URL` | The deployer's chains | Public RPCs are used when unset |

### Owner go-live (after merge)

1. Merge and deploy `v2.10`. `predeploy` runs the additive migration and `programs:sync`
   (Avalanche Team1 loses its Easy rating).
2. **GitHub App (optional, free).** Create it on GitHub: Repository permissions Contents: Read-only
   and Metadata: Read-only, nothing else; no webhooks (uncheck Active); Setup URL
   `https://earnkit.com/github/verify/app`; "Redirect on update" on; installable by any account.
   Generate a private key and set `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY`
   on Railway. The v2.9 OAuth app must be set too (the App link starts with that sign-in).
3. **Deployer wallet.** Make a new wallet (never the payout wallet, an operator or a guardian key).
   Before sending anything to Arc, confirm on docs.arc.io that Arc mainnet's chain id is 5042 and
   that its native USDC balance and gas use 18 decimals (the pricing assumes both; if Arc says 6,
   don't fund Arc and leave the Arc RPC unset until the code is changed). Then send about $5 of ETH
   on Base and about $5 of USDC on Arc. Top up by hand when the cron lists `deployer-gas:<chain>`.
   Funding Base only? Set `DEPLOY_CHAINS=base` (v2.10.3), so Arc is never read or flagged.
4. **Deployer key.** Set `DEPLOYER_PRIVATE_KEY` and make sure `BASE_RPC_URL` and `ARC_RPC_URL` are
   set. Run the app on one replica (the nonce queue is per process).
5. **Deploy flags.** `deploy-owner:<id>` and `deploy-unknown:<id>` make the cron answer 503 for 24
   hours, then stay listed with `:quiet` for the rest of 7 days (Ruling H11). For `deploy-owner`,
   read the contract's `owner()` and `hasRole(0x00…, deployer)`, renounce any right the deployer still
   holds by hand, then `UPDATE contract_deploys SET owner_ok = NULL WHERE id = <id>`. For
   `deploy-unknown`, look up `tx_hash` (or the deployer's nonce when it is empty) and set `status`,
   `address` and `cost_micro_usd` to what happened.
6. **Before 2026-11-09:** read the `[mcp] alias` log lines; if an agent still uses old names, move
   `ALIASES_UNTIL` or tell its owner.
7. **Test with throwaway repos:** one private repo through the App, one Arc deploy, one Grok Bot
   launch. Tokens and contracts are real and permanent.

### The journeys (`v210-journey.test.ts`)

Its own throwaway database (`schema.sql`, dropped after), every real program file, and fakes for
GitHub (REST, raw, OAuth and the App's API with a key generated in the test), the probe, getCode,
Blockscout, the live site's page and icon, tokens.fun (check-ticker and the deploy API behind the
real `deployToken`) and the deployer's chain (`DeployChain`). Nothing else may touch the network.

- **11.0 the owner's run:** private tokens.fun and EarnKit repos (local view) and a public
  arc-usdc-tipjar; the first reply is the two private lines and one lead line; "show more"; the
  guide on picking Arc; the Arc deploy (creation, then `transferOwnership(builder)`); one confirm
  line with "40%" once; a description with an address refused for the agent only; the launch with
  the live link, the site's apple-touch-icon and the plain description; the deadline line once a
  day; "I submitted".
- **11.1 a private repo and the App:** the can't-see line with the App link, the sign-in hop, the
  install and the setup URL, one `via = 'app'` row; scored through the App's token; the guide, the
  deploy, the launch through the App; `/p` and `/bonus` never show the repo.
- **11.2 Grok Bot:** a shared client to a launched token with the sign-in code (G10, G11); the
  deadline line only with the code; a second builder sees nothing.
- **11.3 an old agent:** `confirm_entry` through the MCP route reaches `confirm`, logs the alias
  once, and `tools/list` has the 4 tools.
- **11.4 the sweep** over every reply (copy rules, one bonus line, the first-reply shape, "40%"
  only on the confirm line, no address in a description field, no other network).

`campaign-e2e` (anvil with chain id 8453) and `sponsor-e2e` (anvil 31337 with `MockERC20` and
`script/Deploy.s.sol`, `ALLOW_SHORT_TIMELOCK=1`, after `programs:sync`) pass on v2.10.
`campaign-e2e` had been failing since v2.7/v2.9 copy changes (the "Before you submit" line and the
`.example` placeholder); its checks now read the one-line first reply and a real live link.

## The 4 builder tools and the 30-day aliases (v2.10 item 4, R15 to R17, Task 9)

The server lists 5 builder tools, `score` included (v2.12; always since v2.14; until v2.12,
`sponsor_campaign` once the escrow was configured, now archived). Each is a
thin dispatcher in `tools.ts tools` over the v2.9 functions, which live on unchanged in
`tools.ts handlers` (only their agent notes now name the new tools). Most of this guide still names
the v2.9 handler a behaviour lives in; this table maps them.

| Tool | Dispatches to | Notes |
|---|---|---|
| `find` | `handlers.list_programs` (no `program_id`), else `handlers.get_program` | `FindInput` = list_programs' lenient input plus `program_id`, `repo`. With `program_id` on a curated program, `show_to_builder` is `guide.text`, plus one plain fit line when `repo` is given (`eligibilityLine`). `repo` without `program_id` is read as `repos: [repo]`. Read-only. |
| `prepare` | `handlers.prepare_submission`, then with `deploy` the contract deploy (v2.10 item 13, below) | `PrepareInput` is the strict `PrepareSubmissionInput` plus `deploy` (stripped before the handler, P9). Not read-only any more (`readOnlyHint: false`). |
| `confirm` | `project_id` without `program_id`: `handlers.launch_token`; an EarnKit (or sponsor) campaign: `handlers.record_submission`; else `handlers.confirm_entry`, then with `submitted` (P15b) the submitted mark once that reply recorded the entry (it has the kit) | `ConfirmInput` (R15): `yes` (go), `skip_token` (go without a token), `check` (check_back), `wallet`, `token`, `project`, `answers`, `agent`, `signed_in`, `image_*`, `builder_x`, `contracts`, `deployer_signature`, and `submitted` (Pre-flight P15b). `yes` or `check` is `builder_confirmed` on the launch path (a check is a read); `skip_token` with `project_id` answers "No token for now." and calls nothing. The confirm_entry path drops `image_*`/`builder_x` (its input is strict). |
| `tell` | `pickup`: `handlers.pick_up_entries`; `submitted`: `handlers.record_submission` with `builder_submitted: true`; the rest: `handlers.tell_earnkit` | `TellToolInput` (R16). Several parts run in that order and their replies join (`show_to_builder` lines with `\n`, agent notes with a space). |

- **"I submitted" (R16).** `markSubmitted` loads the entry by `submitted.project_id`, else this
  installation's newest entry in the program (`projects.ts submittedEntry`, the same lookup as v2.9
  outcomes), with its stored project fields and its confirmed `application.answers` (else the latest
  `submissions` row), and calls record_submission with them. On a shared client (G7, G9; fix round
  1 I2) it needs `signed_in` and a `project_id` among `verifiedEntryIds` for that login; anything else
  answers "Noted for now." and neither writes nor reads the entry. Off a shared client, an old
  record_submission call's own `project`/`submission_data` are used as given (record_submission finds
  the entry by repo key, or makes it), the v2.9 meaning (Pre-flight P15c).
- **`confirm` with `submitted` (P15b, fix round 1 C1).** confirm_entry runs first, so the builder's
  yes covers the exact pair and wallet the confirm line showed and the plain-words check runs; the
  entry is marked submitted (`markSubmitted` by its `project_id`) only when that reply carries the kit.
  Without `yes`/`skip_token` nothing is recorded.
- **`confirm` with `project_id` (fix round 2).** `confirmByProjectId`:
  - I-b (G7, G9): on a shared client it needs `signed_in` and a `project_id` among
    `verifiedEntryIds` for that login; anything else is "Noted for now." (`CONFIRM_SHARED_NOTE`) and
    launch_token never runs, so no `updateLinks`, `markComplete` or token status for another builder.
  - I-a (G13, §A2): a yes launches only the name, ticker and wallet the entry's confirm line showed.
    `token_offers.offered_wallet` (new nullable column) stores the wallet on that line (null when it
    asked for one; then the wallet must be named with the yes). Another pair or wallet, or no line
    shown, gets confirm_entry's offer (no row written; it stores what it shows) with
    `PROJECT_REOFFER_NOTE`; a closed program answers "Nothing launched: this token was not offered
    yet." A check, an entry with its token or pending, a skipped entry and a dormant campaign entry go
    straight to launch_token.
  - With `submitted`, a reply without the kit (launching, a fixable stop, a re-offer) adds
    `SUBMITTED_AGAIN_NOTE`; the joined reply drops record_submission's token sentence
    (`withoutTokenLine`), so the token is said once.
- **The gates are the handlers'.** G10, G11, the sanctions screen, one token per repo, the wallet
  limits, G7 privacy, G12 decline counting, T7's "40%" once and T8's guide and lead all run inside
  the handlers, so every path through the new tools gets them (tests 9.3, including G10 through both
  confirm paths).
- **`launchFromOffer` is gone.** `handlers.launch_token` with `offer` throws an `EntryError`; an old
  agent's offer call reaches `confirm` through its alias, so an unseen token shows the confirm line
  first (an entry row is drafted, nothing launches). A v2.9 offer "skip" without `builder_confirmed`
  is the confirm line again, never a recorded decline (P15a).
- **Aliases (`aliases.ts`, R17).** `aliasCall(name, args, now)` maps each v2.9 call shape to its new
  tool and arguments until `ALIASES_UNTIL` (2026-11-09T00:00Z), then returns null (the SDK answers an
  unknown tool). P15: a skip (confirm_entry's `decision`, launch_token's, record_submission's
  `token: 'skip'`) needs `builder_confirmed`, like a go; record_submission with both flags is
  `confirm` with `submitted`; record_submission's token object gives `token: { name, symbol }`, its
  image fields, and its own `creator_wallet` as the wallet (before `payout_wallet`, as v2.9
  runTokenFlow did); `pick_up_entries`' answer is read with v2.9's `yesNo` (in aliases.ts; v2.12 moved it to `yes-no.ts`). v2.12 (R23): `aliasesOn(now, env)` keeps
  the old names until 2026-11-09, after it only with `EARNKIT_TOOL_ALIASES=on`; the file move is staged in `archive/tool-aliases/`. `rewriteAliases` rewrites
  each old `tools/call` in a JSON-RPC message or batch and leaves everything else as the same object.
  `app/mcp/route.ts withAliases` applies it to authenticated JSON POSTs before the transport (a body
  that isn't JSON passes untouched; a rewritten body drops `content-length`) and logs
  `[mcp] alias <old> -> <new>` per use, never an argument. Old names never appear in `tools/list`.
  `launch_token`'s `chain` has no new form and is dropped (Base).
- **Descriptions and instructions (`mcp.ts`).** Each is under 800 characters (test 9.2):
  `serverInstructions` is the tool order, show_to_builder as written, T7's token sentence, the
  campaign sentence while one is open, the never-name-tools rule and the safety lines. `find`
  carries T4's local_repos sentence (P21) and the safety text; `prepare` carries
  `OWNERSHIP_FOR_TOKEN`; `tell` carries the "Did you submit on <program site>?" ask. `confirm` has no
  safety text (it would pass 800); the instructions carry the safety lines for every tool.
- **Copy rules.** The old names stay banned outright in builder text, and in agent notes now too
  (copy-review 9.8). The new names are English words, so builder text bans them only in a call shape
  ("call confirm", "find with", "prepare(", "the tell tool"): `copy-review.test.ts toolNameRe` and
  `token-launch.ts TECHNICAL_TERMS`, which also decides when a LaunchError message goes to the agent
  rather than the builder.
- **Route tests.** `app/mcp/route.ts` imports `lib/earnkit` by relative path so the node test runner
  (no `@/` paths) can load it; test 9.7 posts to `POST` with a real installation token.


## EarnKit deploys the builder's contract (v2.10 item 13, Task 10; R18, R19, P9, P16, H11, H12)

`prepare` with `deploy: { chain: 'arc' | 'base', bytecode, abi, constructor_args?, owner_wallet? }`
deploys the builder's own compiled artifact from EarnKit's deployer, paying the gas (cents), with the
builder as the owner. The agent compiles; EarnKit never builds code or verifies source. Off until
`DEPLOYER_PRIVATE_KEY` is set. No money ever goes to the builder's wallet; wallet top-ups stay banned.

- **Flow (`tools.ts deployStep` -> `deploy.ts deployForBuilder`).** Task 11 fix (journey 11.0): the
  program is read first (an unknown one spends nothing), then the deploy runs, and a deployed
  address joins `project.contracts` (first, at most 2) before prepare_submission, so this draft's A5
  check sees it and the reply never says "No contract found" next to the deployed line. A draft that
  throws after a deploy still returns the deploy (`agent_note`: call prepare again without
  `deploy`). The deploy needs the repo (`project.repo_url` or `answers.repo_url`) and an owner wallet:
  `deploy.owner_wallet` (P9), else the remembered wallet on a non-shared client, else the reply asks
  "Send me the wallet that should own <Name>." The builder's line is appended to `show_to_builder`;
  `reply.deploy` is `{ address, chain, owner_ok }` for the agent (who puts the address in
  `contracts`), or `{ <status>: line }`. The address appears in builder text only in the deployed
  line ("TipJar is deployed on Arc: 0x12ab…9f3e. You're the owner.").
- **Who the builder is (fix round 1, I6; fix round 2, N6).** A failed read of the installation's
  login refuses the deploy ("Deploys are paused right now."), never a fresh `installation:<id>` key. `contract_deploys.builder_key` and the day window's key:
  the verified login (a shared client's caller from `signed_in`; off a shared client the
  installation's last verified login, `github-verify.ts installationLogin`), else
  `installation:<id>`, and only a shared client with no login falls back to the repo key (it is
  refused by the ownership check anyway). One builder with many repos gets the same limits.
  Final fix M3: a shared client reads its caller with `callerLogin` directly (a failed read refuses,
  as N6), and while GitHub sign-in is off (`githubVerifyEnabled`) it gets no deploy at all ("Deploys
  are off right now."). Final fix M4: `prepare`'s `deploy` property is in the MCP schema only while
  `deployEnabled()` (as `sponsor_campaign` was only with the escrow, before v2.12 archived it).
- **Order and caps (Review Focus 3).**
  1. on (`deployEnabled`);
  2. `deployRefusal` on the initcode (payable constructor; all of `transfer`/`approve`/`totalSupply`
     PUSH4ed; over 49,152 bytes after the constructor args; bad hex or args);
  3. `token-gate.ts repoOwnershipPasses` (R19);
  4. `enforce('deployDay', '<builder_key>:<chain>')` (1 a day per chain, atomic, before any chain
     read, so a race sends once);
  5. under `pg_advisory_xact_lock` per builder, the 30-day count over `contract_deploys` (3; P16:
     never a rate window), a builder with a `blocked` row refused ("I can't deploy for you any more.",
     fix round 2 N2), and a reserved row (`status 'sent'`, `tx_hash ''`);
  6. `takeFreeTier('deploysDay', 1)` (20 a day in total);
  7. **the simulated runtime (fix round 1, I4):** after the estimate (step 8), an `eth_call` of the
     creation with the estimate's gas and fee cap (fix round 2, N3: as the send will carry them)
     returns the code the chain would store; `runtimeRefusal` refuses over 24,576 bytes (EIP-170), the three ERC-20
     selectors, and any CREATE or CREATE2 opcode (factories; PUSH data and Solidity's CBOR metadata
     are skipped). Proxies (DELEGATECALL) stay allowed: a contract upgraded to a token later is a risk
     the owner accepts;
  8. `estimate` (gas limit = estimate x 1.2; the RPC's chain id must match; on Base the L1 data fee
     from the GasPriceOracle predeploy, `viem/op-stack estimateL1Fee`, for the creation plus one
     transfer, fix round 1 I2) and the price (Base: DefiLlama `coingecko:ethereum`; Arc: USDC at $1;
     both 18 native decimals; a failed price read, or an ETH price outside $500 to $20,000
     (`ETH_USD_BAND`, fix round 2 N5), refuses, R18; M6: a deploy over 100,000 gas priced
     under 100 micro-USD refuses, as the decimals must be wrong);
  9. **the upper bound (fix round 1, C1):** `gas x maxFeePerGas + TRANSFER_GAS (100,000) x
     maxFeePerGas + 2 x L1 fee`. Over $0.25 refuses ("high"); the deployer's balance under it refuses
     ("Deploys are paused right now.", the cron raises TOP_UP);
  10. `takeFreeTier('deployGasMonth', upper)` ($10 a month);
  11. `send` (no `to`, no `value`).
  Any refusal before the send deletes the reservation and gives back the day total and the reserve
  (the per-builder day window stays taken: "try tomorrow").
- **After the send (fix round 1, I3).** A local `sendAttempted` is set just before `send`. From then
  on nothing is deleted or given back, whatever fails, even a DB write. The row gets the hash. The
  receipt is awaited within 30 s of the call's start.
  - No receipt, or a DB error after the send: `status 'unknown'`, the whole reserve stays counted,
    "The deploy is still going. It can take a few minutes.", and the agent gets the hash.
  - A send that throws: `unknown` and "I couldn't confirm the deploy. EarnKit is checking it." (M1).
  - In both cases the day limit stops a retry from sending again.
  - Reverted: `failed`, and the gas used (plus the receipt's `l1Fee`) is counted.
  - Success: the stored code is checked again with `runtimeRefusal`. A mismatch is flagged
    (`owner_ok false`, no cache pass). Then the owner step runs.
- **The owner step (fix round 1, I5).** Raw probes with EarnKit's own ABIs, never the builder's:
  - It reads `owner()`. When that returns the deployer, it sends one `transferOwnership(builder)`,
    capped at `TRANSFER_GAS` gas and the deploy's fee cap, then reads `owner()` again.
  - Then it reads `hasRole(DEFAULT_ADMIN_ROLE, deployer)`.
  - `owner_ok` is false when the deployer is still owner or admin, when another address owns it, or
    when a probe failed (an RPC error, not a revert). It is true when `owner()` is the builder, and
    null when neither function exists.
  - **The nonce (fix round 2, N2).** The new contract's nonce is read. Above 1 means its constructor
    created contracts (EIP-161): `owner_ok` false, the row `blocked` (that `builder_key` deploys no
    more), and no cache pass. A failed nonce read can't confirm it: `owner_ok` false, not blocked.
  - Then `verify.ts markDeployed` writes a fresh `getcode:<chain>:<addr>` pass, so the entry's A5
    check counts the contract as deployed (never as users).
  - The row becomes `deployed`, with `cost_micro_usd` = the deploy's and the transfer's gas plus
    their L1 fees.
  - The rest of the reserve is given back. An overage is always added (`free-tier.ts
    forceFreeTier`), even past the ceiling, so the next deploy stops.
- **The key.**
  - `deployerAccount` takes 64 hex, with or without 0x; errors name the shape only.
  - It refuses to start (`deployEnabled` false, one log line) when its address equals that of
    `CAMPAIGN_PAYOUT_PRIVATE_KEY`, `PAYOUT_PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY` or
    `GUARDIAN_PRIVATE_KEY`.
  - Only deploy.ts reads it. It signs only creations and the capped `transferOwnership`.
  - Sends are queued in-process, so two deploys never share a nonce. Run the app on one replica (M5).
- **Ownership (R19, `repoOwnershipPasses`).** A launch's proof minus the wallet binding:
  - a `github_verifications` row for this installation and repo (sign-in rows while sign-in is on,
    App rows while the App is on; P11: only here and `appTokenFor` read App rows);
  - else this agent's `token: <code>` line in earnkit.txt (default branch, then the most recently
    pushed one).
  - On a shared client only the caller's own `signed_in` login counts, and the proof line never
    does (G7, G10).
- **Chains (v2.10.3, `deployChains`, `DEPLOY_CHAINS`).** Deploys are on for a chain only when the
  key is on and the chain is in `DEPLOY_CHAINS` (unset or blank: Arc and Base; entries trimmed and
  lowercased; anything but `arc`/`base` ignored and logged once, by the variable's name only; none
  left: no chain). Every path checks it:
  - `viemDeployChain(c)` is null for a chain left out (no client);
  - `deployForBuilder` refuses one before any read or reservation: `Deploys on Arc are off right
    now.` (`deployOffLine`, with `deployOffNote` for the agent), or `DEPLOY_LINES.off` when no
    chain is on;
  - `tools.ts deployStep` refuses it first, before the wallet ask or the login read;
  - `mcp.ts` lists prepare's `deploy` only while some chain is on;
  - `deployerGas` reads and flags only the listed chains, so `DEPLOY_CHAINS=base` never gives
    `deployer-gas:arc` (no hourly 503 for an unfunded Arc wallet).
  - `deployChainOn(c)` is the one-call check (key and chain).
- **Cron (`cron.ts deployerGas`, inside the hourly run).**
  - While deploys are on, each chain in `DEPLOY_CHAINS`' balance is read once and priced as above. Under $0.25 adds
    `deployer-gas:<chain>` (`note: 'TOP_UP'`). A failed price or balance read adds
    `deployer-price:<chain>` (`PRICE_UNKNOWN`, M3).
  - Always: rows of the last 7 days with `owner_ok = false` give `deploy-owner:<id>`. Rows with
    `status 'unknown'`, or a reservation still `sent` after 10 minutes, give `deploy-unknown:<id>`.
  - **Ruling H11:** a deploy flag alerts (503) only while its row is under 24 hours old. After that
    it stays in `needs_owner` with the `:quiet` suffix (`QUIET_OWNER`), and `cronPost` answers 503
    only when some line lacks that suffix.
- **Tests.**
  - `deploy.test.ts`: 10.1 to 10.10 plus the fix-round tests C1, I1 to I6, M1, M3 and M6, with a
    fake `DeployChain`, DB-gated.
  - `tools.test.ts` 10.11, `cron.test.ts` 10.12 and `free-tier.test.ts`.
  - `deploy.anvil.test.ts` runs the real viem chain on a fresh anvil (`anvil --port 8574 --chain-id
    8453`, `DEPLOY_ANVIL_URL=http://127.0.0.1:8574`), with `contracts/test/mocks/DeployMocks.sol`.
    `OwnedTipJar`'s deployer is its first owner, and `MockGasPriceOracle` is set at
    `0x420...0F`. The test checks one creation and one capped transfer, both with value 0; that the
    balance falls by their gas only; and that the builder owns the contract.

### Owner go-live and runbook (deploys)

1. Make a new key for the deployer only (never the payout, operator, guardian or any escrow key).
   The server can check only `CAMPAIGN_PAYOUT_PRIVATE_KEY` (and the others if set there); the
   operator and guardian keys live only in the local shell, so keep them apart by hand (P16).
2. Fund it with about $5 per chain: ETH on Base, USDC on Arc (Arc's gas token). Top up by hand when
   the cron lists `deployer-gas:<chain>`. Funding only some chains: set `DEPLOY_CHAINS` to them
   (say `base`; v2.10.3). An unlisted chain gets no client, no gas check and a clean "Deploys on Arc
   are off right now." to the builder. `deployer-price:<chain>` means the price or balance
   couldn't be read: check DefiLlama and the RPC, not the wallet.
3. Set `DEPLOYER_PRIVATE_KEY` on Railway (and `ARC_RPC_URL`/`BASE_RPC_URL` if the public RPCs
   aren't wanted), and `DEPLOY_CHAINS=base` while only Base is funded. Unset the key to turn deploys off. Keep the app on one replica while it is set: the
   nonce queue is per process (M5); a second replica's colliding send fails closed (`unknown`).
4. Before the first Arc deploy, confirm on docs.arc.io that the chain id is 5042, that the native
   balance uses 18 decimals (the pricing assumes it; M6 refuses an absurdly cheap price) and that Arc
   supports EIP-1559 fees (otherwise every Arc estimate fails and nothing is sent).
5. Accepted risks (Ruling H12), each only the builder's own contract on capped gas EarnKit paid:
   - a proxy (DELEGATECALL) passes the runtime check, so a builder could later upgrade it to a token
     whose creator is EarnKit's deployer;
   - **N1:** a CREATE/CREATE2 reachable inside bytes shaped like Solidity's CBOR metadata tail is
     skipped by the runtime check, so a hidden-jump factory passes (test "KNOWN LIMIT (Ruling H12,
     N1)" pins it as a limit, not a goal); a constructor that created contracts is still caught by
     the nonce check and blocks the builder;
   - the ERC-20 check looks for literal PUSH4 selectors (a computed selector passes), a contract can
     CALL an existing factory, and custom admin schemes (an immutable deployer, `admin()`, other
     roles) read as no owner concept.
   Plain factories (CREATE/CREATE2 in the runtime) are refused.
   - **N7 (accepted):** a row left `unknown` keeps its reserve, not its receipt cost; when settling
     it from the explorer, also correct `cost_micro_usd` if Base's L1 fee ran over the reserve.
6. `deploy-owner:<id>`: read the contract's `owner()` and `hasRole(0x00…, deployer)`; if the deployer
   still holds a right, renounce it by hand from the deployer key (the code never does). Then
   `UPDATE contract_deploys SET owner_ok = NULL WHERE id = <id>` to clear the flag (a `blocked` row
   also stops that builder; `SET blocked = false` only after checking what its constructor created) (it goes quiet by
   itself after 24 hours, H11). `deploy-unknown:<id>`: look up `tx_hash` (empty: the send never got a
   hash; check the deployer's nonce on the explorer) and set the row's `status`, `address` and
   `cost_micro_usd` to what happened.

## v2.10.1: the owner's live test of v2.10 (5 bugs)

The owner tested v2.10 in production with their own three projects, sent by Claude Code:
tokens.fun (`minidevai/tokens.fun`, a private repo in an org, a live Base product with fee revenue),
EarnKit (`earnkitai/earnkit`, a private monorepo in EarnKit's own org, an MCP server) and a tipjar
starter (`jenil04/tipjar`, public, on Arc, a few commits, no users). The v2.10 journeys modelled all
three as repos under the builder's own login, so none of these held. `v2101.test.ts` reproduces each
bug with those shapes; journey 11.5 (`v210-journey.test.ts`) replays the whole run and checks every
line the owner sees.

- **B1: a confirmed entry's only step left (`present.ts submitStep`, `submitStepLine`).** Every row
  in `openEntries` that isn't submitted is already confirmed, but `enteredIds` counted only submitted
  ones, so the confirmed program led again ("Want me to finish it?") and the "show more" close said
  "keep going". Now every entry counts as entered (marked "(entered)", never offered), and the newest
  entry not submitted yet leads the short reply and closes "show more": "Your tipjar entry for Arc
  Microgrants is ready. The only step left: submit it on DoraHacks by Oct 14. Did you submit it?".
  The site is `Card.submit_site` (`programs.ts submitSiteName`: the submission proof's host, else the
  submission URL's, by a short name map, else the host). `find` returns `lead: { program_id,
  step: 'submit', project_id }` and `LEAD_NOTE` tells the agent a yes is `tell` with `submitted`,
  never another prepare.
- **B2: real use outweighs polish (`match.ts REAL_USE_TX`, `realUse`, `withRealUse`).** The tier and
  the shown score were the six polish signals; measured use (the Blockscout count) only fed traction
  after the tier gate, and "needs real users" was cleared only by a claim. On top, a private org repo
  read from the local view failed the contribution read (404), so `owned` was false and tokens.fun
  was "not your repo", project tier, low odds, "needs real users", score 4, below the starter's 6.
  Now: 50+ transactions to the repo's own contract with code is real use. It makes the repo a
  product whatever its polish (`withRealUse`, in `match-projects.ts scored`) unless it is a copy or
  known to be someone else's; it passes a program's `min_product_score`; it clears `real_users` on
  a "needs a live product" program. A local repo whose GitHub owner can't be read (contribution read
  null) has `owned` unchecked (`Candidate.ownerUnknown`, `ScoreCtx.ownerUnknown`), never "not your
  repo". `RepoFacts.tx_count` and `FitRepo.tx_count` carry the count (alerts read it; a remembered
  repo from before v2.10.1 reads as unknown). `matches` rows (`tools.ts matchRows`) carry `odds`,
  `low_reason` and `traction`, rank by odds, traction, then score, and no longer show
  `product_score`.
- **B3: products-only programs (`match.ts matchRepo`).** An any-chain or investment program (a16z,
  Ruling G15) gave a polished starter a row with nothing missing. Now, without measured real use, the
  row is `after_step`, `missing: ['real_users']`, note "needs real users first", effort weeks, and
  `rowOdds` makes any row missing `real_users` low odds ("low odds: no users yet"), so it never
  leads, counts in "$X you qualify for", or alerts (`repoCanWin`). With real use it is v2.9's company
  step (`INVESTMENT_NOTE`).
- **B4: no named repo dropped silently (`match-projects.ts SKIP_REASONS`, `present.ts skippedLine`).**
  The v2.10 private-repo fix covered 404s only; a repo under `earnkitai` (EarnKit's own org, v2.9
  A1) was filtered before any read, named or local, with no line. `matchProjects` now returns
  `skipped: { name, reason }[]` for every repo the agent named (`repos` or `local_repos`) that gets no
  row: EarnKit's own repo, a fork, a template, archived, GitHub didn't answer, past the 8-repo limit,
  a second unseen private repo, no onchain code found, too little product, or no open program fits.
  The reply says them in one declarative line after the private lines: "Not matched: earnkit
  (EarnKit's own repo)." A GitHub user's own list is never listed (it can hold dozens). `userRepos`
  returns `dropped` as a key-to-reason map so a local report of a dropped repo says why too.
- **B5: replies name only the tools the client lists (`aliases.ts forOldClient`, `inOldWords`,
  `aliasedIds`; `app/mcp/route.ts forOldNames`).** Production's `tools/list` has always returned the 4
  tools; claude.ai keeps the list it read when the connector was added (v2.9's 8) until the
  connector's tools are refreshed or it is reconnected, while every reply named `find`, `prepare`,
  `confirm` and `tell`. The server is stateless, so it can never push `notifications/tools/list_changed`
  on its own. Now a call that came in under an old name is proof the client has the old list: the
  route rewrites that reply's agent strings into the old tools and their v2.9 argument words ("call
  prepare" to "call prepare_submission", "confirm with project_id and yes: true" to "launch_token
  with project_id and builder_confirmed: true", "tell with submitted" to "record_submission with
  builder_submitted: true", and so on; `show_to_*` and `question` are builder text and left alone),
  adds `tools_note` (`STALE_TOOLS_NOTE`, names no tool), and, when the client accepts
  `text/event-stream`, answers as an SSE stream whose first event is `notifications/tools/list_changed`
  (the protocol's signal to list again, sent on the POST's own stream). A call under a new name is
  plain JSON, unchanged. `serverInfo.version` is now `2.10.1`. The server instructions still name
  the 4 tools (they come with `initialize`, before the server knows which list the client holds).

### v2.10.1 fix round 1 (review: C1, I1 to I3, M1 to M4)

- **C1: the real tokens.fun.** tokens.fun has no contract of its own (it launches through Clanker's
  and Uniswap's shared contracts), and GitHub can't show its repo. Three changes, matching only:
  - *The builder's own commits stand in for the owner read.* `local_repos[].my_commits_90d` (the
    builder's own commits from the local git log). When the contribution read can't say (404) and
    it is above 0, the repo is owned for matching and its commit count is the traction count. The
    launch, deploy, entry and bonus gates keep their own proofs. Re-review m1: only a 404 counts
    (`contributionRead().notFound`); a rate limit or outage leaves the repo unchecked and not owned.
    Re-review m2: the count is traction only for an owned repo, else the last-commit band.
  - *A users claim is real use.* `match.ts hasRealUse` is measured use or the builder's `users` claim
    (tell's `has_users`). It clears "needs real users first" for any-chain and investment programs (I2;
    the claim joins `open`, so a likely row says "confirm: users"), passes the score floor, and makes a
    repo a product with a live link and a commit in 90 days (`withRealUse`).
  - *Ask, never guess.* `present.ts usersAsk`/`usersAskLine`: a product-tier repo with good odds, no
    measured use, no claim and no answer yet (`RepoFacts.users_said`), whose open program waits only on
    real users, and which ranks above the lead's repo (or there is no lead), is asked about instead of
    the lead: "tokens.fun could win up to $5,000 on Base with real users. Does it have real users or
    revenue? (yes/no)". `find` returns `users_question: { repo, agent_note: USERS_NOTE }`. The agent
    passes the answer to tell (`repo_facts: [{ repo, has_users }]`). A no is never asked again, and the
    row keeps "low odds: no users yet".
  - Not built: an app or fee wallet as measured use. It needs a signature proof to stop someone
    borrowing a busy wallet, so it is not the cheap free source the review allowed.
- **I1: shared contracts are never anyone's.** `shared-contracts.ts SHARED_BASE_CONTRACTS` lists the
  Clanker and PoolManager addresses (a test keeps it in step with `traction.ts CLANKER_ADDRESSES`), the
  Uniswap v2/v3/v4 periphery, the Universal Routers, Permit2, WETH, USDC, Multicall3, the EntryPoints,
  0x, 1inch and Aerodrome. They are dropped from reported contracts and from config addresses, so
  they never count as deployed or as use. Real use (`RepoFacts.tx_count`, runChecks `used_tx`) counts
  only contracts the agent reported. A busy contract a config file merely mentions still feeds
  `traction`, but is never real use.
- **I3: old-name replies.** The reply is plain JSON again (no `list_changed` stream). `aliases.ts
  withOlderNames` writes each tool reference in both forms ("call prepare (prepare_submission if your
  tool list is older)"; "call find with program_id" names get_program). Prose is left alone ("find
  another program"). The argument words stay the new ones: an old name called with `yes`, `skip_token`,
  `check`, `submitted` or `pickup` is that new call as given (`aliasCall`). `STALE_TOOLS_NOTE` assumes no
  list: "If EarnKit's tools look out of date, ask the builder once to refresh ...".
- **Minors.** M2: `LEAD_NOTE` says that on a no to the submit question, say nothing more until the
  builder brings it up. M3: the GitHub skip reason has no ";". M4: done in I3.
  - Skipped: M2's 24-hour hold, since the line stays until the builder answers. M5 and M6 are no-ops
    (the review accepted them).

## v2.10.2: the odds fixes (v2.11 T1, spec 8a and 8b)

Two bugs from the owner's live test of v2.10.1. `v2101.test.ts` reproduces both with the owner's
real shapes; journey 11.6 (`v210-journey.test.ts`) replays tokens.fun through the tools.

- **8a: a repo EarnKit can't read is asked about, never scored low.** The owner's agent doesn't send
  the optional `my_commits_90d`, so tokens.fun (a private org repo GitHub 404s, live, no contract of
  its own) stayed project tier with "low odds: not enough signs of a real product yet", the starter's
  traction (3) and no users question.
  - `match.ts Odds` is now `'good' | 'unknown' | 'low'`; `oddsRank` orders good, unknown, low.
  - `productOdds(p, t, score, { ownerHidden, saidNoUsers })` (S4): a repo GitHub hides (404 only,
    re-review m1: `contributionRead().notFound`, carried as `Candidate.ownerHidden` and
    `ScoreCtx.ownerHidden`), with `owned` unchecked, original, active, deployed, reaching 5 once the
    unchecked signals count, and a live link that loads, is `unknown`. Measured transactions of 0,
    or the builder's "no", keep it low with "no users yet". A rate limit (403) stays low as before.
  - `rowOdds` gives an unknown repo's row `unknown` with `USERS_UNKNOWN` ("users unknown") while it
    waits only on users; the "show more" cell reads `tokens.fun, users unknown`, never "low odds".
  - `present.ts usersAsk` also asks about an unknown repo wherever it ranks, unless the lead's repo
    has real use. The copy is unchanged. A yes is the v2.10.1 users claim (`withRealUse`, since
    `owned` is unchecked, not missing); on a hidden repo an active repo is enough for the claim, so
    a yes never depends on an optional field. `checkLocal` reads a missing `last_commit_at` as an
    unknown commit count (null, scores 0), never "no commits in 90 days".
  - Never good: `qualifies`, `leadRow`, `anyGood` and the alerts (`alerts.ts repoCanWin` refuses
    `unknown` as it does `low`) all treat unknown as not good.
- **Real use outranks traction (S5).** The rank is odds, then `hasRealUse` (measured or claimed),
  then traction, then difficulty, prize and quickness: `match-projects.ts` fits sort, `present.ts
  byOdds` (so `layout`, `betterFit` and `bestFit`; `Fit.real_use`), and `tools.ts matchRows`. A
  product with users ranks above a starter at any traction tie.
- **8b: a row missing a requirement is never good odds.** `rowOdds` ignored `new_work`, so the
  tipjar starter (good odds itself) showed good odds on World's Fair (new work only) in `matches` and
  headed "show more" with "Your repos fit these open programs:". Owner rule (fix round 1, I2): a
  row missing new work ("only new work counts") or users the program needs ("no users yet") is low
  for every repo. A missing deploy or live link is low only below product tier (an unknown repo:
  "not deployed yet", or `NOT_ON_MAINNET` "not on mainnet yet" when a chain is on testnet only,
  `deployReason`; "no live link yet"). A product one deploy or one link away keeps its v2.10.1 odds
  and can lead, since EarnKit does those steps. A project-tier repo's own reason still comes first
  (R2).
- The launch, deploy, entry and bonus gates are unchanged: all of this is matching and copy only.

### v2.10.2 fix round 1 (review: C1, I1, I2, M1 to M6)

- **C1: the users question picks across all repos (`present.ts usersAsk`).** With the Arc entry
  submitted there is no lead, and the first fit (the tipjar starter, waiting on users at Circle and
  a16z) was asked instead of tokens.fun. Now every candidate is collected, then ranked: unknown repos
  first, then good-odds products ranked above the lead, a grant before an investment, then the fits
  order. A good product is a candidate only at traction 4 or more (`GOOD_ODDS_TRACTION`), so a starter
  (a live link and a few commits, nothing measured) is never asked. A yes or a no (`users_said`) is
  final. Journey 11.7 replays the owner's flow with the real program files.
- **I1:** an unknown repo is also asked on a row with nothing missing (the yes promotes it
  everywhere), and that row has no reason, so the cell is just the repo, never "users unknown".
- **I2:** see 8b above. Journeys 12.3 and 12.4 read as in v2.10.1 again.
- **M1:** find's `last_commit_at` says "Always send it.". **M3:** a rate-limited owner read reads
  "owner not checked yet" (`OWNER_UNCHECKED`), never "not enough signs of a real product". **M4:**
  `bestFit` never offers an unknown row. **M6:** `usersAskLine` reads a range prize as "up to" the
  top (`max_award_usd`).
- Skipped: M2 (a yes on a 404'd repo needs only an active repo; gates keep their own proofs) and M5
  (the question shows until answered; recording "shown" would drop it when the agent never showed it).

### v2.10.2 fix round 2 (re-review R1-I1)

- **A starter is told apart by age or origin, never by traction (`present.ts starterRepo`).** Round 1's
  "traction under 4" also skipped real products (tokens.fun as the builder's own public repo, or with
  `my_commits_90d: 5`, scores 3). A starter is now a repo created within `STARTER_DAYS` (30) days
  (GitHub's `created_at`, or the agent's optional `local_repos[].first_commit_at`, which
  `reportedFacts` turns into `created_at`), or one made from a template or an EarnKit starter
  (`original` missing). A repo of unknown age and no template mark is not a starter. Absent fields only
  ever make a repo askable, never a starter.
- `usersAsk` asks a good-odds product that isn't a starter when it ranks above the lead, or when the
  lead's repo is a starter without real use (a starter's lead never outranks a real product's
  question). It takes `now` (tools.ts passes `first.now`).

## v2.11 One yes to a shipped entry (Tasks 1 to 13)

A builder with no repo that fits says yes once and ends with a contract deployed on Arc that they
own, a live link, a ready entry and the submit kit. The agent builds; EarnKit picks the program,
checks the agent's work, deploys, hosts, drafts the entry and records each step. Every part fails
closed: with deploys off the builder sees v2.10's reply byte for byte. Spec and plan:
`docs/design-docs-and-implementation-plans/v2.11-one-yes.md` and `v2.11-one-yes-plan.md`.

### The path, as the builder sees it (`v211-journey.test.ts` 13.1)

| Call (agent) | Builder sees |
|---|---|
| `find { github_user }`, no repo fits | `$1.1M+ in prizes is open right now across 7 programs.` / `Arc Microgrants pays 500 USDC and closes in 3 days. A USDC tip page on Arc takes about an hour. Want me to build it?` |
| the yes: `prepare { build: { start: true, program_id } }` | `What should it do for you or your users? One line is enough, like "tips for my podcast listeners". Add the wallet that should own it.` |
| the answer: `prepare { build: { program_id, twist, name, description, feature, for_whom, wallet } }` | `Building PodTips: a USDC tip page on Arc for your podcast listeners. I'll be back with the live link.` |
| the same with `repo_url` (for the earnkit.txt line) | nothing |
| `prepare { project, deploy, host: true, build: { program_id } }` | nothing (the deployed line waits) |
| the upload to `host.upload_url` | nothing (its own live line waits; the agent is told) |
| `prepare { project: { ..., live_url }, build: { program_id } }` | `PodTips is live: podtips-<login>.earnkit.com` / `PodTips is deployed on Arc: 0x0000…11ce. You're the owner.` / `Yes submits your entry and launches $PODTIP (PodTips): 40% of its fees to you, plus the builder bonus. Wallet: 0x12ab…9f3e. yes / skip the token` |
| `confirm { yes: true, wallet, token }` | `Your token $PODTIP is live: tokens.fun/coin/0x….` then the DoraHacks kit (copy and paste; the builder clicks submit) |
| `tell { submitted }` | `Entered in Arc Microgrants. Your token: ….` / `Send me your dorahacks.io entry link to join the builder bonus.` / the bonus line |

"skip the token" instead of yes: `No token, no builder bonus.` then the same kit; the entry is just as
ready. Hosting off (no R2): the live line is `PodTips is live: <login>.github.io/podtips`. At most one
`?` per reply, "40%" once per flow, no address outside the deployed line, no wallet the builder didn't
give. Events: `built`, `deployed`, `hosted`, `entered`, `submitted`, once each.

### The no-repo lead (T7, spec 1)

- **When.** The short first reply (`present.ts presentFirstMessage`, not "show more") gets this lead
  only when nothing else leads: no good-odds row (`leadRow`), no entry waiting on the builder's
  submission (`submitStep`), no users question (`usersAsk`), no held question, no open program the
  agent is preparing (`working_on`), no repo read error or repo EarnKit can't see. Then
  `freshLead(given)` asks `fresh-build.ts freshPick`, and a pick replaces v2.10's "No repo fits yet.
  $X is open; want the 3 easiest?" with `contextLine` (the site's money figure over the same programs
  `pool.ts openCurated` sums) and `freshLeadLine`. Chat-only and shared clients get "... A coding
  agent builds the USDC tip page in about an hour. Want the plan?" and `PLAN_NOTE`.
- **The pick (`freshPick`, pure).** Open and curated (never sponsored, an EarnKit campaign or an
  investment, never "long shot" or "needs a live product", never hidden or entered); the program's
  `fresh_build` names a registered starter tested within 30 days of now, on one of its chains;
  EarnKit deploys to that chain, and hosting is on or the starter has a GitHub Pages fallback; Easy or
  Medium; a known prize per winner of $5,000 or less; closing 24 hours to 14 days from now (rolling
  only when no dated one fits). Rank: Easy, more winners per round, sooner close, higher prize.
- **The switches (`tools.ts freshSwitches`).** Deploys on a chain need `deployChainOn(c)` (the key
  and the chain in `DEPLOY_CHAINS`, v2.10.3) and the chain's RPC; hosting needs `r2Enabled()`. So
  with `DEPLOY_CHAINS=base` the Arc starter is never offered, and find's reply is v2.10's byte for
  byte. `ctx.freshDeps` overrides them in tests only.
- **find's reply.** With a pick, `build_offer { program_id, starter_id, agent_note: BUILD_NOTE }`.
  The first build lead shown off a shared client sets `installations.fresh_offer_at` once
  (`installations.ts markFreshOffer`): the metric's start. The lead itself shows on every find while
  nothing else leads.
- **`agent_can_build` defaults to true** (T7 review M4), so a chat client that isn't marked shared and
  leaves the flag out is offered the build and starts `fresh_offer_at`. The metric script keeps it out
  by counting only installations that said yes to the build (below).

### Starters (T4 to T6, spec 2)

- **Registry.** `starters.ts STARTERS`, pure data: `id`, `chain` (arc or base), `repo` (the degit
  path), `what` (builder copy: "a USDC tip page on Arc"), `minutes: 60`, `contract` (`artifact`,
  `owner_arg`, `bytecode_hash` = keccak256 of forge's exact creation bytecode, `constructor_types`),
  `site_dir`, `pages_fallback`, `kit_twist` (the kit's own slots), `usage_event`, `usage_read`
  (`view_total` with `usage_view`, or `recent_logs`), `tested_at`, `test_cmd`.
- **Today only `arc-tipjar`:** chain-kits `arc/tipjar` (main 0f573a7), `UsdcTipJar(owner_, name_,
  minTip_)` (the builder owns it from the first block), `stats()` running totals (selector
  `0xd80528ae`), `site/`, `bash scripts/e2e.sh`, tested 2026-10-11. No Base starter and no x402
  build path (owner decision 4). Its package name and README heading are in `EARNKIT_STARTER_NAMES`.
- **The program field.** `"fresh_build": { "starter": "<id>" }`, owner-set only, where the program's
  own facts support a fresh build (`programs/README.md`). `program-file.ts freshBuildProblems` (run by
  `programs:check` and before `programs:sync` writes) refuses an unknown starter, one off the
  program's chains or `needs_contract` chain, and one untested or tested more than 30 days before the
  program's `verified_at`. Stored in `programs.fresh_build`; `listPrograms` cards carry it. Arc
  Microgrants carries `arc-tipjar`.
- **Keep it fresh.** The pick also holds the 30 days against now, so the lead stops on its own when the
  starter's test ages out. Rerun the test in chain-kits and update `tested_at`. Final fix I4:
  `programs:check` (and sync) prints `Warning: <id> tested N days ago ...` once a starter some program
  offers is over 23 days old (`program-file.ts starterAgeWarnings`), a week's notice; it never fails
  for it. No test depends on the real date: the journeys pass today's date as `tested_at` through
  `freshDeps.starters`.

### The twist and the build kit (T8, spec 3, plan S6 and S7)

- **`prepare` with `build`** (`tools.ts prepareBuild`, strict; listed in the MCP schema only while
  deploys are on):
  - `{ start: true, program_id }`: the yes. One question (`twistQuestion`), plus the statement "Add
    the wallet that should own it." when no wallet is known (decision D-D). Stores
    `installations.build { program_id, starter_id, started_at }` (a new start replaces it).
  - `{ program_id, twist, name, description, feature, for_whom, wallet?, repo_url? }`: what the agent
    wrote from the builder's answer. On a pass: the building line and `kit`; the same fields again
    (say with `repo_url`) show nothing new.
  - `{ program_id }`: the build mark (below).
- **Fail closed.** Each call re-runs the pick on that program (`buildPick`). No pick: an agent note,
  nothing stored. A shared client gets `BUILD_CHAT_ONLY` and nothing is stored.
- **The checks (`fresh-build.ts buildCheck`, pure; EarnKit runs no LLM).** Plain one-line words
  (`coach.ts plainProblem`) within limits; the name is never a kit name; the twist names something of
  the builder's own, and the name and description each use a word or stem of it; the feature is one
  sentence of the builder's own, never the kit's default; `for_whom` starts with "for"; a wallet is
  valid and never the zero address or a public test wallet (`PUBLIC_TEST_WALLETS`). Every refusal is
  `Fix build.<field>: ...` in `agent_note`, with an empty `show_to_builder`. A valid wallet is kept
  across a refusal and remembered on a pass, so it is never asked twice.
- **The kit (agent only, `buildKit`).** The degit command, the filled twist slots, `owner_wallet`,
  `earnkit.txt` with `proof_line` (null until `repo_url`), the artifact shape, the next call, the rules
  and `order`: find with `github_user` (never guessed), copy and fill, create the public repo (no
  template, not a fork), commit with earnkit.txt, push at once (within 10 minutes of creating the
  repo, never a force push), then prepare.

### Deploy and host in one call, with no click (T9, spec 4, decision 2, plan S9 to S11)

- **The mark with `deploy` (`tools.ts buildShip`)**, never on a shared client, only for this
  installation's checked build of the same program, in order:
  1. Deploys off for the starter's chain: v2.10's `Deploys are off right now.`; nothing read or written.
     With the key on but the chain left out of `DEPLOY_CHAINS` (v2.10.3), the same refusal as
     `deployStep`: `Deploys on Arc are off right now.` with `deployOffNote` (no chain left: v2.10's line).
  2. Still a fresh pick; the artifact is on the starter's chain; the starter's exact bytecode
     (`bytecode_hash`) followed by exactly its constructor arguments, ABI-encoded with the starter's own
     types, `constructor_args[0]` and `owner_wallet` the build's wallet. Else an agent note.
  3. The repo (never under an EarnKit org) holds this agent's earnkit.txt line, and the owner is
     proven (below). Else an agent note (`BUILD_OWNER_NOTE` asks for a fresh push).
  4. `built` (key `built:<installation>:<repo_key>:<program_id>`, proof the repo link, `detail
     { starter, twist }`) through `deployForBuilder`'s `beforeSend`, after every cap passed.
  5. The capped v2.10 deploy: once a day per chain and 3 in 30 days per builder, 3 a day per chain and
     10 in 30 days per repo, 20 a day in total, $0.25 a deploy, $10 a month, Arc and Base only. The
     `deployed` event names the starter only on its exact bytecode.
  6. Only when the build wallet owns it (`owner_ok`): the one-use upload URL (`host.upload_url`,
     `BUILD_UPLOAD_NOTE`), or, with EarnKit hosting off or refused, `host: { github_pages: true,
     site_dir }` with `BUILD_PAGES_NOTE`. The builder sees nothing yet (`BUILD_HOLD_NOTE`).
  7. Final fix M8: a deploy of this build sent on an earlier call whose receipt never came (`unknown`
     with its tx hash) is settled before step 5 by `deploy.ts settlePendingDeploy` (read-only: the
     receipt, code, `owner()`, `hasRole`, nonce; no send, no transfer) with its `deployed` event, and
     (security re-review 4 F1) only a row the build path sent: `contract_deploys.starter` (set at
     reservation only on the starter's exact bytecode) is this starter and `owner_wallet` is the
     build's current wallet; the event's label comes from the row. Any other unconfirmed row is left
     alone and the normal path's day cap refuses (fail closed). Its cost stays at the reserved upper
     bound (F3, over-counted, accepted). Then
     the call goes on to step 6. Still no receipt: the pending line again with `BUILD_PENDING_NOTE`
     (make the same call again in a few minutes). Nothing is ever deployed twice.
- **When the site never goes up (final fix I2).** `BUILD_HOLD_NOTE` and `BUILD_PAGES_NOTE` tell the
  agent: if the site isn't live within 15 minutes, call prepare with `build: { program_id }` and no
  `live_url`. `buildJoin` then gives the deployed line and the usual draft ("Before you submit: a live
  link on Arc mainnet." and the entry table; no question invented), with `BUILD_NO_LIVE_NOTE` so the
  agent never puts another link in `live_deployment_url`.
- **Hosting with no click (`hosting.ts issueUpload`, S9).** Off a shared client with no sign-in for the
  repo, the owner-bound proof line stands in for the sign-in: the line's pusher is the repo owner, the
  login the builder said (`installations.github_user`), a User account by GitHub's public read
  (`githubUser`, cached 24 hours as `ghuser:<login>` in `url_checks`) that passes v2.9's gate (30 days,
  1 public repo). The GitHub sign-in variables are no longer needed off a shared client; a shared
  client keeps v2.9's sign-in. `host_upload_tokens.basis` and `host_deploys.basis` (`signin` | `app` |
  `proof_line`) carry the basis to the `hosted` event; the upload re-checks it. A proof-line link never
  replaces a site made under another login. Proof reads are capped at 20 an hour per installation.
- **GitHub Pages (S10, final fix I3).** GitHub serves a branch only from `/` or `/docs`, so
  `BUILD_PAGES_NOTE` has the agent push the contents of `host.site_dir` to the root of a `gh-pages`
  branch (`git subtree push --prefix <site_dir> origin gh-pages`, or `git push origin "$(git
  commit-tree HEAD:<site_dir> -m site)":refs/heads/gh-pages` without git subtree) and turn Pages on
  with `gh api -X POST repos/<owner>/<repo>/pages -f 'source[branch]=gh-pages' -f 'source[path]=/'`
  (GitHub's REST "Create a GitHub Pages site"; both git routes checked on a scratch repo). It serves at
  `https://<owner>.github.io/<repo>/`. The next call's live link counts only when it is the build repo's own Pages
  link (`pagesLinkOf`), with a contract EarnKit deployed for this installation and repo, and its probe
  passes: `hosted` with `detail.host = 'github_pages'`, key `hosted:gh:<installation>:<repo_key>:<link>`.
- **The owner proof (`ownership.ts fetchLinePusher`).** Final fix M6: the fork and template reading is
  kept per repo (`github-verify.ts repoEverDerived`, `url_checks` key `ghrepo:<owner/repo>`): a repo
  that ever read as a fork or as made from a template stays refused when the flag is erased later.
  From GitHub's activity API, the actor of the
  push that introduced the line (the branch walked back; at most 6 raw reads). A `push` credits its
  actor; a `branch_creation` only as the repo's very first event, within 10 minutes of the repo's
  creation; force pushes and merges credit no one; an earlier push of the same commit decides. And
  only the actor's own fresh work: not a fork or template; no merge commits; committer dates from 10
  minutes before the repo's creation and 5 minutes before this installation's first issue of the line
  (`proof_line_issues`, written by `noteLineIssued`) up to the push. Commit author fields are never
  used. Deploys with no sign-in or App proof need this proven owner (`provenOwnerLogin`, stored as
  `contract_deploys.line_owner`).
- **Accepted residual (the `proof_line` basis, the weakest).** An attacker who gets the repo owner to
  push the attacker's line, dated inside the window, in a fresh non-fork repo, is credited as that
  owner for that repo. They get hosting for that repo, `proof_line` events naming the owner (never used
  for money or scoring) and use of the owner's deploy caps. No money moves: the contract belongs to the
  wallet the attacker named, gas sits under the global caps, and nothing touches tokens, fees, bonuses
  or payouts. The repo-creation bound is the real defence; sign-in and the App stay the strong bases.
- **Keys.** Only `deploy.ts` reads `DEPLOYER_PRIVATE_KEY`; no reply, kit, repo or site gets it. The
  builder signs nothing.

### The entry from the build, one reply, the kit (T10, spec 5)

- **The call after the live link (`buildJoin`).** With a contract EarnKit deployed for this
  installation and the build's repo, the entry is drafted from the build: repo, live link, contract,
  description (the agent's, else the build's, `coach.ts derivedDescription`), and the public profile
  (`coach.ts derivedProfile`: `https://github.com/<login>` from `loginBasisFor`; no login, the coach
  asks). Arc asks no coach question.
- **One reply** (`prepare_submission(input, ctx, join)`): the live line, the deployed line, v2.10's
  confirm line with the build wallet; no guide or table; "40%" once (a repeat drops it). It carries
  `entry { project, answers }`, `shown_wallet` and `BUILD_ENTRY_NOTE`.
- **The live line (`buildLiveLine`).** EarnKit hosting only for this installation's live site of the
  repo; Pages only for the repo's own Pages link whose probe passes (`pagesLiveLine`). Any other link is
  never called live.
- **The confirm wallet (`buildWalletAgain`; owner ruling on final fix M4: another wallet is allowed).**
  On the build path a yes launches only to the wallet the confirm line showed
  (`token_offers.offered_wallet`, the build's wallet first). A yes naming another wallet gets the
  confirm line again showing it ("Wallet: 0x…"), with nothing recorded or launched; the builder's next
  yes launches to that wallet. The token never launches to a wallet the builder didn't see.
- **Then v2.10's flow:** the yes (or "skip the token") records the entry (`entered`), launches or
  skips the token and hands over the kit; `tell { submitted }` marks it (`submitted`).

### The event log and its trigger (T2, T3, spec 6)

- **Table.** `builder_events`: `built`, `deployed`, `hosted`, `entered`, `submitted`, `won`, `lost`,
  `usage_check`, with `github_login` and `login_basis` (`signin` | `app` | `proof_line`; `repo_owner` is
  never written), the wallet the builder gave, repo, program, project, chain and a public proof
  (`proof_tx`, `proof_url`). No FKs. `dedupe_key` UNIQUE, every write `ON CONFLICT DO NOTHING`, so
  reruns and the backfill never double-count (journey 13.2 reruns every call and writes nothing).
- **Append-only.** `builder_events_append_only()` backs a row trigger (BEFORE UPDATE OR DELETE) and a
  statement trigger (BEFORE TRUNCATE); all raise. The one exception is the owner's redaction: inside
  one transaction `set_config('earnkit.events_redact', 'on:' || txid_current(), true)`, then an UPDATE
  that may only null `github_login` and `wallet` and change `detail`. A value not bound to the current
  transaction never opens the table. It guards app code paths, not a hostile role (on Neon's single
  role the app owns the table). `events.test.ts` scans `lib/` and `app/` so app code never touches it.
- **Writers.** `events.ts recordEvent` (zod-checked, lowercases login, wallet and repo key, `detail`
  over 2 KB stored as `{ truncated: true }`, logs `[events] <type> <ErrorName>` only, never fails the
  step) through `noteEvent(type, build)` (lazy, waits at most 1 s). Off unless `EARNKIT_EVENT_LOG=on`.

  | Event | Written by | dedupe_key | Proof and detail |
  |---|---|---|---|
  | built | `buildShip` via `deployForBuilder.beforeSend` | `built:<installation>:<repo_key>:<program_id>` | `proof_url` repo; `detail { starter, twist }` |
  | deployed | `deploy.ts deployForBuilder` once settled | `deployed:<contract_deploys.id>` | `proof_tx`; `detail { address, owner_ok, block, starter?, code_differs? }` |
  | hosted | `hosting.ts deploySite` / `approveSite`; the build's Pages link | `hosted:<host_deploys.id>`, `hosted:gh:<installation>:<repo_key>:<link>` | `proof_url` the site; `detail { host: 'earnkit', slug }` or `{ host: 'github_pages' }` |
  | entered | `projects.ts recordSubmission`, `startEntry` (new rows only) | `entered:<project_id>` | `proof_url` `/p/<id>` |
  | submitted | `projects.ts recordSubmission` (tell submitted) | `submitted:<project_id>` | `proof_url` the entry link when given; `detail.basis` link / builder_said / recorded |
  | won, lost | `outcomes.ts syncOutcomeFile`, `saveSelfReport` (after the commit) | `outcome:<project_id>:<round>:<basis>` | results URL; `detail { basis, result, round, prize_usd }` |
  | usage_check | `events.ts usageChecks` (cron) | `usage:<deployed event id>:<30\|90>` | below |

- **Identity (`github-verify.ts loginBasisFor`).** Off a shared client: this installation's sign-in or
  App proof of the repo; else the proof line's proven owner (`proof_line`). On a shared client only the
  caller's own verification or the one bound to the entry. Never `GITHUB_TOKEN`'s login.
- **Backfill.** `scripts/events-backfill.mts` (owner only, `EARNKIT_EVENT_LOG=on`, after the /terms
  section is live) replays `installations.build`, `contract_deploys`, `host_deploys`, `projects`,
  `submissions` and `entry_outcomes` with each row's own time and the live dedupe keys
  (`detail.backfill = true`; a rerun writes 0). Never in predeploy or the cron. Final fix I1: `built`
  comes from a build (never a shared client's) whose `repo_url` got a `contract_deploys` row the build
  sent (F5: its `starter` and build wallet, made after `build.started_at`, never reverted; the first
  such row's time; the build's wallet, starter and twist; the login proven for that
  row). A GitHub Pages `hosted` comes from an entry whose `live_url` is its repo's own Pages link
  (`pages-link.ts pagesLinkOf`) with a deployed contract for that installation and repo (the entry's
  time, `hosted:gh:` key, `detail { host: 'github_pages', probe: false }`, no probe). An EarnKit
  upload keeps `host_deploys.basis` as its `login_basis` (M1: a proof-line upload is `proof_line`).

### Usage checks at 30 and 90 days (T11, spec 7, plan S12)

- **Where.** `events.ts usageChecks`, one step of the existing hourly cron after `deployerGas`
  (`usage_checks: { checked, failed }` in its JSON; never a `needs_owner` line). Off while the event log
  is off.
- **What is due.** A `deployed` event on arc or base (an address, not `code_differs`) at least 30 days
  old with no `usage:<id>:<window>` row; 90 once 90 days old. Oldest first, at most 20 checks a run,
  none started after the cron's deadline.
- **What it reads, free sources only.** `eth_getCode` everywhere; Base: Alchemy's lifetime count capped at 100
  (`tx_scope: 'lifetime'`, `source: 'alchemy'`); Arc with a `view_total` starter: one `eth_call` of its view
  (`totals: { tips, total, tippers }`, `source: 'rpc_view'`; a revert or empty answer falls back to
  logs); Arc `recent_logs`: the last 50 ranges of 10,000 blocks (about 2.9 days), newest first,
  labelled `recent` (never a 30 or 90 day total; never sum `recent.tips`).
- **Failures.** A failed read writes nothing and is tried again 20 hours later at the earliest
  (`usage_check_failures`); after 5 in a row the deploy sits out 7 days. A failed write counts as a
  failure.

### Terms disclosure and redaction (T12, spec 9, owner decision 6)

- **/terms "What EarnKit records"** (`#what-earnkit-records`; copy in `policy.ts RECORDS_*` and
  `RECORD_STEPS`, pinned by `public-pages.test.ts` 12.1; linked from the terms nav and the `/p/<id>`
  footer). It lists what the agent sends, what EarnKit reads itself, the IP for up to 3 days as a
  rate-limit key, the steps with their proofs (including "A build: its repo and your one-line idea for
  it."), why, retention ("for as long as EarnKit runs, unless you ask to remove your login and
  wallet"), and removal. A new field or step changes this copy in the same change.
- **Redaction runbook.** On a builder's email request, from the repo root with production's
  `DATABASE_URL`:

  ```
  pnpm exec tsx apps/frontend/scripts/events-redact.mts --login <login> --wallet <0x...>          # dry run
  pnpm exec tsx apps/frontend/scripts/events-redact.mts --login <login> --wallet <0x...> --apply  # writes
  ```

  The dry run lists the matching rows in a read-only transaction. `--apply` nulls `github_login` and
  `wallet` and drops `detail.twist` and `detail.slug` in one transaction, then prints the rows (keep it
  as the redaction note), the kept rows whose repo or link still names the login, and the other tables
  holding the login or wallet (listed only; the owner decides).

### The success metric (T13): shown, never a target

`scripts/v211-metric.mts` (owner-run, read-only: one READ ONLY transaction over `installations` and
`builder_events`; never in predeploy or the cron) prints counts and one share, and sets no goal:

```
pnpm exec tsx apps/frontend/scripts/v211-metric.mts [--as-of <ISO time>]
```

- **Cohort:** `fresh_offer_at` set, not `shared_client`, and the build started (`installations.build`
  is set: the yes). The yes keeps unmarked chat-only clients out (T7 M4); a coding-agent builder who
  said no is left out too, and the "Shown the build lead" line still counts them.
- **First session:** the 24 hours after `fresh_offer_at`. Sessions still open are counted apart and
  left out of the share.
- **Shipped:** a `deployed`, a `hosted` and an `entered` event of that installation inside the session
  (`entered` is the confirm step that hands over the kit).
- **Output:** `Shown the build lead`, `Said yes to the build`, `Still in their first 24 hours`,
  `Shipped in their first 24 hours`, then `<n> of <m> no-repo builders shipped in their first session
  (<p>%)`, and (final fix M2 b) the same share among builds that reached a repo (`build.repo_url`).
  It reads nothing before `EARNKIT_EVENT_LOG` was on.

### The journey (`v211-journey.test.ts`)

Its own throwaway database, every real program file (Arc closes in 3 days and an hour; other curated
programs in 2099), the real starter registry and the real switches (the deployer key and R2 variables
set inside the file only). Fakes only for the outside world: GitHub (the account read, the user's
repos, the new repo, its push record, commits and earnkit.txt), `DeployChain`, R2, the probe and
getCode, the logo reads, the sanctions screen and tokens.fun's deploy API behind the real
`deployToken`. Real time, not a frozen clock: the database's `now()` writes events and upload
tokens. The one seam: arc-tipjar's `tested_at` is today (`freshDeps.starters`). 13.0 Arc names
arc-tipjar and the 30-day rule still stops a stale starter (injected dates); 13.1 the path above with each line exact, one
deploy, one launch, the five events with their proofs and `proof_line` basis, a ready entry, one
build yes; 13.2 a rerun of every call writes no event, deploys and launches nothing; 13.4 "skip the
token", the GitHub Pages fallback, and fail closed (deploys off, or R2 only: v2.10.2's reply byte for
byte, no `build_offer`, no `fresh_offer_at`, a refused build.start); 13.3 the sweep over every reply;
13.5 the metric script as a child process (3 of 3, then shared, chat-only, stalled, late and open
installations counted the right way).

### Env vars (each feature is off when its vars are absent)

| Var | Turns on | Notes |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | Deploys, so the build path and the fresh lead | Set in production 2026-10-11, Base and Arc funded (~$5 each). With it alone, the build path runs and hosts on GitHub Pages |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | EarnKit hosting (`<slug>.earnkit.com`) | Optional: without them the build path uses the GitHub Pages fallback |
| `EARNKIT_RESERVED_SUBDOMAINS` | Names no site may take | With R2; `RESERVED` on the Worker matches it |
| `EARNKIT_EVENT_LOG=on` | The event log, usage checks | Only after `/terms#what-earnkit-records` is live |
| `ARC_RPC_URL`, `BASE_RPC_URL` | The deployer's and usage checks' chains | Public RPCs when unset |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | v2.9 sign-in | No longer needed for hosting off a shared client |

### Owner go-live, in this order

1. **Ship v2.11.** `predeploy` runs the additive migration and `programs:sync` (Arc's `fresh_build`).
   Production already has `DEPLOYER_PRIVATE_KEY`, so from this deploy the no-repo lead offers Arc and
   the build path runs, hosting on GitHub Pages. Refresh the claude.ai connector (the tool
   descriptions changed).
2. **The event log, in the same session (final fix I1).** Smoke-check that
   `https://earnkit.com/terms#what-earnkit-records` loads in production (it ships in this same
   deploy), then set `EARNKIT_EVENT_LOG=on` at once, before the first build. Every build in between
   loses nothing it can't get back (the backfill below), but the live probe of a Pages link and the
   exact times are only the live step's.
3. **The backfill, once.** From a local shell against production:
   `EARNKIT_EVENT_LOG=on pnpm exec tsx apps/frontend/scripts/events-backfill.mts`. It rebuilds
   `built`, `deployed`, EarnKit and GitHub Pages `hosted`, `entered`, `submitted`, `won` and `lost`
   from the tables (each row's own time, the live keys; a rerun writes 0). Never before step 2.
4. **R2 and the host Worker (optional, last).** The R2 bucket `earnkit-sites` (a card on file; usage
   stays in the free tier), `infra/host-worker` on Workers Free with a `*.earnkit.com` route and a
   proxied wildcard DNS record, then the four R2 variables and `EARNKIT_RESERVED_SUBDOMAINS` on
   Railway and `RESERVED` on the Worker. Without them, GitHub Pages hosts every build.

The metric reads nothing before step 2.

Then, as programs come: add `fresh_build` only to programs the owner approves, and curate 3 to 5
small dated programs on Arc or Base. Arc Microgrants closes 2026-10-15 03:59 UTC, and the lead
needs 24 hours left, so from Oct 14 03:59 UTC it has nothing to pick and the reply is v2.10's.

## v2.12 The verified builder score (Tasks 1 to 15)

**v2.12.1 replaced this section's onboarding, replies, scoring, profile, card and leaderboard** (see
"v2.12.1 Where you stand" below). The subsections marked "replaced in v2.12.1" describe code that is
gone or kept only for stored history; the storage, discovery, readers, anti-farming, the hold and the
archives below still hold, with the changes v2.12.1 lists.

Spec: `docs/design-docs-and-implementation-plans/v2.12-builder-score.md`; plan:
`v2.12-builder-score-plan.md` (its plan rulings R1 to R26 and owner rulings D1 to D7 are cited
below). Every person who installs gets a public profile at `earnkit.com/b/<slug>` with a 0 to 100
score and a percentile computed only from verified outcomes (people who used what they shipped).
All of it sat behind one flag (retired in v2.14, see "v2.14 One account: retired switches"), `EARNKIT_BUILDER_SCORE=on` (`builder-score-flag.ts
builderScoreEnabled`; default off, cleared by `fixtures/test-guard.ts`). Off: no profile is made,
no cron step runs, `/b/*` and `/leaderboard` are 404, `score` is not listed, and `find`, `confirm`
and odds are v2.11 byte for byte, and `/terms` has no builder-profiles section (it renders, with
its nav link and description words, only with the flag on; the page is `force-dynamic` so the flag
is read per request). It stays off until the owner's lawyer has reviewed `/terms#builder-profiles`
(spec open decision 1).

### The person key and shared clients (R1, R2)

A person is the installation group's root, `COALESCE(installations.builder_id, installations.id)`
(`identity.ts rootOf`); `builder_id` stays NULL for an unlinked installation (spec 1 said "set to
that installation"; nothing backfills it). Every v2.12 table keys on that root. A group holding a
`shared_client` installation (one registration serving many people) is never a person: no profile,
no discovery, no score; `score` answers `SCORE_SHARED` and `tell`'s profile asks get an agent note.
`identity.ts linkInstallations` merges v2.12 rows in the same transaction (`profiles.ts
mergeProfiles`): sources move to the root (a duplicate is `rejected`, `merged`), the other slug goes
to `profile_slug_history`, its GitHub login and prefill move with it, the other profile row is
deleted, scores stay as history and drop out of percentiles.

### Tables (`db/schema.sql`, additive)

| Table | What it holds |
|---|---|
| `builder_profiles` | one row per person: `x_handle`, `fallback_handle`, `github_login` (unique, lowercase), `slug` (unique), `hidden`, `held`, `twitter_prefill`, `card_offered_at`, `x_asked_at`, `first_find_at`, `empty_checked_at`, `consent_shown_at` |
| `profile_slug_history` | `old_slug` PK -> `builder_id`; an old slug redirects forever and is never given to anyone else |
| `builder_sources` | `kind` (repo, site, package_npm, package_pypi, contract, merged_pr), `ref`, `project_key`, `proof`, `state` (proposed, verified, rejected), `reject_reason`, `proposed_by` (agent, server), `last_read_day`, `deployer`; unique (`builder_id`, `kind`, `ref`) |
| `source_readings` | append-only, one per source per UTC day: `signals` jsonb, `ok`, `error` |
| `builder_scores` | append-only, one per person per UTC day: `score`, `percentile` (snapshot), `parts`, `top_outcome`, `projects`, `formula`, `calibration`, `held` |
| `score_releases` | the owner's release of a held day (never an UPDATE of `builder_scores`) |
| `builder_ranks` | mutable: each person's public score and percentile, rewritten each run |
| `discovery_queue` | one row per person: `reason` (first_find, wallet, signin, local_repo), `done_at`, `attempts` |
| `x_handle_conflicts` | an X handle two people's GitHub profiles list (the owner clears it) |

`programs.agent_completable` (boolean, default true) is new too. `source_readings` and
`builder_scores` refuse UPDATE, DELETE and TRUNCATE (`v212_append_only()` triggers, as v2.11's
`builder_events`). `builder_events.type` gains `source_proposed`, `source_verified`,
`source_rejected`, `reading_taken`, `score_computed`, `score_held`, `profile_empty`,
`profile_hidden`, `profile_shown`, `card_offered`, `x_added`, `card_shared`, `score_viewed` and
`x_cleared`; every writer goes through `noteEvent` with a dedupe key, so the log stays behind
`EARNKIT_EVENT_LOG`. `scripts/events-redact.mts` also clears the profile's login, X handle,
fallback, slug, slug history, the sources' refs, project keys and deployers, and conflict handles.

### Discovery: clues and who the login is (spec 3, R4, R25)

The first `find` (flag on, not shared) makes the profile (`profiles.ts ensureProfile`, a random
`b-xxxxxxxx` slug), queues discovery (`discovery_queue`, `first_find`; insert-only, so a later find
never re-queues without a new clue: "cost stays flat"), and records `local_git` (`{ emails, remotes,
live_urls }`, read leniently by `discovery.ts localGitInput`): remotes become `proposed` repo sources
(R4: clues only, never a login), live URLs `proposed` sites, emails are kept as clues only. A new
clue queues the person again (`enqueueClue`: a wallet remembered at deploy, a GitHub sign-in).

The cron's `discover` step (`discovery.ts discover`, at most `DISCOVER_PER_RUN` = 20 people a run)
does every read first and applies every verdict only after all reads are done, so a person cut short
(deadline, spent budget, failed core read) has nothing decided from partial reads. Who the GitHub
login is (`provenLogin`): a sign-in or App verification when every verification of the group names
one and the same login, else the v2.11 proof line on one of the agent's proposed repos
(`proofLineCheck`, inside the run's GitHub budget and deadline); never guessed. One login, one
person: a login another profile holds names no one. With a login: own repos and org repos where the
person is top contributor (`DISCOVER_CAPS`), forks, templates and ever-derived repos rejected;
clue files of the newest verified repos (`discovery-clues.ts`: `CNAME`, `vercel.json`,
`wrangler.toml`, `package.json`, `pyproject.toml`, foundry `broadcast/**/run-latest.json`, hardhat
`deployments/**`; 64 KB cap, 1 MB for JSON); merged PRs to repos they don't own. Contracts: those
EarnKit deployed for the group, and those a verified repo's deploy file names (R25: only a launched
token's creator wallet or an EarnKit deploy's confirmed owner proves a wallet). Clue 6 (the
`earnkit.txt` site check) left discovery in v2.12.1 S9; since v3.1 site proof it runs on the site's
daily read instead (`sources.ts proveSite`, see "Site proof (v3.1)" below).

### Sources and readers (spec 2, R9 to R12)

`sources.ts` proposes, verifies (only a proposed source; a rejected one stays rejected) and rejects.
Contracts are claimed fail strict (`contractOwnership`): EarnKit deployed it, or a proven wallet
created it, or (repo_link) the repo's deploy file names it AND the onchain deployer is the one that
file names AND it was created after the repo AND its deployer backs no one else's contract. The
`read` step (`readSources`, at most `READS_PER_RUN` = 200 a run, never-read first, then oldest)
reads each verified source at most once per UTC day through `ReaderDeps` (`source-readers.ts`):
repos (outside stargazers from the newest 3 pages, forkers, issue authors, contributors, account
ages up to 80 lookups, commit weeks), sites (`probe`: up is a 2xx, at most 3 same-site redirects),
npm and PyPI downloads (a package verifies only when its metadata names a verified repo), Base
contracts from Alchemy transfers and receipts (D7, R9), Arc contracts from recent log chunks (newest 200
senders), merged PRs (never into a repo the person or one of their GitHub orgs owns; final review
I2). One `defaultReaderDeps` per run shares the GitHub budget: it stops at `GH_RATE_FLOOR` = 1000
core requests left or after `GH_RUN_CAP` = 1,500 GitHub calls in the run, whichever comes first
(final review I5: a backfill never spends the hour live `find` shares); a budget stop or the
deadline writes no reading, so the source stays due.

How readings count (`builder-score.ts buildInputs`, final review): a package's weekly downloads / 50
count as users, at most `package_users` (100 under `v1-launch`) per package (I6). Merged PRs count
once per target repo, `min(pr_target_users, log10(1 + target stars))` (2 under `v1-launch`), for the
top 30 targets, and all of a person's merged PRs are ONE source for the one-source hold (I2): 30 PRs
into one 1k-star repo give 2 users, below the token pitch score (the golden test in
`builder-score.test.ts`). A contributor's reading time is not when they contributed, so a person
first seen as a contributor counts as a user but adds no dated outcome: no recency and no "still
used" (I3).

Recorded limits (owner notes for v2.13): `first_tx_at` is never filled, so every wallet counts 50%
(strict and uniform, so percentiles are unaffected); money is native volume only (D6, R10:
`M = 0.01 x volume`, no USDC tips, no fee source until Stripe); an old verified repo can name a later
contract with its real deployer until the real owner verifies (the hold catches spikes); a GitHub
rename stops discovery for that person (use the GitHub user id in v2.13).

### The formula and the calibration (spec 4, R7, R8, R26) (replaced in v2.12.1: formula v1 is history only)

`score.ts computeScore` (formula `v1`) is absolute within a calibration: Users 45, Money 20, Staying
power 15, Recency 10 (90-day half-life), Shipping consistency 10 (only on projects with an outside
user; 0 with no outcome anywhere). Commits, deploys and token spend alone score 0. The bars are a
versioned calibration (`score-calibration.ts`), never constants in the formula: `v1-launch` is
users 500, money $5,000, 13 weeks, 60 days, package credit at most 100 users a package, merged-PR
credit at most 2 users a target repo. Raw inputs are stored unscaled in `parts`, so any score
can be recomputed under any calibration. **To add a calibration:** add an entry to `CALIBRATIONS`
with a new `id` and its `since` date, set `LIVE_CALIBRATION` to it, and re-tune
`TOKEN_PITCH_MIN_SCORE` (generous scores run higher). It is an owner decision, never automatic; the
profile then shows "Scoring got stricter on <date>. Rank unchanged." when the person's percentile
did not fall (neutral third person: the page is public).

Percentile (R7): each run, one SQL pass (`percentiles`) over every person's public score (the
latest unheld or released row), hidden included, into `builder_ranks`; shown as "Top N%", N =
max(1, ceil(100 - percentile)). A person is scored once per UTC day (R8), when every verified
source has a reading for today or the run starts at 22:00 UTC or later. Because the percentile is
the share with a lower score, a person alone in the ranking (or tied at the bottom) would read "Top
100%", so "Top N%" is shown only for N <= `TOP_SHOWN_MAX` = 50 on every surface (`score.ts
shownTop`: the profile, the card and its X text, the leaderboard, `score` and `find`); above it the
score alone, and no card offer (final review, T15 ruling; an owner calibration).

### Anti-farming (spec 5)

`anti-farming.ts` (pure, one rule per test): self-exclusion (own wallets, GitHub account, own org
members), one per account per project with a 10% per-wallet fee cap, spread (onchain users across 3
distinct days; a day over 50% of users counts 25%), fresh accounts (GitHub under 30 days, or a
wallet's first transaction within 7 days of its call, or unknown: 50%), rings (a partner person
counts once per project at 50%; a cluster of 5+ caps in-cluster credit at 5). Verification is strict
from day one; only the bars are generous. Recorded limits: the 3-day rule is a cliff and rings catch
mutual pairs only (proposed for a later calibration).

### The cron steps and their slice (spec 6) (v2.12.1: no `ranks` step; `score` is v2)

`cron.ts runCron` runs the builder score steps after every existing step, with the flag on and
`deps.builderScore` (`if (!opts.only || deps.builderScore)`): `builder-score.ts runScoreSteps` runs
`discover`, `read`, `score`, `ranks`, then `empty` (`profileEmpty`), each failing soft and none
started after the slice's end. `SCORE_SLICE` = 0.4: the four steps share at most 40% of what remains
of the run's deadline (`scoreSliceEnd`). No new schedule, free APIs only. The run's JSON gains
`builder_score` (each step's counts), and `needs_owner` lists every current hold
(`score-hold:<id>`) and X handle conflict.

### The review hold and `/admin/scores` (spec 5)

A score that rises 30+ points in a day, or where one source is over 80% of a score of 60+, is
stored `held` and sets `builder_profiles.held` (`score_held` event). A first (backfilled) score is
held only by the one-source rule (R26). The public page, board, card, `find` and `score` show the
last unheld score. The owner opens `/admin/scores?key=<scoresAdminKey>` (an HMAC of
`ADMIN_VETO_SECRET`, its own label; the link is printed by `pnpm campaign scores-link`); each held
day shows its parts beside the public score with a Release button (`POST /api/admin/scores` writes a
`score_releases` row), and a "Clear X handle" button for a conflict. A wrong key is a 404; the page
counts against the veto rate limit.

### The surfaces (spec 7) (replaced in v2.12.1)

- **`/b/<slug>`** (`app/b/[slug]/page.tsx`, ISR 600 s; pure `ProfileView.tsx`, data
  `profile-data.ts profileData`, cached read `profile-load.ts` tagged `PROFILE_TAG`): score ring
  (orange-to-purple, `ek-score-orange` #FF7A1A and `ek-score-purple` #9B6BFF, R17), "Top N% of
  builders", the 7-day change, the three strongest parts in words, one card per project with its
  verified numbers and sources, one "verified from" line (the separate sources panel was dropped,
  Task 10 ruling), a 90-day sparkline. The name is X, else the GitHub login, else "Builder", never a
  wallet. A repo is named only while its latest reading says public. Empty: the neutral "No verified
  outcomes yet." Hidden, no profile, or never shown the consent line (`consent_shown_at` unset,
  `profiles.ts resolveSlug`; final review I4): 404, and the card and share route follow the same
  read. Mixed case and old slugs 308 (`permanentRedirect`, R15).
  Hide, show and an X change expire the cache at once (`profile-cache.ts profileChanged`).
- **The card** (`app/b/[slug]/card.png/route.tsx`, R16; `share.ts cardModel`): next/og 1200x630,
  `CARD_CACHE` = `public, max-age=0, s-maxage=60, must-revalidate`, checks the live row (a hidden
  card is a no-store 404). Outcome text 44px, footer 30px; no name line for the plain "Builder"
  fallback; no "Top N%" line above 50%. **The offer** (`share.ts offerCard`): once per person, only
  with a public score above 0 in the top 50%, never in a reply that already asks (R14). Only there is
  X asked, once (`x_asked_at`; final review M4); a handle is shown only when it equals the
  `twitter_username` on the person's proven GitHub profile (R5, D3 open).
  `/b/<slug>/share` records `card_shared` and 302s to the X intent built from the public profile.
  EarnKit never posts.
- **`/leaderboard`** (`app/leaderboard/`, ISR 600 s, pure `LeaderboardView.tsx`): rank, name, score,
  Top N% (N <= 50), top outcome; filters `chain`, `program`, `window` (`all`, `week`), 50 a page, at
  most `MAX_BOARD_PAGE` = 200 pages (past it, page 1); a `program=` value is checked against one
  cached id list (`leaderboard-load.ts cachedProgramIds`) before the board's cached read, so crafted
  URLs never make cache entries. Hidden people and people never shown the consent line are not listed
  (both still count in percentiles); held people show their last unheld score. Only scored people are
  listed (owner question: list installed-but-unscored profiles too?).
- **`score`** (the 5th tool, registered only with the flag on; `score-tool.ts scoreReply`): score,
  top N%, the change since they last asked (7 days with the event log off), what moved it, one next
  action (`nextAction`: the step with the most expected points; "no outside users" only when the
  users part is 0), and a program line naming its prize when one fits (never an investment program,
  never one the agent can't complete); `proof_line` carries the earnkit.txt lines to add.
  `score_viewed` at most once a minute. A person whose first call is `score` gets the consent line
  there, once (`consentOnce`, before the card offer; final review I4).
- **`find`'s line 2** (R13, R14): line 1 stays the v2.10/v2.11 lead; line 2 is `You: score 41, top
  22%. earnkit.com/b/<slug>`, or, empty, the fill step (`FILL_LINES`, said not asked when line 1
  asks). The first find ends with the consent line instead (spec 8), shown once
  (`consent_shown_at`, marked at delivery).
- **The token pitch gate** (R22, D4; **replaced in v2.12.1 T10** by the spec 3b coin moments,
  `coin-moments.ts coinPitchAllowed` through `tools.ts tokenPitch` at every pitch and launch path:
  with the flag on, a program entry's confirm never pitches a token; the build path's entry pitches
  it once at its built_live moment ("It's live. Want to launch a coin for it?"); a project with
  people gets "Want to launch a coin for <app>? You'd get 40% of its trading fees." at the countable,
  first-5 and has-people moments, answered by `tell coin` (or move_up kind coin), which makes an
  `earnkit-coin` entry that confirm by project_id launches; at most once per project, never after
  two declines, never shared or held; `scripts/v2121-metric.mts` counts offers shown, accepted and
  launched per week). v2.12 text: with the flag on, the token is offered at confirm only when the
  person's live, unheld public score is at least `TOKEN_PITCH_MIN_SCORE` = 20 (`confirm.ts`;
  `builder-score.ts pitchAllowed`), including the v2.11 build path and the `project_id` launch path
  (fail strict). Below it: `Ready to submit?`, no token notes, and no builder bonus line (it is funded
  by a token): not in `find` (`FirstMessage.noBonus`), not in a program's guide (`tools.ts
  withoutBonusLine`), not after confirm unless the entry's token is live (final review). Shared
  clients, held and profile-less people never see it. EarnKit campaign entries are exempt (owner question). The build kit's
  earnkit.txt `token:` line stays: it is v2.11's repo-ownership proof, not a pitch.
- **Odds** (`match.ts traction` via `builder-score.ts verifiedProject`): the public score's top
  project's verified users and money for that repo, never a held score; no score is v2.10 traction.
- **`agent_completable`** (R21, D2): `programs:sync` derives it (`program-file.ts
  agentCompletableOf`: only a go-to-market plan or a full-time team blocks; today only Colosseum
  World's Fair), and with the flag on `find` and the score program line drop those programs.

### Consent and terms (spec 8) (replaced in v2.12.1: no consent line; new terms text)

The first find's last line: "Your public work gets a public score at earnkit.com/b/<slug>. Say hide
anytime." `tell` takes `profile: 'hide' | 'show'` (`profile_hidden`, `profile_shown`), `x_handle`
and `card: 'yes' | 'skip'` (listed only with the flag on). `/terms#builder-profiles`
(`app/terms/sections/ProfilesSection.tsx`, words in `policy.ts PROFILES_POINTS`, in the terms nav
after "What EarnKit records") says what is read (public sources only, plus what the person links),
that profiles and the leaderboard are public, that only verified use counts, that without a
confirmed X handle the public name may be the GitHub login and the address may use the login or a
short wallet form, that the agent may propose local repos and live links for checking, how to hide (say hide
to the agent) and that hidden people still count in ranks, that EarnKit never posts and shows only
the X handle their GitHub lists, that the data may transfer to a successor in a merger or
acquisition, and how to ask for removal. **It needs the owner's lawyer review before go-live.**

### The metric (spec 3): shown, never a target

`scripts/v212-metric.mts [--as-of <ISO>] [--days 14]` (owner-run, one READ ONLY transaction) prints,
per UTC day of first find, `<day>: N new, E empty (P%)`. Empty = a `profile_empty` event, written
once per person by the cron 10+ minutes after the first find when nothing verified scored, with
`detail.missing` (`no_github`, `nothing_live`, `ownership_unproven`, `read_failed`). The spec expects
under 10%; the script sets no goal. It needs `EARNKIT_EVENT_LOG=on`.

### The journey (`v212-journey.test.ts`) (v2.12.1: updated; the flag-on journey is `v2121-journey.test.ts`)

Its own throwaway database, every real program file, the real flag-on code paths (tools, cron,
discovery, readers' parsing, anti-farming, formula, percentiles, event log, `profileData` and
`ProfileView`). Fakes only for the outside world: GitHub, the site probe, Blockscout and Arc
(`fakeWorld()`: `lee/tipjar` with 40 stargazers from 900-day-old accounts over 12 days and a
`CNAME` of `tip.example.com` that answers 200), and the proven login (the proof line the agent
pushed). 15.2 fresh install, `find` with `local_git`, one cron run, `/b/lee` renders "Top N% of
builders", `score` names a next action, the five events; 15.3 a same-day rerun writes nothing; 15.4
an install with nothing verifiable gets one `profile_empty` (`no_github`) and `find` leads line 2
with the fill step; 15.5 the metric script as a child process; 15.6 no network.

### Archive and simplify (spec 9, R18, R19)

The app never imports from `archive/`. Each feature folder holds `MANIFEST.txt`, `files/<original
path>`, `README.md` (what it did, the flag, restore) and `TABLES.md`;
`scripts/archive-restore.mts <feature>` moves the files back with `git mv`, and live seams also
check the flag, so restored files stay dormant until it is on. Archived tables get `COMMENT ON TABLE
... IS 'archived v2.12'`, receive no writes and are never dropped.

| Feature | Folder | Flag (default off) | State on this branch |
|---|---|---|---|
| Sponsor campaigns: the `sponsor_campaign` tool, `/fund`, `/award`, `POST /api/sponsor/<ref>/check`, `sponsor.ts`, `sponsor-text.ts`, wallet pages, `sponsor-e2e` | `archive/sponsor-campaigns/` | `EARNKIT_SPONSOR_CAMPAIGNS` | Moved. Read-side modules stay live (R19: `sponsor-rules.ts`, `sponsor-identity.ts`, `sponsor-verify.ts`, `escrow.ts`); `withScoringLock` moved to `scoring-lock.ts`. Flag off: sponsor programs are not listed, nothing writes `sponsor_campaigns` or `sponsor_verifications`, `pnpm campaign refund` and `fallback` refuse (`sponsor-cli.ts`). `contracts/` untouched |
| Starter registry beyond arc-tipjar (`build_help`, program-file `starters`) | `archive/starters/` | `EARNKIT_STARTER_REGISTRY` | Moved (`programs-starters.ts`). arc-tipjar stays the one starter. `find` with a `program_id` has no `build_help`, flag on or off |
| v2.9 tool aliases | `archive/tool-aliases/` | `EARNKIT_TOOL_ALIASES` | Staged: `aliasesOn(now, env)` keeps aliases working until 2026-11-09 (R23); the file move is a scripted step on or after that date. `yesNo` moved to `yes-no.ts` |
| Program boards: `/campaigns/<slug>` | `archive/program-leaderboards/` | `EARNKIT_PROGRAM_LEADERBOARDS` | Staged: with the score flag on, `/campaigns/<slug>` and every `/bonus/<round>` whose round is open or empty 307 to `/leaderboard?program=<id>` (`bonus-rounds.ts boardRedirect`, `boardStays`: frozen, review, paying and paid stay); the files move at go-live (D5). The bonus-round traction scorer, ledger and payouts stay live (R20, D1) |

### Env vars

| Var | Turns on | Notes |
|---|---|---|
| `EARNKIT_BUILDER_SCORE=on` | Profiles, discovery, the cron steps, `/b/*`, `/leaderboard`, `score`, find's line 2, the pitch gate, `agent_completable` filtering, board redirects | Only after the lawyer review. Needs `EARNKIT_EVENT_LOG=on`, `EARNKIT_AUTH_SECRET` (profile codes) and `GITHUB_TOKEN` (the readers' GitHub budget) |
| `EARNKIT_SPONSOR_CAMPAIGNS=on` | Sponsor programs listed and written again | Only after `archive-restore.mts sponsor-campaigns` |
| `EARNKIT_STARTER_REGISTRY=on` | The `starters` table written and read | Only after restore |
| `EARNKIT_TOOL_ALIASES=on` | v2.9 tool names after 2026-11-09 | Before that date they work anyway |
| `EARNKIT_PROGRAM_LEADERBOARDS=on` | Keeps `/campaigns/<slug>` and `/bonus/<round>` as pages with the score on | |
| `ADMIN_VETO_SECRET` | `/admin/scores` (its own key) | Already set |

### Owner go-live steps (replaced by v2.12.1's below)

In this order, after merge (none is done on this branch):

1. **Lawyer review of `/terms#builder-profiles`** (`policy.ts PROFILES_POINTS`). Ship with
   `EARNKIT_BUILDER_SCORE` unset: `predeploy` runs the additive migration and `programs:sync` (which
   writes `agent_completable`). With the flag unset everything is v2.11 except what the archives
   removed (the sponsor tool and pages, `build_help`) and the safety line's wording ("use only
   EarnKit's own build steps"). `/terms#builder-profiles` stays hidden until step 3.
2. **Design sign-off** on the profile, the card and the leaderboard, including the accents
   (#FF7A1A, #9B6BFF; spec open decision 3). The screenshots in the SDD folder
   (`.superpowers/sdd/v2.12-builder-score-plan/task-10-shots/` and others) are scratch: re-shoot them
   against the merged build (flag on, a seeded profile) before signing off.
3. **Turn it on.** Confirm `EARNKIT_EVENT_LOG=on`, `EARNKIT_AUTH_SECRET` and `GITHUB_TOKEN` are
   set, then set `EARNKIT_BUILDER_SCORE=on`. Refresh the claude.ai connector (the tool list gains
   `score`, find and tell gain fields).
4. **The board redirects are temporary (307).** `/campaigns/<slug>` and `/bonus/<round>` for an open
   or empty round move to `/leaderboard?program=<id>`; a frozen, in-review, paying or paid round stays
   on `/bonus/<round>` (`bonus-rounds.ts boardStays`; win alerts link there). Being 307s, turning
   `EARNKIT_BUILDER_SCORE` off again restores the boards at once. Switch to permanent redirects only
   when the flag is on for good (step 8). Also know: a profile is public only after its consent line
   was shown (in `find` or `score`), and "Top N%" shows only for N <= 50 (`TOP_SHOWN_MAX`, an owner
   calibration). Package credit (100 users) and merged-PR credit (2 users a target) are `v1-launch`
   values in `score-calibration.ts`, owner-tunable.
5. **Watch** the first cron runs' `builder_score` JSON and `/admin/scores` (`pnpm campaign
   scores-link`), and run `v212-metric.mts` daily for the empty rate.
6. **After a week of real scores:** tune `TOKEN_PITCH_MIN_SCORE` (20 under `v1-launch`) from the real
   distribution, and re-tune it at every calibration change.
7. **When to move off `v1-launch`** (spec open decision 4): once enough people score that the top
   bars are crowded (many at full users or money points) or the median sits well above the middle,
   add a stricter calibration (for example users 5,000, money $50,000, 26 weeks, 90 days) as a new
   version; never automatic.
8. **The archive moves.** Once the flag is on for good: the `/campaigns/<slug>` file move in
   `archive/program-leaderboards/README.md` (D5). On or after 2026-11-09: the tool-alias move in
   `archive/tool-aliases/README.md`.

### Owner questions recorded during the build

D3 (accept typed X handles, shown unverified?) and a stronger X proof (OAuth) in v2.13; the
owner's "Clear X handle" is not sticky while GitHub still lists the handle (v2.12; in v2.12.1 the
owner's clear of a claimed page sticks, `x_owner_clears`); campaign entries are
exempt from the pitch gate; a minimum percentile before the card is offered (a score of 7 is
offered at "top 69%"; answered in the final review: "Top N%" and the offer only for N <= 50, owner
may move the cutoff); the card font; listing installed-but-unscored profiles on `/leaderboard`. The
bonus line below the pitch score is fixed (final review: no bonus line there).

## v2.12.1 Where you stand (Tasks 1 to 13)

Spec: `docs/design-docs-and-implementation-plans/v2.12.1-where-you-stand.md`; plan:
`v2.12.1-where-you-stand-plan.md` (plan rulings S1 to S16); the build ledger with every controller
ruling is `.superpowers/sdd/v2.12.1-where-you-stand-plan/progress.md` (scratch, not shipped). It
replaces v2.12's onboarding, replies, scoring, profile, card and leaderboard. Everything still sits
behind `EARNKIT_BUILDER_SCORE=on`: **flag off is production (v2.11 replies, no profile writes;
`/b/*`, `/<handle>`, `/claim/*`, `/x/callback` and `/leaderboard` are 404; `score` is not listed;
`/terms` has no builder-profiles section)**. Tools stay five (`find`, `prepare`, `confirm`, `tell`,
`score`), each description under 800 characters.

### The flow, as the builder sees it (`v2121-journey.test.ts`)

1. **Connect.** `find` takes an optional `identity` input (MCP schema only with the flag on;
   `identity-input.ts identityInput`, lenient, never throws): GitHub login, projects (name, a few
   words, repo, live link, package, contracts as `base|arc|monad|tempo:0x..`), wallets. The tool
   description tells the agent to fill it and never to ask. `local_git` is still accepted and mapped
   in. `noteIdentity` merges it into the stored report (`mergeIdentity`, final fix wave: the same
   project by any shared link keeps the words a new report left out; projects a second agent or a
   login-only find did not mention stay, 25 at most; `builder_profiles.identity`, `reported_github`),
   proposes agent sources (at most 25 projects a person) and remembers wallets (never proof).
2. **The first reply** (`where-you-stand.ts whereYouStand`, three parts under `HEADS`: "Where you
   stand", "Ways to earn right now", "How to move up"), built by `tools.ts standFind` after the
   person's own refresh (`stand-view.ts startRefresh`, raced against `REFRESH_BUDGET_MS` = 8 s inside
   find's 10 s; a slow reader keeps going in the background). Lead with the work ("You've shipped 3
   apps with AI: a tip jar, ..."; S1: every live thing counts in the sentence, confirmed or not; the
   rank only from confirmed data). S2: rank first only when a project has people and the rank reads
   well. S15: apps named but none live read "You've made N apps with AI: ... None is live yet." and
   the step is go_live when EarnKit can host it. "Claim your page with X: earnkit.com/claim/<code>" is
   a link, not a question, and only with X sign-in set. At most 3 programs, each tied to a project;
   S16 and the T8 rulings: money in every reply (a program that fits, else a users-money line, else
   the easiest rolling program, else the fresh build pick, which becomes the step when there is no
   other). One yes per reply: a pending join's question or the outcome question takes the place of
   the step (the join question goes last); the card question only when nothing else asks. Once
   claimed: "Your page: earnkit.com/<handle>".
3. **One yes** (`tell move_up { kind, project_key, answer, live_url? }`; the server recomputes the
   step, never trusting the agent's kind; `make-countable.ts moveUpYes`/`moveUpNo`, `tools.ts
   goLiveYes`, `stand-view.ts confirmYes`). `chooseStep` order: count_past, confirm (claimed people:
   re-issue the wallet or GitHub link), tag_future, coin, payment, build; go_live when nothing is
   live; else send_link. A step is offered only when its yes can deliver (T9 ruling 4). A no keeps that
   step away 30 days (`standing_seen.declined`).
   - count_past: a proposed contract on Base or Arc is read once a day for its past callers (at most 5
     a refresh). Provable (EarnKit deployed it, or a wallet signed on the claim page created it):
     tracked now, "Done. 140 people who used tokens.fun now count. You're now #3 of 40." (the rank
     only when it reads well and the rescore is not held; held: "Your new rank shows after a quick
     review."). Not provable: "One tap shows it's yours: <wallet link>"; unclaimed: the claim link
     first.
   - tag_future: the attribution line for the agent (`attribution.ts attributionFor`: `[ek_<person>,
     earnkit]`, or `[<Base code>, earnkit]` on Base once `EARNKIT_BASE_AGENT_CODES=on`); "Added.
     People using it will count as they come in." Tags are read only on tracked contracts.
   - payment (S14 `paymentStepFits`: the app's own words fit and do not already say tips/pay): the
     arc-tipjar starter as an add-on, preferring a deploy that enters nothing; it never nudges toward
     a grant the builder didn't pick.
   - go_live: EarnKit hosting (R2) when the repo is shown theirs, else the sign-in or proof line;
     hosting off: the GitHub Pages steps, then a yes again with `live_url`.
   - Every app built through EarnKit gets the attribution line from the start (`fresh-build.ts
     buildKit(..., attribution)`, `ATTRIBUTION_RULE`).
4. **3b, the coin** (`coin-moments.ts`; replaced v2.12's score-20 gate, `pitchAllowed` deleted): the
   only places a coin is offered are the moments built_live (the build entry's confirm, "It's live.
   Want to launch a coin, $TIP (Tip Jar), for it? ... Your entry is ready either way."), countable
   (after a count or tag yes), first_five (the reply reporting a project's first 5 people) and
   has_people (a project with people and no coin, when no bigger step exists). The coin and a known
   wallet are named before the yes (v2.8.1 A2); with no wallet known the line asks only the yes and
   the yes's reply asks for the wallet (`COIN_WALLET_ASK`, final fix wave: never a yes and a wallet
   in one reply); at most once per project (`coin_moments`), never
   after two declines, never shared or held, only when the yes can launch (a confirmed repo or the
   build path) and token launches are on. `tell coin { project_key, answer, wallet? }` (or move_up
   kind coin) makes an entry in the internal closed program `earnkit-coin` (S7), which `confirm` by
   project_id launches through the unchanged token path; a different wallet re-shows the line and
   needs a fresh yes. Every pitch and launch path asks `tools.ts tokenPitch` -> `coinPitchAllowed`:
   a program entry's confirm never pitches a token. Coin entries are hidden from "Your entries",
   outcome questions, reminders and the digest.
5. **Messages only when something real happens** (`stand-view.ts takeNews`, `standingNews`):
   "Since you last checked: 12 new people used tokens.fun this week, and you moved up to #3. Want a
   card to share it?" The first look records `standing_seen` and says nothing; a first rank is never
   a "move up". Existing installs get one "Your EarnKit page is ready. Claim it with X: <link>"
   (`takePageReady`, once, only with a project). S12: a line ending in a link has no period.
6. **The card** (`share.ts cardYes`; `tell card: 'yes' | 'skip'`): a claimed page gets "Post it:
   https://earnkit.com/<handle>/share"; unclaimed gets the claim link first.

### Identity: X claim, pages, joins

Replaced in v2.14: see 'v2.14 One account'.

> **v2.14 Task 7:** the claim page, claim codes, proven-tie joins, pickups, login contests and group merges described
> here are gone (tables kept). The person is the X account; see the v2.14 sections at the end.

- **Sign in with X** (`x-oauth.ts`: OAuth 2.0 PKCE S256, scopes `users.read tweet.read`, one
  `GET /2/users/me` per sign-in, about $0.01; the token is never stored). `claim.ts`: the claim code
  is deterministic per person (S13, `HMAC(EARNKIT_AUTH_SECRET, 'claim:v1:<id>')`, 12 base32 chars;
  only its sha256 in `claim_codes`). `GET /claim/<code>` says what becomes public and how to hide
  ("hide my page") before one button, sets a `__Host-ekx-` cookie and csrf; `POST` (Origin, csrf,
  `xClaim` rate limit) stores a 15-minute state (`x_oauth_states`, bound to the code) and 303s to
  X; `GET /x/callback` checks the state with this browser's cookie before any X call. Without both
  `X_CLIENT_ID` and `X_CLIENT_SECRET` no reply shows a claim link and the page says sign-in is not
  open yet. X down: "Sign-in didn't finish. Open the link from your agent again." and the same link
  still works (Review Focus 5). The first X account to finish owns the page; a second is refused
  (Review Focus 1). The done page offers two optional upgrades: sign a message with a wallet
  (`wallet-proof.ts`, `/claim/wallet`, EIP-191, each signature once via `wallet_proof_uses`,
  30-minute token) and sign in with GitHub (purpose `claim`). Claim, done and wallet pages share the
  navy design (`brand-page.ts`, fonts inline as data:, the wallet page's own nonce CSP).
- **`bindX`**: writes `x_user_id`, `x_handle`, `x_name`, `x_avatar_url`, `claimed_at`; the slug becomes
  the lowercase handle and the old random slug goes to history; a stale holder of the handle (it moved
  to someone else) is cleared and no history row redirects to them (Review Focus 2); a rename keeps a
  90-day redirect (`profile_slug_history.handle_rename`); queues discovery (the X field match).
- **The owner's clear sticks** (final fix wave): "Clear X handle" on `/admin/scores` (`clearXHandle(id,
  'owner')`) on a claimed page records its X user id in `x_owner_clears`; `claimLink` gives no link,
  `codeTarget` refuses old codes (410) and `bindX` answers `owner_cleared` from any installation (no
  join offered; the page reads `CLAIM_TEXT.paused`), until the owner presses "Release" under "X
  handles you cleared" (`action=release_x`, `releaseXClear`). A merge moves the row to the root.
- **Pages**: `earnkit.com/<x-handle>` (`app/[handle]/`), case-insensitive with a 308 to the stored
  case; a handle equal to a site route (`reserved-routes.ts RESERVED_ROUTES`; a new top-level route
  fails `reserved-routes.test.ts` until added) is served at `/b/<handle>`, and every link and the card
  follow `pagePath` (Review Focus 4). `/b/<v2.12 slug>` (and its card and share link) 308 to the X page
  of a claimed person, else 404. Before the claim there is no public page.
- **Joins** (`identity.ts joinOnProvenTie`, `pending_joins`): installations join one person only on a
  proven tie: the same X user id, or the same proven GitHub login. Owner ruling (T5): a proven tie
  auto-joins only when no other group holds it; otherwise a pending join asks both groups' agents
  once (`askJoin`, the question last in the next reply; the joiner reads "Add this agent to your
  EarnKit page?") and only two yeses merge (`tell pickup`). Hidden and held are either side's; the
  older group keeps its page. The EarnKit deploy-wallet tie stays off (T5 ruling: the owner wallet on
  a deploy is agent-typed). An agent-reported login or wallet never merges anyone (Review Focus 3).
  S10: with the flag on, find never offers the v2.8.1 pickup.
- **Contested logins** (`login-contests.ts`): a GitHub login proven by two or more unlinked groups
  confirms nothing for any of them except the group whose claimed X equals the GitHub profile's X
  field, or the group the owner rules for on `/admin/scores` (`login_contest_rulings`). Dormancy does
  not matter (T6 ruling). **The owner's own split installs from the 2026-10-13 flag-on will see a
  join question or a contested login until both agents answer or the owner claims and rules.**

### Confirmed vs not yet confirmed (`confirmed.ts CONFIRMED_PROOFS`)

Confirmed: `github_signin`, `proof_line`, `repo_owner`, `repo_link`, `deployer`, `deploy_wallet`,
`wallet_signed`, `earnkit_hosted`, `x_match` (GitHub's public X field equals the claimed X; T7,
`discovery.ts provenLogin`; withdrawn, the login is released). Everything else the agent reported is
shown, marked "Not yet confirmed" on the page (one quiet line when none is confirmed), and adds 0.
`earnkit_txt` confirms a site source only (owner batch 2026-10-23, reversing S9 for sites: `confirmed.ts
SITE_PROOFS`, `isConfirmedSource`, `CONFIRMED_SITE_PROOFS`): a site proven by its own `earnkit.txt` counts toward
Shipping (its first day up is a shipping week; on a project with a confirmed repo it is a live ship) and its origin
may be linked in an update (`updates.ts ownLinks`). It is checked again on every daily read (`sources.ts
recheckSite`, before `proveSite`) while the site is up: anything but 200 text/plain with the code is a miss (any other
status, a redirect, an oversized body, another type), once a day (`proof_checked_day`); only transport failures
(timeout, DNS, a reset) and the run's deadline are exempt, and `SITE_PROOF_EXEMPT_MAX` (7) exempt days in a row count as
a miss (`proof_exempt_days`, kept on that miss so every exempt day past the cap is a miss; a TLS or certificate failure is
transport); one success resets both; the third miss in a row puts the row back to proposed (proof
null, reject_reason `SITE_PROOF_LOST`), so it stops counting, being linked and showing, but it keeps being read
(`dueSources`, `writeReading`) for `SITE_PROOF_LOST_READ_DAYS` (60) after `proof_lost_at`, then no longer, and
`proveSite` verifies it again as earnkit_txt once the code is back; `proposeSource` lets the agent propose it again (only
a lost site row is reset). A lost site is never the project's link, live site or ship (`person-score.ts`). A site proven
only by earnkit.txt counts only under a project with a confirmed repo (`person-score.ts`), so a site-only project is
never confirmed and never picked by `pickMainProject`.
`dns_txt` confirms nothing: nothing verifies or re-checks a DNS record. Neither confirms a repo, package or contract;
an agent-typed site (proposed, no proof) still adds 0.

**v2.12.2, a reported login's own repos** (`discovery.ts discoverOne`; design note
`v2.12.2-reported-github-work.md`): with no proven login but an `identity.github_login` the agent
reported (`reported_github`) that no other profile has proven, one GitHub person query lists that
login's newest `REPORTED_REPOS_MAX` (25) own public repos (no forks or templates) and proposes them,
plus their homepages (at most `DISCOVER_CAPS.sites`), as `server` sources. Never verified, never a
merge, never scored; a later proven login verifies the same rows (Clue 2). Only within the GitHub
budget and before the deadline. The first reply then says "You've made N projects on GitHub: A, B
and C. None is live yet." (`where-you-stand.ts`, names as GitHub writes them via `PersonRepo.name`),
and a code-only project gets the `go_live` yes (GitHub Pages) only with a web signal (`stand-view.ts`
`web`: a site source, or `PersonRepo.web` from its homepage or a web `primaryLanguage`); otherwise
the link ask. find passes the reported login to the v2.11 matcher (flag on, own installation, no
github_user, repos or remembered user); that matching is quiet (`tools.ts quiet`): a failure is never
shown and no repos found reads as none given. The on-demand refresh (8 s) skips the proof-line check
when less than `PROOF_LINE_MIN_MS` remains (`proofLineCheck(..., { skipShort, onSkip })`, set by
`discoverPerson`) instead of aborting discovery, and then leaves the queue row open with reason
`proof_line` so the cron's `discover` runs the check (the refresh does not rerun discovery for that
row). The proof-line and remote checks read agent-proposed repos first
(`ORDER BY (proposed_by = 'agent') DESC, id`), so the 25 server rows never crowd them out. Flag off:
unchanged.

### The score v2 and the rank (`score-v2.ts`, `rank.ts`, `person-score.ts`)

> Superseded in part by "Scoring and clarity (Task 1)" at the end of this guide: one Shipping score, the
> ranked rule R4, the rank line and the score line. The four-part formula below is history.

- `computeScoreV2` (formula `v2`, pure, until scoring and clarity): Shipped 20 (front-loaded, keeps at least half forever),
  Used 40 (distinct people; callers, tagged calls, coin buys from a trade venue, package downloads
  / 50 capped at 100 a package, stars and forks by others capped at 5), Earned 20 (1% of counted
  caller value, coin creator fees, prizes won), Consistency 20 (weeks with a ship or use). Used and
  Consistency fade with a 90-day half-life. Calibration `v2-launch` (`score-calibration.ts
  V2_CALIBRATIONS`: users 500, $5,000, 13 weeks); tune it there (an owner decision, never automatic).
  Ranked = at least one confirmed ship, **and** the person's ring known: computed by the cron, or
  (final fix wave) no other EarnKit person's account touched their work, so a new person ranks on
  the first refresh (the first message after a confirmed ship). Touched by another EarnKit person
  and never computed: those touches weigh 0.5 and the person waits for the hourly cron (T4 ruling:
  fail strict on ring partners).
- `personInputsV2` reads confirmed sources only (the newest good observation: `source_live` when
  newer than the daily `source_readings`), all v2.12 anti-farming rules (`countProject`), and builds
  `builder_projects` for every project (confirmed or not) with the 25-project cap (`TRACKED_MAX`,
  most recently active first; the rest "Not tracked right now").
- `rescorePerson` writes `builder_live` (mutable, S5); a rescore the hold stops (+30 in a day against
  the newest public history row, or one source over 80% at 60+) waits in `builder_live.pending`, and
  the owner's release on `/admin/scores` publishes exactly the reviewed score (`score_releases.score`,
  `scores`). The cron (`scorePeopleV2`) writes one `builder_scores` row a day (`formula = 'v2'`) as
  history.
- **One ranked population** (T11 ruling, `listedRanked`): ranked, claimed with a handle, not hidden,
  not held. Replies, page, card and leaderboard all rank against it (a ranked person outside it is
  counted in for their own reply), so a person's number never differs between surfaces.
- **Rank words** (`rankWords`): "#N of M builders on EarnKit" while fewer than 50 are listed, and
  only in the top half (T2 ruling: N <= ceil(M/2)); then "top N% of people building with AI" only
  when N <= 50; otherwise no rank line.
- **Fresh within minutes** (`refreshPerson`): `find` and `score` re-read that person's sources at
  most once every 10 minutes (`REFRESH_MS`, claimed atomically), discovery inside a refresh only
  when queued or once a day; never a shared client; never throws. A page view goes through
  `pageViewRefresh` (final fix wave): only when the last read is over `PAGE_REFRESH_MS` (a day) old
  or was reset (claim, merge), and only under `LIMITS.pageRefreshIp` (20 an hour per IP) then
  `LIMITS.pageRefresh` (200 an hour for all views), so crawlers never spend the cron's daily reads.

### Scale and reads (spec "Scale")

GitHub: one GraphQL query per person (`person-github.ts PERSON_GITHUB_QUERY`, newest 100 owned
repos) plus aliased by-name calls (25 a call) for tracked repos outside it and org repos (with one
REST contributors call each). npm downloads in bulk batches of 128 (`readNpmBulk`; scoped names
keep `readNpm`). Blockscout once per contract per day (since its last daily read). One HEAD per
site per day. A source that errors writes a failed reading once that day and is not retried; the
page keeps the last good number. The failed reading's `error` is the error's class and message
(`source-readers.ts readError`; a refused GraphQL answer names GitHub's type, path and message,
`graphqlErrors`), and the read logs it as `[read] failed <source ids> <error>`. Hotfix 2026-10-19:
repo queries never name a field GitHub refuses to EarnKit's fine-grained token or the App's
installation token (`stargazers`, `forks`): one FORBIDDEN field fails the whole answer
(`graphqlUsable`), so every repo read failed (`repo-read-forbidden.test.ts`).
Hotfix 2026-10-19 (busy repos): the by-name query reads the newest 100 commits plus the 52 weeks' `totalCount`; when
that is more, one more call (`person-github.ts weeklyCommitsQuery`, one `history(since, until) { totalCount }` alias a
week, cost 1) gives every week's count. Repo readings carry `reader` (`sources.ts REPO_READER` = 2): an older reading
is no rule 3 baseline, so the next read re-takes it once under rule 4 (push-backed weeks only). Ship-log weeks carry
the same `reader`; the backfill writes only from a current reading and redoes a week written from an older one once
(`busy-repo-weeks.test.ts`, `backfill.test.ts`). A public rank (`bench-rank.ts rankLines`, `page-data.ts personFacts`)
shows only inside the leaderboard pool (`standingOf().listed`); a rescore that moves the pool and a written ship-log
week call `profile-cache.ts poolChanged`, which expires the landing, feed and leaderboard caches (all tagged
`PROFILE_TAG`) and paths. Every read is counted per provider (`read-usage.ts countingDeps`,
`read_usage` table) against `FREE_LIMITS`, printed by the metric script. No new schedule: the cron
slice is `SCORE_SLICE` = 0.4 of the hourly run.

### The page, the card, the board (`page-data.ts`, `app/[handle]/`, `app/leaderboard/`)

Every public sentence lives in `page-data.ts` (one place for the copy review). The page:
avatar, X name and @handle, one h1 ("Lee has shipped 3 apps with AI."), the score ring
(`app/[handle]/ScoreRing.tsx`, orange to purple, "41 of 100" in words) only beside a rank that reads
well, the people line, then project cards (name, a few words, link, people and money when measured
and not held, programs entered and won; "Not yet confirmed" and "Not tracked right now" quietly;
a repo's name only while its newest reading says public and is under a week old), skeletons while
`refreshPerson` runs (Suspense), and the sources line. The card (`card-response.tsx`, next/og
1200x630, Funnel Display from `assets/fonts`, the X picture with a 3 s timeout) shows the headline of
the latest moment (shipped, people, rank); the share link records `card_shared` and 302s to the X
intent. `/leaderboard`: one gapless list (rank, avatar, @handle, best project), at most 100 rows,
every query parameter ignored (S11: `boardRedirect` returns null, `/campaigns/<slug>` and
`/bonus/<round>` render as v2.11). The footer is unchanged (its all-caps headings and the "For
sponsors" link are production's; changing them is a separate owner call).

### The copy rule (`fixtures/banned-words.ts`, `copy-review.test.ts` 12.1 and 12.2)

Builder and public text never uses outcome, percentile, verified source, contract, wallet address,
builder code, repo(sitory), commit, onchain, a chain name, an all-caps label (USDC excepted), an em
dash or an emoji, unless the builder used the word first (their project names and program titles are
exempt). 12.1 checks every v2.12.1 builder and public string (the three-part replies, every step,
claim and wallet pages, the count and coin lines, the page, cards and board markup, the terms
points); 12.2 scans every human string in `lib/earnkit` and `app` for a v2.12 line ("Top N% of
builders", "Say hide anytime", an `earnkit.com/b/` link, "Builder score", "/100").

### Terms (`policy.ts PROFILES_POINTS`, `/terms#builder-profiles`, flag-gated)

Public only after the X claim; what the page shows (X name and picture, projects, people and money
when measured, programs, and the rank and score ring once something shipped is confirmed); EarnKit
reads only cheap public data (GitHub, live sites, package downloads, public transactions, EarnKit
itself) and never adds anything to a site; only confirmed data counts, the rest is shown marked;
another agent signing in as you joins only after you say yes; "hide my page": a hidden page is not
shown or listed and is in no one's rank (`listedRanked` excludes hidden people since T11; the v2.12
rule "hidden still counts" no longer holds); EarnKit never posts, reads X at each sign-in (a rename is
picked up then) and keeps the X user id, handle, name and picture; data may transfer in a merger or
acquisition; removal by email. **Needs the owner's lawyer review before the flag goes on.**

### What v2.12 code went (T12) and what stayed

Removed: `app/b/[slug]/ProfileView.tsx`, `profile-load.ts`, `profile-data.ts` (v2.12 page and board
readers; `money` moved to `page-data.ts`), `handle-page.ts` (T6 placeholder), `share.ts` card offer
(`offerCard`, `cardOffer`, `findOfferLine`, `xAsk`, `CARD_OFFER_NOTE`, `cardModel`, `intentUrl`,
`cardYesV212`), `score-tool.ts` v2.12 reply (`FILL_LINES`, `youLine`, `secondLine`, `nextAction`,
`scoreLines`, `movedLine`, `scoreReplyV212`), `tools.ts` find's second line (`findSecondLine`,
`scoreLineOf`, `SCORE_STEP_NOTE`), `profiles.ts` slug rules and X prefill (`setXHandle`,
`followName`, `baseSlug`, `walletSlug`, `nextFreeSlug`, `shownName`, `CONSENT_LINE`, `consentOnce`,
`PROFILE_URL`, `X_NOT_LISTED_NOTE`, `X_TAKEN_NOTE`, `X_CLAIMED_NOTE`, `X_SET_LINE`, `slugOwner`),
`builder-score.ts` v1 scorer (`scoreBuilders`, `percentiles`, `publicScore`, `emptyReasonOf`).
`/b/<slug>/card.png` and `/b/<slug>/share` are now thin wrappers over the `[handle]` handlers. The
slug is an internal key: it no longer follows a login or wallet (it becomes the handle at the claim).
`verifiedProject` (odds) now reads the person's confirmed `builder_projects` row. Kept: every table
(`builder_ranks` and `x_handle_conflicts` get no new writes; the conflicts reader still feeds
`/admin/scores` and `needs_owner` for v2.12 rows), `score.ts` formula v1 and `buildInputs` (history
and its tests), `tell`'s `x_handle` field (accepted and ignored: an agent that kept v2.12's schema
must not get a parse error).

### Env vars

| Var | Turns on | Notes |
|---|---|---|
| `EARNKIT_BUILDER_SCORE=on` | Everything above | Off = production. Needs `EARNKIT_EVENT_LOG=on`, `EARNKIT_AUTH_SECRET` (claim codes, person codes, upgrade tokens) and `GITHUB_TOKEN` (GraphQL needs a token) |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | Sign in with X (claim links in replies, the claim page's button) | Both or neither; callback `https://earnkit.com/x/callback` |
| `EARNKIT_BASE_AGENT_CODES=on` | A Base builder code per person through `POST https://api.base.dev/v1/agents/builder-codes` | Off until Base answers; off, Base apps get `ek_<person>` plus `earnkit` |
| `EARNKIT_BUILDER_CODE` | EarnKit's own code if it differs from `earnkit` | |
| R2 vars (`r2.ts`) | go_live through EarnKit hosting | Without them go_live uses the GitHub Pages fallback (the agent pushes) |
| `TOKENSFUN_DEPLOY_API_KEY` | Coin offers (they are made only when launches are on) | Already set in production |

### The metric (`scripts/v2121-metric.mts`, owner-run, READ ONLY)

Per ISO week: coin offers shown, accepted and launched; reads per day per provider against each
free limit; claimed pages; the leaderboard's real-builder count against the goal of 20 (shown, never
a target). `scripts/v2121-seed.mts` seeds a local `v2121_shots` database for screenshots only.

### The journey (`v2121-journey.test.ts`)

Its own throwaway database, every real program file, flag on, the event log on, X set, token
launches on; fakes only for GitHub, the site probe, Blockscout, tokens.fun's ticker check and X. A
fresh install's `find` with `identity` (three parts, one question, the claim link, no rank before
anything is confirmed); the claim through `claimGet`, `claimPost` and `xCallback` with a fake X; the
hourly cron (x_match, the ring); "Your page: earnkit.com/Lee_Builds"; a second agent claiming the
same X joins only after both say yes; a count_past yes ("Done. 12 people who used TipJar now count.
You're now #1 of 4.") with the countable coin as its one yes; the 10-minute refresh guard; the page
marking the two agent-only projects "Not yet confirmed"; the coin only at the countable moment; the
card's share link and route; the leaderboard row with the same rank; hide and show; no network.

### Owner go-live steps (v2.12.1)

In this order; none is done on this branch.

1. **Lawyer review** of `/terms#builder-profiles` (`policy.ts PROFILES_POINTS`).
2. **X developer app** at console.x.com: verified phone, a few dollars of credits, OAuth 2.0 as a
   confidential client, callback `https://earnkit.com/x/callback`, scopes `users.read tweet.read`;
   `X_CLIENT_ID` and `X_CLIENT_SECRET` in Railway. Until then every flow except the X round trip
   works and no reply shows a claim link.
3. **The `earnkit` builder code on base.dev** (`EARNKIT_BUILDER_CODE` if it differs) and the note to
   Base asking whether a code per builder through the agents API is fine; set
   `EARNKIT_BASE_AGENT_CODES=on` only after Base says yes.
4. **Hosting for go_live**: the R2 vars in Railway (else go_live uses the GitHub Pages fallback).
5. **Programs**: the owner adds more once this version is shown ready; until then the rolling
   programs already in EarnKit fill "Ways to earn right now".
6. **Design sign-off** on screenshots of the page, card, leaderboard, claim, done and wallet pages.
   The SDD folder's shots are scratch: re-shoot them against the merged build (`v2121-seed.mts`).
7. **Merge and deploy with the flag unset** (`predeploy`: `pnpm db:migrate`, `pnpm programs:sync`).
   Confirm `EARNKIT_EVENT_LOG=on`, `EARNKIT_AUTH_SECRET`, `GITHUB_TOKEN`.
8. **Turn the flag on** only after every T9 and T10 piece has landed (they have: the go_live, count
   and coin yes handlers), refresh the claude.ai connector (find gains `identity`, tell gains
   `move_up` and `coin`), and run the owner acceptance test (the spec's "Acceptance test
   (binding)" section): in the `earnkit-staging` Railway project with the flag on there, if that
   project is set up; otherwise on production with `EARNKIT_BUILDER_SCORE=on` only for the test
   window, turning it off again (step 9) the moment any check fails, and leaving it on only once
   every check passes. The test, step by step, is
   `docs/design-docs-and-implementation-plans/v2.12.1-acceptance-runbook.md`.
9. **Turning the flag off** (after a failed check, or later): in Railway, unset
   `EARNKIT_BUILDER_SCORE` on the frontend service and redeploy. Every v2.12.1 surface 404s again,
   replies are v2.11 and nothing is written. Only the permanent (308) page redirects can stick in
   browsers that followed them: `app/b/[slug]/page.tsx` (`/b/<v2.12 slug>` to `/<handle>`) and
   `app/[handle]/handle-view.tsx` (a handle's case, a 90-day rename); after the flag is off they land
   on a 404. The `/b/` and `/<handle>` card and share routes answer `Cache-Control: no-store` on
   every 404 and redirect, so they never stick. v2.12's temporary (307) board redirects are gone
   (plan S11). State that waits, untouched, for the flag to come back on: claimed pages
   (`builder_profiles` X columns, `claim_codes`), proven wallets (`person_wallets`), pending joins
   (`pending_joins`), contested-login rulings, live scores and projects (`builder_live`,
   `builder_projects`), coin moments (`coin_moments`) and coin entries (`projects` in the
   `earnkit-coin` program). With the flag off a coin entry is never confirmed or launched
   (`tools.ts tokenPitch`, `launch_token`; coin-moments.test.ts "T12 fix 1").
10. **Tune the calibration** (`v2-launch`) from the real distribution after real scores arrive.
11. **The owner's own split installs** (from the 2026-10-13 flag-on) will see a join question or a
    contested login until both agents answer, or the owner claims and rules on `/admin/scores`.
12. **Separate owner calls**: the footer's "For sponsors" link and its all-caps column headings are
    production's and were left unchanged for flag-off parity.

## v2.13 The Bench (Tasks 1 to 16)

Spec: `docs/design-docs-and-implementation-plans/v2.13-the-bench.md`. Owner test, step by step:
`docs/design-docs-and-implementation-plans/v2.13-acceptance-runbook.md`. One switch, `EARNKIT_BENCH=on`
(on top of `EARNKIT_BUILDER_SCORE=on`; `builder-score-flag.ts benchEnabled`). Off, every surface is
v2.12.2. The thesis: connect builders to capital. One builder, one project, a weekly ship log written
by the builder's own agent, public filters for the capital side, and an optional raise.

### The flow, as the builder sees it

- **2a, a project.** `find` takes `identity.project` (one; an older agent's `projects[]` keeps its first
  entry). The reply (`bench-reply.ts`, `bench-find.ts benchFind`) has three parts: "Where you stand",
  "Ways to get funded", "How to move up". v2.13.1 O1 (owner ruling): the agent pushes a temporary
  proof branch `earnkit-<code>` (`proof-branch.ts`; no file, no commit; the builder reads one line),
  checked on find and score (once a minute per code) and the cron; a pass needs the pusher to be the
  owner of a User's repo (any pusher for an org's), is exclusive (the first holder keeps a repo),
  verifies the repo (`proof_branch`), records the login and rescores at once, and the next reply tells
  the agent to delete the branch. One code a day per person; a branch that never shows in the hour gets
  "I couldn't show <project> is yours..." (no loop). Under the Bench the token gate takes a proof branch,
  never an earnkit.txt line (`token-gate.ts branchProof`, `proof-branch.ts coinBranchProof`): a proof
  under 30 days whose repo still reads the same numeric id, owner and not-a-fork, else a fresh branch. The v2.13 proof line and sign-in
  link (`main-project.ts proofFor`) now run only with the flag off. The server
  writes the first ship log entry "Started tracking <name>." (`week-facts.ts startedLine`).
- **2b, no project.** The reply leads with ideas the builder can earn from (`ideasLine`; v2.13.1 O2: never a
  program that needs a live product or a repo) and the one yes builds a starter that is the project (v2.11
  flow). v2.13.1 O2 (B1): with no program to build for, the starter build with no program
  (`fresh-build.ts BENCH_BUILD_ID`, `benchStarter`; "Want me to build a tip jar and put it online? You'll be on
  the Bench today."): the yes builds, deploys, hosts and sets the one project, entering nothing
  (`tools.ts benchBuildLive`). With nothing to build: "Tell me what you'd like to build...". While a build is
  in progress (`installations.build`, under 24 h, no `done_at`) the reply is only "Building <name>. I'll be
  back with the live link." (B4).
- **v2.13.1 O2 reply rules.** The claim link on every reply while unclaimed (B2); once claimed, "Your page:
  https://earnkit.com/<handle>" after the stand line; the one project can change until Bench-confirmed (B6);
  the open-all-year program only when it fits the project's chain (or any chain; a live product only when
  live); a project whose proof branch is being checked is asked the updates yes; build_offer has no note
  under the flag; the server instructions have a Bench branch (`mcp.ts BENCH_INSTRUCTION_LINES`).
  Fix round 1: the coin gate's shortcut takes only control proofs of the Bench-confirmed main project
  (proof_line, github_signin; proof_branch keeps its 30 days), never a repo another person holds, after one
  launch-time repo read (`proof-branch.ts controlProvenMain`); a project switch closes the old key's code
  (`proof_branches.closed_at`, the agent told once in `remove_branch`) and codes are capped at 5 a person a
  rolling day; every reply ends on one question (`chooseAsk`: the suggestion, a different project for
  failed/taken, the week's update or grants that fit, each with a yes in `benchMoveUp`); under the Bench a
  starter build is proven by its own proof branch, never an earnkit.txt line (`fresh-build.ts benchKit`,
  `token-gate.ts proveRepoByBranch`, `deploy.ts` via `branchProvenOwner`), so it is on the Bench the same
  day; `programs:check` refuses the reserved id `earnkit-bench`.
- **v2.13.1 O5 (second first-run audit).** The reply never waits on GitHub: under the Bench, find and
  score wait for the refresh, matching the one project and the proof check at most `reply-wait.ts
  REPLY_WAIT_MS` (1.5 s; the reads run on and land for the next reply or the cron), so the first find
  answers in under 3 s on any repo. Before a proof code is issued one cheap `GET /repos/{key}`
  (`proof-branch.ts probeRepo`, 0.7 s cap): a 404 gives the plain "couldn't show" line at once, a User's
  repo under another login than the proven or reported one gives "<project> is under someone else's
  GitHub account." (both ask for a different project, no code), and a public read sets
  `builder_sources.public_at`, so pages name a public repo at once (never "Private project") until a newer
  reading says otherwise. `tell proof { pushed: false }` ends the code at once (`pushRefused`). Under the
  Bench the refresh reads a proposed repo only while it is the one project. A grants yes that finds
  nothing keeps grants quiet 7 days (`standing_seen.quiet`, `GRANTS_QUIET_MS`) and the next ask is "Want
  me to suggest one small thing to ship in <project> this week?". A chat-only agent with a project reads
  "Open <project> in your coding agent to put it on the Bench." and is never asked the weekly-posting yes.
  No-project ideas only from programs the offered starter can enter, with their own pitch. Copy: the
  wallet line has a way out, the building line drops the chain and says "your", update replies carry the
  full page link, the rank phrase only from 5 ranked (reversed in v2.13.4: shown from 1 ranked by the spec's rule), the claim page says what the Bench page is, no GitHub
  sign-in on the done page, "1 builder so far", "Money open now", an empty landing Bench says so.
- **The weekly update.** One yes (`builder_profiles.updates_on_at`), then the agent's weekly task
  (`schedule_weekly_update` replaces `schedule_daily_check`) calls `tell update { text }`.
- **Raise.** Optional, through a tokens.fun coin (`raising.ts`).
- **The last line is one question, the first that applies:** no project (build), not live (go live),
  updates not on (the yes), updates on but none this week and the agent cannot schedule (post one),
  a coin moment (raise), else the best-fitting program. `bench-find.ts BenchAskKind` holds the kinds;
  the yes goes through `benchMoveUp`.

### One project and its proof

Replaced in v2.14: see 'v2.14 One account'.

- `builder_profiles.main_project_key` (`main-project.ts mainProjectOf`, `setMainProject`). A later
  project from the same builder is identity only; it is not shown and not scored.
- **The lazy pick (B2, final fix I2).** `pickMainProject` (run by every rescore under the flag) fills
  an empty `main_project_key` only with a project the Bench counts as confirmed (`benchConfirmedSql`),
  most people first, then newest. With none, it stays null, so the project the agent names next
  (`identity.project`) is the one.
- **When the line can't confirm (final fix I3).** `proofLineLogin` names the owner only when
  `installations.github_user` is the repo owner and GitHub says the owner is a User. So `proofFor` gives
  an agent that can push the GitHub sign-in link (`createVerifyLink`, purpose `claim`,
  `SIGN_IN_OWNER_NOTE`) instead of the line when `github_user` is not the owner (a reported login that
  differs, or none), the owner is an Organization (`githubUser`, cached a day), or the line was first
  issued over `CONFIRMING_WINDOW_MS` ago without a confirm. A claim sign-in proves the login; discovery
  then verifies repos that login owns, or an org repo it is a top contributor of (`repoOwned`). With
  sign-in off (`GITHUB_OAUTH_*` unset) the line stays the way. The reply says "a minute or two" only
  inside that hour (`confirmingFast`); outside it, `confirmingSlowLine` ("I check again every day").
- **Confirmed gate (B2).** Under the flag, for an owner/repo key the Bench, the weekly rank gate and the
  ship log need a verified repo source with a confirmed proof on that ref (`benchConfirmedSql`,
  `confirmedSrc`); a coin or entry naming an unproven repo does not count. Keys that are not repos
  (hosted slug, site only) use `builder_projects.confirmed`. Fail strict. Final fix M1: the Bench
  rows (`bench-data.ts benchRows`), the chain pools (`bench-rank.ts benchPool`, `rankLines`) and the
  feed (`feed.ts feedRows`) read `benchConfirmedSql` in their joins, so a project that stops being
  confirmed leaves them at once, not at the next rescore of `builder_live.ranked`.
- **Fast confirming (B4).** For one hour after the proof line is issued (`CONFIRMING_WINDOW_MS`) a reply
  may refresh the check once a minute (`CONFIRMING_REFRESH_MS`). After that the daily discovery gate
  and the cron's proof check apply, so a builder who never confirms costs nothing.
- **Shared repo.** `project_updates` stays UNIQUE (project_key, week): the first confirmed owner keeps
  the ship log; a second owner is never overwritten and never "due".

### Reads

No person query on the reply path or the daily read under the flag (`readPersonGithub` is not called).
`source-readers.ts readGithubRepos` reads the one repo by name, 25 projects a call across builders,
once a day. `person-github.ts` keeps `commit_counts` per ISO week (from the dates already read), which
feeds `shipped_code`. The X photo refreshes at sign-in only; `Avatar` falls back to the initial.

### The weekly facts and the score

- `weeks.ts`: ISO weeks (`isoWeekOf`, `mondayOf`, `lastFinishedMonday`, `last52`, `streakOf`,
  `weeksShipping`).
- `week-facts.ts`: `weekFactsFor` (B5: `shipped_code`, `went_live`, `users_up`, `earned`, `won`, `streak`,
  `raising`), `factChips`, `upsertWeekFacts`. **`weeklyFactsStep`** runs from `runScoreSteps` as the
  `weekly` step: Mondays from 15:00 UTC (`WEEKLY_HOUR_UTC`), after the digest, `WEEKLY_PER_RUN` 200,
  only confirmed projects the builder holds. It writes the finished week's `project_updates` row (the
  facts; text stays null until the agent posts) and fills `builder_projects.chains`, `streak`,
  `weeks_shipping` (B6, `person-score.ts`). A package used outside the one project stays out of the
  score.
- **Dated events** in `builder_events` (`events.ts`): `shipped_code`, `went_live`, `users_up`,
  `update_posted`, `update_hidden`, `raising_on`, `raising_off`, each with a dedupe key per project and
  week. Both type checks in `schema.sql` list the same values (`schema-rerun.test.ts`).
- Streak and `weeks_shipping` count only confirmed ship weeks.

### Updates

- `tell update { text }` (`updates.ts postUpdate`), `update { hide: "YYYY-MM-DD" }` (`hideUpdate`),
  `updates { on }` (`setUpdates`). One row per project per ISO week; a second post in the week replaces
  the text. At most `UPDATE_POSTS_PER_DAY` 20 posts a person a day (`hit('updatePost:<root>')`, final
  fix M2); then a plain agent note. Hidden updates leave the profile and the feed; their facts still count.
- **The text rule (`update-text.ts checkUpdate`, `UPDATE_MAX` 280).** One paragraph. No `@` mentions, no
  run of 7 or more digits, no key, token, seed or address (checked after normalizing, so combining
  marks and mixed scripts do not hide one), and the shared banned-word checks. **Own links** only to a
  confirmed site, the hosted `<slug>.earnkit.com`, or the confirmed GitHub repo (`updates.ts ownLinks`);
  never a package registry, never a file link; stored as the parsed href. No "written by an agent"
  label (R6). v2.13.1 O4: the link scan reads the text as cleanText does (NFKC, every hidden character
  turned into a mark that is never a link boundary), and the final text is re-scanned with the
  renderer's rule (`update-links.ts RENDERED_LINK`, shared with `UpdateCard`): every link in it must be
  one of the checked own links, else the links note.

### The feed

- `feed.ts pointsOf`: went_live 40, won 40, users_up `min(30, 6*log2(1+n))`, earned
  `min(20, 5*log2(1+d/10))`, shipped_code 10, streak `min(10, w)`. Updates with no facts never reach
  the feed. Ties: the higher Bench score.
- **`feedRankStep`** (the `feed` step, once a day through the `feedRank:<day>` rate window, from 15:00
  UTC after `weekly`) writes `project_updates.points`. `feedWeeks` shows the top `FEED_WEEK_MAX` 20 of
  the last finished week, then `FEED_OLDER_WEEKS` older ones; `carouselCards` is the landing's top
  `CAROUSEL_MAX` 12.
- **Owner control:** `pnpm feed:pin <update-id> [--off]` and `pnpm feed:hide <update-id> [--off]`
  (`scripts/feed.mts`, `setFeedFlag`). Pin leads the week; hide leaves the feed, stays on the profile.

### Rank

> Superseded by "Scoring and clarity (Task 1)": `rank.ts rankLine` and `scoreLine`, every ranked builder sees a
> rank, chain lines from one ranked project.

`rank.ts`: P = 100 * rank / total. "Top P%" only when the pool has `BENCH_PERCENT_FROM` 20 or more and
P is 50 or less (1 or more: rounded up whole; under 1: rounded up to one decimal, never below 0.1).
Under 20: "#N of M" in the top half only. `rank.ts benchRank` and `bench-rank.ts` (`rankLines`,
`chainPools`) give one pool per chain (Base, Robinhood Chain, Arc; `BENCH_CHAINS`); a chain's chip and
rank line show only from `CHAIN_CHIP_MIN` 10 ranked projects. A project is on a chain by a confirmed
contract, an EarnKit deploy, a launched coin or a program entry naming it. "Percentile" never appears.

### Raising

**Its own switch (final fix, controller ruling): `EARNKIT_RAISING=on`** (`builder-score-flag.ts
raisingEnabled` = `EARNKIT_RAISING === 'on'` (v2.14: the Bench is always on); off by default, cleared by
`fixtures/test-guard.ts`). Off under the Bench: `pillOf` is null (no pill on the profile, the Bench, the
card, the landing; no Raising chip on update cards), `raiseAsk` and `setRaising` do nothing, coin moments
say v2.12.1's coin line (`coinLine`) and a coin yes does not set `raising_at`, the "Raising" filter chip
is hidden on `/bench` and the landing (`?raising=1` is ignored, `parseBenchFilter`; removed for good in launch-ready
L3, flag on or off), tell's `coin` is
v2.12.2's (no `{ raising }`, `TELL_DESCRIPTION_BENCH_NO_RAISING`), and `/llms.txt` names no raising.
On: everything below, as built. The `/bench` and landing cache keys name the flag.

`raising.ts`: `raisingCoin`, `setRaising`, `pillOf`, `raiseAsk`. Moments are the v2.12.1 coin moments
plus `streak_five` (`coin-moments.ts`, `bench-find.ts coinAskBench`). The yes runs the existing launch
(`token-launch.ts`, `tokens.ts`) and sets `projects.raising_at`; `tell coin { raising: false }` clears it
and the coin stays. A coin from before v2.13 shows no pill until its builder says yes ("Want to show
you're raising with $X?"). The launch now stores `projects.coin_tx` and `coin_chain_id`. The pill
(`RaisingPill`) says "Raising $SYMBOL" and links to tokens.fun; it names nothing about returns.

### Surfaces

- `/bench` (`app/bench/*`, `bench-data.ts`): top 100, filters as URL parameters (`chain`, `raising`,
  `weekly` = streak of 4 or more), 16 cached variants (`unstable_cache`, revalidate 60, `PROFILE_TAG`).
  Project names on `/bench`, `/feed` and the landing carousel are the shown names
  (`page-data.ts safeNames` over `shownProjects`), so a private repo reads "Private project" there, as on
  the profile and the card (final fix I1). The pill comes from the same read as the row (final fix M7,
  `pillOf`'s rule), not one call per row.
  `/leaderboard` is a 307 to `/bench` (temporary, so nothing sticks).
- `/feed` (`app/feed/*`).
- The profile `app/[handle]/BenchProfileView.tsx`: photo, rank lines, score parts (`ScoreParts`), the
  52-week grid (`ShipGrid`), tabs as links (Ship log default, `?tab=project` = `ProjectTab`). The card
  (OG) shows photo, name, "Top N% on the Bench", project, streak; it never names a confirming project.
  v2.13.1 O3: while the one project is Confirming, one neutral card ("<Name> is getting <project> on the
  Bench.") replaces the ring and the grid, and the Project tab shows only the name and what it is. The
  Started fact merges into its week's card as a "Started tracking" chip; the grid also counts any shown
  week whose facts carry checked commits (`gridWeeks`), so the card and its square agree.
- With `EARNKIT_RAISING` off the landing hero subtitle and How it works drop raising (v2.13.1 O3).
- The landing (`HomeView`): hero "Ship every week. Get funded.", `BenchTop`, `UpdateCarousel`, grants,
  `BenchHowItWorks`, Backed by. The landing cache key names `EARNKIT_RAISING` (v2.14: `landing-v214`, `-raising` when on)
  (`landing-cache.ts landingCacheKey`, final fix M4). `/llms.txt` is a route (`lib/earnkit/llms/v213.txt`; v2.14 deleted
  `v212.txt`). Chain logos: `public/images/chains/{base,arc,robinhood}.svg`.


### The builder bonus (T13, B16, R16)

- v2.14 retired the flag and deleted this path (see "v2.14 One account: retired switches").
- `bonus-rounds.ts bonusOn` is false under `benchEnabled()`, so every card, guide, reply line, round and
  `bookingFor` target follows: every bonus deposit books to the Safe. Nothing is deleted while the flag
  can go off (plan B16); the removal list for when the flag is retired is the comment above `bonusOn`.
- `cron.ts runCron` under the flag: no traction scoring, no proof re-check, the ledger without its
  `rounds` step, no `bonus:` needs_owner lines. The ledger (`bonus-ledger.ts`) still indexes, claims the
  bonus wallet, the Safe, creators and MINI, and sweeps to the Safe.
- Fee split: tokens.fun's v2.13 split is Safe 50 / creator 40 / MINI 10 (3 slots). `policy-constants.ts
  EARNKIT_SPLITS_BPS` holds both splits; `feeRecipients` reads each coin's own split from its locker and
  accepts either (creator slot 1, MINI slot 2 in both), so claims work before and after the tokens.fun change.
- Builder-visible text gated by the flag: the terms' fee table (`policy.ts feeTable`, 40/10/50) and bonus
  paragraphs, confirm's `contracts` description, `REPO_HELD`, the hero stats line, the bonus pills
  (Hero, cards, guide page, install modal via a `bench` prop from the server parent), `/bonus/*` and
  `/admin/bonus/*` (404), the sitemap's rounds, `/llms.txt`. `/api/stats` keeps its keys
  (`bonus_programs_open` is 0 under the flag).

### The copy rule (B17)

Chain names and "Top P%" are allowed in public text under the flag; "percentile" stays banned
(`fixtures/banned-words.ts`, `copy-review.test.ts`). Under the flag there are no all-caps labels:
"Backed by" and the footer column titles render in sentence case (site-wide under the flag), and the
footer tagline becomes the hero line.

### Env vars

`EARNKIT_BENCH=on` (needs `EARNKIT_BUILDER_SCORE=on`). `EARNKIT_RAISING=on` (needs the Bench) turns on the
Raising pill and asks, a separate step after the lawyer. Nothing else is new. `X_CLIENT_ID` and
`X_CLIENT_SECRET` are set on Railway (2026-10-15; the claim redirect to x.com was verified).
`EARNKIT_BONUS_WALLET` is no longer needed by new launches.

### Turning the flag off

Unset `EARNKIT_BENCH` and redeploy. Every surface is v2.12.2 again (replies, landing, profile, `/bench`
and `/feed` 404, `/leaderboard` serves the v2.12.1 board, the weekly and feed steps do not run, the
bonus returns as it was). State that waits, untouched: `project_updates`, `builder_profiles.main_project_key`
and `updates_on_at`, `projects.raising_at`, `coin_tx`, `coin_chain_id`, and the new `builder_projects`
columns (`chains`, `streak`, `weeks_shipping`). `/leaderboard`'s redirect is temporary, so nothing
sticks in a browser; v2.12.1's 308s are unchanged.

### Owner go-live steps (v2.13)

1. **Brand SVGs** for Arc and Robinhood Chain at `apps/frontend/public/images/chains/arc.svg` and
   `robinhood.svg` (monograms today).
2. **Deploy order (final review I4).** Deploy EarnKit with the flag off (it claims fees from both splits,
   `EARNKIT_SPLITS_BPS`) and check production. Then set `EARNKIT_BENCH=on`. Then merge and deploy the
   tokens.fun split change (branch `earnkit-split-v213`; creator 40, MINI 10, Safe 50) within minutes,
   so the flag-off terms (which still promise the 20% bonus slot) never meet a 3-slot coin. tokens.fun
   before EarnKit means creator fees on new coins wait until EarnKit deploys.
3. The acceptance runbook, with `EARNKIT_RAISING` still off.
4. **Lawyer** approves the word "Raising", the raise line and the pill. Then, as its own step,
   `EARNKIT_RAISING=on` on the frontend service and redeploy (runbook section 5).

Done: `X_CLIENT_ID` and `X_CLIENT_SECRET` (2026-10-15).

## v2.13.2 Follow-ups (three small fixes)

Brief: `.superpowers/sdd/v2.13.2/brief.md`. Everything sits under `EARNKIT_BENCH` as v2.13 does; flag off is
unchanged (no new cron step, the v2.5 stats formula, `/bench` a 404).

- **Org-repo proof expiry (security).** A repo confirmed by a proof branch on an Organization's repo
  (`builder_sources.gh_owner_type = 'Organization'`; any member's push confirms it) stays confirmed
  `proof-branch.ts ORG_PROOF_MAX_AGE_MS` (90 days) after `verified_at`. `expireOrgProofs` returns older ones to
  `'proposed'` with `reject_reason = 'stale'` (`STALE`) and rescores the person at once, so they leave the Bench
  (the Bench reads `benchConfirmedSql` live). The proof stays `proof_branch`, so discovery's not_owner exemption
  (unchanged, not_owner only) still keeps the row out of `rejected` and the re-proof open. The cron step
  `proof_expiry` (`builder-score.ts runScoreSteps`, after `proof_branch`) runs `orgProofExpiryStep`: at most
  `ORG_PROOF_PER_RUN` (100) a run, one person at a time (their rows, then their rescore), stopping at the cron's
  deadline; the `orgProofExpiry:<day>` rate window is taken only after a run that handled every expired row
  (review M1), so an error, the deadline or the bound leaves it open and the next hourly run carries on; a
  failed rescore puts that person's rows back to verified with the note `stale_retry` (`STALE_RETRY`), is logged
  by class name, and the run goes on with the next person (`done: false`); the next run takes `stale_retry`
  rows last, so one person whose rescore keeps failing never blocks anyone. `safeIndexStep` catches its own
  failure count write, so it never throws out of the ledger. A run for `only` people runs for them without the
  day's window. `proofBranchFor` treats a stale source as unconfirmed
  even after a used code and marks its checking state `again`; the reply (`bench-find.ts` view `'recheck'`)
  says "Time to show <project> is still yours: I'll check with a quick temporary branch on GitHub." A pass
  verifies the repo again and clears the note. User-owned repos (owner = pusher) never expire. Fix round 1
  (concern 3): a stale source comes back ONLY through a fresh proof branch: discovery never verifies it
  (`discovery.ts verify` and the candidate loop skip `reject_reason = 'stale'`, so no repo_owner top-contributor
  verdict and no clue scan) and `sources.ts verifySource` refuses it in SQL; only `checkProofBranch` writes it back.
- **The Safe's revenue stat.** `fees_to_safe_eth` (`stats.ts`) used to be the indexed bonus deposits x 30/20,
  which only sees v2.5's 4-slot coins. Under the Bench the bonus ledger also indexes the Safe's own FeeLocker
  deposits from EarnKit coins into `safe_fees` (`bonus-ledger.ts indexSafeFees`; cursor `bonus_cursor` id
  `'safe'`; with no cursor it starts at `SAFE_INDEX_START_BLOCK`, else `BONUS_INDEX_START_BLOCK`, else 2 days
  back). Review round: it is the ledger's last step (`safeIndexStep`, step `safe_index` after `claim_others`,
  so the money steps always run first), in its own slice (`SAFE_INDEX_MS` 30 s, never past the run's deadline)
  and at most `SAFE_INDEX_CALLS_PER_RUN` (10) ranges a run. Per range it reads the Safe's WETH StoreTokens
  first (`BonusRpc.safeStoreLogs`) and only when there are some, the lockers' ClaimedRewards across just those
  deposits' blocks (`BonusRpc.claimLogs`, never filtered by coin: attribution needs every claim in the tx); it
  attributes each deposit as the bonus index does (`bonusDeposits`), so it needs no receipt reads. Failures
  in a row are counted on the 'safe' cursor row (`safe_index_failures`); `INDEX_FAILED_RUNS` of them make the
  cron wait on the owner (`cron.ts bonusWaitsOnOwner`), as the bonus index; a coin EarnKit didn't launch is never stored
  (the Safe is tokens.fun's treasury for every coin). `fee_claims` stays an ops log: a Safe claim pays all
  tokens.fun coins at once, so it can't be split by coin. The stat under the flag: indexed Safe deposits
  (`safe_fees_wei`) + 1.5x only the bonus deposits whose transaction has no indexed Safe deposit of the same
  coin (`bonus_unmatched_wei`; history before the Safe index) + bonus money booked to the Safe. Test
  installations' coins never count. `/api/stats` keeps its keys and types; no field was added. No owner step
  for the start block: the fallback to `BONUS_INDEX_START_BLOCK` predates every 3-slot coin (coordinator
  ruling). Under the flag `STATS_LABELS.fees_to_safe_eth` is "fees to the EarnKit Safe (ETH)" (a getter on
  the flag); flag off it stays "fees to the Safe (v2.5 tokens)".
- **The Bench header counts.** `app/bench/BenchView.tsx benchLine`: 0 is the landing's empty line ("Nobody on
  the Bench yet. Add EarnKit to your agent and be first.", `BENCH_TOP_EMPTY`), 1 is "1 builder who ships, ranked
  by what they shipped and who uses it.", more "N builders who ship, ...". The other count phrases on `/bench`,
  the landing, the chips and the feed were checked for 0 and 1 and already read right (`bestFact`, `factChips`,
  `startedChips`, `benchRank`'s "#1 of 1 builder", `streakWords`; the chips carry no counts; the feed's empty
  line is `FEED_EMPTY`). Fix round 1 (concern 4): with nobody ranked (`count` 0) `/bench` shows that empty line
  once and no rows panel; a filtered view with no rows (others ranked) keeps "No one here yet." (`BENCH_EMPTY`).

## v2.13.3 The owner's own production test (2026-10-17)

Brief: `.superpowers/sdd/v2.13.3/brief.md`, plus owner rulings A, B, C sent the same day. Everything sits under
`EARNKIT_BENCH`; flag off is unchanged. Tests: `v2133-owner-test.test.ts`. Runbook: section 8 and "Before you start" step 6.

- **1. The older find fields are never dropped.** `identity-input.ts benchIdentity` (called by `tools.ts
  listProgramsInput` only under the Bench) fills what identity doesn't carry: `github_user` is `identity.github_login`;
  the first repo (`repos`, else a `local_repos` url, else `local_git` remotes) is the project's repo, named by its
  `local_repos` entry, with that entry's live link (else a top-level `live_url`, else `local_git`'s first). An
  `identity.project` wins; its missing repo is filled, its missing live link only from the same repo. `tools.find` passes
  the raw `local_repos` on, so a live link the matcher drops as a placeholder (earnkit.com) still reaches identity. Find's
  MCP schema under the Bench lists `live_url` and says the older fields are older; `FIND_DESCRIPTION_BENCH` asks for
  `identity.github_login` "(not github_user or repos)".
- **The Bench rank in the reply (v2.13.4, owner, reversing v2.13.1 O5 P2).** `bench-rank.ts rankLines` gives the
  phrase by the spec's rule alone ("#N of M" under 20 ranked, top half only; "Top P%" from 20), from 1 ranked, so a
  confirmed project's stand line reads "EarnKit is on the Bench: #1 of 1 builder." (`BENCH_PHRASE_MIN` is gone).
- **1b (v2.13.4, production).** A `local_repos` entry names its repo by `url`, `remote` or `repo` (under the Bench
  the MCP find schema keeps `remote` and `repo`, which the SDK would otherwise strip; flag off the schema is byte for
  byte the same, test P.3). The matching entry's live link (and name) fills the project when identity doesn't carry
  them. An entry left with no repo key gives its live link only when it is the only local repo or carries the repo's
  name; an entry naming another repo never does. P.1 runs the production shape through the real MCP layer.
- **2. "Ways to get funded" always shows** (never while a build is in progress, never for a repo another person holds:
  O2 ruling 3). With no project or one not yet confirmed, up to `NEEDS_MAX` (2) programs in all; for a confirmed project
  with nothing to name, the same. `bench-find.ts needsPicks` (open, showable, a prize; the project's chains first, then
  the biggest prize) and `fundNeeds`: what each needs in plain words ("for a Base app, once it's live", "for an
  Avalanche app", "once your code is on GitHub", "for any app"). Rendered by `bench-reply.ts needsLine`
  ("<title>: <prize> <needs>."), after the fits and the ideas. Never says it fits.
- **3 and ruling A, no project.** `NO_PROJECT_LINE` is "You're not on the Bench yet." The last line is `START_ASK`
  ("I'll put your work on the Bench and find money it can win. What's your GitHub, or a link to something you've made?",
  ask kind `start`, its yes `START_YES_NOTE`). Never the generic starter with no program: `withNoProgram` returns only a
  program's own fresh build (program file `fresh_build`, the owner's call that the starter competes there); then the ask
  is `startBuildAsk(offer, program)` (START_ASK plus "Or want me to build <offer> for <program>?", kind `build`, its yes the v2.11 build for that program). Both carry `START_NOTE`:
  a GitHub login or a link goes to find with identity. The reserved `earnkit-bench` build still runs if started, but
  find never offers it.
- **Ruling A, a project.** `chooseAsk`: a different project (can't join) first, then the best fit's entry, then a
  community round (the coin), then go live, updates, the week's post, the fallbacks. `benchView` asks `coinAskBench`
  whenever nothing before it is an entry, a different project or the install ask. `coinAskBench` offers a confirmed
  project with no moment yet a community round once (moment `countable`), so a project with nothing that fits gets one.
- **4. The claim link is a line:** `claimLine` "Your page: claim it with X at <link>".

Replaced in v2.14 (item 5 below): see 'v2.14 One account'.

- **5. Private and org repos (the read-only GitHub App).** When the one project's repo probes 404 and
  `githubAppEnabled()`: the view's branch is `private` ("EarnKit can't see <project> yet."); claimed, the ask is
  `install_app` with `installAppAsk(name, link)` ("Install EarnKit on <project> (read-only) here: <link>. Want me to add it once that's done?": the question last; the v2.10 App proof link, `createVerifyLink` purpose `app`: the sign-in
  hop, then the install), the reply's one link (no page link beside it); unclaimed, the X claim is the one link and the
  ask is `installAfterClaimAsk`. Its notes: `INSTALL_APP_NOTE`, `INSTALL_APP_YES_NOTE`. App off: `cantSeeLine` "I can't
  see <project>. EarnKit can only see public repos right now." and a different project. Once installed
  (`github_verifications via = 'app'` for this installation and repo): `proof-branch.ts appBearer` mints the
  installation token per call (`appTokenFor`, through the caller's budgeted fetch) and it replaces EarnKit's token on
  that repo's reads: the probe (a kept "missing" is read again), the ref, the repo and the activity. The branch, pusher
  and repo rules are unchanged, so the App confirms nothing by itself. Readings: `person-github.ts readAppRepos` reads a
  repo EarnKit's token couldn't (one GraphQL call with the installation token, and an org's contributors), keyed by
  source id so one person's installation never reads into another's source; called by `sources.ts` (Bench path) and
  `person-score.ts readPersonLive` (Bench only). Tokens are never stored or logged. Pages keep the I1 rule: a private
  repo reads "Private project" unless the builder's own agent named it.
- **Ruling B, "community round".** Builder text never says raise or raising: the pill "Community round $X"
  (`RaisingPill`, the share card), the chip (`FILTER_RAISING`; removed in launch-ready L3), the week chip, `raiseLine` ("Want to open a community
  round for <project>? I'll launch $X on tokens.fun and you get 40% of its trading fees."), `showRaisingLine`,
  `RAISE_LINES`, the hero and How it works, tell's description, `/llms.txt`. Internal names (`raising_at`,
  `EARNKIT_RAISING`, `{ raising }`) stay. `fixtures/banned-words.ts BENCH_EXTRA` bans raise, raising and fundraise;
  `BENCH_PITCH_ALLOWED` allows the needs lines' chain phrases and the App-off line.
- **Ruling C (reported to the owner).** Only one tested starter exists (`arc-tipjar`), set as the fresh build of Arc
  Microgrants, which closed 2026-10-15; so today no open program offers a build.
- **Owner go-live:** the five App env vars (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`,
  `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`): set on Railway 2026-10-17 (slug `earnkitai`, App ID 5355247).
  The community round line and pill still wait on `EARNKIT_RAISING` (the lawyer step).
- **Review fix round.** (I1) `repo-public.ts repoReadPublic` (page-data's PUBLIC_REPO_DAYS test, shared): the ship
  log's repo link (`updates.ts ownLinks`) and a community-round offer (`coin-moments.ts coinOfferable`, Bench only)
  need the repo read public; a coin yes for a repo gone private (`coinYes`) uses the page's safe name, a ticker from it
  and no repo link. `freshBranchProof` and `controlProvenMain` read with the App token. One question, last: under the
  Bench `raiseLine` and `coinLine` end on their question ("A coin pays you 40%... Want to launch...?"); flag off,
  today's lines; `startBuildAsk` is one question ("What's your GitHub, a link to something you've made, or should I
  build <offer> for <program>?"). (M1) `knownUnprovable` mints the App token and re-reads within one REPO_PROBE_MS
  window (`within`); slower, the repo stays unseen this reply. (M2) `coinBranchProof` with the App on gives the
  install ask. (M4) `github-app.ts repoInstallation`: `appTokenFor` mints for the installation GitHub names for the
  repo (`GET /repos/{owner}/{repo}/installation`), the stored id only a hint; none: no token. (M5) `needsPicks` also
  names programs with no known award, without a dollar figure (`needsLine` with a null prize).

## v2.13.4 Value after the X claim and nothing else (2026-10-17)

Replaced in v2.14: see 'v2.14 One account'.

> **Removed in v2.14 Task 7** (see "v2.14 One account: claims, joins and probation removed" below): the claim ask, the
> claim page and its one-click join (R1), the join notice and detach (R6), probation (R7), pending joins and the
> JOIN_TABLES registry. What follows is history; the tables stay.

Brief: `.superpowers/sdd/v2.13.4/brief.md` (the owner's spec, verbatim, and controller rulings R1 to R5). Everything sits
under `EARNKIT_BENCH`; flag off (and score-only) is unchanged. Tests: `v2134-onboarding.test.ts` (the owner's acceptance
test a to g, the security review S.a to S.f, R6.1, R7.0 to R7.5, R8.1 to R8.8, R9.1, C.1, C.2, K.1 to K.4, E.1, R10.1, REG.1 and REG.2). Runbook: sections 8, 9 and 10.

- **The flow.** a. First find: where you stand, ways to get funded, then one question, the X claim
  (`bench-reply.ts claimAsk`: "Claim your page with X (it's your name and photo on the Bench): <link>" and "Want me to put
  <Project> on the Bench once that's done?", or "Want me to find money you can win once that's done?" with no project or one
  that can't join). Ask kind `claim` (`CLAIM_NOTE`, its yes `CLAIM_YES_NOTE`; a no keeps it away 30 days like every ask).
  b. The claim page makes the page from X, or joins this agent to the X's existing page on one click (R1, below).
  c. Next find: "Your page: ..." (or once, "Linked to your page: ..."), then one question: the read-only App install for a
  private or org repo (`installAppAsk`: "<Project> is private, so I can't count it yet. Install the read-only EarnKit app on
  it (one click): <link>" then "Want me to count it once that's done?"), else the Bench's own next step (the proof branch runs
  for a public repo, said in one line). d. Installed: the next find gives the proof branch through the installation token;
  the find after the agent's push shows "<Project> is on the Bench", then one way to move up.
- **One question, last; one link (spec 2, 5, R4).** Unclaimed, the claim is the ask: the claim link is never a stand line
  (only beside a build in progress, which asks nothing) and never shows with another question (a pending join, an outcome
  question, a submission hold the reply: no claim link at all; `showsClaimLink` follows the ask). Beside the install link the
  page is named without https (`pageUrl`: "earnkit.com/<handle>"), so the reply has one link. `UPDATES_ASK`, `buildAsk`,
  `benchBuildAsk` and `goLiveAsk` now end on their question.
- **R1, the one-click join.** Under the Bench `bindX` answers `held` (with the holder's root) for an X user id another group
  holds and sets up no pending join. `xCallback` stores one offer (`x_join_offers`: hashes of a 32-byte token and of the
  claim cookie's csrf, the claim code's hash, the X user id, handle, name and photo; 15 minutes) and shows "This X account
  already has an EarnKit page.", "Only continue if your own agent gave you this link." and one button "Add this agent to your
  page earnkit.com/<handle>" (the claim cookie is kept for that one POST). `claimJoinPost` (`app/claim/join/route.ts`, POST
  only): Origin, the token, this browser's claim cookie (by the offer's code hash), used once (DELETE ... RETURNING), then
  checked again: the code still names the joining person (unclaimed), the X user id is still on the holder's page, not
  cleared by the owner, no shared client on either side. `linkInstallations` joins the groups at once (no other agent is
  asked); when the joining group is the older one (the root), the X claim is bound to the root again so the page keeps its
  handle. It writes `standing_seen.linked` (by installation id; `bench-find.ts takeLinked` reads it once: "Linked to your
  page: ...") and a `page_joined` event (`events.ts`, both `builder_events` CHECK lists). The old cross-agent yes stays only
  for GitHub-login ties; an X pending join from before is skipped under the Bench (`identity.ts pendingRow`).
- **Security review (coordinator, after an automated scan of `claim.ts`).** The scan flagged account linking in `claim.ts`;
  the risk is the v2.12.1 "phishing join": a claim link forwarded to a victim attaching the sender's agent to the victim's
  page. Covered: no path joins without the click in the browser that signed in with X (S.a: not `bindX`, not the callback,
  not an old X pending join); the click is POST only, cookie bound, Origin checked, single use, 15 minutes (S.b: a GET or a
  prefetch of `/claim/join` is a 404; a forwarded token without the cookie, another claim's cookie, another site or no Origin
  are 403; a replay or an expired offer 410); identity is the X user id, never the handle (S.c); a shared client never joins
  (S.d); an installation that got its own claim since the offer, or holds another X account, is never moved (S.e); the join
  is in the event log (S.f).
- **R6 and R7 (controller rulings, answering two scans: the R1 join is weaker than the two-agent yes it
  replaced; R7 replaces R6 item 4 and simplifies revocation).** `page-joins.ts`.
  (1) The R1 page names the installation that minted the claim link (`claim_codes.minted_by`, the last asker;
  `claimLink(builderId, mintedBy)` via `standBase(id, { own })`): "This agent: <client name>, connected <when>."
  The name is the client's self-chosen dynamic-registration `client_name`, cleaned (`oauth.ts clientNameOf`),
  carried in the signed client id (`cn`) and stored at the token exchange (`installations.client_name`); a hint,
  never proof. (2) Every R1 join is a `page_joins` row (page root, the joining group's own `from_root`, members,
  joined_at, `answers`). The R1 join keeps the page's group as the root (`linkInstallations(..., { root })`).
  (3) PROBATION (R7): for `PROBATION_MS` (24 h) from joined_at a member (`onProbation`; `tools.ts withProbation`
  sets `ctx.probation` for find, prepare, confirm, tell and score) may only post updates, and never over
  another installation's update for the same week (`updates.ts postUpdate(..., { probation })`: the row is left,
  `PROBATION_LINES.update_taken`). Every other write is refused with one line and one question
  (`PROBATION_LINES.main` / `.write`, the question "Want me to post this week's update instead?"): see the audit
  table below. (4) THE NOTICE (I-1, I-2): each installation eligible for a join is asked, on every find and score
  until it answers, "A new agent was added to your page on <date>. If that wasn't you, want me to remove it?"
  (`pendingNotice`, ask kind `remove_agent`, key `join:<id>`), even while its reply is held (computed outside
  the held guard; the held question waits). It is never stored in the shared `bench_ask`; the answer is routed
  by `ctx.ownInstallationId` (`benchMoveUp` -> `answerNotice`), which checks eligibility on a yes and on a no:
  on the page now (current root), not a member of this join, not a member of any still-attached join with the
  same or a later id (join order, never created_at), not on probation. A no is recorded for that installation
  only. (5) DETACH: a yes moves the members back to their own former group (`from_root` a root again, the others
  pointing to it), matched on the page's current root (a no-op is "Nothing to change: ..."), hides their
  updates since the join, logs `page_detached`, and says "Done. That agent is off your page, and its updates
  since it joined are hidden." then "Want me to show where you stand now?".
- **R8 (root cause of the R7 re-review: an R1 join merged the newcomer's whole group into the page).** The
  one click attaches ONLY a fresh, empty installation (`page-joins.ts freshAndEmpty`, the reconnect case): a single
  installation (its own root, no members), no verified or proposed sources, no GitHub verification and no open
  verify link, no wallet (person_wallets, installation_wallets, payout_wallet), no projects (entries, coins), coin
  moments or token offers, no X claim. Anything else gets the strong-proof two-agent yes (`joinOnProvenTie` with the
  X user id; the X tie is asked again under the Bench) and the claim page says "This agent already has its own data,
  so your other agent needs to say yes." The check runs at sign-in and again at the click. `attachFresh` does the
  join in one transaction: the page still holds the X user id, the installation is still its own root, it alone is
  attached (`installations.builder_id`), its own empty person rows are dropped (nothing is merged; no
  `linkInstallations`), and the `page_joins` row is written with `eligible`, the page's installations at that
  moment. Eligibility to answer the notice: in `eligible`, on the page's CURRENT root now, not a member, not a member
  of a same-or-later attached join, not on probation; `pendingNotice` filters in SQL on the current root before any
  limit. A tie-join (`answerJoin`) is refused while either side's page has an R1 join whose notice an eligible
  installation still on it hasn't answered (`openR1Join`): that page's yes isn't recorded, and a link with both yeses
  undoes the last yes. Probation fails closed (`withProbation`: a failed read is probation). On probation no App
  verify link is minted in find, no fit repos or kept match are written, and update posts count against the
  installation's own daily limit (`updatePostProbation:<own>`). A probation tell with an update and a refused part is
  one reply: what was done, then the refusal's line and its one question.
- **R9 (what a reconnect's agent reports never blocks the one click).** `freshAndEmpty` ignores what the agent
  only reported: proposed sources, the identity report, `reported_github`, its own unclaimed claim code (and its
  unused proof codes). `attachFresh` discards them at the join (deleted, never merged); the agent re-reports
  under probation (a project that is the page's main project is no change). A VERIFIED source, a verification, an
  open verify link, any wallet or payout wallet, entries, coins, coin moments, token offers or another member still
  make it non-empty.
- **Locks (scan: TOCTOU in page-joins.ts).** Each check and its write is one transaction under the page's advisory
  lock (`page_join:<current root>`): `attachFresh` (also the installation row FOR UPDATE, which blocks every insert
  that references it by foreign key, the `proof_branch:<id>` lock, the page profile FOR UPDATE; the emptiness
  check and the join row are inside), and `answerNotice` (the join row FOR UPDATE; eligibility, the answer and the
  detach together; a second concurrent answer waits and finds it detached). `answerJoin` takes both groups'
  `page_join` locks in id order and links inside the same transaction (`linkInTx`). Tests C.1 (two concurrent
  yeses: one detach) and C.2 (a wallet written while the click waits: refused).
- **Consent binding (scan: stale consent in identity.ts).** A pending join (the two-agent yes) stores the page's
  root at ask time and two stamps (`joinStamp`): the joining group's facts (installations, payout wallets, verified
  sources, verifications, open verify links, wallets, entries, token offers, coin moments, X claim) and the page's
  (root, installations, R1 joins and detaches). `answerJoin` re-checks inside its transaction: under 24 hours
  (older rows are not even asked), the same root, both stamps unchanged; else the row is dropped ("That request
  changed or is over a day old, so I dropped it."). So a yes given before the joining side gained data or a member,
  before an R1 join or detach, or before a re-root is never replayed. Rows without stamps (from before) are void.
  Re-asking with changed facts replaces the row and clears both yeses.
- **R10 and the final review (supersedes the X parts of R8 and the consent binding's X use).** Under the Bench there
  is NO X two-agent yes: `joinOnProvenTie({ x_user_id })` asks no one and `pendingRow` never returns an X tie. A
  non-empty agent on the claim page reads "This agent already has its own data, so it can't join your page.
  Reconnect EarnKit in this agent (a fresh connection) and sign in with X again." (409), at sign-in and again at the
  click; nothing is linked, merged or asked. GitHub-login ties keep their two-agent yes (with the consent binding
  above). The emptiness check and the R9 deletes are built from `page-joins.ts JOIN_TABLES`, which classifies every
  table keyed by an installation or person as `blocks` (with an optional `when`), `discard` or `stays`; hosted sites,
  contract deploys, open hosting uploads and proof lines now block too, and the harmless leftovers (answers, program
  status, repo facts, match log, declines, join asks, derived scores, slugs, open X sign-ins) are deleted at the join.
  `db-check.mts` and test REG.1 fail on any keyed table missing from it. The shared-client and owner-clear checks
  run inside `attachFresh`'s locked transaction. Discovery applies its verdicts in one transaction holding its OWN
  root's `page_join` lock, only while the person is still its own root, and every verdict write runs on that same
  transaction (`db.ts inTx`: `verifySource`, `rejectSource`, `claimContract`, `releaseLogin`, `setFallback`,
  `clearXHandle` take an optional transaction), so it never holds one pooled connection while waiting on another.
  Their side effects wait for the commit: discovery runs the transaction through `db.ts withDeferred`, and the
  helpers call `afterCommit(db, ...)` for `profileChanged` and their events, which are queued on that transaction,
  run after it commits and dropped on a rollback (with no deferring transaction they run at once, as before). A
  rolled-back discovery restores its `verified` count, records no event and stays queued (`discover` and
  `discoverPerson` mark the queue done only after `discoverOne` returns); tests D.1 and D.2.
- **The R7 write audit (on probation).**

  | Write | Where | On probation |
  |---|---|---|
  | main project from identity.project, the old fields (benchIdentity), local_repos | `tools.ts list_programs` | gated: not written; naming another project shows the project line |
  | identity notes, reported login, fallback handle, remembered wallets and repos | `noteIdentity`, `fillGithubUser`, `setFallback`, `rememberWallets`, `checkPrograms` | gated: not written |
  | proof-branch code issuance and checks, "delete the branch" told | `benchView proofBranchFor`, `checkProofBranch`, `branchToRemove` (find, score) | gated: none |
  | App install link | `benchView createVerifyLink` | gated: none (App verification needs a link only the page's own agents get) |
  | main project clear | `tell repo_facts not_mine` | gated: the project line |
  | starter build, deploy, hosting, entries | `tools.prepare` (prepareBuild, deployStep, prepare_submission) | gated: refused |
  | entries' confirm, launch_token, confirmToken, a coin by project_id | `tools.confirm` | gated: refused |
  | coin yes, community round on/off, raise yes, go-live yes | `tell coin`, `tell move_up` (benchMoveUp only allows the week's update or a suggestion) | gated: refused |
  | hide/show page, card, updates on/off, hide an update, proof pushed, pickup (answerJoin, item 8), "I submitted", tell_earnkit statements | `tools.tell` | gated: refused |
  | pending join question, outcome question, deadline and alert markers, news, fresh-offer metric, match-shown log, weekly note | find and score bookkeeping | not asked or not written |
  | post an update | `updates.ts postUpdate` | allowed, never over another installation's update for the week |
  | the live link check cache, the "Linked" note, the profile row if missing | `live-check.ts`, `takeLinked`, `ensureProfile` | allowed: a cache of stored data, its own note, a no-op on a claimed page |
- **Scans after R7 (coordinator).** "Control regression in coin-moments.ts / proof-branch.ts": most likely the
  R6 attribution columns added then removed (`opened_by`, `asked_by`). Both files are back to v2.13.3 apart from
  `installAppAsk`'s display name; every coin rule (confirmed main project, I1 public read, shown wallet, one offer
  per project) and every proof-branch rule (caps, exclusivity, pusher, App binding) is unchanged and still covered
  by the v2.13.1 to v2.13.3 tests. "Missing authorization in bench-find.ts": the remove_agent answer; it is checked
  by `answerNotice` (eligibility on yes and no) and tested in R7.2.
- **R2, one page per person.** A reconnect is a new installation: the builder signs in with X once and R1 joins it, so the
  page never splits; `bindX` never binds an X user id another page holds. A reported GitHub login or wallet still merges
  nothing.
- **R3, a live link (`live-check.ts`).** The live link the agent reported for the one project (`bench-find.ts reportedLive`
  over the stored identity) is checked: https only, never a placeholder host (`placeholder.ts`; EarnKit's own site counts for
  EarnKit's own `earnkitai/*` repos), a 2xx HTML page through `safe-fetch.ts safeProbePage` (public addresses, one same-site
  redirect, 64 KB, never an error page) that is not parked or "coming soon" (`parkedPage`). Kept in
  `standing_seen.live_check` a day (a failure an hour; a check running under 30 s is not repeated); the reply waits for it at
  most what is left of `REPLY_WAIT_MS`, at least 300 ms. It sets the view's `live` (wording, `fitsProject`, no go-live ask,
  `fundNeeds(c, has)` drops "once it's live" and, for a repo, "once its code is on GitHub") and the display name; it never
  touches the score or a site source. `takeNews` keeps `live_check` and `linked`.
- **Display name (spec 3).** `bench-reply.ts displayName`: a name that is only the repo's own lowercase name shows as the
  live site's title spells it (its first part, plain letters, the same name only), else title-cased ("earnkit" -> "Earnkit",
  "tip-jar" -> "Tip Jar"); a name the agent gave stays. Replies only; pages keep the I1 private-name rule.
- **R5.** `stand-view.ts rollingPick(..., { unknownPrize: true })` (the Bench) names an open-all-year program with no known
  award ("<title> is open all year."); a 0 award never. The background-launch tests in `tools.test.ts` wait for the release
  (`releasedBg`) instead of sleeping 900 ms. `v2133-owner-test.test.ts` R1 uses a key with no digit run (its random key could
  hold 7 digits, which the update text rule refuses first).
- **Schema.** `x_join_offers`, `page_joins` (new; `eligible` added in R8); `pending_joins.target_root`,
  `joiner_stamp`, `target_stamp`; `installations.client_name`, `project_updates.posted_by`,
  `claim_codes.minted_by` (additive); `page_joined` and `page_detached` in both
  `builder_events_type_check` lists. `db:check` covers them.

## v2.14 One account (Tasks 1 to 12)

Spec: `docs/design-docs-and-implementation-plans/v2.14-one-account.md`. Plan and per-task reports:
`.superpowers/sdd/v2.14-one-account-plan/`. Owner runbook: `v2.14-acceptance-runbook.md`. Client preflight:
`v2.14-client-preflight.md`. Branch `v2.14` from main ff8c46b6. Task 12 (D3, D4) lands after this section and
amends it.

### 1. Why and what went

Most of v2.12 to v2.13.4's bugs came from bolting identity on after an anonymous install (claim links, page groups,
merges, joins, probation) and from two proof paths. v2.14 makes the X account the person, the read-only GitHub App
the only proof, and the ship log something EarnKit writes itself. Cost: nothing new (per-installation GitHub
tokens, the existing X app, no AI).

| Went | Why | Where it is described |
|---|---|---|
| `EARNKIT_BUILDER_SCORE`, `EARNKIT_BENCH` and every flag-off path | The Bench has been on in production | 7 |
| Claim page, claim codes, joins, probation, notices, detach, group merges, contested logins, pickup | The person is the X account | 2, 3 |
| Proof branch, earnkit.txt proof line, owned-repo discovery, x_match and top-contributor clues, GitHub sign-in proof | The App is the only proof | 4 |
| The updates yes, the weekly-task note, the week's-post ask | The ship log writes itself | 5 |
| Builder bonus payout side, tip-jar starter offer, grants and build asks | Production owes nothing; one question per reply | 6, 7 |
| Google Fonts at build | Self-hosted (`app/fonts`, `next/font/local`) | 9 |

Tables and columns all stay (no destructive migration; CHECK lists unchanged). `app/claim/wallet` stays (A21).

### 2. X at install

- **Authorize.** `oauth-routes.ts authorizeGet` runs `oauth.ts checkAuthorize` (unknown client or unregistered
  redirect: our 400 page, never a redirect). X unset (`xSignInEnabled`: `X_CLIENT_ID` and `X_CLIENT_SECRET`) or a
  client serving many builders (`servesMany`: a hosted bot's name, or a redirect under grok.com, x.ai, x.com,
  meta.ai) gets the anonymous code at once (`issueCode(req, null, iss)`). Otherwise `x-install.ts
  startInstallSignIn` stores the request in `x_signins` (purpose 'install', the client's state and PKCE challenge,
  EarnKit's own PKCE verifier, sha256 of a 32-byte state, sha256 of a csrf held in a `__Host-eki-<16 hex>` cookie,
  15 minutes) and goes to X.
- **The warning page.** `redirectClass` decides whether a page naming the host comes first. Straight to X: the three
  exact documented callbacks (`AGENT_REDIRECT_URIS`: claude.ai `/api/mcp/auth_callback`, chatgpt.com
  `/connector_platform_oauth_redirect`, www.cursor.com `/agents/mcp/oauth/callback`), loopback http on any port,
  and the app-scheme allowlist (`AGENT_APP_SCHEMES`: cursor, vscode, vscode-insiders, windsurf, claude). Every
  other redirect, including browser-trampoline and unknown schemes, sees "You're connecting EarnKit to <host:port>."
  with the full redirect URI and "Only continue if you started this from your own agent." (S6: a forwarded
  authorize URL is the phishing vector).
- **Callback.** `app/x/callback/route.ts` runs `xSignInCallback` (404 when the state is not an `x_signins` row).
  The row is deleted only with this browser's cookie (else 403 before any X call), X's token is used for one
  `/2/users/me` and never stored, an owner-cleared X gets 403, and the client's registered redirect gets a code
  with `x` (id, username, name, avatar) inside the HMAC-signed payload plus RFC 9207 `iss` (A22; metadata says
  `authorization_response_iss_parameter_supported`). Rate limit `xSignIn` 30/hour per IP. Production needs
  `EARNKIT_URL` (the authorize redirect carries `iss`).
- **Token.** `exchangeCode` returns `x` (ignored for a servesMany client). The installation key is per registration
  AND X account (`clientKeyOf(client_id + "\nx:" + id)`, A2), so another X on the same registration is another
  installation; `shared` is false for an X-signed token (A1). `tokenPost` calls `attachToX`; a refusal answers
  `invalid_grant` (400) and issues no token. A known installation keeps its token (`saveInstallation(..., {
  keepToken: true })`) until `attachToX` succeeds, then `setInstallationToken`: a refused re-authorization never
  kills the token the agent already holds.
- **attachToX (one transaction, S5).** Locks `x_attach:<id>`, `x_user:<id>`, `x_handle:<h>`, `person:<root>`
  (installation's root and the X's page, ascending), then the installation and its members' rows by id. Refuses
  `other_x` (installation, group root or page profile bound to another X), `owner_cleared`, `shared`. If a page
  holds the X: the installation alone gets `builder_id = page root`; nothing merges, its data and old members stay
  behind. Else a page is made on the installation itself (`ensureProfile` in the transaction; a member of another
  root has `builder_id` cleared first). Unless it already is the page, its own members are detached first
  (`builder_id` NULL, each its own anonymous root, nothing deleted). `bindXIn` writes handle, name, photo;
  `installations.x_user_id` is set last, aborting unless exactly its row changed. `afterBind` (events, discovery,
  profile cache dropped in a `finally`) runs after commit. Lock order is documented on `identity.ts lockPerson`: the
  `x_*` locks (or proveByApp's `repo_hold:<key>`), `person:<root>` ascending, `source_proof:<id>`, installation
  rows by id, profile rows.
- **Who is the caller.** `connectInstallation` returns the page holding the token's `x_user_id` first, then
  `builder_id`, then itself; `Caller.x` carries the X id (the final fix removed the unread `ToolContext.xUserId`).
  `events-redact.mts --login` unbinds the person's installations and deletes their `x_signin_links`.
- **Migration markers.** `-- v2.14 bind:start/end` in `schema.sql`: S4 first moves the members of every one-click join no
  installation answered back to `from_root`, hides their updates since the join and stamps `detached_at` (no
  deletes); then the bind UPDATE binds every non-shared installation of a claimed page (x_handle set), filling
  only NULLs. Both are no-ops on rerun (on production: open joins 0).
- **No merge (A7 superseded).** Any installation signing in with an X that already has a page attaches ALONE. A
  pre-v2.14 anonymous agent that reconnects with X is a new installation and starts fresh (D11, accepted).

### 3. The fallback link

For a client that can't finish a browser step, and installations from before v2.14.

- **The link.** `x-link.ts signInLink(own, now)`: null when X is off, the installation is shared or already bound.
  The code is `HMAC(EARNKIT_AUTH_SECRET, "signin:v1:" + seed)` (16 bytes, base64url); `x_signin_links` keeps the
  seed and `sha256(code)` only. An open link with an hour or more left is shown again; else a new one (24 hours).
  Expired rows older than a day are deleted on mint. It is minted for the caller's own installation
  (`ctx.ownInstallationId ?? installationId`) on both find and score.
- **The page.** `GET /signin/<code>` (`app/signin/[code]/route.ts`, `'signin'` reserved, rate limit `signinLink`
  30/h per IP before any read): "This link is for an agent that calls itself "<name>", connected <ago>." (the
  client's own DCR claim, escaped, never presented as verified; S2), "Only continue if your own agent gave you this
  link.", one Continue with X (`x-install.ts newSignin` purpose 'link'). Anything else is 410.
- **The callback.** `linkSignedIn` puts the X user and `sha256` of a fresh paste code (12 chars of
  `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, `crypto.randomInt`) on exactly the link named by `x_signins.link_hash`, 15
  minutes. Nothing is bound. The page shows "Signed in as @handle." and the code as `XXXX-XXXX-XXXX` with "Anyone you
  give this code to can act as your EarnKit page. Paste it only into the agent you are using right now." (S2).
- **The bind.** `find { sign_in_code }` (string, at most 40) is read first in `tools.find`; a shared client's is
  ignored. `bindFromPaste` claims the row in one `UPDATE ... used_at IS NULL ... RETURNING` keyed by the code's hash
  AND `installation_id = own` (A7: a forwarded link's code is useless to any other agent), then `attachToX`. A
  thrown error gives the code back; a refused one is used up. Success logs `signed_in_by_code` (never the code).

### 4. One proof

Spec 2: "Install EarnKit on your repo (read-only, one click)" is the only way a repo is proven, public or private,
personal or org. Existing verified sources stay verified and keep counting on the Bench.

- **The flow.** A reply for an unproven repo asks the App install (`repo-proof.ts installLink`, a v2.10 `app`
  nonce), only for a person with a page (S7), and the confirm page names the destination ("This adds
  github.com/<repo> to earnkit.com/<handle>. Only continue if that is your page."). GitHub's setup URL
  (`github-app.ts appSetup`) checks `appProof` (the installation lists the repo; the installer owns the account or
  administers the repo), writes the `via = 'app'` verification, then `proveByApp` for the person's root.
- **proveByApp (S8).** GitHub must name this very installation for the repo; one read of `/repos/{key}` with a
  per-call installation token; a fork or template (ever) rejects the source `derived`. Then ONE transaction:
  `repo_hold:<key>` lock, `person:<root>`, `source_proof:<id>`, builder id still a root, `heldByOther`, then the
  source verified `github_app` with gh ids, `app_checked_at`, `public_at`. An App proof replaces another person's
  discovery-derived (non-App) hold (that row goes to proposed, `replaced_by_app`); only an App hold gives `taken`.
- **What counts where.** The Bench counts any confirmed proof (`CONFIRMED_PROOFS` includes `github_app`). Actions (a
  coin via `token-gate.ts tokenGate`, a deploy, a hosted site, a build's deploy) take only `repoProof(..., {
  forAction: true })`: a `github_app` source GitHub confirmed within `APP_PROOF_FRESH_MS` (a day plus two hours),
  else checked live (`appProofLive`: GitHub names an installation, it is one this person proved, and for an org
  repo the prover is still admin; held passes, gone or unknown refuses). A pre-v2.14 proof counts on the Bench but
  never launches, deploys or hosts: the install link is asked. A shared client has no person: no App link, no
  deploy, no hosting, no coin (the token gate's `login` is null there; the final fix removed `sharedAppProven` and the
  pasted sign-in code it relied on). Deploy caps are per repo owner.
- **Staying true.** The cron's `app_check` step (`appCheckStep`, daily per source, 50 a run) uses `appProofLive`
  through `recheckAppSource`: gone demotes (`app_removed`) and rescores at once. The 90-day org expiry stays for old
  `proof_branch` rows; their re-proof is the App.
- **Readings (A10).** `sources.ts readAll` and `person-score.ts readPersonLive` read App-proven repos with their
  installation token (`readAppRepos`); EarnKit's `GITHUB_TOKEN` reads only what isn't installed. Tokens are minted
  per call, never stored or logged.
- **What discovery still does.** Local git remotes and live URLs are proposed as unproven sources; the
  clue 3 scan covers App-proven repos with `appClient`. `discovery.ts provenLogin` is the App installer's login
  (one across the group). The proof-branch module, the earnkit.txt proof line, owned-repo discovery and the
  x_match / top-contributor clues are gone (tables `proof_branches`, `proof_line_issues` stay, unused). The I1
  private-name rule stays (`page-data.ts safeNames`, `shownProjects`).
- **Copy.** "<name> isn't counted yet."; `OWNERSHIP_FOR_TOKEN`: "A token needs a repo proven yours; EarnKit gives you
  the install link when it needs one."; tell has no `proof` field.

### 5. The ship log

Free: no AI, no new cron, no paid service.

- **Composed every Monday.** `week-facts.ts weeklyFactsStep` (the existing weekly step, now given `ghFetch`) reads,
  for each due project whose repo is a verified `github_app` source and only for a week with a `shipped_code` fact,
  the week's commit and merged-PR titles through `repo-proof.ts appClient` (2 GitHub calls a project).
  `ship-titles.ts` cleans them (pure): no merges, wip, bot authors, version bumps, dependency bumps or duplicates
  (NFKC lower case key); conventional prefixes and a squash `(#N)` stripped; 80 characters; each through
  `update-text.ts checkUpdate` or dropped; at most 3, PRs first, newest first. `upsertWeekFacts(..., titles)` stores
  them on `project_updates.titles` (replaced only by a non-empty list); an error leaves titles empty and the facts
  still written.
- **Private repos: facts only.** A repo that doesn't read public (`repo-public.ts repoReadPublic`) is not read for
  titles until `tell updates { titles: true }` (`updates.ts setShipTitles`, sets `builder_profiles.ship_titles_at`;
  false clears it; needs the main project's own repo App-proven, else `TITLES_NO_APP_NOTE`). An older agent's
  `updates { on, scheduled }` gets `UPDATE_LINES.auto` and changes nothing.
- **Read-time filter (S9, I1).** `ship-titles.ts titlesShown`: a public repo shows all titles; a hidden repo none
  unless `ship_titles_at` is set, and never a title naming the repo. `feed.ts` (`FeedCard.titles`) and
  `bench-data.ts profileData` apply it; turning titles off hides stored titles at once with no delete. A week with
  titles only (no facts, no agent line) stays off the feed. The share card and OG image show no log text.
- **No asks.** The updates yes, the week's-post ask, `WEEKLY_UPDATE_NOTE`, `SCHEDULED_NOTE` and the `updates` /
  `post_update` ask kinds are gone (columns stay). `tell update { text }` stays as the agent's one added line;
  `{ hide }` hides a week; the text filter applies to both. A yes to a stored old ask is answered
  `UPDATE_LINES.auto`.

### 6. Replies

`find` and `score` share `bench-find.ts benchView`, so both answer in the same four states (scoring and clarity R16a:
v2.14's `proven` and `shipping` are one `ranked` state). The copy lives in one table, `bench-reply.ts STATE_COPY`
(plus `VARIANT_COPY`); `benchReply` is pure. Current wording: "the leaderboard" (R9).

| State | When | Stand line | The one link | The one question |
|---|---|---|---|---|
| `signed_out` | not bound to X and a sign-in link can be made | "You're not on the Bench yet." | the sign-in link | "Sign in with X to get your page (one click): <link>" + "Want me to put your work on the Bench once you're in?" |
| `no_project` | signed in, no one project | the same + "Your page: earnkit.com/..." | the repo picker's install link (launch ready L2) | "Install the read-only EarnKit app on the repo you want ranked (one click): <link>" + "Want me to rank it once that's done?" (App off: "What's your GitHub, or a link to something you've made?", the page the link) |
| `not_counted` | a project not confirmed | "<Project> isn't counted yet." | the App install link | "Install the read-only EarnKit app on it (one click): <link>" + "Want me to count it once that's done?" |
| `ranked` | the one project confirmed | the standing line "<name> · #3 of 40 builders · 4 weeks in a row · $X earned" (v3.1 T16: `bench-reply.ts standingLine`; no rank phrase under `RANK_MIN_POOL`; no why sentence) | the page (the weekly moment: the page link in full) | the weekly target (launch ready L5, v3.1 F4: the rank only, e.g. "Ship code this week to pass #2."; plain "Ship code this week." without a rank), or once a week the share ask (L6); never an entry, coin, community round or going live |

- **Variants (A15).** `taken`, `copy`: "Want to use a different project?"; `no_repo`: "Where does <Project> live on
  GitHub?"; `app_off`: one small thing to ship. A taken project still names the open programs (D6).
- **Money always shows**, signed out included; with nothing open: "No program is open right now. I'll look again next week."
- **One link (A14, D5).** The action link is the one https link and the page is named beside it without https;
  otherwise the page is the link. No page to name means no link (a shared client gets zero links).
- **One next step (A16, A17, R8).** States 1 to 3 always ask their fixed question; `ranked` says the weekly target line
  (launch ready L5, `weekly-target.ts weeklyTarget`; v3.1 F4 names the rank, never the points: "Ship code this week to pass
  #2." / "... to move toward #2." / "... to hold #1." / "Done this week."; "Ship code this week." without a rank (under
  `RANK_MIN_POOL`, or no Shipping row); no question), or once a week the share ask (L6). A coin or community round comes only from `tell { token: 'ask' }`. A held question (find's outcome question, else a submission step) replaces
  the state's question, except signed out, where the sign-in question wins (`signedOutNow`).
- **Signed in as.** `attachToX` sets `installations.x_signed_in_unseen`; the first Bench reply after it starts with
  "Signed in as @<handle>." and clears it (`takeSignedIn` clears it only with a handle, so a failed read never eats it).
- **Yeses.** `benchMoveUp` answers `sign_in`, `start`, `install_app`, `other_project`, `repo_behind`, `ship`,
  `suggest`; an open coin offer stays in tools.ts. Stored `build`, `grants`, `grants_later`, `enter`, `coin`, `raise`
  and `go_live` asks are answered "Okay.". `build_offer` still uses the v2.11 short reply (shared clients and pre-profile); the rest of A18
  is an owner question.

### 7. Flags

Retired and deleted with every flag-off path: `EARNKIT_BUILDER_SCORE`, `EARNKIT_BENCH` (`flags-retired.test.ts`: no
source reads either name, the five tools are always listed, `/leaderboard` is a permanent redirect to `/bench`).
`builder-score-flag.ts` keeps `archiveFlag` (SPONSOR_CAMPAIGNS, STARTER_REGISTRY, ...), `xSignInEnabled`,
`RAISING_FLAG` and `raisingEnabled` (`EARNKIT_RAISING === 'on'` alone, the legal switch, off by default).

- **Deleted.** The builder bonus payout side (`bonus-rounds.ts`, `bonus-board.ts`, `bonus-payout.ts`, `/bonus/*`,
  `/admin/bonus/*`, `BonusPill`, `submission-proof.ts`); `bookDeposit` always books to the Safe (`round_key` NULL);
  `lockRound`, `rolloverRound`, `collectNearEnd`, `roundsCovered` and the `rounds` hook are gone. Also the v2.12 and
  v2.12.1 views (`ProfileView`, `ProjectCards`, `LeaderboardView`, `HowItWorks`, `where-you-stand.ts` whose kept parts
  are `stand-text.ts`), `make-countable.ts`, the pickup subsystem, the Bench build offer and tip-jar starter offer,
  `llms/v212.txt`.
- **Kept on purpose.** `bonus-ledger.ts` (indexing, claiming, sweeping), `traction.ts`, `veto.ts` (campaign vetoes only
  after the final fix), `bonusLive` (coins only after the final fix),
  `main-project.ts fillGithubUser`, `ToolContext.repoCoins`.
- **Bugs found while deleting** (both lived in the bonus branch): `recordSubmission` stamps `submission_confirmed_at`
  on `builder_submitted: true`; the `entered` event carries the wallet.
- **Owner step.** Remove `EARNKIT_BUILDER_SCORE` and `EARNKIT_BENCH` from Railway after deploy.

### 8. Tests

- One database per test file (`fixtures/test-guard.ts`, `test-db.ts`); ids and handles keep a per-run suffix.
- Agent-input tests go through the real MCP layer (`fixtures/mcp-call.ts mcpCall`, `tools/call`); `test-foundations.test.ts`
  2.6 enforces it for every `v214-*.test.ts`, 2.7 pins these docs and the runbook.
- Tests that need X set `X_CLIENT_ID=cid`, `X_CLIENT_SECRET=sec`; tests that need the App use `fixtures/app-install.ts
  appEnv()` and `fixtures/fake-github.ts`. No test sets either retired flag.
- v2.14 files: `v214-x-install`, `v214-signin-link`, `v214-app-proof`, `v214-removed`, `v214-ship-log`,
  `v214-replies`, `v214-journey`, `reply-states`, `ship-titles`, `flags-retired`, `fonts`, `schema-rerun`.
- The journey (Task 12, `v214-journey.test.ts`): acceptance 1 to 5 as one brand-new builder lives them, through the real
  routes (authorize, the X callback, token, the App setup URL, `/signin/<code>`) and `mcpCall`: Signed in as @handle then
  no project; the repo named, not counted with the install link; the App on an org repo, on the Bench with a rank and the
  page; the Monday run puts the week's titles on the rendered profile (bots left out, nothing scheduled); a fallback
  client goes signed out, the link page, the paste code through find, signed in. Every reply: one https link, the money
  section, exactly one question and last, never "raise". No network (D3): `globalThis.fetch` throws for the whole file
  and records each attempt (asserted empty), and `fakeGitHub` records `routed` on every call (asserted all true). Keys,
  repo and installation ids carry a per-run suffix (D4: `earnkitai<run>/earnkit`). The daily repo reading is the one
  step faked by a `source_live` row (the reader needs routes the fake doesn't have).

### 9. Env vars and owner go-live

| Variable | Needed for |
|---|---|
| `EARNKIT_URL` | The authorize redirect (`iss`), every public link |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | Hard prerequisite: Sign in with X at install (unset: anonymous install, and the cron alerts `env-missing:<VAR>`) |
| `EARNKIT_AUTH_SECRET` | The fallback link and the signed-out state |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` | Hard prerequisite: the only proof; GitHub App "Redirect on update" on (the cron alerts when unset or the key doesn't parse) |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | Hard prerequisite: the sign-in hop of the App install |
| `EARNKIT_RAISING` | Legal switch for "community round" (off) |

Go-live and rollback are in `v2.14-acceptance-runbook.md`. `app/layout.tsx` loads Funnel Display and Funnel Sans
through `next/font/local` from `app/fonts/*.woff2` (OFL), so a build never fetches Google Fonts; `'fonts'` is a
reserved route.

### 10. Owner questions

- A21: answered 2026-10-23: `/claim/wallet` is linked from the optional wallet step and the change link (v3.1 wallet proof).
- Shared clients (Grok Bot) get no App links and cannot launch coins. Overrule?
- Whether to turn on CIMD for Claude and ChatGPT (preflight).
- Confirm D11: pre-v2.14 agents that reconnect start fresh.
- `build_offer` is still the v2.11 short reply; the rest of A18.
- Lawyer review of "community round" (`EARNKIT_RAISING`), and of the changed terms (`PROFILES_POINTS`).
- Arc and Robinhood Chain brand SVGs.
- The human checks of Task 1 (runbook section 0).

### 11. Final fix (whole-branch review)

- **Terms and agent docs.** `policy.ts PROFILES_POINTS` and `RECORDS_WITH` describe v2.14: the page is made at the X
  sign-in (install, or the one-time link) and public from then on; the same X is the same page (attached with no
  question, nothing merged); the read-only App is the only proof, and App repos (private too) are read with
  short-lived installation tokens never stored; commit and PR titles are stored weekly, a private repo shows facts
  only until titles are on and turning them off hides (never deletes) them; no GitHub login or repo file is proof.
  `llms/v213.txt` and the MCP descriptions say the same. `v214-removed.test.ts` 7.7 refuses "claim", "earnkit.txt",
  "Sign in with GitHub", "proof branch", "only public data" and `signed_in` in all of them (the copy-review 12.1 test
  lets the legal text say "repo" and "commit").
- **Shared clients (Ruling T6-2).** Shared clients never get an App link, so the pasted GitHub sign-in code was dead:
  `signed_in` (tool inputs, aliases, TellInput, LaunchTokenInput, record_submission), `tools.ts sharedLogin`,
  `github-verify.ts callerLogin` and the code helpers (`codeLine`, `formatCode`, `normalizeCode`), the paste code in
  `saveVerification` and the App setup page, `repo-proof.ts sharedAppProven` (and `appProofLive`'s login option),
  `token-gate.ts GateInput.verifiedLogin` (token-launch passes `sharedClient` instead, only to delay keeping a
  wallet), `DeployDeps.callerLogin`, `SIGN_IN_CODE_NOTE` and `EMAIL_SHARED_NOTE` are gone. A shared client keeps no
  memory, no per-builder entries, deadline line or weekly email (`EMAIL_SIGN_IN`: "The weekly email isn't available
  on this agent."), and `tell submitted` / `confirm { project_id }` are noted only. confirm and tell are strict, so
  they still accept an older agent's `signed_in` ("Not used any more; ignored.") and `mcp.ts run` drops it.
- **Dead bonus admin.** `veto.ts` keeps campaign vetoes only (no `round` branch, `bonusVetoKey`, `bonusReviewLink`,
  `vetoBonusEntry`); `pnpm campaign bonus-link` is gone; `cron.ts bonusLive` is true only while an EarnKit coin
  exists (fees to index and claim), so `BONUS_WALLET_UNSET` no longer fires for builder-bonus programs or rounds.
- **Unused exports.** `sources.ts repoOwned`, `oauth.ts authorize()` (tests compose `checkAuthorize` + `issueCode`
  as `authorizeGet` does; `oauth-limits.test.ts` uses the route), `ToolContext.xUserId`. `bindX` stays, marked
  test-only (production binds through `attachToX`).
- **No App link without a page.** `tools.ts list_programs` checks `pageHandle` once before `createVerifyLink`, so an
  anonymous caller's unseen repo never logs an expected refusal as an error.
- **GitHub budget (fix 8).** `source-readers.ts defaultReaderDeps.ghFetch` skips `GH_RUN_CAP` and the rate watch for
  a request with an App credential (`appCredential`: `Bearer ghs_...` or the App JWT), so App reads spend the
  installation's own limit and one installation's headers never stop the run.
- **Hard prerequisites (fix 9).** `cron.ts missingPrerequisites` (`PREREQ_VARS`): each unset X or GitHub App variable
  is a `needs_owner` line `env-missing:<VAR>` (or `env-invalid:GITHUB_APP_PRIVATE_KEY`), alerting, on a full run.
- **Parked minors.** `recordSubmission` writes no `payout_wallet` / `installation_wallets` for a shared client
  (`keepWallet` false); `takeSignedIn` clears only with a handle; `signedOutNow` reads a database error as signed out
  (the retry question); `ship-titles.ts cleanTitle` counts letter and digit code points (a CJK character 2), so
  "修复" survives and "ok" does not; the journey's one-link rule counts bare `earnkit.com/...` links and 12.2 checks
  two distinct own installations.

## Scoring and clarity (Task 1)

Spec: `docs/design-docs-and-implementation-plans/scoring-and-clarity.md` (R1 to R7 as amended by the owner on
2026-10-19 to one Shipping score, R16c to R16e). Branch `scoring-and-clarity`.

- **One score, Shipping, 0 to 100** (`score-v2.ts computeScoreV2`, formula id still `v2`): round(90 x sum(w_i x
  active_i) / 78) + 10 when any live ship exists. i = 0..11 is the ISO week's age (0 = this week), active_i = commits
  that week (the one project's confirmed repo readings, `commit_weeks`), w_i = 12 - i. A live ship is a live site
  (EarnKit-hosted, or a confirmed site on a confirmed repo), a contract deploy (EarnKit's or a verified contract) or
  a published package; a coin is not one. `builder_live.parts` is `{ shipping: { points, raw: { mask, weeks, recent,
  live_ships } } }`, with room for a separate `originality` later (never summed in). `storedShipping` reads it and
  ignores an older row's `shipped`, `used`, `earned` and `consistency` keys. `builder_live.shipped` is the number of
  distinct live ships.
- **People and money are not scored.** `countUse` (the old Used and Earned counting, ring and anti-farming
  included) still fills `builder_projects.people` and `money_usd`; nothing destructive. The review hold keeps the
  30-point jump only, against a ranked history row (`builder_scores.ranked`, written by the cron) of the live
  calibration `v2-shipping` (`score-calibration.ts`) from the last 12 weeks, so the first Shipping day is never a
  jump from a four-part score or from a day the builder was unranked (the first App connect is never held), while
  losing and regaining the rank (the App removed and reinstalled) keeps the ranked baseline and never skips the
  hold (fix round 2). The one-source rule no longer applies.
- **Anti-backdating** (fix round 2; commit dates are the committer's to set):
  1. *Creation floor* (`personInputsV2`): a commit week before the ISO week of the repo's GitHub `created_at`
     (in every reading) never counts, for the score, the grid or the streak.
  2. *No new past weeks* (`sources.ts withPastWeeks`, `withPastCounts`): once a source has a previous good
     reading (daily or live, `previousRepoSignals`), a new reading may add only this week and last week; older
     weeks keep their stored values.
  3. *Server push times* (`sources.ts storedCommits`, `pushedWeeks`, `readPushes`, `firstPushes`; fix rounds 2 to
     5): until a source has a verified reading, each reading makes one activity check: GET
     /repos/{o}/{r}/activity?per_page=100 (newest first; the App's installation client when installed, else
     EarnKit's reader; every call aborted at the connect budget). When that page is full (100 events), one more
     call (`direction=asc&per_page=100`) reads the oldest 100 GitHub keeps (GitHub documents cursor paging, so
     EarnKit reads one page each way). A past week counts when a landing event (push, force push, branch creation,
     PR merge, merge queue merge; the endpoint filters one type a call, so the types are kept client-side) on either
     page is in that week or the next. An unbacked week counts only inside a real gap between two full pages:
     strictly after the oldest page's newest event and strictly before the newest page's oldest event (fix round 5).
     So one old retained push plus a flood never admits backdated weeks, while a busy repo whose events outrun both
     pages keeps its middle weeks. The reading is then `pushes_checked: true` and is rule 2's baseline.
     When EarnKit can't verify (the call failed, listed no landing, the oldest page could not be read, or the
     deadline cut or skipped the check) the reading is stored `pushes_checked: false`: the score counts only its
     last 4 weeks (never zero), it is no rule 2 baseline, and every later read checks again (one check a read)
     until one verifies it. There is no fallback to all weeks (fix round 4). A rename or a new
     ref of the same repo finds the earlier reading (`previousRepoSignals`: the builder's repo sources with the same
     GitHub repo id, else the same owner and created_at), so it never gets a fresh first read.
  Known residual (parked): a dormant repo with 100+ old retained events can, on its first verified reading only,
     get backdated middle weeks counted by pushing them and flooding 100+ events the same day (the gap then spans
     the old events to today). Later readings add only this week and last week. The fix is to follow the Link
     header for a few more activity pages within the connect budget, so real gaps get backed instead of trusted.
  Accepted costs: an imported or recreated repo loses its pre-creation history; a long-lived branch merged after
  the first verified reading keeps its old commit weeks uncounted (only this week and last can be new); a
  contributor who lands work only through fork PRs in a quiet repo gets the merge week, not the commit weeks.
- **Deploy catch-up** (fix round 1): `listedRanked` and `standingOf` count only `builder_live` rows of the live
  calibration, so a four-part row is unranked (and shows no Shipping number) until rescored; `scorePeopleV2` takes
  every live row of an older calibration first, even when today already has a history row, within its deadline.
- **Ranked (R4)** (`rescorePerson`): the one project is confirmed (`bench_confirmed`) and a confirmed repo of it has
  at least one good reading (`ProjectRow.repo_read`, daily or live). No commits ranks at 0. The ring no longer gates
  the rank. A package-only project has no repo reading, so it is unranked.
- **Scored at connect (R5)** (`repo-proof.ts proveByApp`): after the verify, `readPersonLive(..., { only: [the
  source], soft: true })` (each fetch aborted at the 8 s budget by `budgetedFetch`) reads the proved repo once with the installation token (the refresh's reader, which writes
  `commit_weeks` and `commit_counts`), then rescores. `only` reads even inside the 10-minute guard; `soft` writes
  nothing on a failure, so the proof stands, an earlier good reading still counts and the next refresh reads it.
- **Rank line (R6, R16d)** (`rank.ts rankLine`, the only rank phrase helper): under 20 ranked, "#N of M builders this
  week" ("#1 of 1 builder this week"); from 20, "Top P% of builders this week" in the top half and "#N of M builders
  this week" for the rest. A chain names itself ("#2 of 12 builders on Arc this week") and shows from one ranked
  project (R16e; the leaderboard's chain chips too, `CHAIN_CHIP_MIN` is gone). Numbers carry thousands separators. `rankWords` and `benchRank` are gone;
  `stand-text.ts standingNews` says "You moved up to <rank line>." and no longer reports new people.
- **Score line (R16c)** (`rank.ts scoreLine`): "Shipping 72 · #3 of 40 builders this week". `bench-rank.ts rankLines`
  returns `{ bench (the rank line), line (the score line), chains }`. Used by the profile header (screen reader line),
  the MCP ranked stand line ("EarnKit: Shipping 72 · ... ." via `bench-reply.ts shippingStand`), the card and share
  text (`benchCardFacts.bench`) and the page meta (`handle-view.tsx`).
- **Why sentence (R7)** (`score-v2.ts scoreWhy`, pure): "Code in 7 of the last 12 weeks, 3 of the last 4. Ship code
  this week to add up to 14 points." The points are what an active week adds by the formula: this week while it has
  none, else next week over next week without code. `raw.monday` dates the mask, and `scoreWhy(parts, now)` shifts it
  by the weeks since, so an older row never calls last week "this week". Shown under the profile's rank and under the ranked stand line
  in find and score (`BenchView.why`, one statement, never a question).
- **Profile** (`app/[handle]/BenchProfileView.tsx`, on PR #46's look): one hero ring (`ScoreRing`, caption
  "Shipping", label "Shipping N of 100") beside the rank, its words and the why; no per-part rings (`ScoreParts.tsx`
  is gone; `SURFACE` lives in `score-colors.ts`, whose hue families now tint facts: `ship`, `weeks`, `wins`). The
  Project tab shows no people or money.
- **Chips** (`week-facts.ts factChips`): Went live, Won X, N commits, N weeks in a row. No "+N people", "$ earned"
  or "Community round" chip (the facts stay stored); `startedChips` drops "people use it"; `hasFacts` counts code,
  going live and wins only.
- **Tests:** `score-v2.test.ts` (formula, edge cases, why, stored rows), `rank.test.ts`, `person-score.test.ts` 4.2b
  (ranked rule) and 4.15c (hold baseline), `v214-app-proof.test.ts` 6.2b and 6.2c (scored at connect, fail soft).
  `fixtures/fake-github.ts` answers the reading's GraphQL query and an org repo's contributors.


## Scoring and clarity (Task 2): Originality

Spec: R3 of `docs/design-docs-and-implementation-plans/scoring-and-clarity.md`, as the Task 2 brief made it concrete.

- **What it is.** A separate 0 to 100 value per main project (`originality.ts`), shown next to Shipping and never
  ranked, summed or held. It is not stored in `builder_live.parts` (rescorePerson owns that); it lives in
  `project_embeddings` and is read by `readOriginality(builderId, key)`.
- **Text and model.** The text is the project's description (`builder_projects.what` plus GitHub's description from the
  newest good repo reading, each once) followed by the README (GET /repos/{key}/readme with the App's installation
  client, `repo-proof.ts appClient`; at most 64 KB decoded, cut to 4,000 characters before any pattern runs, then
  markdown stripped with patterns that never backtrack across lines; a 200 KB pathological input strips in milliseconds). MiniLM reads about 512 tokens, so the
  description goes first. The model is `Xenova/all-MiniLM-L6-v2`, quantized (q8), through `@huggingface/transformers`
  (in the worker, see fix round 2): mean pooling, normalized, 384 numbers. It loads in the child process, after a one-time
  download of about 23 MB from Hugging Face into `EARNKIT_MODEL_DIR` (default `<os tmpdir>/earnkit-models`). There is no
  API key and no paid service.
  Fix round 2: the model never loads in the web process. `workerEmbed` spawns `lib/earnkit/embed-worker.mjs` (plain
  ESM, no app imports) with `process.execPath`, once a step, for every changed text plus the known ideas not yet cached:
  texts as JSON on stdin, vectors as JSON on stdout, then it exits. The worker embeds in batches of 4 (one big batch
  pads every text to 512 tokens and peaked at 2.5 GB; batches of 4 peak at about 440 MB for about a second). The child
  gets only PATH, HOME, temp and proxy variables and EARNKIT_MODEL_DIR, never the app's secrets. It is killed (SIGKILL)
  at the run's deadline (`EmbedDeadline`); a nonzero exit or bad output rejects, and nothing is written or stamped, so
  the projects are due again next hour. The script is found from `process.cwd()` (`next start` runs in apps/frontend;
  tests run from the repo root) or `EARNKIT_EMBED_WORKER`; `next start` is not standalone, so the file and
  node_modules are on disk (the build's trace lists it too). Each project is written as soon as the vectors are back;
  one write failure is logged and the others continue. `boundedEmbed` still bounds an injected embedder. A 404 README (`appClient`'s `on404`) is ''
  and re-embeds from the description alone; a failed read is null and keeps the vector. The repo-root `.npmrc` sets
  `onnxruntime-node-install=skip` (read by its postinstall as `npm_config_onnxruntime_node_install`), so a linux x64
  install never downloads the CUDA binaries from NuGet.
- **When.** A step in the hourly cron (`builder-score.ts runScoreSteps`, `originality`, after `empty`), never in a
  request. `originalityStep` only runs while the App is on. A project is due when its main project is Bench-confirmed
  with an App-proven repo of the same key, and one of these holds: it has no row; its row belongs to another builder
  (that row is dropped); its description hash changed; it has a vector but the README was not checked in 7 days; or it
  has no vector and was last tried over 6 hours ago. At most 20 projects a run, inside the run's deadline. The text hash
  (sha256 of the model name and the text) decides: the same text is never embedded again. A README read that fails
  while the description stayed the same keeps the vector. So a new project gets Originality within an hour.
- **Score.** maxSim is the highest cosine similarity against every other builder's stored project vector (the
  builder's own projects are left out) and every known idea. Originality = clamp(round(100 x (0.9 - maxSim) / (0.9 -
  0.35)), 0, 100): 0.35 or lower gives 100, 0.9 or higher gives 0. Known ideas are in `programs/ideas/known-ideas.json`
  (62 generic public ideas). It sits in a subfolder because programs-sync treats every `programs/*.json` as a program.
  The ideas are embedded once and cached in `known_idea_embeddings` (keyed by text hash). Cosine runs in JS, with no
  pgvector. After the changed projects are written, any other project is recomputed in the same step when a changed
  vector would enter its top 3, or when its nearest list named a changed project. So an earlier project drops when a
  near copy arrives, and recovers when that copy moves away.
- **Privacy.** The text is never stored. Only `text_hash`, `desc_hash`, the vector, the score and `nearest` (top 3) are
  kept. `nearest` holds `{ kind: 'project', key, similarity }` (other projects by key, never a name or text) or
  `{ kind: 'idea', title, similarity }`, and nothing renders it. `events-redact.mts` lists `project_embeddings.project_key`,
  deletes the person's rows with `--apply`, and empties other rows' nearest lists that name the login's repos. The terms
  (`policy.ts PROFILES_POINTS`) say so.
- **Shown.** On the profile, one small line under the Shipping ring ("Originality 72"; `bench-data.ts profileData.originality`,
  only while the score shows). It was appended to the ranked stand line in find and score replies until v3.1 F4
  (`bench-reply.ts originalityWords` stays exported, unused by the reply). It is not shown on the feed, the
  leaderboard or the card.
- **Tests.** `originality.test.ts` covers the pure formula, the text and the nearest list. It runs the step with a fake
  embedder through the real App connect: a later near copy lowers the earlier project, the same text is not embedded
  again, a description change is due at once, and a failed README read keeps the vector. It also covers privacy and the
  profile and reply lines. The test guard sets `EARNKIT_EMBED_OFF=1`, so no test spawns the model worker (O7d runs fake worker scripts). The one real-model
  test runs only with `EARNKIT_MODEL_TEST=1`, which also lifts the network guard for the download.

## Scoring and clarity (Task 2b): Backfill on connect

Spec: R13 of `docs/design-docs-and-implementation-plans/scoring-and-clarity.md`.

- **One per-week body.** `week-facts.ts writeWeek(project, monday, now, deps)` is what the weekly job did per project:
  `weekFactsFor`, `weekTitles` for a week with shipped code, `upsertWeekFacts` with `facts.checked`, then one dated
  event per fact (dedupe key `<type>:<project_key>:<week>`). `weeklyFactsStep` calls it with `{ ghFetch }` only, so
  its rows are unchanged apart from the shared week rule below. The backfill passes two more options: `deadline`
  (titles only before it) and `mark` (a completed titles read is stamped `facts.titles_read`: a titles call on the
  repo, GET /repos/{key} or its commits and pulls, answered ok and none failed; a null token with no such call is not
  completed).
- **At connect.** `repo-proof.ts proveByApp` notes inside its transaction whether this is the builder's first App proof
  of the source (its proof was not `github_app` before; a re-prove after a removal keeps `github_app`, so it doesn't
  count). After the connect read and the rescore, a first proof calls `backfillOnConnect`, which acts only when the
  repo is the confirmed one project (shared clients never). `backfillWeeks` writes the 3 most recent finished weeks
  (`backfillMondays`: lastFinishedMonday and the 2 before it), newest first, from the reading just taken, with the same
  deadline and `budgetedFetch` as the connect read. Facts are database work. Titles cost 2 GETs a week (commits and pulls), plus the
  installation lookup and token mint, plus one GET /repos for a repo not read public lately. They are fetched only
  while the budget lasts.
- **Anti-backdating.** Facts come from the newest good repo reading (`weekFactsFor`'s). Nothing is written while that
  reading is unverified (`pushes_checked: false`), or when there is no reading at all. Fix round 1: one week rule for
  both the weekly job and the backfill, inside `weekFactsFor`: a week gets `shipped_code` from `commit_counts` only
  when `person-score.ts weekCounts` passes (at or after the repo's creation week; an unverified reading, its last 4
  weeks; a verified reading's counts are already push-backed by `storedCommits`). It never reads `commit_weeks`
  membership, since GitHub's stats endpoint can lag (202 gives []). `countedCommitWeeks` (the score) uses the same
  `weekCounts`. A week before the repo existed gets a checked row with no commit fact.
- **No commits, no card.** As in the weekly job, a finished week with no commits gets a `{ checked: true }` row and no
  card (`bench-data.ts logCards` shows a week only with text, titles or facts). The Started card is a different week and
  stays.
- **Catch-up.** `backfillStep` is the cron step `backfill`, right after `weekly` (`builder-score.ts runScoreSteps`). It
  picks Bench-confirmed one projects with an App-proven repo of the same key and a good verified reading, where one
  of the backfill weeks has no row, or has a checked row with shipped code, no titles and no `titles_read`. A week
  another builder's row holds is never due. The step takes at most `BACKFILL_PER_RUN` (20) projects a run, inside the
  deadline. Each project is tried at most `BACKFILL_TRIES_A_DAY` (3) times a UTC day (`rate_windows` key
  `backfill:<id>`), so a repo whose titles keep failing can't take every run's slots. On a Monday before
  `WEEKLY_HOUR_UTC`, the newest week is left to the weekly job.
- **Idempotent.** The guards are `UNIQUE(project_key, week)` (the upsert merges facts and keeps stored titles unless new
  ones come), `facts.checked` and `titles_read` (a done week is skipped), and the event dedupe keys. Running the
  connect or the catch-up again writes no new rows, events or titles.
- **Private repos.** Titles follow `weekTitles`' existing rule. A private repo with titles off reads no commits or
  pulls (one GET /repos check), so it gets facts only. That read counts as completed, so `titles_read` is set and the
  catch-up doesn't come back. Turning titles on (`updates.ts setShipTitles`) clears `titles_read` on the backfill
  weeks' rows that have no titles, so the catch-up reads them once.
- **Tests.** `backfill.test.ts` covers these cases through the real App connect:
  - 3 rows in the weekly job's format: the newest row equals `weeklyFactsStep`'s apart from `titles_read`.
  - A re-prove, the backfill and the catch-up run again: no duplicates.
  - A week without commits gets no card.
  - A private repo gets facts only.
  - Titles cut at connect: the catch-up fills them once.
  - No budget at connect: the catch-up writes all 3 weeks.
  - The creation floor holds, and an unverified reading waits until a read verifies it.

  `v214-ship-log.test.ts provenPerson` drops the rows the connect backfilled, so those tests drive the weekly step
  alone.


## Scoring and clarity (Task 2c): Stop the unused reads

Spec: R16b of `docs/design-docs-and-implementation-plans/scoring-and-clarity.md`. No score uses stars, forks, users,
traction or money any more, so EarnKit stops reading and counting them. Program wins stay as facts.

- **GitHub.** `person-github.ts REPO_FIELDS` no longer asks for `stargazerCount forkCount stargazers(last: 10) forks(first: 10)`.
  The same one call per 25 repos remains, but each repo no longer pulls up to 20 star and fork nodes and their account
  ages. `repoFrom` writes `stargazers: [], forkers: [], partial: false` (old readings keep theirs, unread). An
  organization's repo no longer reads `/contributors` (one REST call each, daily and in `readAppRepos`; it fed only the
  org-member rule of people counting).
- **Sources not read.** `sources.ts dueSources` and `person-score.ts readPersonLive` skip `contract`, `coin` and
  `merged_pr` sources. Those reads (Blockscout pages of a contract's callers and a coin's transfers, the native price,
  Arc logs and senders, a merged PR's target stars and the PR) fed only Used and Earned. The refresh no longer reads
  proposed contracts for "past users" (it fed `untracked_contract`, now always NULL, so stand-view's "count past users"
  step never fires). A confirmed contract is still a live ship without a reading. Sites, packages and repos are read as
  before; the push check (anti-backdating), originality, titles and matching keep their own reads.
- **Code removed.** `source-readers.ts readRepo`, `knownAges`, `readContract`, `readCoin`, `readMergedPrs`, the
  `ReaderDeps` fields `baseTxs`, `tokenTransfers`, `arcLogs`, `arcHead`, `arcSender`, `usdPerNative`; `sources.ts readPr`
  and `prRef`; `score-v2.ts countUse` (and `fade`); `builder-score.ts scoreContext`, `ringEdges`, `verifiedProject`;
  `person-score.ts` ring storage (`storedRing`, `ringToJson`, `ownersOf`). `traction.ts` (the token builder bonus) and the
  fee and token code are untouched.
- **No counting.** `personInputsV2(id, now, db, { scope })` returns `{ input: { ships, commitWeeks }, projects, shipWeeks,
  chains }`: no touches, people, money, ring, `perSource` or `newPeople`, and it no longer queries token fees, prizes or
  wallets. `rescorePerson(id, now, { cron })` takes the cron flag instead of a ring (the cron still rescores a newer row
  at its own time); `scorePeopleV2` no longer loads everyone's accounts and edges. Columns stay (nothing destructive):
  `builder_projects.people`, `people_week`, `money_usd` are written 0, `tagged` false, `untracked_contract` NULL,
  `builder_live.people` 0, and `builder_profiles.ring` is no longer written (old values stay, unread).
- **Ship log and feed.** `week-facts.ts weekFactsFor` no longer writes `users_up` or `earned` (and no longer runs a whole
  `personInputsV2` per project and week); `won` stays. `feed.ts pointsOf` counts went live 40, a win 40, commits 10,
  the streak up to 10; an old row's people and money count nothing; ties go to the builder's Shipping score (the
  existing `l.score DESC`). `bench-data.ts bestFact` never says "N people this week".
- **Matching.** `prepare` no longer passes `verified` (counted users and money) to matching, so odds use matching's own
  facts (tx count, live, commits). `MatchDeps.verified` stays in the matching API, unused by EarnKit's own calls.
- **Calls saved (read-cost.test.ts).** One person with a repo, an organization's repo, a site, an npm package, a
  verified Base contract, a coin, a merged PR and a proposed contract, each read answering one page:

  | | before | after |
  |---|---|---|
  | daily read: GitHub | 6 (1 GraphQL, 2 push checks, 1 contributors, 2 PR) | 3 (1 GraphQL, 2 push checks) |
  | daily read: Blockscout and price | 3 | 0 |
  | daily read: total | 11 | 5 |
  | refresh: GitHub | 3 | 3 |
  | refresh: Blockscout and price | 6 | 0 |
  | refresh: total | 11 | 5 |

  These are floors: a busy contract or coin read up to 20 Blockscout pages a day, and an Arc contract up to 200
  senders (two RPC calls each). The push checks happen only until a repo's reading is verified.

## Scoring and clarity (Task 3): The leaderboard and consistent messages

Spec: R6, R9, R10, R11 and R17 of `docs/design-docs-and-implementation-plans/scoring-and-clarity.md`.

- **The leaderboard (R9).** Every user-visible "the Bench" now says "the leaderboard" ("Leaderboard" as a title):
  the page h1 and metadata, the slim top bar and the brand page nav, the landing (Hero, BenchTop, BenchHowItWorks,
  UpdateCarousel), the feed ("This week on the leaderboard"), the profile's confirming card, the reply copy
  (`bench-reply.ts NOT_ON_BENCH`, the sign-in ask, `VARIANT_COPY.taken`), `tools.ts BUILD_BRANCH_TAKEN_NOTE`,
  `llms/v213.txt` and the terms (`policy.ts`). Internal identifiers (`bench_*`, `benchView`, `BENCH_*`, `BenchRow`,
  DB columns, test names) stay. `leaderboard-clarity.test.ts` scans `app/` and `lib/` (comments stripped) and fails on
  the word "Bench" on its own or a `/bench` link.
- **Routes.** `app/leaderboard/` holds the page (moved from `app/bench/`: page, BenchView, BenchRowItem, FilterChip,
  bench-load). `app/bench/page.tsx` is `permanentRedirect('/leaderboard')` (308). `filterHref` builds
  `/leaderboard?...`; the sitemap lists `/leaderboard`. `bench` stays a reserved handle.
- **Points column (R17).** `BenchRow.points` is the builder's `builder_live.score` (Shipping, 0 to 100).
  `BenchRowItem` shows it as a compact tabular column ("72" over a small "Shipping") before the rank, and the rank as
  `rank.ts rankSplit` of the row's `rankLine` (the number large, "of 40 builders this week" small), so the row reads
  the same rank words as everywhere else (R6). `rankSplit` moved from the profile into `rank.ts` and now reads
  thousands separators ("#1,204").
- **No rank unless ranked (R10).**
  - `bench-rank.ts rankLines` returns no rank, score line or chain lines unless the one project counts as confirmed
    now (`benchConfirmedSql`, read live). `builder_live.ranked` is only refreshed at a rescore, so before this a
    project whose proof went showed its old rank beside "isn't counted yet" on the profile, the card and the page meta.
  - `bench-reply.ts rankedState(state)`: only the ranked state (then `proven` and `shipping`, merged in Task 4) shows a rank. `bench-find.ts benchView` sets
    `rank_lines` to `[]` and `view.rank` to null in every other state (a signed-out or anonymous ranked row once
    carried "#1 of 1" under "You're not on the leaderboard yet.").
  - The move-up news ("Since you last checked: You moved up to ...") shows only when the reply shows a rank. It is
    still taken and recorded otherwise, so it never comes back later as stale news.
  - The profile's confirming card never shows a rank beside it.
  - Each reply has one status line and one next step (one question). `leaderboard-clarity.test.ts` checks every reply
    it makes through `mcpCall`.
- **Names never cut (R11).**
  - Tickers: `token-proposal.ts TICKER_SHAPE` is `^[A-Z0-9]{3,10}$`. `TICKER_MAX` 10 is tokens.fun's own limit ("Token
    symbol must be 10 characters or less"), the longest a launch accepts. Nothing else in the code (no DB CHECK, no
    contract) limits the length. `tickerCandidates` gives the whole first word when it is 3 to 10 letters ("EarnKit"
    gives EARNKIT), else the initials of 3+ words, then numbered variants (the first 9 letters plus a digit).
    `initialsCandidates` caps at 10. The token-image route uses `TICKER_SHAPE`, and the launch note says "3 to 10".
    EARNKIT itself stays reserved as a brand (refused whole, never shortened).
  - Token names: `proposeToken` no longer cuts the project name to 50. An over-long name fails `cleanTokenName` and
    the next candidate is used; "<name> Token" is offered only when it fits.
  - Project names: identity names keep up to 60 characters (`identity-input.ts NAME_MAX`, was 40) and whole words
    (`untrusted-text.ts wholeWords`). `person-score.ts` uses the same rule for the stored name.
  - CSS: `truncate` is gone from names and projects in leaderboard rows, update cards and the profile header; they
    wrap (`break-words`). The square carousel's update text keeps its 3-line clamp, since it is body text, not a name.

## Scoring and clarity (Task 4): Move up, funding matches, four states

Spec: R8, R12 and R16a of `docs/design-docs-and-implementation-plans/scoring-and-clarity.md`, plus the Task 3 review's
carry-overs. Owner rule: no token, coin or community round step in find or score; moving up is shipping more and
ranking higher.

- **Four reply states (R16a).** `bench-reply.ts ReplyState` is `signed_out | no_project | not_counted | ranked`;
  proven and shipping merged into `ranked` (the streak lives in the Shipping score, so the stand line is the score
  line alone; the reply still carries `streak`). `STATE_COPY` is the one copy table: each state has one stand line
  and one next step (`stateAsk`, now total). `rankedState` is `state === 'ranked'`.
- **Move up (R8).** The ranked state's one next step was "Ship this week to climb." (`SHIP_STEP`, ask kind
  `ship`); since launch ready L5 it is the weekly target line (`SHIP_STEP` only without a Shipping row). It is a statement, so a ranked reply has no question at all; its `move_up.agent_note` is
  `bench-find.ts SHIP_STEP_NOTE` (a yes: one small, real thing to ship this week from the repo). A `tell move_up
  { kind: 'ship', answer: 'yes' }` returns `SHIP_NOTE` once. The other states keep their steps (sign in, name a repo,
  install the App; app_off keeps "Want me to suggest one small thing to ship...", kind `suggest`).
  - Gone from the default path: the entry ask (`enterAsk`), the coin and community round (`coinAskBench`,
    `raising.ts raiseAsk/markRaiseAsked`, `offerCoin` from find), going live (`goLiveAsk`, and `tools.ts goLiveYes`
    with its notes, now unreachable), `nextStepAsk`. Programs show only in "Ways to get funded" (find still returns
    `lead` with `EARN_NOTE` for a builder who picks one). An ask an older reply stored (`enter`, `coin`, `raise`,
    `go_live`) is a retired kind: a yes is "Okay.".
  - **A token only when asked.** `tell { token: 'ask' }` (tools.ts `TellToolInput`, mcp.ts tell schema and
    description: "only when they ask about a token") runs `bench-find.ts tokenAsk`: for the confirmed one project, a
    launched coin not shown yet is the community-round line (`showRaisingLine`, EARNKIT_RAISING on; its yes is `tell
    coin { raising: true }`); a coin out or launching says so; an open offer is shown again (`coin-moments.ts
    openCoinLine`); else Backing's offer (`backingOffer`, after the first approved week with code). Not confirmed:
    `TOKEN_NOT_YET`; nothing offerable (EARNKIT_RAISING off, since confirm is only registered with it on: v3.1 final
    fix 1; launches off, declines, a private repo): `tokenUnavailable`. The yes is `tell coin` as before, then `confirm
    { project_id }`; `confirm` and `launch` are unchanged; the build path no longer offers a coin (fix round 1).
- **One fit order (fix round 1).** find and score name the same fits in the same order: `present.ts byDeadline`
  (the soonest `ends_at` first, rolling last, then the bigger `max_award_usd`, then the id). find sorts its qualifying
  rows with it before taking 3, so `lead` and `recordShown` use those same 3; `scoreFits` sorts with it too.
- **No coin on the build path (fix round 1).** v2.12.1's built_live moment is gone: `coin-moments.ts coinPitchAllowed`
  allows only the coin program's own entry (an accepted offer), so a build entry's prepare and confirm never pitch or
  launch a token (`BUILD_ENTRY_NO_TOKEN_NOTE`, the live reply ends "Ready to submit?"). `showBuiltLive`,
  `builtLiveAnswer`, `BUILD_COIN_NOTE` and tools.ts `buildEntryKey` were removed. The `built_live` moment type stays for
  old rows. prepare's description says "the confirm line (no token unless the builder asked for a coin)".
- **Closed programs keep results tracking.** `outcomes.ts outcomeToAsk` reads `results.expected`, never `status`, and
  `syncOutcomeFile` labels a closed program's entries; `programs/README.md` says closing keeps the results check until
  results land (arc-microgrants: results expected 2026-10-21). `outcomes.test.ts` covers it.
- **Funding matches (R12).** "Ways to get funded" names at most 3 programs the matcher fits, each as `fitsLine`:
  "<title>: <award>, <closes Oct 30 | rolling>. <why>." (`stand-view.ts fundWhen`). The why is `bench-find.ts fitWhy`
  from the matcher's facts: the program's chain where the repo has a deployed contract ("You deployed on Base"), a
  deploy config naming its mainnet ("You deploy to Arc"), else code for it ("You build for Monad"); "It takes any
  chain"; and "your app is live" for a program that needs a live product. The words avoid "contract" and "repo" (the
  v2.12.1 copy rule); the chain phrases are allowed in `fixtures/banned-words.ts BENCH_PITCH_ALLOWED`.
  - find: `layout` rows that `qualifies` (good odds) for the one repo, their facts from the match. score:
    `stand-view.ts scoreFits`, the open programs (byDeadline) whose `alerts.ts repoCanWin` passes for the one repo as
    find last matched it (`installations.fit_repos`), at most `FITS_MAX` 3 (it used to name one).
  - A ranked project gets only fits: no open-all-year pick (`rollingPick` is gone) and no "what it needs" lines;
    with none it says `noFitLine` ("No open program fits Kit yet. I'll look again next week."). Not counted, no project
    and taken keep `needsPicks` and the no-project idea as before.
  - Closed programs never show: `listPrograms` filters `status = 'active'`, and arc-microgrants,
    colosseum-worlds-fair and monad-metropolis are `"status": "closed"` in `programs/` (past their deadlines).
- **Dead code removed.** `stand-view.ts`: the projects read in `standBase` (and its count-past and tip-jar steps,
  `tipsPick`, `TIPJAR`, `hostFor`, `declinedNow`, `DECLINE_MS`), `scoreEarn`, `moneyFallback`, `rollingPick`,
  `byLazy`; `StandBase` is now `{ standing, claimed, handle, signInLink }`. `stand-text.ts`: the step, project, view
  and money-line types and helpers. `person-score.ts trackingHeld`. `week-facts.ts`: the users_up event branch
  (R16b never sets the fact). `score-tool.ts`/`benchScore` no longer take `fresh`, and `benchFind` no `agentCanBuild`.
- **Carry-overs from Task 3.** `token-proposal.ts tickerCandidates`: a first word over 10 letters gives its first 10
  ("Recipeplanner" is RECIPEPLAN), never 3-letter initials first. EarnKit's own brand is allowed only on verified
  ownership (fix round 1): `OwnBrand { ownEarnkit }` on `tickerProblem`, `cleanTokenName`, `tokenNameProblem`,
  `proposeToken`, and `token-launch.ts decideToken`/`editsOf`/`storedProposal`, default false. `own-brand.ts
  earnkitOwnRepo(id, repoUrl)` sets it: the repo's owner (campaigns.ts githubRepo, so http://, www. and .git forms
  read the same) is an EarnKit org (`earnkit-orgs.ts`, "earnkitai") AND the repo is a `github_app`-proven, verified
  source of this builder. `runTokenFlow` computes it once (`TokenFlowDeps.ownEarnkit` for tests); coin offers
  (`offerCoin`, `openCoinLine`, `coinYes`) compute it too; prepare's proposal never sets it. A link alone never
  gives $EARNKIT; every other brand stays reserved. `untrusted-text.ts
  wholeWords` never ends a cut on a comma, dash, colon or the like. `app/bench/page.tsx` redirects (308) to
  `/leaderboard` with the same query string. The stale reserved-ticker comment in `tickerProblem` is fixed.
- **Tests.** `move-up.test.ts` (through `mcpCall`): the ranked find and score replies (score line, why, at most 3 fit
  lines with deadline and why, "Ship this week to climb.", no coin words, closed programs never shown), `tell token`
  returning the offer (and find and score staying clean with it open), the four states' copy and steps, and a positive
  real-matcher fit (transactions, a live link and commits on Base and Arc give good-odds fits; a low-odds repo none).
  `reply-states`, `bench-reply`, `coin-moments`, `raising`, `v213-*`, `v2131-*`, `v2133-owner-test` and `v214-*` tests
  were updated for R8, R12 and R16a.

### Scoring and clarity: page shells and lint (R14, R15)

- Every sign-in and verify response is `brand-page.ts brandShell` (dark page, slim top bar): the GitHub verify and App setup pages (their 404 is `notFoundPage`), `signinPage` (X sign-in, the `/x/callback` 404), the OAuth authorize 429 and 400 (status and Retry-After kept), and the wallet 405 (frame-ancestors CSP kept). Redirects and the wallet POST JSON are unchanged. `page-shells.test.ts` asserts text/html plus the top bar for each.
- `pnpm lint` runs `eslint .` in `apps/frontend` (flat config, `eslint-config-next` 16.1.5; `.next/` and other build output ignored; `_`-prefixed unused names allowed). It exits 0.

## Scoring and clarity (Task 5b): One design system, a simpler site (R18)

- **One set of tokens.** `lib/earnkit/theme.ts THEME` is the source of truth for the page, the card
  surface, hairlines and the three text roles. `app/globals.css` defines them as `--ek-p-*` (tested to
  match) and sets the deep navy page with its top glow on `body`, so every page has it.
  `tailwind.config.ts` reads them as `ek-page`, `ek-surface`, `ek-surface-top`, `ek-raised`, `ek-chip`,
  `ek-line`, `ek-line-strong`, `ek-text`, `ek-body`, `ek-muted`, `ek-accent`. The brand palette (`ek-blue-*`,
  `ek-navy`, ...) stays; `ek-blue-bright` is the one primary button color (React and `brand-page.ts`).
  The `.ek-premium` / `data-ek-premium` scoping and `SlimTopBar` are gone.
- **Shared parts.** `Panel.tsx`: `SURFACE` (24px radius, hairline border, the surface gradient), `COLUMN`
  (max-w-6xl, 16px gutter, 32px from md), `H1`, `H2`, `LEDE`, `Panel`. `Button.tsx`: `BTN_PRIMARY`,
  `BTN_SECONDARY`. `Header.tsx` is the one sticky header (layout.tsx); `Footer.tsx` is one quiet row.
  `UpdateCard` draws its own surface and the hue dot on its first chip (no CSS overrides).
- **Simpler pages.** Landing: hero (no coins, no community round), leaderboard top 10 (no chips), "Shipped
  this week", "Money open now" (no button; each card opens its guide), Backed by. How it works removed.
  Leaderboard: title, one line, chips, one card of rows. Feed: "What builders shipped". Profile: no
  eyebrows; the Ship log cards sit on the page (no card in a card). Guide: one Ask your agent, the parts
  on one card split by hairlines. Terms: the same column and surface. brandShell: no accent bar, header
  as wide as the React one.
- Dead code removed: Positioning, EcosystemHero, BuilderBanner, CampaignTypes, EcosystemValue, FinalCta,
  CoinsField, ViewportHeightSetter, the unused globals.css classes.

### Task 5b fix round 1

- Leaderboard rows show "#N" alone (the full rank line in an sr-only span); `BenchTop.tsx benchLine` is the one
  header line ("N builders this week. Ranked by Shipping points.") on /leaderboard and under the landing's title,
  from `Landing['bench'].count` (every ranked builder). The landing cache key moved to `landing-r18`.
- The profile grid reads `builder_projects.commit_weeks` (new column, written by `rescorePerson` from the counted
  repo commit weeks, the same floor as the score) plus checked `shipped_code` weeks (`bench-data.ts gridWeeks`);
  `ship_weeks` (commits, deploys, sites) still drives the week facts' streak chip (the stored streak is commit
  weeks since the final follow-ups, below).
- Colors: #46's `PART_COLORS` (score-colors.ts) stay as the profile's accent palette (owner); UpdateCard's chip dot
  reads them. THEME gained `brand` (#579DFF), the primary button in React and brand-page.ts; Tailwind keeps only
  `ek-blue-bright`, `ek-blue-soft`, `ek-score-orange` and the page tokens (plus `ek-glass` for the header).
  framer-motion removed. `apps/frontend/DESIGN.md` rewritten for R18.

### Final follow-ups

- Streak vs grid: `builder_projects.streak` is `streakOf(commit weeks)` (the counted repo commit weeks, same
  anti-backdating rule as the score and the grid), so the leaderboard's "Shipping every week" filter (streak 4+),
  the card and the reply read commit weeks. The profile's "N weeks in a row" is `streakOf` over the grid's own
  weeks (`bench-data.ts profileData`), so the header never contradicts the grid.
- One rank pool: `benchPool` moved to `person-score.ts` (re-exported from `bench-rank.ts`); `standingOf` ranks and
  counts over it (listed, ranked, the one project confirmed now), so every "#N of M" matches the leaderboard
  header's "M builders this week". A ranked person outside the pool is still counted in for their own reply.
- `mcp.ts SCORE_DESCRIPTION` names the Shipping score and says every ranked builder sees a rank.
- `BenchRowItem` has fixed-width points and rank columns (`grid-cols-[auto_minmax(0,1fr)_3.25rem_3rem]`), so rows
  line up from #1 to #100.

## Launch ready (Task 1): installs, the badge, funnel numbers, hotfix carry-overs

Design doc: `docs/design-docs-and-implementation-plans/launch-ready.md` (rulings L1, L3, L8, L9).

- **L1 installs.** Claude Code's line is `claude mcp add --transport http --scope user earnkit https://earnkit.com/mcp`
  everywhere (the modal `AddToAgent.tsx AGENTS`, README, `llms/v213.txt`), then `/mcp`, pick earnkit, Authenticate.
  One-click links only where the agent documents one: Cursor's
  `cursor://anysphere.cursor-deeplink/mcp/install?name=earnkit&config=<url-encoded base64 of {"url": ...}>`, the
  first thing in its tab. No other agent gets a made-up link.
- **L3.** The leaderboard's "Community round" chip is gone: `bench-data.ts BenchFilter` is `{ chain, weekly }` (at
  most 8 variants); an old `?raising=1` link shows the unfiltered board. The coin pill on a row still follows
  `EARNKIT_RAISING` (the bench cache key still carries it).
- **L8 README badge.** `GET /badge/<handle>.svg` (`app/badge/[file]/route.ts` over `badge.ts badgeFor`): "EarnKit |
  Shipping 72 · #3" (or "· Top 4%"), shields-like, navy label, `#579DFF` value, text XML-escaped. The value is the
  profile header's (`page-data.ts personFacts`): a rank only inside the pool, never a bare score, so outside it
  "not ranked". Unknown, unclaimed or hidden: "EarnKit | not found", answered 200 (owner ruling, fix round 1: GitHub's
  image proxy shows it in a README). Another case or a rename serves the same person's badge. `Cache-Control`
  `public, max-age=3600, s-maxage=3600` (not found: 600); the read itself is `unstable_cache`d per file for an hour
  under `PROFILE_TAG` (`app/badge/[file]/badge-load.ts`). `IMAGE_CSP` on
  `/badge/:file` (next.config.ts). `badge` is in `RESERVED_ROUTES`. The profile (`BenchProfileView`, under the
  sources line, for everyone: the owner can't be told from a visitor on the web) shows "Add the badge to your
  README", the markdown `[![EarnKit](https://earnkit.com/badge/<h>.svg)](https://earnkit.com/<pagePath>)` and a
  Copy button (`app/[handle]/BadgeCopy.tsx`, given the markdown so the client never loads `badge.ts`; "Copy failed"
  when the clipboard refuses; its reset timer is cleared on unmount).
- **L9 funnel numbers** (`stats.ts`, `/api/stats`, cache key `public-stats-l9`), after `builders`:
  - `activated`: claimed people (`x_user_id`) with a repo source verified by the App (`proof = 'github_app'`) and at
    least one checked ship-log week with a fact (`factWeek`: `facts.checked` plus code shipped, went live or a win,
    `hasFacts`' SQL twin). Until the weekly moment's approvals (L6) exist, that stands in for "first approved week".
  - `weekly_active`: activated people (the same base, so never above `activated`) with such a week that ended in
    the last 7 days (`week > now - 14 days`).
  - `shared`: 0, documented, until Task 3 counts share links.
  - A test installation's group (`EARNKIT_TEST_INSTALLATIONS`) counts in neither.
- **Hotfix carry-overs (repo reads).**
  - `person-github.ts readGithubRepos` returns `{ repos, failed }`. A busy repo's 52-week call that fails puts only
    that repo in `failed` (`sources.ts readAll` writes its failed reading with the message; `person-score.ts
    readPersonLive` writes a failed live row). The deadline or a spent budget still stops the whole read.
  - `needsAllWeeks`: the extra call runs only when the source has no verified reader-2 baseline, or the commits read
    don't reach before last week's Monday. Fix round 1: the baseline is asked (`RepoReadOptions.baseline(key, r)`)
    only for a short read, with the repo as read, so it is the write's own lookup (`previousRepoSignals(id, r)`); a
    ref read once for several sources has a baseline only when every one has.
  - Fix round 1, one refused repo: `readGithubRepos` asks `ghGraphql(..., { aliasErrors: true })`, so
    `graphqlUsable` accepts an answer whose every non-NOT_FOUND error has a path starting at an `rN` alias
    (`source-readers.ts aliasOf`). That repo goes to `refused` (GitHub's message) and is left unread: the App
    fallback tries it, and the message is its failed reading only if the App can't read it either. An error without
    such a path still fails the batch.
  - `ReaderDeps.deadline` (set by `defaultReaderDeps`): no weekly call starts past it (ScoreDeadline, the source
    stays due).
  - `week-facts.ts shipReading`, one LATERAL for `weekFactsFor`, `readingOf` and the catch-up's due query: the
    newest good reading, preferring one of the current reader (`REPO_READER`).
  - `rescorePerson` returns `changed`: true only when the public row moved (score, rank, or a hold starting or
    ending). A builder who stays held expires no cache on every refresh.

## Launch ready (Task 2): the repo picker on install (L2)

Design doc: `docs/design-docs-and-implementation-plans/launch-ready.md` (ruling L2). Tests: `repo-picker.test.ts`
(through `mcpCall`, the fake GitHub and the real setup URL).

- **The reply.** A signed-in builder with no one project (`no_project`) is never asked for a GitHub URL. The one step
  is "Install the read-only EarnKit app on the repo you want ranked (one click): <link>" then "Want me to rank it
  once that's done?" (`bench-reply.ts STATE_COPY.no_project.ask`, kind `pick_repo`, `PICK_REPO_NOTE`; the yes is
  `PICK_REPO_YES_NOTE`). The page is named beside it without https (A14). Only while the link can't be made (the App
  off) is the old question asked (`noApp()`, kind `start`). Naming a repo still works (find's `identity.project`:
  `not_counted` with that repo's own install link). The copy rule lets "on the repo you want ranked" through
  (`fixtures/banned-words.ts`, the owner's line).
- **The link.** `repo-proof.ts pickLink` is `createVerifyLink` with `repoKey: null`, stored as
  `github-verify.ts PICK_REPOS` (`'*'`, never a real key: no schema change). Everything else is the App link's: an
  `app` nonce, refused without the person's page (S7), the confirm page and its `__Host-ekv-` cookie, 15 minutes,
  single use, the GitHub sign-in hop naming the installer, then GitHub's install page (`installUrl`), whose own
  picker chooses the repos. The confirm page says "This connects your repos to earnkit.com/<handle>. Only continue
  if that is your page." (`appPickDestination`), with "Repos: The ones you pick on GitHub".
- **The setup URL** (`github-app.ts appSetup` -> `pickSetup` for a `PICK_REPOS` nonce, after the same cookie,
  installation id and `takeNonce` checks). One deadline, `PICK_BUDGET_MS` (25 s) from the top of the handler
  (fix round 1, I3): every GitHub call of the setup goes through `repo-proof.ts budgetedFetch` with it.
  `pickedRepos`: the installation (its account), one installation token for the list (`installationToken(id, null)`:
  metadata read), `GET /installation/repositories` (pages of 100, the first `PICK_LIST_MAX` = 100 listed), newest
  `pushed_at` first; a repo passes R8 as `appProof` does for one: the installation is the installer's own account and
  the repo is on it, or the installer is the repo's admin (at most `PICK_ADMIN_CHECKS` = 30 admin checks,
  `PICK_ADMIN_BATCH` = 5 at a time, until `PICK_PROVE_MAX` = 20 passed). Final fix I2 (ruling): `pickedRepos` also
  returns `org` (the installation's account is an Organization, or isn't the installer's own); on an org installation
  `pickSetup` proves and holds only the repo that becomes the one project (the current one project when it was picked,
  else the most recently pushed one that proves), so the org's other repos stay free for their own builders; a user
  account (the builder's own repos) still proves up to 20. The success page then says "this repo". Each passing repo goes through `proveOne`
  (every proveByApp rule: GitHub names this installation, a fork or template is `derived`, `repo_hold:<key>` then the
  person's and source locks, another person's App hold is `taken`, a non-App hold replaced); only a proven repo then
  gets its `via = 'app'` verification (fix round 1, M2: a taken repo or a copy gets none, so `appTokenFor` never mints
  a token for it; the single-repo path now does the same: `proveOne`, then the verification, then `connectProven`).
- **The one project (fix round 1, I1).** It stays when it is one of the proven repos. Otherwise `setMainProject` with
  the newest proven repo: that replaces an unconfirmed one project (a named repo the builder never installed on) and
  keeps a confirmed one. "Newest" is among the first 100 listed repos. Then `connectProven` once within what is left
  of the deadline (at most `REFRESH_BUDGET_MS`): replaced people rescored, the events, one connect read of every proven
  repo with the installation token, the rescore, R13's 3-week backfill for the one project (the hourly catch-up
  finishes the rest).
- **The setup page** (`PICK_PAGE`, fix round 1, I1, I2): always names whatever the one project is now and its page:
  "Done. EarnKit now ranks github.com/<repo> on earnkit.com/<handle>.", then (L10) `PICK_PAGE.next` "Go back to your
  agent and say yes. To rank a different repo, tell your agent.", then "Not your page? Remove the EarnKit app from these repos in your GitHub settings:
  https://github.com/settings/installations" (the one link; `github-verify.ts pageWith`; the daily `app_check` then
  takes removed repos off the page). The single-repo success page says the same way out, after "Done. Go back to your
  agent and say yes." (L10; was "say go") and "This adds github.com/<repo> to earnkit.com/<handle>.". Refusals: nothing picked or not the
  installer's (403), none could count (403: forks, templates, taken), every proof failed at GitHub (502, M3).
- **proveByApp split.** `proveByApp` = `proveOne` (the checks and the S8 transaction, returning `Proven`) +
  `connectProven(builderId, proven, deps, { deadline? })` (the connect read, rescore and backfill).
- **Switching (tell `main_project`).** `setMainProject` stays set once after confirmation (find's `identity.project`
  is the folder the agent is in, so it must not move a confirmed project). `tell { main_project: "owner/repo" }`
  (`bench-find.ts rankAnswer`, `main-project.ts rankRepo`) moves the one project, even a confirmed one, only to a
  repo this person proved with the App (a verified `github_app` source of their own), then rescores: "EarnKit now
  ranks github.com/<repo>.". The switch counts at once; the new one project's 3-week backfill comes from the hourly
  catch-up. Switching after a coin or an entry is allowed: entries and coins stay tied to their own repos. A repo not
  proven is not changed to; the reply offers that repo's own install link (`installLink`, fix round 1, M5: "... isn't
  connected yet. Install the read-only EarnKit app on it (one click): <link>") and the agent calls tell again after
  the install. The tell description names it ("main_project: owner/repo to rank instead."), under 800 characters.
- **Limits.** The first 100 listed repos, at most 30 admin checks and 20 proofs per setup, newest push first; the rest
  (and any past the deadline) are not proven at that setup (owner question: raise the caps if builders pick more).
  GitHub's "Redirect on update" must stay on, so an installation that already exists (the builder adds repos to it)
  reaches the setup URL too.

## Launch ready (Task 3): one weekly target and one weekly moment (L5, L6, L9)

Design doc: `docs/design-docs-and-implementation-plans/launch-ready.md` (L5, L6, L9). Owner: WHOOP-style and very
simple: one number (Shipping), one target this week, one weekly moment.

- **The weekly target (L5).** `score-v2.ts weekGains(parts, now)` reads the stored mask as of now's week (shifted like
  the why) and returns `{ active, gain, next }`: what this week adds (or added, once it has commits) and what next week
  adds. `weekly-target.ts poolPlace` reads the leaderboard's own pool (`benchPool`): the person's rank (1 + those
  scoring higher) and the score and rank just above (the lowest higher score). Never a name or handle: another
  builder's X name is text they control, and putting it in an MCP reply is a prompt-injection path (security ruling
  during Task 3; `weekly-moment.test.ts` L5.6 checks a hostile name never reaches find, score, the moment or the share
  link). `weeklyTarget` (pure):
  (v3.1 F4 rewrote the lines to name the rank and never the points; the original L5 wording is replaced as below)
  - not active, someone above, score + gain > theirs: "Ship code this week to pass #2."
    (not enough, and a tie is not a pass: "Ship code this week to move toward #2.");
  - #1 (no one higher, ties included): "Ship code this week to hold #1.";
  - this week done: "Done this week." (no question);
  - outside the pool (held, hidden) or under `RANK_MIN_POOL` ranked builders (v3.1 R14): "Ship code this week."; a week
    worth 0 points reads "Ship code this week to hold #k." / "Done this week.".
  `targetFor` never throws (null: the caller keeps `SHIP_STEP`). Replies (`benchView`, find and score) put it as the
  ranked state's one next step (kind `ship`, the yes still `SHIP_NOTE`). The profile (`bench-data.ts
  profileData.target`) shows the same math under the why in the page's voice (L10, `voice: 'page'`; see the UX pass).
  The why sentence (`scoreWhy`) now holds only the weeks with code ("Code in 7 of the last 12 weeks, 3 of the last
  4."), so the step is never said twice. L5 said "owner view only" on the profile, but L7 rules the owner can't be
  told from a visitor on the web; the brief shows it to everyone with the rank only.
- **The weekly moment (L6).** In `benchView`, ranked, with a page and no held question, `weeklyMoment`: `momentDue`
  (the caller's own installation's `installations.moment_week` is not this ISO week), then `lastWeekOf` (the
  builder's last ranked, unheld `builder_scores` row of last week, its rank among that day's other ranked, unheld rows
  whose page is listed now; the same for the week before for the deltas; last week's `project_updates.titles` through
  `titlesShown`, so a private repo's titles only with titles on), then `momentReady` (fix round 1: last week's row is
  `facts.checked`, or this week's Monday 15:00 UTC, `WEEKLY_HOUR_UTC`, has passed; before that no moment and the week
  stays unclaimed, so a Monday-morning reply never uses up a moment without its titles), then `takeMoment` (`UPDATE
  installations SET moment_week = <week> WHERE moment_week IS DISTINCT FROM <week> RETURNING 1`: two replies at once
  show it once). No ranked day last week: no moment and the week stays unclaimed. The lines lead show_to_builder
  (after "Signed in as"): "Last week you finished at Shipping 50 (+6), #2 (up 1)." ("Last week you finished at
  Shipping 30, #1." with no week before; "(same)" for no change), up to 2 titles joined by " · " (the builder's own
  commit titles, checked again with `update-text.ts checkUpdate` at read, and dropped when they hold a link or a host
  name, `titleHasLink`), then the new week's line from the same target (`weekly-target.ts weekStartLine`: "This week
  starts at Shipping 50: ship code to pass #2." / "... to move toward #2." / "... to hold #1." / "... to climb."
  (v3.1 F4: no points); none
  once this week has code). Only the builder's own data is in the moment and the share text. The share link (`shareLink`: `page-data.ts shareIntentText`, `https://x.com/intent/post`
  with `text` "My week on EarnKit: Shipping 50 · #2 of 3 builders" and `url` the profile; no X
  API, no scope) becomes the ranked reply's one link (the page is then named without https) and its step: "Share your
  week on X: <link>" + "Does last week look right?" (kind `share`, `SHARE_NOTE`). Showing it opens the offer in
  `standing_seen.share_open = { key, week, shown_week }` (`openShare`), apart from the stored ask, so later replies
  that week don't close it (`takeNews` keeps the key). Per installation: another agent of the same person sees its own
  moment once.
- **The yes (L6, L9).** `benchMoveUp` routes kind `share` to `answerShare` (fix round 1): one UPDATE removes
  `share_open` and returns it, only while `isoWeekOf(now)` is its `shown_week` and for its project, so it is answered
  once, any time that week. A yes runs `approveWeek`: the builder's existing row for that week, matched
  case-insensitively, gets `facts.approved = true`, `approved_at`, `approved_via = 'share'` merged in; with none, one is
  inserted (the weekly job's later upsert merges too, so nothing is lost). A row holding only the approval shows nowhere (no facts,
  text or titles: `logCards`, the feed's `hasFacts`). "Thanks. Last week is confirmed." A no is the usual decline.
- **Funnel numbers (L9).** `stats.ts approvedWeek`: activated = claimed + App-proven repo + an approved week;
  weekly_active = the same people with `approved_at` in the last 7 days; shared = approved weeks with
  `approved_via = 'share'` (weeks, not people). Test installations' groups never count. The old fact-week stand-in
  (`factWeek`) is gone.
- **Schema.** `installations.moment_week text` (additive, idempotent).
- **Tests.** `weekly-target.test.ts` (pure: gains, every target shape and boundary, moment lines, share link encoding),
  `weekly-moment.test.ts` (mcpCall: the target through find and score, the public profile target, #1 and ties, the
  moment once per installation, deltas, titles public and private, the share link, the yes and its row, two replies at
  once, the stats deltas), `stats.test.ts` (approvals), and the ranked-step tests now use `fixtures/ranked-step.ts`.
- **Accepted limits.** Last week's rank is read from the daily history (the cron's first run each day); a builder whose
  row is missing that day is left out of that day's count. `STATS_LABELS.shared` is "weeks confirmed at the weekly
  share offer": a yes doesn't prove a post.

## Launch ready (UX pass, L10): the site and the replies as a new builder sees them

Walked every page (desktop 1440x900, phone 390x844) and the agent replies through `mcpCall` as a brand-new builder
and as a designer. Screenshots and the rendered replies were in `docs/screenshots/launch-ready/{before,after}/` (removed 2026-10-20 with the rest of `docs/screenshots/`),
`replies.md` (after) and `replies-before.md`. The full issue table is in `.superpowers/sdd/launch-ready/task-ux-report.md`.

- **404.** `app/not-found.tsx`: the site's own page for any unknown path or handle; before, Next's white default.
  v3.1 site Task 10: the NotFound board's rust card ("404", "Nothing shipped here.", "Back home"); metadata title
  "Page not found", noindex.
- **Header.** `Header.tsx` and `brand-page.ts brandShell` link Programs (from 640px, after Feed; the footer's order).
- **Install modal** (`AddToAgent.tsx`). `INTRO` "Free. Your agent connects with this link:" (not "no account": the agent
  signs the builder in with X). One step is a plain line, two or more a numbered list (no "1. Or add this"). Codex's
  `after` is "Then sign in:" above the login command (it was said twice). Focus rings on the tabs, Copy and close.
- **Leaderboard.** `BenchRowItem`: on a phone the @handle and chain logos share one line and the project and its
  best fact share one (three lines a row, was five). `BenchView`: an empty filtered view says `BENCH_EMPTY` "No builder
  matches this filter yet." with `BENCH_SHOW_ALL` "Show everyone" (`/leaderboard`).
- **Program cards.** The days chip starts with a capital ("Rolling", "Ends today"), as the difficulty chip does.
- **Profile** (`BenchProfileView`). L7: every page ends with the visitor CTA (`VISITOR_CTA` "Want your own page? It is
  free." and "Add to your agent"). `confirmingCardLine` says "a private project" for `PRIVATE_NAME` (was "is getting
  Private project"). No project and no week with code: one calm line, `noProjectLine` "<name> has no project on the
  leaderboard yet." (was "Code in 0 of the last 52 weeks" over an empty grid). The README badge line only with a rank
  and not while confirming (else the badge reads "not ranked"). `BENCH_SOURCES_LINE` drops "from public data" (App
  repos may be private). Project links are 44px on phones.
- **The weekly target's two voices** (`weekly-target.ts weeklyTarget(t, voice)`). Replies (`'reply'`, the default)
  are as in L5 (v3.1 F4: "Ship code this week to pass #2.", "Done this week."). The public page
  (`'page'`, `targetFor(..., { voice: 'page' })` from `profileData`) states the fact to a visitor: "Code this week
  passes #2." / "... moves toward #2." / "... holds #1." / "Shipped this week."; null when the week adds nothing. Ranks
  only, as before (the v3.1 profile no longer shows the target line).
- **Setup and sign-in pages.** `VERIFY_PAGE.done` "say yes" (the reply's question is "Want me to ... once that's
  done?"); the picker's page adds `PICK_PAGE.next`. The paste code is its own unbreakable line (`.ek-code`; it broke
  at a dash on phones): `LINK_TEXT.paste` is now the label "Paste this code to your agent:".
- **OG card.** `public/og.png` is the current headline (was "Agents only ... Launching soon"); the alt text matches.
- **Tests.** `public-pages` (404, header, modal), `bench-page` (Show everyone), `profile-bench` (L10 page states),
  `weekly-target` (page voice), `v214-signin-link` (`.ek-code`), copy-review scans the page voice; updated pins in
  `weekly-moment`, `v214-app-proof`, `repo-picker`, `github-app`, `install`, `leaderboard-clarity`, `fixtures/ranked-step.ts`.

### Final fixes (coordinator's final review)

- **I1 Command wrap.** `AddToAgent.tsx Command` splits on line breaks first, then wraps only between words (each word
  `whitespace-nowrap`), so Cursor's multi-line mcp.json keeps its lines and a flag never splits at its hyphens.
- **I2 Org picker.** See the picker section above: an organization's installation proves only the one project's repo.
- **I3 Target copy.** Not passing reads "D short of #k", D = their score - (score + gain) + 1 (passing means strictly
  above; a tie is 1 short): replaced by v3.1 F4 ("move toward #2" with no number); `weekly-target.ts shortOf` stays
  exported and unused by copy.
- **M1 Share yes.** `answerShare` with no `project_key` answers the one open offer.
- **M2 Moment line.** "This week starts at Shipping S: ship code to add +G points, ..." (S the new week's score), so
  the drop from last week's number reads as the new week. v3.1 F4 replaced the "+G points" tail with the rank:
  `weekly-target.ts weekStartLine` ends "ship code to pass #k." / "to hold #1." / "to move toward #k.", or "to climb."
  with no rank.
- **M6 Badge.** `badge.ts badgeFileOk` (X handle, 1 to 15 of `[A-Za-z0-9_]`, plus ".svg"); the route answers
  `badgeMiss()` for anything else before `unstable_cache` or the database.

## Weekly updates (2026-10-20)

Design doc: `docs/design-docs-and-implementation-plans/weekly-updates.md`. Feed and ship-log cards no longer list raw
commit titles. Each week shows one summary (`project_updates.summary`), with the builder's note (`text`) under it as a
quote (`UpdateCard`: `data-ek-summary`, `data-ek-note`; the square card shows the summary, or the note without one).

- **Written by the weekly job.** `week-facts.ts weekTitles` returns `{ titles, summary }`: up to 40 cleaned titles
  go to `week-summary.ts weekSummary` (Claude Haiku 5.5 via `aiSummary` when `ANTHROPIC_API_KEY` is set, else
  `ruleSummary`), checked by `checkUpdate`; `upsertWeekFacts` keeps an older summary when the new one is null. The
  stored `titles` (3) stay for older readers and the read-time fallback.
- **Read time.** `summaryShown(summary, titlesShown(...), rule)` in `feed.ts feedRows`, `bench-data.ts profileData`
  and `weekly-moment.ts lastWeekOf`: the titles privacy rule, and never text naming a private repo.
- **Fix wave (owner batch, 2026-10-23).** The weekly moment's reply quotes last week's stored summary as one line under
  the head (`bench-find.ts momentSummary`: never with "?" or a link) and its yes binds exactly that text; the connect
  offer quotes none, so its yes binds none (`approveWeek(..., null)`). An offer that could not show the stored summary
  records it (`weekly-moment.ts markOffered`, `facts.offered_summary`; the moment and the Monday email), so it is asked
  once, not forever. `week-summary.ts namesPath` is deny by default: any slash path or file name with a source or text
  extension (prisma, vue, svelte, graphql, gql, proto, tf, ini, cfg, conf, xml, csv included), an extensionless known
  file name (Dockerfile, Makefile, Procfile and kin) or a dotfile token (".env", ".gitignore") hides a private repo's
  summary, except the allowlist (Next.js, Node.js, Vue.js, Three.js, Nuxt.js,
  Express.js, React/Next.js, CI/CD, and/or, I/O, UI/UX, A/B).
- **Private repos (owner batch 2026-10-23).** Approval is consent, bound to the exact text: a private repo's week
  with titles off shows its stored summary on the feed, profile Activity and posts only when it equals
  `facts.approved_summary` (`week-summary.ts summaryConsented`). `weekly-moment.ts approveWeek(..., seen)` stores the
  summary the builder was shown: the moment keeps it in `share_open.summary`, the connect offer in `connect_open.seen`
  (each only when the line shows the stored summary word for word), the email page in a hidden form field
  (`week-links.ts SEEN_FIELD`, `summaryHash`; a POST whose hash no longer matches gets the page again, 409). No `seen`
  binds to nothing. A summary rewritten or re-read after the yes is hidden until approved again: `weekRules(...).current`
  makes the moment, the connect offer and the email link ask again; the first approved_at and approved_via are kept.
  A summary written while titles were on is not shown once they are off unless approved word for word. Raw titles stay
  hidden unless titles are on. `weekTitles` reads a private repo with titles off only when a model is set
  (`ANTHROPIC_API_KEY`): its titles (those naming the repo dropped) go to Haiku, the summary must pass `checkUpdate`
  and never name the repo or a file (`namesPath`), there is no rule-summary fallback (it repeats titles nearly word
  for word), and the titles are not stored. `weekLineRule(..., { asking: true })` shows the summary to the builder in
  their own approval prompts (`lastWeekOf`: moment, digest, week link page; `connectWeeks`) so they see what they
  approve. Past weeks: `pnpm feed:summaries` (it calls `weekTitles`) fills them once the key is set.
- **The note.** `updates.ts noteMonday`: Monday and Tuesday UTC a `tell update { text }` goes under the finished
  week; from Wednesday, this week's. The moment adds `NOTE_LINE` under the summary; `SHARE_NOTE` tells the agent to
  post the builder's line with `tell update`.
- **Started once.** `logCards` shows the start only on the oldest week whose facts carry `started`.
- **Owner script.** `pnpm feed:summaries [--dry] [--redo]` (`scripts/feed-summaries.mts`) fills or rewrites summaries
  of stored weeks by reading the titles again.
- **Install pop-up.** `AddToAgent.tsx AGENTS`: Grok Bot, Muse, OpenClaw (documented `openclaw mcp add ... --transport
  streamable-http`, then `openclaw mcp login`), Claude Code, Cursor, Codex. Instinct documents no way to add an MCP
  server, so it has no tab.
- Tests: `week-summary.test.ts` (W1-W8); `feed.test.ts` 6.6/6.7b and `v214-ship-log.test.ts` 8.9/8.10 read summaries.

## v3 Stage 1: the founder's loop

Design: `docs/design-docs-and-implementation-plans/v3-power-user.md`; plan: `v3-power-user-plan-stage1.md`; owner steps:
`v3-stage1-runbook.md`. Stage 1 makes the owner's own path work end to end through Grok Bot: connect, see the weeks,
say yes, earn points, get the Monday email.

- **Hosted clients sign in with X (`oauth.ts`, `oauth-routes.ts`, `x-install.ts`, `x-link.ts`, `installations.ts`,
  `discovery.ts`, `tools.ts`).** Grok Bot and Muse (hosted, shared registrations) go through X sign-in at the OAuth
  authorize. An installation bound to an X account is never "shared": the rule is `shared_client AND x_user_id IS NULL`
  everywhere. `exchangeCode` gives a shared registration no client key, so each token is its own installation. An
  anonymous hosted token gets the paste-code sign-in link and the Bench `signed_out` reply (`hostedAnon` in the find
  branch of `tools.ts`); a bound one gets discovery, scoring and weekly facts like any other client.
- **Points at write time (`week-facts.ts`, `feed.ts`, `scripts/feed.mts`).** `upsertWeekFacts` writes
  `project_updates.points` together with the facts; `pointsOf` lives in `week-facts.ts` (`feed.ts` re-exports it).
  `rankFeed` covers 12 weeks. `pnpm feed:rank` (`feed.mts rank`) rewrites the points of older rows.
- **"Not yet confirmed" (`week-facts.ts`, `feed.ts`, `UpdateCard.tsx`, `BenchProfileView.tsx`).** Weeks that are not
  approved carry `confirmed: false`; the card shows `UNCONFIRMED_LABEL` ("Not yet confirmed") until the builder's yes.
  Weeks post on Monday.
- **The points ledger (`points.ts`, `weekly-moment.ts approveWeek`, `week-facts.ts upsertWeekFacts`, `stats.ts`,
  `bench-reply.ts`).** `builder_points` holds one row per builder and week. `awardWeekPoints` writes it (created_at is
  its `now`), `pointsForRank` gives by rank share: 100 for #1, 90 for the top 10%, 70 for the top 25%, 50 for the top
  50%, else 30 (also with no rank); `CONNECT_POINTS` is 30, `pointsTotal` sums. `approveWeek(..., via)` awards points
  when a week with facts is approved; a week approved before its facts arrive is awarded by `upsertWeekFacts` when they
  do (via its `approved_via`). The profile
  showed `POINTS_PAGE_LINE` until the v3.1 site (the profile shows no points; owner 2026-10-21: points in agent replies
  only), replies carry points through v3.1 T16's lines (`bench-reply.ts POINTS_ON_*`, `connect-moment.ts pointsAddedLine`; v4.2 removed the ship step's `shipPointsLine` for `shipLine`),
  and `/api/stats` returned `points_total` (dropped in v4.7.1).
- **The connect moment (`connect-moment.ts`, `bench-find.ts`, `bench-reply.ts`, `weekly-moment.ts`).** The first
  ranked reply after connect shows every unconfirmed, unhidden week with facts, newest first, at most 12
  (v3.1 T16 removed `CONNECT_HEAD` and the weeks list; see "v3.1 P0 Task 16" below), and asks `connectAsk(weeks, page)`
  (`bench-reply.ts`, re-exported by `connect-moment.ts`; the reply says where the weeks go and carries the page link
  in full, plus "+P points"). `tell move_up { kind: 'connect' }`
  approves them (via `'connect'`) and counts as activation; the Done line carries the https page link.
  `standing_seen.connect_open/connect_done` track it: an empty read closes the offer only once the backfill is complete
  (`backfillComplete`), and a week whose approval failed reopens the offer with that week for the next yes. The weekly moment skips a week already approved.
- **The Monday email (`week-links.ts`, `app/api/week/route.ts`, `digest.ts`, `cron.ts`).** At `DIGEST_HOUR_UTC` (16),
  after the weekly facts, the digest carries last week's lines with signed "Looks right" and "Hide this week" links
  (`week-links.ts`). GET shows one button, POST acts; links last 14 days; hiding a week works on any row and
  approving un-hides it. `pending` weeks wait. The address is asked after the connect yes or a share yes
  (`EMAIL_QUESTION`) while the person has no opted-in subscription and this installation was not asked in the last
  `EMAIL_REASK_DAYS` (30). Needs `RESEND_API_KEY` and `EARNKIT_AUTH_SECRET`; unset, the feature is off.
- Tests: `v3-hosted-client`, `v3-week-points`, `v3-unconfirmed`, `v3-points`, `v3-connect`, `v3-monday-email`
  (`.test.ts`); `digest.test.ts` and `oauth.test.ts` updated.

## v3 Stage 2: money

Design: `docs/design-docs-and-implementation-plans/v3-power-user.md` (spec 5.2, 5.3); plan:
`v3-power-user-plan-stage2.md`. Stage 2 puts money in front of the builder: the programs worth applying to (with the
honest total), a drafted application from the ship log and the outcome loop, Backing on the builder's coin, and the
numbers that prove it (backers and Earned). Four parts, in the order they were built.

### Part 1: programs for Q4 2026, `upcoming`, the honest total, Base first

- **The `upcoming` status (`program-file.ts`, `db/schema.sql`, `programs.ts`).** A program file may be
  `status: 'upcoming'` with `opens_note` (one line, at most 140 characters, no links); it may have no
  `submission_requirements` and its `submission_url` may be its `source_url`. `in_person` (default false) marks an
  in-person program. The schema widens `programs_status_check` and adds `opens_note` and `in_person`.
  `listPrograms` returns active and upcoming programs (`status IN ('active', 'upcoming')`); `programCard` carries
  `status`, `opens_note` and `in_person`. Everything that matches, offers, enters or counts keeps `'active'`:
  `openProgramFacts`, `pool.ts openCurated` (it reads the card's status), `isOpen`, `readStats`, and `tools.ts`
  (find's `programs`, `needsRepoLine`, `buildPick`) and `present.ts presentFirstMessage` drop upcoming cards.
- **Base first (`present.ts byRelevance`, re-exported by `landing.ts`).** The tiles' order: open before upcoming, then
  Base programs (`chains` include `base`), then any-chain programs, then the rest; within each, grants before
  investments; then the sooner deadline (rolling last), then the bigger `max_award_usd`. On Oct 20 the landing reads
  Base Builder Grants, ETHGlobal Mumbai, a16z speedrun, Alliance ALL19, Circle, Avalanche, then Base Batches 005 and
  Monad Nitro (upcoming). An upcoming
  tile's `days_left` is `'not open yet'`; `ProgramCard` shows "Not open yet" and, when `in_person`, an "In person" chip.
- **The honest total (`pool.ts`).** `openMoneyUsd` never counts an investment. `openMoneyWords` names what it leaves
  out ("Plus 2 accelerators and 1 hackathon."): investments, and hackathons (never an investment, no `max_award_usd`,
  and in person, or a stated `pool_usd`, or only a stated `reward` text), so a program is summed or named, never both. The first reply's context line (`fresh-build.ts contextLine`) counts
  only the programs the figure sums (an amount, never an investment). `openGrantsText`
  renders "$115K in grants and prizes open". `Landing.open_text` is that line (null when nothing is open) and `open_more` the
  words; `ProgramCards` shows both (`figure`, `more`). `/api/stats` `open_money_usd` excludes investments and
  `open_money_text` is the same line. The first reply's headline keeps `moneyText` ("$X in prizes open right now.").
- **Guide and reply.** `GuidePage.upcoming`; `programGuide` ends the header with "not open yet" and sets
  `Guide.opens_note`, shown under the header (and in `guideText`); no "Ask your agent". In the Bench reply a ranked
  builder on a 4-week streak (`UPCOMING_STREAK`) gets one `FundLine` `upcoming` ("<title>: <prize>, not open yet.
  <note>"), the first upcoming program by `byRelevance`, after the fits (or the no-fit line) and before the points.
- **In person.** An `in_person` program is never a fit in the ranked reply (`benchFind` rows and
  `stand-view.ts scoreFits` skip it) nor on the profile's Ways to get funded (`bench-data.ts fundLines`); it stays on
  the landing and /programs.
- **Investment wording.** `stand-view.ts earnPrize` reads an investment "up to $500K investment" (as `pool.ts
  eachLine`), so the upcoming line says "Monad Nitro: up to $500K investment, not open yet.".
- **Programs added (2026-10-20).** `alliance-all19`, `ethglobal-mumbai` (in person; no `max_award_usd`: the source lists partner prizes, not a
  per-winner amount, so it is a named hackathon, never in the total),
  `monad-nitro` and `base-batches-005` (both upcoming); `a16z-speedrun` now has its real deadline (`ends_at` 2026-11-02T07:59:59Z,
  November 1, 11:59 PM PT), so (as Alliance ALL19, Nov 18) it can be the apply step (an investment is an apply
  candidate, never a fit line). `programs/README.md` documents `upcoming`, `opens_note`, `in_person`. `landing.ts byPool` was removed (no caller). Test:
  `v3-programs.test.ts`.

### Part 2: the drafted application and the outcome loop (spec 5.3 Route 1)

- **The apply step (`bench-find.ts applyPick`, `bench-reply.ts applyAsk`).** In the ranked reply, a program the one
  project could apply to (deadline order) closing within `APPLY_WINDOW_DAYS` (30) becomes the one step. The candidates
  (`ViewIn.applies`) are the fits plus the open investments: find takes `layout` rows with `present.ts canApply` (good
  odds, no `new_work`; `qualifies` is `canApply` without an investment), score takes `scoreFits(..., { investments: true })`
  (`alerts.ts repoCanWin(..., { apply: true })` passes an investment the tier fits, whose verdict is always weeks of
  work). The fit lines still never name an investment. The step: "<title> closes <day>. Want me to draft your
  application from your ship log?" (kind `apply`, `project_key`, `program_id`). Skipped when the program is entered or
  hidden, when `builder_program_status` holds any row for it (any status, any round), when the builder said no to it in
  the last 30 days (`standing_seen.declined['apply:<program_id>']`), and once shown (`standing_seen.apply_asked`, one
  guarded UPDATE; `takeNews` keeps the key). Order: connect > (Task 3's `backing` slot, marked in `stateAsk` and
  `benchView`) > apply > the weekly moment's share > the weekly target. A shown apply step holds the weekly moment for
  a later reply. The stored `bench_ask` carries `program_id` and the fit's `repo`.
- **The yes (`benchMoveUp` kind `apply`).** Taken once; returns `agent_note: APPLY_YES_NOTE(program_id)` and
  `lead: { program_id, repo }`. A no is declined under the program id.
- **The ship log in the draft (`ship-log-facts.ts`).** `shipLogFacts` reads what `profileData` reads (no log): score and
  rank (with a rank line), why, streak (grid weeks, confirmed only), the live site, the page (`earnkit.com/<handle>`).
  prepare's ready draft (not the build path, not a shared client) puts `shipLogBlock` above `draftTable`, adds
  `ship_log` and the `SHIP_LOG_NOTE` suffix to `agent_note`. Statements only.
- **Outcomes.** `program_status` takes `accepted`, `funded` and `rejected` (an application's outcome): stored in
  `builder_program_status` as `applied` is (its round, hidden the same way); a self-report, never public. The schema
  widens the CHECK and adds `asked_at`. `outcomeToAsk` keeps the `results.expected` entry ask first; else it picks an
  `applied` row whose program closed more than 14 days ago, never asked, and sets `asked_at` in the same statement.
  The question: "Did <program> come back on <project>? applied / accepted / funded / rejected." (`outcomeLine`);
  `ask_outcome` then has no `project_id`.
- **The page.** `projectPrograms` returns `{ title, won, applied }`; `ProjectTab` shows "Won X" (announced), else
  "Applied to X" (a submitted entry, or a told application of any of the four statuses), else nothing. A self-reported
  accepted or funded never changes the label.
- **Stats.** `applications` (distinct person and program rows with applied, accepted, funded or rejected, no test
  installation) and `accepted` (of those, accepted or funded). `backing_open`, `backers` and `earned_usd` skip a coin of
  any test installation's group (`stats.ts testProject`: the project's installation, its group root, or any installation
  in the group). Test: `v3-apply.test.ts`.

### Part 3: Backing (spec 5.3 Route 2)

_Retired in v4.0 (coin offers, Backing, the confirm tool; see "v4.0 Task 11" and "v4.0 overview" at the end). Kept as history._

- **The word.** Builder text says Backing / backers / "Back <project>", never "community round", "raise" or
  "raising" (`fixtures/banned-words.ts BENCH_EXTRA` now bans "community round"). Internal names stay (`raising_at`,
  `RaisingPill`, `raisingEnabled`, `tell coin { raising }`).
- **One switch.** `EARNKIT_RAISING` gates every coin-facing surface at once: the offer (`backingOfferable`), the
  reply's fund line, the page's pill and Back button (`pillOf`), the project tab's "$SYM on tokens.fun" line
  (`profileData`), the leaderboard's Backed chip and `?backed=1` (`parseBenchFilter`), the card's pill, the terms'
  Backing section and the JSON's `backing`. Off, `tell coin` keeps its old schema (no `raising`).
- **The offer (`coin-moments.ts backingOffer`, moment `first_week`).** Once a project, in the first ranked reply after
  a week of it the builder approved with code in it (`project_updates.facts.approved` and `hasFacts`), when a coin is
  offerable (`coinOfferable`: launches on, not shared or held, never offered, no coin, under the declines, a confirmed
  repo read public) and the repo is not `BACKING_EXCLUDED_REPOS` (`earnkitai/earnkit`). The line is `BACKING_OFFER`
  (the coin and the wallet named, the risk said, one question). Order in `stateAsk`: connect > backing > apply >
  share > ship; a shown offer holds apply and the weekly moment for a later reply. `tell token: 'ask'` (the countable
  moment) shows the same words under the flag (`raiseLine`).
- **The answer (`benchMoveUp` kind `backing`).** Taken once, then `tools.ts coinAnswer`: a yes is `coinYes` (the
  entry, `COIN_YES_NOTE`, `confirm { project_id }` launches; `raising_at` set under the flag), a no is `coinNo`
  (`coin_moments.answer`, counts toward `DECLINES_MAX`). Backing never moves Shipping or rank.
- **Backing open.** The ranked reply's Ways to get funded ends (before points) with `backingLine`: "Backing open. Your
  page: earnkit.com/<handle>" while backers and fees earned are 0 (Task 4 fills them), a statement whose page is
  schemeless beside the reply's one https link. The page: the "Backing · $SYM" pill and a secondary `Back <project>`
  button (`data-ek-back`) to the coin's tokens.fun page under the score card; the leaderboard row's pill and the
  Backed filter chip (`FILTER_BACKED`).
- **The terms.** `policy.ts BACKING_POINTS` (the split in words, offered once, the risk, closing keeps the coin, never
  changes Shipping or rank) under "Backing" in `PolicySection` with the flag; the old "The token is optional" section
  is gone; the fee table stays. `/terms` revalidates every 600 s (ISR reads the running env), so a flip shows within 10 minutes.
- **The JSON (`builder-json.ts`, `GET /api/builders/<handle>.json`).** `{ handle, name, page, shipping, rank, total,
  streak, points, last_week, last_shipped_days, stopped_shipping, backing }` from `profileData` and `standingOf`;
  404 for an unknown or hidden page; `Cache-Control: public, max-age=60`; CORS for https://tokens.fun.
  `last_shipped_days` counts from the end of the newest week with code (weeks are the grain). Test: `v3-backing.test.ts`.
- **Review fix round 1.** `BACKING_EXCLUDED_REPOS` is checked in `coinAllowed` (the key and the confirmed repo link,
  lowercase) and in `openCoinLine`/`coinYes` (`backingExcluded`), so no entry point offers EarnKit's own repo a coin.
  Under the flag `tell token: 'ask'` answers `BACKING_NOT_YET` ("Backing opens after your first confirmed week.")
  before the first approved week with code (`approvedCodeWeek`), then makes the same once-a-project `backingOffer`.
  In find and score the offer waits at most the reply's budget (`boundedBacking`, at least `BACKING_WAIT_MIN_MS`);
  past it, `late()` keeps the moment unclaimed (or releases it), so it is offered on a later reply.

### Part 4: Backers, Earned and "waiting" (spec 5.2, 5.3 Route 2)

- **Backers (`backers.ts indexBackers`).** Distinct wallets that bought a launched Base coin (`projects.coin_address`,
  `token_status 'launched'`), from the coin's ERC-20 Transfer logs: a backer received the coin from the pool side (the
  Transfer's `from` is a trade venue, `shared-contracts.ts tradeVenue`, the PoolManager or the coin's pool hook) and is
  not in `BACKER_EXCLUDED` (zero, every `SHARED_BASE_CONTRACTS` address, every `traction.ts CLANKER_ADDRESSES` one:
  dev buy, airdrop, MEV modules, presales, hooks) nor the Safe, the lockers, the FeeLocker, the coin, its hook
  (`BonusRpc.poolHooks`) or its creator wallet. A transfer between two wallets never adds one. Per coin, a cursor in
  `coin_backer_cursor` (start: the launch block from the `coin_tx` receipt; without one, estimated from
  `coin_launched_at` at 2 s a block, an hour early). Ranges of at most 2,000 blocks (`scanForward`), `CALLS_PER_COIN`
  calls a coin, `INDEXER_MS` (25 s) a run, the oldest cursor first; a range's rows (batches of 1,000) and its cursor
  are one transaction; over `RECIPIENTS_PER_RANGE` recipients, or a failed write, reads the range again smaller. One
  coin's failure is logged and the rest go on.
- **Creator fees paid (`earned.ts indexCreatorFees`).** Per distinct creator wallet (`fees.ts creatorWalletSql`:
  `fee_recipients.creator`, else `creator_wallet`, else `payout_wallet`), cursor `bonus_cursor 'creator_fees:<wallet>'`
  from the earliest launch block of its coins. A FeeLocker `ClaimTokens` (WETH) empties the owner's whole balance, so
  the index also books the wallet's `StoreTokens` deposits to their coin through the same transaction's
  `ClaimedRewards` (`bonus-ledger.ts bonusDeposits`, as the Safe index does), keeping only the wallet's EarnKit coins
  (`creator_deposits`). A claim is credited only up to those coins' deposits not yet credited, oldest coin first, one
  `creator_fees` row per (claim, coin). A range's deposits, credits and cursor are one transaction; a range read again
  replays its stored credits. Same bounds and fail-soft rule as the backers index.
- **Cron.** `runBonusLedger` runs `backers_index` then `creator_fees_index` after `safe_index`, each in its own
  `INDEXER_MS` slice (never past the run's deadline). They need what the ledger needs (`CAMPAIGN_PAYOUT_PRIVATE_KEY`,
  Base mainnet over `BASE_RPC_URL`); an RPC without the readers skips them (`{ skipped: 'no reader' }`).
- **Earned (`earnedUsd(builderId, now)`).** `paid_usd` = the credited WETH of the builder's coins at
  `fees.ts cachedWethUsd` (6 h per process; waits at most 1.5 s, else the price token_fees implies, else the last one)
  plus the prizes of announced won or placed outcomes; `waiting_usd` = `cachedFeesUsd` of those wallets (the FeeLocker
  read; never awaited); `fees_usd` = the credited part alone. Never touches Shipping or rank.
- **Where it shows.** The page's third number after the Shipping ring and the rank, only while ranked
  (`BenchProfileView` `Earned`, `data-ek-earned`, "$1,240"; "$0" with nothing; "and $X waiting" from $1). The ranked
  stand line ends "Earned $340." from $1 (`bench-reply.ts earnedWords`, a statement). `ProfileData.earned` and
  `BuilderJson.earned` (`{ paid_usd, waiting_usd }`) with the flag off too. With `EARNKIT_RAISING` on and backing
  open (`raising.ts pillCoin`): `backing.backers` (`backersOfCoin`) and `backing.earned_usd` (the credited fees, whole
  USD) on the page, the JSON and the reply's "Backing: N backers, $X in fees." line (final review: "in fees", never "earned"; the header Earned is prizes plus fees).
- **Stats.** `earned_usd` (credited fees over non-test coins at the WETH price, plus `builders_won_usd`),
  `backing_open` (launched coins with `raising_at`, non-test) and `backers` (their coins' backers); the last two are
  always present and 0 while the flag is off. Test: `v3-earned.test.ts`.
- **Schema migration (`db/schema.sql`).** `creator_fees` is keyed (tx_hash, log_index, coin). A database that ran the
  first version (key tx_hash, log_index) is migrated in one guarded DO block: drop the old key, clear `creator_fees`
  and the old `bonus_cursor` rows (`creator_fees:%`), add the new key; the next run credits again under the deposit
  cap. Cursors are per creator wallet (`creator_fees:<wallet>`). A rerun of the schema is a no-op
  (`schema-rerun.test.ts`).

Tests for the four parts: `v3-programs`, `v3-apply`, `v3-backing`, `v3-earned` (`.test.ts`).

## v3 Stage 3: the flat system (Task 1: tokens and primitives, spec 5.8)

The site moves from the navy gradient card kit to a flat system: a true black page, white type, one accent
(Base blue), hairline rows instead of cards, Funnel Display for display and numbers, Funnel Sans for text.
Task 1 changes only the tokens and the primitives; the pages are restyled on them in the later tasks
(landing, profile, leaderboard, feed, programs, docs, shell pages, card, badge), so a page can look
in-between until its task lands. The build and the suite stay green throughout.

- **Tokens (`lib/earnkit/theme.ts THEME`).** Same keys, new values: `page`/`pageTop` `#000000`, `glass`
  black at 85%, `surface`/`surfaceTop` `#0E1116` (one colour; the two stops exist so the old mirrors stay
  flat), `raised` `#161A22`, `border`/`hairline` white 12%, `borderStrong` white 24%, `chip` white 6%,
  `chipHover` white 12%, `track` white 10%, `glow` transparent, `text` `#FFFFFF`, `body` `#C9CDD6`, `muted`
  `#7E8694`, `accent` `#3D7BFF`, `brand` `#0052FF`. `brand` is a fill (3.7:1 on black): the primary button,
  dots, selection. Blue text is always `accent` (5.5:1 on black, 4.5:1 on `raised`).
- **Mirrors.** `app/globals.css` defines every value as `--ek-p-*` (tested in `profile-pages.test.ts 10.5` and
  `v3-tokens.test.ts`); the body is `background-color: var(--ek-p-page)` with no background image, no
  gradient, no glow; the marquee keyframes are gone; `::selection` is brand with white text, the focus ring
  is the accent; `.ek-arc` and both reduced-motion blocks stay. `tailwind.config.ts` holds no raw hex: every
  `ek-*` colour is a variable. `ek-blue-bright`, `ek-blue-soft` and `ek-score-orange` are removed; new
  `ek-brand`, `ek-brand-hover` (an alias of the accent) and `ek-track`. `brand-page.ts` reads THEME; review fix 1
  made its CSS flat too (no body gradient, no panel gradient or shadow) and its `.ek-btn` white on brand like
  `BTN_PRIMARY` (5.8:1; it was page-on-brand, 3.7:1). Task 6 restyles the panel itself.
- **Primitives (`Panel.tsx`, `Button.tsx`).** `COLUMN` is 1120px with 16px gutters (32px from md); `SECTION`
  is the vertical rhythm; `H1` 56px (36px on a phone), `H2` 32px (24px), `LEDE` body colour at a 36rem
  measure; `NUM` is tabular Funnel Display; `ROWS`/`ROW` are hairline rows; `SURFACE` is a flat block that
  opens with a hairline (no radius, no gradient), kept so the callers compile until their tasks move them to
  rows. `BTN_PRIMARY` is a 48px pill on `ek-brand` with `ek-text`, `ek-accent` on hover; `BTN_SECONDARY` is
  the `ek-line-strong` outline with `ek-chip` on hover.
- **Usages fixed.** Every `ek-blue-bright` fill is `ek-brand` with `ek-text` on it (Header, AddToAgent,
  FilterChip, the terms bullets); every `ek-blue-soft` focus ring is `ek-accent` (BenchProfileView, ProjectTab,
  FilterChip, BenchRowItem, AddToAgent, ProgramCard); the orange on the won line (ProjectTab) and the
  Backing pill (RaisingPill) is `ek-accent`. The share card (`card-response.tsx`) and the badge (`badge.ts`)
  keep their own hexes until the card and badge tasks; the card's orange becomes brand blue there
  (DESIGN.md). `layout.tsx` reads `theme-color` from `THEME.page`.
- **Profile palette.** `PART_COLORS` is unchanged (the owner keeps it); `SCORE_COLORS` reads page, surface,
  track and text from THEME, and the hero ring is white to the accent. The rings are the one gradient left.
- **DESIGN.md** is rewritten to one page: the rules (no gradients, glow, shadows, decorative images, video,
  emoji, em dashes; one accent; sentence case; no all-caps, no eyebrows; 1120px column; 44px tap targets;
  reduced motion), the type scale, the token table, the contrast table, the profile palette, layout, buttons.

Test: `v3-tokens.test.ts` (T1.1 to T1.8: the values and the mirror, contrast, globals.css rules, no raw hex in
Tailwind, no removed token in `app/`, the primitive strings, SCORE_COLORS from THEME, DESIGN.md's scope).

## v3 Stage 3: the landing (Task 2: a statement, a live card, rows and one action; spec 5.6, 5.8)

- **Composition (`HomeView`).** Hero; Leaderboard (top 10); Feed (the last finished week, at most
  `FEED_ROWS` = 6); Money open now; Backed by; Footer. A failed read (`landing = null`) renders the hero and
  Backed by only, claiming nothing about the live parts; an empty bench shows `BENCH_TOP_EMPTY` and no
  rows, no tiles shows `PROGRAMS_EMPTY`. Every section is `H2` with an optional text link on the same
  baseline (`TEXT_LINK`), a muted `SUB` line, then a `ROWS` list.
- **Hero (`Hero.tsx`, `FeaturedCard.tsx`).** `H1` at a 16ch measure, `LEDE`, one `InstallButton`
  (`BTN_PRIMARY`); the header holds the only other "Add to your agent". Right of the words from md (under
  them on a phone) sits the featured builder's live preview: avatar, name, @handle, the streak words, the
  numbers (Shipping = `points`, Rank = `rank`, the rank line's lead via `rankSplit` in `readFeatured`, Earned
  only when `earned` is not null: null at 0, never "$0"; the grid takes its column count from the numbers
  rendered), the two latest ship log lines; the whole card is one `<a>` to the page. With no card the words
  take the whole column. No
  video, no second button, no stats or won line (`stats_line`/`won_line` stay in `Landing` for `/api/stats`).
- **Data (`landing.ts`).** `Landing.featured: FeaturedData | null` from `readFeatured`: `featuredHandle()`
  (`LANDING_FEATURED_HANDLE`, default `FEATURED_HANDLE_DEFAULT = 'jenilt'`) through `resolveHandle` (a case
  redirect is followed once), `benchCardFacts` (null without a score line: unranked, held or unlisted) and
  `profileData` (the log minus Started cards, `score` as the Shipping number, `earned.paid_usd` rounded).
  Hidden, held, unranked and missing handles are null. Review round 1: a failing featured read alone is
  caught in `readLanding` (logged `[landing] featured`, `featured: null`; `LandingDeps.featured` is the test
  seam), so the hero's card never takes the landing or /programs down. `readBench` now takes
  `feedWeeks(now)[0]` sliced to `FEED_ROWS`. The cache key is `landing-v3-<featured handle>`.
- **Rows.** `ProgramRow` (was `ProgramCard`): logo, title with the chips under it, the award on the right
  from md; `ProgramCards` lists them in one `ROWS` list on the landing and `/programs` alike (the `layout`
  prop is gone). `FeedRows` wraps the long `UpdateCard` (Task 3 restyles it). `BenchRowItem` lost its md
  radius, inset and hover tint so it reads as a row (Task 4 restyles it fully). `BackedBy` is a static
  wrapping row at 60% opacity, each mark drawn at its own height (a per-logo map) so the row reads at one
  weight, lazy as before; `Header` sits in `COLUMN` with a 44px button; `AddToAgent` is a flat sheet on
  `ek-surface` with wrapping hairline tabs, a `fixed inset-x-0 bottom-0` bottom sheet on phones and a
  centred sheet from sm, over a `bg-ek-glass` backdrop. Rule (tested in `v3-landing (i)`): no `/NN` opacity
  modifier on an `ek-*` token anywhere under `app/`; the tokens are `var()` colours without `<alpha-value>`,
  so Tailwind emits nothing for such a class (this had silently removed the sheet's backdrop, the program
  logo's disc and the Backing pill's border).
- **Deleted.** `public/videos/earnkit-launch.mp4`, `public/images/graphics/*`,
  `public/images/landing/FINAL_CTA.png`, `public/favicon-16x16.png` (and its reserved name),
  `CarouselRow.tsx`; `UpdateCarousel.tsx` became `FeedRows.tsx`. `carousel.ts` stays (pure, tested).

Test: `v3-landing.test.ts` ((a) order, (b) two buttons, (c) no old kit, (d) featured against the database,
(e) null and empty renders, (f) FeaturedCard, (g) the env default, (h) the deletions, (i) the sheet, (j) ProgramRow).

## v3 Stage 3: the profile (Task 3: three numbers, a grid and a dated log; Money tab; share; spec 5.6, 5.8)

- **The page (`app/[handle]/BenchProfileView.tsx`).** One column on the black page. The header row: a 56px
  photo, the name at the H1 shape in 40px (32px on a phone), `@handle`, then `ShareButton` (secondary,
  `/<handle>/share`) and, while backing is open, the `Back <project>` button (`data-ek-back`) beside it. The
  three numbers (`<ul data-ek-numbers>`, three `<li>` between two hairlines): the Shipping ring (96px, the
  number inside, caption "Shipping"), the rank (`rankSplit` lead large, its words as the caption; the score
  line stays `sr-only` for screen readers) and Earned (`data-ek-earned`, "$0" when ranked with nothing, "and
  $X waiting" under it). A number not there yet is an en dash in muted (`DASH`): unranked pages show dashes
  for Rank and Earned; Confirming and no-project pages show the calm line as a `LEDE` and three dashes, no
  grid, an empty Ship log (never a stale rank: `Numbers` gets `bench: null`). Under the row, quiet: the why and
  the target as one muted line, the chain lines with logos, Originality, the points line (hidden on the Money
  tab, which carries it). The grid is `ShipGrid` with hairline cells filled `ek-brand` (no opacity ramp, no
  radius), the streak and "Code in N of the last 52 weeks" under it. Tabs are three links on a hairline rail
  (the active one underlined 2px white); the Ship log's rows hang off the rail (`ROWS`, the first row without
  its top line); the Project and Money tabs open with a title. The visitor row (`VISITOR_CTA` + the one
  primary button), the sources line and the badge close the page. Motion: the ring draw only; the skeleton is
  static flat blocks.
- **Money tab (`MoneyTab.tsx`, `bench-data.ts MoneyTabData`).** `ProfileData.money = { fits, applied,
  backing, points }`. `fits` come from `fundFits` (the old `fundLines`, now structured: title, `earnPrize`,
  `earnWhen`, `fitWhy(c, whyFacts(repo))` from bench-find, `href: /programs/<id>`); the Project tab's
  "Ways to get funded" strings are `fits.map(fundLine)`. `applied` is `projectPrograms` as `{ title, status:
  'won' | 'applied' }` (empty until the project is confirmed, the Project tab's rule). Groups: "Programs that
  fit" (rows linking to the guide: title and why left, prize and when right), "Applications" (title, Won in
  accent or Applied muted), "Backing" only when `backing` is set (EARNKIT_RAISING on and open): the
  `RaisingPill` at its new `lg` 44px size (the coin's one link here; the pill left the header) with "N
  backers, $X in fees"; then `pointsLine(points)` + `POINTS_PAGE_LINE`. Empty groups invite (`FITS_EMPTY`,
  `APPLIED_EMPTY`).
- **Rows and parts.** `UpdateCard` long shape is a row: a hairline on top, the week (and the person in the
  feed) in a left column from sm (`9rem`, `11rem` from md), the summary (18px from md), the note as a
  `<blockquote data-ek-note>` on a strong hairline, chips under; the "Not yet confirmed" label sits on its own
  line under the week (no middle dot). The square shape is unchanged. `ProjectTab` is rows: H2 name with
  chain logos, the what, `TEXT_LINK`s (Live site, Code, the coin), programs as `ROWS`, "Ways to get funded" as
  an H2 and `ROWS`. `ScoreRing` lost its glow prop (no drop-shadow); gradient stroke and round cap stay.
  `BadgeCopy` shows the badge image always (ranked pages) and a `<details>` whose summary is "Badge for your
  README" in the text link look; inside, the markdown and a `BTN_SECONDARY` Copy. `dollars` moved to
  `bench-data.ts` (re-exported by `BenchProfileView`; `FeaturedCard` imports it). `tabOf` knows `money`.
- **Pins moved, not removed.** The Backing pill is asserted on the Money tab (`profile-bench 11.1`,
  `v3-backing (d)`, `v213-journey 16.5`); the badge line is "Badge for your README" (`profile-bench L10`);
  `v213-copy 11.11` checks the Money tab too with `$EARN` exempt.

Test: `v3-profile.test.ts` ((a) the numbers row, (b) the Money tab, (c) share and one primary action, (d) the
confirming and no-project rows with dashes, (e) no "this week" added by the page, (f) the flat rules and the
grid, (g) tabs, rows and the visitor row, (h) the badge).

## v3 Stage 3: leaderboard, feed, programs and the guide; "of N builders" (Task 4; spec 5.2, 5.6, 5.8)

- **Leaderboard (`app/leaderboard/BenchView.tsx`, `BenchRowItem.tsx`, `FilterChip.tsx`).** H1 "Leaderboard",
  `benchLine(count)` as the LEDE, the filters as hairline pills (`Chip`: a link with `aria-pressed`, 44px on a
  phone and 36px from md; on, it inverts to `ek-text` with `ek-page` text; never a brand fill), then one `ROWS`
  list (no Panel). A row is `grid-cols-[2.5rem_minmax(0,1fr)_auto]` on a phone and
  `md:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)_5rem]`: "#N" in Display 24px (`data-rank`; the rank line
  stays `sr-only`), the 44px photo with the name (its link's `after:` box is the whole row's hit area) and a
  muted line of `@handle`, chain logos and the small Backing pill, the project in body over its best fact in
  muted (two lines, never "project · fact"), and the Shipping number in `NUM` 24px (`data-points`, "Shipping"
  `sr-only`). On a phone the project drops to a second line under the name; the rank and the number stay level
  with the photo. Nothing in a row is `nowrap`, clamped or `max-w`. `RaisingPill` `sm` and `md` reach 44px of hit
  area through an `after:` box (the look is unchanged).
- **Feed (`app/feed/FeedView.tsx`).** `FEED_TITLE = 'Feed'`, `FEED_LINE = 'What builders on the leaderboard
  shipped, week by week. Every fact is checked.'`; each week is an H2 ("Week of Oct 12") over a `ROWS` list of
  long `UpdateCard`s with `showWeek` off (the landing's `FeedRows` shape); `FEED_EMPTY` sits between two
  hairlines with the secondary link to the leaderboard. The old gapped flex column is gone.
- **Programs (`app/programs/page.tsx`, `ProgramCards.tsx`, `ProgramLogo.tsx`).** The landing's Money section
  is the page: `PROGRAMS_TITLE = 'Money open now'` (h2 on the landing, h1 on /programs; the `bench` prop is
  accepted and ignored), `open_text` as the LEDE, `open_more` as a muted line, every tile as a `ProgramRow`
  in one `ROWS` list; `PROGRAMS_EMPTY` with none. Every logo sits on a white disc (`ek-text`, `rounded-full`,
  `overflow-hidden`) with the mark at 70%, so a dark mark (Arc's navy SVG, Colosseum's black SVG, a16z's black
  on an opaque white PNG) reads on the black page and every row shows the same round shape; the monogram keeps
  its raised disc.
- **Guide (`app/programs/[id]/GuideView.tsx`, `lib/earnkit/landing.ts GuidePage.chain`).** The 56px logo
  beside the H1 title; the facts as separate muted spans from `guide.header` split on " · " (the award; "ends
  <date>", "rolling", "closed" or "not open yet") plus the chain (`GuidePage.chain`, the program's chains joined
  by ", "; `ANY_CHAIN` when `any_chain`): stacked on a phone, in a row with hairline dividers from md; an
  upcoming program's `opens_note` under them in body colour; the Difficulty line; `AskAgent` only when open.
  The parts are one `ROWS` list of hairline rows (H2 left, content right from md): What won, What X wants now
  as `ek-chip` pills, Your best bet. Then "All programs" as a `TEXT_LINK` and the Sources links spaced by a gap
  (no middle dots). `Unavailable` is unchanged.
- **Wording (spec 5.2).** `rank.ts rankLine` is "#3 of 19 builders", "Top 8% of builders", "#2 of 12 builders on
  Arc" (the percent rule from 20 ranked is unchanged); `scoreLine` therefore "Shipping 72 · #3 of 19 builders";
  `rankSplit` splits the same; `weekly-moment.ts shareText` and `badge.ts badgeValue` follow by construction.
  `banned-words.ts BENCH_ALLOWED` strips the chain rank line without "this week". `copy-review.test.ts` has the
  rule: no "this week" within 20 characters after "builders" in any builder-facing, agent-facing or gate
  string. `v3-pages.test.ts (e)` scans `app/` and `lib/` source (comments aside) for `builders?.{0,20}this week`.
- **Pins moved, not removed.** Every test string "… builders this week" / "builder this week" / "on <chain> this
  week" lost "this week" (`rank`, `bench-rank`, `bench-page`, `bench-reply`, `badge`, `move-up`, `page-data`,
  `profile-bench`, `reply-states`, `v213-copy`, `v2131-o5`, `v3-apply`, `v3-landing`, `weekly-moment`,
  `leaderboard-clarity`, `v213-journey`, `repo-picker`, `v214-app-proof`, `v214-journey`, `v214-replies`,
  `v213-find`, `v2133-owner-test`, `originality`); `leaderboard-clarity` pins the new md grid;
  `public-pages` pins "Money open now" and the guide facts as spans ("500 USDC × 20 grants" and "closed" each
  in their own span); `badge.test` pins Task 3's "Badge for your README".

Test: `v3-pages.test.ts` ((a) the leaderboard and its chips, (b) the feed, (c) /programs and the logo disc,
(d) the upcoming and open guides, 404, (e) the rank wording and the source scan, (f) nothing wider than a
phone column).

### v3 Stage 3 Task 6: the HTML shell pages, the share card, the badge, the OG image (spec 5.6, 5.8)

The four surfaces outside React draw the flat system from `THEME` (no hex of their own):

- **Shell pages (`brand-page.ts brandShell`).** The CSS is built from THEME: a black page, the React header's
  slim sticky bar (56px, 64px from 640px; the wordmark, Leaderboard, Feed, Programs and Docs as quiet links, the
  1120px column), the words in the page column at a 36rem measure with no panel around them (`.ek-panel` is a
  max-width only: no fill, no border, no radius). Funnel Sans is embedded as a data: woff2 (`sansFile`,
  `app/fonts/funnel-sans-latin-wght-normal.woff2`, the file the React pages load) for the text; Funnel Display
  stays as the two data: woffs for `h1` (36px, 48px from 640px, weight 500) and `.ek-first` (the one-line
  pages, 28/32px). `.ek-rows`/`.ek-row` are hairline rows; `.ek-note` is a hairline row (no tinted box; no
  double line after `.ek-rows`); `.ek-code` is a flat surface block with a hairline and no radius; `.ek-mark`
  a raised disc; `.ek-chip` a hairline pill; `.ek-btn` is `BTN_PRIMARY` (48px pill, brand, white, accent on
  hover; full width on a phone, inline from 640px); links are the accent. The wallet page's CSP
  (`font-src data:`) already allows both fonts. The `<header class="ek-top">` structure and every status code
  are unchanged (`page-shells.test.ts`).
- **Unsubscribe pages (`digest.ts digestUnsubscribeGet/Post`)** go through `brandShell` (were a plain
  system-ui page): the question as the `h1` with one `.ek-btn` form (GET), `UNSUB_DONE` and `UNSUB_BAD` as
  one-line statements; 200/400 and the no-store, noindex headers kept. The week page already used the shell.
- **Share card (`card-response.tsx benchCard`).** Black (`THEME.page`), the wordmark top left (`CardWordmark`,
  Logo.tsx's path), the Backing pill top right (a hairline pill, accent text, `Backing · $SYM`, only while
  `raising`), the photo in a hairline ring (or the initial on the raised spot) beside the name (44px) and
  @handle (muted), the rank line as the 64px headline (`rankSplit` of the score line without its "Shipping N ·
  " prefix; without a rank the project, else the name, at 64px or 52px when long: `headlineSize`), then the
  numbers (`CardNumber`: Shipping, and Earned from $1), the project and streak left and the page URL right at
  30px. `BenchCardFacts` gained `score` (the score line's number while ranked, else null) and `earned` (whole
  dollars from $1 while ranked, else null; `earnedUsd` failures log and count as 0), read in `benchCardFacts`
  only when the line exists (no bare score without a rank). `v3-landing.test.ts`'s fixture carries the fields.
- **Badge (`badge.ts badgeSvg`).** Geometry unchanged; the label on `THEME.page`, the value on `THEME.brand`
  (white text on both, 5.8:1), the not-found value on `THEME.muted`; `aria-label` unchanged.
- **OG image (`scripts/og.mts`).** `ogImage()` renders `BENCH_HERO_TITLE` (two lines at 104px) and
  `BENCH_HERO_SUBTITLE` (30px, body colour) under the wordmark with the site host at the foot through the card's
  renderer (next/og, `loadFonts` from `card-response.tsx`); run as a script it writes `public/og.png`
  (1200x630). The script sets the React global, as the tests do, because the card's JSX compiles to
  `React.createElement` under tsx.

Test: `v3-shells.test.ts` (T6.1 every shell page is the flat system and its CSS hex set is a subset of THEME;
T6.2 the unsubscribe pages; T6.3 the card's composition, numbers and hex set; T6.4 the badge; T6.5 the OG PNG's
IHDR is 1200x630). Pins updated: `badge.test.ts` (black label, brand value), `v3-landing.test.ts` (the fixture).

## v3 Stage 3: the site

The whole site on one flat system (spec 5.6, 5.8), seven tasks on `v3-power-user`. The one-page rulebook is
`apps/frontend/DESIGN.md`; this section is the map of what each page is made of.

- **Tokens and primitives (Task 1).** `lib/earnkit/theme.ts THEME` is the one colour source (black page, white
  text, `body` `#C9CDD6`, `muted` `#7E8694`, `brand` `#0052FF` as a fill, `accent` `#3D7BFF` as blue text,
  white-alpha hairlines and chips); `globals.css` mirrors each as `--ek-p-*` (tested), `tailwind.config.ts` reads the
  variables as `ek-*` and holds no hex. `Panel.tsx` is the layout and type scale (`COLUMN` 1120px, `SECTION`,
  `H1`/`H2`/`LEDE`/`SUB`, `NUM`, `ROWS`/`ROW`, a flat `SURFACE`); `Button.tsx` the four link looks (`BTN_PRIMARY`,
  `BTN_SECONDARY`, `TEXT_LINK`, `INLINE_LINK`). No gradient but the profile ring, no glow, shadow, decoration,
  emoji, em dash or uppercase anywhere (`v3-tokens.test.ts`, `v3-landing.test.ts` (i) scans every colour utility
  under `app/` for a `/NN` opacity modifier, which the var() tokens cannot carry).
- **Landing (Task 2).** `HomeView`: Hero (`BENCH_HERO_TITLE`, `BENCH_HERO_SUBTITLE`, one `InstallButton`, the
  `FeaturedCard` right of the words from md), the Leaderboard top 10 (`BenchTop`, `BenchRowItem` rows), the Feed
  (`FeedRows`, the last finished week), Money open now (`ProgramCards` over `ProgramRow`), Backed by (a static
  row of ten lazy logos at 60%), Footer. The featured card is `Landing.featured` (`landing.ts readFeatured`: the
  `LANDING_FEATURED_HANDLE` profile, default `jenilt`, through `resolveHandle`, `benchCardFacts({ money: false })`
  and `profileData`; null when hidden, held, unranked or missing, and a failing read is logged and leaves it
  null). The landing cache key is `landing-v3-<featured handle>[-raising]` (`app/lib/landing-cache.ts`); the guide
  cache key is `guide-v3` (bumped in Task 7 for `GuidePage.chain`).
- **Profile (Task 3).** `BenchProfileView`: the header (photo, name, @handle, Share, Back <project> while backing
  is open), the three numbers between hairlines (the Shipping ring, Rank as "#N" over "of M builders", Earned from
  $1), the quiet lines under them (why and target, chain lines with `ChainLogo`, Originality, the points line), the
  52-week grid, the tabs Ship log / Project / Money. `MoneyTab` lists programs that fit, applications with Won or
  Applied, Backing with the pill and "N backers, $X in fees", then the points line. `ShareButton` links to
  `/<handle>/share`. Empty states (confirming, no project) keep the header and the numbers row with three dashes.
- **The list pages (Task 4).** `/leaderboard` (`BenchView`: "N builders. Ranked by Shipping.", hairline chips,
  `BenchRowItem` rows with a 3rem rank column at every width so "#100" fits), `/feed` (`FeedView`: an H2 per
  week over long `UpdateCard` rows; `FEED_EMPTY` with one secondary button), `/programs` (`ProgramCards` as the
  page, PROGRAMS_TITLE "Money open now"), the guide (`GuideView`: the logo beside the H1, the facts as separate
  spans that start with a capital like the row chips, the parts as hairline rows). The wording rule: "of N
  builders" (`rank.ts rankLine`), never "this week" after a 12-week score; the chain line reads "#2 of 12
  builders on Arc".
- **Docs (Task 5).** `/docs` (`DocsView`, every string in `lib/earnkit/docs-copy.ts`, the agents' install steps
  from `app/components/sections/agents.tsx`, shared with the install sheet): install per agent, what the agent can
  do, the three numbers, how the week works, for program selectors (`#selectors`), the terms link. Header and
  footer link to it; docs.earnkit.com is gone from the site.
- **Shell pages, card, badge, OG (Task 6).** `brand-page.ts brandShell` draws the same header, column, type and
  button from THEME for every route-handler page (sign-in, GitHub, setup, week, wallet, unsubscribe), with Funnel
  Sans and Funnel Display 500 embedded as data: fonts. `card-response.tsx benchCard` is the share card (rank line
  as the headline, Shipping and Earned, 28px labels); `badge.ts` the README badge (label on the page, value on
  brand, white text; the not-found value is muted text on the raised spot, 4.8:1); `scripts/og.mts` writes
  `public/og.png` from the hero words with `earnkit.com` at the foot whatever `EARNKIT_URL` says.
- **Copy rules (Task 7).** `copy-review.test.ts` scans every builder-facing string and, through `humanStrings`,
  every literal under `app/` (page metadata included) for "Shipping points", "EARN points", "What builders
  shipped", "the Bench", "community round", a raise, and "this week" after "builders"; `human-text.test.ts` for
  em dashes. The terms' risk disclosure keeps its words and numbering with the headings in sentence case. Links
  inside running text use `INLINE_LINK` (a 44px hit area without changing the line's height: padding below md, an
  invisible box from md, never both, so neighbouring links never overlap on a phone; v3.1 final fix 5). `ChainLogo` is round
  at every size; `public/images/chains/base.svg` is a solid Base-blue circle drawn inline (Arc and Robinhood stay
  monograms until the owner supplies the files).
- **Visual check.** Every page at 1440x900 and 390x844 (the landing with the install sheet open, the leaderboard's
  four filters including an empty one, the feed with rows and empty, the three guide states, a ranked profile's
  three tabs, a confirming and a no-project profile, docs, terms, the 404, the week page with its moment lines, a
  sign-in page, the GitHub confirm page, two share cards, the badge) lives under the SDD workspace of the stage
  (`.superpowers/sdd/v3-power-user-plan-stage3/shots/task-7/`, with `measurements.txt`: no horizontal scroll, no
  target under 44px, the fonts, no em dash or caps).

## v3.1 P0 Task 1 (F1): the owner's repo gets its fits

- **Root cause.** The matcher skipped every repo in an EarnKit org (`match-projects.ts`, `SKIP_REASONS.earnkit`,
  v2.10.1 B4) before reading it, so the owner's one project, `earnkitai/earnkit`, never had a match: find's rows were
  empty and `installations.fit_repos` never held it, so score had none either, and both said "No open program fits
  EarnKit yet." Now find's Bench match passes `MatchDeps.ownEarnkit` for the one project when `own-brand.ts
  earnkitOwnRepo` holds (an EarnKit-org repo this builder proved with the read-only App); every other EarnKit repo is
  still skipped and says so.
- **Gates.** `alerts.ts fitGate` names the gate that drops a pair (tier, odds, wide, facts, verdict, mentioned, close,
  hard). The close and Hard gates are alert precision (a nag), so `apply` (the apply step's candidates and the fit
  lines) skips them; only a program that counts new work still drops. On find's path `present.ts canApply` matches it:
  a row whose only low reason is users not measured yet ("no users yet": under 50 transactions, no users claim) on a
  repo with good odds is a candidate, since the application states usage itself. `qualifies` (the money "you qualify
  for", the first message's lead) keeps the strict rule. No program fact changed.
- **Fit lines.** Find and score name the same lines (`bench-find.ts fitLines`): every apply candidate, investments
  included ("up to $400K investment"), in `present.ts byRelevance` order (Base, then any chain; grants before
  investments; then the deadline), at most 3. The lead and the shown-match record use the lines' grants only. The
  apply step still picks from every candidate in deadline order.

## v3.1 P0 Task 4 (F4): the ranked reply loses words

- The owner: "too many words". `bench-reply.ts benchReply` no longer shows the why sentence (`BenchView.why` stays for
  the page and `ship_log`), Originality (`standLine`; `BenchView.originality` and `originalityWords` stay) or the points
  line (`bench-find.ts benchView` no longer adds a `points` FundLine; the kind and `points.ts POINTS_LINE` stay
  exported; `approveWeek` still writes `builder_points` and the page still shows points).
- The upcoming line (a 4-week streak) shows only when the reply names no fit (no `fits` FundLine), after the no-fit
  line. Task 6's Best fit joins that rule.

## v3.1 P0 Task 10 (spec 3.4, D1): the agent drafts, never submits; confirm only opens Backing

_Retired in v4.0 (coin offers, Backing, the confirm tool; see "v4.0 Task 11" and "v4.0 overview" at the end). Kept as history._

- The agent's tools are find, prepare (draft only, `draft-application.ts`), tell and score. `mcp.ts` registers
  `confirm` only while `raisingEnabled()` (EARNKIT_RAISING), with `CONFIRM_BACKING_DESCRIPTION` and a strict schema
  `{ project_id (required), yes?, check?, token?, wallet?, image_url?, image_data?, builder_x?, agent?, signed_in? }`:
  the coin launch a Backing yes hands over (`coin-moments.ts COIN_YES_NOTE`). No program_id, project, answers,
  skip_token, contracts, deployer_signature or submitted.
- `tools.confirm` throws `EntryError(CONFIRM_ENTRY_GONE)` for any `program_id` (an old alias, a direct call) and
  otherwise is `confirmByProjectId`. Through MCP a program_id is a schema error first ("Unrecognized keys"); with the
  flag off, "Tool confirm not found". `handlers.confirm_entry` / `record_submission` stay (tell submitted, the
  by-project_id re-offer); `buildWalletAgain`, `BUILD_WALLET_NOTE`, `SUBMITTED_AGAIN_NOTE`, `withoutTokenLine` are gone.
- `prepareDescription(buildOn)`: the drafting sentence, the host sentence, and `build: a build_offer yes.` only while
  deploys are on. No campaign sentence and no token sentence; `toolDescriptions(campaignOpen, buildOn)` no longer
  varies by campaign. `toolDescriptions().confirm` exists only under the flag; `TOOL_DESCRIPTIONS` always carries it
  (copy scan).
- find offers no build: `list_programs` passes `fresh: undefined` (no `build_offer`, no fresh lead line);
  `presentFirstMessage` has no "Ideas" section (the close keeps "Pick one and I'll start." where a shown program has
  curated ideas); `bench-find.ts benchView` adds no `idea` FundLine for a builder with no project, so `needsPicks`
  fills both NEEDS_MAX slots.

## v3.1 P0 Task 16: every reply rewritten for a busy builder (owner-approved copy, 2026-10-21)

- **Supersedes the three-part layout** of v2.13 to Task 6: no "Where you stand" / "Ways to get funded" / "How to move up"
  headers anywhere. `bench-reply.ts benchReply` writes each state and step as the owner approved it, word for word:
  plain lines, " · " joining facts, at most one https link, exactly one question, the points line last when the step
  earns points. The logic stays: four states, one next step each; ranked steps in order connect, apply, backing, share
  (the weekly moment), ship; the rank phrase only from `RANK_MIN_POOL`; no Backing for `earnkitai/earnkit`.
- **Step 1 (signed out):** `INTRO_LINE` + `introWhat(open)` (the open grant: `bench-find.ts openGrant`, the first showable
  grant (never an investment) with a known award by `byRelevance`, its organizer without the parenthesis, `awardAmount` "$5,000"), then the
  sign-in step, "Done?" and `POINTS_ON_SIGN_IN` (`points.ts CONNECT_POINTS`).
- **Step 2 (no repo, or a named repo not counted):** `youreIn(handle)`, `pickRepoAsk(link)`, `POINTS_ON_CONNECT`. The reply
  names the account, so `namesAccount` drops the "Signed in as" line above it.
- **Step 3 (connect):** `connectStanding` ("Kit is on the leaderboard: #1 of 13 builders, 4 weeks in a row."; "on EarnKit"
  under the pool), `qualifyLine(best)`, `connectAsk(weeks, page)` (the page in full, the reply's one https link) and "+P points" where P is `points.ts connectOfferPoints`
  (CONNECT_POINTS for each offered week the ledger has no row for). The weeks list is gone; `connect_open` now carries
  the Best fit (`ConnectBest`).
- **Step 4 (connect yes):** `CONNECT_DONE` "You're live: <page link>", then `connectApplyAsk` (the Best fit offered as a
  draft: `bench-find.ts connectApply` stores the apply ask and claims `apply_asked` through `takeApplyAsk`, unless told,
  declined or asked), else the weekly email question; then `pointsAddedLine(added, total)` from the ledger (before and
  after the yes).
- **Step 5 and the other ranked steps:** `standingLine` (name · rank · streak · "$X earned"), then the money (the apply
  ask's own line `applyAsk(title, amount, when)`; else `moneyLine`: the Best fit, the first fit, the backing statement or
  the upcoming program), the question (`SHIP_ASK` for ship, the backing offer, a held question), and for apply and ship
  `shipLine` (v4.2: no points; "Ship code this week." or the weekly target when it says to ship; it replaced
  `shipPointsLine`). `MAX_WEEK_POINTS = pointsForRank(1, 1)`.
- **Step 6 (the draft):** `submit-kit.ts draftKit`: `draftReadyLine` (filled of shown fields), "You add: <missing>.", the
  caller's note (Base: the Builder Codes words), the continues line; copy-and-paste drafts keep the answers block and the
  https:// paste line; a prefilled draft shows only answers that didn't fit the link (`PASTE_LEFT`) and `OPEN_PREFILLED`;
  `SENT_ASK` "Sent it?". No ship log block, no points line (no points for applying).
- **Step 7 (Monday):** `momentHead` ("Week 4 done. You're now #3: +70 points."), `MOMENT_POST_HEAD`, `momentPost` (the X post
  as plain quoted text, no intent link, the page in full: the reply's one https link), `MOMENT_ASK`. Fix round 1: the
  points clause shows only when the yes pays (`LastWeek.facts`, week-facts.ts hasFacts, and no ledger row yet:
  `points.ts weekAwarded`); else "Week 4 done. You're now #3.". `weekly-moment.ts weekNumber` (code weeks in a row up to last
  week, 0: "Last week done."), `momentPlace` (still / now / under the pool "on EarnKit"), `points.ts weekPointsNow` (what
  the yes awards now, as `awardWeekPoints`). `momentLines` stays for the Monday email.
- **Agent notes** say "the question" (not "the last line"): the points line is last now (`mcp.ts` instructions, find,
  tell and score descriptions, every move_up note, `EARN_NOTE`).
- Removed: `BENCH_HEADS`, `NOT_ON_BENCH`, `NO_MONEY_LINE`, `noFitLine`, `fitsLine`, `ideasLine`, `needsLine`,
  `shippingStand`, `SHIP_STEP`, `bestFitLine`, `shareAsk`, `CONNECT_HEAD`, `bench-find.ts fundNeeds`/`needsPicks`/`NEEDS_MAX`,
  and the `needs`, `idea` and `points` FundLine kinds. Tests: `bench-reply.test.ts` (each reply, pure),
  `v31-reply-copy.test.ts` (the journey through mcpCall), `v31-draft.test.ts` (step 6).

## v3.1 reply fixes for the vibecoding founder (owner-approved, 2026-10-22)

The ideal user is a non-technical solo founder who vibecodes (Lovable, Bolt, v0, Replit). Changes on top of Task 16
(exact lines in `v3.1-founder-power-user.md`, "Reply copy changes 2026-10-22"):

- **No points in the first two replies.** `benchReply` drops the points line from signed out (step 1) and step 2;
  `POINTS_ON_SIGN_IN` and `POINTS_ON_CONNECT` are gone. Every later points line stays.
- **The honest hook.** `OpenGrant` gains `chain` (`base-qualify.ts grantOf`: the program's one chain's name, null for
  any chain or several); `bench-reply.ts grantHook` writes "Base pays up to $5,000 for apps on Base." (any chain: "for
  apps."). `introWhat` uses it; `bench-find.ts openGrant` builds it with `grantOf`.
- **Step 2 in plain words.** `pickRepoAsk`: "Step 2 of 2: connect your app's code on GitHub. ..." plus `NO_GITHUB_HINT`
  (Lovable and Bolt only, the confirmed ones in `v3.1-install-research.md`; a statement so the reply keeps one
  question). App pages (`github-app.ts`): `PICK_HINT` "Choose Only select repositories and pick your app." (GitHub's
  own labels) in `PICK_PAGE.none` and `APP_PAGE.notListed`; `TEMPLATE_HINT` in `PICK_PAGE.noneCounted`;
  `VARIANT_COPY.copy` carries the same way out as a statement.
- **No fit leads to money (`qualify`).** A ranked reply whose step would be ship, with no fit at all (`o.fits` empty),
  asks `qualifyAsk` instead when `base-qualify.ts qualifyOffer` returns an offer: Base Builder Grants is in the shown
  cards (`showable`: open, listed, not entered or hidden) with an award, not declined within `DECLINE_MS`
  (`declined['qualify:<key>']`), and not in `builder_program_status`. Its three steps come only from the program
  file's rules (`QUALIFY_STEPS`: base, codes, use). Each step's status (`qualifyStatus`) comes from the matcher's own
  verdict for the remembered repo (`installations.fit_repos`, `alerts.ts programVerdict` = applyBuilderFacts +
  matchRepo): base is met when the matcher credits a Base deploy and has no `mainnet_deploy` missing, use is met only on
  a likely verdict and missing on `live_url`/`real_users`; codes from `repo_builder_codes` (only for an App-proven
  repo). A step is dropped only when known met, named missing (`qualifyMissing`) only when known missing; every step met
  is no offer (`qualifyPlan` null: never a claim of eligibility). The reply: standing, `grantHook`, the missing line, the
  question ("Want the 3 steps to qualify for Base's $5,000 grant?"; fewer: "toward"), the ship points line; the
  upcoming program's line yields to it (`moneyLine({ upcoming: false })`). The stored ask carries `qualify: { grant,
  steps }`; `benchMoveUp` kind `qualify` (taken once) answers a yes with `qualifySteps` (numbered lines, the Builder
  Codes guide `BUILDER_CODES_GUIDE` as the one link, `QUALIFY_NEXT`, `QUALIFY_HELP_ASK`) and `QUALIFY_STEPS_NOTE`; a no
  keeps it away 30 days and the ship step returns. Closed, unlisted or hidden: the ship step as before. Fix round 1: a
  yes is remembered too (`standing_seen.qualify_given[<lowercase key>]`, held back `DECLINE_MS`); the missing line shows
  only when every remaining step is known missing (`qualifyMissing(name, { missing, steps })`), so it names exactly the
  steps the question counts; `qualifyOffer` starts `refreshBuilderCodes` for an App-proven repo (background, once a day
  through `repo_builder_codes_attempts`, `codesFetch` injectable), backing `QUALIFY_NEXT` ("I check your code for
  Builder Codes and offer to draft your application once Base fits.").
- **Private repo titles (`titles`).** `updates.ts titlesAskDue`: the one project is App-proven, GitHub said it is
  private (proof read: `gh_repo_id` set and `public_at` null, or the latest reading's `signals.private`) and it doesn't
  read public now, it is the main project (`mainProjectOf`, the project `setShipTitles` turns on), `ship_titles_at` is
  null and `standing_seen.titles_asked` is unset; `takeTitlesAsk` claims it once.
  Asked in the connect yes reply when no draft is offered (`bench-find.ts connectTitles`, before the email question),
  else as a ranked step after share and before qualify/ship. `TITLES_ASK` "Show your commit titles on your page? Your
  code stays private."; a yes is `setShipTitles(id, { titles: true })` (the same path as tell `updates { titles }`).
- Ranked order is now connect, apply, backing, share, titles, qualify or ship. Tests: `v31-reply-fixes.test.ts` (pure
  copy, statuses from real `matchRepo` verdicts, closed fallback, and the qualify and titles journeys through mcpCall);
  `fixtures/ranked-step.ts endsOnRankedStep` accepts the qualify question.

## v3.1 replies: P0 Tasks 2, 3, 5, 6, 7, 8 and 9 (Tasks 1, 4, 10 and 16 are above)

Release 1 of v3.1 (spec `v3.1-founder-power-user.md`, plan `v3.1-plan-p0.md`). Tasks 1, 4, 10 and 16 have their own sections
above; these are the rest, in task order. Tasks 11 to 15 (Monday X post, Monday email, copy sweep) are in "v3.1 release 2" at the end of the v3.1 sections.

- **Task 2 (F2): the connect question says where the weeks go.** `connectAsk(weeks, page)` (`bench-reply.ts`, re-exported by
  `connect-moment.ts`) replaced "Does this look right? Yes posts them." (`CONNECT_ASK`, gone). Task 16 later rewrote the
  whole connect reply (see its Step 3); the weeks list is gone.
- **Task 3 (F3, R14, R16): no rank below 10 ranked builders.** `rank.ts RANK_MIN_POOL = 10` and `shownRankLine`: under it,
  replies, news, the weekly target and moment, the X share post, the Monday email subject, the profile (a dash for Rank), the
  card, the page meta and the badge show the Shipping score and no rank; a chain's line is held to its own chain pool. The
  leaderboard list and `/api/builders/<handle>.json` keep the number. Test fixtures pad the pool to 10
  (`fixtures/rank-pool.ts padPool`). The v3.1 site later hid the leaderboard's "#N" and pills under 10 too (S14).
- **Task 5 (F4): the weekly target names the rank, never the points.** `weekly-target.ts`: "Ship code this week to pass #2." /
  "to move toward #2." / "to hold #1." / "Done this week."; "Ship code this week." with no rank (under the pool, or no
  Shipping row). The page voice: "Code this week passes #2." / "Shipped this week.". `weekStartLine` follows. Replaces the
  "+14 points" lines of launch ready L5 and I3.
- **Task 6 (spec 3.2): Best fit leads, rolling programs are offered, apply before backing.** `bench-find.ts applyCandidates`
  (not entered, hidden, declined for 30 days or told; the dated fits closing within `APPLY_WINDOW_DAYS` in deadline order,
  else the rolling fits in `byRelevance` order) feeds `claimApply` (the apply ask, once a program) and the `BestFit` (the
  first candidate, `bestFitLine`); the backing offer waits while an apply ask is shown. `applyAsk(title, when | null)` says
  "is open now (rolling)" for no deadline. Task 16 kept the logic and moved the Best fit into `moneyLine`.
- **Task 7 (spec 3.3): Builder Codes for Base Builder Grants.** `builder-codes-check.ts checkBuilderCodes` reads the
  one project's repo through the read-only App (the tree, then at most `BUILDER_CODES_FILES` = 30 code files, the likeliest
  first, files over 1 MB and text-less paths skipped), looks for the ERC-8021 suffix (`builder-code.ts builderCodesIn`) and
  keeps the answer in `repo_builder_codes` for a day, tried at most once a day per repo (`codesTried`, one at a time). A failed
  read answers null and stores nothing, so the reply then says nothing about Builder Codes. `BUILDER_CODES_FIRST` is the
  not-found sentence ("First step for Base: add Builder Codes."). Security fix: the repo comes only from one this builder
  proved through the App (`appProvenRepo`: `builder_sources`, proof `github_app`, state `verified`), never from tool input.
- **Task 8 (spec 3.5): unlisted programs and multi_choice.** `programs.status` also allows `unlisted` (`db/schema.sql`: the
  CHECK is widened at its first add and again in the appended block, since `schema-rerun.test.ts` needs every repeated add to
  allow the same values): an off-thesis open program keeps its row for old entries, but nothing lists, matches, offers, counts
  or guides it (`program-file.ts`, `programs.ts`, `landing.ts`, `leaderboard.ts`, `present.ts`, `also-qualifies.ts`). Avalanche
  Team1 and ETHGlobal Mumbai are unlisted. A `multi_choice` requirement (`submit-kit.ts`, `submission.ts`) is a checkbox
  question whose answer is the picked options joined by "; "; Base's primary challenge prefills (`primary_challenge`).
  `programs/README.md` documents both.
- **Task 9 (spec 3.2): prepare drafts the application and never submits.** On a curated program `tools.ts prepare` goes to
  `draft-application.ts draftApplication`: the first call without answers hands the agent the requirements
  (`DRAFT_FIRST_NOTE`); the second shows the answers, Base's Builder Codes line (the check awaited up to
  `BUILDER_CODES_WAIT_MS`, 8 s) and how to send: one prefilled Google Form link for Base Builder Grants, copy and paste with
  the form link for the rest (`submit-kit.ts draftKit`). The builder's page goes into the first answered free-text answer once
  (`withPageLink`, within `max_chars`). Answers show without their scheme (D7) and a paste draft says "Add https:// to each link
  when you paste." An unlisted or upcoming program is refused ("not open yet", R15), by `get_program` too, never shown as
  "closed". Nothing is recorded on prepare. Tests: `v31-draft.test.ts`, `v31-builder-codes.test.ts`, `v31-programs.test.ts`.
- **Tests.** `v31-fit-gates`, `v31-reply-trim`, `v31-rank-pool`, `v31-best-fit`, `v31-builder-codes`, `v31-programs`, `v31-draft`,
  `v31-mcp-surface`, `v31-reply-copy`, `bench-reply.test.ts`.

## v3.1 site Task 1: tokens, Kaftan, paintings, primitives

- **Tokens.** `lib/earnkit/site-theme.ts SITE` holds the owner-approved canvas colours (deltas S11 `onBlueSoft`
  `#F4F7FF` and S12 `dim` `#747C97` applied). `app/globals.css` mirrors each as `--ek-s-<kebab>`; Tailwind reads them as
  `s-<kebab>` (no raw hex in `tailwind.config.ts`; no `/NN` modifier on a token class). The v3 `--ek-p-*` tokens stay for
  the pages not yet redesigned.
- **Body.** `background-color: var(--ek-s-page)`; a page that renders `[data-ek-deep]` (landing, feed) turns the body
  `--ek-s-deep` via `body:has(...)`.
- **Type.** Kaftan Serif (`app/fonts/kaftan-serif.woff2`, `--font-kaftan`) through `.ek-serif` (font-size-adjust 0.36,
  weight 400) or `<Serif>`; Funnel Sans stays the body font.
- **Paintings.** Pre-sized JPEGs in `public/art` (hero 800/1600/3200, footer 700/1400/2800) for a plain `<img srcSet>`;
  no Next image optimizer.
- **Motion.** `.ek-drift`, `.ek-pulse`, `.ek-twinkle` all stop under `prefers-reduced-motion`; pointer components also
  check `useReducedMotion()`.
- **Primitives** in `app/components/site/` (see code-map). Test: `v31-site-tokens.test.ts`.

## v3.1 site Task 5: nav, footer, install sheet, programs page removal

- **Chrome.** `Header` (Nav board) and `Footer` (`variant: 'full' | 'minimal'`, Foot board) are rewritten in place on
  the SITE tokens; every page keeps its import. The footer painting is a plain lazy `<img srcSet>` (no image optimizer);
  `FooterLight` writes the light's style on pointer moves without re-rendering and renders nothing under reduced motion
  or `(hover: none)`. New tokens: `footLine`, `footButton`, `footFade`, `footGlow`, `footGlowMid`, `footCtaGlow`.
- **Links.** `FOOTER_COLUMNS` is Leaderboard, Feed, Docs, Terms and EarnKit's X (`X` now lives in
  `lib/earnkit/footer-links.ts`, re-exported by `app/lib/links.ts`); `EXTERNAL_ALLOW` is that X url only. The email,
  `@jenilt` and "For sponsors" left the footer.
- **Programs (W10).** `/programs` is a `permanentRedirect('/#earn')` (308); guides stay at `/programs/<id>` and in the
  sitemap; a guide's "All programs" links `/#earn`; the shell header (`brand-page.ts`) lost its Programs link.
- **Install sheet.** Same behaviour and tabs, restyled: `bg-s-panel` sheet rounded 32px over `bg-s-scrim`, SegTabs pill
  tabs, code blocks `bg-s-page rounded-[22px]`.
- **Harness.** `.superpowers/sdd/v3.1-plan-site/seed-site.mts` (scratch DB `earnkit_v31_site` only) and `shoot.mjs`
  (Playwright screenshots at 1440 and 390 plus phone checks) are untracked tools for Tasks 5 to 11.

## v3.1 site Task 6: the landing

- **Composition (`HomeView`, Landing board).** A `data-ek-deep` root (the body turns `s-deep`) holding a
  `PAGE_COL_WIDE` column (`gap-[72px] md:gap-32`): `landing/Hero`, `landing/Steps`, `landing/Activity`,
  `landing/Opportunities` (the `#earn` anchor that `/programs` and the hero chip land on), then the full `Footer`.
  `landing === null` renders the hero (no chip) and the steps only. Backed by left (S19).
- **Hero.** Bottom-aligned words over a readability shade: the chip (`landing.open_chip`, to `#earn`; install fixes
  2026-10-22: only programs open to Base builders, `openToBase`, "$5K in Base grants open now", none when none; 44px on a phone,
  36px from md), the one-line Kaftan title (`clamp(36px,9.6vw,96px)`, `whitespace-nowrap`), the sub line, the white
  `CTA_INSTALL` button (opens the install sheet) and the four `AgentMark`s (now `currentColor` + `text-s-text`).
- **HeroArt (client).** One `ek-drift` layer (`data-hero-art`) holding the painting (`<img srcSet>` of the three
  pre-sized files, `fetchPriority="high"`) and an SVG in the painting's 1600x1036 space (the files are that aspect, so
  `object-cover` and `xMidYMid slice` frame both alike): the board's arch `clipPath` (`ARCH_PATH`), a dusk tint at
  rest and a 300-unit sunset circle placed at the pointer through `getScreenCTM().inverse()`. Pointer moves (mouse
  only) write styles directly: glow opacity 1 (700ms) and a `translate(px*-8, py*-6)` drift (1200ms). Under
  `useReducedMotion()` no listener is attached.
- **Steps / Activity / Opportunities.** Steps (Connect, Ship, Get funded; titles aligned under one 56px icon box) append "Fans can back you with your coin." only with `raisingEnabled()` (owner batch 2026-10-23: "Add EarnKit to your agent. Connect your GitHub.", "We score how steadily you ship, every day.", "We find grants you fit. Your agent writes the application."). Activity is
  `landing.activity` (W1) as cards (photo, name to `pagePath`, `XHandle`, `ScoreText` when scored, summary, else text,
  else chips; meta `activityMeta`: project, week label, commits when above 0); one or two cards add the invite card;
  none hides the section. Opportunities shows `landingPrograms` (W2) as whole-card guide links in the board's colour
  order (blue, step, rust, step); big number `tile.big`, else the prize text; logo on a white tile or the monogram.
- **Tokens.** `heroBase`, `heroShade*`, `heroTitleShadow`, `ctaGlow`, `ctaGlowHover`, `dusk*`, `sunset*`, `blueLine`,
  `rustLine`. `BENCH_TOP_EMPTY` moved to `site-copy.ts`; `BenchView` uses `leaderboardLine`. The OG image's v3 words
  (`BENCH_HERO_*`) live in `scripts/og.mts` (W11).
- **Deleted.** `sections/{Hero,FeaturedCard,BenchTop,FeedRows,ProgramRow,BackedBy}.tsx`. `sections/ProgramCards.tsx` is a
  shim (money line + `Opportunities`) kept only because `copy-review.test.ts` (P0-owned) imports it; nothing under
  `app/` renders it. Test: `v31-site-landing.test.ts`.

## v3.1 site Task 3: profile reads

- **One module.** `lib/earnkit/site-data.ts profileSite(builderId, d, now)` adds what the v3.1 profile shows beyond
  `profileData`; every part catches its own error (`[site] <part>`) and falls back to null, 0 or [].
- **Last shipped / this week.** The one project's verified repo source, its `week-facts.ts shipReading` (now exported):
  `signals.pushed_at` (null if absent, unparsable, in the future, or the project not Bench-confirmed) and
  `signals.commit_counts[this ISO week]` through `person-score.ts weekCounts`.
- **Highlights (W8, redesigned 2026-10-22; rebuilt 2026-10-25, see "v3.1 Highlights competence" below: the rows here
  for contracts on Base, Builder Code, the repo's commit count and "Applied to" are gone).** Every item is a fact a judge can check in one click and links its proof
  (`Highlight.href`, new tab, `rel="noopener noreferrer"`); at most 5, in order, each only when true:
  1. live: "Live at <host>" for a verified site source whose newest ok reading is up (down at its last read: no item;
     a failed read, ok false, is EarnKit's failure and never hides it),
     sub "Up N of the last D days checked" (`liveSub`: D the days of the last 30 EarnKit read the site, a day not read
     counts nowhere; from 7), else "Since <Mon YYYY>"; one query; links the site's https origin (`siteHref`). Owner
     ruling (fix round 1): a proven site shows though the repo is private; only a hidden repo's GitHub-hosted site is
     left out (`shownProjects`' link rule).
  2. contract: "N contracts on Base" (verified `base:` sources plus EarnKit `contract_deploys`, distinct), sub "First
     deployed <Mon YYYY>" only when every counted contract has a known time (`contract_deploys.created_at`;
     `builder_sources.deployed_at`, kept by `sources.ts claimContract` at verification and backfilled by
     `contract-origins.ts`), else "Verified onchain"; links Basescan (`basescanHref`), the earliest when dated.
  3. code: "Builder Code in the repo" (Base projects, App-proven repo, stored answer only), sub "Base, checked <Mon D>";
     links the file (`repo_builder_codes.path`, `githubFileHref`, the ship reading's `default_branch`, else `HEAD`).
  4. repo: "Building <name> since <Mon YYYY>" from the ship reading's `created_at`, sub "<N> commits" (or "... in the
     last year" for a repo older than the read's 52 weeks) from `commits_year` (GraphQL `history.totalCount`, already
     asked; `person-github.ts repoFrom` now keeps it and `default_branch`); a hidden repo's name never shows ("Building since").
     Owner batch 2026-10-23: a hidden repo with a proven site reads as its host ("Building earnkit.com since Dec 2024",
     `page-data.ts safeName`), and `site-data.ts mainReading` fills `commits_year` from the newest reading that has it
     when the ship reading predates the field (production showed no sub until its first daily read with the count).
  5. won/applied (`page-data.ts projectProgramsDated`, at most 2, sub "<Mon YYYY>"), linked to `/programs/<id>` only
     when that guide page exists (`guide-pages.ts guideProgramSql`, the predicate `landing.ts readGuideIds` uses: a
     file program, not a campaign, not unlisted). A guide link opens in the same tab; other proof in a new tab.
  A repo link (items 3 and 4) needs the repo shown public and a reading that is not private: never a link to a 404. No
  confirmed project: one "On EarnKit since" item; a confirmed one with none of the five: "On EarnKit since", "On the
  leaderboard". The weeks-in-a-row line moved out (the Streak card owns it). A hidden repo's site is left out when its
  host is GitHub's or carries the repo name.
- **Builder Codes daily.** `cron.ts runCron` runs `builder-codes-check.ts runBuilderCodes` (GitHub App on) after the
  weekly email, in its own slice (`builderCodesSliceEnd`, at most `BUILDER_CODES_SLICE_MS` = 1 minute): the App-proven
  repos of Base projects not attempted within the day and whose stored answer is missing or a day old
  (`builderCodesDue`, at most `BUILDER_CODES_PER_RUN` = 50). Every attempt, success or failure, is stored
  (`repo_builder_codes_attempts`, claimed atomically by `claimAttempt`), so a failing repo waits a day and never holds
  a slot, and find, prepare and the cron share one attempt a day across processes. Answer: `builder_codes: { due,
  checked, found }`.
- **Contract origins backfill.** `contract-origins.ts backfillContractOrigins`, after the email in the same slice rule:
  verified Base contract sources without `deployed_at`, at most 20 a run, Blockscout's creation time (free), each asked
  once or again after a week without a time (`builder_sources.origin_read_at`). Answer: `contract_origins: { due, dated }`.
- **Standing pill.** Only on a ranked page; Base pool percentile when on Base with 10+ there, else the whole pool from
  10; metal from `site-copy.ts standingTier` (none outside the top 25%); `title` is the place, "#N of M builders" (" on Base" for the Base pool; `rank.ts rankLine` only guards validity).
- **Backer bars.** `coin_backers.first_block` timed as `BASE_GENESIS_UNIX + 2 * block` (Base's fixed 2s blocks; no RPC
  at runtime), bucketed into the last 12 ISO weeks.
- **Shape changes.** `ProfileCard.commits` (facts.shipped_code.n, from 1); `projectProgramsDated` (`toldApplied` reads
  `max(at)`). Test: `v31-site-data.test.ts`.


## v3.1 site Task 7: the profile

The builder page (`app/[handle]/BenchProfileView.tsx` with `app/[handle]/site/*`) is the owner-approved Profile board:
a blue hero, navy Shipping score, rust Streak, white Activity, the Token card and Highlights, then the minimal footer.
`handle-view.tsx` BenchPage reads `profileData` then `profileSite` (Task 3) and passes `?page=` (3 weeks a page). Every
rank on the page is `site.standing` (null under RANK_MIN_POOL, so no pill and no "#N"); Backing is only `site.token`
(fails closed, never EarnKit's own repo, only while `raisingEnabled()`). Points, Originality, the 52-week grid, Earned,
tabs (`?tab=` ignored) and the README badge left the page; the badge, share and JSON routes stay. Confirming or no
project: one calm line in the panel, no score, a 0-week streak and only the dashed next-update line.

## v3.1 site Task 8: the leaderboard

`/leaderboard` (`app/leaderboard/BenchView.tsx`, `Podium.tsx`, `BenchRowItem.tsx`) is the owner-approved Leaderboard
board: the Kaftan H1 with `leaderboardLine(count)`, a SegTabs rail (All, Base when a Base project is ranked, Backed only
while `raisingEnabled()`; old `?chain=arc` and `?weekly=1` links still filter and mark no tab, W3), the podium (page 1's
first three rows on blue, navy and rust cards with gold, silver and bronze place pills; the name is a stretched link to
the page, the @handle its own X link), then the rest of the page on one panel: each row one link (place, photo, name,
X glyph and @handle as text, project, Backed tag, streak, score in its band colour). `?page=N` pages the one cached
read, 20 rows a page (`LEADERBOARD_PAGE`, clamped). Under `RANK_MIN_POOL` ranked builders no "#N" and no metal pill
(S14). Backing: `bench-data.ts benchRows` sets `row.backing` only while raising is on and never for EarnKit's own repos
(`site-data.ts tokenAllowed`), and the Backed filter drops those rows too. Test: `v31-site-leaderboard.test.ts`.

## v3.1 site Task 9: the feed

`/feed` (`app/feed/FeedView.tsx`, `FeedStats.tsx`, `FeedRow.tsx`) is the owner-approved Feed board on the deep page
colour in the 1240px column: the Kaftan H1 with a step-tone SegTabs rail of the newest `FEED_TABS` (3) weeks
(`?week=<monday>`; an unknown monday falls back to the newest, a 4th week works by URL and marks no tab, W4), the
selected week's four stat cards (blue, step, rust, green gradients: builders shipped, commits compact, went live,
applications sent; `site-data.ts feedWeekStats`, read once per request in `page.tsx`, cached per week as
`['feed-stats-v31', monday]`, 300s, `PROFILE_TAG`; a failed read hides the cards), then the week's cards as full-width
dark rows (`FeedRow`: photo, name link to the page, @handle link to X, `project · N commits`, the summary else the note
else the chips, the score in its band colour), `FEED_PAGE` (10) a page with the centred Newer / numbers / Older pager
(`?page=N`, clamped). No weeks: `FEED_EMPTY` on a neutral card with "See the leaderboard". `FEED_LINE` is only the
page description now. Test: `v31-site-feed.test.ts`.

## v3.1 site Task 10: docs, 404, guides and terms

`/docs` (`app/docs/DocsView.tsx`, `InstallCard.tsx`) is the Docs board in the 1200px column, rendered per request
(W9: `raisingEnabled()` is read at run time, no DB read). A panel side nav to the five anchors (a wrapping row above
the article below lg), the light install card (H1, `InstallCard`: agent tabs on a `SegTabs` 'light' rail in `AGENTS`
order, Grok Bot first, wrapping onto more rows; `AgentPanel` shows the agent's note, its steps (numbered from two), `agent.code ?? MCP_URL`, then `after` /
`afterCode`, each block with a copy button that announces "Copied" in an `aria-live` region; no command text lives
outside `agents.tsx`), three numbered steps, "No GitHub yet?" (`#github`, `DOCS_GITHUB`: Lovable and Bolt steps, the
v0 note "Publish so your work reaches main", which matters because EarnKit reads the default branch), the navy / rust / panel cards (`#week`, `#score` with `LIVE_BONUS`,
`#money`: "Programs" and no Backing sentence while raising is off), and the blue selectors strip with the builder JSON
URL. The 404 is the NotFound board's rust card with the full footer. The program guide and terms pages only moved to
`PAGE_COL` with Kaftan titles (structure unchanged; terms keeps the risk disclosure). Test: `v31-site-docs.test.ts`.

## v3.1 site

The owner-approved redesign (2026-10-21; design `v3.1-site-design.md`, plan `v3.1-plan-site.md`, boards in
`v3.1-site-boards/`, commits a9b72676 to d4a8757d). The per-task sections above ("v3.1 site Task N") hold the detail; this
section is the whole picture. The design rules are in `apps/frontend/DESIGN.md`.

- **Tokens and fonts.** `lib/earnkit/site-theme.ts SITE` is the one colour source (`--ek-s-<kebab>` in `globals.css`, Tailwind
  `s-<kebab>`, no raw hex, no `/NN` modifier); `app/components/site/ui.ts` holds the class strings (cards, pills, columns,
  titles, metals). Kaftan Serif (`app/fonts/kaftan-serif.woff2`, `.ek-serif`, `font-size-adjust: 0.36`) is only for names,
  headlines, big numbers and section titles; Funnel Sans is the body. The v3 `--ek-p-*` tokens stay for the shell pages.
- **Art.** Two public-domain paintings (Eckersberg for the hero, Panini for the footer) as pre-sized JPEGs in `public/art`
  (hero 800/1600/3200, footer 700/1400/2800) and a plain `<img srcSet>`. No Next image optimizer: it would add a paid
  transformation service and a second cache, and the three widths per painting are enough for every screen. The hero's
  `fetchPriority` is high, the footer lazy; `ART_CREDIT` names both painters.
- **Pages, components and data.**

| Page | Components | Data |
|---|---|---|
| Nav, footer | `Header`, `NavLinks`, `Footer` (`full` / `minimal`), `FooterLight`, `AddToAgent` sheet | `footer-links.ts` (Leaderboard, Feed, Docs, Terms, X) |
| Landing | `landing/{Hero,HeroArt,Steps,Activity,Opportunities}` | `readLanding`: `open_chip`, `activity` (feed's first 3, W1), `tiles` with `kind`, `big`, `when` (S1, S2), `landingPrograms` (first 4 open, W2) |
| Profile | `[handle]/site/{HeroCard,ScoreCard,StreakCard,ActivityCard,TokenCard,HighlightsCard}` | `profileData` then `profileSite` (last shipped S6, this week S7, highlights W8, standing S5, backer weeks S8) |
| Leaderboard | `Podium`, `BenchRowItem`, `SegTabs` filters | `benchRows` (adds `streak`), 20 rows a page (W3) |
| Feed | `FeedStats`, `FeedRow`, `SegTabs` week tabs | `feedRows` (adds `score`, `commits`), `feedWeekStats` (W4, W5) |
| Docs, 404, guides, terms | `DocsView`, `InstallCard`, the NotFound rust card; guides and terms move to `PAGE_COL` | `docs-copy.ts`; no DB (W9) |

- **New reads and their fallbacks.** `site-data.ts profileSite` catches every part (`[site] <part>`) and falls back to null,
  0 or []: no last-shipped line, no commits line, no highlights, no standing pill, empty backer bars. The Token card fails
  closed (null). `feedWeekStats` is cached per week (`feed-stats-v31`, 300s, `PROFILE_TAG`) and a failed read hides the four
  cards. `readLanding` rejects when the database is down and the page renders the hero and steps only (the landing cache key
  is `landing-v31-<raising|off>`); a feed with fewer than 3 cards adds the invite card, none hides Activity; a chip of $0 is
  hidden. `site-streak.ts withThisWeek` makes the grid and the streak count agree (Highlights no longer repeats the streak).
- **The Backing guard.** The Token card, the leaderboard's Backed filter and the Backed tag exist only while `raisingEnabled()`
  (`EARNKIT_RAISING`) and never for EarnKit's own repos (`site-data.ts tokenAllowed`, `bench-data.ts benchRows`). Docs reads the
  flag per request. A page never offers Backing for `earnkitai/earnkit`.
- **The pool rule.** `RANK_MIN_POOL = 10` (`rank.ts`): under 10 ranked builders no "#N" and no metal pill on the profile or
  the leaderboard (S14), no standing pill (S5), "of N builders" only from 10 and points never on a page. The builder JSON
  keeps the numeric rank.
- **Removed.** Pages and routes: the programs list (`/programs` is a 308 to `/#earn`; guides stay at `/programs/<id>` and in the
  sitemap, W10), the profile's Money and Project tabs, the README badge block, the visitor CTA and the sources line (the
  badge, share and JSON routes stay; `?tab=` is ignored), the landing's "Backed by", the leaderboard's Arc, Robinhood and
  weekly filters (old links still filter, W3), the nav's Programs link. Files: see "v3.1 site" in the code map.
- **Rulings W1 to W11** (plan defaults, accepted by the owner 2026-10-21): W1 landing Activity is the feed's first 3 cards;
  W2 the landing shows the first 4 open programs by relevance; W3 leaderboard 20 rows a page, filters All, Base and Backed;
  W4 feed has 3 week tabs and 10 rows a page; W5 applications sent counts every builder's entry or told application;
  W6 profile Activity 3 weeks a page with a dashed next-update line; W7 project tile is the EarnKit mark or a letter on a
  colour by name; W8 Highlights order and at most 5; W9 docs is rendered per request; W10 `/programs` redirects to `/#earn`;
  W11 the shell pages, share card, badge and OG image keep the v3 look.
- **Deltas S1 to S20** (the canvas differed from the data or the rules; what shipped): S1 the program file's real title;
  S2 the big number is the per-winner max, else the prize text; S3 Alliance has a monogram tile until a logo is sourced
  (O1); S4 the chip says "grants" or "grants and prizes" by prize kind; S5 the standing pill is the Base pool percentile
  with 10+ there, else the whole pool; S6 "Shipped N ago" uses the ship reading's `pushed_at`, a green pulse only within 7
  days; S7 this week's commits come from `commit_counts` through the anti-backdating gate; S8 backer bars time blocks as
  `BASE_GENESIS_UNIX + 2 * block`; S9 contracts count verified sources plus EarnKit deploys, distinct, hidden at 0;
  S10 `projectProgramsDated` gives the applied date; S11 `onBlueSoft` `#F4F7FF` (4.57:1); S12 `dim` `#747C97` on page
  backgrounds only; S13 one set of score text colours; S14 no place labels or metals under 10 (the canvas wins over R16);
  S15 the profile loses tabs, badge, visitor row and sources line (O6); S16 the full footer adds Terms (O2); S17 the X link is
  `@EarnKitAI` (O3); S18 CTAs open the install sheet (O8); S19 "Backed by" is removed (O7); S20 Grok's mark ships in the hero
  row (O5). Owner decisions O1 to O10: every default shipped, the owner said "lmk when live"; the leaderboard filters drop
  Arc, Robinhood and "Shipping every week" (O10); the OG image keeps its v3 words (O9).
- **Verification.** `v31-site-sweep.test.ts` walks every page; the visual matrix (1440x900 and 390x844, no horizontal
  scroll, targets 44px or more) is in the SDD workspace `.superpowers/sdd/v3.1-plan-site/`.
- **QA UX batch (2026-10-22).** The footer's crop and headline offset keep the headline under the Pantheon's oculus at
  every width (no scrim); the leaderboard count line is the pool on the plain view and the filter's rows on a filtered one
  (`BenchView countLine`; the 10-ranked rule still reads the pool); the profile's two card rows share one grid template
  (one seam from 844px); the docs side nav lights the section in view (`DocsNav readingNow`); an unranked score ring is an
  empty track (no glyph); the phone hero's shade rises and its chip is dark glass (`heroChipPhone`); sideways rails fade a
  cut edge (`FadeRail`, `SegTabs RAIL_FADE`; install fixes 2026-10-22: the agent tabs wrap instead, in the sheet too); one 404 title "Not found | EarnKit" (`NOT_FOUND_METADATA` in `site-copy.ts`; a page that
  calls `notFound()` keeps its segment's metadata in the browser, so each such route returns it from `generateMetadata`). The feed's row order (pinned, then the week's progress points,
  then the live score; v2.13 R7 "ranked by verified progress") is intended and unchanged.

## v3.1 release 2 (since origin/main e2aaf5cc: Tasks 12, 14, 15 and the site UX batch)

Index of the release 1 checklist: F1 and `fitGate` (Task 1 section), F2 connect copy (Tasks 2, 3, 5, 6, 7, 8 and 9 section), F3
and `RANK_MIN_POOL` (same section, Task 3; the JSON keeps the rank), the trimmed reply (Task 4), the MCP surface (Task 10),
the rewritten replies (Task 16). They are not repeated here.

- **Task 12: the Monday email leads with money (spec 3.3, D5, D6).** `digest.ts DigestFacts.money` is a list of lines above the
  week, each only when true, never points; `digestBody` sends money lines alone as "Your EarnKit week" and still returns null
  with no money, no week and no lines. `moneyTexts(best, newBackerCount, now)` is the pure part: "{title} closes in N days. Your
  draft is one yes away." (a rolling program: "{title} is open (rolling), and your draft is one yes away."), then "N new
  backers this week." `moneyLines(person, now)` reads both and is none on a shared client or a per-login subscription (no
  verified person; `digestWeek` now also returns `person`). The Best fit is never also a new-program line.
- **`best-fit.ts bestFitFor(builderId, now)`.** The Best fit outside a reply: the one project (`main_project_key`), its apply
  candidates as score reads them (`bench-find.ts scoreApplies`), then `bestApplies` (programs the builder told EarnKit about
  or declined in 30 days dropped, then `applyCandidates`); the first is the Best fit. Gates match the reply's ranked state:
  signed in (`signedOutNow`) and the one project confirmed (`mainConfirmed`). Null on no project, not ranked, no fit or a read
  error; never throws. `bench-find.ts` exports `scoreApplies` (the open, listed, unhidden cards, the upcoming ones, the skip set
  and the apply candidates; investments included) and `bestApplies`; `benchView` now calls both, so reply and email cannot drift.
- **`newBackers(builderId, since)` and `coin_backers.first_seen_at`.** The backers first seen after `since` on the builder's
  coin whose backing is open (`raising.ts pillCoin`); 0 with `EARNKIT_RAISING` off, no coin or a read error. `indexBackers`
  stamps `first_seen_at`; the schema append adds the column, sets every pre-v3.1 row to `'epoch'` (never new), then
  `DEFAULT now()` and `NOT NULL`, idempotent (`db-check.mts` pins all of it, twice).
- **Task 14: the copy sweep.** `copy-review.test.ts v31Texts()` runs every new v3.1 string (replies, draft, email) through the
  v2.12.1 T8 rule, the banned words, the em dash scan and the line-start and one-link rules. Program words are exempt per
  label, not globally: the `allowed` map (label to exact words, e.g. "Base", "Builder Codes", the grant title, the owner-approved
  Task 16 phrases "pick the repo you're building" and "I read your commits every week") strips only those from only that string,
  and a test asserts every allowlist key is a real label.
- **Site UX batch (2026-10-22; details in the "v3.1 site" section).** Footer crop and headline offset; the leaderboard count
  line follows the filter while the 10-ranked rule keeps the pool; the profile's two card rows share one grid seam; the docs side
  nav lights the section in view (`DocsNav`); an unranked score ring is an empty track; the phone hero scrim and dark chip;
  `FadeRail` fades a sideways rail's cut edge while it overflows; one 404 title: `site-copy.ts NOT_FOUND_METADATA` is the
  `metadata` export of `not-found.tsx` and the `generateMetadata` of `p/[id]`, `campaigns/[slug]`, `programs/[id]`, `[handle]`
  (via `handleMetadata`) and `b/[slug]` (a missing slug; a reserved `/b/<handle>` goes through `handleMetadata`) when their
  entity is missing (a route that calls `notFound()` otherwise keeps the layout's title); the landing's program logos load
  lazily so none is preloaded unused.
- **Rulings.** Task 11 (Monday X post) is superseded by Task 16 step 7 (`MOMENT_POST_HEAD`, `momentPost`, no intent link, shipped
  in release 1). Task 13 (page hides: Originality, points, grid) is superseded by the site plan (profile rewritten; no
  Originality, points or grid on pages; docs has no points); the site design is frozen and owner-approved.

## v3.1 one-tap posts (design: v3.1-one-tap-posts.md, owner rulings 2026-10-22)

Backing volume comes from builders posting on X, and builders rarely post. EarnKit drafts the post; the reply's one link is
a short earnkit.com link that opens X's composer prefilled; the builder taps Post; the page link in the post unfurls that
post's own card. No X API, no model call, no new service. (Task 16 step 7's `MOMENT_POST_HEAD`/`momentPost` paste post is
gone; the Monday moment now carries a drafted post.)

- **Store (`post-drafts.ts`, `post_drafts`).** One row per draft, keyed by a 10-character base32 code. `moment` and
  `moment_key` (`weekly:<project>:<week>`, `went_live:<project>`, `won:<program>`, `coin_intro:<coin>`, `news:<project>:<at>`)
  drive the cooldowns; `asked` splits builder-asked drafts from offered ones; `proof_url` keeps the public page that verified
  an accepted, funded or won moment; `card` freezes the moment's facts for the card. Limits are checked and written under a
  per-person advisory lock: 1 offered a 7 days (went live, won and funded skip it, `PAST_OFFER_LIMIT`, controller ruling:
  a real win is never crowded out by an ordinary weekly), 1 asked a 24 hours, 3 in all a 7 days. A draft lives 14 days. A tap is a
  number only (no IP, no user agent): `taps` stops at 100, `first_tap_at` is kept, `post_tapped` is recorded once; visits
  carrying `?m=<code>` (Task 5) count apart, and from X apart, capped. Events `post_drafted` and `post_tapped` are in
  `EVENT_TYPES` and in every `builder_events_type_check` re-add.
- **Writer (`post-writer.ts`, pure).** Shapes from the design plus `this_week` ("This week: <summary>"), the second wordings
  `live_alt`, `won_alt`, `accepted`/`accepted_alt`, `funded`/`funded_alt`, and `coin_intro` (owner ruling 1: "<Name> has a coin
  now, $SYM. <n> weeks shipping so far.", the only shape that may name the ticker, once ever). Rotation: never one of the
  person's last 2 shapes and never the last post's opening word, relaxed to "not the last shape"; a weekly with nothing that
  fits is no post, an event takes its first wording that passes. The builder's note wins and goes in verbatim unless it holds
  a shill word, hashtag, cashtag or link (their own "!" stays). Every EarnKit-written text passes `postProblems` (the design's
  banned list, test-enforced) and stays under 200 characters.
- **Moments (`post-moments.ts`).** `offeredMoment` reads existing data in order: an announced win (`entry_outcomes` basis
  `announcement` with its `source_url`, the proof), going live (`week-facts.ts firstLiveAt`, extracted from `weekFactsFor`; it
  settles 2 days so a flapping site probe never posts, and is stale after 14), the coin intro (`raising.ts pillCoin`: launched,
  backing open, `EARNKIT_RAISING` on), last week (facts, the summary as the profile shows it via `weekLineRule`, the note via
  `checkUpdate`, the streak; milestones 4, 8, 12, 26, 52 fold in). `verifiedOutcomeCandidate` (owner ruling 3) drafts accepted,
  funded or won only with a proof link that `proofUrlOk` accepts: https, an X post (`x.com/<user>/status/<id>`) or the program's
  own site (its source or submission link's domain), never earnkit.com, the builder's own site or repo; EarnKit does not fetch
  it. `newsCandidate` is the builder's `tell update` text. Never a post: backing opened, applied, first users, a streak alone, a
  self-reported win without proof, a private project's name (name-led shapes need a shown name). `draftMoment` writes and stores.
- **Tap route (`app/[handle]/post-response.ts`).** `/<handle>/post/<code>` and `/b/<handle>/post/<code>`: the code is checked
  first, then the live row as the card checks it (hidden or unknown 404, rename 308 to the page's own post link), then the code
  must be this person's (else 404); expired goes to the page; otherwise the tap counts and a no-store 302 opens
  `x.com/intent/post` with the row's text and `https://earnkit.com<page>?m=<code>`, encoded with `URLSearchParams`. Nothing in
  the request reaches the target.
- **Card (`post-card.ts`, `app/[handle]/post-card-image.tsx`, Task 5).** `draftMoment` freezes the card's facts with the
  draft (`freezeCard`: the shown project, streak, Shipping while a score line shows, the rank phrase only from
  RANK_MIN_POOL, the 12 weeks of code; the moment's own facts on top). The post's page link carries `?m=<code>`:
  `handleMetadata(handle, post)` points og:image at `card.png?m=<code>` when the code is this person's (X caches a card
  per URL), and `cardResponse(handle, path, m)` draws `postCardView` (pure): `number` (weekly, went live, news),
  `milestone` (4, 8, 12, 26, 52 weeks) or `text` (verified win, acceptance, funding; coin intro). The Backing pill and
  backer count are live (`pillCoin`: EARNKIT_RAISING on; backers from 5); never a price; an accepted, funded or won draft
  without `proof_url` draws the page's card. Fonts: Kaftan Serif from `assets/fonts/kaftan-serif.woff` beside Funnel
  Display (`loadFonts`). A rename's 308 keeps a well-formed `?m`. A page open with `?m` counts a visit (`HandleView`
  `countVisit`: `visitFrom` on the user agent and referrer, bots never, t.co or x.com as from X; only the counts are kept).
- **Replies (`post-reply.ts`, `bench-reply.ts`, Task 6).** Copy (owner ruling 5: no points in post replies): the Monday
  moment is `Week <n> done. You're <now|still #r|on EarnKit>.` then either `Your post for X, with your page card:`,
  the post in quotes, `Post it in one tap: <short link>`, or `Your page: <page>`, then `Does last week look right?`
  (`weeklyPost`, numbered as the head names the week). Events (`eventPost`: an announced win, going live, the coin's
  intro; `offeredMoment(..., { weekly: false })`) reply `<head>` + the post block + `Want a different version?`
  (`eventHead`: "<Name> went live this week." (else "is live." past 7 days), "<Name> won the <program>.", "Backing is
  open on your page.", else "Added to your page."). Order in `benchView`: connect, a hot event (went live or won under
  `HOT_HOURS` 48 since it could be posted: `MomentCandidate.at`), apply, backing, the Monday moment, an event, titles,
  qualify, ship. The event stores its own ask (`bench_ask { kind: 'post', code, head, moment }`); the yes
  (`redraftAnswer`) drafts the next shape as asked, else `redraftLine` (today's limit, the only wording, or the builder's
  own words) with the post they have. `tell update { text }` posts to the page and, through `newsPost`, replies with the
  news as their post (24 h apart; else the update's own reply). `tell program_status` accepted, funded or won takes
  `proof_url` (MCP schema, `builder-memory.ts ProgramStatus`; the outcome notes tell the agent to open a public page and
  pass it); `outcomePost` drafts only with a link `proofUrlOk` accepts, else replies `PROOF_ASK` ("Send me a public link
  that shows it, like the program's post.") with `PROOF_NOTE`. `SHARE_NOTE` and `POST_NOTE` say "Show the post text
  exactly as given. Never rewrite it."
- **Fix round (review and security check, controller rulings).** Proof (`proofUrlOk`, owner ruling 3): only a page
  on the program's own listed host or a subdomain (www. aside; never a multi-label public suffix such as co.uk, never a
  shared host in `SHARED_HOSTS`: github.io, github.com, dorahacks.io, questbook.app, forms.gle, vercel.app, netlify.app,
  notion.site, medium.com, mirror.xyz, paragraph.xyz and kin, never ethglobal.com/showcase, never the listing page
  itself), or an X status by one of the program's `x_handles` (program file field, synced to `programs.x_handles`;
  empty everywhere today, so X proof is off until a handle is verified from a program's own source); never the
  builder's own X account, site or repo, never earnkit.com. An outcome post also needs `hasEntry` read before the tell
  is stored: an entry (`projects`), an application told (`builder_program_status.applied_at`, kept through later
  statuses), or a verified outcome drafted before; the award is only an announced prize (`entry_outcomes` basis
  announcement), never `prize_usd` from the agent. Notes: a builder's note with a hype word, two or more emoji, "!!",
  an em dash or a link falls back to EarnKit's wording. Writer: `hasLink` (any word.letters host but `NOT_LINKS` such as
  Node.js), emails refused, a hashtag only as # then a letter, no @mention in EarnKit text, `lowered` only for a verb or a
  plain word ("Stripe", "New York" keep their case). Taps: `countsAsTap` ignores HEAD and unfurlers or scripts
  (`visitFrom`), no header kept. Moments: went live also needs the project up now (`upNow`: an up site reading within
  `UP_WITHIN_DAYS` 3, an EarnKit-hosted site serving, or a deployed contract); the coin intro only within 14 days of
  `coin_launched_at`; the moment's hold runs again inside `createDraft`'s per-person lock (`NewDraft.hold`); a different
  version only of the latest, unexpired draft. Replies: accepted or funded have no head (the reply starts at "Your post
  for X, with your page card:"); news asks "Want to change any words?" and its yes asks for new words (`NEWS_REWORD_NOTE`), which
  `tell update` then puts in the same draft (`rewordDraft`: same code, key and link). `events-redact` lists
  `post_drafts.card` and `post_drafts.proof_url`.
- **Stats (Task 7).** `/api/stats` adds `posts_drafted`, `posts_tapped` (taps > 0) and
  `backers_after_post` (distinct person and wallet first seen within 7 days after a first tap on an open backing; 0 while
  EARNKIT_RAISING is off; correlation only), people only (`notTest`); labels in `STATS_LABELS`; the route's cache key
  moved to `public-stats-posts`. Page opens from X (`post_drafts.x_visits`) are internal only (final review 4).
- **Proof ruling (security, 2026-10-23, owner batch fix wave).** A proof must name the builder. (a) `proof_hosts`
  entries are "host/path-prefix/" (`program-file.ts`: a lowercase host and a prefix ending in "/"; programs:check
  validates it): `post-moments.ts proofEntryMatches` matches that exact host (no www widening, no subdomain) and a path
  under the prefix, so user-content paths stay out. Today: base-builder-grants `["www.base.org/blog/"]`, base-batches-005 `["www.base.org/blog/"]`, a16z-speedrun `["speedrun.a16z.com/"]`. (b) A web
  proof is fetched (`outcome-proof.ts defaultProofFetch`: the guarded fetch, HTML, `LARGE_PAGE_MAX_BYTES`) and its
  page must name the builder (`namesBuilder`, last fix wave A): their verified X handle as "@handle" or an
  x.com/twitter.com link to it (3+ characters, never a word of the program's title or one of its `x_handles`), their
  verified site's host or their public repo's URL (github.com/owner/repo); never the project's name. (c) An X post is
  read through `https://publish.twitter.com/oembed?url=<status url>` (JSON, `OEMBED_MAX_BYTES`): `author_url` must be
  one of the program's `x_handles` and the post's own words (its first paragraph, never the attribution) must name the
  builder by the same rule. (d) Last fix wave B: `proofUrlOk` refuses a path with %2f, %5c or %2e (any case), a
  backslash, an empty or a dot segment, checked on the link as given; the stored and fetched link drops its query and
  fragment.
  Any fetch or parse failure fails closed (`proofNamesBuilder` false, 'no_proof'). `ToolContext.proofFetch` is test
  injection only. Agent-stated awards are never printed.
- **Final review fix wave (2026-10-23).** (1) Proof hosts are an owner-reviewed allowlist: program files may list
  `proof_hosts` (exact lowercase hosts, at most 5; `program-file.ts` refuses a shared host, a public suffix or
  earnkit.com via `submit-hosts.ts proofHostAllowed`, which now holds `SHARED_HOSTS` and `MULTI_SUFFIXES`), synced to
  `programs.proof_hosts`. `proofUrlOk` takes `ProofContext.proofHosts` and never derives a host from `source_url` or
  `submission_url` (those pages stay excluded as proof). A program with neither `proof_hosts` nor `x_handles` (all of
  them today) gives `verifiedOutcomeCandidate` 'no_proof_source', and `outcomePost` replies `OUTCOME_NOTED`
  ("Congrats. Saved.") instead of `PROOF_ASK`; its outcome posts come only from announced outcomes. (2) The writer's
  link rule exempts the project's shown name exactly (`postProblems(..., { name })`; never a name with a scheme, www. or
  a path), so a private repo named by its site host ("earnkit.com") gets every named shape. (3) `eventPost` drafts the
  first of `offeredMoments` that drafts (one that can't gives way to the next) and, when none can, remembers that in
  process for the UTC day under `eventStamp` (one query: coin launched or backing opened, announced outcome, hosted
  deploy, main project), so a quiet reply reads one stamp instead of about 10 queries; going live that settles later
  in the day waits for the next day. (4) `noteVisit` counts at most `VISIT_DAY_CAP` (20) opens per post per UTC day
  (`post_drafts.visit_day`, `day_visits`; nothing about the visitor stored). (5) EarnKit's post wording turns "?" into
  "."; a note with "?" falls back to EarnKit's wording (their news with "?" is no post). (6) `checkBuilderCodes` takes
  the cron slice's `deadline`: each read's timeout is min(10 s, time left) (`AbortSignal.any`), and no read starts past
  it. (7) `page-data.ts SHARED_PLATFORMS` adds the vibecoder hosts (lovable.app, lovable.dev, replit.dev, bolt.new,
  framer.website, framer.app, webflow.io, wixsite.com, carrd.co, railway.app, github.io and kin). (8) The page's
  redirects (another case, a rename, a reserved handle at the root, an old /b slug) keep `?m=<code>`. (10)
  `benchCardFacts`, `postCardFacts` and `personFacts` use `avatarUrl(x, github_login)` like the page.

### Site proof (v3.1, 2026-10-23)

- **Bug.** A site the agent reported (`proposed_by = 'agent'`, e.g. the owner's `https://earnkit.com` for
  `earnkitai/earnkit`) was read daily for display but could never be verified: the only site proofs were discovery's
  repo-linked sites (clue 3: an App-proven repo's homepage, CNAME, vercel.json or root wrangler.toml, verified
  `repo_link`), and the `earnkit.txt` check (clue 6) was removed from discovery in v2.12.1 S9 without a new home, so
  `siteOwnedByText` and `proveLinkedSite` had no callers. Discovery also runs only when queued (first find, wallet,
  sign-in, a new local repo), so a homepage set later was never matched. The profile then showed "Private project"
  (the private-name fallback needs a proven site host) and no "Live at" highlight.
- **Fix.** `sources.ts proveSite`, run from `readAll` for every due site right after its reading is written (sites
  are read after repos, so today's repo readings are in), for a proposed site only: (1) its origin equals
  `homepageOrigin` of the LATEST reading's `homepage` of the person's App-proven (`github_app`) repo of the site's own
  project (the repo's ref, without `github.com/`, equals the site's `project_key`; a `<owner>.github.io` site also
  needs that owner to be the repo's): verified `repo_link` (no GitHub call). Same origin only: www vs apex, another
  port or a look-alike host never match; a path on the homepage is fine. Else (2) it is up and its origin's
  `/earnkit.txt` (one fetch, `ReaderDeps.fetchText(url, { plainText: true })`, free, counted as `site`;
  `safeFetchText`'s `plainText` refuses any content-type but text/plain) has a `profile:` line equal to
  `profileCode(builder_id, origin)`: verified `earnkit_txt`. A 404 or any failure proves nothing (`soft`). The proof
  step has its own try/catch after the reading: a failure is logged and never drops or fails the reading; the
  deadline (`ScoreDeadline`) stops the run there. A verified site keeps its proof and is never fetched (both
  `repo_link` and, since the owner batch of 2026-10-23, `earnkit_txt` are scored by `person-score.ts`);
  `proveLinkedSite` was removed (fix wave 10). Safety kept: never from typed input alone (the code is an HMAC under
  `EARNKIT_AUTH_SECRET`, read from the live origin); `verifySource` verifies only a proposed row, never a `stale`
  one; rejected sites are not due (`read-cost.test.ts` tally unchanged). Discovery still never reads `earnkit.txt`
  (`score-tool.test.ts` 8.12). An `earnkit_txt` site is shown (the private repo's name falls back to its host,
  Highlights "Live at") and, since the owner batch of 2026-10-23, counts toward Shipping (`confirmed.ts
  isConfirmedSource`) while its daily re-check holds (`recheckSite`).
- **Owner proof file.** `apps/frontend/public/earnkit.txt` holds `profile: ae6e24ff180d7ee8` (builder 17, origin
  `https://earnkit.com`), served by Next at `/earnkit.txt` as `text/plain` (no middleware or proxy, no rewrites, no
  app route of that name; `site-proof.test.ts` SP9, SP10). `earnkit` joins `RESERVED_ROUTES` (every public name is
  reserved; a handle `earnkit` lives at `/b/earnkit`).
- **In production.** After deploy, the first hourly cron run that reads the site (once per UTC day: the same day
  if it was not yet read that day, else the next UTC day's first run) verifies `https://earnkit.com` `earnkit_txt`;
  the same run's `score` step rescores, so the profile names the project by its host and Highlights gets "Live at".

## v3.1 wallet proof (owner-approved 2026-10-23, with the review fix round)

Owner: "add wallet sign verification and ask in the onboarding after the profile is created as an optional step; this
way we get their wallet right after we created their profile and then we never have to ask it again unless they want
to change it to a different reward recipient." This answers A21: `/claim/wallet` is linked from the wallet step and
the change link.

- **The step** (`wallet-offer.ts walletOfferDue` + `takeWalletAsk`, `bench-reply.ts stateAsk` kind `wallet`): a ranked
  reply's step, once a person, for a claimed page with no wallet proven and a signing link. Order: connect, an event
  post, apply, backing, the weekly moment, then **wallet**, then titles, Base's steps, ship. `benchView` claims it
  (`standing_seen.wallet_asked`) only when the reply it builds carries it. Reply: the standing line, `Optional: prove
  your Base wallet so your contracts show on your page. One signature, no fee: <link>`, `Done, or want to skip it?`.
- **State, not the stored ask.** Every link given (the offer, `tell wallet: 'change'`) sets
  `standing_seen.wallet_link_at`. `move_up` kind `wallet` (or a stored wallet ask) goes to `answerWallet`: yes with a
  wallet proven since: `walletDone(short)` or, contracts only, `walletContractsOnly(short current)`; yes before:
  `walletNotYet` with a fresh link; no: `WALLET_SKIPPED`. Either ends the state (a later "done" is "Okay."). A reply in
  between changes nothing. `stand-view.ts takeNews` keeps every once-ask key (`apply_asked`, `titles_asked`,
  `qualify_given`, `wallet_asked`, `wallet_link_at`, `wallet_notice`).
- **A named wallet gets the link.** "Add my wallet" arrives as `tell wallet: 'change'`, `tell wallet: '<address>'` (any
  value) or `find wallet: '<address>'`. find answers a wallet that isn't the proven one with `walletChangeReply` in
  place of the status, only when that reply carries a link (page signed in with X); otherwise it only shows the
  wallet's wins, as before.
- **The recipient** (`person_wallets.recipient_at`; `wallet-proof.ts provenWallet`: the newest `recipient_at`, else the
  first proven wallet for rows from before the column). The first proof needs only the link. **Replacing a recipient
  needs a fresh X sign-in on the page as the same person**: `/claim/wallet/x?t=` (`walletXStart`) starts the v2.14 X
  sign-in (`x_signins` purpose `wallet`, bound to the link's use hash; a `__Host-ekwt-` cookie carries the link back),
  the callback (`x-install.ts xSignInCallback` -> `walletXSignedIn`) passes only `builder_profiles.x_user_id` and writes
  `wallet_x_checks`; a proof with that link (30 minutes) becomes the recipient. Security follow-up: the check is the
  signed-in browser's, not the link's: the callback sets a `__Host-ekwx-` cookie (HttpOnly, Secure, Lax, 30 minutes)
  holding a random secret and keeps only its hash (`wallet_x_checks.browser_hash`); the page skips the X step and the
  POST counts the check only with that cookie, and the proof uses it up (row deleted, cookie cleared). The same link
  from another browser, or with a wrong cookie, adds the wallet for contracts only. Without it the wallet is added for
  contracts only (`walletContractsLine`), so a leaked link never moves money. A changed recipient sets
  `standing_seen.wallet_notice`; the next find or score reply starts with `Your reward wallet changed to 0x12ab…abcd.`
  (`takeWalletNotice`), once. Replies and the done page show the short wallet only (`entry-text.ts shortWallet`).
- **Change reply** (`walletChangeReply`): with a recipient, `walletChangeX` ("Your rewards go to 0x12ab…abcd. To change
  that, sign in with X and sign with the new wallet ..."), then only when true `Your Base Builder Code stays on your
  first wallet.` (`builder_profiles.base_builder_code`; a re-proof never moves the first wallet's `proven_at`, which
  `attribution.ts` reads) and `Your coin's fees keep going to the wallet it launched with.` (a project with a
  `token_url`), then `Done?`.
- **The page** (`app/claim/wallet/page.tsx`, `WalletView.tsx`, `WalletSign.tsx`): a site page in the v3.1 design (the
  layout's nav, a `CARD_NEUTRAL` card, Kaftan title, the minimal footer). `walletPageState`: expired, used or busy is
  one line; else what happens, `Your contracts link to Basescan, where the deploying wallet is public.`, the X step when
  a recipient exists (`walletXLead`, Sign in with X, Sign for contracts only), the exact message, the buttons. The
  client signs with EIP-1193 `window.ethereum` (no SDK), POSTs to `/claim/wallet/proof` (`walletPost`: same Origin,
  JSON, the `walletProof` limit, 20 an hour per IP) and shows Done with the server's line. Page views and the X start:
  `walletPage` (120 an hour per IP). `/claim/wallet` now gets the site-wide frame-ancestors policy (`WALLET_EXCEPT`
  and the nonce route are gone).
- **Verification.** An EOA's signature is recovered locally (no RPC); otherwise viem `verifyMessage` on Base (ERC-1271,
  ERC-6492). viem reads a failed `eth_call` as "not valid", so a no is checked with `eth_blockNumber`: an RPC that is
  down is `Couldn't check that signature. Try again in a minute.` (503), never a mismatch, and spends nothing. Each
  link is used once; one person per wallet; the message names `@handle`, `earnkit.com/<handle>` and "moves no funds".
- **Recipient readers.** `coin-moments.ts coinWallet`/`coinYes` (`COIN_WALLET_ASK` only without one), `tools.ts
  walletMemory` (proven first) and campaign payout prefill.
- **Discovery.** A proof queues discovery; `walletCreations` claims the wallet's contracts (`deploy_wallet`, project key
  = ref); `person_wallets.base_since` (Blockscout txlist oldest first, read once per wallet; a wallet with none is read
  again after a week) is still kept, but since 2026-10-25 Highlights shows neither it nor these claims: its contracts row
  reads `wallet_contracts` on every chain (see "v3.1 Highlights competence").
- **At once, and without Blockscout (2026-10-25).** `walletPost` starts the person's discovery beside its reply
  (`PROOF_DISCOVER_MS`), so the page shows the wallet moments after signing. base.blockscout.com answers servers with a
  Cloudflare challenge: `campaigns.ts blockscoutUrl` uses the keyed API (`api.blockscout.com/8453`, `BLOCKSCOUT_API_KEY`,
  free key) for every explorer read when set; the first transaction falls back to the public RPC
  (`source-readers.ts walletFirstTxRpc`, a fanned-out nonce search). With no contract item, `site-data.ts walletItem`
  shows "On Base since <Mon YYYY>" alone.
- **Alchemy for wallet reads (2026-10-25).** With `ALCHEMY_API_KEY` (prod: a reference to buyback-cron's key),
  `alchemy.ts` serves `walletFirstTx` and the people-signals txlist (`alchemyTxList`: earliest sent and received,
  Etherscan-shaped) and `walletCreations` (`alchemyCreations`: sent transfers with an empty `to`, receipts for the
  address, at most `WALLET_CREATIONS_MAX`). Contract-deployer lookups, campaign and traction reads stay on Blockscout.
- **Profile hero.** With no repo link, the GitHub button opens `https://github.com/<github_login>`; with neither, hidden.
- Tests: `wallet-proof.test.ts`, `v31-wallet-proof.test.ts`; other ranked-step tests mark the step offered
  (`fixtures/wallet-step.ts walletOffered`; `fixtures/find.ts person` unless `walletStep: true`).

## v3.1 Base onboarding for builders with no GitHub or no project (2026-10-23, owner-approved)

- **Step 2's no is remembered.** In the no_project state, `tell move_up { kind: 'pick_repo', answer: 'no' }` (no GitHub
  yet, or not connecting now; `PICK_REPO_NOTE` says so) sets `standing_seen.github_no` (`bench-find.ts githubAnswer`).
  From then on benchView mints no picker link and `stateAsk` never returns step 2. A later `pick_repo` yes (the builder
  asking to connect) clears `github_no` and gives step 2 with a fresh link.
- **The Base walk-through, once.** The no's own reply is `BASE_START_ASK` ("Want to start building on Base? I'll walk
  you through it."), only while Base Builder Grants is open (its last step drafts that application), claimed by
  `standing_seen.base_asked` (also in find: `baseGrantOpen`, `takeOnce`). `base_start` is answered by its kind
  (`baseStartAnswer`), so a late answer or the builder asking later works: either answer is kept in
  `standing_seen.base_walk { answer, at }`. A yes is `BASE_START_STEPS` (four steps from v3.1-install-research.md and
  the Base program file; the Builder Codes guide is the one link; `BASE_STEPS_NOTE`: help with step 1, never build for
  them). A no is followed by the wallet step when due, else "Okay.". A yes is saved only when the steps are returned.
  The tell paths use find's gate (`baseOpenFor`: `baseGrantOpen` over `scoreApplies`' cards and skip), so a hidden or
  entered Base Builder Grants is never offered.
- **Wallet step for builders who skip GitHub.** After the GitHub no, the optional wallet step (`walletOffer`) comes once:
  in the reply to the Base no (`walletStep`), else in the next find (no_project, `githubNo`, the walk-through asked).
  Builders who connect GitHub keep it after setup (ranked quiet slot). Never two questions in one reply.
- **Resting reply.** With every onboarding question asked: `You're in, @maya.` / `Is your app's code on GitHub yet?`
  (`NEXT_STEP_ASK`, kind `next_step`, `NEXT_STEP_NOTE`), never step 2 itself. Its yes (`restAnswer`) is step 2 again
  (`connectAfterAll`: `github_no` cleared, a fresh picker link, the `pick_repo` ask stored); its no keeps resting. A
  GitHub no with nothing else due returns this question as its reply. `BASE_START_NOTE` and `WALLET_NOTE` tell the agent
  that a builder who wants to connect after all is a `pick_repo` yes.
- **Kindless answers.** A `tell move_up` with no `kind` is routed by the stored ask when it is `pick_repo`,
  `base_start`, `next_step` or `new_repo` (`KINDLESS_ROUTED`).
- **Profile.** `site-data.ts mainOf` reads `base_walk.answer = 'yes'` (`starting`): the Highlights single item reads
  `STARTING_ON_BASE` ("Getting started on Base") instead of `NO_PROJECT_YET`, and `ProfileSite.starting` makes the hero
  line `startingLine` ("<name> is getting started on Base.") in place of `noProjectLine`. Otherwise today's wording.
- **Fork or template refusal.** `github-app.ts pickSetup` sets `standing_seen.template_refused` when every picked repo
  was refused as a copy (proveOne `why: 'copy'`), and clears it on a later success. The next find or score reply (never
  signed out) takes it once (`takeTemplateNotice`) and shows `TEMPLATE_NOTICE` ("If you made your app from a template,
  make a copy in your own account, then connect that.") under the account line (`BenchView.notice`; ranked: its own
  paragraph above). A statement, so the reply keeps one question.
- **Old repo nudge.** A ranked main project whose lit weeks (streak.ts) miss the last `STALE_WEEKS` (8) ISO weeks
  (`staleRepo`; no weeks known is never stale), and not proven within `NEW_REPO_GRACE_DAYS` (14, `connectedSince`), gets `NEW_REPO_ASK` ("Working on something new? Connect that repo
  instead.") once, in the quiet slot after the wallet step and before titles (`standing_seen.new_repo_asked`). Its yes:
  `NEW_REPO_YES_NOTE` (ask which repo, then `tell main_project`).
- `stand-view.ts takeNews` keeps `github_no`, `base_asked`, `base_walk`, `template_refused`, `new_repo_asked`.
- Tests: `v31-base-onboarding.test.ts` (exact texts, one link and one question, each no remembered, no loops, the page).


## GTM W2: the reply journey (2026-10-23, from the 5-persona journey audit)

- **Value before the ask.** `BenchView.open` (the open grant, `openGrant`) is set for every state but ranked; a step 2
  reply (`isStep2`: the picker, or the first repo's install link) puts `grantHook` ("Base pays up to $5,000 for apps on
  Base.") between the account line and the step. One link, one question kept.
- **Link-only projects (Lovable, Bolt).** A not-counted project whose key is a link (variant `no_repo`) is on the no-GitHub
  path (`noCode` in benchView and stateAsk): the repo picker (`pick_repo`), then after a no the Base walk-through, the wallet
  step and the resting question, as for no project. `githubAnswer` / `restAnswer` treat a link-only main as no repo
  (`hasRepo`). Its name is the builder's (`reportedName` from identity), never the host (`linkName`, `YOUR_APP`). An old
  stored `repo_behind` no goes to `githubAnswer`. The nos on this path say `NEXT_STEP_LATER`, never "Okay.". The Base steps
  reply stores `base_help` (move_up); its yes (or a `base_start` yes while `base_help` is the stored ask) is
  `BASE_HELP_STEP` (Lovable/Bolt GitHub labels) with the resting question (kind `next_step`), never the steps again.
  present.ts `CHAT_ONLY` no longer sends a chat-only builder to a coding agent.
- **Agent reach** (`agent-reach.ts`). `hosted` (Grok, Muse, Meta, Instinct, OpenClaw by client_name, or find told
  `agent_can_build: false`, remembered as `standing_seen.no_folder`) picks the `*_HOSTED` ship and qualify notes (no "this
  folder", no git log); draft-application's first note is neutral for every agent. `schedules` (Grok, Cursor, OpenClaw,
  Hermes, or no_folder) allows the Monday check-in.
- **Ranked order** is now connect, backing, post, apply, share, checkin, wallet, new_repo, titles, qualify, ship. The
  ship question is asked at most once in `SHIP_ASK_DAYS` (7; `standing_seen.ship_asked`); between, ask kind `none` (no
  question, no move_up, the points line stays). `checkin` is asked once (`checkin_asked`) on a client that schedules;
  its move_up note tells the agent to set its own Monday routine that calls find; the answer is `standing_seen.checkin`.
- **Coin.** Backing is computed before the hot post and the apply step in benchView, and the connect yes (the weeks it
  approves prove the builder) offers it first (`connectBacking`, stored as the backing ask). A private repo is offerable
  when the page has a public name for it (`coin-moments.ts publicName` = page-data safeNames, never `PRIVATE_NAME`): the
  offer, the pair and the projects row use that name; the row keeps `repo_url` (the gate reads it through the App, one coin
  per repo) with `repo_private = true`, so tokens.fun never gets the repo link. No public name: no offer, and a yes says
  `COIN_NO_PUBLIC_NAME`. Every other gate is unchanged (approved code week, App proof at launch, sanctions, rate limits,
  owner repo excluded, shared clients). `confirm`'s launched outcome gets `show_to_builder` from
  `post-reply.ts coinLaunchedReply` (`coinLiveLine` + the coin_intro post as the one link and question; else the coin's
  page). `coin_intro` and `accepted` skip the one-offered-a-week cap (`PAST_OFFER_LIMIT`). `tell token: 'ask'` on a launched,
  backed coin answers `backersLine` (backers, fees, page).
- **Applications and outcomes.** `tell submitted` with no EarnKit entry records `program_status applied` (`appliedOutside`,
  `appliedLine`); `DRAFT_NOTE` says `tell submitted`. A told accepted/funded/won always gets `outcomeCongrats` (before the
  proof ask, or as the post's head; alone when no post can follow). A proof-checked outcome (a post_drafts row with
  `proof_url`) moves the Highlight: page-data `toldApplied.outcome`, `programLabel` "Accepted into X" / "Funded by X" /
  "Won X".
- **App already installed.** `repo-proof.ts proveCovered`: a repo owned by a GitHub login this person proved (an App
  verification, or an App link's sign-in hop on `github_verify_nonces`) that GitHub names an App installation for is proven
  at once (proveByApp + a verification row). Used by `rankAnswer` (tell main_project) and `coveredRead` (find and score,
  when the one project is a repo not counted yet, within `COVERED_WAIT_MS`). A builder with an App-proven repo is never
  shown "Step 2 of 2" again (`appConnected`, `installMoreAsk`).
- **Email question** is a move_up (`weekly_email`, `EMAIL_ASK_NOTE`): a yes with the address goes to `tell weekly_email`,
  a no by move_up is saved (`emailAnswer`).
- Tests: `gtm-w2-replies.test.ts` (mcpCall), and the updated copy in the older reply tests.

## v3.1 owner people view, EarnKit side (design: v3.1-owner-people-view.md, owner ask 2026-10-23)

Private farm-watch signals for the owner, read by jenil.ai (`/people`) as `earnkit_ro`. Never shown, scored or ranked.
- **X at sign-in.** `x-oauth.ts` reads `/2/users/me` with `created_at,public_metrics`; `xUserFrom` adds `createdAt`
  (ISO or null) and `followers` (non-negative int or null; optional on `XUser`). `x-install.ts bindXIn` writes
  `builder_profiles.x_created_at`, `x_followers` (COALESCE: a sign-in without them keeps the stored ones) and
  `x_checked_at`. The fallback link carries them on `x_signin_links` until the paste code binds (`x-link.ts`). No backfill.
- **Daily cron step** `people-signals.ts peopleSignals`, full runs only, once a UTC day (the `peopleSignals:<day>` rate
  window, as feed.ts), in its own slice (`builderCodesSliceEnd`): `githubAgesStep` (profiles' logins missing from
  `github_users`, via `github-verify.ts githubUser`, at most 50) and `walletSignalsStep` (`person_wallets` never checked, or
  with no tx and checked 7+ days ago, at most 30; Blockscout txlist oldest first, 20 rows; `walletSignalsFrom` keeps
  `first_tx_at` and `funder`, the sender of the earliest tx sent to the wallet). A failed read stores nothing.
- **View** `owner_people` (schema.sql, CREATE OR REPLACE): one row per profile; the wallet is the recipient else the
  newest proven; `funded_by_slug` is another profile that proved the funder; points from `builder_points`; `last_seen_at`
  over the group's installations. Guarded `GRANT SELECT ... TO earnkit_ro`.
- **Owner tracker columns** (2026-10-23, appended after `referred_installs`, never reordered): `x_name`, `x_avatar_url`,
  `main_project_key`, `project_name` (identity's builder-given name, else the builder_projects name), `main_repo` +
  `repo_private` (verified repo source; newest reading's `private` unless a newer `public_at`), `site_url` (verified
  site, not dns_txt), `shipping_score`/`shipping_rank`/`rank_total` (listedRanked's rule; skips the Bench's
  confirmed-project check), `streak_weeks`/`commit_weeks_12`/`last_commit_week` (commit_weeks + shown shipped_code
  weeks, no live current-week reading), `last_approved_week`, `last_activity_at` (latest of last seen, approved week + 7,
  commit week), the coin (`coin_symbol`, `coin_url`, `coin_address`, `coin_backers`, `creator_fees_eth` from
  creator_fees), `programs_applied/accepted/won` (distinct programs: statements + entries + outcomes), `checkin_on`
  (standing_seen.checkin yes), `email_opted_in` (digest_subscriptions). All LATERALs keyed by builder_id.
- Tests: `people-signals.test.ts`, `x-oauth.test.ts`, `owner-tracker.test.ts`.

## v3.1 GTM W3 credibility (2026-10-23, journey audit findings 1, 4, 7, 8, 18, 22, 24, 26)

Every number and name a builder or visitor reads agrees with what sits beside it.
- **Week summaries never boast a fix.** `ship-titles.ts cleanTitle` drops `chore|build|ci|style|test:` titles and keeps a
  `fix:` title reading as a fix (`asFix`: "Fix timezone bug in streak reset"; a real verb stays, a noun-ish one gets "Fix").
  `week-summary.ts ruleSummary` writes a verbless clause with a bug word (`BUG`) as "Fixed ..."; `boastsFix` keeps a
  stored or model "Shipped <bug>" from being stored (`weekSummary`) or shown (`summaryShown`, so old rows fall back to the
  rule summary). The Haiku prompt says so too. The past-tense helpers moved to `past-verb.ts`.
- **"You qualify" only with nothing in the way.** `bench-reply.ts fitBar` from the program's own facts (investment =
  company with a full-time team, match.ts INVESTMENT_NOTE; the "long shot" tag; "needs a live product" without a live
  link; the matcher's "no users yet"); `qualifyLine` says the condition ("Long shot: ..., It takes a company with a
  full-time team."). bench-find threads `bar` onto Fit, BestFit and the fund lines.
- **One money rule.** A headline's figure sums the top awards of the non-investment programs in the table under it
  (`present.ts shownHeadline`; investments and hackathons in the table are named by `openMoneyWords`, "Plus 2
  accelerators."). The landing chip sums only the Base programs among the Opportunities cards (`landing.ts`).
- **No guessed package link.** `person-score.ts packageLinkable`: a registry page is the project link only when the
  package source is verified by `repo_link`, its readings name a repo the GitHub App proved for the project, and that repo
  reads public; `page-data.ts shownProjects` also drops npm/PyPI links on a hidden repo.
- **One rank line.** `site-data.ts standingPill`/`pillOf` label and title the pill with `shownRankLine` over the whole
  pool (`standingOf`, as `bench-rank.ts rankLines`), so the pill, replies, card, page meta and email say the same; the
  metal still comes from the percentile; nothing under RANK_MIN_POOL.
- **One name.** `project-name.ts` (`refKey`, `reportedProject`, `reportedNameIn`, `reportedName`): the builder-given
  name from the stored identity, matched loosely, wins in replies (bench-find benchView and tokenAsk) and in
  person-score's row name; `bench-reply.ts displayName` never title-cases a host, `keyName` gives a link key's host.
- **Money line hygiene.** The upcoming program's "not open yet" line is added only when nothing else is the money line,
  only in a reply that shows it (`upcomingShown`), and once a week a program (`bench-find.ts takeUpcoming`,
  `standing_seen.upcoming_said`, kept by stand-view). `base-qualify.ts qualifyStatus(m, codes, onBaseSaid)`: Base step met
  when the project's chains include Base, a Base contract was reported (`onBaseKnown`) or the matcher credits a claim.
- Tests: `week-summary.test.ts`, `bench-reply.test.ts`, `present.test.ts`, `landing.test.ts`, `person-score.test.ts`,
  `v31-site-data.test.ts`, `project-name.test.ts`, `v31-reply-fixes.test.ts`, `v31-gtm-w3.test.ts`.

## v3.1 GTM W1: install and arrival (design: v3.1-gtm-journey-audit.md, 2026-10-23)

- **Install tabs** (`sections/agents.tsx AGENTS`, read by the sheet `AddToAgent.tsx` and `/docs` `InstallCard.tsx`): Grok
  Bot, Muse, OpenClaw, Hermes, then Claude, Claude Code, Cursor, Codex. Grok Bot: an "Open in Grok Bot" button to
  `grokbot://app/v1/prompt?text=<GROK_BOT_PROMPT>` (prefills only; Enter, "Add it", "Authorize"), then the 2-step fallback
  in the app's labels. Muse: a copy-message box (`MUSE_MESSAGE`). OpenClaw: add, then gateway stop / login / start, the
  `--code` note. Hermes (`public/images/agents/hermes.png`): the config.yaml snippet, `hermes mcp login earnkit`,
  `/reload-mcp`. The docs panel now shows the one-click buttons too. Evidence: `v3.1-install-research.md` (Grok Bot section).
- **OAuth (security ruling)**: Grok Bot registers as "Cursor". Its `https://www.cursor.com/bot/mcp/oauth/callback` and
  `https://grok.com/connectors-oauth-exchange-code/` callbacks stay `other` (the page naming the host) until a real install
  shows they bind the code to the signer's own session (login CSRF otherwise); `grokbot://` is not a trusted app scheme.
- **Profile visitor card**: `BenchProfileView` ends with a panel (`data-ek-get-page`, `PROFILE_CTA_TITLE`/`TEXT`) holding
  `InviteRow` (the header's install sheet; `pill` prop for the motion-safe variant).
- **Referral attribution, measure only**: `app/[handle]/RefMark.tsx` sets `ek_ref=<handle>` (30 days, first page keeps it,
  `ref-cookie.ts`); `authorizeGet` puts it on the pending request, `issueCode` signs it into the code (`rf`),
  `exchangeCode` returns `ref`, and `tokenPost` calls `installations.ts noteReferral` for a new installation only:
  `installations.ref_builder_id`, `ref_at`, set once, only for a public claimed page, never the builder's own group.
  `owner_people.referred_installs` (last column) counts them, own excluded. Never public, no rewards.
- **Cursor plugin** `integrations/cursor-plugin/earnkit/` (manifest, `mcp.json`, skill `what-can-i-earn`, logo); the owner
  publishes it (`integrations/cursor-plugin/README.md`). Nothing is submitted from the repo.
- **llms.txt** (`llms/v213.txt`): the site's positioning, every agent's install steps, `score`, find's `identity` input
  (no `local_repos`), the one-tap post (no weekly "share it on X" promise), no "agents earning once there are 100".
- Tests: `install.test.ts`, `v31-site-docs.test.ts`, `oauth.test.ts`, `referral.test.ts`, `people-signals.test.ts`.

## Reply format on the agent surfaces (v3.1, 2026-10-23)

- **Why.** Grok Bot renders replies with react-markdown + remark-gfm and no line-break plugin (read from the app bundle,
  v0.75.0), so show_to_builder lines joined by one newline collapsed into one run-on paragraph. OpenClaw, Hermes,
  Instinct and Muse on WhatsApp/Telegram/SMS show markdown syntax raw.
- **What.** `reply-format.ts formatReply` puts a blank line between lines, keeps list items (`1.`, `-`, `•`) and table
  rows together as one block, collapses extra blank lines and adds no emphasis. `withFormattedReply` applies it to a
  tool result's show_to_builder only. `mcp.ts run` applies it to every tool result at the MCP boundary, so the copy
  constants keep their one-line-per-line form.
- **Tests.** `fixtures/mcp-call.ts` asks the server for unformatted replies by default (`createMcpServer(ctx, { format:
  false })`, tests only) so existing tests keep asserting the words; `reply-format.test.ts` covers the format, and
  `gtm-w2-replies.test.ts` checks the formatted wire text through the real route.


## GTM W4: the share card in the v3.1 site language (2026-10-23)

`/<handle>/card.png` (what X shows for a profile link) was the v3 flat black card and nearly empty for an unranked
builder. Now it is the profile in small, drawn from the page's own reads so it never says what the page doesn't.
- **Facts** (`app/[handle]/card-facts.ts shareCardFacts`, pure, from `profileData` + `profileSite`; `card-response.tsx
  shareCardRead`): the Bench-confirmed project (its panel name, letter, colour, Base tile, EarnKit mark), its verified live
  host (Highlights "Live at <host>"), and up to two quiet facts ("5 weeks in a row", "Building since Jan 2025"). Tiles, at
  most two, in order: the Shipping ring (only while ranked, `rankListed` and a score; the rank words are `d.bench`, the rank
  helpers' line, split by `rankSplit`), Backing (`site.token`, so EARNKIT_RAISING on and never EarnKit's repo; backers only
  from `BACKERS_SHOWN_FROM`), a win, the streak (with 12 week squares), the commits in the last year (titled "Building
  since"). A confirming or missing project: "Getting started on Base" (`site.starting`) or "Building with AI", with
  Highlights' "On EarnKit since".
- **Layout** (`benchCard(facts, avatar, grid, art)`, pure): the page ground, the flat blue hero (photo, Kaftan name,
  @handle, the project panel, the mark and earnkit.com/<handle>), and a 404px column of the profile's cards (navy ring,
  white Backing, neutral win, rust streak, navy commits). A slot no fact fills hangs one of the site's paintings
  (`public/art`, `loadArt`): the Eckersberg middle arch tall, the Panini oculus as a half. No painting read: the hero takes
  the width. SITE colours only, no gradient on the page card, no text under 24px (X's phone preview is about 0.42 scale).
- **Pictures**: `avatarData` drops GitHub's default picture (octocat or identicon): GitHub serves it as a 420x420 PNG
  whatever size is asked, an upload comes back at the 200px asked (`githubDefault`); the card then draws the initial.
- **Fonts**: `assets/fonts/funnel-sans-latin-{400,600}.woff`, static instances of `app/fonts`' variable Funnel Sans (OFL,
  made with fontTools' instancer), plus Kaftan. The post card (`post-card-image.tsx`) uses the same fonts and
  `card-parts.tsx CardPhoto`, and each layout is now one rounded card on the page ground. `/share`'s text is unchanged
  (`benchCardFacts`, `benchShareText`). Route contract, `CARD_CACHE` and the 404/308 rules unchanged.
- Local dev note: with this worktree's symlinked node_modules, `next dev` needs `--webpack` (Turbopack rejects the link).
- Tests: `v3-shells.test.ts` (T6.3, shareCardFacts), `card-route.test.ts` 11.8, `v31-rank-pool.test.ts` (f),
  `v3-backing.test.ts`.

## v3.1 cold-read fixes (2026-10-23, owner-approved spec: v3.1-cold-read-fixes.md)

Five journeys read cold; every reply now answers the builder, says one name and stops repeating.
- **Answer first.** find's and score's note is `stand-text.ts ANSWER_FIRST_NOTE` (the agent may answer the builder's own
  question in one line from facts in the reply, then shows show_to_builder as written); the server instructions say the same.
- **First reply and connect step** (`bench-reply.ts`): `youreIn` ("You're in, @x. I find grants ...") only once
  (`standing_seen.welcomed`, `welcomeFits` + `takeOnce`, `BenchView.welcome`); `grantHook` names the program
  (`grantProgramName`: "Base Builder Grants pay up to ..."; `base-qualify.ts grantOf` adds `name`); `pickRepoAsk` starts
  with `CONNECT_LEAD`; no "Step 2 of 2" and no "isn't counted yet" (the `stand` copies return null).
- **Live app, no GitHub.** A link-only project's no (`bench-find.ts liveNoAnswer`) gives `liveNoGithub(builtWith(host))`
  (Lovable, Bolt or both) with the connect link, sets `standing_seen.github_no_app` (every later reply shows it; never
  `github_no` or the Base walk-through); a second no is `NEXT_STEP_LATER`. A connect yes with nothing connected
  (`connectNotYet`, no App-proven repo) is `NOT_ON_GITHUB_YET` + the step again, never an empty reply.
- **Idea only.** `baseStartSteps(grant)` ("Here's the path to Base's $5,000 grant: ..."), question `LOVABLE_PROMPT_ASK`;
  its yes (`base_help`) is '' with `LOVABLE_PROMPT_NOTE` (the agent writes the prompt).
- **Throttles** (benchView, remembered in standing_seen, kept by `stand-view.ts takeNews`): the ranked standing line only
  when it changed (`status_seen`; the connect reply counts; score always shows it: `alwaysStanding`); the points line at
  most once an ISO week (`nag_week`); "Backing open. Your page" the first time, then `newBackersLine` only when backers
  grew (`backers_seen`, `FundLine.news`). A ranked reply is never empty or the points line alone (`orStanding`).
- **Money.** `realFit` (fitBar not `company` or `long_shot`): only real fits are the money line, fund lines, apply step and
  connect's Best fit; long shots stay in the "What can I earn?" table. `present.ts moneyHeader` ("4 programs are open.
  Your best fit: X, up to $Y."), `noFitLine`, Difficulty cells without "(estimate)", no `CHAT_ONLY` (a chat-only builder
  is asked to start on the first program by `byRelevance`), no "build something new" (`Want the guide for X?`),
  `APPLIED_OUTSIDE` is "applied". `submit-kit.ts siteFormLine`: an investment whose form is one email step on its site is
  one line with the link and "Sent it?". `tools.ts chainFitLine` ("Circle wants apps that settle on Arc, Circle's
  chain. X has no Arc code yet.", `chains.ts CHAIN_EXPLAINED`); its name comes from `mainProjectNameFor` (own project
  only, never on a shared client).
- **One name.** `rememberProjectName` (prepare's project, when it names the one project) stores the builder's name on the
  identity; `mainProjectName` names replies; `coin-moments.ts coinName` uses it for the coin (a private repo: only when it
  isn't the repo's name or is its site's name).
- **Coin (history: retired in v4.0 Task 11; v4.2's `tokenAsk` answers the builder token, see "v4.2 journey fixes").**
  `BACKING_OFFER` is rewrite 4 ("I can launch $X, a coin for Y on Base. ... Launch it?"). `tokenAsk` always
  gave a path: not connected `tokenConnectFirst` (picker or install link, stored as that step); launched coin
  `backersLine` + `backers_post` (yes: `post-reply.ts weekPostReply`, else `BACKERS_NEWS_NOTE`); blocked `coinBlocked`
  (`COIN_BLOCKED` off, own, shared, held); proven with no published week `tokenPublishFirst` (`coin_publish`: openConnect
  then a yes runs `answerConnect` and shows the offer via `askedCoinOffer`; nothing launches before the offer's own yes);
  weeks not written yet `TOKEN_LOG_PENDING`, no code week `TOKEN_NO_WEEK`; else `askedCoinOffer` (an earlier no is
  reopened: `coinAllowed`/`coinOfferable` `{ asked: true }` skip only the declines cap). All other gates unchanged.
- **Other rewrites.** `connectAsk(page)` (no week count), `walletOffer` without "Optional:" and `WALLET_ASK` "Done?",
  wallet step only with Base contracts known or reported and no coin fee wallet in `FEE_WALLET_QUIET_DAYS`
  (`wallet-offer.ts walletOfferDue`), `TITLES_ASK`, the Builder Code step line (no `QUALIFY_NEXT`), qualify skips the
  live/users step (`liveOrUsersKnown`, find's `known`, `localReportOf`) and the Base step when reported, `momentHead`
  "Week N done:" / `MOMENT_ASK` "Look right?" / `POST_HEAD` "Your post for X:", `proofAsk` for an outcome told without
  its link (an outcome with no prior entry keeps the plain congrats: owner ruling 3), `factsAck` for tell repo_facts,
  guide "Most likely to win".
- Tests: `v31-cold-read.test.ts`, plus the updated copy across the reply tests.
- **Round 2 (coordinator read).** No project after the walk-through: `LOVABLE_PROMPT_ASK` until the prompt is written
  (`standing_seen.lovable_prompt`), then `nextBuild(link)` (never `NEXT_STEP_ASK`); no-project money tables ask "Want the
  guide for X?"; the token ask with no project is `TOKEN_BUILD_FIRST` + the Lovable prompt question. Tables put fits,
  then grants by difficulty, first; investments and low-odds rows last (`longShot`; all long shots: the open table first);
  no "confirm:" cell. A coin yes waiting for its fee wallet (`coin_wallet_wait`, `coinWalletWaiting`) asks
  `COIN_WALLET_REASK` (ask kind `coin_wallet`) instead of any other step, never the wallet proof. `backfillNow` writes a
  one project's log on demand (rankAnswer, coveredRead, connectMoment, tokenAsk) when the connect never did. Outcome posts
  need only the proof checks (no earlier entry). Weekly posts say "Last week:". Drafts: `youAddLine`, and
  `BUILDER_CODES_FIRST` in the approved wording with a plain guide path.

## v3.1 answerable replies (2026-10-23, design: v3.1-answerable-replies.md)

Owner Grok Bot test: most builder questions ("how many points", "what's my wallet", "who backed me", "what is EarnKit")
route to find or score, whose reply showed only the status line. Now every find and score reply carries `facts`
(`reply-facts.ts`, added in `tools.ts withFacts`), and `ANSWER_FIRST_NOTE` tells the agent to answer the question in one
short line from show_to_builder and facts only (a link it needs comes from facts). Facts are the builder's own data,
read through `bench-data.ts profileData` so they follow the page's visibility rules (private titles, coin only with
Backing on); a shared client without a signed-in builder gets only `about`, whose lines are existing site and docs copy
(no deletion policy: `about.data` is "You can hide your page anytime"). Same pass: the token ask with a live coin leads
with "$SYM is live: <tokens.fun>"; a weekly email yes without an address asks which email (never "Done"; a scheduling
client may get the check-in instead); the connect step's full pitch is shown once a UTC day (`standing_seen.pitch_day`),
then only its link and question; jargon lines ("Backing open", "Last week is confirmed", the tables' "Prize" header, the
guide's "(estimate)") replaced.

## v3.1 Highlights competence (2026-10-25, design: v3.1-highlights-competence.md)

Owner rulings: the old card was monitoring trivia, jargon and commit counts. Highlights now shows what ecosystems and
investors value about the builder's competence, chain-agnostic; never anything coin related (no coins, tokens, factory
launches, fees, backers); no Base-only rows (Builder Code stays in replies; "On Base since" and "Wallet proven by
signature" are gone). Contracts deployed stays, across chains.

- **The card** (`site-data.ts highlightsOf`, at most `HIGHLIGHTS_MAX` = 5, in order, a row with no data left out):
  1. live: unchanged `liveItem` / `liveSub`.
  2. contracts: the builder's `wallet_contracts` rows with `counts` (joined on `person_wallets.wallet`), `contractsOf`:
     "3 contracts on Base" on one chain, "12 contracts on 3 chains" on several; sub "Since <Mon YYYY>" (earliest dated);
     links the earliest on its chain's explorer (`explorerHref`). Never a wallet address. Verified Base contract
     sources and EarnKit's `contract_deploys` no longer show here (they are not the builder's wallet's own creations).
  3. products: distinct hosts of the builder's verified site sources (any project) that read up at least once, oldest
     first up day first (`productsItem`/`productsOf`), from `PRODUCTS_MIN` = 2: "Shipped N products", sub the hosts
     (3 named, then "and N more"), links the oldest site. A GitHub-hosted site is left out unless its project's repo
     is shown (`page-data.ts shownProjects`, read only when such a site exists).
  4. consistency: `consistencyItem`, the weeks on in `ProfileData.grid`: "Shipped in N of the last 52 weeks", sub
     "Building <name> since <Mon YYYY>" from the ship reading's `created_at` (no name for `PRIVATE_NAME`; empty when
     unknown); links the repo while public.
  5. won: `projectProgramsDated` rows that are won, funded or accepted (`programLabel`), at most 2; never "Applied to".
  6. experience: `github_users.created_at` for the proven `builder_profiles.github_login`: "Writing code since <YYYY>",
     sub "On GitHub since <Mon YYYY>", links `https://github.com/<login>`. A filler: last in the list, so the slice to 5
     keeps it only while rows 1 to 5 leave a slot.
  The start item for unconfirmed builders and "On the leaderboard" for a confirmed one with no rows are unchanged.
- **Contracts read** (`alchemy.ts alchemyWalletContracts`, through `ReaderDeps.walletContracts`, only with
  `ALCHEMY_API_KEY`): per proven wallet (the newest `WALLET_READS`) and per `wallet-chains.ts WALLET_CHAINS` chain (base,
  ethereum, arbitrum, optimism, polygon; Alchemy networks base-mainnet, eth-mainnet, arb-mainnet, opt-mainnet,
  polygon-mainnet), `alchemyCreations` with its caps (`READ_CAPS.walletPages` pages, `WALLET_CREATIONS_MAX`), then per
  creation `contractCounts`: a token (decimals() and totalSupply() both answer a 32-byte word via eth_call) never
  counts; else it counts when one of its `USED_SCAN` newest external transfers in comes from another address. Chains
  side by side, contracts one at a time (Alchemy's free throughput). `alchemyCall(deadline, network)` throws
  `AlchemyNetworkOff` on "is not enabled for this app" (403 or error body): that chain is skipped with one
  `[alchemy] <network> not enabled for this app, skipped` line per process and turns on by itself once the owner enables
  the network (today base, ethereum, arbitrum). Any other chain failure is one `[alchemy] <chain> contracts` line and
  that chain is left out; the deadline (`ScoreDeadline`) propagates. Reads are counted as provider `alchemy`.
- **Store** (`wallet_contracts(chain, address, wallet, created_at, counts, read_at)`, PK (chain, address), index on
  wallet): `discovery.ts walletContractsOf` upserts every row at once (a cache, like `base_since`; no verdict depends on
  it). Rows already `counts` are passed as `known` and not classified again (a token stays one, a used contract stays
  used). The same read's Base creations (tokens and unused ones too) feed the T7 claims as before, so Base is read once
  and `walletCreations` is not asked; without Alchemy, `walletCreations` (Blockscout) alone, Base claims only. Runs at
  proof time (`wallet-proof.ts discoverNow`) and whenever the person's discovery runs (the cron's `discover` step reads
  only queued people: a clue queues them; there is no per-person daily discovery, so a contract that gets its first
  outside user later counts at the person's next discovery). Rollout: builders whose wallets were proven before this
  shipped have no rows until their discovery runs again; re-queue them once (`INSERT INTO discovery_queue (builder_id,
  reason) SELECT DISTINCT builder_id, 'wallet' FROM person_wallets ON CONFLICT (builder_id) DO UPDATE SET reason =
  EXCLUDED.reason, queued_at = now(), done_at = NULL WHERE discovery_queue.done_at IS NOT NULL`).
- **Share card** (`card-facts.ts`): "Building since" now comes from the consistency sub; the commits tile is gone (the
  page no longer shows a commit count), so `card-response.tsx` lost its `commits` case.
- **Icons** (`HighlightsCard.tsx`, lucide strokes, same tile style): products layers, consistency calendar-check,
  experience terminal; code, repo and applied removed.

## v3.1 Used by (2026-10-27, design: v3.1-used-by.md)

Owner: "agreed and go". The strongest thing a builder can brag about, cheaply verified: real people use what they
built. One Highlights row, read daily from two free sources; the competence rules stand (chain-agnostic, never coin
related, no row without data, every row links to proof).

- **The row** (`site-data.ts usedByOf` / `usedByItem`, second in `highlightsOf`: live, used by, contracts, products,
  consistency, won, experience; still at most 5): "Used by N people in the last 30 days" (`toLocaleString('en-US')`,
  "N+" when a contract read hit its page cap), only from `USED_MIN` = 10. Sub "P% came back" (P = round(100 *
  returning / N); returning = wallets active in 2 or more ISO weeks), or the place when P rounds to 0 ("On Base",
  "On 2 chains", empty when unknown). It reads the newest `app_usage` row per source no older than `USED_STALE_DAYS`
  = 3 days and shows the larger (never summed; a tie keeps contracts). Link: the busiest contract on its explorer
  (only a `WALLET_CHAINS` explorer host); for a Builder Code number the repo file the code is in, only while it is under
  the public main repo's page (`githubFileHref`, back in site-data), else none. Icon `users` (lucide users).
- **Source 1, contracts** (`used-by.ts contractsUsage`, Alchemy): the builder's `wallet_contracts` rows with `counts`
  plus their verified contract `builder_sources` on a `WALLET_CHAINS` chain (a source that is a token, `alchemy.ts
  isToken`, never counts), newest first, at most `USED_CONTRACTS` = 10 per builder. Per contract `alchemy.ts
  contractSends`: external transfers to it, newest first, pages of 1000 until one is older than 30 days, at most
  `USED_PAGES` = 5 (then capped). Excluded on every chain: the builder's proven wallets, every counted contract's
  deployer (`wallet_contracts.wallet`, `builder_sources.deployer`), and every wallet a proven wallet sent ETH to
  (`alchemy.ts fundedBy`: one page per chain, value above zero). A network not enabled is skipped (`AlchemyNetworkOff`,
  `logNetworkOff`); any other failure fails that builder's read (nothing stored). `href` the busiest contract,
  `chains` where users were counted.
- **Source 2, Builder Code** (`used-by.ts codesUsage`, the CDP SQL API `POST https://api.cdp.coinbase.com/platform/
  v2/data/query/run`, `Authorization: Bearer CDP_CLIENT_API_KEY`; off without the key, and the test guard clears
  it): one query a day for every builder together (`hit('usedByCodes:<day>')`, as people-signals marks its day; no
  owned code asks nothing and spends no day). `usageSql` builds it: GROUP BY code over an IN list, the union of
  `base.transaction_attributions` joined to `base.transactions` (EOA senders) and `base.decoded_user_operations` (ARRAY
  JOIN builder_codes, success only), action = 1, the last 30 days, per code distinct lowercase senders and those in 2+
  distinct `toMonday` weeks, less `(code, wallet)` pairs of the owner's proven wallets. Only `builder-code.ts
  BUILDER_CODE` (`^[a-z0-9_]{1,64}$`) codes and 0x wallets go in; nothing is escaped. Only owned codes are asked
  (`ownedCodes`, Bench-confirmed builders); a builder with several codes keeps the largest. Its link is the repo file
  when one of the builder's App-proven repos carries the code, else none.
- **Whose code** (security review 2026-10-27, binding: repo text is not proof, and the earlier "two builders claim it,
  neither counts" rule let an attacker cancel the real owner): `used-by.ts verifyCodes`, first in the daily step (needs
  Alchemy), reads Base's Builder Codes registry (`BUILDER_CODES_REGISTRY` 0x000000bc7e...8e80, `payoutOf`:
  `payoutAddress(string)` by eth_call, viem encode/decode). A code is owned only when the payout address (lowercase)
  is one of that builder's `person_wallets`. A revert (`alchemy.ts AlchemyReverted`, "execution reverted", the
  registry's Unregistered) is not owned; any other failure stores nothing (the previous verdict stands, never granted
  on a failure; retried next run). Candidates: every code in an App-proven repo's scan, and `tell builder_code`
  (`tools.ts`, `tellBuilderCode`; replies `BUILDER_CODE_SAVED` / `BUILDER_CODE_INVALID`; shared clients get
  `SHARED_PROFILE_NOTE`). Store `builder_code_claims(code, builder_id, told, payout, owned, verified_at)`, PK (code,
  builder_id); Bench-confirmed builders' candidates re-read when not verified within `CODE_VERIFY_MS` (a day), never
  verified first, at most `CODES_VERIFIED_PER_RUN` = 100 a run. `events-redact.mts` lists `builder_code_claims.payout`.
  Two builders can name one code; a wallet belongs to one builder, so at most one owns it.
- **Code strings** (`builder-codes-check.ts checkBuilderCodes`, the existing daily scan): `builder-code.ts
  codesFromText` reads each hex data-suffix literal (decoded with `codesIn`) and each `codes: ['...']` / `codes:
  ["..."]` array, keeps `BUILDER_CODE` strings, stored in `repo_builder_codes.codes`. When the first file carrying
  Builder Codes names none, the scan reads on to the next carrying Builder Codes that does (its path is then stored);
  a stop after the first find keeps what it has. A code from an env var cannot be seen in the repo (the builder can
  name it through tell).
- **Store** `app_usage(builder_id, source CHECK contracts|builder_code, day, users, "returning", capped, href,
  chains, PK (builder_id, source, day))` (`returning` is a reserved word: always quoted). `chains` is an addition to
  the design's columns (the sub's "On Base" / "On 2 chains" label). A row is stored under `USED_MIN` too (the row
  hides it).
- **Schedule** (`cron.ts`, `used_by` in the answer, `CronDeps.usedBy`): `runUsedBy` after the Builder Codes step, in
  its own slice (`builderCodesSliceEnd`): `verifyCodes` (Alchemy on), the one Builder Code query, then `contractsDue` (Bench-confirmed builders
  with a contract and no contracts row today, never read first, at most `USED_PER_RUN` = 20) one at a time, each
  claimed for its UTC day (`hit('usedByContracts:<id>:<day>')`) before its reads, so a failing builder waits a day.
  Contracts are off without `ALCHEMY_API_KEY`. Alchemy cost per builder a day: at most 10 x 5 transfer pages, one
  funding page per proven wallet and chain, two eth_calls per uncounted source.

## v4.0 Task 8: weekly nudges (nudges.ts)

- At most one nudge per ISO week, claimed in `standing_seen.nudge_week` (the week's Monday) with one guarded UPDATE.
  Preference: accepted or funded (the verified outcome post's link, once a program; a congratulation drafted this week
  counts as the week's nudge and is not repeated), a users milestone crossed this week (10, 100, 1000 from `app_usage`,
  once ever), a program closing within 3 days with a confirmed unsubmitted entry (the draft), nothing shipped by Friday
  (Friday to Sunday UTC, streak 2 or more).
- Only a ranked reply leads with it (`bench-find.ts benchView`, `bench-reply.ts benchReply`); the Monday block, post
  offers, connect, setup step 3, the setup-done reply and held questions lead instead and the nudge waits unclaimed.
- Fix round 1: a question-bearing nudge (closing, accepted or funded) owns the reply's one question: closing stores the
  apply ask for its program (yes: prepare shows the draft), accepted stores `outcome_share` (yes: the post's link); no
  other ask is made, claimed or stored. The Friday line (v4.7.1: "Quiet week, no stress.", no question; it sits after the money paragraph) and the milestone line sit beside
  the ranked ask. A closing nudge for the submit step's own program replaces that held question. A newly told
  acceptance or funding replies with the approved accepted line and counts as that week's nudge.
- `stand-view.ts takeNews` now keeps every `standing_seen` key except the ones it owns (`NEWS_KEYS`: rank, at, people);
  the old allow-list dropped v4 keys such as `token_offered`, `setup_asked`, `setup_done`.

## v4.0 Task 11: the per-project coin offers are retired

- Builder tokens (`builder-token.ts`, one per builder, at setup step 3) replaced the per-project coin offers. Deleted:
  `coin-moments.ts`, `token-offers.ts`, `raising.ts`, `app/components/ui/RaisingPill.tsx` and their tests. The tables
  (`coin_moments`, `token_offers`, `token_declines`, `projects.raising_at`) stay (append-only schema); nothing reads them.
- MCP: `confirm` is never registered and `tools.confirm` is gone (with `confirmByProjectId`, `launch_token`,
  `coinAnswer`, `tokenPitch`, `ConfirmInput`). An older agent's `tell coin { answer }` and `tell token: 'ask'` are still
  accepted by the tell schema (undocumented) and answered as `tell move_up { kind: 'token' }`: a no is the builder
  token's no (kept forever), a yes or an ask is "launch my token". `coin { raising }` changes nothing.
- Entries never mint: `prepare_submission` offers no token (a ready draft ends "Ready to submit?"),
  `confirm_entry`'s decision is always record-only, `record_submission` reports a skipped token (an entry made before
  keeps reporting its own). The token-launch.ts launch functions remain but nothing in tools.ts calls them.
- Backing is gone from every surface: the Backed filter and tag (`BenchFilter` is `{ chain, weekly }`; an old
  `?backed=1` is ignored), the /terms Backing section, the landing and docs Backing lines, llms.txt's confirm line, the
  profile/Bench/card `backing`/`coin`/`raising` fields, the builder JSON's `backing`, reply facts' `coin`, the coin
  intro post moment and the backing, coin_publish, coin_wallet and backers_post asks (old stored asks are OLD_ASKS).
  `EARNKIT_RAISING` is read nowhere (`raisingEnabled` removed). `/api/stats` keeps `backing_open`, `backers` and
  `backers_after_post` at 0 (jenil.ai reads the keys).
- The Monday email's new-backers line (`backers.ts newBackers`) counts the launched builder token's coin.
- `v4-retire.test.ts`: no human string under lib/earnkit or app says "coin" (SQL and log tags aside); tell coin no is
  the builder token's no; the tools expose no confirm.


## v4 Task 12: the owner's Safe and gas emails

- `safe-watch.ts safeWatch` runs in `runCron` after the weekly email (step `safe_watch`; no new cron). The Safe's WETH
  and ETH on Base (bonusRpc, BASE_RPC_URL) priced with `cachedWethUsd`; at $5,000 or more one email to CONTACT_EMAIL
  ("Your Safe holds $5,240", the Safe swap link, "send the USDC to your Coinbase account"), idempotency key
  `safe_5k:<date>`. `owner_alerts` (kind, state, at): 'safe_5k' is 'sent' until a run sees it below ('below' re-arms).
  No price, a failed read, no RESEND_API_KEY or a failed send leave the state unchanged ('skipped').
- The gas lines of needs_owner ('bonus-ledger' when `bonusGasLow`, each 'deployer-gas:<chain>') also email the owner,
  at most once a UTC day per line (`owner_alerts` 'gas:<line>', state = the date); the needs_owner lines stay.

## v4.0 overview: builder tokens, setup, surfaces, the Monday reply (2026-10-28, design: v4-builder-tokens.md)

Task sections above this one: Task 8 (nudges), Task 11 (retired offers), Task 12 (Safe and gas emails).

- **Builder tokens (`builder-token.ts`, table `builder_tokens`).** One token per builder and per X account (`builder_id`
  primary key, `x_user_id` unique; a row is the claim). Status `declined` | `launching` | `launched` | `unknown`. The
  ticker comes from the X handle (`builderTicker`, tokens.fun checked: `ticker_check_down` is transient, `no_ticker`
  lasting). Launch: Base only, Clanker v4 through tokens.fun, WETH pair, fees after Clanker's 20% split Safe 60 / builder
  40 (`policy-constants.ts EARNKIT_SPLITS_BPS [6000, 4000]`; MINI's 10% ended, nothing claims for MINI). The whole feature
  is behind `EARNKIT_BUILDER_TOKENS=on` (`builderTokensOn`), which stays off until tokens.fun v4.1 is live.
- **Launch at the wallet proof (retired in v4.7 T3).** v4.0 had `wallet-proof.ts walletPost` run `launchOnProof` when the
  proof made the builder's first reward wallet; v4.7 deleted it: a proof never launches a token, even with v4.0's
  `token_offered`. A token launches only from the builder's yes (`tokenAnswer`), and the hourly retry only for a builder
  with that yes (`standing_seen.token_yes`). The token's creator
  wallet is the proven wallet. A "launch my token" ask later (`tell move_up { kind: 'token' }`) launches the same way.
- **Opt-out.** A no (to setup step 3, or an older agent's `tell coin { answer: 'no' }`) is `declineBuilderToken`: kept
  forever, never asked again. Skipping the wallet skips the token. An older agent's `tell coin` / `tell token: 'ask'` is
  mapped to `move_up { kind: 'token' }` (Task 11).
- **Stuck or unknown.** The row is deleted again only when tokens.fun said it stopped before minting (`tokens.ts
  outcomeOf` release). Any unclear answer stays `unknown` and is never retried. `stuckBuilderTokens` (unknown, or
  `launching` over `STUCK_LAUNCH_MS`) puts `builder-token:<builder id>` in `needs_owner` (cron answers 503; not quiet).
- **Dropped launch retry (final review 1).** The proof launches once, never awaited, so busy, the ticker check down, a
  refusal or no `TOKENSFUN_DEPLOY_API_KEY` leave no row. `runCron` runs `builder-token.ts retryDroppedBuilderTokens` (no
  new cron): builders with `standing_seen.token_offered`, an X account, a proven recipient wallet and no `builder_tokens`
  row, flag on, at most `BUILDER_TOKEN_RETRIES_PER_RUN` (5) a run, never tried first then oldest offer
  (`standing_seen.token_retry_at` rotates the rest). No API key, a 4xx refusal (not 429), `no_ticker` or `x_taken` sets
  `standing_seen.token_blocked`; `blockedBuilderTokens` lists each as `builder-token-blocked:<builder id>` (alerting,
  not quiet) on every run until a later try clears it. Busy and the ticker check down retry next run.
- **Sponsored creator claims.** `bonus-ledger.ts claimForOthers` claims `claim(owner, WETH)` for each launched
  `builder_tokens.wallet` first (final review 2: never starved behind project coins), then each launched project
  token's creator (newest first, 10x gas, bounded slice). The FeeLocker pays the
  owner, so EarnKit never holds the money; builders never claim and hear the amount in plain words.
- **Setup steps 1-3.** Signed out: "1. Sign in with X, 2. Connect your code, 3. Add your wallet". Step 2 (`pickRepoAsk`) adds
  the Lovable/Bolt line only without GitHub (`BenchView.noGithub`). Step 3 (`wallet-offer.ts walletSetupDue`: X claimed, step
  2 done or `github_no`, no wallet, not asked) asks everyone for the wallet (v4.4: the wallet only; the token offer
  follows its sign, see the v4.4 section); it is asked before every other ranked offer (`bench-find.ts benchView`).
- **Setup-done reply.** `bench-find.ts setupDoneFor` (claimed once, `standing_seen.setup_done`, after the reply is built
  so a failure never loses it) after the wallet answer (`afterStep3`): launched / on_its_way (a token row launching or
  unknown: "Your token is on its way. I'll confirm it here soon." in place of the community line) / set / declined /
  skipped lead (`SetupOutcome`), then "Here's what's open for you right now:"
  and a `| Program | Up to | Closes |` table (at most 3, Best fit first), ending with the Best fit apply ask ("Want me to
  draft it?"); no fit gives `noFitLine` and no ask.
- **Per-surface rendering.** `reply-format.ts surfaceOf(client_name)` reads the caller's own installation client:
  Grok Bot (and any unknown client) gets rich markdown (tables, bold); WhatsApp-style agents get plain "Label: value"
  lines (`formatReply(text, 'plain')`). `mcp.ts run` applies it to every `show_to_builder`.
- **The Monday reply and email.** `community.ts weekCommunityUsd` (creator `fee_claims` paid to the builder token's wallet,
  this week and last, priced with `cachedWethUsd`) feeds `weekly-moment.ts mondayRows`: Shipping score ("82, up 4"),
  Streak, "From your community" (hidden under $1; a cheer line at $100 or twice last week). `bench-reply.ts mondayReply`
  renders it; `digest.ts digestWeek` sends the same lines as `mondayLines`. The week's post is one link; `SHARE_NOTE`
  tells the agent to show `show_to_builder` exactly as given and never rewrite it.
- **Nudges** (`nudges.ts`, Task 8): at most one per ISO week (`standing_seen.nudge_week`).
- **Token card and post card.** `site-data.ts tokenCard` reads `builder_tokens` (launched only): symbol, Uniswap `tradeUrl`,
  holders (`backers.ts`, which indexes launched builder tokens too, starting at the tx receipt's block, else at
  `builder_tokens.created_at`), fees earned (`community.ts allTimeCommunityUsd`), 12 weeks of new holders, the X photo.
  The post card pill reads "$SYMBOL · N holders" (from 5 holders). Words: "token", "holders", "Trade"; never "coin".
- **`/api/builder-tokens` and `ref_source`.** `builder-tokens-json.ts`: launched tokens of claimed, visible builders with a
  handle (coin, symbol, handle, name, photo, shipping, streak, page), cached 60 s, CORS for tokens.fun.
  `?ref=tokensfun` on any page (`RefSourceMark`, `ref-cookie.ts REF_SOURCES`) stores `installations.ref_source`, never a
  referring builder.
- **Builder tokens in revenue and Earned (final review 3, 4, 9).** `indexSafeFees` books the Safe's deposits from launched
  `builder_tokens.coin_address` too, and `stats.ts` `safe_fees_wei` counts them (never a test installation's), so
  `fees_to_safe_eth` sees the Safe's 60%. `wallet-offer.ts walletChangeReply` adds `WALLET_COIN_FEES` for a launched
  builder token as for a project coin. `earned.ts earnedUsd` adds the creator `fee_claims` paid to the builder token's
  wallet (less any claim already in `creator_fees`), so Earned matches the Token card.
- **Owner emails.** `owner-mail.ts` and `safe-watch.ts` (Task 12): `safe_watch` cron step, `owner_alerts` table.
- **Retired in v4.0** (older sections above describe them as history): coin moments (`coin-moments.ts`), token offers
  (`token-offers.ts`, the pitch at confirm, `launch_token`), raising / Backing (`raising.ts`, `EARNKIT_RAISING`, the Backed
  filter, the terms section), the `confirm` tool, project coin launches (entries never mint), MINI's claims, launches on
  Arc. The tables stay (append-only schema) and are read by nothing.

## v4.2 journey fixes (2026-10-28, from the persona journeys; final review fixes 2026-10-29)

- **Token answers (`token-answers.ts`).** `tokenAnswerState` reads the state (row, handle, `communityUsd`, step 3 open,
  a fresh sign link, a proven wallet); `tokenAnswerText` is pure. Each state, approved copy: launched
  "Your token is live: <trade>" + "40% of every trade's fee goes to <wallet>, claimed for you." (+ "So far: $X." when the
  community sent any); just launched (`justLaunched`) "Done. Your token is live: <trade>" + `tokenPageLine` ("It's on
  your page too: <page>"); declined `TOKEN_OFF` "Your token is off. Say launch my token anytime to turn it on." (final
  review 2: a statement, no question); launching or unknown `TOKEN_ON_ITS_WAY`; no row with step 3 open
  `TOKEN_EXPLAINER` + `TOKEN_GOES_LIVE_ON_SIGN`; no row and no wallet: the explainer + `tokenSignLine(link)`; no row with
  a wallet: the explainer, plus `offerQuestion` when the caller passes one (the legacy offer's `TOKEN_OFFER_QUESTION`).
  Never "coin", never a pitch when live.
- **`tell token: 'ask'` (`bench-find.ts tokenAsk`).** Never launches. Step 3 due and not shown: step 3's reply. The
  legacy offer due: the explainer + the offer question, stored as ask kind `token`. Otherwise the state's text, and
  (final review 2) the stored `bench_ask` is cleared unless step 3 is open (its question is the one repeated), so a later
  kindless yes cannot answer an older question. Final review 7: in the same tell as a `move_up` answer
  (`tokenAsk(ctx, { statement: true })`, tools.ts), that reply owns the one question: the token is a statement (step 3
  open: the explainer alone), nothing claimed, stored or cleared.
- **The builder's yes (`tokenAnswer`).** Only `move_up { kind: 'token', answer: 'yes' }` from the agent is `ownTokenYes`;
  a kindless yes riding a stored `token` ask and an old `tell coin` yes (`legacyCoinAnswer`, `via: 'coin'`) launch only
  when no no is kept. `builder-token.ts reopenDeclinedToken` (own yes only) deletes a declined row so the launch claims a
  fresh one (an `x_taken` or `no_ticker` result puts the no back). Final review 1: every yes (flag on) sets
  `standing_seen.token_offered` (`markTokenYes`, clearing `token_skipped`), so a launch it drops is retried by the cron
  and a wallet proven later launches it.
- **The legacy offer (Task 6, F11).** For a builder who set up before v4: `wallet-offer.ts tokenOfferDue` (flag on, X
  claimed, a proven wallet, no `builder_tokens` row, none of `token_offered`, `token_offer_legacy`, `token_skipped`, not a
  test installation via `installations.ts testBuilderSql`). Shown once in a quiet ranked reply (`stateAsk` kind `token`,
  `TOKEN_OFFER`) or in `tokenAsk`, claimed by `takeTokenOffer`, stored as ask kind `token` (`TOKEN_ASK_NOTE`). Final
  review 1 (money safety): showing it writes only `token_offer_legacy`; `token_offered` is the yes, and
  `retryDroppedBuilderTokens` and `launchOnProof` launch only on `token_offered`, so a shown, unanswered offer never
  launches. A no is `declineBuilderToken`; silence is never re-asked.
- **Skipping the wallet skips the token (final review 9).** `answerWallet`'s no with no token row removes
  `token_offered` and keeps `token_skipped`: a wallet proven later (the change link) and the hourly retry launch nothing,
  the legacy offer is never shown; only "launch my token" launches. Step 3's own no (the token sentence shown) is still
  the token's no (`setupAnswer`).
- **Setup step 3 and setup done.** `afterStep3` swaps in `setupDoneFor` after the skip, the token no, or a reward wallet
  signed while step 3 is open (final review 5: `answerWallet` returns `WalletAnswer` with a typed `signed`, stripped
  before the reply; no copy sniffing). A sign that launched the token is one "Done." line ("Done. Your rewards now go to
  <wallet>, and your token is live: <trade>", the page line) from `signedToken`'s typed `launched`. `contractsOnBase`
  (a Base project, a Base contract source or Base mainnet repo facts) is the only time "Your contracts on Base will show
  on your page soon." is said. `setupDoneFor` endings: the Best fit's apply ask (kind `apply`); no real fit: the closest
  long-shot grant (kind `closest`, `CLOSEST_NOTE`; its yes "Your next step toward <program>: <step>." +
  `QUALIFY_HELP_ASK_ONE`, never a draft); a project never matched with grants open: "check which of these fits" (kind
  `check_fits`, `CHECK_FITS_ASK_NOTE`; its yes is `CHECK_FITS_NOTE`, run find again); matched with nothing to ask: the
  Monday check-in (kind `checkin`) when due and the client schedules, else no question. Final review 3: `closest` and
  `check_fits` are their own kinds, so their no is `declined['closest:<key>']` / `['check_fits:<key>']`, never
  `qualify:<key>` (which `base-qualify.ts qualifyOffer` reads).
- **Copy.** The ship step's points line is gone (`shipLine`); the connect offer reads no points (final review 4:
  `ConnectOffer` is `{ weeks }`, `points.ts connectOfferPoints` removed, so no points read can hide it).
  `TITLES_NO_LINE` "Got it, your commit titles stay private." answers the titles no. The closing-soon apply yes is
  `readyDraft` (the entry's stored answers as the submit kit) before a fresh draft.
- **Submitted and eligibility.** `tools.ts markSubmitted` passes `entryId` to `record_submission` (F7): an old call with a
  project and no repo marks the one entry of that name in the program (two are ambiguous: none), never a second row.
  `match-projects.ts checkEligibility(ref, program, deps, told)` takes what the builder told about the repo
  (`get_program`, from the builder memory), as the lists do.
- **Stats.** `tokens_declined` (declined builder tokens) and `coins_launched` (launched project tokens plus launched
  builder tokens), both without test installations (`testBuilderSql`, final review 6).

## v4.3 Task 1: the qualify reply carries the money (2026-10-29)

- **The copy (owner-approved, byte for byte).** For a ranked builder with no fit and Base Builder Grants offered
  (`base-qualify.ts qualifyOffer`), `bench-reply.ts rankedReply`'s qualify branch is: the standing (once-shown rule) and
  due lines as their own paragraph; then `qualifyHead` ("Base Builder Grants: $5,000, rolling.": `grantProgramName(title)`,
  the grant's amount, `when` from `stand-view.ts fundWhen`) and `qualifyGap` on one line; then `alsoLine` ("Also open: ..."
  for up to two other grants, absent with none); then the question. No ship line, no money line, and the week's ship line
  is not marked shown (`nag_week`) by a qualify reply.
- **The gap.** Every remaining step known missing: "<name> is one step away: ..." / "N steps away"; otherwise "To qualify,
  <name> needs to ...". Builder Codes are explained once: after their item when last, else in their own sentence.
  `qualifyMissing` is removed.
- **Also open.** `bench-find.ts alsoOpen(cards, now, skip, not)`: `showable` (never sponsored, an EarnKit campaign, an
  investment or hidden) minus the qualify program, `byRelevance`, two at most; title before ':', `upToCell(prizeOf)` and
  `fundWhen`. Set on `BenchView.also` only when the ask is qualify.
- **The question by the first step** (`qualifyAsk(g, steps, name, hosted = false)`): codes "Want me to add Builder Codes to <name>?";
  base "Want help putting <name> on Base?"; use only, the old "Want the next step toward Base's $5,000 grant?".
- **The yes.** The stored ask's `qualify` gains `first` and `name`; `benchMoveUp` kind qualify with `first === 'codes'`
  answers `qualifyCodesYes(name)` ("Adding Builder Codes to <name>. Base's guide: https://...", no question) with
  `QUALIFY_CODES_NOTE` (add it here, show the change, don't ask again). Other first steps (and older stored asks without
  `first`) keep `qualifySteps`. The no is unchanged (`declined['qualify:<key>']`).
- Tests: `v43-first-answer.test.ts` (pure copy, the owner's state through `mcpCall` byte for byte, the yes, the no).
  `fixtures/ranked-step.ts endsOnRankedStep` accepts the qualify reply (head paragraph, question last);
  `fixtures/banned-words.ts` allows the Builder Codes tag and the Base question. Tests about the weekly target decline
  Base's grant steps first so the ship step shows.
- **Fix round 1.** Hosted agents (`agentReach` hosted, passed as `stateAsk({ hosted })`) are asked "Want the steps to
  add Builder Codes to <name>?" when codes is first; the stored `qualify.hosted` makes the yes `qualifySteps` with
  `QUALIFY_STEPS_NOTE_HOSTED`. The stored `qualify.codes_missing` false (the Builder Codes check unknown) answers the codes
  yes with `QUALIFY_CODES_CHECK_NOTE` (check the code first; add only if not there). `alsoOpen` lists grants only
  (`site-copy.ts programKind(c).startsWith('grant')`: never an investment, a prize program or a hackathon); `alsoLine`
  alone cuts the title at ':'.

## v4.3 Task 2: the full list never contradicts itself (2026-10-29)

- **Routing.** `tools.ts list_programs` sends a profiled, scoring (non-shared) builder to `benchFind` with `more` too
  (`more: true`). `benchFind` answers null before benchView claims anything unless the state is ranked (signed in,
  the one project counted); null falls through to today's `present.ts` path. Shared clients always keep that path
  (hostedAnon still requires `!more`). With `more`, `signedOut` is read by `benchFind` itself (tools.ts never read it for
  `more`), and the named-wallet change reply stays `!more`.
- **The table.** `present.ts fullProgramTable(m, entered)`: every shown curated card (layout's matched rows, then the
  whole `rest`, investments included, sponsored never; `layout` now also returns `rest`), today's `more` columns and
  cells (Program | AMOUNT_HEADER | Difficulty | Ends: programCell, upToCell(prizeOf), difficultyCell, endsOf), never
  "N more open". Set on `BenchView.fullTable` for a ranked `more` reply.
- **Placement** (`bench-reply.ts`). The qualify reply renders `fullTable` in place of `alsoLine`. Every other ranked
  reply goes through `withTable(reply, table, ask)`: the table right before the reply's question (its last line, split as
  its own paragraph), else after everything (no question, or the owning nudge whose question leads).
  The stored bench_ask and move_up are written as for `find {}`, so a yes to the question works.
- **The old path** (`presentFirstMessage` with `more`): `noFitLine` only when no program table (`shown`) follows;
  `programUpdates` entries for a program in a table above (matched rows or `shown`, matched by program id) are
  dropped; "Updates:" only while entries remain.
- Tests: `v43-first-answer.test.ts` (owner `find {more: true}` byte for byte, the stored ask and its yes, eight days on
  no "Updates:"; table before the question in a ship reply; a shared client's `more` has no "doesn't fit"; the old path's
  update filter). Updated pins: `present.test.ts` (I3 noFit, Ruling 28 x2, I7 updates) and `match-projects.test.ts` 2.9.

## v4.3 final review fixes (2026-10-29)

- **more only on request.** `mcp.ts FIND_DESCRIPTION_BENCH` and the `more` field: `more: true` only when the builder
  asks for the full list or everything open (or yes to "Want the 3 easiest?"); "what can I earn" is a plain find.
- **No one-time offers on more.** `benchView` with `o.more` never claims or opens connect, an event post, a nudge
  (stand-in included), the weekly moment, the check-in, the wallet step, the token offer, the new-repo nudge or titles
  (setup-done was already held). They stay due for the next plain find. The question is qualify, apply or ship (or
  none; a held question and setup step 3 keep their place). `benchFind` never sets `fullTable` on a post or share ask.
- **Yes copy.** The codes yes with the check unknown (`codes_missing` false) is `qualifyCodesYes(name, false)`:
  "Adding Builder Codes to <name> if they're not there yet. Base's guide: ...". The yes to "Want help putting <name>
  on Base?" (`first === 'base'`) is `qualifySteps(g, steps, false)` (the steps, no question) with
  `QUALIFY_BASE_YES_NOTE` (`_HOSTED`): help with step 1 now.
- `fixtures/ranked-step.ts QUALIFY_ASK` accepts the hosted "Want the steps to add Builder Codes to <name>?".
  `points.ts POINTS_PAGE_LINE` is removed; `base-qualify.ts qualifyPlan`'s `head` is required.
- **Fix round 1.** With `more`: no table on a nudge-owned reply or on the wallet_setup step 3 reply (bench-find leaves
  `fullTable` unset; rankedReply also skips it for wallet_setup), so the question stays last and step 3 word for word.
  benchView takes `more` and skips the setup-done branch, so `setup_done` stays unclaimed for the next plain find.
  `benchFind` reads `signedOut` once, at the top, and a signed-out `more` returns null before `coveredRead`.
  `programUpdates` returns `ProgramUpdate { text, program_id }` (FirstMessage.updates accepts strings too); the
  tabled-program filter matches by id.

## v4.3 Task 3: no points, no empty rank, a standing fact (2026-10-29)

v4.3 in one paragraph. The ranked qualify reply is head (program, amount, rolling or closes), gap (steps known missing,
"To qualify" when partly unknown), "Also open" (two other open grants) and one question; a hosted agent is asked for the
steps and the codes yes adds Builder Codes with no question. `find {more: true}` for a ranked builder goes through the
same Bench reply with the full program table in place of "Also open" (same stored ask and move_up, never "doesn't fit",
never the setup-done reply, no table on a nudge or step 3); the present.ts path drops "doesn't fit" above a table and
updates for shown programs. Task 3: find and score replies carry no `points_total` and no points fact in `facts`
(`reply-facts.ts` drops `points` and `about.points`); `rank_lines` is sent only when non-empty; `standing`
(`bench-find.ts standingFields`: absent for 0 weeks, `1 week shipping`, `n weeks shipping in a row`) is the fact the agent
answers "where do I stand" from. `ANSWER_FIRST_NOTE` no longer lists points, rank or how ranking works, and answers a
points question with "EarnKit doesn't use points. It tracks the weeks you ship." `/api/stats` `points_total` was dropped in v4.7.1; the
internal ledger stays (owner analytics). Tests: `v43-first-answer.test.ts`; updated pins: `leaderboard-clarity.test.ts`
R10 (absent, not `[]`) and `v31-answerable.test.ts` (no points in facts or about).

## v4.4: setup order and "I already have a token" (2026-10-29)

Setup step 3 (`bench-reply.ts walletSetupAsk(project, link)`) asks for the wallet only ("It's where grant money and
builder campaign payouts get paid."), never names the token and never sets `standing_seen.token_offered`, so the proof
launches nothing; `walletSetupToken` and the step-3 token sentence are gone, and its plain no is the wallet skip. Once the
wallet is signed for step 3 (the tell path `afterStep3`, or the next find in `benchView` when setup settled `set`), the one
token offer follows when due (`bench-find.ts setupOffer`: `tokenOfferDue` + `takeTokenOffer`; tokens on, no row, never an
owner test installation): `setupTokenOffer(short)` ("Done. Your payouts go to <wallet>." + the optional token + "Want it
live?"), stored as `{ kind: 'token', key: null, at, setup: true }`. Its answer (`benchMoveUp` kind `token`, or a kindless
yes/no, via `takeTokenAsk`) is the setup-done reply with the outcome (`launched`, `on_its_way`, `declined`). Builders shown
v4.0's sentence (`token_offered` set) keep it: their sign still launches, the hourly retry still covers them, no second
offer. A step-3 skip shows no offer; a wallet proven later gets the ranked `TOKEN_OFFER` once. `TOKEN_OFFER_QUESTION` is
"If you already have a token or would rather skip it, just say so and I won't ask again.\n\nWant it live?".
Task 2: `tell token: { existing: '<address>' }` (mcp.ts and tools.ts: `'ask'` or `{ existing }`) runs
`bench-find.ts tokenExisting` -> `builder-token.ts recordExistingToken`: lowercased 0x40 hex, a Base check
(`baseTokenCheck`, alchemy.ts `isToken`'s two reads; a revert is no, a failed read or Alchemy off accepts), then a
`builder_tokens` row with status `existing` and `coin_address` (no wallet, no symbol). A declined (or earlier existing)
row becomes it; launching/launched/unknown is unchanged (`has_token`: the state text). Fix round 1: the address is an
unverified claim that grants nothing, so it never blocks anyone: `coin_address` is unique only among non-existing rows
(partial index `builder_tokens_coin_address_launch`, replacing the column UNIQUE), so any number of builders may name
the same address and an EarnKit launch of it is never refused. Recorded: "Got it. I've noted <short> as your token, and I won't offer one again." and, answering the setup
offer, then the setup-done reply (outcome `existing`, lead "You're all set, <first>."). Not a token: its line and
the stored ask stays (another address, or "skip" = the token's no). An existing row ends every offer (`tokenOfferDue`
needs no row), `launchBuilderToken` returns `exists` for it, `retryDroppedBuilderTokens` never selects it, and every
reader that shows or counts a launch reads `status = 'launched'` (`/api/builder-tokens`, stats, token card, backers,
fee claims) or the row's `wallet` (null here), so it is never presented as an EarnKit launch. `tokenAnswerText`:
"Your token is <short>. EarnKit didn't launch it, so its fees aren't claimed here." (v4.5 never reads it: an
`existing` claim is never a contract source.) Tests: `v44-setup-order.test.ts`.

## v4.5: verified traction in drafts and replies (2026-10-29, plan: v4.5-plan.md)

v4.5 in one paragraph. Task 1: Hardhat Ignition deploy files (`ignition/deployments/chain-<id>/deployed_addresses.json`
plus the journal's sender per future id) are contract clues (`discovery-clues.ts ignitionClues`, Base and Arc only),
proven the same way as Foundry and Hardhat clues (`contractOwnership`, unchanged: a contract named in constants or a
README never counts). Task 2: `revenue.ts runRevenue`, the cron's daily step after Used by, reads what outside wallets
paid (ETH and Base USDC, `alchemy.ts contractFlows`) into the builder's newest counted Base contracts (`used-by.ts
contractsOf`, never a token, never v4.4's `existing` token claims) over 30 days, with `contractsUsage`'s exclusions
(own wallets, deployers, wallets they or a read contract's deployer funded in ETH or Base USDC; none of the builder's
own contracts ever pays). Pass-through is judged per contract: outbound to outside addresses (an unread own contract
counts as outside) at least half its inbound, or a capped outbound read, adds nothing, and what a pass-through
contract sends beyond its own inbound offsets the others (a wash through own contracts nets 0). One `app_revenue` row per builder and UTC day; a failed read stores nothing.
Task 3: `ship-log-facts.ts tractionFacts` gives the drafts' ship log (`shipLogFacts`, `shipLogBlock`) and
`reply-facts.ts replyFacts` (`used_by_30d`, `revenue_30d_usd`) the verified numbers: usage as the page's Used by row
picks it (`site-data.ts usageRows` + `bestUsage`, shared with `usedByOf`), revenue from `latestRevenue` from $100
(whole dollars, "+" when capped). A hidden page still gets both in its own drafts and replies. Revenue is private:
`builder-json.ts`, `site-data.ts`, `app/[handle]`, `/api/stats` and the feed never read `app_revenue`
(`v45-traction.test.ts` 3.4 checks the serialized outputs). Tests: `v45-traction.test.ts`.

v4.6 Stripe key store (the ownership rule stops casual misuse only; a cooperating account holder can set the website): a builder pastes a live restricted Stripe key on `/connect/stripe` (POST goes to `/connect/stripe/key`; link token purpose-bound to 'stripe',
so wallet links and Stripe links never open each other's page). The key is checked with read-only GETs through an injectable
`StripeCall`, must belong to an account whose website is one of the builder's verified sites, and is stored sealed
(`secret-box.ts`) in `stripe_connections`. The key is never logged, returned, evented or stored in plaintext; `sk_live_` and test
keys are refused before any call. v4.7.3 T2: after the reads and the ownership rule, `checkKey` sends `WRITE_PROBES` (26 bodiless
POST updates of made-up object ids, one per write permission, e.g. `/v1/customers/cus_ekprobe`; `StripeCall`'s optional `method`)
in parallel. A key without that Write permission gets 403 (Stripe checks the permission before it looks up the object; unconfirmed
by official docs, the owner's real-key test confirms it). All must be 403. A 400 or 404 on any is write access
(`STRIPE_TEXT.writeAccess`); else a 401 is `rejected`; any other answer or a failed call is "try again" (fail closed). An update of
a missing object creates and changes nothing. `checkKey` logs one line `[stripe] probes customers:403 checkout/sessions:403 ...`
(full probe path minus the id, no key, no account id) for reading the real-key test from the logs. Nothing is stored on refusal.
The daily read never probes. Issuing and accounts are deliberately not probed (they can answer "not enabled" before the permission check).
v4.7.3 Task 1 (env): `EARNKIT_STRIPE_SECRET` (32 or more characters; shorter counts as unset) seals and opens the Stripe key (`secret-box.ts`, purpose 'stripe'; it never falls
back to `EARNKIT_AUTH_SECRET`, which still signs the link tokens). Unset, Stripe connect is off: `stripeLink` is null (no ask,
no link), the page and the POST answer `STRIPE_TEXT.off` (POST 503), `connectStripe` makes no call, and the daily read returns
the note `EARNKIT_STRIPE_SECRET is not set, Stripe not read`. Changing it breaks every stored connection (marked `broken` on the
next read, re-offered once). A link connects once: a stored connection inserts `stripeUseKey(token)` (sha256 of `stripe:<token>`)
into `wallet_proof_uses` in the same transaction as the upsert, so the page then shows `STRIPE_TEXT.used` and a POST is refused
before any Stripe call; a refused paste writes nothing and the link stays usable. The wallet flow's one-day prune of
`wallet_proof_uses` cannot reopen a Stripe link (links expire after 30 minutes). The paste field is `type="password"`.

- **Daily Stripe read (v4.6 Task 2).** After `runRevenue`, the cron reads each `stripe_connections` row in state `ok` at most once a UTC day
  (rate-limit claim `stripe:<id>:<day>`, own slice via `builderCodesSliceEnd`). Net = balance transactions `charge`/`payment` minus `refund`/
  `payment_refund`, disputes (`adjustment` + reporting_category `dispute`) minus, `dispute_reversal` plus; before Stripe fees; clamped at 0.
  Payers come from `/v1/charges` (fingerprint, else customer, else email); charges whose email is the builder's `digest_subscriptions.email` are dropped
  with their balance transaction. `shown` = at least 3 payers and top share at most 50%. Any failure stores nothing; the page cap stores `capped`.
  `latestStripe` returns fresh (`USED_STALE_DAYS`), shown rows of at least `REVENUE_MIN`. The key appears in no log, note or error (only error names are logged).
- **Drafts, replies and the Stripe ask (v4.6 Task 3).** `tractionFacts` adds `stripe` (`latestStripe`, whole dollars); `shipLogBlock` prints
  `$N received through Stripe in the last 30 days, verified from Stripe` (plus `, $M a month in subscriptions` from `REVENUE_MIN`, `+` only on the 30-day
  figure) right after the onchain revenue line, and `replyFacts` carries `stripe_30d_usd` / `stripe_mrr_usd`. Private like v4.5: not in builder.json, page
  data, `/api/stats` or the feed (tested). The one-time ask (`stateAsk` kind `stripe`, after `apply`, before `share`) fires in a quiet ranked reply
  (same gates as the token offer) for a builder with a verified `site` source and no connection (`stripeAskDue`; claimed in `standing_seen.stripe_asked`);
  its no is `declined['stripe:*']` and never expires (unlike the 30-day DECLINE_MS); a `broken` connection re-offers once (`stripe_reoffered`). No
  `stripeLink` (no secret) means no ask. `tell { stripe: 'connect' | 'disconnect' }` works any time; disconnect deletes the key row and the stored
  `stripe_revenue` rows. Every Stripe reply and note tells the agent never to ask for a key in chat.

v4.7 where you stand (Task 2): every find and score reply carries `standing` (standing.ts `standingParagraph`): the page's own score and
rank (`pageScore`, the rule bench-data `profileData` now calls, beside rankLines' `bench`: no rank under RANK_MIN_POOL, no score
while unlisted), the weeks shipping, announced prizes won (earned.ts `prizesWonSql`, never a self-report; else "No grants won yet"),
`applicationCounts` (submitted entries or a told "applied", one per program; drafts: an unsent entry with a real answer in an open
program not applied to; Task 3's token gate reuses it) and the earliest open fit deadline (deadline.ts `closeDay`). `benchScore`
sets `view.standingLed`: the standing is the score reply's first paragraph (not signed out, not setup step 3), and the reply's
own standing line and connect standing are left out. Fix round 1: it leads only with a score or a streak part, never over the
Monday block or a post offer; signed out, or a shared client that is no person (`personal`, replyFacts' gate), the standing is
the weeks only and nothing is read. find keeps its changed-only standing line; the fact is there whenever it has a part.
Agent guidance is in SCORE_DESCRIPTION and FIND_DESCRIPTION_BENCH (ruling R1: the server instructions stay at 795).

v4.7 the first reply is money only (Task 3): in a ranked reply with an open fit not applied to (benchView `open`: not told,
entered, hidden or declined), the ask is that fit's `apply`: claimed once a program (`claimApply`), and after that asked
again (`again`, unclaimed). Fix round 1 (R8, R11): while one is left (`moneyFirst`), only setup step 3, connect and an
owning nudge go ahead of it; event posts (hot ones too), the Monday moment, non-owning nudges and every quieter ask wait
unclaimed, and `stateAsk` puts `apply` before `post`. A draft in the builder's hands (`standing_seen.apply_yes`, set by
the apply yes and by a draft `draftWithSteps` returns, `recordApplyYes`) is not asked again for DECLINE_MS, and counts as
the money step for the token offer. Fix round 2 (R12): each apply showing counts in `standing_seen.apply_unanswered`
(reset by a yes or no); after `APPLY_UNANSWERED_MAX` (3) unanswered showings the program stands aside as a no would
(`declined['apply:<id>']` for DECLINE_MS, marked `apply_silent`), so the other asks resume; it comes back after. The apply
reply is the money alone (`rankedBody`: the deadline lines, then `applyAsk`; no standing or ship line, so `status_seen`
and `nag_week` are not marked by it). The Stripe ask left the reply order (no `stripe` in `stateAsk`; a stored v4.6 ask
still answers): `tools.ts draftWithSteps` adds one agent-note line (`stripeDraftNote`, the exact line `stripeDraftLine`)
to a shown draft for a program whose file says `wants_revenue: true` (base-builder-grants, circle-developer-grants,
colosseum-worlds-fair), claimed once with `stripe.ts takeStripeDraftLink` (`stripeAskDue`, `stripe_asked` /
`stripe_reoffered`); never on a shared client or the build path. `tokenOfferDue` also needs applied + drafts >= 1
(`standing.ts applicationCounts`), except when the builder asked (`tell token 'ask'`: `{ asked: true }`). Wallet proofs
launch nothing (above). llms.txt: the token is offered after the first application. Tests: `v47-money-first.test.ts`.

v4.7 EarnKit speaks first (all tasks, 2026-10-30). The owner: "EarnKit never messages me." v4.7 makes EarnKit say
the money and the next step without being asked. T1: one close day everywhere (deadline.ts `closeDay`, the program's
own zone). T2: every find and score reply carries where the builder stands (`standing`). T3: the first ranked reply
with an open fit is that fit's money ask alone; the token offer waits for the first application. T4: every ask carries
its why. T5: email is the push channel. One opted-in subscription (digest.ts, asked with "Want deadline alerts and a
Monday summary by email?") gets the Monday summary, now topped by the standing paragraph (best-fit.ts `standingFor`),
and at most one alert email a UTC day (alert-mail.ts `runAlertMail`, cron step `alert_mail` in every cron run, no hour gate: prod's cron runs
about every 6 hours; the builders mailed longest ago go first):
the highest unsent event of accepted (an outcome post with proof) > closing (a fit or a draft within DEADLINE_DAYS) >
new fit (`alertFit` on the remembered repos). Each event is mailed once ever (`alert_mail_sent`, written in the send's
transaction under an advisory lock, so a failed send stores nothing and two runs never double-send). Alerts use only
the Resend day and month room left after every digest still due this week. Final review: "applied" is one group rule
(standing.ts `toldAppliedSql`), "drafted" find's 30-day `draftedRecently` (policy-constants.ts), a fit set aside for
silence still gets its closing alert (only an explicit no drops it), the Monday email's close days use `closeDay`, and a
reply's lead names the program its apply ask asks. Every email has reply_to CONTACT_EMAIL and
the digest's unsubscribe link and headers. Agents are told to call find at the start of every session (the
instructions' first line; ruling R1 keeps them under 800 characters by dropping the move_up and score lines, which
the tool descriptions carry).

v4.7.1 money always shows (Task 1, 2026-10-30). The owner's dogfood: with no fit and Base's steps declined, "what can I
earn" led with a Monday check-in and no money; a second find said "EarnKit · 6 weeks in a row". Now a ranked reply with
no unapplied fit opens with "Open now: {title}, {amount}, {when}." for up to two open grants (bench-find.ts
`openNowGrants`: grants only, soonest deadline first, rolling last), before any non-money ask (connect, the Monday block,
a post, the check-in, wallet, token, new repo, titles, ship) and on the quiet reply too; a builder with a fit hears
v4.7's reply word for word. With no fit and no qualify due, the ask is `check_fits` once ("Want me to check what Kit
would need for Arc Microgrants?", its why "None of these fit Kit on what EarnKit can see yet."), never naming Base's
grant; its yes runs find and reads that program's requirements. Ranked replies show v4.7's standing paragraph in place
of `standingLine`, under the same changed-only key (`status_seen` still holds the old line, so nothing re-shows).
v4.7.2 Task 2 (the why names the gap, 2026-10-31): the ranked `check_fits` ask is per program, not once a person. It names
the first open program of the money paragraph (open grants, then the open investment; never Base's grant) not said no
to or answered yes within DECLINE_MS (`declined['needs:<id>']`, `standing_seen.needs_yes`) and not shown
APPLY_UNANSWERED_MAX times unanswered (`standing_seen.needs_unanswered`, apply_unanswered's rule: then it stands aside
as a no). Its why is `needsWhy` ("Arc Microgrants needs EarnKit on Arc mainnet."), from `programNeeds` on the program row
(`getProgramRow`: needs_contract, needs_repo, a required live_url field) against `needsKnown` (`onChainKnown`, a verified
repo, `liveOrUsersKnown`); the question is `needsAsk` ("Want the steps to get EarnKit ready for Arc Microgrants?"). With no
program left, the quiet ranked reply showing the open grants ends with `ASKS_HINT` and no question.
`check_fits_asked` stays in old rows, never read.
v4.7.2 final review: the needs ask names open grants only (never the investment, which the money line names), for a
person only (`o.personal`). Three unanswered showings mark `needs_silent` (held DECLINE_MS, not a no); only an explicit
no (`declined['needs:<id>']`) keeps an investment out of the slot. No known gap: "EarnKit can't see what {program} would
need from {name} yet." / "Want me to check {program}'s requirements for {name}?". A yes never runs find: `needsYesNote`
lists the program's requirements with the stored gaps. Facts come from the Card (`needs_contract`, `needs_live` from
programCard); "in a public repo" clears only on a repo read public (`public_at` or the latest reading). The total is
/api/stats' figure (`openMoneyNow` reads every active program); with no grant listed, the Open now line drops it.

## v4.8 Task 1: the path leads the ranked reply (2026-10-31, plan: v4.8-plan.md, target: v4.8-target-conversation.md)

EarnKit speaks first: the server instructions' first line is "Call find at the start of every session before they say
anything, and show its opener." A ranked builder's find (and score, after its standing paragraph) is now the path's
reply (conversation.ts pathReply, built by bench-find.ts pathView), unless setup step 3 (and the one-time setup-done
reply), a held submit question or an owning nudge comes first. bestMove picks the program: a real fit closing first;
a grant one step away; an investor program closing within 7 days (never called a fit, never summed); the closest grant
by number of gaps; otherwise quiet, and the older ranked reply answers (connect, the Monday block, posts, check-in,
wallet, token, new repo, titles, ship). Programs told about, drafted, hidden or entered are never the hook, and a no to
the hook parks the program ('path:<id>' beside its old key) for DECLINE_MS. Task 1 builds only the `hook` stage: a fit
or investor program gets A's opener ("{first}, {program} closes {when}: {amount}." + one proof line, then "I can draft
your application ... Want me to start?", stored as the apply ask so a yes drafts it); a grant with a gap gets its money,
the gap sentence (qualifyGap for Base, needsWhy otherwise) and "Want the steps?" (stored as qualify or check_fits). The
reply's note is MENTOR_NOTE alone (withFacts never adds the "exactly as written" note to it). standing_seen.said holds
the session's parts said; after SESSION_MS (2 hours) of quiet it starts again, and the same hook twice in a session is a
one-line pointer. A program the builder picked (Path.picked) or said yes past the hook keeps its place on the path.
find takes `ask` ('standing' | 'programs') and `program` (carried to benchFind as question and named for Tasks 4 and 5).

Retired: the forced "Open now:" money paragraph (openNowGrants, openNowLine, openTotal/openInvest/openNow on BenchView),
ASKS_HINT (the quiet reply's line and the setup-done first-run line; standing_seen.asks_hint is never read), the
rotating needs ask (needsAsk, needsAskable, needs_unanswered/needs_yes/needs_silent, possessive; programNeeds, needsKnown
and needsWhy stay as the gap engine) and the v4.7 money-first apply loop (claimApply, apply_unanswered, apply_silent,
standAside, APPLY_UNANSWERED_MAX). Base's v4.3 qualify reply no longer shows on a plain find once the path ran
(it still answers find {more: true}); R6 (never pitch a program told applied or drafted) stays on the older reply's
fit lines.

## v4.8 Task 2: the gap and draft stages (2026-10-31)

A yes on the path moves the stage on (bench-find.ts benchMoveUp, asks stored with `path: true`):
- **hook to gap.** The yes to "Want the steps?" (qualify for Base, check_fits for another grant) is the gap stage
  (gapYes, conversation.ts gapReply): "Your next step toward {program}:" and the numbered steps (Base: bench-reply.ts
  qualifyGapSteps; another grant: programNeeds' gaps as lines plus the program file's `setup`). Each step the agent can
  do in the repo (only Builder Codes) is marked "I can do this." and listed first; the reply ends "Go?" (one step),
  "Want me to do the first one now?" (several) or, when the agent can do none or is hosted (agent-reach.ts, read now:
  F3), the help ask. The steps' question is stored again (gap: true). Its yes (gapDoYes) is the agent adding Builder
  Codes, pushing, then calling find (MENTOR_NOTE), with standing_seen.gap_did stamped; a hosted agent walks the builder
  through it instead.
- **gap closed.** On each find while the path is at gap on Base (or at draft, not yet drafted), pathPlan reads Builder
  Codes (codesConfirmed: the stored answer; within SESSION_MS of gap_did, a not-found answer over a minute old is
  checked again now, awaited, without spending the daily claim). Confirmed with no Base step left, the reply is
  pathClosedCommit's "Builder Codes are in. You now meet Base's first requirement. Want me to draft the Base application
  next?" (another grant whose needs are all known met: "{program}'s steps are done." + the same offer); the path moves
  to draft and the apply ask (path) is stored. On Base's gap, qualify_given no longer hides Base from the path.
- **hook to draft.** The yes to "Want me to start?" (or the draft offer) is pathDraft: "Here's your draft:", the
  verified record (ship-log-facts.ts shipLogBlock: score, streak, live link, page link, verified usage and revenue
  under its own freshness and minimum rules; none on a shared client), then the blanks only the builder can fill
  (conversation.ts draftBlanks / blanksAsk) as one reply ("Two blanks only you can fill: ... Reply with both and I'll
  finish it."). An investor program whose required fields are all contact details (questions not public) gets a short
  founder brief whose blanks are FOUNDER_BLANKS (team, money raised); any other program's blanks are its required
  `from: 'builder'` fields EarnKit doesn't hold (the answer bank, the X handle). The note tells the agent to draft
  through prepare (questionsDraftNote) or write the brief (founderBriefNote), then MENTOR_NOTE. The draft's own ask is
  stored (draft: true): a yes to it is "Okay.", a no parks the program.
- A no at any stage parks the program ('path:<id>', DECLINE_MS); the next find hooks the next bestMove program. A
  builder past the hook on a program keeps that stage when the hook's words are repeated (pathCommit).
- Fix round 1: Builder Codes' one-step ask is "I can add them and push the change, about 10 minutes. Go?" (the yes
  covers the push). A find mid-gap (steps given, not closed) is pathGapCommit's "Still on {program}: {first remaining
  step}. {proof} Want me to do it now?" (help ask when the agent can't), never "Want the steps?" again. The steps reply
  and the steps-done reply carry one proof line (conversation.ts gapProof: "You're live on Base." / "You're on Base."
  from Base's remaining steps, else the streak and live line).
- Fix round 2: a grant whose one gap a local agent can do (Builder Codes) is hooked with "... I can add them and push
  the change, about 10 minutes. Go?" (pathReply `go`, stored as the gap ask), skipping the steps turn; hosted agents
  keep "Want the steps?". The Builder Codes re-check runs when the stored answer is older than the builder's yes
  (gap_did), waits RECHECK_WAIT (8 s) inside find, then continues in the background (one per repo; a failed read stamps
  gap_check_failed, 2 minute backoff) with "I'm checking the code now. Give it a minute, then say ok.". Base's gap
  closes only when qualifyOffer reports every step met (allMet), never on a failed read. Another grant's steps are only
  its unmet programNeeds gaps (setup items dropped). Draft blanks are only what EarnKit doesn't hold (confirmed Builder
  Code, verified usage, the bank) and the agent can't draft (team, usage numbers, a demo video, links, choices,
  amounts, codes), at most 2 (`later` waits for prepare's round); contact details are typed at submit for every
  program; narrative builder fields are drafted and marked for the builder to check. A yes to the draft's ask re-asks
  its blanks ("I need ... Reply with them.") or, with none, moves the path to submit ("It's ready. Submit at {link}.").
  MENTOR_NOTE and the draft notes carry "Never tell them they qualify or that an application was sent."; with no record
  the draft notes say to leave traction out. Lists use ", and" at any count. A grant the builder took up past the hook
  stays a bestMove move after its passed step was raised.
- Fix round 3: tell move_up takes `blanks` (the builder's reply to a draft's blanks, never stored); a yes carrying it,
  or a yes after prepare ran with coach_asked (draftAnswered clears the stored blanks), never re-asks. withFacts puts
  PATH_ANSWER_FIRST ("If they asked a question, answer it first in one short line from the facts.") before MENTOR_NOTE
  on find and score path replies. The repeated hook offer names Builder Codes. A proven payout wallet fills a payout
  wallet field; "code" makes a blank only as a builder, referral, invite, promo, access or discount code. The checking
  reply stores its own gap ask (`checking`): a no parks Base, an ok re-checks. Any yes to a Base gap step (hosted too)
  stamps gap_did.


## v4.8 Task 3: submit, track and the next program; "Since {day}" (2026-10-31)

- **draft to submit.** A yes to the draft's ask carrying the builder's answers (move_up.blanks), or a yes with no blanks
  left, is bench-find.ts pathSubmit: the path moves to `submit` and the reply is conversation.ts submitReply ("Done,
  it's ready to paste. Submit at {submission_url} before {by}." where `by` is submitBy in the program's own zone, e.g.
  "tomorrow 11:59 PM PT"; then "The form also asks for {contact fields}." (ruling T2-1); then SENT_ASK, `Reply "sent"
  once it's in, and I'll keep track of it for you.`). The submit ask is stored (kind apply, `submit: true`); SENT_NOTE
  tells the agent to record "sent" with tell program_status applied. Task 2's temporary readyToSubmit is gone.
- **submit pointer.** A find while the path waits at submit for a program still open and never told about or parked
  (submitWaiting) is pathSubmitCommit's one line: "Your {program} application is ready to submit, closes {when}. Reply
  "sent" once it's in." (conversation.ts submitPointer), never the draft again. It leads the path (before bestMove: the
  drafted program is skipped there).
- **sent to track.** tools.ts tell: a program told applied (program_status, `submitted`, or a yes to the stored submit
  ask, read by submitAsked and turned into program_status applied) that is the path's program at draft or submit is
  pathTrack: path -> `track`, the stored ask cleared. The same tell then runs find and returns one reply: conversation.ts
  trackLead ("Nice, I'm tracking it." plus the program file's difficulty_override.basis as written, and "so let's line
  up money that's closer." when find's reply is a path reply), then find's reply (the next bestMove program, the applied
  one told so never hooked again; pathCommit greets no name right after "sent", AFTER_SENT_MS). Any other tell is a
  plain save as before (no find run inside it, so no one-time offer is claimed there).
- **passed-step line.** pathReply adds conversation.ts passedLine ("You passed on it {when}, but it's now the only gap
  to that money.", agoWords from the stored decline, GapGrant.passedAt) to a closest grant raised once (`raise`).
- **Since {day}.** In a fresh session (sessionOf; the last session is standing_seen.said.at), sinceFor reads stored
  facts only: the streak then (streak.ts streaksFor as of that day, only across an ISO week) and now; the last public
  daily score (builder_scores, v2-shipping, ranked) from that day or the day before and the page's score now; the path
  program's programs.opened_at after it; the program closing within 48 hours when the step doesn't say so; results
  announced since (entry_outcomes, never self-reports). conversation.ts sinceLine joins them ("Since Thursday: 1 more
  week shipped, so your streak is 7 weeks and your score is up to 79.") or returns null (nothing changed: the step
  alone). It leads every path reply (hook, mid-gap, submit pointer, the deferred closest grant); with the gap closed it
  is "{since} {program} is still open and you now meet its first requirement.\n\nDraft it now? It takes me a few
  minutes." (stillOpenLine, DRAFT_NOW_ASK).
- Fix round 1: a grant raised in this session stays bestMove's move while the path is on it (MoveCtx.raisedNow), so a
  second find is its one-line pointer ("Builder Codes are still the one step to ... Go?") and the stored ask stays.
  "sent" is only move_up answer 'sent' (tell schema) or program_status applied; a plain yes to the submit ask is
  SENT_AGAIN ("Once it's submitted, reply "sent" and I'll keep track of it.") with the ask kept. The "sent" tell keeps
  its other replies (first) and puts the path reply last. A path at track is not mid-path (F1's older moments apply).
  "Since" says "opened" only for a program new to this builder (seenBefore), the close as submitBy words it, compares
  scores only under the page's calibration, and leaves announced results to find's alerts opener. The passed line for
  Builder Codes reads "You passed on them ..., but they're now ...".
