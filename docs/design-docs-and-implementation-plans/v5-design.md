# EarnKit v5: the grant inbox (design)

**Status:** approved by the owner 2026-11-03 (section 12). The task plan is `v5-plan.md` and the
SDD ledger `v5-sdd-ledger.md`.

## 1. Intent

EarnKit v5 has one job: turn a builder's repo into money. Grants, hackathon prizes, ecosystem
programs, accelerators, bounties: any program that pays builders, however small.

EarnKit is the brain; the builder's agent is the hands. EarnKit knows every open program (amount,
deadline, rules, the actual form fields, what wins) and does the matching, the pre-fill from the
repo, and the gap math (what one change would unlock which money). The agent already holds the
builder's memory (name, socials, video, team, history), so it drafts the personal parts, closes
the gap when the builder says yes, submits in its own browser, and reports back. EarnKit never
submits.

### Why now

The owner (the first builder) already does this with their agent and no EarnKit: the agent applies
while they sleep. That proved the job is real and showed exactly what the agent cannot do alone:

- know every program the moment it opens, changes or closes, with the form's fields;
- do the gap math with program rules and repo facts side by side;
- learn across builders which repo facts plus which gap-closer won which cheque.

v4 (161K lines, 97 tables, 65 env vars, six open programs) did many other things and led its own
founder to zero applications. v5 strips to the three things above, before public launch, while
nobody depends on the rest.

### What an acquirer would buy

The structured program dataset (every builder program, with form fields and win history) and the
number of agents calling it every week. So the program pipeline is the most valuable code in v5,
the outcomes ledger second. Everything else is replaceable and is weighted that way.

## 2. Goals, non-goals, anti-goals

**Goals**

1. Zero setup. Install the MCP server; the first call already returns the repo's matches, gaps and
   ledger. No X, no GitHub sign-in, no wallet, no token, no app to install.
2. Pre-filled applications. For every fitting program, every form field EarnKit can answer from the
   repo is filled. Fields only the agent's memory can answer are named by kind. Fields only the
   builder can provide (a video, a legal entity) are named once.
3. Gap math. Near-misses come with the one change that would unlock them and the money behind it.
4. Breadth and freshness. Programs come from an automated pipeline with owner approval, not from
   hand-written files alone. Stale programs drop off by themselves.
5. The ledger. Applied, pending, won, rejected, skipped, gaps closed, with amounts. Private.
6. The weekly reason to come back: what is new, changed or closing since the last call, in the
   reply itself.
7. Smaller in every dimension: two tools, under 15 tables, under 15 env vars, one daily cron, no
   paid service added, monthly cost down.

**Non-goals (v5 does none of these)**

- Submitting a form, in any browser.
- Holding, asking for or signing a wallet. Paying anyone.
- Launching or offering a token. (The builder-coin thesis may be its own company later; the
  condition to revisit is builders asking for it unprompted.)
- Scores, streaks, leaderboards, profile pages, share cards, Monday posts, badges.
- Hosting sites or deploying contracts.
- Reading Stripe, onchain revenue, or any traction source.
- Emails to builders. (An email is earned once there are wins to report.)
- Sponsor campaigns, EarnKit's own campaigns, builder bonus, referral codes.
- Storing the builder's personal answers (name, email, team, money raised). The agent's memory
  holds them.

**Anti-goals (a v5 that did these would have failed)**

- Spamming programs. An organizer who sees low-quality or ineligible EarnKit-sourced submissions
  will blacklist the lot. Every "ready" program must be a real fit under its stated rules, and long
  shots are labelled as such.
- Inventing facts. No amount, deadline, rule or field that the program's source does not state.
- Asking the builder anything EarnKit or the agent could have derived.
- Narration. No reply describes EarnKit's internal state ("your numbers are updating").

## 3. Constraints

- The owner's build process: a version, a numbered task plan with acceptance checks, an SDD
  ledger, one subagent per task with a spec review and a code-quality review, one PR per release.
