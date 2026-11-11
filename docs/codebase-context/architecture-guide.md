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
| `find` | What the project can earn now (`ready`, pre-filled), what is one change away (`gaps`), what moved since the last call (`since`), and the ledger. With `program_id`: whether the project fits that program, as its find line without the number plus one action (v6.1.8), and its details, form and guide; the rules list reaches the builder only with no project or `ask: 'rules'`. With no project: the open list. |
| `track` | Records what the builder did: `applied`, `won` (with `amount_usd`), `rejected`, `no_result`, `skipped`, `gap_done` (with `item`). |

Every reply carries `show_to_builder` (plain text the agent may reword) and `agent_note` (what the agent does
next). The server instructions (the whole text sent to agents) sit in `mcp.ts` and are pinned by `mcp.test.ts`.
Since v6.1.14 (T1 to T7) the instructions say find first in every session and `record get` only once find's reply has
`linked` true; find's description asks for every project fact before the first call (chains with contracts,
`live_url`, `users`, `first_commit_at`); find and track share one project schema (`ProjectArg` and
`PROJECT_DESCRIPTION` in `project-input.ts`), so their keys cannot drift; track's `gap_done` says to copy find's gap
item exactly; screen's description names `ref` (required), `repo_url` and `live_url`; record's `set` describes
`projects` as a list and no tool description mentions standing approval as something an agent sets.

## The find flow

`find.ts` runs, in order:

1. `project-input.ts` parses what the agent reported, leniently: a bad link, unknown chain or bad date is dropped
   and a name over 80 or a description over 280 characters is cut, each with a problem line for the agent; only a
   missing name or description fails. `users` is true, false or null (not reported). A chain is a bare slug (`"base"`, mainnet) or an object;
   an object that leaves `mainnet` out is mainnet (v6.1.14 T1) unless it names a testnet in any form (`testnet: true`, a
   `network` or slug with a testnet word such as `base-sepolia`, or a testnet `chain_id`; fix round 1 F1), which is
   mainnet false; an unknown `chain_id` or a `mainnet` that is not true or false drops it with a problem line
   (`"true"` and `"false"` as text, trimmed, any case, read as the boolean, L16-15 v6.1.16).
   v6.1.14 L13-15: only a code host's link (`CODE_HOSTS`: github.com, gitlab.com, codeberg.org, bitbucket.org and their
   subdomains; `isCodeHost`) is a repo; any other `repo_url` is read as the live link, or dropped beside
   one, with a problem line, and never keys the project by repo (`projectKeyOf`). v6.1.16 L16-8: a link on a shortener
   (`SHORTENERS`: bit.ly, t.co, tinyurl.com, goo.gl, is.gd, cutt.ly, rb.gy, short.io and their subdomains; `isShortener`)
   in `repo_url`, `live_url` or `demo_url` is never read ("{field} dropped: a shortened link", before the code-host
   rule, so it never becomes the live link), and find's agent note adds `SHORT_LINK_NOTE` ("Shortened links are not
   read; send the real one.") on every reply kind. Before any of this, find reads its
   arguments leniently (L13-4, `readLoosely` in `tool-input.ts`, shared with track; find is registered with
   `lenient(FindArgs)`): a null field is left out, a string project is no project (the open list), a numeric id is its
   text, an over-long id is cut (no match, the plain unknown line), `filter.all` "true" is true, a bad `filter.category`
   is dropped; what was dropped is one agent-note line, "Some arguments were not read: ...".
