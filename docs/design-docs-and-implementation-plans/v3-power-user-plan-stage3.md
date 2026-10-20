# v3 Stage 3: The site. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** earnkit.com reads like an established brand: one accent, big type, rows instead of cards, no decoration, no video, few words; a builder understands it on arrival and wants their own page. Every page, HTML shell page, the share card, the badge and a new Docs page follow one system.

**Architecture:** The data layer stays (`landing.ts`, `bench-data.ts`, `feed.ts`, `guide.ts`, `stats.ts`); the views are rebuilt on a new token set in `lib/earnkit/theme.ts` mirrored in `globals.css` and `tailwind.config.ts`, with new primitives in `Panel.tsx` and `Button.tsx`. `brand-page.ts brandShell` takes the same tokens for the route-handler pages. Copy constants keep their names and files so the test pins move, not multiply.

**Tech Stack:** Next.js 15 app router, Tailwind, self-hosted Funnel Display and Funnel Sans, react-dom/server render tests (node:test).

**Spec:** `docs/design-docs-and-implementation-plans/v3-power-user.md` sections 5.2, 5.6, 5.8, 6 Stage 3. The design plan (tokens, type, layout, principles) is in the controller's message of 2026-10-20 and restated in Task 1.

## Global Constraints

- Tokens (the only colours): page `#000000`, surface `#0E1116`, raised `#161A22`, text `#FFFFFF`, body `#C9CDD6`, muted `#7E8694`, brand `#0052FF`, brand hover `#3D7BFF`, hairline `rgba(255,255,255,0.12)`, hairline strong `rgba(255,255,255,0.24)`, chip `rgba(255,255,255,0.06)`. No gradients, no glow, no box shadows, no decorative images, no video, no emoji, never an em dash. The profile ring keeps `PART_COLORS`.
- Type: Funnel Display for display and numbers; Funnel Sans for text. H1 56px (phone 36px), H2 32px (phone 24px), body 16 to 18px, measure under 75 characters, sentence case, no all-caps labels, no eyebrows, no single-word colour accents in a headline.
- Layout: left-aligned, one column `max-w-[1120px]`, 16px side gutter on phones (`px-4`), rows with hairlines instead of cards; one primary action per view ("Add to your agent" in the header; the hero repeats it once); 44px tap targets; works at 390px with no horizontal scroll; `prefers-reduced-motion` turns off the ring draw.
- Wording everywhere: "Ranked by Shipping" (never "Shipping points"); "of N builders" (never "this week" after a 12-week score); the feed is "Feed" in the nav and as its H1; "Not yet confirmed" label on unconfirmed weeks; "points" never "EARN points"; Backing words per Stage 2.
- Every copy constant stays in its current file under its current name unless a task says otherwise; tests that pin copy are updated to the new copy, never deleted; `copy-review`, `human-text`, `banned-words`, `footer-links`, `reserved-routes`, `fonts`, `profile-pages 10.5` (THEME equals globals.css; contrast 4.5:1 text, 3:1 ring stops) must pass.
- Run one test file from `/Users/jenil/earnkit-v3`: `DATABASE_URL=postgres://jenil@localhost:5432/earnkit_test npx tsx --test --import ./apps/frontend/lib/earnkit/fixtures/test-guard.ts apps/frontend/lib/earnkit/<file>.test.ts` (template first: `node apps/frontend/lib/earnkit/fixtures/test-db-template.mjs`). `next build` passes at the end of each task that touches a page.
- Visual check per page task: `pnpm dev` (or `next start` after build) on :3000 with a local database, screenshot at 1440x900 and 390x844 (Playwright MCP or `npx playwright screenshot`), saved under the SDD workspace (never under `docs/`), and compared against the constraints above before the task is reported done.
- Commit after each task on `v3-power-user`; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; no push.
- After the last task, update `docs/codebase-context/architecture-guide.md` ("v3 Stage 3"), `code-map.md` and `apps/frontend/DESIGN.md`.

