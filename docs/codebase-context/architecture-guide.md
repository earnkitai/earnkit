# EarnKit architecture guide (v5)

Read this first, then `code-map.md` (one line per file). The design is
`docs/design-docs-and-implementation-plans/v5-design.md`; the plan is `v5-plan.md`; the build ledger is
`v5-sdd-ledger.md`. Git history holds everything older than v5.

## What EarnKit is

EarnKit turns a builder's repo into money: grants, hackathon prizes, ecosystem programs, accelerators and
bounties. EarnKit is the brain; the builder's AI agent is the hands.

- EarnKit knows every open program (amount, deadline, rules, the form's fields), matches the repo against each
  program's rules, pre-fills every form field it can answer from the repo, and says what one change would unlock.
- The agent holds the builder's memory, drafts the personal parts, fills the form in its own browser when the
  builder says yes, and reports back with `track`.
- EarnKit never submits a form, never holds or asks for a wallet, never writes prose (no LLM), never asks the
  builder who they are. Install is one MCP URL and an anonymous OAuth approval.

One Next.js app (`apps/frontend`) on Railway, one Postgres database, one daily job. Nothing else runs.

## The two tools

`lib/v5/mcp.ts` builds a stateless MCP server per request (`app/mcp/route.ts`). Two tools:

| Tool | Does |
|---|---|
| `find` | What the project can earn now (`ready`, pre-filled), what is one change away (`gaps`), what moved since the last call (`since`), and the ledger. With `program_id`: one program's details, form and guide. With no project: the open list. |
| `track` | Records what the builder did: `applied`, `won` (with `amount_usd`), `rejected`, `no_result`, `skipped`, `gap_done` (with `item`). |

Every reply carries `show_to_builder` (plain text the agent may reword) and `agent_note` (what the agent does
next). The server instructions (the whole text sent to agents) sit in `mcp.ts` and are pinned by `mcp.test.ts`.

## The find flow

`find.ts` runs, in order:

1. `project-input.ts` parses what the agent reported, leniently: a bad link, unknown chain or bad date is dropped
   and a name over 80 or a description over 280 characters is cut, each with a problem line for the agent; only a
   missing name or description fails. `users` is true, false or null (not reported).
2. `repo-facts.ts` reads a public GitHub repo with EarnKit's own token (`github.ts`: repo, tree, README, up to 12
   config files for chain detection, first commit date) and merges it with what the agent reported. Facts are cached
   7 days in `repo_cache` and re-read when `pushed_at` moves; the cron sweeps rows over 30 days. An installation gets
   10 uncached reads a UTC day (a cache hit is free); past that the facts are agent-reported only with the problem
   "repo reads paused until tomorrow". A private or unreadable repo is agent-reported only, and the reply says so
   (`as_reported`).
3. `programs.ts` lists the open programs. `eligibility.ts` evaluates each program's eligibility items against the
   facts: `ready`, `gap` (with each unmet item as a gap: kind, effort, whether the agent can do it) or no fit.
   `chain` and `contract_on` count as met only on mainnet. `users` not reported is a one-question gap the builder
   answers; `users: false` is no fit.
4. `rank.ts` orders them: ready by fit (long shots last), larger award, sooner deadline; gaps by fewest gaps, lowest
   effort, larger award. Skipped and applied programs never return unless their next round opens.
5. `prefill.ts` fills each ready program's form: fields EarnKit can answer (`from: earnkit`), prose fields handed to
   the agent with sources (`from: agent`), and fields only the builder can give (`from: builder`, a demo video or
   a file). Blank beats a wrong guess. `facts_from_repo` counts only values the public code read gave (its repo link,
   homepage, contracts and chains with basis `code`), never anything the agent passed; the reply says "Drafted: N facts from the repo." only when N is above zero.
6. `since.ts` lists programs new, changed (deadline, amount, status, form) and closing within 7 days since this
   installation's `last_find_at`. Empty on the first call.
