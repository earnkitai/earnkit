# EarnKit v6: the record and the filter

Design, 2026-11-06. Builds on v5 (`v5-design.md`, live as v5.0.1). The owner's directions of
2026-11-06 are quoted in section 1; the builder checks and owner answers are in sections 12 and 13.

## 1. Intent

v5 is a grant inbox: the agent in a repo gets fitting programs, pre-filled from the repo, and a
ledger. It works, and it is thin. An agent with web search rebuilds most of it. Two facts from the
owner, 2026-11-06, say where the value actually is.

From programs: they do not want a verified link, they verify themselves. "What they get is a
mountain of slop applications where most are solo with little to no traction and hard to filter for
quality, so they manually have their people do it." That is a labor cost with a budget behind it.

From the owner as a builder, applying to many programs with his own agent and no EarnKit: he wants
to give his information once and never be asked again; the agent forgets and writes "basic AI slop";
every program wants a video; the agent submitted the same application twice; some programs refuse
agent entries; sign-ins are manual and expire; the agent said "no users" about a pre-launch product
and made him look bad; it lacked his resume and docs. What he wants is to wake up to submissions
done, because he pre-approved.

v6 makes EarnKit two things built on one data model:

- **The record.** A builder's facts, links, documents, goals and approved answers, given once,
  keyed to the builder (GitHub), read by any of their agents. The agent is the hands; EarnKit is the
  memory and the standard of quality.
- **The filter.** Evidence about a project read from the repo, the chain and the live site, in
  tiers a reviewer can act on. For programs: their applicant list sorted with evidence. For
  builders: the same evidence decides where they would pass a reviewer's first cut and what is
  missing. The builder promise changes from "find capital" to "apply only where you would pass, and
  know exactly what to fix."

Programs are the side that pays and the side the owner already knows. Builders are the funnel that
makes applicants pre-screened. The cross-program view (one repo, deployer or pitch sent to many
programs) is the thing no single program can see and the asset that compounds with every program
onboarded.

### What an acquirer would buy

A screening engine with repo and chain evidence, cross-ecosystem applicant data with outcomes
supplied by programs, a maintained program catalog with eligibility encoded, and a builder funnel
inside agents. Not a profile page, not a coin.

## 2. Goals, non-goals, anti-goals

**Goals**

1. Once. Every fact, link, document and answer a builder gives is stored in their record and never
   asked for again by any agent of theirs.
2. Strong answers without an LLM in EarnKit. An answer bank: one approved answer per question kind,
   written once with the builder, in their voice. Agents fit it to a program's limit and never
   invent or add.
3. Overnight. A standing approval on the record lets the agent apply without a nightly yes, within
   the builder's limits, and the morning reply lists what went in.
4. No double submission. A claim in the ledger before filling; a second agent or run sees it.
5. Blockers named up front. Which programs need a sign-in on the agent's computer, which refuse
   agent entries, which need a video or a document, all in the first reply, batched.
6. Traction said right. Verified usage from chain and repo when it exists; the builder's approved
   line when it does not. An agent never characterizes traction on its own.
7. The filter. Named tiers with evidence rows for any public project, from GitHub, explorers, RPCs and
   the live URL. Deterministic, cached, free-tier.
8. The screen. A program's agent hands EarnKit an applicant list and gets it back in tiers with
   evidence and a cross-program signal. The pilot runs as a script before the tool exists.
9. Outcomes from programs. A program that screens with EarnKit reports who won; the ledger fills
   from the capital side.
10. Cost flat. Same host, one daily cron, free tiers, no LLM, env vars under 12.

**Non-goals (v6 does none of these)**

- Writing prose. EarnKit stores and serves approved text; it never generates it.
- Judging ideas, novelty or market. The filter says what is real, used, owned, alive and deep in an
  ecosystem. The rest is the program's people or their agent.
- Submitting forms, holding sessions or signing in anywhere.
- A public profile, leaderboard, score or badge. The record is private. The tiers are shown to the
  program that asked and to the builder they are about, never published.
- Emails to builders. Tokens. Wallets. Campaigns. Stripe.
- Merging a record across GitHub accounts.

**Anti-goals**

- Slop with EarnKit's name on it. If the answer bank is empty or unapproved, the agent gets no
  answer to fit and the reply says the record is missing it. EarnKit never fills prose from the
  README.