## Review Focus

1. A profile with no score yet (confirming, or no project) must still render the header and the three-numbers row in a calm empty state, never a blank hero or "Code in 0 of 52 weeks". Pinned in Task 3 test (d).
2. The landing with an empty database (no ranked builder, no programs) must render the hero, an empty leaderboard line and an empty money line without the featured card, and never throw. Pinned in Task 2 test (e).
3. The hero's featured card must never show a hidden or held profile and must fall back silently when the featured handle is missing. Pinned in Task 2 test (d).
4. At 390px no page scrolls horizontally and every tap target is at least 44px; the install modal becomes a bottom sheet. Pinned by the visual check and Task 4 test (f).
5. Route-handler pages (sign-in, GitHub, setup, week, unsubscribe) must render the same header, fonts and tokens as the React pages, with status codes unchanged. Pinned in Task 6 test (a) and `page-shells.test.ts`.

---

### Task 1: Tokens and primitives (spec 5.8)

**Files:**
- Modify: `apps/frontend/lib/earnkit/theme.ts` (THEME values), `apps/frontend/app/globals.css` (variables, body, remove glow/gradient/marquee, keep `.ek-arc` and reduced motion), `apps/frontend/tailwind.config.ts` (tokens, drop `ek-blue-bright`/`ek-blue-soft`/`ek-score-orange` in favour of `ek-brand`, `ek-brand-hover`, `ek-chip`), `apps/frontend/app/components/common/Panel.tsx`, `Button.tsx`, `apps/frontend/app/[handle]/score-colors.ts` (SCORE_COLORS from THEME; PART_COLORS unchanged), `apps/frontend/DESIGN.md`
- Test: `apps/frontend/lib/earnkit/v3-tokens.test.ts`; update `profile-pages.test.ts 10.5` expectations if a key is renamed

**Interfaces:**
- `THEME` keys (rename where needed and update the two mirrors): `page '#000000'`, `pageTop '#000000'`, `glass 'rgba(0,0,0,0.85)'`, `surfaceTop '#0E1116'`, `surface '#0E1116'`, `raised '#161A22'`, `border 'rgba(255,255,255,0.12)'`, `borderStrong 'rgba(255,255,255,0.24)'`, `hairline 'rgba(255,255,255,0.12)'`, `chip 'rgba(255,255,255,0.06)'`, `chipHover 'rgba(255,255,255,0.12)'`, `track 'rgba(255,255,255,0.10)'`, `glow 'rgba(0,0,0,0)'`, `text '#FFFFFF'`, `body '#C9CDD6'`, `muted '#7E8694'`, `accent '#3D7BFF'`, `brand '#0052FF'`.
- `Panel.tsx`: `COLUMN = 'mx-auto w-full max-w-[1120px] px-4 md:px-8'`; `H1 = 'font-funnel-display text-[2.25rem] font-medium leading-[1.05] tracking-[-0.03em] text-ek-text md:text-[3.5rem]'`; `H2 = 'font-funnel-display text-2xl font-medium tracking-[-0.02em] text-ek-text md:text-[2rem]'`; `LEDE = 'mt-4 max-w-[36rem] font-funnel-sans text-base text-ek-body md:text-lg'`; `SURFACE` becomes a flat block `'border-t border-ek-line'` (kept for callers; no radius, no gradient); new `ROW = 'grid items-center gap-4 border-t border-ek-line py-4 md:py-5'`, `ROWS = 'border-b border-ek-line'`, `SECTION = 'py-14 md:py-24'`, `NUM = 'font-funnel-display tabular-nums tracking-[-0.02em]'`.
- `Button.tsx`: `BTN_PRIMARY` = pill, `bg-ek-brand text-ek-text hover:bg-ek-accent`, 48px; `BTN_SECONDARY` = pill, `border border-ek-line-strong text-ek-text hover:bg-ek-chip`.
- `globals.css`: body `background: var(--ek-p-page)`, no gradient, no glow; `::selection` brand; keep `.ek-arc`/`ek-arc-in` and both reduced-motion blocks; delete `ek-marquee` (Backed by becomes a static row in Task 2).
- `DESIGN.md`: rewrite to the Global Constraints of this plan (one page).