7. `ledger.ts` summarises the installation's applications; results past due become `ask_outcome`.
8. `find` caps the lists (at most 5 remote ready, 3 gaps, then at most 2 in person) and `reply.ts` writes `show_to_builder` and `agent_note`. It shows at most 5 remote ready and 3 gaps, then at most 2
   in-person programs in their own block with their setup (never in "apply to all N"), and ends with exactly one
   closing line. `find` caps remote and in-person ready apart, so an in-person program never takes a remote slot.
   The caps live in `shownReadyOf` (`find.ts`, pure): with no remote ready it shows only the 2 in-person slots.
   `find` also saves every gap (at most 60) to `installations.last_gaps` as `{ program_id: what is missing }`;
   `track` `started` reads it to say what is still missing.
   `find` returns `ready` in that display order (in person last) and gives every ready and gap item its displayed
   number `n`, so "skip 4" maps to the item with `n` 4. No emoji, no em dash, no tool or field names, no coins, points or scores.

## The program record and pipeline

A program is one `programs/<id>.json` file or one API write; both parse with `program-file.ts` (the schema of
record: category, `submission_requirements` with `kind`, `from` and `todo` on each item, `chains` or `any_chain`,
`eligibility`, `results_due`, `form`, `focus`, `past_rounds`, `best_bet`, `verified_at`). The database stores the
parsed record whole (`programs.file`); `status`, `ends_at` and the like mirror it for queries. A row that no longer
parses is skipped by every reader. `chains.ts` is the chain registry (ids, RPC and explorer hosts, EVM or not);
a program may only name registered slugs, and the registry grows by owner edit.

The pipeline, in order:

1. Research: the owner's Grok Bot writes through `POST /api/programs/write` (instructions in `docs/programs-api.md`).
   `programs-api.ts` validates (`program-checks.ts`, `api-text.ts`, `untrusted-text.ts`, `confusables.ts`) and
   upserts, closes, or holds the write pending.
2. Approval: a new program, or a write changing `submission_url`, `chains`, `form` or `pool_source_url`, waits for
   the owner's one-click link (`programs-pending.ts`, signed with `EARNKIT_AUTH_SECRET`, 7 days). Everything else is
   live at once and appears in the owner's daily digest with a revert link.
3. Files: `programs/*.json` is the owner's override and wins over an API row with the same id. `pnpm programs:check`
   validates them; `pnpm programs:sync` writes them before each deploy.
4. Freshness: the daily cron (`health.ts`) probes each listed program's links and source page, flags a program
   stale after two failing days, and closes an active program whose deadline passed. A source page sharing fewer
   than 80% of its words with the text stored the day before (`program_health.body_text`) counts as changed: it is
   listed in the owner's digest and never marks the program stale. A program unverified or stale for 14 days leaves
   the open list. The deploy's sync writes an active file past its `ends_at` as closed, with a warning, so a deploy
   never reopens it. There is no LLM in the cron.
5. Readers: `programs-read.ts` serves public `GET /api/programs`; `landing.ts`, `guide.ts`, `guide-page.ts` and
   `stats.ts` feed the site. The hero chip ("$N in grants and prizes open now") sums, per open non-investment
   program, its `pool_usd` when set, else its `max_award_usd`.

## The ledger

`applications` holds one row per installation and program (latest status wins); `application_history` keeps every
change; `gaps_done` records closed gap items. It is keyed by installation only: v5 has no proof of who a login
belongs to, so a re-authorization starts a fresh ledger and a builder with two agents has two. `gap_done` is trusted
only for kinds EarnKit cannot verify (`feature`, `users`, `demo_video`); verifiable kinds are re-read from the repo.
`won` with an amount is the one fact that later feeds an aggregate "what wins" view; nothing aggregate is shown yet.
A `won` above the program's `max_award_usd` (or 5,000,000 when none is stated) is refused and writes nothing.
`asked_usd` leaves out investment programs.

## Freshness and the daily job

`.github/workflows/earnkit-cron.yml` posts to `/api/cron` once a day with `CRON_SECRET`. `cron.ts` runs the probe
(`health.ts`), the `repo_cache` sweep (rows over 30 days, answered as `swept`), the screen queue's daily share
(screen jobs over 90 days deleted with their rows, then `workQueue` with `SCREEN_BATCH` 40 within 5 minutes,
answered as `screen` with `swept`), then the owner's digest (`owner-digest.ts`: programs closed by deadline, failed links, changed pages
and every change to live programs since the last digest, with revert links; nothing happened, nothing sent). Mail is
`mail.ts` over Resend, to the owner only. A step that throws answers 500 with its name. The owner triggers one
screen job with the same route and a JSON body `{ "job_id": "..." }`: only that queue runs (300 applicants or 10
minutes), no probe, sweep or digest.

