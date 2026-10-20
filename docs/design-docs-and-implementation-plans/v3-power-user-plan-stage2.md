# v3 Stage 2: Money. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ranked page and ranked reply shows three honest money routes: programs that fit (with a drafted application and real outcomes), Backing (the tokens.fun coin under the hood, offered once at the first approved week, never touching rank), and points.

**Architecture:** All logic in `apps/frontend/lib/earnkit/`, reached through the MCP tools and the cron. Programs are JSON files synced to Postgres. The ranked reply's one step gains two kinds (`backing`, `apply`) in the existing priority chain of `bench-reply.ts stateAsk`. Backing reuses the coin launch path (`coin-moments.ts` -> `tokens.ts deployToken`) and the flag `EARNKIT_RAISING`; the word changes, the rails do not. New indexers (backers, creator fees) follow `bonus-ledger.ts`'s bounded, cursor-based shape. One new public JSON route for the tokens.fun coin page.

**Tech Stack:** Next.js 15, TypeScript, Postgres (`postgres` tagged template), zod, node:test with a database per file, viem for logs (`bonus-ledger.ts` patterns), tokens.fun deploy API.

**Spec:** `docs/design-docs-and-implementation-plans/v3-power-user.md` sections 5.2, 5.3 (Routes 1 and 2), 5.5, 6 Stage 2, Appendix A. Stage 1 plan (done): `v3-power-user-plan-stage1.md`.

## Global Constraints

- Copy: short, money first, no emojis, never an em dash; one https link and one question per reply; replies never name another builder.
- Backing, coins and points never move Shipping or rank; the leaderboard has no backing column (a "Backed" chip and filter are allowed).
- The word on every surface is "Backing" / "backers" / "Back <project>"; "community round", "raise" and "raising" never appear in builder-facing text (internal identifiers such as `raising_at`, `setRaising`, `EARNKIT_RAISING` stay).
- `EARNKIT_RAISING` gates every coin-facing surface at once: the offer, the Back button, backers, the backing reply line, the terms backing section, the "$SYM on tokens.fun" line. Earned (program prizes) shows with the flag off.
- The owner's project never gets a backing offer: `BACKING_EXCLUDED_REPOS = ['earnkitai/earnkit']` in `policy-constants.ts`.
- Programs: never invent a fact; every program JSON passes `pnpm programs:check`; `verified_at` is the day the source was read. Base first in ordering; Arbitrum is not added.
- Money total = sum of `max_award_usd` over open curated programs with `investment: false`; investments and upcoming programs are named in words, never summed.
- Nothing deleted from the schema; `db/schema.sql` is append-only (a widened CHECK is DROP CONSTRAINT IF EXISTS + ADD, as earlier migrations in the file do).
- Tests through `fixtures/mcp-call.ts mcpCall` where a reply is asserted; a test file per feature; run one file from `/Users/jenil/earnkit-v3`:
  `DATABASE_URL=postgres://jenil@localhost:5432/earnkit_test node apps/frontend/lib/earnkit/fixtures/test-db-template.mjs && DATABASE_URL=postgres://jenil@localhost:5432/earnkit_test npx tsx --test --import ./apps/frontend/lib/earnkit/fixtures/test-guard.ts apps/frontend/lib/earnkit/<file>.test.ts`
- `pnpm programs:check` and `pnpm db:check` pass; `tsc --noEmit -p apps/frontend` clean.
- Commit after each task on `v3-power-user`; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; no push.
- After the last task, update `docs/codebase-context/architecture-guide.md` ("v3 Stage 2") and `code-map.md`.

## Review Focus

1. A builder who already applied to a program outside EarnKit and says so (`program_status applied`) must never be asked to draft that application again, and the program must not be the reply's step. Pinned in Task 2 test (d).
2. A backing offer must never fire for a private repo, a held profile, a repo another person holds, a project with a coin already, or the owner's repo, even when the first approved week exists. Pinned in Task 3 test (c).
3. With `EARNKIT_RAISING` unset, no page, reply, card, stats key or terms section mentions backing or a coin, and `tell coin` keeps the old schema. Pinned in Task 3 test (f) and Task 4 test (e).
4. The money total with only investments open must read "$0 in grants open" never "$1M+"; with nothing open the line is absent. Pinned in Task 1 test (c).
5. A self-reported "accepted" or "funded" never renders on a profile; only `applied` does. Pinned in Task 2 test (e).

