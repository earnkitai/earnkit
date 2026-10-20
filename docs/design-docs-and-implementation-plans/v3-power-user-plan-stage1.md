# v3 Stage 1: the founder's loop works in Grok Bot. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A builder on a hosted client (Grok Bot) signs in with X, connects one repo, sees their last weeks and says one yes, gets points, and every Monday gets an email that confirms the week in one click; weeks post on Monday and carry points so the feed is never empty.

**Architecture:** Every change lives in `apps/frontend/lib/earnkit/` and is reached through the existing MCP tools (`find`, `tell`, `score`) and the hourly cron. New modules: `points.ts` (the ledger), `connect-moment.ts` (the first yes), `week-links.ts` (signed approve and hide links) plus one route `app/api/week/route.ts`. The reply state machine (`bench-reply.ts`, `bench-find.ts`) gains one ask kind, `connect`. The digest (`digest.ts`) becomes the Monday moment by email.

**Tech Stack:** Next.js 15 app router, TypeScript, Postgres via the `postgres` tagged template (`lib/earnkit/db.ts sql()`), zod MCP schemas (`mcp.ts`), node:test with one database per test file, Resend for email.

**Spec:** `docs/design-docs-and-implementation-plans/v3-power-user.md` (sections 5.1, 5.3 Route 3, 5.4, 5.7, 6 Stage 1).

## Global Constraints

- Copy: short, money first, no emojis, never an em dash, one https link and one question per reply (spec 3 anti-goals, `builder-copy-style`).
- Never "EARN points". The word is "points".
- Backing, coins and points never touch Shipping or rank.
- No new services. Resend free tier (`free-tier.ts` counters stay). Haiku summaries unchanged.
- Nothing is deleted from the schema; `db/schema.sql` is idempotent and appended to at the end.
- Tests go through the real MCP layer where a reply is asserted: `fixtures/mcp-call.ts mcpCall(ctx, tool, args)`; seed people with `fixtures/find.ts person(...)` and `fixtures/ranked-step.ts` as `weekly-moment.test.ts` does.
- Run one test file from the repo root `/Users/jenil/earnkit-v3`:
  `DATABASE_URL=postgres://jenil@localhost:5432/earnkit_test node apps/frontend/lib/earnkit/fixtures/test-db-template.mjs && DATABASE_URL=postgres://jenil@localhost:5432/earnkit_test npx tsx --test --import ./apps/frontend/lib/earnkit/fixtures/test-guard.ts apps/frontend/lib/earnkit/<file>.test.ts`
  (Postgres: `brew services start postgresql@17`). The full suite: `DATABASE_URL=... pnpm test`; typecheck: `cd apps/frontend && npx tsc --noEmit -p .`.
- Commit after each task on branch `v3-power-user`; commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- After the last task, update `docs/codebase-context/architecture-guide.md` (new section "v3 Stage 1") and `docs/codebase-context/code-map.md` (new files).

## Review Focus

1. A hosted-client installation that signed in with X and then re-authorizes from a second Grok conversation: the second token must attach to the same page, never create a second page or refuse as `shared`. Pinned in Task 1 test (c).
2. A week whose facts are only `started` (no commits) must get 0 points and never post, before or after a yes. Pinned in Task 2 test (b) and Task 5 test (d).
3. The connect yes arriving twice (the agent retries): one set of points, one "Done", the second a plain "Okay." Pinned in Task 5 test (c).
4. An approve link clicked by a mail scanner (GET) must change nothing; only the POST approves. Pinned in Task 6 test (d).
5. The Monday email for a person whose weekly facts are not written yet (the cron slice ran out) must wait for next hour, not send an empty moment or mark the week considered. Pinned in Task 6 test (e).

---

### Task 1: Hosted clients bound to X (spec 5.7, D4)