## The site

| Route | Is |
|---|---|
| `/` | Landing: one statement, the install picker, the open programs, counts and open money |
| `/programs`, `/programs/[id]` | Public, indexable guide to every listed program; closed ones render without an Apply link |
| `/docs` | Install steps per agent, how a session goes, your record, screening for programs, how programs are checked |
| `/install` | Permanent redirect to `/docs#install` (old links) |
| `/terms` | What EarnKit reads, stores and never does; the record; what programs see |
| `/link/<code>`, `/auth/github/callback` | The one-time GitHub sign-in that links an agent to a builder |
| `/me` (and `/me/*` posts) | The signed-in builder's record, approvals, standing approval, applications, agents, delete; noindex |
| `/llms.txt`, `/sitemap.xml` | For agents and search |
| `/api/programs`, `/api/stats` | Public JSON; `/api/stats` has nine counts and names no one |
| `/api/programs/write`, `writes`, `approve`, `revert` | The owner's program API |
| `/api/programs/reviewers` | The owner marks a signed-in builder as a program's reviewer (programs bearer; `github_id` wins, a login two accounts used is refused) |
| `/api/cron` | The daily job |
| `/mcp`, `/oauth/*`, `/.well-known/*` | The MCP endpoint and anonymous OAuth |

Copy lives in `site-copy.ts`, install steps in `agents.ts` (read by the site, `/docs` and `/llms.txt`), colours in
`site-theme.ts` (mirrored in `globals.css`). See `apps/frontend/DESIGN.md`. OAuth (`oauth.ts`, `oauth-routes.ts`) is
standard (PKCE, dynamic client registration) and approves at once; the issued token is the installation. A
many-builder hosted registration gets no client key, and the hosted rate-limit tier applies only when every redirect
URI is on a hosted agent host. `rate-limit.ts` keeps fixed-window counters in Postgres. Each MCP tool call counts
120 an hour per installation and 600 an hour per client IP; over either, the call answers the tool result "EarnKit
is busy. Try again in an hour." (not a transport error, so clients show it). `secrets.ts` scrubs secret
keys from tool-call bodies before anything sees them.

## Database

`apps/frontend/db/schema.sql`, additive and safe to run twice (`pnpm db:migrate`, run before each deploy).

| Table | Holds |
|---|---|
| `programs` | Every program: the whole record in `file`, plus mirrored columns and source (`file` or `api`) |
| `program_changes` | Field-level changes, for `since` and the owner digest |
| `program_writes` | The write API's audit log and the pending writes |
| `program_health` | The freshness probe: link status, page hash and text, failing days, changed_at |
| `installations` | One row per issued token (hash only): client name, `last_seen_at`, `last_find_at` |
| `rate_windows` | Request counters |
| `repo_cache` | Public repo facts, 7 days; swept after 30 |
| `evidence_cache` | v6 evidence blocks per repo (`repo:<owner/name>`, with pushed_at) and per contract, used for 7 days; not swept yet |
| `applications`, `application_history`, `gaps_done` | The ledger |
| `owner_digests` | The days a digest covered |
| `program_reviewers` | Builders the owner marked as a program's reviewers (may call `screen`) |
| `screen_jobs`, `screen_applicants`, `screen_outcomes` | Screen jobs (30 days), each applicant's tier, because, line, public rows and deployers (no pitch column), and the program's outcomes; the counts across programs read only these |

v4 tables stay in the production database, unread. `pnpm db:v4-tables` lists them with row counts and prints
DROP statements; it never runs them. Dropping is an owner step after a backup.

## Environment variables

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres |
| `EARNKIT_AUTH_SECRET` | Signs OAuth client ids and codes, approve and revert links |
| `EARNKIT_URL` | The public origin (required in production) |
| `GITHUB_TOKEN` | Public repo reads (server token; unset means lower limits) |
| `RESEND_API_KEY` | Owner emails (unset: no mail) |
| `CRON_SECRET` | Bearer for `/api/cron` (unset: 503); also a GitHub repo secret |
| `EARNKIT_PROGRAMS_TOKEN` | Bearer for the write API (unset: the write routes answer 404) |
| `EARNKIT_PROGRAMS_API` | `off` closes the write API |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub sign-in for builders (unset: `/link` and the callback answer 503) |
| `EARNKIT_SCREEN_OUT` | Local only: the folder `pnpm screen` writes into without `--out` (default `.screen-out/` in the repo, git-ignored) |