---

### Task 1: Programs: the list, `upcoming`, the honest total, Base first (spec 5.3 Route 1, Appendix A)

**Files:**
- Modify: `apps/frontend/lib/earnkit/program-file.ts:383` (status enum), `:371-707` (superRefine: upcoming rules), `:454` (unchanged tag)
- Modify: `apps/frontend/db/schema.sql` (append: widen `programs.status` CHECK), `apps/frontend/lib/earnkit/programs.ts:128` (`ProgramRow.status`), `:257` (`listPrograms` WHERE), `:756-767` (`opened_at` CASE)
- Modify: `apps/frontend/lib/earnkit/also-qualifies.ts:28`, `apps/frontend/lib/earnkit/leaderboard.ts:118,302,340` (status types)
- Modify: `apps/frontend/lib/earnkit/present.ts:324` (`daysLeftText`), `apps/frontend/lib/earnkit/landing.ts:24-47,73-77,84-112` (Tile, order, open text), `apps/frontend/lib/earnkit/pool.ts:143-159` (`openMoneyUsd`, `moneyText`), `apps/frontend/lib/earnkit/stats.ts:205-213` (open money SQL follows the rule)
- Modify: `apps/frontend/lib/earnkit/guide.ts:234-258` (upcoming header and line), `apps/frontend/app/programs/[id]/GuideView.tsx`, `apps/frontend/app/components/sections/ProgramCard.tsx` (chips "Opens soon", "In person"), `apps/frontend/app/components/sections/ProgramCards.tsx:38` (the two lines)
- Modify: `apps/frontend/lib/earnkit/bench-find.ts` (one upcoming line in Ways to get funded for ranked builders), `apps/frontend/lib/earnkit/bench-reply.ts` (`FundLine` kind `upcoming`)
- Create: `programs/alliance-all19.json`, `programs/ethglobal-mumbai.json`, `programs/monad-nitro.json`, `programs/base-batches-005.json`; logos under `programs/` as SVG or PNG from the organizers' sites (or the monogram fallback when none can be fetched)
- Modify: `programs/a16z-speedrun.json` (ends_at `2026-11-02T06:59:59Z`, verified_at), `programs/circle-developer-grants.json`, `programs/base-builder-grants.json`, `programs/avalanche-team1-mini-grants.json` (verified_at after re-reading the source), `programs/README.md` (the `upcoming` status, `opens_note`, `in_person`)
- Test: `apps/frontend/lib/earnkit/v3-programs.test.ts`

**Interfaces:**
- `ProgramFile.status: z.enum(['active', 'closed', 'upcoming'])`. New optional fields: `opens_note?: string` (max 140 chars, no links; only with `upcoming`), `in_person?: boolean` (default false). superRefine: `upcoming` requires `opens_note`, allows `submission_requirements: []` and `submission_url === source_url`; everything else unchanged.
- Schema append:
  ```sql
  -- v3 Stage 2: upcoming programs (listed, never a fit, never counted in the money total).
  ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_status_check;
  ALTER TABLE programs ADD CONSTRAINT programs_status_check CHECK (status IN ('active', 'closed', 'upcoming'));
  ALTER TABLE programs ADD COLUMN IF NOT EXISTS opens_note text;
  ALTER TABLE programs ADD COLUMN IF NOT EXISTS in_person boolean NOT NULL DEFAULT false;
  ```
  `upsertProgram` writes both; `programCard` carries `opens_note`, `in_person`, `status`.