- [ ] **Step 1: Tests**: `(a)` every THEME value appears in globals.css as `--ek-p-<kebab>: <value>;` (extend the existing 10.5 helper); `(b)` contrast: text/page, body/page, muted/page ≥ 4.5; text/brand ≥ 4.5; `(c)` globals.css has no `gradient(` and no `box-shadow` outside `:focus-visible`; `(d)` tailwind config has no raw hex except in the THEME mirror.
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS** plus `profile-pages.test.ts`, `copy-review.test.ts`; `next build`.
- [ ] **Step 5: Commit** `feat(v3 site): tokens, primitives and DESIGN.md for the flat system`

---

### Task 2: Landing (spec 5.6 Landing, 5.8)

**Files:**
- Modify: `apps/frontend/app/HomeView.tsx`, `apps/frontend/app/components/sections/Hero.tsx`, `BenchTop.tsx`, `UpdateCarousel.tsx` (becomes `FeedRows.tsx`), `ProgramCards.tsx`, `ProgramCard.tsx` (becomes `ProgramRow.tsx`), `BackedBy.tsx` (static row, no marquee), `Header.tsx`, `InstallButton.tsx`, `Footer.tsx`, `AddToAgent.tsx` (restyle; bottom sheet on phones), `apps/frontend/lib/earnkit/landing.ts` (`Landing.featured`), `apps/frontend/app/lib/landing-cache.ts`
- Create: `apps/frontend/app/components/sections/FeaturedCard.tsx` (the live profile preview)
- Delete: `apps/frontend/public/videos/earnkit-launch.mp4`, `public/images/graphics/*`, `public/images/landing/FINAL_CTA.png`, `public/favicon-16x16.png` (remove from reserved routes)
- Test: `apps/frontend/lib/earnkit/v3-landing.test.ts`; update `landing.test.ts`, `public-pages.test.ts`, `install.test.ts`, `copy-review.test.ts` pins

**Interfaces:**
- Section order (`HomeView`): Hero; Leaderboard (top 10 rows); Feed (last finished week, up to 6 rows); Money open now (rows); Backed by; Footer. `landing.test.ts` order pin changes to this order with the new section titles: "Leaderboard", "Feed", "Money open now", "Backed by".
- Hero: H1 `BENCH_HERO_TITLE = 'Ship every week. Get funded.'` (unchanged); `BENCH_HERO_SUBTITLE = 'Add EarnKit to the agent you already use. It writes your weekly ship log from real commits, ranks you against every builder, and routes you to grants, accelerators and backers.'`; one primary button "Add to your agent"; no video, no second button, no stats line. Right of the text on desktop (under it on phones): `FeaturedCard`.
- `FeaturedCard` props `{ f: BenchCardFacts; log: { week: string; summary: string | null }[] (up to 2); points: number }`: the handle and name, the three numbers (Shipping, Rank, Earned when the Stage 2 field exists else omitted), the streak words, the two latest log lines; links to the page. `Landing.featured: FeaturedData | null` read in `readLanding` from `LANDING_FEATURED_HANDLE` (env, default `jenilt`) through `resolveHandle` + `benchCardFacts` + `profileData` (log slice); null when hidden, held, unranked or missing.
- Leaderboard section: `BENCH_TOP_TITLE = 'Leaderboard'`; `benchLine(n) = \`${n} ${n === 1 ? 'builder' : 'builders'}. Ranked by Shipping.\``; rows are `BenchRowItem` (Task 4 restyles it); empty line `BENCH_TOP_EMPTY = 'Nobody on the leaderboard yet. Add EarnKit to your agent and be first.'`; link "See the full leaderboard".
- Feed section: `FEED_SECTION_TITLE = 'Feed'`, rows from `feedWeeks(now)[0]?.cards` (`FeedRows` renders `UpdateCard` long shape restyled as a row: name, handle, project, summary, chips, Not yet confirmed); "See all" to `/feed`; hidden when empty.
- Money section: title "Money open now"; `open_text` and `open_more` lines (Stage 2); rows `ProgramRow` (logo, title, award, closes or Rolling or Opens soon, difficulty, In person), the whole row a link to the guide; empty: "No programs are open right now."
- Backed by: title and the 10 logos in a static wrapping row at 40% opacity, no motion.
- Header: wordmark, Leaderboard, Feed, Programs, Docs (internal `/docs` after Task 5; until then the GitHub link), one `InstallButton`; sticky; hairline bottom.
- Footer: tagline, the columns as `FOOTER_COLUMNS`, the company line; hairline top; no uppercase.
- `AddToAgent`: same AGENTS and copy; restyled: flat sheet, hairline tabs, `BTN_PRIMARY` copy button; on phones a bottom sheet (`fixed inset-x-0 bottom-0`), 44px targets, focus rings.