`lib/v5/no-v4.test.ts` fails if any code reads a variable outside this list.

## Tests and the replay

`export DATABASE_URL=postgresql://localhost:5432/earnkit_test` then `pnpm test` (all files) or
`pnpm -s tsx --test --import ./apps/frontend/lib/v5/fixtures/test-guard.ts apps/frontend/lib/v5/<file>.test.ts`.
`test-guard.ts` clears vendor keys, refuses any network but this machine, and gives each test file its own database
copied from a template. Tests skip nothing; a run whose output has no failure lines is green.

- Recorded repos: `fixtures/repos/*.json` (EarnKit, a Base app, a repo with no chain, a Solana repo), replayed by
  `fixtures/github.ts`. Re-record one with `scripts/record-repo-fixture.mts`.
- `fixtures/mcp-call.ts` calls the real MCP server over an in-memory transport, so tests and the replay see what an
  agent sees.
- `journey.test.ts` walks the whole flow: a stranger, the owner's ledger, a closing program, a Solana repo, and the
  copy rules on every line the builder sees.
- `no-v4.test.ts` keeps the v4 code, routes, dependencies and env reads out. `site-copy.test.ts` pins the words.
- Replay: `pnpm -s tsx apps/frontend/scripts/replay.mts <fixture> [--monday]` runs find, track applied, find on a
  scratch database and prints each `show_to_builder` and `agent_note`. `--monday` brings one deadline within a week
  and moves the clock to the next Monday 09:00 UTC so the "Since" line shows.

## v6.0: the filter (evidence, tiers, the screening pilot)

v6.0 adds a screening engine beside the v5 tools; nothing in `find` or `track` reads it yet. Design:
`docs/design-docs-and-implementation-plans/v6-design.md` (sections 7 and 11); plan `v6-plan.md`; ledger
`v6-sdd-ledger.md`. Everything lives in `apps/frontend/lib/v6`.

**The evidence flow.** `readEvidence(subject, deps)` in `evidence.ts` takes a repo link, a site and contracts and
returns `Evidence`: typed blocks plus `rows` (one per value, with `basis`, `read_at` and `note`). One GitHub repo
read feeds `code.ts` (fork parent, own commits and share, starter overlap against `boilerplates.json` and files
beyond it, 60 and 90-day activity; a fork's window is only its compare commits after the fork point), `team.ts`
(contributors, account ages, logins; a matched starter's recorded maintainers dropped) and `depth.ts` (integrations
from `integrations.ts`, chains). Each contract, the subject's first, then the repo's deploy runs (`broadcast/`,
`ignition/deployments/`, read raw), then those named in its files (at most 10), goes through `onchain.ts` over the
keyless Blockscout client in `explorers.ts`; chains without a reader are shown as claimed. `countedBy` marks each
`counted` (deployer in the repo, a deploy run whose sender is the deployer, or deployed after `repoSince`: the later
of GitHub's `created_at` and the first commit; a listed one unless it predates that with a foreign deployer) with
`counted_reason`. Deploy files are capped at 2 MB (tree size, then the streamed body). `live.ts` probes the site (safe-fetch, https only, 10 s),
reads its title and GitHub links, and the domain's age from RDAP. A failed read is null with a note; nothing
throws. GitHub calls share one `Budget` per run (passed in by `screen.ts`) that stops under 500 left; once stopped
a repo is not read (`not read: budget`).

**The cache.** `evidence_cache` keeps a repo block 7 days while the repo's `pushed_at` holds (one repo object read
checks it) and a contract block 7 days. A partial block (a budget stop, a failed read) and the live rows are never
cached. `--no-cache` on the script skips the table both ways.

**The tiers.** `tiers.ts` `place(evidence, counts, thresholds?, now?)` is pure and names one of five tiers, flags
first: flagged (a starter match with under 10 own files, a starter fork with under 20 commits after the fork or
another fork under 20% own work, an identical pitch, shared contributors, unfunded senders), used (site loads, 25
or more wallets the deployer did not fund on one mainnet contract in 90 days, pushed within 60 days), live (site
loads or a mainnet contract with transactions), building (commits in 60 days, nothing live), unverified (nothing
recent EarnKit could check). Only counted mainnet contracts count; the others are listed with their reason. `DEFAULT_THRESHOLDS` carry
their reasons. `tier-words.ts` turns a placement into the reviewer's line and the builder's line.

**The pilot script.** `pnpm screen <csv> --program <id> [--chain base] [--out <dir>] [--no-cache] [--thresholds
<json>]` (`scripts/screen.mts` over `lib/v6/screen.ts`). `applicants.ts` parses the CSV (columns by name; a bad
link or address nulls the field with a problem line; headers normalized; repeated refs made unique), takes a repo
from the site's GitHub links when none is given (never a starter's or SDK's owner, a matching word first, named
as a problem line), and counts identical pitches (5-word shingles, 90 percent, pitches under 10 words ignored) and
shared contributors inside the one list.
Applicants are read one at a time; each prints `ref name: tier`; the summary prints the totals and the reads.
`screen-report.ts` writes `<program>-<date>.md` and `.csv`: public evidence only, never a pitch. The program-facing
page is `docs/screening-pilot.md`.