- PR branch from `origin/main` (worktree `~/ek-v5`, branch `v5-grant-inbox`).
- Cost never rises. Railway Hobby stays the only paid host. GitHub Actions cron moves from hourly
  to daily. Removed: Cloudflare worker and R2 (hosting), Alchemy and CDP (chain reads), Anthropic
  (weekly summaries), Hugging Face embeddings, Stripe, tokens.fun, X OAuth, GitHub App and OAuth.
  Kept: Postgres on Railway, Resend (owner emails only: pending program approvals and the daily
  program diff), GitHub public reads with one server token.
- Tests need `DATABASE_URL=postgresql://localhost:5432/earnkit_test` (local postgresql@17).
- External consumers to keep working or update:
  - jenil.ai's funnel tool reads `earnkit.com/api/stats` keys `installs`, `activated`,
    `weekly_active`, `shared`, `open_money_usd`, `programs_open`, `coins_launched`,
    `fees_to_safe_eth`, and reads the EarnKit DB tables `installations`, `programs`, `projects`
    directly. Its direct reads are `installations.last_seen_at` and `programs.status`,
    `starts_at`, `ends_at`, all kept with their names in v5; its `projects` read keeps working on
    the untouched v4 table (and reports zero new rows). v5 keeps `/api/stats` with the v5 keys
    (section 8); jenil.ai gets a follow-up to drop the retired keys and the `projects` read. That
    is a jenil.ai change, not an EarnKit one.
  - The owner's Grok Bot writes programs through `POST /api/programs/write` (v4.9). Kept and widened.
  - `GET /api/programs` is public and kept.
- The MCP OAuth stays standard (dynamic client registration, anonymous approval). It is how every
  client already connects; nothing visible changes at install.

## 4. The builder's experience

### Monday, the owner, v5 installed

The agent opens the session by calling `find` with the repo it is in. EarnKit answers in one reply:

> Since last Monday: 2 new programs you fit, Circle's deadline moved to Nov 20, Alliance closes
> Thursday.
>
> Ready to apply, 3:
> 1. Base Builder Grant, up to $5,000. Drafted: the project facts from the repo, the pitch from
>    the README, your team and contacts from memory. Needs your Loom demo link.
> 2. Alliance ALL19, $400K at admission, closes Thursday. Drafted.
> 3. Monad Builder Grants, up to $25,000. Drafted.
>
> One change away, 2:
> 4. Circle Developer Grants, $5K to $100K: deploy the contract on Arc (same bytecode, EarnKit has the chain details).
> 5. Base Batches 005, $100K: Builder Codes in the repo (a 10-minute change).
>
> Ledger: 3 applied ($115K asked), 0 won, 2 pending, 1 closed with no result.
>
> Say yes to apply to all three, numbers to skip, or "do 4" and I'll make the change first.

(The ledger line is illustrative: the ledger starts empty in v5. v4 stored no applications for
the owner, so there is nothing to import.)