- Leaking one builder to another. Cross-program signals are counts, never program names or other
  builders' text.
- A number. No overall score anywhere; tiers with the evidence underneath, and a program sets its
  own bar.
- Asking the builder for anything the record, the repo or the chain already holds.

## 3. Constraints

- The owner's build process: version, numbered task plan with acceptance checks, SDD ledger, one
  subagent per task with spec and quality review, one PR per release. Branch `v6-the-filter` in
  worktree `~/ek-v5` from `origin/main` 5ef29261.
- No LLM inside EarnKit. No new paid service. Railway Hobby plus Postgres, Resend for owner mail,
  GitHub reads with the server token, public explorers and RPCs on free tiers, daily cron.
- Env vars: the v5 eight plus `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` from a
  fresh OAuth app (owner step: create it with callback `https://earnkit.com/auth/github/callback`
  and replace the v4 values on Railway) and `ETHERSCAN_API_KEY` (free key, owner step) for the
  Etherscan v2 multichain reads. Eleven. `no-v4.test.ts` keeps its allowlist and gains these three.
- Tests: `DATABASE_URL=postgresql://localhost:5432/earnkit_test`, the v5 harness and test guard.
- Copy rules: no emoji, no em dash, never coin, points, score, rank, streak or token in builder text,
  no tool, field or file names in `show_to_builder`.
- Kept external surfaces: `GET /api/programs`, `POST /api/programs/write` (widened for the new
  fields), `GET /api/stats` with the v5 nine keys, the MCP OAuth flow for agents.

## 4. Identity: GitHub, once

A builder is a GitHub user. Reasons: the repo is already the center of the evidence; one account
per person is the norm; it is free for non-technical builders too. Owner ruling 2026-11-06: "GitHub
is the way." The v4 X verification existed because not every builder is technical or even has a
project; v6 answers that by making the repo optional (section 7) and the account mandatory.

Flow:

1. An agent installs as today (anonymous MCP OAuth). Its installation has no builder.
2. The first `find` reply includes one line: a sign-in link `earnkit.com/link/<code>` the builder
   opens once (the code is tied to the installation, 15 minutes, single use). `agent_note` tells the
   agent to show the link and stop asking for personal facts until it is done.
3. The link runs GitHub OAuth (scope: none beyond the public profile; `read:user` only). On return,
   the installation is linked to the builder row (`builders.github_id`). A builder who signs in from
   a second agent links that installation to the same row. The ledger and record from then on are
   per builder; v5 rows made before the link are migrated to the builder on first link.
4. `earnkit.com/me` (GitHub session cookie, 30 days) shows the record and the ledger, lets the
   builder edit text fields and approve or edit answers, and has a delete button that removes the
   record, ledger and installations.

Unlinked installations keep working as v5 does (repo-only pre-fill, installation ledger) so a
stranger's first reply is still zero setup. Standing approval, the answer bank and the record need a
link.

## 5. The record

One row per builder, JSON with a fixed schema (`lib/v6/record.ts`, strict, unknown keys dropped,
one-line fields refuse control characters, long fields capped):

- `person`: `name`, `email`, `x`, `linkedin`, `location`, `timezone`, `phone` (optional), `bio`
  (280), `technical: boolean`, `based_country`.
- `team[]`: `name`, `role`, `github`, `x`, `email` (optional). Empty means solo.
- `company`: `name`, `incorporated: boolean`, `jurisdiction`, `raised_usd`, `raised_from`
  (text, 280), `stage` (`idea | building | pre_launch | launched`), `launch_date`.