- [ ] **Step 1: Tests**: `(a)` HomeView order by indexOf of the four titles; `(b)` exactly one `<button>Add to your agent</button>` in the header and one in the hero (`landing.test.ts` pin moves from "exactly one" to "exactly two, header and hero"); `(c)` no `<video`, no `builder-blue`, no `uppercase`, no `gradient` class in the rendered HTML; `(d)` `readLanding` featured is null for a hidden profile and for a missing handle; `(e)` HomeView with `landing = null` and with an empty bench renders the hero and the empty lines without throwing; `(f)` `FeaturedCard` renders the three numbers and links to the page.
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement**, then the visual check at 1440 and 390. **Step 4: Run; PASS** plus `landing.test.ts`, `public-pages.test.ts`, `install.test.ts`, `copy-review.test.ts`, `reserved-routes.test.ts`, `footer-links.test.ts`; `next build`.
- [ ] **Step 5: Commit** `feat(v3 site): landing as statement, live card, rows and one action`

---

### Task 3: Profile (spec 5.6 Profile)

**Files:**
- Modify: `apps/frontend/app/[handle]/BenchProfileView.tsx`, `ProjectTab.tsx`, `BadgeCopy.tsx`, `ScoreRing.tsx` (size and colours from THEME), `ShipGrid.tsx` (hairline cells), `apps/frontend/app/components/ui/UpdateCard.tsx` (row styling; the `long` shape is a row), `apps/frontend/lib/earnkit/bench-data.ts` (`ProfileData.money: MoneyTabData`)
- Create: `apps/frontend/app/[handle]/MoneyTab.tsx`, `apps/frontend/app/[handle]/ShareButton.tsx`
- Test: `apps/frontend/lib/earnkit/v3-profile.test.ts`; update `profile-bench.test.ts`, `v213-copy.test.ts`, `leaderboard-clarity.test.ts` pins