**Files:**
- Modify: `apps/frontend/lib/earnkit/oauth-routes.ts:97-104` (authorizeGet)
- Modify: `apps/frontend/lib/earnkit/x-install.ts:216-218` (attachOnce's shared refusal)
- Modify: `apps/frontend/lib/earnkit/installations.ts:256-270` (connectInstallation), `:276-283` (sharedGroup)
- Modify: `apps/frontend/lib/earnkit/digest.ts:458-461` (SubRow shared), `apps/frontend/lib/earnkit/bench-find.ts:278`
- Modify: `apps/frontend/lib/earnkit/oauth.ts:246` doc comment only (MANY_USER_HOSTS now means "warning page, then X")
- Test: `apps/frontend/lib/earnkit/v3-hosted-client.test.ts`

**Interfaces:**
- Produces: the rule "an installation whose `x_user_id` is set is never shared", as one SQL predicate used in every place that computes `shared`: `(i.shared_client AND i.x_user_id IS NULL)`. Export it from `installations.ts` as `export const anonSharedSql = (db: Db, alias = 'i') => db\`(${db(alias)}.shared_client AND ${db(alias)}.x_user_id IS NULL)\`` only if the `postgres` identifier helper reads cleanly; otherwise write the predicate inline at each site and name it in a comment "v3 Stage 1: bound is never shared".
- `connectInstallation(token)` keeps its `Caller` shape; `shared` is now false for a bound token.
- `sharedGroup(installationId)` is true only when an installation in the group is `shared_client AND x_user_id IS NULL`.

- [ ] **Step 1: Write the failing tests**

```ts
// v3-hosted-client.test.ts (node:test, per-file DB via test-guard)
test('(a) authorize from a hosted client goes to X, not straight to a code', ...)
// registerClient with redirect 'https://grok.com/mcp/callback' and client name 'Grok'; withEnv(X_ON);
// authorizeGet(request) -> 302 whose Location is NOT the client redirect (it is the warning page or X);
// assert !location.startsWith('https://grok.com/')
test('(b) attachToX on a shared_client installation binds it and the caller is not shared', ...)
// INSERT installations (token_hash, shared_client=true); attachToX(own, {id:'x1', username:'ana', ...}, NOW)
// -> no throw; connectInstallation(token) -> { shared: false, x: 'x1' }; sharedGroup(id) === false
test('(c) a second hosted token for the same X attaches to the same page', ...)
// second INSERT shared_client=true; attachToX(own2, same user) -> result.root === first root; builder_profiles count for x_user_id 'x1' === 1
test('(d) tell profile hide on a bound hosted installation hides the page (no SHARED note)', ...)
// mcpCall({installationId: root, ownInstallationId: own, sharedClient: false}, 'tell', { profile: 'hide' }) -> reply.show_to_builder names the hide, reply.agent_note undefined or without 'shared'
test('(e) an anonymous shared_client installation stays shared', ...)
// INSERT shared_client=true, no X; connectInstallation -> shared === true
```

- [ ] **Step 2: Run the file; expected FAIL** ((a) redirects to grok.com; (b) throws AttachRefused('shared')).

- [ ] **Step 3: Implement**
  - `authorizeGet`: `if (!xSignInEnabled()) return Response.redirect(issueCode(...))` (drop `|| checked.many`). Keep `checked.many` in `CheckedAuthorize` for the warning page's wording; nothing else reads it.
  - `attachOnce`: delete the `g` query and `if (me.shared || g?.shared) throw new AttachRefused('shared')`. Keep the `'shared'` member of `AttachRefused`'s reason union so older callers compile; it is no longer thrown.
  - `connectInstallation`: `shared` = `(t.shared_client AND t.x_user_id IS NULL) OR EXISTS (... s.shared_client AND s.x_user_id IS NULL)`.
  - `sharedGroup`: `bool_or(shared_client AND x_user_id IS NULL)`.
  - `digest.ts sendDigests` SubRow: `(i.shared_client AND i.x_user_id IS NULL) AS shared`.
  - `bench-find.ts:278` `bound`: `x_user_id IS NOT NULL` only (a shared anonymous install is not bound).

- [ ] **Step 4: Run the file; expected PASS.** Then run `v214-x-install.test.ts`, `oauth.test.ts`, `v214-journey.test.ts`; fix any pin that asserted the old `shared` refusal (change the assertion, not the behaviour).

- [ ] **Step 5: Commit** `feat(v3): hosted clients sign in with X and are never shared once bound`

---

### Task 2: Points written with the week (the feed bug)

**Files:**
- Modify: `apps/frontend/lib/earnkit/week-facts.ts` (move `pointsOf` here; `upsertWeekFacts` writes `points`)
- Modify: `apps/frontend/lib/earnkit/feed.ts:23-30` (re-export `pointsOf` from week-facts), `:33-41` (`rankFeed` default `weeks` 5 to 12)
- Modify: `apps/frontend/scripts/feed.mts` (new subcommand `rank`), root `package.json` (`"feed:rank": "tsx apps/frontend/scripts/feed.mts rank"`)
- Test: `apps/frontend/lib/earnkit/v3-week-points.test.ts`

**Interfaces:**
- Produces: `export function pointsOf(f: WeekFacts): number` in `week-facts.ts` (same body as today's `feed.ts pointsOf`); `feed.ts` does `export { pointsOf } from './week-facts'`.
- `upsertWeekFacts(builderId, projectKey, monday, f, titles?, summary?)` sets `points = hasFacts(merged) ? pointsOf(merged) : 0` where `merged` is the row's facts after the merge (compute in SQL with the merged jsonb is awkward: read the row back inside the same statement with `RETURNING facts`, then one `UPDATE ... SET points` when it differs; two statements are fine).

- [ ] **Step 1: Write the failing tests**

```ts
test('(a) upsertWeekFacts writes points from the facts', ...)
// upsertWeekFacts(b, 'o/r', monday, { shipped_code: { n: 5 }, streak: { w: 3 }, checked: true })
// -> SELECT points FROM project_updates ... === 13
test('(b) a started-only week has 0 points', ...)
// upsertWeekFacts(b, 'o/r', monday, { started: { live: true, weeks: 0, people: 0 } }) -> points === 0
test('(c) feed:rank rewrites older rows', ...)
// UPDATE project_updates SET points = 0 for (a); rankFeed(NOW, { weeks: 12 }) -> points back to 13
```

- [ ] **Step 2: Run; expected FAIL** ((a) points 0).
- [ ] **Step 3: Implement** as in Interfaces. `scripts/feed.mts rank` calls `rankFeed(new Date(), { weeks: 12 })` and prints `{ rows }`.
- [ ] **Step 4: Run; PASS.** Run `feed.test.ts`, `v214-ship-log.test.ts`.
- [ ] **Step 5: Commit** `fix(v3): a week's points are written with its facts; feed:rank rewrites older weeks`

---

### Task 3: "Not yet confirmed" on unapproved weeks (spec 5.4, D1)

**Files:**
- Modify: `apps/frontend/lib/earnkit/feed.ts` (FeedCard gains `confirmed: boolean`), `apps/frontend/lib/earnkit/bench-data.ts:113,159-181` (ProfileCard gains `confirmed`, logCards sets it)
- Modify: `apps/frontend/app/components/ui/UpdateCard.tsx` (UpdateCardData gains `confirmed?: boolean`; renders the label)
- Modify: the feed and profile views that build card props (`app/feed/FeedView.tsx`, `app/[handle]/BenchProfileView.tsx`, `app/components/sections/UpdateCarousel.tsx`): pass `confirmed`
- Test: `apps/frontend/lib/earnkit/v3-unconfirmed.test.ts`

**Interfaces:**
- `confirmed = facts.approved === true`. Export `export const UNCONFIRMED_LABEL = 'Not yet confirmed'` from `week-facts.ts`.
- UpdateCard: when `card.confirmed === false` and the card is not a Started card, a `<span data-ek-unconfirmed="">` with `UNCONFIRMED_LABEL` after the week label (muted text, same size as the week line).

- [ ] **Step 1: Tests**: `(a)` feedRows/`feedWeeks` card for an unapproved week has `confirmed: false`; after `approveWeek(...)` `confirmed: true`. `(b)` `logCards` sets `confirmed` the same way. `(c)` render test as `profile-bench.test.ts` renders the view (react-dom/server `renderToStaticMarkup`): the markup contains `data-ek-unconfirmed` for the unapproved week and not for the approved one.
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS** plus `feed.test.ts`, `profile-bench.test.ts`.
- [ ] **Step 5: Commit** `feat(v3): weeks post on Monday and read "Not yet confirmed" until the builder's yes`

---

### Task 4: The points ledger (spec 5.3 Route 3, D3)

**Files:**
- Create: `apps/frontend/lib/earnkit/points.ts`
- Modify: `apps/frontend/db/schema.sql` (append)
- Modify: `apps/frontend/lib/earnkit/weekly-moment.ts:158-173` (`approveWeek` gains `via` and awards points)
- Modify: `apps/frontend/lib/earnkit/bench-data.ts` (ProfileData gains `points: number`), `apps/frontend/app/[handle]/BenchProfileView.tsx` (the points line), `apps/frontend/lib/earnkit/bench-reply.ts` (FundLine `points`), `apps/frontend/lib/earnkit/bench-find.ts` (adds the points line when ranked)
- Modify: `apps/frontend/lib/earnkit/stats.ts` (`points_total`)
- Test: `apps/frontend/lib/earnkit/v3-points.test.ts`

**Interfaces:**
- Schema (append at the end of `schema.sql`):
  ```sql
  -- v3 Stage 1: points, the default program. One row per approved week with facts; never ranked.
  CREATE TABLE IF NOT EXISTS builder_points (
    builder_id integer NOT NULL,
    week       date NOT NULL CHECK (EXTRACT(isodow FROM week) = 1),
    points     integer NOT NULL CHECK (points >= 0),
    rank       integer,
    total      integer,
    via        text NOT NULL CHECK (via IN ('share', 'connect', 'email')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (builder_id, week)
  );
  ```
- `points.ts`:
  - `export type ApproveVia = 'share' | 'connect' | 'email'`
  - `export function pointsForRank(rank: number | null, total: number | null): number` : rank 1 → 100; rank/total ≤ 0.10 → 90; ≤ 0.25 → 70; ≤ 0.50 → 50; else 30; null rank or total → 30.
  - `export const CONNECT_POINTS = 30`
  - `export async function awardWeekPoints(builderId: number, week: string, via: ApproveVia, now: Date): Promise<number>`: if `via === 'connect'` points = CONNECT_POINTS, rank/total null; else read `standingOf(builderId)` (person-score.ts) and use `pointsForRank(s.ranked ? s.rank : null, s.ranked ? s.total : null)`. `INSERT ... ON CONFLICT DO NOTHING RETURNING points`; returns the inserted points, or 0 when the row existed.
  - `export async function pointsTotal(builderId: number): Promise<number>` (`COALESCE(sum(points), 0)`).
  - `export const POINTS_LINE = (total: number) => \`Points: ${total.toLocaleString('en-US')}. They convert to $EARN at launch, in proportion to all points earned.\`` (reply) and `export const POINTS_PAGE_LINE = 'Points convert to $EARN when it launches, in proportion to all points earned. They are not a token and have no value until then.'` (profile).
- `approveWeek(builderId, key, monday, now, via: ApproveVia = 'share'): Promise<boolean>`: as today, writes `approved_via: via`; when the approval stood (`had` or the insert returned) and the row's facts satisfy `hasFacts`, calls `awardWeekPoints(builderId, monday, via, now)` (read the facts back in the same UPDATE with `RETURNING facts`).
- Reply: `FundLine` gains `{ kind: 'points'; total: number }`; `fundLines()` appends `POINTS_LINE(total)` last when the state is ranked and total > 0. `benchView` reads `pointsTotal(id)` when ranked.
- Profile: `ProfileData.points` (number); `BenchProfileView` shows, under the Originality line, `"{points} points"` with `POINTS_PAGE_LINE` as its small text, only when `points > 0`.
- Stats: `points_total: number` (sum over non-test people), listed in `STAT_KEYS` with the description "points awarded for approved weeks".

- [ ] **Step 1: Tests**
```ts
test('pointsForRank', () => { assert.equal(pointsForRank(1, 40), 100); assert.equal(pointsForRank(4, 40), 90); assert.equal(pointsForRank(10, 40), 70); assert.equal(pointsForRank(20, 40), 50); assert.equal(pointsForRank(30, 40), 30); assert.equal(pointsForRank(null, null), 30); });
test('approveWeek awards once', ...) // seed ranked person (rank 1 of 1) with a facts row; approveWeek(..., 'share') -> builder_points row points 100 via 'share'; approveWeek again -> still one row; pointsTotal === 100
test('a started-only week approved gives no points', ...)
test('connect via gives 30', ...)
test('profileData.points and the reply line', ...) // mcpCall find on the ranked person -> show_to_builder includes 'Points: 100.'
test('readStats points_total', ...)
```
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS** plus `weekly-moment.test.ts`, `stats.test.ts`, `profile-bench.test.ts`, `v214-replies.test.ts` (update reply pins that now carry the points line).
- [ ] **Step 5: Commit** `feat(v3): points for every approved week; profile and reply lines; points_total`

---

### Task 5: Approve on connect (spec 5.1)

**Files:**
- Create: `apps/frontend/lib/earnkit/connect-moment.ts`
- Modify: `apps/frontend/lib/earnkit/bench-reply.ts` (`BenchAskKind` adds `'connect'`; `stateAsk` takes `connect?: boolean`; `CONNECT_ASK`)
- Modify: `apps/frontend/lib/earnkit/bench-find.ts:312-400` (benchView: the connect moment before the weekly moment), `:593-665` (benchMoveUp handles `'connect'`), the `note` map (a `CONNECT_NOTE`)
- Test: `apps/frontend/lib/earnkit/v3-connect.test.ts`

**Interfaces:**
- `connect-moment.ts`:
  - `export type ConnectWeek = { monday: string; line: string }`
  - `export async function connectWeeks(builderId: number, key: string, now: Date): Promise<ConnectWeek[]>`: the rows of `key` for the last `BACKFILL_WEEKS` finished Mondays (`backfillMondays(now)`) with `hasFacts(facts)`, not hidden, not `facts.approved`; `line` = `${weekLabel(monday)}: ${summaryShown(...) ?? factChips(facts).join(' · ')}` (use the same privacy rule as `lastWeekOf`: a private repo's summary only with titles on; else the chips). Newest first.
  - `export const CONNECT_HEAD = (n: number) => \`Your last ${n} ${n === 1 ? 'week' : 'weeks'}:\``
  - `export const CONNECT_ASK = 'Does this look right? Yes posts them.'`
  - `export const CONNECT_DONE = (url: string) => \`Done. Your page is live: ${url}\``
  - `export const CONNECT_NOTE = "A yes or no to the last line: call tell with move_up: { kind: 'connect', project_key, answer }. Don't show this note."`
  - `export async function openConnect(builderId: number, o: { key: string; weeks: string[] }): Promise<void>` writes `standing_seen.connect_open`.
  - `export async function answerConnect(builderId: number, projectKey: string | null | undefined, answer: 'yes' | 'no', now: Date): Promise<{ approved: number } | null>`: takes `connect_open` once (one UPDATE removing it, as `answerShare`); null when nothing open; `no` writes `standing_seen.connect_done = now` and returns `{ approved: 0 }`; `yes` calls `approveWeek(builderId, key, monday, now, 'connect')` for each week, writes `connect_done`, returns the count.
  - `export async function connectDue(builderId: number): Promise<boolean>`: no `connect_done` and no `connect_open` in `standing_seen`.
- `benchView`: when `ranked && project && handle && !held` and `await connectDue(id)`, read `connectWeeks`; if non-empty: `openConnect`, skip `weeklyMoment` this reply, `moment` = `[CONNECT_HEAD(n), ...lines].join('\n')`, and the ask is `{ kind: 'connect', project_key: key, line: CONNECT_ASK }` (link stays the page). If empty, write `connect_done` (nothing to confirm) and continue as today.
- `benchMoveUp`: `if (m.kind === 'connect')` → `answerConnect`; on `{approved: n>0}` reply `CONNECT_DONE(pageUrl(handle))` and, when `digestEnabled()`, append the email question from Task 6 (`askWeeklyEmail`) as the reply's one question on a second line; on `approved: 0` or null → `NOTED_LINE`.
- `TAKEN_ONCE` is not used for `connect` (the open record is the once-guard, like `share`).

- [ ] **Step 1: Tests (through mcpCall)**
```ts
test('(a) first ranked find after connect shows the last weeks and asks the connect question', ...)
// seed claimed ranked person, main 'ana/app', 3 backfilled rows with shipped_code and checked:true, unapproved
// find -> show_to_builder starts with 'Your last 3 weeks:' and ends with CONNECT_ASK; reply.move_up.kind === 'connect'
test('(b) yes approves all three with via connect, 30 points each, activation counts', ...)
// tell move_up {kind:'connect', project_key:'ana/app', answer:'yes'} -> show_to_builder starts with 'Done. Your page is live: '
// project_updates approved_via 'connect' x3; pointsTotal === 90; readStats(...).activated === 1
test('(c) a second yes is "Okay."', ...)
test('(d) a person with only a started row sees no connect lines', ...) // find has no CONNECT_HEAD; connect_done set
test('(e) the weekly moment still shows the week after', ...) // advance now to next Monday after the weekly job wrote the week; find shows the moment
```
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS** plus `weekly-moment.test.ts`, `v214-replies.test.ts`, `v214-journey.test.ts`.
- [ ] **Step 5: Commit** `feat(v3): the first ranked reply shows the last weeks; one yes posts them and activates`

---

### Task 6: The Monday email with Looks right / Hide (spec 5.4)

**Files:**
- Create: `apps/frontend/lib/earnkit/week-links.ts`, `apps/frontend/app/api/week/route.ts`
- Modify: `apps/frontend/lib/earnkit/digest.ts` (`DIGEST_HOUR_UTC`, `weekStart`, `DigestFacts.week`, `digestFacts`, `digestBody`, copy constants)
- Modify: `apps/frontend/lib/earnkit/cron.ts:308-320` (the digest runs after `runScoreSteps`, from `DIGEST_HOUR_UTC`)
- Modify: `apps/frontend/lib/earnkit/bench-find.ts` / `tools.ts` where `askWeeklyEmail` is called today (the ask moves to the connect yes and to the first `share` yes)
- Test: `apps/frontend/lib/earnkit/v3-monday-email.test.ts`

**Interfaces:**
- `digest.ts`: `export const DIGEST_HOUR_UTC = 16` (after `WEEKLY_HOUR_UTC` 15); `weekStart` uses it. Copy: `EMAIL_QUESTION = 'Want the Monday summary by email? Reply with the address.'`, `emailQuestionFor(email) = \`Want the Monday summary by email at ${email}?\``, `EMAIL_ON = 'Done. Every Monday, once your week is written.'`.
- `DigestFacts` gains `week: { lines: string[]; approveUrl: string; hideUrl: string; approved: boolean } | null` and `handle: string | null`. `digestFacts(s, now, db)` finds the person: `COALESCE((SELECT p.builder_id FROM builder_profiles p WHERE p.x_user_id = i.x_user_id), i.builder_id, i.id)`; with a main project, `lastWeekOf(person, key, now)`; when `last && last.checked`, `lines = momentLines(last)`, URLs from `week-links.ts`; when the row is not checked yet, return `week: null` and `pending: true`.
- `digestBody(f)`: when `f.week` and not approved: subject `Your week on EarnKit: Shipping ${score} · #${rank} of ${total}` (reuse `shareText` minus the "My week on" prefix), body = week lines, blank line, `Looks right: ${approveUrl}`, `Hide this week: ${hideUrl}`, blank line, then today's sections; null only when there is no week and no sections.
- `sendDigests`: a subscription whose facts came back `pending: true` is neither sent nor marked considered (the next hourly run tries again); add `pending` to the step results.
- `week-links.ts`: `export type WeekAction = 'approve' | 'hide'`; `weekToken(t: { builderId: number; key: string; monday: string; action: WeekAction }, secret?: string): string` = `${builderId}.${monday}.${action}.${base64url HMAC-SHA256(secret, "week:v1:<builderId>:<key>:<monday>:<action>")}` with the key carried in the mac only (the URL never names the repo); `weekTarget(token, secret?): { builderId; monday; action; mac } | null`; `weekUrl(t) = \`${siteUrl()}/api/week?t=...\``. Verification needs the key: `weekTarget` returns the parts and the route checks the mac against the person's main project key (`main_project_key`).
- Route `app/api/week/route.ts`: `GET` → `brandShell` page: title `Your week on EarnKit`, the week's lines, one form button (`Looks right` or `Hide this week`) posting to the same URL; a bad token → 400 page `This link is not valid.`; `POST` → `approveWeek(builderId, key, monday, now, 'email')` or `hideUpdate(builderId, monday)`; done page `Confirmed. Your page shows it.` / `Hidden. Your page no longer shows this week.` with a link to the page. Idempotent.
- Cron: in `runCron`, move the digest block after `runScoreSteps` so the weekly facts come first within one run; `weekStart` at 16:00 means the first send is the 16:15 run.
- The ask: `askWeeklyEmail(installationId, { shared: false, email: null })` is called from `benchMoveUp` after a connect yes (Task 5) and after a share yes when `digest_asked_at IS NULL`; its question is appended to that reply's text (one question in the reply: the Done line is a statement).

- [ ] **Step 1: Tests**
```ts
test('(a) weekToken round trip and a tampered token', ...)
test('(b) digestBody with a week leads with the moment and both links', ...)
test('(c) sendDigests mails the moment for a checked week', ...) // fake Mailer captures text; contains 'Looks right: https://'
test('(d) GET /api/week changes nothing; POST approves with via email and awards points', ...)
test('(e) an unchecked week is pending: not sent, not considered', ...)
test('(f) the connect yes asks for the address once; tell weekly_email yes with an address subscribes', ...)
```
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS** plus `digest.test.ts`, `cron` tests (`grep -l sendDigests lib/earnkit/*.test.ts`).
- [ ] **Step 5: Commit** `feat(v3): the Monday email is the moment: Looks right and Hide in one click`

---

### Task 7: Docs and the Stage 1 check on production

**Files:**
- Modify: `docs/codebase-context/architecture-guide.md` (append "v3 Stage 1"), `docs/codebase-context/code-map.md`
- Modify: `README.md` (the tools line: five tools; "Sign in with X" at install; drop pickup)
- Create: `docs/design-docs-and-implementation-plans/v3-stage1-runbook.md`

- [ ] **Step 1:** Write the architecture section: Task 1 rule, points at write time, the label, the ledger, the connect moment, the email. One paragraph each with file names.
- [ ] **Step 2:** Runbook for the owner (non-engineer): set `RESEND_API_KEY`; deploy; run `railway run --service earnkit -- pnpm feed:rank`; in Grok Bot add the connector, sign in with X, say "where do I stand", install the App on `earnkitai/earnkit`, say yes; check earnkit.com/jenilt shows points and the feed shows the weeks; reply with an email address; Monday: open the email, click Looks right.
- [ ] **Step 3:** `pnpm test` full suite green; `tsc --noEmit` clean; `next build` passes.
- [ ] **Step 4: Commit** `docs(v3): Stage 1 guide, code map, README and the owner's runbook`