## v6.1: the record, GitHub identity, the four tools and /me

Design `v6-design.md` (sections 4, 5, 8, 10, 14); plan `v6.1-plan.md`; ledger `v6.1-sdd-ledger.md`; owner steps
`v6.1-go-live.md`.

**Identity and the owner key.** A builder is a GitHub account (`builders`, `lib/v6/builders.ts`). An unlinked
installation works as in v5, except (v6.1.3) that `find` bars `min_tier` programs on a provisional tier from the
public code read (`provisionalTier`: a repo homepage, live URL or mainnet contract from code is live, any other read repo is building,
an unread repo has no bar; never shown as evidence; the gap line names the bar; a linked builder with no own tier read yet meets the same bar), names `blockersOf` against `EMPTY_RECORD` under
"Before applying:" ("Before tonight:" only when the agent sends tonight under standing approval), and keeps the closing line as the one action with the sign-in as its second sentence. The first `find` (and `record`) on an unlinked installation carries a one-time link
`earnkit.com/link/<code>` (15 minutes, hash stored, `link-routes.ts`); the builder confirms, signs in with GitHub
(`read:user`, `github-auth.ts`), and the callback links the installation and starts a 30-day session (`ek_me` cookie,
`sessions.ts`). The ledger's owner is `b:<builder>` once linked, else `i:<installation>` (`ownerKey`); linking moves
the installation's rows to the builder (the newer row per program wins), so every agent of one builder shares one
ledger. A second agent links to the same builder; an installation linked to another builder is refused.

**The record and approvals.** One JSON record per builder (`record.ts`, strict): person, team, company, projects
(several, each with its own answers), docs (links only), traction, the answer bank and the policy, with `meta[path] =
{ set_by, set_at, approved_at? }`. `mergeRecord` drops each bad leaf with a problem line, never the patch. An agent's
change to an approvable path (answers, project answers, the pre-launch traction line, raised) drops its approval;
only the builder approves, on `/me` (`approvePath`), and `answerFor` returns only approved text, so an unapproved
answer is never fitted into a form. `policy` (standing approval: `auto_apply`, `max_per_night`, `categories`,
`max_ask_usd`, `never`, `agent_may_submit`) is the builder's only. Writes go through `withRecord` (row lock).

**The four tools** (`lib/v5/mcp.ts`):

| Tool | Does now |
|---|---|
| `find` | As v5, plus on a linked installation: the project picked from the record, fields filled from the record first (approved answers, facts), then the repo, then the agent; the builder's own tier read at most once a day (`own-evidence.ts`), `min_tier` gating, the policy's filters, blockers (sign-in, needs a click), what the record still lacks, and what was applied overnight. Unlinked: the sign-in line. |
| `track` | As v5, plus `started` (a claim) and `unskip`; `applied` carries `submitted_by` and `fields_used`; `auto_applied` only for an agent's submission under standing approval. |
| `record` | `get`, `set` (merged as the agent, never approved), `brief` (the question and facts behind one answer kind, `answer-brief.ts`). Unlinked: the sign-in link. |
| `screen` | A program's reviewer only: queue an applicant list, read the results by `job_id`, record `outcomes`. |