**Interfaces:**
- Header row: avatar 56px, name as H1 (display 40px), `@handle`, the `ShareButton` (secondary, "Share", links `/<handle>/share`), and when backing is open the "Back <project>" button (Stage 2) beside it.
- The three numbers row (`data-ek-numbers`): Shipping (ring 96px, number inside, caption "Shipping"), Rank (big number `#3`, caption `of 40 builders`; or `Top 4%`), Earned (`$340`, caption "Earned"; `$0` when ranked and nothing yet; omitted while unranked). Under the row: `why` sentence and the page-voice target as one muted line; Originality as a small line; points as a small line with `POINTS_PAGE_LINE` in a tooltip-free muted sentence.
- Grid: `ShipGrid` 52 cells, hairline cells, brand fill for `on`; caption `Code in N of the last 52 weeks` (unchanged words).
- Tabs: `TAB_LOG = 'Ship log'`, `TAB_PROJECT = 'Project'`, `TAB_MONEY = 'Money'` (`?tab=money`). Ship log: `UpdateCard` rows newest first with the week label left, summary and note right, chips under, Not yet confirmed label. Project: unchanged content, restyled as rows. Money: `MoneyTabData = { fits: { title, prize, when, why, href }[]; applied: { title, status: 'applied' | 'won' }[]; backing: ProfileData['backing']; points: number }` rendered as three groups with H2s "Programs that fit", "Applications", "Backing" (the last only with the flag on and open), then the points line.
- Empty states: confirming → `confirmingCardLine`; no project → `noProjectLine`; both render the header row and a muted three-numbers row with dashes (`data-ek-numbers` present).
- Visitor box: `VISITOR_CTA` and the install button, as a hairline row near the end.
- Badge: `BadgeCopy` collapses to one line "Badge for your README" that expands to the markdown and Copy; the badge image shows always when ranked.

- [ ] **Step 1: Tests**: `(a)` `data-ek-numbers` has three children for a ranked profile, with "Shipping", "of N builders", "Earned"; `(b)` the Money tab renders the three H2s and the points line; `(c)` the share link `href="/<handle>/share"` is present; `(d)` confirming and no-project states render the header and `data-ek-numbers` with dashes; `(e)` no "this week" after "builders" anywhere on the page; `(f)` no `rounded-[24px]`, no `gradient`.
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement**, visual check. **Step 4: Run; PASS** plus `profile-bench.test.ts`, `v213-copy.test.ts`, `v3-unconfirmed.test.ts`, `v3-points.test.ts`; `next build`.
- [ ] **Step 5: Commit** `feat(v3 site): the profile as three numbers, a grid and a dated log; Money tab; share`

---

### Task 4: Leaderboard, Feed, Programs and the guide; the wording sweep (spec 5.2, 5.6)

**Files:**
- Modify: `apps/frontend/app/leaderboard/BenchView.tsx`, `BenchRowItem.tsx`, `apps/frontend/app/feed/FeedView.tsx`, `apps/frontend/app/programs/page.tsx`, `apps/frontend/app/programs/[id]/GuideView.tsx`, `apps/frontend/app/components/ui/FilterChip.tsx`, `apps/frontend/app/not-found.tsx`
- Modify (wording): `apps/frontend/lib/earnkit/rank.ts:26-37` (`rankLine`/`scoreLine`: "of N builders", no "this week"), `apps/frontend/app/components/sections/BenchTop.tsx benchLine`, `apps/frontend/app/feed/FeedView.tsx` (`FEED_TITLE = 'Feed'`, `FEED_LINE = 'What builders on the leaderboard shipped, week by week. Every fact is checked.'`), `apps/frontend/lib/earnkit/weekly-moment.ts shareText` ("of N builders"), `apps/frontend/lib/earnkit/badge.ts` (value text unchanged apart from the rank words)
- Test: `apps/frontend/lib/earnkit/v3-pages.test.ts`; update `bench-page.test.ts`, `leaderboard-clarity.test.ts`, `feed.test.ts`, `public-pages.test.ts`, `weekly-moment.test.ts`, `v214-replies.test.ts`, `profile-bench.test.ts` and every pin that carries "builders this week" (grep `builders this week` across `*.test.ts` and `fixtures/`)