- `projects[]` (owner ruling 2026-11-06: several): each `id` (slug), `name`,
  `one_liner` (140), `description` (600), `goals` (600, the vision in the builder's words),
  `repo_url`, `live_url`, `demo_url`, `category`, `chains_claimed[]`, and its own `answers`
  for the project-specific kinds. `find` picks the project by the repo the agent is in, or by
  `project_id`. Claims and ledger rows are keyed by builder, project and program.
- `docs`: `resume_url`, `deck_url`, `founder_video_url`, `demo_video_url`, `other[]` (`label`,
  `url`). All links; EarnKit stores no files.
- `traction`: `line_pre_launch` (280, the approved sentence used when nothing verified exists, for
  example "Pre-launch, launching 2026-12-01, 140 on the waitlist"), `waitlist`, `revenue_usd_claim`
  (never shown as verified), `notes` (280).
- `answers`: the answer bank, section 6.
- `policy`: `auto_apply: boolean`, `max_per_night` (default 5), `categories[]` (default all),
  `max_ask_usd` (optional), `never[]` (program ids), `agent_may_submit: boolean` (default true).
- `updated_at`, per-field `set_by` (`builder | agent`) and `set_at`.

Who writes it: the agent, through the `record` tool (section 8), from a one-time guided session
("tell me once: ..."), and the builder on `/me`. Fields marked `set_by: agent` that a reviewer would
see (traction line, raised, answers) are `approved: false` until the builder approves them on
`/me`, signed in. The agent cannot approve: a chat "looks good" is not proof the builder read the
text, and an unapproved answer is never fitted into a form.

What `find` does with it: every `fields[]` entry of a ready program now resolves in this order:
record (exact fact or approved answer by `kind`), repo (facts from the code read), agent (only when
the record has nothing and the field is prose: the agent is told to ask the builder once and write
the answer into the record, not into its own memory), builder (files and consents). The ready line
becomes: "n from your record, m from the repo, k need you" and names the k.

## 6. The answer bank and the style contract

`answers` holds one entry per prose kind. The catalog's field kinds grow to the same list, and the
existing files are re-keyed where they used `how_it_works` (now `solution`) or `other` for one of
these: `one_liner`, `problem`, `solution`, `traction`, `team`, `why_you`, `milestones`,
`use_of_funds`, `competitors`, `risks`, `ecosystem_fit` (parameterized by chain), `what_next`,
`past_work`, `help_needed`. Fact kinds (`name`, `links`, `contact`, `raised`) are not answers; they
resolve from the record's fields. Each: `text` (up to 2,000
characters), `short` (280), `approved: boolean`, `approved_at`, `written_by` (`builder | agent`),
`voice_notes` (120, for example "first person, dry, numbers first").

Writing happens once, in the agent's session, with EarnKit giving the brief: for each kind, the
question reviewers actually ask, the facts from the record and the repo to use, the length band,
and the style contract. The agent drafts into the record, the builder edits and approves on `/me`. The
quality comes from one careful pass with a strong model and the builder's edit, not from EarnKit.

The style contract travels in `agent_note` with every field that is fitted from the bank:

> Use the approved answer. Shorten to the limit by cutting sentences, never by paraphrasing.
> Never add a fact, a number or a claim that is not in the answer or the record. No em dashes, no
> emoji, no filler, no over-explaining. If the program asks something the bank does not cover, ask
> the builder once and store their answer in the record before using it.