**The claim rule.** Before filling, the agent tracks `started` (`claims.ts`): one claim per owner and program (an
advisory lock); another agent of the same builder within 24 hours gets `already` with the claiming agent's name; a
claim with no `applied` after 24 hours is released. A skip stands over a claim.

**The screen queue and the cron trigger.** `screen` (`screen-tool.ts`) is for a reviewer: a signed-in builder the
owner adds with `POST /api/programs/reviewers`. With `applicants` (up to 200) it queues a job (`screen-jobs.ts
createJob`: pitches compared for `identical_pitch`, then dropped; 10 jobs a day per reviewer). The cron's `workQueue`
(`screen-worker.ts`) takes each applicant atomically (`reading`, free again after 30 minutes), reads it as the pilot
does (a GitHub budget stop puts it back and ends the run; a tierless read worth a retry is queued again, `failed` at
the third) and stores tier, flags, because, line and public rows only (`github`, `explorer`, `site`, `earnkit`, never
`record`). The daily cron gives the queue 300 s; `POST /api/cron` with `{ "job_id": "..." }` is the owner's trigger
(that job only, at most 300 applicants in 600 s). With `job_id` the tool answers the totals line and the results;
with `outcomes` it records the program's decisions, which also reach a builder's ledger when their record project is
the same repo and they had applied. `xpCounts` gives each read the screens by other programs in 90 days sharing the
repo or a deployer ("seen in n other screens in 90 days", never a flag, never a program name).

**/me.** `proxy.ts` sends a visitor without a live session to `/docs#record` (302, `me-routes.ts meGet`).
`app/me/page.tsx` renders `meData` (`me-view.ts`) through `MeView.tsx`: pending approvals first, then one panel per
block in builder words (no path is shown), standing approval, applications, linked agents (Unlink) and delete last.
Plain HTML forms, no client script. Every POST (`/me/edit`, `approve`, `policy`, `unlink`, `delete`, `signout`)
needs a web form under 64 KB (else 415 or 413), a session and the day's csrf token (an HMAC of the builder id and the
UTC day with `EARNKIT_AUTH_SECRET`, today's or yesterday's), else 403 and no change. Edits merge as the builder under
the row lock; a problem comes back as a signed `?problem=` line (a crafted one is not shown). Delete needs the login
typed and removes the record, the ledger, sessions, reviewer rows and link codes, and unlinks the installations.
`/me`, `/link/*` and `/auth/*` send `X-Robots-Tag: noindex` and are not in the sitemap.

**Environment (ten).** `DATABASE_URL`, `EARNKIT_AUTH_SECRET` (also signs link codes, the sign-in state and the /me
csrf), `EARNKIT_URL`, `GITHUB_TOKEN`, `RESEND_API_KEY`, `CRON_SECRET`, `EARNKIT_PROGRAMS_TOKEN`,
`EARNKIT_PROGRAMS_API`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` (unset: `/link` and the callback answer
503). Plus `EARNKIT_SCREEN_OUT`, local only.

**Surfaces.** `/link/<code>`, `/auth/github/callback`, `/me` and its posts, `/docs` (your record; screening, for
programs), `/terms` (the record, what programs see), `/llms.txt` (the four tools), `/api/programs/reviewers`, the
`/api/cron` trigger.

**Not in v6.1.** Removing a project is only by clearing its fields on `/me` (no remove per project, and the agent
cannot remove one); skipping is undone only with `track unskip`, no page for it; explorer readers for Avalanche,
Tempo, Monad, Robinhood Chain and Solana; any public builder page.

## What v5 deliberately does not do

- Submit any form, hold or ask for a wallet, pay anyone, launch or offer a token.
- Scores, streaks, leaderboards, profile pages, share cards, badges, builder emails. (v6.1 adds one sign-in: GitHub, for the record.)
- Host sites, deploy contracts, read Stripe or onchain revenue.
- Store a builder's personal answers (v6.1 reverses this: the private record, deletable on `/me`).
- Run an LLM; fact fields are filled deterministically and prose goes to the agent with sources.
- Merge ledgers across a builder's agents (v6.1 does, once the builder signs in with GitHub).
- Show aggregate outcomes (the tables are shaped for it).
- Archive or flag off old code; deleted code lives in git history.