**Interfaces:**
- Leaderboard: H1 "Leaderboard", line `benchLine(count)`; filter chips (chains, "Shipping every week", "Backed" under the flag) as hairline pills with `aria-pressed`; rows: rank number (display, 24px) | avatar + name + handle + chain logos | project and best fact | Shipping number; `grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)_5rem]` on md, two lines on phones; hairlines between rows; the whole row a link.
- Feed: H1 `FEED_TITLE = 'Feed'`; week headings as H2 "Week of Oct 12"; rows as in Task 3; empty `FEED_EMPTY` unchanged.
- Programs: H1 "Money open now" (the landing and the page share the heading); the two money lines; `ProgramRow`s; guide page: H1 title, the facts line as separate muted spans (award, closes/rolling/opens soon, chain), `opens_note` line, "Difficulty" line, Ask your agent (open only), "What won", "What X wants now" chips, "Your best bet", Sources.
- 404: `NOT_FOUND_TITLE`, `NOT_FOUND_LINE`, two links.
- Wording: `rank.ts rankLine` renders `#3 of 40 builders` / `Top 4% of builders`; `scoreLine` therefore `Shipping 72 · #3 of 40 builders`; the words "this week" leave every rank string, reply and page. `copy-review` gains the rule: no "this week" within 20 characters after "builders".

- [ ] **Step 1: Tests**: `(a)` leaderboard HTML has no "Shipping points" and no "this week"; rows carry `data-rank` and `data-points`; `(b)` feed H1 is "Feed"; `(c)` programs page H1 "Money open now" and the two lines; `(d)` guide renders `opens_note` for an upcoming program and no Ask button; `(e)` `rankLine({ranked:true, rank:3, total:40})` is "#3 of 40 builders"; `(f)` BenchView at a 390px render has no element wider than the column (assert no `min-w-[` over 20rem and no `whitespace-nowrap` on row text).
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement**, visual check of the four pages. **Step 4: Run; PASS** plus the full suite (the wording sweep touches many pins); `next build`.
- [ ] **Step 5: Commit** `feat(v3 site): leaderboard, feed, programs and guide as rows; "of N builders" everywhere`

---

### Task 5: The Docs page and the links (spec 5.6 Landing: Docs)

**Files:**
- Create: `apps/frontend/app/docs/page.tsx`, `apps/frontend/app/docs/DocsView.tsx`, `apps/frontend/lib/earnkit/docs-copy.ts`
- Modify: `apps/frontend/lib/earnkit/footer-links.ts` (`DOCS = '/docs'`, "For sponsors" → `/docs#selectors`), `apps/frontend/lib/earnkit/reserved-routes.ts` (add `docs`), `apps/frontend/app/components/sections/Header.tsx` (internal link, same tab), `apps/frontend/lib/earnkit/brand-page.ts` (nav Docs link), `apps/frontend/app/sitemap.ts` (add `/docs`), `apps/frontend/app/lib/links.ts` (delete the unused constants), `README.md` (point to earnkit.com/docs)
- Test: `apps/frontend/lib/earnkit/v3-docs.test.ts`; update `public-pages.test.ts:58`, `footer-links.test.ts`, `reserved-routes.test.ts`

**Interfaces:**
- `docs-copy.ts` holds every string. Sections (H2s, in order): "Add EarnKit to your agent" (the AGENTS steps from `AddToAgent.tsx AGENTS`, rendered as rows per agent with the command in a code block); "What your agent can do" (five lines: where you stand; your ship log, written from commits; programs that fit and a drafted application; backing, once you have shipped; points); "The three numbers" (Shipping, Rank, Earned, one sentence each; Originality one line); "How the week works" (Monday: EarnKit writes the week and emails you; Looks right or Hide; your note; the share link); "For program selectors" (`id="selectors"`: what a page proves, the JSON at `/api/builders/<handle>.json`, the badge, contact j@earnkit.com); "Terms" link. Under 600 words in all.
- Header and footer link `/docs` in the same tab; `brandShell` nav too.

- [ ] **Step 1: Tests**: `(a)` `/docs` renders the six H2s in order and the six agent names; `(b)` footer and header `href="/docs"`; no external docs link remains; `(c)` `reserved-routes` includes `docs`; `(d)` docs copy has no em dash, no emoji, under 600 words.
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement**, visual check. **Step 4: Run; PASS** plus `public-pages.test.ts`, `footer-links.test.ts`, `reserved-routes.test.ts`, `page-shells.test.ts`; `next build`.
- [ ] **Step 5: Commit** `feat(v3 site): the Docs page; footer and header links; dead link constants removed`