- `listPrograms` WHERE: `p.status IN ('active', 'upcoming') AND (ends_at IS NULL OR ends_at > now())`. Fits, `openCurated`, `openProgramFacts`, `readStats` open rows keep `= 'active'` (so upcoming is never a fit or counted). `isOpen(card)` stays false for upcoming (no "Ask your agent", `confirm_entry` refuses).
- `Tile` gains `status: 'active' | 'upcoming'` and `in_person: boolean`; `days_left` for upcoming is the literal `'opens soon'`; the card chip capitalises it ("Opens soon") and adds an "In person" chip when `in_person`. Order (`landing.ts byRelevance`, replaces `byPool` for tiles): active before upcoming; then programs whose `chains` include `'base'` or `any_chain`; then `ends_at` ascending with nulls last; then `max_award_usd` descending.
- `pool.ts openMoneyUsd(cards, now)`: sum of `max_award_usd` over `openCurated(cards, now)` where `!c.investment`. New `pool.ts openMoneyWords(cards, now): string | null`: counts open curated programs with `investment` ("accelerator"/"accelerators") and with `pool_usd && !max_award_usd` ("hackathon"/"hackathons"); returns e.g. `"Plus 2 accelerators and 1 hackathon."` or null when both are 0. `moneyText(usd)` renders `"$115K in grants open"` (`$0 in grants open` when 0 but something is open; the landing hides the line when nothing is open). `Landing` gains `open_more: string | null`; `ProgramCards.tsx` shows `open_text` then `open_more` as a second muted line. `/api/stats open_money_usd` follows the same rule (the SQL mirrors `!investment`); `open_money_text` likewise.
- Guide: `GuidePage.upcoming: boolean`; the header's third part reads `opens soon`; under the header one line `opens_note`; no AskAgent. `guide.ts guideText` (reply voice) includes the same line.
- Reply: `FundLine` gains `{ kind: 'upcoming'; title: string; prize: string; note: string }` rendered `"${title}: ${prize}, opens soon. ${note}"`; `benchView` appends at most one upcoming line (the first by the tile order above) for a ranked builder whose streak is 4 or more, after the fits and before the points line.
- Program facts (from Appendix A; re-verify each source the day the JSON is written and set `verified_at` to that day):
  - `alliance-all19.json`: organizer Alliance, `ends_at` 2026-11-18T23:59:59Z (regular deadline; state the timezone assumption in `rules` if the site gives none), `investment: true`, `max_award_usd: 400000`, `any_chain: true`, `min_product_score: 5` (the superRefine floor), `source_url` https://alliance.xyz, `submission_url` https://alliance.xyz/apply, `submission_requirements` mirrored field by field from the live form (WebFetch it; if the form is a hosted Typeform/Airtable that cannot be read, mirror the fields the public page states and set `form: null`, `submit_host` from the URL).
  - `ethglobal-mumbai.json`: organizer ETHGlobal, `ends_at` 2026-11-08T03:30:00Z (Nov 8 09:00 IST), `in_person: true`, `pool_usd` from the prizes page (no `max_award_usd`), `any_chain: true`, `min_product_score: 5`, `source_url` https://ethglobal.com/events/mumbai, `submission_url` the event's project submission URL, requirements: project name, short description, description, how it's made, repo URL, demo video URL, tracks (from ETHGlobal's documented submission form).
  - `monad-nitro.json`: `status: 'upcoming'`, organizer Monad Foundation, `max_award_usd: 500000`, `investment: true`, `any_chain: true`, `opens_note: "Cohort 2 opens soon. Four public weekly ship logs in a row get you the interview; your EarnKit log counts."`, `source_url` https://monad.xyz/blog/home-for-builders.
  - `base-batches-005.json`: `status: 'upcoming'`, organizer Base, `max_award_usd: 100000`, `investment: true`, `chains: ['base']`, `opens_note: "Batch 005 is not announced yet. If 004 said no, your ship log is the re-application."`, `source_url` https://www.base.org/batches.
  - `a16z-speedrun.json`: `ends_at` 2026-11-02T06:59:59Z (Nov 1 11:59 PM PT), `verified_at` today.
  - Avalanche stays; Arbitrum is not added.