2. `repo-facts.ts` reads a public GitHub repo with EarnKit's own token (`github.ts`: repo, tree, README, up to 12
   config files for chain detection, first commit date) and merges it with what the agent reported. Facts are cached
   7 days in `repo_cache` and re-read when `pushed_at` moves; the cron sweeps rows over 30 days. A row is trusted
   without a push check for an hour, except when the owner marked a code-checked step done (`gap_done` on chain,
   contract_on, builder_codes, live_product or integration) after it was read: find passes that time (`codeDoneAt`) as
   `staleAfter`, and the read checks for a push first, so the next find sees the change (v6.1.9 S4). Found unpushed,
   the row keeps that check's time in its facts (`checked_at`; no new column), and a row checked after `staleAfter` is
   no longer stale: one re-read per code step, then the row is trusted as before until the next push (F7, v6.1.12). A public read
   beats a reported `builder_codes: true`: none in the code is none, said once as "The repo does not send Builder
   Codes yet." (repo note `no_builder_codes`). An empty repo with no Builder Codes is one sentence, "The repo is empty and
   does not send Builder Codes yet, so I matched on what you told me." (`repoNoteText`, F9, v6.1.12). With no read to confirm them (none, or an empty repo), the name,
   description and options matched on them are `from: 'agent'` with the source "what the builder told you", never
   EarnKit's value (S12); they count as the agent's drafts, never as "need you" (F2, v6.1.10). `need_you` is one list:
   every required `builder` field without a record value, and the ready line's "Needs your ..." and "k need you" read
   it (lane 8 #8; it is `unvouchedRequired`'s list). Linked, a prose answer the record does not hold is `builder` (asked once, stored with record), with
   the sources kept to help word it (lane 8 #1). An installation gets
   10 uncached reads a UTC day (a cache hit is free); past that the facts are agent-reported only with the problem
   "repo reads paused until tomorrow". A private or unreadable repo is agent-reported only, and the reply says so
   (`as_reported`).
3. `programs.ts` lists the open programs. `eligibility.ts` evaluates each program's eligibility items against the
   facts: `ready`, `gap` (with each unmet item as a gap: kind, effort, whether the agent can do it) or no fit.
   `chain` and `contract_on` count as met only on mainnet. `users` not reported is a one-question gap the builder
   answers; `users: false` is no fit. A `rule` item (a requirement EarnKit cannot check) is a confirmation gap with
   item `rule:<hash8>` (the first 8 hex of the sha256 of its note). It sits after the real gaps and never counts
   toward the two-gap limit or the weeks refusal. The builder sees it as "Their rule" and confirms it once; the agent
   then calls `track` `gap_done` with its item. `rulesOnly` (`eligibility.ts`) marks a gap verdict whose gaps are all
   rules.
4. `rank.ts` orders them: ready by fit (long shots last), larger award, sooner deadline. Gaps (L1c-3, v6.1.10):
   programs on the project's own chains first (the reported chain before the read one), rule-free before
   rule-bearing; then chain-agnostic ones, rule-free before rule-bearing; then programs on other chains (their
   deploys). Within each, real changes before rule-only ones (rule-only ones naming a project mainnet first, then
   chain-agnostic, then the rest: R18e), then fewest gaps, lowest effort, larger award. `shownGapsOf` picks the shown
   gaps: first the acted-on programs (N-3; a claim counts only on the project it stored, its record id or project key,
   and never pins another project: L1d-1, v6.1.11; another agent's claim for another project still marks the program as
   held, in the default list and `filter.all`, and leaves the yes count (C1, v6.1.13, `held_for`); ruling 12 (v6.1.16):
   no line names that project. A held remote program goes in the block `Being handled by your other agent ({n}):`
   right after Ready, numbered on, its line with no held sentence (L17-6); a held in-person program is listed under In
   person with `Being handled by your other agent.` (or "since {time}" for a claim with no project) but is no yes in the
   closing, counting as held; L13-8 and L12-1, v6.1.14: a claim with no project holds the program on every project's
   list, by default and in `filter.all`, out of the yes), then every program closing within 7 days that the project fits (O1, ahead
   of the cap; its line says `closes in {n} days`), then at most one rule-bearing program among rule-free ones. That
   one, on the project's chains, takes its rank place; off them it is shown only after `max - 1` others or alone
   (N-2). A project with a chain, reported or read, never sees a deploy on another chain by default (`offChain`,
   `rank.ts`, L12-7 v6.1.14: a program naming chains, none of the project's and not any chain), closing soon or not,
   unless acted on; `filter.all` lists it and `more` counts it. A keyword hit (`keywordHit`, `eligibility.ts`, N1 v6.1.12: a rule still to confirm whose keywords the project
   names) is no rule-slot program: it competes as a rule-free step, own chain first, and ranks as a step with no rule
   left; only programs with no hit keep the one rule slot, and a keyworded rule with no hit is `unlikely`, so the slot
   holds rules with no keywords (L1e-2, v6.1.13: Thiel's `student`, `college` and the rest say which builders it is
   for). The project's own chains, reported and read, count as its words (T3-R3: a project on Avalanche names it). A rule item may carry `keywords` (L1c-2): when a rule still to confirm has keywords and the project names
   none of the program's keywords (whole word or phrase, case-insensitive, a hyphen read as a space) in its name, description, README excerpt
   or topics (the first three as prose: links, fenced code and inline code removed, `proseOf`, C3 v6.1.13; the README
   excerpt itself drops inline code spans; then identifiers dropped, `wordsOf`, L12-2 v6.1.14: a token holding `-`, `/`,
   `.` or `_`, or letters mixed with digits, unless it is itself a keyword or a word of one, so `npm i quest-cli` names
   no Quest while `mini-app`, `web3`, `team1` and `v4 hook` still count, as does a prose compound of letter-only parts
whose capitalised part is a keyword (`AR/VR`, `VR-ready`, `Uniswap-based`; fix round 1, T7-F5); topics and chains are read as given), `unlikely` (`eligibility.ts`) holds and the program is left to `filter.all` (counted in `more`); a rule
   with no keywords keeps the slot rule. With nothing ready, the closing's rule question names a keyword-hit rule-only
   program first (`keyword_hit` on the gap, L1e-5, v6.1.13), else the first in list order. v6.1.16 (L1g-8b): a gap
   program whose gaps hold `repo:public` carries `public_first` and never lends its rule (neither `firstRule` nor
   `stepRuleOf`); in the full list a program `unlikely` held for carries `unlikely`, whose rule is asked only when no
   step is shown, and `firstStepOf` closes on a likely program's step before an unlikely one's. A multi-word keyword
   matches only as a whole phrase (Meta VR's `meta quest`, `quest 3`, `horizon os`: "Quest Runner" is no hit, L1g-1). One yes per reply (L1e-2,
   T3-R5): no rule line, remote or in person, carries its own `Say "yes n" if that is you.`; the closing is the one
   yes, and the builder may still answer `yes n` for any numbered line. Several rules still to confirm read as one
   sentence, `Their rules: a; b.` (L1e-6). Every gap line closing in 14 whole days or fewer says `closes in {n} days`
   (L1e-6; the 7-day O1 rule still decides who jumps the cap). In-person programs are off the default step list (R18d, R18f); a rule-only
   in-person program is listed in the In person block after the ready ones, with its rule and `Say "yes n" if that is
   you.` (O2), in the in-person slots the ready ones leave. With nothing remote ready, a shown remote step closes the reply
   (its rule's yes, the users question or, from v6.1.16, `Tell me when {step} and I look again.`), the cheapest step shown first: a question (the users
   question, the started question) before any change, whatever the line order (`firstStepOf`, fix round 1, v6.1.12).
   The users question closes "Do real people use it? Say yes and I apply." only when that yes makes the program ready;
   with a setup step or a rule left beside it, "Do real people use it? Say yes and I look again." (final fix, v6.1.12); only when no remote step is shown (or none names an
   action) and in-person programs are listed is the closing `Nothing remote is ready yet. Say yes and I start the
   in-person applications.` (fix round 1). v6.1.14 says each thing once: a ready line whose needs the closing names (a yes that waits) drops its own "Needs your"; unlinked, the bar is the gap "proof that real people use it" and the sign-in is asked once, in the closing ("Sign in once at <link> and I check that and remember you." after a repo read, "... and I remember you." with none; with no link to give, after a deleted account or a failed link, "Sign in once and I check that." or "Sign in once and I remember you."); the one-program reply appends that sentence after its action when the proof sits beside other gaps; nothing fits closes "Ask again any time and I show what is new.", since EarnKit never writes first. `filter.all`
   shows everything and the `more` count includes what is left out. Skipped and applied programs never return unless
   their next round opens. An empty repo read is cached like any other (L1c-4). A remote gap line names the program's
   `setup` steps as ` First: a; b.` after its gaps and before its rules (L1d-2, v6.1.11), so catalog `setup` items are
   verb phrases; an in-person line says them once in its attend sentence.
5. `prefill.ts` fills each ready program's form: fields EarnKit can answer (`from: earnkit`), prose fields handed to
   the agent with sources (`from: agent`), and fields only the builder can give (`from: builder`, a demo video or
   a file, or an `other` answer the program file marks `from: builder`, unlinked: Thiel's and YC's application
   answers, Base's revenue; L1e-3, v6.1.13, so an idea and an empty repo read the same need). Blank beats a wrong guess. `facts_from_repo` counts only values the public code read gave (its repo link,
   homepage, contracts and chains with basis `code`), never anything the agent passed; the reply's one Drafted shape (v6.1.15 #3, linked and unlinked) is "Drafted: {n} of {m} answers. Needs your {needs}.", the needs sentence left out when there are none or the closing names them (`draftedSentence` in `reply.ts`).
6. `since.ts` lists programs new, changed (deadline, amount, status, form) and closing within 7 days since this
   installation's `last_find_at`. Empty on the first call.
7. `ledger.ts` summarises the installation's applications; results past due become `ask_outcome`. A program with no
   results date is asked about 30 days after the send (`sent_at`, else `at`; `ASK_AFTER_DAYS`, v6.1.9), so "I'll ask
   how it went when results are due." is always kept.
8. `find` caps the lists (at most 5 remote ready, 3 gaps, then at most 2 in person) and `reply.ts` writes `show_to_builder` and `agent_note`. In-person
   programs get their own block with their setup (never in "apply to all N"), and the reply ends with
   exactly one closing line. `find` caps remote and in-person ready apart, so an in-person program never takes a remote slot.
   The caps live in `shownReadyOf` (`find.ts`, pure): with no remote ready it shows only the 2 in-person slots.
   `find` also saves every gap (at most 60) to `installations.last_gaps` as `{ program_id: what is missing }`;
   `track` `started` reads it to say what is still missing; `track` `gap_done` drops that program's entry. A rule
   still unconfirmed is part of what is missing.
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
   stale after two failing days, closes an active or upcoming program whose deadline passed and opens an upcoming one
   at its `starts_at` (v6.1.16 Task 16, L30-1; one without submission requirements stays upcoming and is listed in the
   run's `failed` until its file has them; a closed program may have none). A redirect to another host counts as alive
   (L30-2: `probeLink`, never followed; `[health] {id} redirects to {host}`). A source page sharing fewer
   than 80% of its words with the text stored the day before (`program_health.body_text`) counts as changed: it is
   listed in the owner's digest and never marks the program stale. A program unverified or stale for 14 days leaves
   the open list. The deploy's sync writes an active file past its `ends_at` as closed, with a warning, so a deploy
   never reopens it. There is no LLM in the cron.
5. Readers: `programs-read.ts` serves public `GET /api/programs`; `landing.ts`, `guide.ts`, `guide-page.ts` and
   `stats.ts` feed the site. A program card shows the summary's money phrase whenever it has a figure ("$250,000 over two years", "Up to $100,000 by tier, more by DAO vote", v6.1.15 fix round 2), never a threshold the builder must reach (" at $10M USDG TVL" is cut); with no figure in the phrase, the pool (`pool_usd`, as "$N in grants" or "$N in prizes"), then the per-winner `max_award_usd` ("$10,000 to $900,000" with a `min_award_usd`), else the phrase's words; a big tile, one lone figure, draws "Up to" small above it (`moneyOf` in `programs-read.ts`). v6.1.15 (lane 22, #12): money is in full figures on every surface (tile, list API, guide, reply), never K or M; only the hero chip rounds, down, to one decimal (`heroUsdText`, "$3.1M"). The tile, the list API, the guide header and the find reply share `moneyOf`'s string: with a capital on the tile and guide, and lowercase mid-sentence in the reply (find's `moneyOf` is `moneyAt(moneyOf(p), 'mid')`), keeping "EUR", "NYC", "$", "iOS", "DeFi" and chain names (`lowerFirst`, one rule wherever a phrase is lower-cased). `programs:check` refuses a summary money with no number and no "amount not stated", and one with K or M. v6.1.16 (L21-2): `programs:check` refuses a closed program whose description or rules carry an open-window sentence (`OPEN_WINDOW` in `program-checks.ts`: "applications are open", "apply now", "open until"); a closed program's guide (status closed, or `ends_at` passed) reads `Closed on 1 Nov 2026.` (`closedOn`: the `ends_at` day in the program's zone, else `verified_at`) as its window line, and its description and rules drop each open-window sentence, so a date-closed file still marked active reads right. Guide lines (who can apply, field to-dos, focus, past rounds, best bet, source labels) are sentences (`sentence()` in `guide.ts`). v6.1.16 (Task 7): an open guide's close reads `Closes tomorrow.` under 24 hours and `Closes in {n} days.` under 14 (`closesIn14`), its meta description is `guideMeta` ("$67,500 in prizes, closes Nov 12. ..."), its description ends as a sentence, and an in-person program's first pill is `In person: {city}.` (`city` on the file; `programs:check` refuses an in-person file without one). An unknown guide id renders the site's not-found content in the server HTML with noindex (HTTP 200; notFound() left the production body empty on Next 16.4.1). The landing copy (`site-copy.ts`) promises what the replies deliver (v6.1.14): "fills the forms", step 3 "It fills the form and sends it, or hands you the draft to send.", the six under "Open now". The hero chip ("$3.1M in grants and prizes open now") sums, per open non-investment
   program, its `pool_usd` when set, else its `max_award_usd`. The landing shows six programs (`featuredTiles` in
   `landing.ts`: open, not investments, at least $10K; closing within 14 days with at least $25K first, then by money;
   one per organizer, at most three hackathons) and a link to /programs, which lists every one (`landingTiles`).
   The pages read through `cachedRead` (`app/lib/cached.ts`, `unstable_cache`, 10 minutes, cleared by an API write);
   v6.1.16 (S): its keys carry the build id (`cacheKey`, `BUILD_ID` from `EK_BUILD_ID`, which `next.config.ts` `env`
   inlines at build from `RAILWAY_GIT_COMMIT_SHA`, else the build time), so a deploy never serves a page cached by the
   build before it.

## The ledger

`applications` holds one row per installation and program (latest status wins); `application_history` keeps every
change; `gaps_done` records closed gap items. It is keyed by installation only: v5 has no proof of who a login
belongs to, so a re-authorization starts a fresh ledger and a builder with two agents has two. `gap_done` takes only
one of the program's own eligibility items (`users` only when the program has a `users` item); any other item is
refused, and the agent note lists the program's items. It is trusted only for kinds EarnKit cannot verify (`feature`, `users`, `demo_video`, `rule`);
verifiable kinds are re-read from the repo.
A done step belongs to one project (v6.1.10, L1c-1): `gaps_done` carries `project_key` and is unique on
(owner, project_key, program_id, item). `projectKeyOf` (`project-input.ts`, pure) gives the key: the repo link in its
one canonical form (an SSH clone link, `git@host:o/r.git` or `ssh://git@host/o/r`, read as https first by `sshAsHttps`, the one converter find, track and the screen share, FR-2; `canonicalRepoLink`, v6.1.13 B4: https, host lower-cased without `www.`, no port, no `user@`, no
query or fragment, a trailing dot on the host dropped (L12-6, v6.1.14), on github.com owner and name only, on bitbucket.org and codeberg.org the path up to its first `src` segment at index 2 or later (`/src/main/`, `/src/branch/main`, L16-6 v6.1.16), on other hosts the path up to its first `-` segment (so `-/tree/...`, `-/blob/...`, `-/issues` fold and a subgroup named `tree` stays), no trailing slash or `.git`; an owner or group alone (`github.com/owner`), or one of GitHub's own pages (`orgs/`,
`users/`, `sponsors/`, `topics/` and the like), names no repo, has no repo key and is parsed as a plain link (`link`),
neither the repo nor the live link, so it meets no bar and the project keys by name (L12-6; fix round 1, T7-F1, T7-F6);
the repo read's cache key `repoKey` reads the same helper), else `name:` and the name NFKC and case-folded, else `''`
(rows from before v6.1.10 stay at `''`). The first find that adds the repo to a project found by name moves its
`gaps_done`, claim `project_id` and `project_reports` rows from the `name:` key to the repo key in one transaction
(`rekeyProject` in `ledger.ts`: rows copied with ON CONFLICT so a step marked at the same moment cannot fail the find, the newer time winning, then the `name:` rows deleted). A project named alone whose `name:` report names a repo is read under that repo's key (`resolvedKey` in `ledger.ts`, final round W1 and W2): find's steps, claims and report and track's key (`projectOf`), so a send or find by name sees what a find with the repo marked; a name-only find of it keeps the repo link in its report. `find` reads done steps (`doneItems`, `doneOn`, `codeDoneAt`) with that key;
a project item (`PROJECT_ITEMS`: `users`) done on any program of the project counts for every program on it (L1e-4,
v6.1.13: `Done.of`), for find, track and the send check alike, while a yes said (`rule_yes`) and the acted-on pin stay
the program's own (`Done.own`) and keeps it in
`installations.last_project_key`; `track` takes the key from its `project` (`name`, `repo_url`), else the record project
named by `project_id`, else `last_project_key`. Track parses its `project` with find's own `parseProject` and limits
(v6.1.13 B5, `partial`: a long name is cut to 80, a bad or long link dropped, a missing name never refused; the problems go
in the agent note), so a key is find's key. `last_gaps` are the last find's project's and written with its key: a
find of another project that writes no gaps drops them (`rememberProject`); `started` on another project
skips the remembered remark and `gap_done` there leaves them. Linking an installation moves its rows with their keys.
`won` with an amount is the one fact that later feeds an aggregate "what wins" view; nothing aggregate is shown yet.
A `won` above the program's `max_award_usd`, else its `pool_usd`, else 10,000,000 when it states neither, is refused and writes nothing.
`asked_usd` leaves out investment programs.

Ledger invariants (v6.1.7, `ledger.ts record`, every write under one advisory lock per owner and program, the same lock
`claims.claim` takes, and every refusal returns before any write): one application and one result per program. A
second `applied` from any of the builder's agents records nothing and answers "Already sent here on {day} by {agent};
nothing recorded." v6.1.16 (L16-1, L16-2): the ledger holds the latest result. A won or rejected, unmarked, over a
different result (won and rejected either way, a win with another amount or currency note, or over "no result"),
from the program's screen or the builder's own track, is a correction: it replaces status, amount and note, its
history row has `corrected` true, and `record` returns `corrected: true`. A further payment over a result that is not
a win, or over a send with no result yet (fix round 1 M1; it reads "Further payment refused: no result yet; post a win first."), writes nothing: "Further payment refused: the current result is {status}; post a win first." `no_result` over a
result is still refused ("That one already has a result here: ..."), the same result is "Already tracked." (an unmarked win of the
stored amount is "Already recorded; nothing new.", v6.1.16 L17-8). A second
win with an amount over a win with one (L15-17, T8-F1 v6.1.14): marked a further payment (`payment: { key }`, the caller's own key, kept in
`application_history.payment_key`; a repeated key is "Already tracked.") it adds to the total under the cap, answered
"Tracked: ${n} more from {title}, ${total} in total."; unmarked, the same amount is "Already recorded; nothing new." and another
amount is a correction that replaces it ("Tracked: ${n} from {title}. Replaced the earlier amount."; one save verb, Tracked, v6.1.15 #8). Before v6.1.16 track keys
were stored as `t:<key>` and screen keys as `s:<key>`; from v6.1.16 both are stored bare and match the old ones. A program that is not open cannot be started
("{title} is not open; nothing to start."), and an already sent one says it was sent before that check. A win is
capped at the program's `max_award_usd`, else its `pool_usd`, else 10,000,000, in whole dollars. A result for a
program gone from the catalog keeps the title stored when it was sent. Another agent's live claim leaves the program
out of tonight's count (N) and is shown as being handled by the other agent; an agent's own claim counts toward N.
v6.1.14 L13-9: tonight's list is computed once per find over every ready program, acted-on first (`tonightAll` in
find, `tonightOf` over them), carried as the reply's `tonight` ({ programs, limit_used }) and read by `tonightIn`, so
the default and `filter.all` replies name the same list; when it names programs past the shown list the agent note
says to call find with program_id for their fields. L13-10: a program outside the approval only by its award (its
blocker's `over_limit_usd`) reads "you say yes yourself to {titles}, over your {limit} limit". L13-18: the line reads
"Your applications: {n} sent, {n} won ({$}), {n} rejected, {n} waiting{, n closing soon}." with each zero count left
out. L13-17: the since line leaves out a close that a listed line already says.

v6.1.16 Task 4 (lane 17 races): every skip and gap_done decision runs inside `record` under the per-program lock, so
30 parallel skips write one row: a repeat answers "Already skipped." with no history row, a sent program "That one was
already sent; nothing to skip.", and another agent's live claim "Your other agent is handling that one; nothing
recorded." with the claim left in place (a skip still replaces the agent's own claim or a stale one). A history row is
written only when the ledger changed, and names its `source` (`screen` or `builder`; NULL on older rows). A correction
applies only when its event time is at or after the stored result's ("An earlier result; nothing changed."); a repeat
never moves the stored time, which stays the original result's (fix round 1, I1); a screen's resent result or payment
retry reaches the ledger at the kept outcome's own time, never its arrival, so it never overwrites a builder's later
correction (the reviewer hears "Already recorded; nothing new."). An unmarked win of the stored amount, from either side, is "Already recorded; nothing new."; a further payment
needs its mark, and payment keys share one space per application (track and screen send them unprefixed;
`paymentKeyOf` reads a stored `s:`/`t:` key as the bare key, alias until v6.1.17). A send refused because its agent was
unlinked meanwhile tells the agent the form went out with no record. The screen queue takes one lock per program and
never queues an applicant an unread row of the program's live screens holds by identity (EarnKit id and repo key; for
applicants with neither, the same reviewer's ref and site); the reviewer hears which row holds it. find lists held
programs under "Being handled by your other agent ({n}):" after Ready, numbered on, and never names another project
on a held line.

## Freshness and the daily job

`.github/workflows/earnkit-cron.yml` posts to `/api/cron` once a day with `CRON_SECRET` (v6.1.14 L13-11: a secret under
32 characters answers 503 "cron is not set up" with one `[cron]` ops log line, never 401). v6.1.16 Task 16 (lane 30):
`cron.ts` runs its steps in order, each in its own try: `health` (`health.ts`: every listed program, 10 at once
(`PROBE_PARALLEL`), 8 s per link (`PROBE_MS`), one GET per link whose page also gives the source text; status moves by
date, each program's probe-and-write and its status move in separate tries), the sweeps (`sweep_repo` repo cache over
30 days, `sweep_reports` project reports over 180, `sweep_screens` screen jobs over 180 with their rows, `sweep_auth`
link codes and sessions expired over a day, spent OAuth codes over a day and registered OAuth clients over 30 days
that never exchanged a code (`oauth_clients.used_at`), `sweep_evidence` the evidence cache read over 180 days,
`sweep_windows` rate windows started over 2 days ago; the per-hit random sweep is gone), `screen` (`workQueue` with
`SCREEN_BATCH` 200 until `min(start + 300 s, deadline - 20 s)`), then `digest`. One `deadline = start +
RUN_BUDGET_MS` (420 s; curl waits 540): health and the queue start only before it, else they are listed with error
`budget`; a probe starts only when it can finish before it; the sweeps and the digest always run. The answer is
`{ health, swept: {per table}, screen: { read, left, jobs_finished }, digest, failed: [{ id, step, error }] }`
(`id` a program's, or null for a whole step; `error` a code by the error's class: `db`, `fetch`, `timeout`, `budget`, `catalog` (a program its file keeps from opening or closing), `parse` (a stored file that no longer parses) or
`error`, never the message, which goes only to the `[cron]`/`[health]` server log line), 200 with
the list, 500 only when every step failed. The workflow prints the body and fails the job when curl fails (5xx, no
answer in 540 s) or `failed` is not empty, one `::error::` line per entry; the next run retries. The owner's digest
(`owner-digest.ts`: programs closed by deadline, programs opened by start date, failed links, changed pages and every
change to live programs since the last digest, with revert links; nothing happened, nothing sent) answers `sent`,
`none` (nothing, or this body already sent today) or `mail off` (`RESEND_API_KEY` unset); its idempotency key is
`owner-digest:{day}:{first 16 hex of the body's sha256}` and `owner_digests.body_hash` keeps the last body sent that
day. Mail is `mail.ts` over Resend, to the owner only. The owner triggers one screen job with the same route and a
JSON body `{ "job_id": "..." }`: only that queue runs (300 applicants or 10 minutes), no probe, sweep or digest.

## The site

| Route | Is |
|---|---|
| `/` | Landing: one statement, the install picker, the three steps, six featured programs and a link to all of them, open money |
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
`site-theme.ts` (mirrored in `globals.css`). See `apps/frontend/DESIGN.md`.
v6.1.16 Task 10 (lane 25): one line about EarnKit, `ONE_LINE` ("Your agent finds the grants and prizes your repo fits
and fills the forms. Free."), is the hero, the meta description, every default share card and SchemaOrg. Each page's
metadata goes through `pageMeta` (`app/lib/meta.ts`): canonical and og:url the same address, the page's own title and
description on the card (/docs `Add EarnKit to your agent · EarnKit`, /programs, /terms `Terms · EarnKit`; a guide's
og:title `{Title}: {money}` over its description's first sentence). The layout (`SITE_METADATA`) sets no canonical,
og:url or robots, so the 404 has none and Next's own noindex is its one robots meta; an unknown guide (200) carries
`NOT_FOUND_METADATA`'s noindex. `proxy.ts` answers a page path with an upper-case letter with a 308 to its lower-case
form (`lowerPath`, query kept, public origin); its fourth matcher entry matches only such paths with no dot, outside
/_next, /api, /mcp and /oauth in any case. The install tabs add VS Code (`code --add-mcp`), Claude's tab is four steps,
and /docs says under the tabs `Another agent? Add https://earnkit.com/mcp as a remote MCP server and sign in.`
(`OTHER_AGENT_LINE`). tools/list gives each tool a `title`, and find `readOnlyHint: true`; /mcp's 401 reads `Sign in to
EarnKit from your agent to use it.`; /me, the link banner, the /link confirm page, the `Linked:` note, the ledger's
`Already sent here ... by` line and a claim's holder show an agent's name without one
trailing `(...)` (`displayName`: `Claude Code (earnkit)` shows as `Claude Code`, the stored name unchanged). OAuth (`oauth.ts`, `oauth-routes.ts`) is
standard (PKCE, dynamic client registration) and approves at once; the issued token is the installation.
v6.1.16 Task 5 (lane 19): a registered client_id is 128 random bits (22 base64url characters) kept in `oauth_clients`
with its redirect URIs (at most 10, else `invalid_redirect_uri` `at most 10 redirect_uris`) and cleaned name; `clientOf`
checks a URL first (CIMD), then `oauth_clients`, then a signed id from before v6.1.16 (an alias for one release). The
code_verifier must be 43 to 128 unreserved characters (RFC 7636 4.1, else `invalid_grant`). A code is spent once:
tokenPost writes its nonce to `oauth_codes_spent` in the same transaction as the installation (`installOnce`); a second
exchange answers `invalid_grant` "Code already used; the token it gave is revoked." and sets the first installation's
`revoked_at` (`connectInstallation` then answers null, so /mcp is 401); the daily cron sweeps spent rows over a day
old (`swept_auth.oauth_codes`). `resource` (RFC 8707), when given at authorize or token, must be `EARNKIT_URL/mcp`
(a trailing slash folded; `sameResource`), else `invalid_target`; the code carries it and the installation keeps it as
`audience`; /mcp refuses (the usual 401) a token whose audience is set and is not its own resource (NULL, before
v6.1.16, is accepted). /mcp serves JSON for an absent Accept, `*/*`, `application/*`, or one naming JSON or the event
stream (406 `not_acceptable` otherwise); a JSON-RPC id that is an object, an array, a non-integer or beyond the safe
integers answers -32600 with id null (400 alone, that member's answer in a batch). Every unserved method on /mcp,
/oauth/* and /.well-known/* is 405 `method_not_allowed` with `Allow` (`notAllowed` in http.ts; /mcp `POST, DELETE,
OPTIONS`, register and token `POST, OPTIONS`, authorize and discovery `GET, HEAD, OPTIONS`, authorize with its own
OPTIONS); `proxy.ts` answers methods no route can export (PROPFIND and the like) the same way on /oauth/authorize and
/.well-known only: a path the proxy matches has its whole body buffered by Next before the route runs, so /mcp,
/oauth/token and /oauth/register stay out of its matcher (fix round 1). PROPFIND-class methods there, and TRACE and
CONNECT everywhere (refused by Next's own Request first: a bare 500), are parked as an edge rule. `readCapped` gives up
on a body not finished within 5 s (`BodyTimeoutError`); every caller answers 408 with one log line `[http] body read
timed out`: /mcp, token and register `request_timeout` (JSON), /me posts `The request took too long. Try again.`,
reviewers and the programs write `{ ok: false, error: 'the body came too slowly' }`, the cron `{ error }`
(`readBody` in http.ts; a body over the cap stays a 413). Protected-resource metadata is served only at the exact path and its `/mcp` suffix; any other subpath is 404. A
client_id that is an https URL is a client ID metadata document (CIMD, v6.1.15 Task 14; claude.ai's default; an
http:// client_id goes to the same document check and is refused there):
`cimdClient` fetches it through `safeFetchJson` (https, public addresses only, no redirects, 5 s, 10 KB, JSON), requires
its `client_id` to equal the URL, lists the redirect URIs (at most 10) and takes `client_name` through `clientNameOf`
and `reservedClientName` (a name holding `earnkit` after look-alike letters fold, and v6.1.16 L16-10 digits and `l`
read as letters, 0 o, 1 i, 3 e, 4 a, 5 s, 7 t, l i, so `earnk1t` and `earnklt` are refused); cached in process 1 hour when good and 5 minutes when not (1,000 URLs). Fetches of URLs
are capped at 30 an hour per document host (`cimdFetch`; over it, no fetch and the failure page); only a refetch
of a URL that still has a good copy is exempt, so a URL with a failed entry counts again after its 5 minute wait. A refetch that hits a transport error (DNS, connect, timeout, 5xx,
`TransportError` in safe-fetch) keeps serving the last good copy for up to 6 hours from its last good read; any
definitive answer (4xx, redirect, non-JSON or invalid body, failed check) drops it and caches the failure. Any failed check
shows only "Connecting EarnKit failed. Your agent's client document could not be read." (`CIMD_FAILED`). Its
installs count against `client:host:{document host}:{address block}` after the per-address and per-block floors (no ceiling shared by every user of one document); the metadata advertises `client_id_metadata_document_supported`. A
many-builder hosted registration gets no client key. Every register and token request counts on the one per-IP floor
(an hour) and on its address block's daily cap (v6.1.13 B1: IPv4 /16, IPv6 /48, `blockOf` in `rate-limit.ts`; 5,000
registrations, `oauthRegisterBlock`, and 5,000 installs, `installBlock`, a day, so one hosted vendor's /16 can still
reach `installClientHosted`; over it, "Too many sign-ups from your network today. Try again tomorrow."; one ops log
`[oauth] block near cap` as a block reaches 80 percent of its day). Hex IPv4-mapped IPv6 is unmapped to its IPv4. No ceiling is shared by every user of one hosted service, so one network
rotating addresses never locks out another; the hosted tier (every redirect URI is a listed vendor's exact host and callback path, `HOSTED_REDIRECTS`) only raises
the per-client ceiling (`installClientHosted`). `GET /mcp` is 405 (`Allow: POST, DELETE, OPTIONS`): EarnKit never pushes. `rate-limit.ts` keeps fixed-window counters in Postgres. Each MCP tool call counts
120 an hour per installation and 600 an hour per client IP; over either, the call answers the tool result "You have
asked a lot this hour. Try again in about {n}." (v6.1.15; `{n}` in minutes, hours past 90 minutes; not a transport error, so clients show it). `secrets.ts` scrubs secret
keys from tool-call bodies before anything sees them.

## Database

`apps/frontend/db/schema.sql`, additive and safe to run twice (`pnpm db:migrate`, run before each deploy).

| Table | Holds |
|---|---|
| `programs` | Every program: the whole record in `file`, plus mirrored columns and source (`file` or `api`) |
| `program_changes` | Field-level changes, for `since` and the owner digest; a change to a form item's display-only words (`need`, `todo`, `guidance`, `description`) is not a form change (v6.1.15) |
| `program_writes` | The write API's audit log and the pending writes |
| `program_health` | The freshness probe: link status, page hash and text, failing days, changed_at |
| `installations` | One row per issued token (hash only): client name, `audience` and `revoked_at` (v6.1.16), `last_seen_at`, `last_find_at`, `prev_find_at` (the find before; v6.1.9), `last_gaps` (the last find's gaps), `builder_id` and `linked_at` when linked, `unlinked_at` and `unlinked_reason` (set by an unlink on /me or the account's deletion, cleared by the next find or a new link) |
| `rate_windows` | Request counters; the daily run sweeps windows started over 2 days ago |
| `repo_cache` | Public repo facts, 7 days; swept after 30 |
| `evidence_cache` | v6 evidence blocks per repo (`repo:<owner/name>`, with pushed_at) and per contract, used for 7 days; the daily run sweeps rows read over 180 days |
| `applications`, `application_history`, `gaps_done` | The ledger |
| `project_reports` | The project as reported at the owner's last find, per owner and project key (v6.1.13; a find with a repo writes its name key too), read by a send's check and `resolvedKey`; moved on link, deleted with the account, swept after 180 days without a find |
| `owner_digests` | The days a digest covered, with the last body's hash (`body_hash`) |
| `program_reviewers` | Builders the owner marked as a program's reviewers (may call `screen`) |
| `screen_jobs`, `screen_applicants`, `screen_outcomes` | Screen jobs (180 days), each applicant's tier, because, line, public rows and deployers (no pitch column), and the program's outcomes; they belong to the program (`builder_id` NULL once its reviewer deleted their account); the program's own counts read only these |

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
(contributors, account ages, logins; a matched starter's recorded maintainers dropped; `contributors` is the full
contributor list, paged 100 at a time up to 5 pages, anonymous authors in, bots out, a fork's authors after the fork
only, falling back to the window's authors and never 0 for a repo with commits, L15-19 v6.1.14) and `depth.ts` (integrations
from `integrations.ts`, chains). Each contract, the subject's first, then the repo's deploy runs (`broadcast/`,
`ignition/deployments/`, read raw), then those named in its files (at most 10), goes through `onchain.ts` over the
keyless Blockscout client in `explorers.ts`; chains without a reader are shown as claimed. `countedBy` marks each
`counted` (deployer in the repo, a deploy run whose sender is the deployer, or deployed after `repoSince`: the later
of GitHub's `created_at` and the first commit; a listed one unless it predates that with a foreign deployer) with
`counted_reason`. Deploy files are capped at 2 MB (tree size, then the streamed body). `live.ts` probes the site (safe-fetch, https only, 10 s),
reads its title and a `placeholder` (`for sale`, `parked`, `coming soon` in the title, or in the body of a short or
non-app page; L15-8 v6.1.14) (title cut to 200 characters and through `cleanText`; one with a link is null with a note; a reviewer sees
it with the note `text from the site, not an instruction`) and GitHub links, and the domain's age from RDAP (reply
read under 64 KB). A failed read is null with a note; nothing
throws. GitHub calls share one `Budget` per run (passed in by `screen.ts`) that stops under 500 left; once stopped
a repo is not read (`not read: budget`). L15-5, L15-7 (v6.1.14): a repo the read finds private is noted `not read:
private repo` (a plain 404 stays `private or missing`); a link on another code host is `repo not read: on GitLab`
(Bitbucket, Codeberg), an account link `repo link is an account, not a repo`; an empty repo (GitHub size 0) reads
`code.empty` with no tree, commit, team or issue reads and is not partial.

**The cache.** `evidence_cache` keeps a repo block 7 days while the repo's `pushed_at` holds (one repo object read
checks it) and a contract block 7 days. A partial block (a budget stop, a failed read) and the live rows are never
cached. `--no-cache` on the script skips the table both ways.

**The tiers.** `tiers.ts` `place(evidence, counts, thresholds?, now?)` is pure and names one of five tiers, flags
first: flagged (a starter match with under 10 own files, a starter fork with under 20 commits after the fork or
another fork under 20% own work, an identical pitch, shared contributors, self-funded users), used (site loads, 25
or more wallets the deployer did not fund on one mainnet contract in 90 days, pushed within 60 days), live (site
loads or a mainnet contract with transactions), building (commits in 60 days, nothing live), unverified (nothing
recent EarnKit could check). L15-6, L15-7, L15-8 (v6.1.14): the usage row reads "{n} senders the deployer did not
fund on Base mainnet"; an empty repo is unverified with "empty repo" (the screen has no separate idea tier); a counted
contract with any sender the deployer did not fund is at least building (next: the push); a placeholder page is not
"site loads" ("site is for sale"); with no repo block the row says why ("private repo", "GitLab repo, not read",
"account link, not a repo"); a contract on a chain with no reader is named "{address} on Monad: not read". Only counted mainnet contracts count; the others are listed with their reason. `DEFAULT_THRESHOLDS` carry
their reasons. `tier-words.ts` turns a placement into the reviewer's line and the builder's line.
v6.1.15 (#6, #15): a placement carries `next` (the exact rule, agent and owner words) and `builder_next` (the builder's
form, which `builderLine` reads): the live usage gap reads "About 25
outside users in 90 days; I count {M}.", the building gap "A live product: a site that loads or a contract in use.",
and the flag "At least 20% of sampled users from outside the team; I count {M} of {S}."; every other gap's equals
`next`. The used head reads "People outside the team use it live." and building on users alone "Your project has
people using it live, with no recent code.". The find tier gap is cut from the stored builder line, and a line stored
before v6.1.15 is reworded on read (`currentBuilderLine`, a small table of the old templates, in `recordSide` and
`storedSide`, so also while re-reads fail), so a linked builder's gap and summary never name deployer, senders or
mainnet. A screen row read before v6.1.15 reads on a results page with the rule `self_funded_users` and the head
`flagged (self-funded users)` (`currentReviewerLine`; alias until v6.1.16); the markdown report's flag lines use `ruleWords`. The farmed-wallet flag's rule id is `self_funded_users` (read "self-funded users"; a row stored as
`unfunded` reads the same, `RULE_WORDS`); the threshold names are unchanged. The CSV and the results rows show the
count as `outside_senders_90d`, with `funded_senders_90d` beside it as an alias until v6.1.16.

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
not read (B20): building when a repo or live link is reported, a reported live link never live, else no tier and no fit for a program with a bar; never shown as evidence; the gap line names the bar; a linked builder with no own tier read yet meets the same bar, said as "Your proof is still being read; ask again in a minute."). The bars are onchain evidence (B20b): they apply only to a project with a chain, reported or read; for a chainless project a `used` bar becomes the users question (the program's users item, else an implied one) and a `live` or `building` bar does not apply. With no tier at all on a chain (nothing read, no repo or live link), a
`building` bar never hides a program on one of the project's own chains, or a keyword hit, whose only change is code in
a repo: it is a gap of `code in a repo` (`NEEDS_CODE`) and its rules (`codeStep` in `gateFor`, L12-7, v6.1.14), so a
Solana project with no repo sees Solana Foundation Grants as its step; any other program with a bar is still no fit.
`gap_done` takes the code step (`repo`) on any program (fix round 1, T7-F2), answered "Tracked. Tell me when it is live
and I look again." with no repo; the read settles it. The unlinked path names `blockersOf` against `EMPTY_RECORD` under
"Before applying:" as one sentence naming the programs per thing the builder does ("you sign in by email and press submit yourself on X"; "Before tonight (nothing is sent until these are in):" when the agent sends tonight under standing approval, or when nothing can go), and keeps the closing line as the one action with the sign-in as its second sentence (v6.1.8: "Say yes and I apply to all n. Or say the numbers to skip.", "Say yes and I apply." (v6.1.16 L16-11: "Say yes and I apply to {title}." for the one ready program, `closingLine`'s `title`, also after a yes that stands or waits; a program with a result shows its title and money, then "Won $3,000." / "Rejected." / "No result." and no yes, step or sign-in, from `resultOf` in `ledger.ts`, L16-7), "Nothing is ready yet." with the first rule's yes (v6.1.9: also the rule of the only step program shown, "if that rule fits you"; else, from v6.1.16 L1g-5, "Tell me when {step} and I look again." through `singleStepClosing`), "Applying tonight to {titles}."; each gap line carries its own "Say \"do n\"" only when EarnKit can make every real gap, and each rule-only line its own "Say \"yes n\" if that is you."). The first `find` (and `record`) on an unlinked installation carries a one-time link
`earnkit.com/link/<code>` (15 minutes, hash stored, `link-routes.ts`); the builder continues, signs in with GitHub
(`read:user`, `github-auth.ts`), and the callback only starts a 30-day session (`ek_me` cookie, `sessions.ts`) and lands
on `/me?link=<code>` (v6.1.6, security H1: a sent link plus one click no longer links a stranger's agent). There a banner
names the agent and its first-seen day; Link this agent (`POST /me/link`, session and csrf) marks the code used and
links the installation in one transaction (`consumeLinkCode`), Not me ends the code (`denyLinkCode`). The first `find`
after a link (its `linked_at` later than its `last_find_at`) ends the closing block with "This agent is now linked to
GitHub account {login}." (`linked_notice`, security M2); `markFind` moves `last_find_at`, so it shows once. An unlink on
/me (`unlinkInstallation`) sets `installations.unlinked_at`; the next `find` of that agent (match or open list) ends with
"This agent was unlinked from your account. Sign in once at {link} to link it again." in place of the sign-in sentence,
and clears the mark once that reply is built (`takeUnlinkedNotice`, v6.1.7 B10; a find that throws first keeps it). The unlinked agent's ledger stays with the builder; its live claims there are released in the same transaction, and its later sends land in its own `i:` ledger (L13-2, v6.1.14). The unlink takes the ledger's per-program lock on those claims, and `record` (every agent status; a screen outcome passes `fromScreen`) and `claim` read the installation FOR SHARE under that lock (`stillLinked`: a `b:` owner needs the row linked to that builder, an `i:` owner must be the writing installation), so a call in flight lands before the unlink or answers `UNLINKED_MEANWHILE` (T5-F4, fix round 2). The ledger's owner is `b:<builder>` once linked, else `i:<installation>` (`ownerKey`); linking moves
the installation's rows to the builder, so every agent of one builder shares one ledger. Where both ledgers hold a
program, the migration never downgrades (v6.1.8 B15): a result beats applied, which beats a claim or a skip; among
results won beats rejected beats no_result whatever the time, so a relink never loses a win (v6.1.9 N3); of two equal statuses the newer `at` stays; the losing row is dropped (history is all kept). Deleting
the account (`deleteBuilder`) marks each linked installation (`unlinked_at`, `unlinked_reason = 'deleted'`), so its
next `find`, `record` or `track` call (v6.1.9) says "Your record was deleted at earnkit.com/me; this agent is unlinked." once (C51). A
find with no project stamps `last_find_at` too, so the linked notice shows once (C47). Linked, that open list carries the report a project find would (the since line, the answers waiting again, "Applied under your standing approval: ...") in its closing block, so the stamp never swallows it. A second agent links to the same builder; an installation linked to another builder is refused.

**The record and approvals.** One JSON record per builder (`record.ts`, strict): person, team, company, projects
(several, each with its own answers), docs (links only), traction, the answer bank and the policy, with `meta[path] =
{ set_by, set_at, approved_at? }`. `mergeRecord` drops each bad leaf with a problem line, never the patch. An agent's
change to an approvable path (answers, project answers, the pre-launch traction line, raised) drops its approval;
only the builder approves, on `/me` (`approvePath`), and `answerFor` returns only approved text, so an unapproved
answer is never fitted into a form. `policy` (standing approval: `auto_apply`, `max_per_night`, `categories`,
`max_ask_usd`, `never`, `agent_may_submit`) is the builder's only. Writes go through `withRecord` (row lock).

The short form (v6.1.8 B16, B17): an answer's `short` is a cut of its `text` that fields under 300 characters carry.
`/me` shows it under the answer ("Short form, for fields under 300 characters."), pending and approved, and approving
the answer approves both (one path). A new text drops the old short unless a new one comes with it, so the builder's
edit on `/me` leaves no approved short behind; `record brief` tells the agent to redraft it. `prefill` uses a short only
through `answerFor`, so never without its approved text. A record value longer than the field's `max_chars` is marked
`fit: 'cut'` with `fit_note` "Cut to {n} characters, keeping the meaning." (C42). An agent's change that drops an
approval stamps `meta[path].unapproved_at`; the next find of the builder's agents says "{n} answers wait for your
approval again at earnkit.com/me." (C48). Project answers are used only for the record project matched by
`project_id`, repo or name; with none matched, none, and the agent note asks for `project_id` (C41). The team list
shows on `/me` under About you, a name and role per member, editable through `/me/edit` paths `team.{i}.name|role`
(B19).

Standing approval at record time (v6.1.8 B18): `track applied` with `submitted_by: 'agent'` is `auto_applied` only
when the policy covered it at that moment: `auto_apply` on, the program not in person, not builder-only,
`agent_may_submit` on, its category ticked (none ticked reads as all), the larger of its award and pool within
`max_ask_usd`, and (counted in `ledger.record` under an owner lock) fewer than `max_per_night` auto-applied rows sent in
the last 24 hours, and the program not closed more than an hour before the send (`CLOSED_GRACE_MS`, checked in
`ledger.record`: such a send is recorded as not, and track's reason is "it had closed"; F8, v6.1.12). The count reads `applications.sent_at` (v6.1.9 N2): set on `applied`, never rewritten by a result,
so recording an old win today uses none of tonight's limit; a row from before it has none and counts by `at`
(`autoSentSince`). Find's tonight list subtracts the same count: none left, the closing reads "Tonight's limit is used;
the next sends wait until tomorrow." (N1). With sends tonight, the steps block reads "Tonight's send goes ahead. These
would add {n} more: ..." (N4). `gap_done` on a code-checked item (chain, contract_on, builder_codes, live_product,
integration) answers "Tracked. I check the repo on the next look." (on a project with no repo, its key a name or
none: "Tracked. Tell me when it is live and I look again.", F6 v6.1.12; Tracked since v6.1.15 #8) and, while the read still misses it, the next find
adds "I looked again and did not find {what}; it stays a step." after that program's line; any other item is the
builder's word, answers "Tracked." and counts done (N-5). Otherwise the row is recorded with `auto_applied: false` and the builder line reads "Sent, but outside
your standing approval: {reason}." (`outsideApproval` in `find-record.ts`). The required-answer rule (v6.1.9 S6): within
every limit, a send under standing approval also needs every required field of the program's form in `fields_used`
(`requiredLeftOut`); one left out (or no `fields_used`) is recorded the same way with "a required answer was missing",
and so is a send whose form has a required field EarnKit cannot vouch for, whatever keys `fields_used` names (the
vouched-field rule, v6.1.10 F1: one helper, `unvouchedRequired(fields)` in `prefill.ts`, returns every required `builder`
field without a value and every `agent` field with no sources, judged by `from`, value and sources only; find's
`need_you` and tonight list read it, and track's `unvouchedAtSend` runs it over the program prefilled with the stored
record and the send's project, merged as find merges (v6.1.13, Task 1 review I1 and I2: `sendFacts` in `track.ts`):
the project the owner's last find reported (`project_reports`, written by every find with a project under its key and,
with a repo, its name key too; read under the send's resolved key, then its name key; `saveReport`/`reportOf` in
`ledger.ts`; rows no find updated for 180 days go in the cron's sweep, `sweepReports`), then the send's parsed project on top (its chains added, never removing one),
the name and links falling back to the record project's and the last find's key; then that repo's cached read
(`cachedRepoFacts`, no fetch), else the report alone through find's own merge (`reportOnlyFacts` in `repo-facts.ts`),
so reported contracts, Builder Codes and commit dates count; `sendCheck` is the one path production and
`unvouchedAtSend` share),
and find's standing note says "Under standing approval, send only when every required answer is filled; otherwise wait
for the builder." The ready-at-send rule (v6.1.13 B2): with every required answer vouched, the send counts as under
standing approval only when the program's verdict for that project is ready at send time: find's `evaluate` and gate
(`readyAtSend` and `storedSide` in `find-record.ts`: the stored tier, no evidence read) over the same facts, with the
owner's done steps and confirmed rules on that project; a closed program is judged as it stood at its close (F8 then
decides). A gap, a rule left to confirm, a bar not met or not a fit is recorded with "it was still a step away".
v6.1.14 L13-6: a program not yet open (`status: upcoming`) is recorded outside it with "it has not opened yet"
(`NOT_OPENED`). L13-7: a linked find with a project stamps `installations.last_find_auto` (`markFindAuto`); an
agent's send after the builder turned standing approval off since that find reads "Sent, but outside your standing
approval: it was off." (`APPROVAL_OFF`, `findAutoWas`); the builder's own submit, or a find that saw it off, keeps
the plain line. L12-4: track reads its arguments with find's `readLoosely`, so a null project is the last find's
project (its done step lands under `last_project_key`), a string one is dropped and named, a numeric id is its text.
`fields_used` keeps its first 200 keys, each cut to 60, and is never refused (B6): the form already went out. Find holds the same line: a ready program with a required builder answer still empty leaves the
tonight list and is named in its own block, "Before tonight (nothing is sent until these are in): your {answers} for
{titles}." (no tonight line when nothing can go). A contract the read still does not find adds "Pass the contract
address if it is on chain." to the agent note. A send that does count as under standing approval puts the installation's `last_find_at` back to
`prev_find_at` (`unmarkNightFind`): the find before it was the night routine's, so the morning find still reports every
overnight send (a builder's daytime find followed by an in-chat send repeats its since line once; a night with no
sends still takes the report). `applied` after the program closed is recorded with "{title} closed on {day}; recorded anyway.";
`applied` as the first call after the account was deleted answers the deleted notice alone and writes nothing;
`started` on an in-person or builder-only program tells the agent "The builder presses submit; prepare the answers and
hand them over." A rule the builder confirmed marks the ready program `rule_yes` (so does the users yes, `gap_done users` only,
on a program that asks it; F3, v6.1.10; a `users: true` the agent passed settles the users item but is no yes, final round), and the closing reads "Your yes stands
for {title}: I apply now." instead of asking again, only when that program is fully ready (nothing in `need_you`);
with answers still missing, the closing names them instead of a second yes: "{title} needs your {needs}; then I
apply." (at most three, then "and n more"; N3, v6.1.12), and any other ready programs keep their yes. A program the
builder submits reads the same in the draft wording (L1e-3, v6.1.13; list and detail alike): "Your yes stands for
{title}: I draft it for you to send." and "{title} needs your {needs}; then I draft it for you to send.". A program
that funds existing code (`needs_repo`, existing work allowed, not a hackathon or in person) is one step, `code in a
repo` (`NEEDS_CODE`, item `repo`, re-checked by the read), from a project with no repo link or an
empty repo, whatever live site it has (L16-8, v6.1.16; a repo reported private is a repo, its step `PUBLIC_REPO`) (L1e-6, fix round 1 T3-R1: FUTO is an idea's one remote step); when that is the step program's only change,
the closing is "Tell me when the code is in a repo and I look again." and the detail's action the same (L1f-2,
v6.1.14: no rule yes before the code exists; the rule closing reads "if that rule fits you" everywhere). v6.1.14 L1f-1:
a program file with `open_source: true` (its rule is an open source license or open source software; `programs:check`
wants a rule naming it) is never ready for a private repo (the report's `private`, carried as `RepoFacts.private`, or the
`private` note): its gap is `a public repo` (`PUBLIC_REPO`, item `repo:public`, setup `make the repo public`). L1f-3: an
archived repo, for a program that wants the code or its users (`needs_repo`, a users item or a used bar), gets `the repo
is archived` (`ARCHIVED_REPO`, item `repo:archived`, setup `tell me the live repo`) and never the users question. A gap's
`setup` leads the line's "First:" (find's `gapOf` puts it before the program's setup) and is the closing's step.
v6.1.16 (L1g-5): every single step closes in one shape, `Tell me when {step} and I look again.` (`singleStepClosing`,
the step from `stepClause`: "the code is in a repo", "the repo is public", "the contract is on {Chain}[ mainnet]", "the
live link is up", "the demo video is ready", "you {setup}"; a telling setup reads "Tell me the live repo and I look
again."), the same in the list closing ("Nothing is ready yet. " before it) and the one-program action; the started
question is "Tell me when you started and I check it."; fix round 1 gives the last three kinds their clause too (a
below-bar tier gap "people outside the team use it live", a feature "{feature} is in", a users gap of weeks "it has been
live for {n} weeks", or "real people use it" when no number is given); several real changes keep "Tell me when that is done and I
apply."; the archived repo note is left out when a shown line reads `the repo is archived`. A step the closing names is left off every line (fix round 1, I1: `closingSetup`, `gapLine`'s `closed`;
the one-program line keeps it), and the code closing is picked by the gap's kind (`FirstStep.code`, M3). A repo the
read itself finds private (`RepoPrivateError` from `github.ts`, fresh or on the cached row's re-check) is private, never
gone (M1); neither is closed by gap_done: the agent passes `private: false` or the live `repo_url` (`REPO_STEP_NOTE`).
track's started reply after a gap ends on the gap ("...one change away: {what}."). The email the
"Before applying" block names (`record_missing`) is named once per reply: the drafted line, the Before tonight line and
the N3 closing leave it out unless it is the only need (`namedBefore`, F5, v6.1.12). A new-work program (`new_work_after`) with no first-commit date is
the question step "tell me when you started this" (minutes, never the agent's, never a reason to refuse; O3, v6.1.10):
a later find with `first_commit_at` or `gap_done` with its item settles it. The no-project open list ends each
in-person line with ", in person" (O4). A find that passed a repo never lists "a project with its repo or site" in
`record_missing` (lane 8 #10), nor does one that passed a live link (N5, v6.1.12). `find { program_id }` and every
`track` resolve the name with one helper (`programByName` in `programs.ts`, F4 v6.1.12): the id as given, else, case,
spaces and punctuation ignored, the first tier any program fits: the whole id or title or the id's initials ("yc",
"ycombinator"); the start of a title or id, four characters at least ("monad", "Base", "kiro"); one organizer's whole
name, as written or without its brackets ("Thiel Foundation", "Kiro"; never "aws" from "Kiro (AWS)"). A start that is
an organizer's first word alone, not its whole name ("ethereum", "thiel", "circle", "floss"), is weighed beside that
organizer's other programs (final fix, v6.1.12, I2): exactly one is that program ("floss", "thiel"; L1e-1, v6.1.13),
several ask ("circle"). Else (L12-3, L12-5, v6.1.14) every word of the name, stopwords (`the`, `program`, `grant`,
`grants`, `fund` and the like) and four-digit years dropped while another word is left, must be among one program's
id, title and organizer words, brackets included ("paypal hackathon", "thiel fellowship 2027", "zerodha" for
"FLOSS/fund (Zerodha)"); a single typed word under four characters names none ("aws"); beside another typed word a
short word names an id or title word or the id's initials, never an organizer's ("arc grants" asks the Arc programs,
"yc batch" is Y Combinator; fix round 1, T7-F3); only stopwords, years or "foundation" name none (T7-F4). One program fitting is used, and when it is not the id
passed, track's and the detail's first line names it ("Started: {title}.", "Tracked: {title}."; `namedFirst`); several answer "Did you mean {title one} or {title two}?" alone (L1e-1, v6.1.13) (the first two by `byLookupRank`: open, then upcoming, then the rest; larger award; sooner close);
none, "I don't know that program." alone (a word naming no program is never a guess from the others: "Combinator Labs", "base-nope"; L12-3). Track records nothing on such a name; a result on an id the ledger
holds as sent is that id, before any matching (final fix, v6.1.12). Find's record line reads "Still missing for
these programs: ..." (what these forms need); `record get` keeps "Your record is missing: ..." (every fact), and both
`record get` and `set` carry an agent note. `/me/policy` refuses auto apply with no
category ticked ("Pick at least one category.", C43).

**The four tools** (`lib/v5/mcp.ts`):

| Tool | Does now |
|---|---|
| `find` | As v5, plus on a linked installation: the project picked from the record, fields filled from the record first (approved answers, facts), then the repo, then the agent; the builder's own tier read at most once a day (`own-evidence.ts`), `min_tier` gating, the policy's filters, blockers (sign-in, needs a click), what the record still lacks, and what was applied overnight. Unlinked: the sign-in line. |
| `track` | As v5, plus `started` (a claim) and `unskip`; `applied` carries `submitted_by` and `fields_used`; `auto_applied` only for an agent's submission under standing approval. |
| `record` | `get`, `set` (merged as the agent, never approved), `brief` (the question and facts behind one answer kind, `answer-brief.ts`). Unlinked: the sign-in link. |
| `screen` | A program's reviewer only: queue an applicant list, read the results by `job_id`, record `outcomes`. An applicant's old `repo` key, as text, reads as `repo_url` when that is not given (v6.1.14 T6); a `repo` that is not text is refused by that key. A find with `program_id` carries `linked` too (F3). |

**The claim rule.** Before filling, the agent tracks `started` (`claims.ts`): one claim per owner and program (an
advisory lock); another agent of the same builder within 24 hours gets `already` with the claiming agent's name; a
claim with no `applied` after 24 hours is released. A skip stands over a claim. An `applied` from another agent of the
owner while the claim is live writes nothing and answers "Your other agent is handling that one; nothing recorded."
(v6.1.13 B3, `OTHER_AGENT_HOLDS` in `ledger.ts`); the holder's own send is unchanged.

**The screen queue and the cron trigger.** `screen` (`screen-tool.ts`) is for a reviewer: a signed-in builder the
owner adds with `POST /api/programs/reviewers`. With `applicants` (up to 200; over that, or over 200 outcomes, one line:
"At most 200 at a time; send the rest in another call.", C2 v6.1.13) it queues a job (`screen-jobs.ts
createJob`: an applicant repeated exactly is kept once (Low 18, v6.1.13), pitches compared for `identical_pitch`, then dropped; 10 jobs a day per reviewer; thresholds in their own ranges, `RATIO_THRESHOLDS` from 0 to 1 and the rest whole
numbers from 0, L15-10 v6.1.14). L15-4, L15-22, L15-23 (v6.1.14): applicant keys the screen does not read are named in
the agent note ("Unknown applicant fields ignored: github, website."); `mergeApplicants` merges one ref given twice
(different EarnKit ids: the later renamed and named) and one repo under two refs when both carry the same id or none
and their sites (`live_url`, parsed and lower-cased) agree or one is missing (else kept and named: `sameRepo` for the
ids, `siteApart` for the sites, L16-5 v6.1.16); `createJob` returns `notes` with these and "Contracts left out, not
read: solana (r-3)." Repo links on GitLab, Bitbucket, Codeberg and SSH forms (`sshAsHttps`) are kept as `repo_url` with
no `repo_key`. v6.1.16 L16-13, L16-8: a repo link off a code host, or a shortened repo or site link, is not stored and
`createJob` returns it in `dropped` ("repo_url dropped: not a code host (r-1)", "live_url dropped: a shortened link
(r-2)"), which the queue's agent note names beside the unknown fields (with `SHORT_LINK_NOTE` for a shortened one). The promise is computed from the queue (v6.1.7 B14): the unread applicants of unexpired jobs created before this
one (`queuedAhead`) plus this job's, against `SCREEN_BATCH` per daily run: "Results come in daily runs; the first by tomorrow morning." when they fit
in one run, else "Results come in daily runs; {n} applicants ahead of yours, all within {d} days." (L15-13). The cron's `workQueue`
(`screen-worker.ts`) takes each applicant atomically (`reading`, free again after 30 minutes), reads it as the pilot
does (a GitHub budget stop puts it back and ends the run; a tierless read worth a retry is queued again, `failed` at
the third) and stores tier, flags, because, line and public rows only (`github`, `explorer`, `site`, `earnkit`, never
`record`). The daily cron gives the queue 300 s at most, cut to its run's deadline (v6.1.16 Task 16): `workQueue`
returns `read` and `left` (the share not reached when it stopped) and each job stores `last_run_read` and
`last_run_left`; while a job's `last_run_left` is over 0 its results line adds "{n} of {m} read today; the rest
tomorrow." (read so far, the job's total); `POST /api/cron` with `{ "job_id": "..." }` is the owner's trigger
(that job only, at most 300 applicants in 600 s). With `job_id` the tool answers the totals line and the results;
with `outcomes` it records the program's decisions (refs not in the job are named; L15-15, L15-16 v6.1.14: a win's
amount is `amount_usd` or `amount` with a currency code, cents allowed (`amountOf`); an unreadable amount or a US dollar
win over the cap refuses only that applicant, "Tell me the amount for {ref}." / "That is more than this program pays
for {ref}; check the amount.", the rest recorded; a dot used as a thousands separator ("2.500", `amountOf` answers
`'ambiguous'`) reads "Amount not read: use a dot only for cents, no thousands separator." once, the refs in the agent
note (L16-14, v6.1.16); US dollars reach the ledger rounded down with the note "rounded down
to whole dollars from $2,500.50", another currency as a win with no amount and the note "amount in EUR, not
converted"; `screen_outcomes.amount_given` and `currency` keep what was given), which also reach a builder's ledger only through the
applicant row's `application_id`: the id `track started` answered the builder's agent with a note to put it in the
form's reference field (`applications.application_id`, issued by `claims.claim`, kept by the send, carried on a link
merge), for this program; never by repo or site (L13-1, T5-F1 v6.1.14). An id on more than one applicant of the
program (any other row in any screen of it, expired too; facts and refs never make two rows one applicant) is
ambiguous and reaches no ledger (T5-F3). A row is not live only when a later row's `requeue: { job_id, ref }` names it
exactly; `badRequeues` refuses the whole list when the named row is not in a screen of the same program with the same
id (or the requeued row has none), so a copied id always clashes (Task 8 security follow-up, v6.1.14); an earlier row a
requeue names is answered as superseded. The row must also be the application's own project (FR-3, final fix): the
same canonical repo key when the application has one (SSH links read as https; a row with no repo or another repo is
another project), else the folded name; the application's project is
its `project_id` (a repo key, a `name:` key, or a project of its builder's record; a send with no `project_id` keeps
its project key, as a claim does). Otherwise the result stays on the screen row and the note says the id belongs to
another project, or that the application names no project to match. Jobs and outcomes belong to the program (L15-12): `jobStatus`, `jobResults`
and `recordOutcomes` take any reviewer marked on the job's program (`program_reviewers`), so a colleague reads,
continues and requeues the program's rows; `deleteBuilder` leaves them, `screen_jobs.builder_id` set to NULL (L15-18).
An outcome on the reviewer's own application (owner `b:` the reviewer, or `i:` an installation linked to them) is not
written and the owner hears "You applied to this one; another reviewer posts its result." (L15-1, Review Focus 10);
the rest of the batch goes on. A win marked a further payment (`payment: { key }`) adds to the screen's and the
ledger's total once per key (`screen_outcomes.payment_keys`; a retry whose key the screen already kept still goes to
the ledger with the same `s:` key, a no-op once written, so a ledger write that failed is delivered once, FR-4); a total over the program's cap writes nothing and the
owner hears the over-cap line naming the ref (T8-F3, L15-16); unmarked, another amount replaces the first in both (T8-F1).
Results come 25 applicants a page (`PAGE_SIZE`, `page` from 1); pages follow the queued order (`screen_applicants.seq`)
with pending rows in place, sorted by tier only inside a page, so a read landing between pages moves no row (T8-F2);
the totals line ends "Ask for page {n} for the rest." and the reply carries `next_page`, null on the last (L15-3).
Rows read
before v6.1.14 may carry the old cross-program `xp.*` values until they expire (now 180 days, `KEEP_DAYS`, L15-14; T8-F4 accepted). The CSV path reads an
`application_id` column too (T5-F2). A row without one is named in the note as "Not matched to an
EarnKit application"; a win with no amount is passed on as a win with none (`amount not given`, L13-13); a second
outcome replaces the first only when not older, and the note names what it replaced (L13-12; an earlier win in another
currency as given, "(was won EUR 2,500)", L16-4). v6.1.16: a further payment over no kept win (`none`, `rejected`,
`shortlisted`) writes nothing and the show line adds "Further payment refused: the current result is {status}; post a
win first." (L16-1); a payment key retry or the outcome kept already is a repeat, never counted as recorded, whatever the
ledger answers (FR-4 still delivers it, silently), and a call of repeats only reads "Already recorded; nothing new." (L16-16; after a further payment the kept `amount_given` is the total, so a resend of the total repeats, fix round 1 M2); an id's ambiguity
counts only rows of the application's own project (L16-3). `recordOutcomes` returns `passed` (outcomes a ledger holds)
and `reasons`/`notPassed` in `NOT_PASSED` words; the agent note leads "Tell the builder the outcomes are recorded."
only when one passed, else "Nothing reached a builder: {ref}: {why} ..." (L16-9), and the show line names each
recorded outcome the screen held back: "Recorded {n} outcome(s); not passed to a builder: {ref} ({why})." (L22-11).
Fix round 1 (C1): the reviewer never learns a builder's own record. `paymentRefused` comes only from the screen's own
refusal; any refusal from `ledger.record` is one generic "Not passed on; the builder's record stands." (refs in the
agent note, `stands`), its detail (owner, program, note, current result) in a `[screen] ledger refused` server log line.
A page past the last reads "{totals} No more results." (L16-12). `xpCounts` gives each read the program's own earlier screens in 90 days sharing the repo
or a deployer and the outcomes it reported ("seen in n earlier screens of this program in 90 days", never a flag);
another program's screens and outcomes are never counted or shown (L15-11 v6.1.14, as the terms say). Marking a
reviewer again without a contact keeps the saved one (L15-2).

**/me.** `proxy.ts` sends a visitor without a live session to `/docs#record` (302, `me-routes.ts meGet`).
`app/me/page.tsx` renders `meData` (`me-view.ts`) through `MeView.tsx`: pending approvals first, then one panel per
block in builder words (no path is shown), standing approval, applications, linked agents (Unlink) and delete last.
Plain HTML forms, no client script. Every POST (`/me/edit`, `approve`, `policy`, `unlink`, `delete`, `signout`)
needs a web form under 64 KB (else 415 or 413), a session and the day's csrf token (an HMAC of the builder id, the
session cookie's value and the UTC day with `EARNKIT_AUTH_SECRET`, today's or yesterday's; another session's token
fails). No session is a 403 with the sign-in line; a failed csrf check is a 303 to `/me` with the signed line "This
page expired. Reload it and try again." and no change. Edits merge as the builder under
the row lock; a problem comes back as a signed `?problem=` line (a crafted one is not shown).

/me problem lines are plain words: `wordsOf` (`me-routes.ts`) maps each checker code to `ME_VALUE_WORDS` ("at most
{n} characters", "pick one of the options", "a link starting with https://", "an email address", a number range,
or the field's own pattern words such as "two capital letters, like US") after the label the page shows
(`ME_LABELS`); no field path or checker sentence reaches the builder. A standing-approval save checks every field and
saves nothing unless all hold, one line per bad field. Every line after a post is signed with `problemSig`: an HMAC
of its key (problem or note), the builder id, the UTC day and the line, so /me shows it only to that builder, only
as the kind it was written as, and only that day or the next. Delete needs the login
typed and removes the record, the ledger, sessions, reviewer rows, screen jobs with their applicants and outcomes, and
link codes, and unlinks the installations, in one transaction.
`/me`, `/link/*` and `/auth/*` send `X-Robots-Tag: noindex` and are not in the sitemap.

**/me and link states (v6.1.16, Task 7).** /me's applications card leads with the find reply's own counts
(`ledgerCounts` in `ledger.ts`, shared by `replyText`), and each row is a sentence: "Won $5,000, Nov 11.", "Won $3,500
in all, Nov 11." when a further payment came after the last correction, the current amount after a correction
(Review Focus 9). The ?link= banner has a title per state (`Link an agent to this account?`, `Linked.`, `Not linked.`,
`This link has expired.`, `This link is not one of ours.`; `codeState` tells a code EarnKit never made from one that
ended), and /link/<code> uses the same two dead-code lines. Signed out, `/me?link=<code>` goes to `/link/<code>`. Edits
and the standing approval come back with a signed `Saved.` shown beside the control (`at` names it); an unlink says
`Unlinked {agent}.` (an unnamed agent is "An agent linked Nov 6"), another builder's agent `That agent is not on your
account.`; a delete lands on `/?deleted=1` ("Your account is deleted.", client side, the home page stays static).
Projects the sent applications name (claims not counted) that the record does not hold are listed read-only; a reviewer sees one line per
program. With a linked agent the page carries `data-me-linked` and the header and footer drop the install pill.

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