---

### Task 6: The HTML shell pages, the share card, the badge, the OG image (spec 5.6, 5.8)

**Files:**
- Modify: `apps/frontend/lib/earnkit/brand-page.ts` (CSS from THEME: black page, hairlines, Funnel Sans for text via the data: fonts already embedded, Funnel Display headings; `.ek-panel` flat with a hairline; `.ek-btn` as `BTN_PRIMARY`), `apps/frontend/lib/earnkit/digest.ts:530-540` (the unsubscribe page uses `brandShell`), `apps/frontend/app/[handle]/card-response.tsx` (palette from THEME: black, white, body, brand; the "Backing" pill), `apps/frontend/lib/earnkit/badge.ts` (label `#000000`, value `#0052FF`, white text, muted `#7E8694`), `apps/frontend/public/og.png` (regenerated)
- Create: `apps/frontend/scripts/og.mts` (renders the OG image from the same renderer as `card-response.tsx`: headline `BENCH_HERO_TITLE`, subline, the wordmark; 1200x630; writes `public/og.png`)
- Test: `apps/frontend/lib/earnkit/v3-shells.test.ts`; update `page-shells.test.ts`, `card-route.test.ts 11.8`, `badge.test.ts`, `v214-signin-link.test.ts` as needed (structure pins stay)

**Interfaces:**
- `brandShell`: unchanged signature; its CSS is built from `THEME` (import, as today) so Task 1's values flow in; the `<header class="ek-top">` structure stays (pinned); text uses Funnel Sans (embed the sans woff as the display one is embedded, or fall back to `system-ui` only when the file is missing).
- Week page (Stage 1 Task 6) and unsubscribe page render through `brandShell`.
- Card: 1200x630, black, the wordmark top-left, name and handle, the rank line as the headline in Funnel Display 64px, project and streak, the page URL; the pill reads `Backing · $SYM` when open.
- Badge: unchanged geometry; colours as above; `aria-label` unchanged.

- [ ] **Step 1: Tests**: `(a)` every brandShell page (the `page-shells` set plus `/api/week` GET and the unsubscribe GET) contains `--ek-p-page: #000000` or the equivalent inline value and `ek-top`; `(b)` `card-response.tsx` source has no hex outside THEME imports (allowlist the two fonts); `(c)` `badgeSvg` contains `fill="#000000"` and `fill="#0052FF"`; `(d)` `scripts/og.mts` writes a PNG of 1200x630 (check the IHDR bytes).
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement**; run `npx tsx apps/frontend/scripts/og.mts`; visual check of a sign-in page, the GitHub confirm page, the week page, the card and the OG image. **Step 4: Run; PASS** plus `page-shells.test.ts`, `card-route.test.ts`, `badge.test.ts`, `v214-signin-link.test.ts`, `v3-monday-email.test.ts`.
- [ ] **Step 5: Commit** `feat(v3 site): shell pages, share card, badge and OG image on the new tokens`

---

### Task 7: Copy pass, the full-site visual check and docs

- [ ] A pass over every reply constant and page string against spec 5.2 and 5.5 (names of the three numbers; "Ranked by Shipping"; "of N builders"; "Feed"; "points"; Backing words; no "this week"; no "community round"; one question per reply); fix stragglers; `copy-review` and `human-text` green.
- [ ] Full visual check: every page at 1440 and 390, every empty state (no builders, no programs, no feed, confirming profile, no-project profile, 404), the install modal open on both widths, a sign-in page, the week page; screenshots in the SDD workspace; a short findings table in the task report; fix what fails the constraints.
- [ ] `docs/codebase-context/architecture-guide.md` "v3 Stage 3", `code-map.md`, `DESIGN.md` final.
- [ ] Full suite green; `tsc` clean; `next build`; `eslint .` 0 errors.
- [ ] Commit `feat(v3 site): copy pass, visual check and docs`