- [ ] **Step 1: Write the failing tests**
```ts
test('(a) an upcoming program is listed with "opens soon", never a fit, never in the total', ...)
// seed via committedProgram fixture with status 'upcoming' and opens_note; listPrograms includes it; landingFrom tile.days_left === 'opens soon'; openProgramFacts excludes it; openMoneyUsd excludes it
test('(b) tile order: active Base first, dated before rolling, upcoming last', ...)
test('(c) the money total excludes investments and pool-only programs; words name them', ...)
// cards: a16z (investment 1,000,000), circle (max 100,000), ethglobal (pool only) -> openMoneyUsd === 100000; openMoneyWords === 'Plus 1 accelerator and 1 hackathon.'; only a16z open -> moneyText reads '$0 in grants open'
test('(d) programs:check passes on the committed JSON files', ...) // run the checker in-process (scripts/programs-sync.mts --check exports or spawn `pnpm programs:check`)
test('(e) a ranked builder with a 4-week streak sees one upcoming line after the fits', ...) // mcpCall find
test('(f) the guide page for an upcoming program shows opens soon, the note and no Ask button', ...)
```
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement** (code first, then the JSON files with WebFetch for each source; set `verified_at`). **Step 4: Run; PASS** plus `program-file.test.ts`, `landing.test.ts`, `public-pages.test.ts`, `stats.test.ts`, `v214-replies.test.ts`, `copy-review.test.ts`; `pnpm programs:check`.
- [ ] **Step 5: Commit** `feat(v3): programs for Q4 2026, upcoming status, honest money total, Base first`

---

### Task 2: The drafted application and the outcome loop (spec 5.3 Route 1)