The agent wrote that from `find`'s structured reply and its own memory. EarnKit has no LLM: it
fills the fact fields (name, one-liner, links, contract, chain, dates, a choice field when the
rule is unambiguous) and, for every prose field (problem, solution, how it works, milestones, use
of funds), returns the sources the agent writes from (a README excerpt, the repo facts, the
program's own guidance on what judges want). The agent, which is an LLM with the builder's memory,
writes the prose in the same turn, so the builder still sees "drafted". On "yes" it fills each form
in its own browser (field by field from the pre-fill, personal fields from memory) and calls `track`
with `applied` after each one. On "do 4" it makes the change, pushes, and the next `find` sees Arc
in the repo and moves Circle into "ready". When a result is due, `find` asks once; the answer goes
to `track` as `won` (with the amount), `rejected`, or `no_result`.

### A stranger, day one

Install the server in any MCP client (the same one-line commands as today). The first `find` with
the repo returns the same reply shape with no identity step at all. If the repo is private, the
agent reports the repo facts (chains, live link, last commit, contracts) and EarnKit matches on
them, marked "as reported by your agent" in the reply. Nothing else is asked, ever, unless the
builder asks for it.

### What the builder never sees

Tool names, field names, internal state, a score, a rank, a coin, a wallet, a sign-in.

## 5. The tools

Two tools. Every reply carries `show_to_builder` (plain text the agent may reword in a warm,
direct, short voice, with no emojis, no em dashes, no invented facts) and `agent_note` (what the
agent should do next, in the second person, technical words allowed).

### `find`

Input:

- `project` (required unless `program_id` is given): `name`, `description` (one line),
  `repo_url` (from the git remote; omitted for a repo with none), `live_url`, `demo_url`,
  `chains` (`[{ chain, mainnet, contract? }]` as the agent sees them in the code or deploy config),
  `last_commit_at`, `first_commit_at`, `private` (true when EarnKit should not try to read it).
- `program_id` (optional): one program's full details, rules, form fields and guide instead of the
  match.
- `filter` (optional): `category` (`grant | hackathon | investment | bounty`), `all: true` for the
  full list including non-fits.

Output (structured, plus `show_to_builder` and `agent_note`):

- `since`: programs new, changed (deadline, amount, status, form) or closing within 7 days since
  this installation's last `find`. Empty on the first call.
- `ready[]`: programs the project fits now. Each: `program_id`, `title`, `money` (text and
  `max_award_usd`), `closes_at`, `long_shot` (with the reason), `submission_url`, `form` (platform
  and field ids when known), `fields[]`: for each form requirement `key`, `label`, `type`,
  `required`, `kind`, `value` (pre-filled from the project when EarnKit can), `from`
  (`earnkit | agent | builder`), `sources[]` on agent fields (README excerpt, repo facts, the
  program's guidance: what the agent writes the prose from), `options`, `max_chars`, and
  `guidance` when the program states some. `filled` (EarnKit values) and `total` counts.
- `gaps[]`: programs one change away. Each: `program_id`, `title`, `money`, `closes_at`, `gap`
  (`kind`: `deploy_chain | builder_codes | live_url | contract | new_work | demo_video | users |
  feature`, `what` in builder words, `effort` band, `details` the agent needs such as the chain's
  RPC and explorer), and whether the agent can do it alone.
- `not_fit[]` (only with `filter.all`): the rest, with the one reason.
- `ledger`: `applied`, `asked_usd`, `won`, `won_usd`, `pending`, `rejected`, `skipped`,
  `closing_soon[]` (applied programs whose results or deadlines are near).
- `ask_outcome[]`: applied programs whose results are past due; the agent asks once.
- `as_reported`: true when the match used agent-reported facts for a private repo.

Rules:

- Ranking inside `ready` and `gaps`: fit first, then money, then time left. Investor programs are
  listed in `ready` like any other (the owner's v4 rule of hiding them until 7 days before close is
  dropped: the builder wants money, and the agent can tell an accelerator from a grant from the
  `category`).
- A program the builder skipped or applied to is never in `ready` or `gaps` again, unless its next
  round opens.
- `since` is keyed by the installation's `last_find_at`; nothing else is remembered about the
  session. There is no session state machine, no "asks", no "path".
- Pre-fill sources, in order: the project the agent passed, EarnKit's public read of the repo
  (README, homepage, chain detection, commit dates, contracts) for a public repo, and the program's
  own `project_field` mapping. Never a stored personal answer.
- Every `value` EarnKit fills is traceable to a source it states in `agent_note` on request
  (`find` with `program_id` returns the sources).

### `track`

Input: `program_id`, `status` (`applied | won | rejected | no_result | skipped | gap_done`),
`amount_usd` (with `won`), `note` (optional, 280 characters, what was submitted or what changed).

Effect: one ledger row per installation and program, latest status wins, history kept. The ledger
is keyed by installation only: v5 has no proof of who a login belongs to, so a login key would let
any installation read or write another builder's ledger. A builder with two agents has two
ledgers in v5; merging them is a later feature that needs a proof.
`gap_done` records which gap was closed so the next `find` re-reads the repo instead of trusting
the claim. `won` with an amount is the one fact that later feeds the public "what wins" layer, in
aggregate only.

### Server instructions (the whole text, for the agent)

> Call find at the start of every session with the project you are in, before the builder says
> anything, and open with its reply in your own words. Call it again when they ask about money,
> grants or programs. Draft every form from find's fields: EarnKit's values as given, agent fields
> from your memory, builder fields asked once. Submit in your own browser only when the builder
> says yes. After each submission call track. Never name tools, fields or files. Never invent an
> amount, a deadline or a rule.

## 6. Programs: data and pipeline

### The record

The v4 program file format stays the schema of record (`program-file.ts`), trimmed: `campaign`,
`starters`, `tracks`, `token_policy`, `builder_bonus`, `proof_hosts`, `x_handles`, `pitch`,
`judging` and the v4 scoring fields go. Kept and now required on every program: `category`,
`submission_requirements` with `kind`, `from` and `todo` on every item, `chains` or `any_chain`,
`needs_repo`, `existing_work`, `verified_at`. Kept and now encouraged: `form` (platform and field
ids), `focus`, `ideas`, `best_bet`, `past_rounds`. New:

- `eligibility`: a short structured list EarnKit can check: `live_product`, `chain: <id>`,
  `contract_on: <chain>`, `builder_codes`, `users`, `new_work_after: <date>`, `in_person`,
  `demo_video`, `team_size`, `incorporated`. Each item is what the gap math reads. The old free-text
  `rules` stay for the guide.
- `results_due`: when the program announces (date or "rolling, N weeks"), so `ask_outcome` fires
  once.
- `source: file | api` as today.

### Breadth

The chain allowlist (Base, Arc, Tempo, Monad, Robinhood Chain, Avalanche, any-chain) is lifted.
v5 lists any program that pays builders for software, on any chain or none, including non-crypto
programs (accelerators, open-source funds, developer grants from platforms). The owner's thesis
chains are the first to be researched, not the only ones listed. The "never Optimism" rule is
lifted with the rest (owner, 2026-11-03).

`chains` becomes an open list of slugs validated against a chain registry (`chains.ts`), which
holds for each known chain its id, RPC host, explorer and whether it is EVM. Detection from code
and the `deploy_chain` gap's details work only for registered chains; a program may name an
unregistered or non-EVM chain (Solana) and such chains match only through the agent's reported
`chains`. The registry grows by owner file, not by the bot.

`form` (platform and field ids), `focus`, `past_rounds`, `best_bet`, `eligibility` and
`results_due` become writable through the API. A write that adds or changes `form` takes the same
pending-and-approve path as a changed `submission_url`. Google Forms entry ids are readable from
the form page, so the bot can mirror them; platforms that expose no ids get `form.platform` only.

### The pipeline

1. **Research** stays on the owner's Grok Bot (no new cost) through `POST /api/programs/write`,
   with the write API widened to the new fields and the lifted allowlist. The bot's instructions
   (`docs/programs-api.md`) are rewritten for v5 and name the sources to sweep weekly: ecosystem
   grant pages, Questbook, Gitcoin, DoraHacks, Devfolio, ETHGlobal, Superteam, HackQuest, Karma
   GAP, Buidlbox, a16z, YC, Alliance, platform developer funds.
2. **Approval** stays as v4.9 built it: a new program or a changed link waits for the owner's
   one-click approval (email), everything else goes live at once with a daily diff email the owner
   can revert from.
3. **Freshness** (new, daily cron, the only cron): every program's `source_url` and
   `submission_url` are probed. A dead link, a passed `ends_at`, or a page whose text changed by
   more than a threshold flags the program `stale` and emails the bot's queue (through the owner's
   daily email). Stale programs drop out of `ready` and `gaps` after 14 days unverified, as today.
   No LLM in the cron.
4. **Files** stay the owner's override: `programs/*.json` wins over an API row with the same id.

### Outcomes

`track` rows are the outcomes dataset. v5 stores them and shows the builder their own ledger.
Aggregates ("this program said yes to 2 of 9 EarnKit builders") are not shown in v5; the table is
designed so they can be, with no personal data: program, category, chains, repo facts at
application time (live, chains, age, commit weeks), gap closed, status, amount, dates.

## 7. What goes, and how

Removed entirely (code, routes, tests, docs sections, env vars): profiles and `[handle]` pages,
leaderboard, feed, bench, badges, share and post cards, `b/`, `p/`, campaigns, claim/wallet,
connect/stripe, github verify and the App, X OAuth and sign-in, signin links, admin pages, builder
tokens, token launch, token gate, fees, bonus ledger, escrow, sponsor rules, hosting and the
Cloudflare worker, contract deploys, usage checks, events log, discovery, people signals, scores
(v1 and v2), ranks, person score, traction, revenue, Stripe, weekly moments, nudges, digests to
builders, the conversation state machine (`conversation.ts`, `bench-find.ts`, `bench-reply.ts`,
`ready-set.ts`, `ready-copy.ts`, asks, paths, sessions), answer bank, starters, archive, aliases
for v2.9 tool names, the `score`, `prepare`, `confirm` and `tell` tools.

Kept (trimmed where noted): `program-file.ts`, `programs.ts`, `programs-api.ts`,
`program-checks.ts`, `program-pending.ts`, `program-approve.ts`, `program-revert.ts`,
`programs-read.ts`, `programs-cache.ts`, `api-program-text.ts`, `submit-hosts.ts`, `match.ts` and
`match-projects.ts` (the repo reads and verdicts; traction and token parts cut), `repo-cache.ts`,
`guide.ts` and `guide-pages.ts`, `deadline.ts`, `dates.ts`, `pool.ts`, `prices.ts` (USD only if
still needed), `oauth.ts`, `oauth-routes.ts`, `mcp.ts` (rewritten around two tools), `http.ts`,
`rate-limit.ts`, `safe-fetch.ts`, `secrets.ts`, `untrusted-text.ts`, `confusables.ts`, `db.ts`,
`landing.ts` (trimmed), `site-copy.ts` (rewritten), `docs-copy.ts` (rewritten), `owner-mail.ts`,
the landing, `/programs`, `/programs/[id]`, `/docs`, `/terms` (one page), `/llms.txt`,
`/api/programs*`, `/api/stats`, `/api/cron`, `/mcp`, `/oauth/*`, `/.well-known/*`.

Database: a new `db/schema.sql` with the v5 tables only: `programs`, `program_writes`,
`installations` (id, token hash, client key, created_at, last_seen_at as today, last_find_at),
`rate_windows`,
`repo_cache` (public repo facts, 7 days), `applications` (the ledger), `application_history`,
`program_health` (the freshness probe). Migration is additive as always: v4 tables stay in the
production database untouched and unread. A script `scripts/v4-tables.mts` lists them with row
counts so the owner can drop them after a backup; dropping is an owner step, never automatic.

Code is deleted, not flagged off and not moved to `archive/`. Git history is the archive. The
architecture guide and code map are rewritten from scratch for v5 (the v2 to v4 text goes to git
history too); the design docs of v2 to v4 stay in the repo as history.

## 8. Surfaces

- **Landing**: one statement ("Get funded for what you ship."), the install command picker, the
  open programs list with money and deadlines, the count of programs and the total open money.
  No activity, no leaderboard, no art credit requirement (the paintings may stay if they fit the
  one-page layout; the builder decides).
- **/programs** and **/programs/[id]**: kept as the public, indexable guide to every program
  (the SEO door into installs).
- **/docs**: install steps per agent, how a session goes, how programs are checked, the API for
  selectors is gone.
- **/terms**: one page: what EarnKit reads (public repos; agent-reported facts), what it stores
  (installation, ledger, program data), what it never does.
- **/api/stats**: `programs_open`, `open_money_usd`, `installs`, `installs_active_7d`,
  `finds_7d`, `applications`, `applications_7d`, `won`, `won_usd`. Nothing else.
- **/llms.txt**: rewritten for v5.

## 9. Launch bar and measures

The bar for calling v5 done and for the public launch, in order:

1. The owner's agent, on a fresh install with zero identity steps, gets a reply in the section 4
   shape for the EarnKit repo.
2. The owner sends one real application through v5 and records it with `track`.
3. The owner uses it on two consecutive Mondays without asking it anything.
4. At least 50 programs listed, each with its form mirrored field by field in
   `submission_requirements` and `form.fields` wherever the platform exposes ids; at least 20 of
   them not on the v4 chain list.
5. Then ten builders the owner talks to.

Measured (effort only, never a target the builder decides): programs listed, programs with form
fields, installs, finds per week, applications per week, won.

## 10. Left to the builder (the implementation plan)

- The deletion order and how to keep the build green at every task.
- The exact `eligibility` vocabulary and how each item maps to a repo fact or an agent-reported
  fact, and the effort bands.
- How pre-fill chooses a `track`/`choice` answer from the description (a conservative rule; blank
  beats a wrong guess).
- The freshness probe's change threshold and what "stale" shows the builder.
- The replay tool for v5 (the v4 one is rewritten for two tools) and the journey tests.
- Whether `prices.ts` is still needed (only if any program states non-USD amounts).
- Landing layout within the design system that exists.

## 11. Calls I made (check these while reading)

1. **No GitHub App, no proof of ownership.** v5 grants nothing (no money, no public page, no token),
   so ownership proof has no job. Public repos are read with EarnKit's token; private repos are
   agent-reported and labelled. This removes the GitHub App, GitHub OAuth, verification tables and
   the only identity step v4 had left.
2. **No personal answers stored.** The agent's memory is the builder's record. EarnKit's pre-fill
   covers project fields only.
3. **Investor programs are listed like any other**, labelled by category, not hidden until a week
   before close.
4. **The chain allowlist is lifted**; the thesis chains lead the research order.
5. **Delete, don't archive.** Git history holds v2 to v4.
6. **Programs' public pages stay** (SEO and the install door); profiles go.
7. **Resend stays** for owner emails only; no builder emails in v5.
8. **One daily cron**, the freshness probe plus the owner's daily diff email; the hourly workflow
   goes.
9. **The MCP OAuth stays as is** (anonymous approval); nothing changes at install for any client.
10. **jenil.ai's funnel tool** gets a follow-up after v5 deploys; EarnKit's `/api/stats` keeps the
    shape above.
11. **No LLM in EarnKit.** Fact fields are filled deterministically; prose fields go to the agent
    with sources. Keeps the Anthropic key out and the cost at zero per call.
12. **The ledger is keyed by installation only**, and starts empty. No login key without a proof.
13. **Chains are a registry**, open for programs, closed for detection and gap details.
14. **The bot may write `form`, `eligibility`, `results_due`, `focus`, `past_rounds`, `best_bet`**;
    `form` changes wait for approval like link changes.

## 12. Owner answers (2026-11-03)

1. The "never Optimism" rule is lifted with the chain allowlist.
2. The journey tests use the EarnKit repo plus two or three other real public repos that look like
   a typical builder's (the builder picks them; recorded as fixtures with the facts read on the day).
3. The design is approved as written, with the calls in section 11.