Traction rule: if `facts.usage` (section 7) has verified numbers, the traction field is filled from
them, worded by EarnKit from a fixed template ("1,240 distinct funded wallets in 90 days on Base,
12,300 transactions, live since 2026-08-02"). If not, the field is the approved `line_pre_launch`.
If neither exists, the field is `builder` and the reply names it. "No users", "none yet" and any
sentence characterizing traction are never produced by EarnKit and the contract forbids the agent
from writing them.

## 7. The filter: evidence and tiers

`lib/v6/evidence.ts` reads a project and returns `Evidence`: rows, each with `key`, `value`,
`basis` (`github | explorer | rpc | site | record | earnkit`), `read_at`, and `note`. No row is an
opinion. Sources and limits per read are the v4.5 provider table, reused.

Rows (the provider limits table from v4.5, commit a616c9d4, is rebuilt in `lib/v6`; nothing is imported from v4):

- **Live**: `live.url_ok` (200 within 10 s), `live.is_app` (not a single static page: has a form,
  script bundle or wallet connect; heuristic, labelled as such), `live.domain_age_days`,
  `live.since` (first time EarnKit saw it up).
- **Onchain**: per contract from repo config, record claim or applicant list: `chain`, `mainnet`,
  `verified_source` (explorer), `deployer`, `deployed_at`, `deployer_matches_repo` (an address in
  the repo's deploy config or README), `tx_90d`, `senders_90d` (distinct from addresses),
  `funded_senders_90d` (senders that have ever paid gas from a balance not received from the deployer
  within 24 hours: the cheap farm filter), `senders_30d`, `value_usd_90d` when the explorer gives
  it, `first_tx_at`.
- **Ownership**: `code.fork_of` (GitHub parent), `code.template_overlap` (share of files whose
  hashes match a known boilerplate set EarnKit keeps: the top Base, Solana, Next.js and Hardhat
  starters, refreshed by the cron weekly), `code.own_share` (commits by the top contributor and
  share of lines added after the fork point).
- **Activity**: `code.first_commit_at`, `code.last_push_at`, `code.commits_90d`,
  `code.active_weeks_90d`, `code.releases`, `code.has_tests`, `code.has_ci`, `code.issues_open`,
  `code.issues_answered_90d`.
- **Team**: `team.contributors_90d` (accounts 30+ days old), `team.top_share` (share of commits by
  the top contributor), `team.account_ages_days[]`, `team.prior_repos_used` (other repos by the
  contributors with 50+ stars or a live homepage), `team.in_other_applicants` (count of other
  screened projects in 90 days sharing a contributor; counts only).
- **Depth**: `depth.integrations[]` from package files and imports against a registry per chain
  (`lib/v6/integrations.ts`: for Base: OnchainKit, Smart Wallet, Paymaster, Basenames, MiniKit; for
  Arc and Circle: USDC, CCTP, Wallets, Paymaster; for Solana: Anchor, web3.js, Blinks; extendable
  by the Grok Bot through the programs write API as `integrations` on a program).
  `depth.chains_mainnet[]`, `depth.chains_testnet[]`.
- **Across programs**: `xp.applications_90d` (count of screens by other programs this repo or
  deployer appeared in; a builder's own ledger never feeds it), `xp.identical_pitch` (count of other applicants in the screen with a pitch text
  similarity above 0.9, when the program supplies pitch text), `xp.outcomes` (won, rejected counts
  from program-reported outcomes only; never which program, never from the builder's own ledger).
- **Record** (builder side only): `record.completeness` (which of the required blocks are filled
  and approved), `record.docs_present[]`.

Tiers (`lib/v6/tiers.ts`, pure). Named, never lettered or numbered, so nothing reads as a grade:

- **used**: `live.url_ok` and at least one mainnet contract with `funded_senders_90d >= 25`, and,
  when a repo exists, `code.last_push_at` within 60 days. No flag.
- **live**: `live.url_ok` or a mainnet contract with any transaction in 90 days; when a repo exists,
  pushed within 60 days. No flag. A repo-less project with a working site reaches this tier.
- **building**: a public repo with commits in the last 60 days and no live product.
- **unverified**: nothing EarnKit could read: no working site, no readable contract, no public
  repo. The record's claims are shown as claims.
- **flagged**: `code.template_overlap >= 0.6` with `code.own_share < 0.2`, or `code.fork_of` set
  with `own_share < 0.2`, or `xp.identical_pitch >= 3`, or `team.in_other_applicants >= 5`, or
  `funded_senders_90d < 0.2 * senders_90d` with `senders_90d >= 100`. The flag names the rule.
  Overlap between 0.2 and 0.6 is not a flag; the row is shown and the tier comes from the rest.

Tier is unknown until the evidence read has run; an unknown tier never gates anything.

Thresholds are constants with the reason beside each; a program can pass its own in `screen`. The
tier is shown with its rows, and `agent_note` carries the one line a reviewer needs ("used: 1,240
funded senders on Base mainnet, 3 contributors, no flags").

Chains read in v6: Base, Ethereum, Arbitrum, Optimism, Polygon and Avalanche through the Etherscan
v2 multichain API (one key, free tier 100,000 requests a day), Arc through its Blockscout. Tempo,
Monad, Robinhood Chain and Solana have no reader in v6: their contracts are shown as claimed, and
the registry marks them `readable: false` until a client is added.

Cost per applicant: at most 12 GitHub requests, up to 5 per contributor for ages and prior repos
(capped at 5 contributors), 3 explorer requests per contract plus one per sampled sender for
`funded_senders` (a sample of 50 senders, labelled "sampled"), 1 site HEAD. Call it 120 requests
for a typical applicant; 200 applicants is about 25,000 requests, inside the free tiers within a
day, run from the queue (section 8), never inline. Cached 7 days in `evidence_cache` keyed by repo
and contract, re-read when `pushed_at` moves.

A repo-less project (the owner's point: not every builder is technical) gets `live` and `onchain`
rows from the record's `live_url` and `chains_claimed` and lands in live or unverified by them.
The reply says what would move it up.

## 8. The tools

Four tools. `find` and `track` as v5 with the changes below; `record` and `screen` new. Every reply
keeps `show_to_builder` and `agent_note`.

### `find` (changed)

- Input adds nothing. The builder comes from the installation link.
- Output adds `record_missing[]` (blocks and docs the record lacks, in builder words), `blockers[]`
  (per ready program: `sign_in`, `agent_may_submit`, `video`, `docs`, from the catalog, section 9),
  `evidence_summary` (tier and the one-line reason for the builder's own project, so they see what a
  reviewer would), `applied_overnight[]` (claims that became `applied` since the last `find`, with
  standing approval on).
- Ready programs are those the project fits by eligibility and, when the program sets a
  `min_tier`, whose tier meets it. No `min_tier` means no bar, which is the default and the v5
  behavior. An unknown tier (evidence not read yet, private repo) passes. Below a set bar, the
  program appears in `gaps` with the gap being the evidence that is missing ("25 funded wallets on
  mainnet in 90 days; you have 4"), effort `weeks`, `agent_can: false`.
- Pre-fill order: record, repo, agent, builder (section 5). `filled` counts record and repo values.
- With `policy.auto_apply` the closing line changes from "Say yes to apply" to "Applying tonight to
  n; say stop to hold any." and `agent_note` says to claim, fill, submit and track without asking,
  within `max_per_night` and the other limits.

### `track` (changed)

- New status `started`: a claim. One per builder, project and program; a second `started` within 24 hours
  returns `already_started` with the agent name and time, and `agent_note` says not to submit. A
  claim older than 24 hours with no `applied` is released and noted in the next `find`.
- `applied` carries `submitted_by` (`agent | builder`) and the `fields_used` keys, so the record
  can show what was sent.
- Everything else as v5.

### `record` (new)

Input: `set` (a partial record, deep-merged, validated), `get: true`. There is no approve input;
approval happens on `/me`. Output: the record with per-field `set_by`, `approved`, `missing[]`, and
`show_to_builder` ("Saved. Still missing: founder video, resume.") Only on a linked installation;
otherwise the reply is the sign-in link. The agent is told to call `record` with `get` at the start
of a session instead of trusting its memory, and to write every new fact the builder gives into it.

### `screen` (new)

For a program's agent. The installation must be linked to a builder the owner has marked as a
reviewer for one or more programs (`program_reviewers` table, set by the owner through
`POST /api/programs/reviewers` with the programs token; the pilot does this by script).

Input: `program_id`, `applicants[]` up to 200: `name`, `repo_url`, `live_url`, `contracts[]`
(`chain`, `address`), `pitch` (optional, up to 4,000 characters, used only for the identical-pitch
count and never stored beyond the job), `applied_at`, `ref` (the program's own id). Optional
`thresholds` to override the tier constants.

Behavior: creates a `screen_jobs` row and queues the reads; returns `job_id` and the applicants
already cached with their tiers. The daily cron and an on-demand `/api/cron` call with the job id
work the queue (the owner triggers it for pilots; later a 15-minute cron if volume asks, which is
still one workflow). A second `screen` call with `job_id` returns progress and results: per
applicant `tier`, `rows[]`, `flags[]`, `one_line`; totals per tier; `agent_note` with the sort.
Results live 30 days.

Outcomes: `screen` with `outcomes[]` (`ref`, `won | rejected | shortlisted`, `amount_usd`) records
the program's decisions against the applicants. That fills `xp.outcomes` and, for any applicant who
is also an EarnKit builder (matched by repo), their ledger.

Privacy: the program sees evidence from public sources and counts. It never sees a builder's record,
other programs' names or other applicants' text. The builder sees their own tier in `find`.

### Server instructions (the whole text)

> Call record with get at the start of every session, then find with the project you are in.
> Open with find's reply in your own words. Draft every form from find's fields: record and repo
> values as given, approved answers fitted by cutting, never by adding. Anything the builder tells
> you that a form could ask, save with record before using it. Submit in your own browser only
> after track started, and only when the builder said yes or their standing approval covers it.
> After each submission call track applied. Never write a sentence about traction yourself. Never
> name tools, fields or files. Never invent an amount, a deadline or a rule.

## 9. The catalog: new fields

`ProgramFile` gains, all optional and all surfaced in `/api/programs` and the guide page:

- `submit`: `agent | builder | either` (default `either`). `builder` means the program refuses
  agent entries or requires a human step; the agent prepares and the reply says "needs your click."
- `sign_in`: `none | google | github | email | platform` with `platform_name`. The first reply
  batches: "Three need a Google sign-in on your agent's computer; do them once tonight."
- `needs`: `founder_video`, `demo_video`, `resume`, `deck`, `pitch_pdf` (list). Matched against
  `record.docs`; missing ones are one line in `record_missing`.
- `min_tier`: `used | live | building` (default unset: no bar). The bar the program's reviewers
  actually use, set by the owner or the program.
- `prefers[]`: integrations and chains the program favors (section 7 registry keys). Used for
  `ecosystem_fit` answers and gap suggestions ("add Smart Wallet, which this program favors").
- `eligibility` gains kind `integration` (value: a registry key), checked from the repo's package
  files and imports; a gap of `effort: days`, `agent_can: true` with the SDK's docs link in details.
- `reviewers_contact` (owner-only, never public): who at the program gets the pilot results.

`programs/README.md` documents them; the Grok Bot write API accepts them (pending rules apply to
`submit`, `sign_in` and `min_tier` as they do to `form`).

## 10. The builder's experience

**The owner, first session on v6.** Jenil AI calls `record` (nothing yet), then `find`. The reply:
"Ready to apply, 5 ... Before tonight: sign in once at earnkit.com/link/xxxx so I remember you
across agents. Your record is empty; tell me once about you, the team, the company, the links and
your goals, and I'll draft the standard answers for you to approve." He signs in, answers in one
message, approves answers on `/me` in ten minutes, sets "apply overnight, up to 5 a night, no
investment programs." That night Jenil AI claims, fills from the record, submits where `submit`
allows, tracks. Morning: "Applied overnight: Avalanche Team1, Alliance. Needs you: Base Builder
Grant (Google sign-in on my computer), Z Fellows (your intro video link). Your project reads as
live, no verified usage yet; your pre-launch line was used." Growth Bot finds programs on X and
writes them to the catalog as before.

**A stranger, day one.** Same as v5 until they want answers stored: then the one sign-in link.

**A program lead.** Installs EarnKit in their agent, the owner marks them as reviewer for their
program, they hand their applicant list to the agent; by the next morning (or within the hour when the
owner triggers the run, as in the pilots): "412 applicants: 31 used, 88 live, 190 building, 74 unverified, 29 flagged (19 template forks, 7
identical pitches, 3 wallet farms). The used list with evidence is attached." They tell the agent who won; the ledger learns.

**What the builder never sees.** A score. Another builder. Which programs the filter has seen them
in. Any sentence EarnKit did not have a source for.

## 11. Pilot before the tool, two releases

v6.0 is the evidence reader, the tiers and the pilot script, one short plan. v6.1 is the record,
the `find` and `track` changes, `screen`, the catalog fields and `/me`. v6.1 does not wait for the
pilots' feedback: the thresholds are constants, and what the pilots teach lands as constant changes
or new rows in v6.1's plan or a v6.2.

Task 1 of v6.0 is `pnpm screen <csv> --program <id>`: the evidence reader and tiers behind a
script that writes a markdown and CSV report to the scratchpad. The owner takes it to two programs
with the message: "Send me your last cohort's applicant list; I return it sorted with evidence in
48 hours; tell me where I was wrong." Their corrections set the thresholds and the row set. The two programs are the owner's to name.
If a program's list carries no repo links, the script resolves a repo from the live URL (a GitHub
link on the page) or a GitHub handle, and otherwise reports the applicant as unverified; a sample
list from the first program, even redacted, decides how much of that resolver to build.

## 12. Measures and the bar

Effort only, never outcomes others decide:

- Pilots delivered: 2 within three weeks of Task 1.
- Catalog: 50 open programs with questions, `submit`, `sign_in`, `needs` and `min_tier` set.
- Record: the owner's record complete and every answer approved; ten builders with a linked record.
- Overnight: applications applied under standing approval with zero duplicate submissions.
- Cost: Railway bill unchanged; cron minutes under the free tier.

## 13. What goes from v5

- `builder` fields for personal facts (name, email, team, raised): now record fields.
- "Drafted: n of total answers from the repo, the rest from your agent's memory." replaced by the
  record/repo/you line.
- The v5 ruling "no stored personal answers" is reversed by the owner's direction; the record is
  private and deletable, and that is written in `/terms`.
- The installation-keyed ledger stays for unlinked installations and is migrated on link.

## 14. Surfaces

- `/link/<code>`: GitHub sign-in and link. `/auth/github/callback`.
- `/me`: record and ledger, edit, approve, delete. Session cookie, no public URL for anyone else.
- `/docs`: install, what the record is, the standing approval, the filter explained for builders,
  and a section for programs ("how screening works, what we read, what we never show").
- `/programs` and guides: the new fields shown as "Agent may submit", "Sign-in: Google", "Needs:
  founder video", "Bar: live product".
- `/api/stats`: the nine keys unchanged. (Screening counts are not public.)
- `/terms`: the record, deletion, what programs see.

## 15. Left to the builder (the plan)

Table names (`builders`, `records`, `answers` inside the record JSON or a table, `claims` as a
status on `applications`, `evidence_cache`, `screen_jobs`, `screen_results`, `program_reviewers`),
the OAuth state handling, the boilerplate hash set and how it is refreshed, the explorer clients per
chain, the `/me` page design within `DESIGN.md`, the migration of installation ledgers to builders,
the test fixtures (recorded explorer and GitHub replies for two or three real repos, as v5 did),
and the task order, which should put the evidence reader and the pilot script first, the record and
`find` changes second, `screen` third, `/me` last.

## 16. Calls I made (check these while reading)

1. GitHub `read:user` only, no repo scope. Private repos stay agent-reported, as in v5.
2. Thresholds: used needs 25 funded senders in 90 days; flagged at 60 percent template overlap
   with under 20 percent own share, or 3 identical pitches, or a contributor shared by 5 or more
   applicants. Tiers are named words, never letters or numbers.
3. `funded_senders` defined by gas paid from a balance not received from the deployer within 24
   hours, on a sample of 50 senders per contract, labelled "sampled". Wrong for some legitimate
   airdrop-funded users; labelled.
4. Pitch text for the identical-pitch count is used in the job and not stored after it.
5. Cross-program signals are counts only; no program names, no text, no builder identities.
6. Standing approval defaults: off; when on, 5 per night, all categories, no amount cap.
7. Claims release after 24 hours.
8. `min_tier` default unset: no program gates on tier until the owner or the program says so, and
   an unknown tier never gates. The zero-setup first reply stays exactly v5's.
9. The screen queue runs on the daily cron and on an owner-triggered run for pilots; no new
   scheduler until a program asks for same-day turnaround.
10. `/me` is the only web UI added; the agent remains the main writer of the record.
11. Resume, deck and videos are links, never uploads.
12. Repo-less projects are allowed and can reach the live tier through a working site or a
    claimed contract read from the chain.
13. Approval of answers and reviewer-visible claims happens only on `/me`, never through the agent.
14. Two releases: v6.0 (evidence, tiers, pilot script) then v6.1 (the rest), not blocked on pilot
    feedback.
15. Cross-program counts come only from screens and program-reported outcomes; a builder's own
    ledger never reaches a program.
16. Chains without a reader in v6: Tempo, Monad, Robinhood Chain, Solana.

## 17. Owner decisions

1. One project per builder or several? Recommended several (`projects[]`, claims keyed by project).
2. The two pilot programs, and a sample applicant list from one of them.
3. Owner steps before v6.1 deploys: a fresh GitHub OAuth app and a free Etherscan key.

Answers, 2026-11-06: 1. Several projects per builder. 2. Pilot programs named later; v6.0 builds
now. 3. Design approved; v6.0 plan and build start 2026-11-06; v6.1 planned right after.