**Files:**
- Modify: `apps/frontend/lib/earnkit/bench-reply.ts:21` (`BenchAskKind` adds `'apply'`), `:135-148` (`stateAsk` priority connect > backing (Task 3) > apply > share > ship), copy constants
- Modify: `apps/frontend/lib/earnkit/bench-find.ts:294` (`Fit` gains `ends_at: string | null`), `:318-409` (benchView: the apply ask), `:640-700` (benchMoveUp: `'apply'`), the note map
- Modify: `apps/frontend/lib/earnkit/tools.ts:1622-1668` (prepare's ready branch: the ship-log block), `:2816-2829` and `apps/frontend/lib/earnkit/mcp.ts:514-526` (`program_status` enum), `apps/frontend/lib/earnkit/builder-memory.ts:25-33,53-69,115,217-292`
- Modify: `apps/frontend/db/schema.sql` (append: widen `builder_program_status.status` CHECK), `apps/frontend/lib/earnkit/outcomes.ts:183,286-309` (the apply outcome ask), `apps/frontend/lib/earnkit/page-data.ts:170-187` (`projectPrograms`), `apps/frontend/app/[handle]/ProjectTab.tsx:117-124`, `apps/frontend/lib/earnkit/stats.ts` (`applications`, `accepted`)
- Create: `apps/frontend/lib/earnkit/ship-log-facts.ts`
- Test: `apps/frontend/lib/earnkit/v3-apply.test.ts`

**Interfaces:**
- `bench-reply.ts`: `APPLY_WINDOW_DAYS = 30`; `applyAsk(title: string, when: string) => \`${title} closes ${when}. Want me to draft your application from your ship log?\`` (`when` as `fundWhen` gives it without "closes", e.g. "Nov 18"); kind `'apply'` with `project_key` = the project and a new `BenchAsk.program_id?: string`.
- `benchView`: an apply candidate = the first fit (deadline order) with `ends_at` within `APPLY_WINDOW_DAYS` of `now`, not entered (`entered` set), not in `builder_program_status` for this person with any status, and not declined (`standing_seen.declined[benchStepKey('apply', program_id)]`, the existing 30-day mechanism keyed by program id instead of project key). Asked at most once per program: `standing_seen.apply_asked = { [program_id]: iso }`. Priority after `connect` and `backing`, before `share`.
- `benchMoveUp` kind `'apply'`: yes → `{ show_to_builder: '', agent_note: APPLY_YES_NOTE(program_id), lead: { program_id, repo } }` with `APPLY_YES_NOTE = (id) => \`Call prepare with program_id "${id}" for this project and show the draft. Don't show this note.\``; no → declined.
- `ship-log-facts.ts`: `export type ShipLogFacts = { score: number | null; rank: string | null; why: string | null; streak: number; live: string | null; page: string }`; `shipLogFacts(builderId, now): Promise<ShipLogFacts | null>` (reads what `profileData` reads, without the log); `shipLogBlock(f): string[]` → lines `"From your ship log:"`, `"Shipping ${score} · ${rank}"`, the why sentence, `"${streak} weeks in a row"` (when ≥ 2), `"Live: ${live}"`, `"Page: ${page}"`. `prepare_submission`'s ready branch prepends `shipLogBlock` to `show_to_builder` (before `draftTable`) and adds `ship_log: f` to the reply with `agent_note` suffix `" Use the ship log facts in the description and traction answers."`.
- Outcomes: `program_status` enum → `['applied','not_interested','accepted','funded','rejected','won','placed','lost']`. Schema append: `ALTER TABLE builder_program_status DROP CONSTRAINT IF EXISTS builder_program_status_status_check; ALTER TABLE builder_program_status ADD CONSTRAINT builder_program_status_status_check CHECK (status IN ('applied','not_interested','accepted','funded','rejected'))`. `accepted`, `funded`, `rejected` upsert the row like `applied` (and hide the program as `applied` does); `won/placed/lost` unchanged. The ask: `outcomes.ts applyAsk(name, program) => \`Did ${program} come back on ${name}? applied / accepted / funded / rejected.\`` returned by `outcomeToAsk` for a `builder_program_status` row with status `applied` whose program `ends_at + 14 days < now` and `asked_at IS NULL` (new column: `ALTER TABLE builder_program_status ADD COLUMN IF NOT EXISTS asked_at timestamptz`), set in the same statement; the existing `results.expected` ask keeps precedence.
- Page: `projectPrograms` label: `{ title, won, applied: boolean }`; ProjectTab shows "Won X" (announced), else "Applied to X" when `applied` (from `builder_program_status` status in applied/accepted/funded/rejected, or a submitted entry), else nothing (the old "Entered X" for an unsubmitted entry is dropped). A self-reported accepted/funded never changes the label.
- Stats: `applications` = count of distinct (person, program) rows in `builder_program_status` with status in (applied, accepted, funded, rejected) for non-test people; `accepted` = the same with status in (accepted, funded). Descriptions: "applications the builder told EarnKit about", "of which accepted or funded (self-reported)".

- [ ] **Step 1: Tests**
```ts
test('(a) a fit closing in 20 days makes the apply ask the step, once', ...) // mcpCall find twice: first ends with applyAsk, second does not
test('(b) yes returns the prepare note and lead; prepare shows the ship log block first', ...)
test('(c) no is remembered 30 days', ...)
test('(d) a program the builder already applied to is never asked', ...)
test('(e) program_status accepted stays private; applied shows on the page', ...) // profileData.project.programs
test('(f) the outcome ask 14 days after the deadline, once', ...)
test('(g) readStats applications and accepted', ...)
```
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS** plus `v214-replies.test.ts`, `v3-connect.test.ts`, `weekly-moment.test.ts`, `tools.test.ts`, `builder-memory` tests, `profile-bench.test.ts`, `stats.test.ts`.
- [ ] **Step 5: Commit** `feat(v3): drafted application step, ship-log facts in the draft, outcome vocabulary and ask`

---

### Task 3: Backing: the offer, the words, the page, the terms, the JSON (spec 5.3 Route 2)

**Files:**
- Modify: `apps/frontend/lib/earnkit/policy-constants.ts` (`BACKING_EXCLUDED_REPOS`), `apps/frontend/lib/earnkit/coin-moments.ts:22,29-68,97-145,160-240` (`Moment` adds `'first_week'`; the offer text; `backingOffer`), `apps/frontend/db/schema.sql` (append: widen `coin_moments.moment` CHECK to include `'first_week'`)
- Modify: `apps/frontend/lib/earnkit/raising.ts:14-63` (copy), `apps/frontend/lib/earnkit/bench-reply.ts` (`BenchAskKind` adds `'backing'`; `FundLine` kind `backing`), `apps/frontend/lib/earnkit/bench-find.ts` (benchView: the backing ask after connect; the backing fund line; benchMoveUp `'backing'` → `coinAnswer`), `apps/frontend/lib/earnkit/mcp.ts:473-492` (descriptions say backing)
- Modify: `apps/frontend/lib/earnkit/bench-data.ts` (`ProfileData.backing`, `BenchRow.backing`, the `?backed=1` filter), `apps/frontend/app/[handle]/BenchProfileView.tsx` (the Back button), `apps/frontend/app/[handle]/ProjectTab.tsx:111` (gate the coin line), `apps/frontend/app/leaderboard/BenchRowItem.tsx`, `BenchView.tsx` (Backed chip and filter), `apps/frontend/app/components/ui/RaisingPill.tsx` (text), `apps/frontend/app/[handle]/card-response.tsx:132`
- Modify: `apps/frontend/lib/earnkit/policy.ts` (`BACKING_POINTS` terms text), `apps/frontend/app/terms/sections/PolicySection.tsx:110-136` (replace "The token is optional" with the backing section when the flag is on; fix "Every entry is offered a token")
- Create: `apps/frontend/app/api/builders/[handle]/route.ts` (public JSON), `apps/frontend/lib/earnkit/builder-json.ts`
- Test: `apps/frontend/lib/earnkit/v3-backing.test.ts`

**Interfaces:**
- `BACKING_EXCLUDED_REPOS = ['earnkitai/earnkit'] as const` (lowercase compare).
- `coin-moments.ts`: `Moment` adds `'first_week'`. `BACKING_OFFER = (name, symbol, wallet) => \`People can back ${name} onchain. EarnKit launches a $${symbol} coin on tokens.fun for it; you keep 40% of its trading fees${wallet ? \`, paid to ${shortWallet(wallet)}\` : ''}. It is a tradable token on Base and can go to zero. Want to open backing for ${name}?\``. `backingOfferable(builderId, key)`: `raisingEnabled() && coinOfferable(builderId, key) && !BACKING_EXCLUDED_REPOS.includes(key.toLowerCase()) && exists project_updates row for key with facts.approved = true and hasFacts`. `backingOffer(builderId, key, deps)`: as `offerCoin` with moment `'first_week'` (claims the moment, proposes name and ticker through the existing proposal path, returns `{ line, wallet }`).
- Reply: `stateAsk` priority connect > backing > apply > share > ship; the backing ask is `{ kind: 'backing', project_key, line: BACKING_OFFER(...) }` (the one question). `benchMoveUp` `'backing'`: yes → `coinAnswer(ctx, { project_key, answer: 'yes', wallet })` (which already returns the note to call `confirm { project_id, ... }` and sets `raising_at` under the flag); no → `coinAnswer(... 'no')` (remembered via `coin_moments.answer`, counts toward `DECLINES_MAX`). `tell coin { raising }` copy: `RAISE_LINES.on = (symbol) => \`Done. Your page shows backing for $${symbol}.\``, `.off = 'Okay. Your page no longer shows backing. Your coin stays onchain.'`, `.notLaunched = 'Backing opens once your coin is launched.'`.
- Fund line: `{ kind: 'backing'; backers: number; earned_usd: number; page: string }` rendered `"Backing: ${backers} backers, $${earned} earned. Your page: ${page}"` (counts from Task 4; until then 0 and $0 render as "Backing open. Your page: ..."), only when backing is open and the flag is on; never a step.
- Page: `ProfileData.backing: { symbol: string; url: string; backers: number; earned_usd: number } | null` (replaces `raising` on the type; keep the DB column names). `BenchProfileView`: a secondary button `Back <project>` linking to `backing.url` (`BTN_SECONDARY`, `data-ek-back`), under the three numbers; `RaisingPill` text `Backing · $SYM` (`data-pill="backing"`); card pill the same; `BenchRow.backing` and the leaderboard "Backed" chip (`FILTER_BACKED = 'Backed'`, `?backed=1`); `ProjectTab` coin line only with the flag on.
- Terms: `policy.ts BACKING_POINTS: string[]` (the split in words: "Of a coin's trading fees, Clanker keeps 20%. Of the rest, 40% goes to the builder's wallet, 10% buys MINI and 50% goes to EarnKit's Safe."; "Backing is offered once, after the first approved week, and only with a yes."; "A coin is a tradable token on Base. It can go to zero. EarnKit never says it will rise."; "Closing backing hides it from the page; the coin stays onchain."; "Backing never changes Shipping or rank."). `PolicySection` renders the section headed "Backing" when `raisingEnabled()`, and the old "The token is optional" section is removed; the "Where token fees go" table stays.
- JSON: `GET /api/builders/<handle>.json` → `builder-json.ts builderJson(handle, now)`: `{ handle, name, page, shipping, rank, total, streak, points, last_week: { week, summary } | null, last_shipped_days: number | null, stopped_shipping: boolean (no code in the last 2 finished weeks), backing: { symbol, url, backers, earned_usd } | null }`, `Cache-Control: public, max-age=60`, 404 for a hidden or unknown handle; CORS `Access-Control-Allow-Origin: https://tokens.fun`.

- [ ] **Step 1: Tests**
```ts
test('(a) after the first approved week the backing offer is the one question, once', ...) // withEnv EARNKIT_RAISING on + TOKENSFUN key; mcpCall find; second find does not repeat
test('(b) yes routes to the coin flow note; no counts a decline', ...)
test('(c) never for a private repo, a held profile, a taken repo, a project with a coin, or earnkitai/earnkit', ...)
test('(d) the page shows Back <project>, the pill reads Backing, the leaderboard chip Backed, and the JSON carries backing', ...)
test('(e) the terms section renders only with the flag on and contains no "community round"', ...)
test('(f) flag off: no backing text anywhere (reply, page, card, terms, JSON backing null)', ...)
test('(g) copy-review: "community round", "raise", "raising" absent from builder-facing text', ...)
```
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS** plus `coin-moments` tests, `raising` tests, `v213-copy.test.ts`, `bench-page.test.ts`, `profile-bench.test.ts`, `card-route.test.ts`, `copy-review.test.ts`, `public-pages.test.ts`, `v214-replies.test.ts`.
- [ ] **Step 5: Commit** `feat(v3): Backing: the offer at the first approved week, the words, the page, the terms, the builder JSON`

---

### Task 4: Backers, Earned and "waiting" (spec 5.2, 5.3 Route 2)

**Files:**
- Create: `apps/frontend/lib/earnkit/backers.ts`, `apps/frontend/lib/earnkit/earned.ts`
- Modify: `apps/frontend/db/schema.sql` (append two tables), `apps/frontend/lib/earnkit/bonus-ledger.ts:918-974` (`runBonusLedger`: two new steps after `safe_index`), `apps/frontend/lib/earnkit/bench-data.ts` (`ProfileData.earned`, `backing.backers/earned_usd`), `apps/frontend/app/[handle]/BenchProfileView.tsx` (the Earned number as the third of the three numbers; "and $X waiting"), `apps/frontend/lib/earnkit/bench-reply.ts` (the stand line gains `Earned $X` when > 0), `apps/frontend/lib/earnkit/stats.ts` (`backing_open`, `backers`, `earned_usd`), `apps/frontend/lib/earnkit/builder-json.ts`
- Test: `apps/frontend/lib/earnkit/v3-earned.test.ts`

**Interfaces:**
- Schema:
  ```sql
  -- v3 Stage 2: backers (distinct wallets that received a coin, excluding the pool, the locker and zero) and creator fees paid.
  CREATE TABLE IF NOT EXISTS coin_backers (coin text NOT NULL, wallet text NOT NULL, first_block bigint NOT NULL, PRIMARY KEY (coin, wallet));
  CREATE TABLE IF NOT EXISTS coin_backer_cursor (coin text PRIMARY KEY, block bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS creator_fees (tx_hash text NOT NULL, log_index integer NOT NULL, coin text NOT NULL, wallet text NOT NULL, amount_wei numeric NOT NULL, block_number bigint NOT NULL, block_time timestamptz NOT NULL, PRIMARY KEY (tx_hash, log_index));
  ```
- `backers.ts`: `indexBackers(now, { deadline, rpc?, only?: string[] })`: for each launched Base coin (`projects.coin_address`, `coin_launched_at`), reads ERC-20 `Transfer` logs from the cursor (start: the launch block, from `coin_tx` receipt) in bounded block ranges (≤ 2,000 blocks a call, ≤ 25 s a run, as `bonus-ledger.ts` slices), inserts distinct `to` wallets excluding the zero address, the pool (`poolId`'s hook/pool manager address), the FeeLocker and the Safe; advances the cursor. `backersOf(coins: string[]): Map<coin, number>`.
- `earned.ts`: `indexCreatorFees(now, { deadline })`: FeeLocker `ClaimedRewards` logs where `feeOwner` = the coin's creator wallet (`projects.payout_wallet` / creator wallet column; use the same locker ABI `bonus-ledger.ts` uses for the Safe) → `creator_fees` rows. `earnedUsd(builderId, now): Promise<{ paid_usd: number; waiting_usd: number }>`: `paid` = WETH claimed to the builder's creator wallet summed over their coins, at `fees.ts` WETH price (`cachedFeesUsd` style caching), plus announced prizes (`entry_outcomes` basis announcement with `prize_usd`); `waiting` = `fees.ts cachedFeesUsd([creator wallet])` (the FeeLocker `availableFees` read).
- Cron: `runBonusLedger` adds steps `backers_index` and `creator_fees_index` after `safe_index`, each bounded by the slice and logged like the others.
- Page: the three numbers are Shipping (ring), Rank, Earned (`$1,240`, `data-ek-earned`); Earned shows `$0` when ranked and nothing earned; under it the small line `and $X waiting` only when `waiting_usd >= 1`. Reply stand line: `"${name}: Shipping 72 · #3 of 40 builders. Earned $340."` when `paid_usd > 0`.
- Stats: `backing_open` (coins with `raising_at` set and the flag on), `backers` (sum of distinct wallets over open backings), `earned_usd` (sum of paid over non-test people).

- [ ] **Step 1: Tests** (with a fake RPC `getLogs` as `bonus-ledger` tests do)
```ts
test('(a) indexBackers counts distinct recipients, skips zero/pool/locker/safe, advances the cursor and resumes', ...)
test('(b) indexCreatorFees records claims to the creator wallet only', ...)
test('(c) earnedUsd sums claims at the WETH price plus announced prizes; waiting from cachedFeesUsd', ...)
test('(d) the profile shows Earned as the third number and the waiting line; the reply stand line carries Earned when paid', ...)
test('(e) flag off: backers and backing_open absent, Earned still shows program prizes', ...)
```
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS** plus `bonus-ledger.test.ts`, `stats.test.ts`, `profile-bench.test.ts`, `v214-replies.test.ts`, `v3-backing.test.ts`.
- [ ] **Step 5: Commit** `feat(v3): backers and Earned indexed from Base; the third number on the page`

---

### Task 5: Docs for Stage 2

- [ ] Append "v3 Stage 2" to `docs/codebase-context/architecture-guide.md` (programs status and total rule; the apply step and outcomes; backing words, offer, flag and JSON; the two indexers) and the new files to `code-map.md`; `programs/README.md` documents `upcoming`, `opens_note`, `in_person`.
- [ ] Full suite green; `tsc` clean; `pnpm programs:check`; `pnpm db:check`.
- [ ] Commit `docs(v3): Stage 2 guide, code map and programs README`
