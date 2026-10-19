# Scoring and clarity

Owner request, 2026-10-19. Branch `scoring-and-clarity` off main (c6fc4951), one PR, no merge or deploy. No token, coin or community round step in these flows.

EarnKit's goal is to connect builders with capital. Moving up means shipping more and ranking higher, never launching a token.

## Decisions (controller rulings)

| # | Decision |
|---|---|
| R1 | **Score is two parts, out of 100.** Shipped (max 50) and Consistency (max 50). Used and Earned are removed from the score, the profile, the feed chips and the MCP replies. Their stored inputs stay in the database; nothing destructive. |
| R2 | **Shipped (max 50)** = 10 per week with commits in the last 4 weeks, this week included (max 40), plus 5 per live ship (a live site, a contract deploy, a published package; max 10). |
| R3 | **Consistency (max 50)** = round(50 × weeks with commits in the last 12 weeks, this week included, / 12). |
| R4 | **Ranked** means a confirmed (App-proven) project with at least one repo reading. A builder with no commits is ranked at 0, never hidden. Rank = 1 + the number of listed ranked builders with a higher score. |
| R5 | **Scored right after the App connects.** `proveByApp` reads the repo in the same request (one installation-token reading), then rescores. The builder's next reply and page show a real score. |
| R6 | **Rank wording, everywhere:** "#N of M builders this week" ("#1 of 1 builder this week"). The "Top P%" form goes. |
| R7 | **Why sentence:** one plain sentence on why, plus what raises it next week. Example: "Code in 3 of the last 4 weeks and 5 of the last 12. Ship code this week to add up to 10 points." |
| R8 | **Move up:** after connecting, the next step is always "Ship this week to climb", plus up to 3 funding programs that fit. No coin, token or community round in the default find/score path. They show only when the builder asks about a token (`tell coin`, `confirm { project_id }`, the token tools). |
| R9 | **"the Bench" becomes "the leaderboard"** in all user-visible text: pages, nav, MCP replies, OG, llms.txt, terms. `/leaderboard` is the page, and `/bench` redirects there with a 308. Internal identifiers (`bench_*`, `benchView`, the DB columns) stay. |
| R10 | **One status line and one next step per reply.** A reply never says "not on the leaderboard" while showing a rank: `rank_lines` is empty unless the reply's state is ranked, and news never contradicts the status. |
| R11 | **Names are never cut.** Tickers use the full first word up to 10 letters ("EarnKit" gives $EARNKIT), else initials. Project and token names are never sliced in replies, cards or OG; long text wraps. |
| R12 | **Funding matches:** at most 3 programs that fit the repo's chains, live status and contracts. Each shows its deadline (date, or "rolling") and one line on why it fits. arc-microgrants, colosseum-worlds-fair and monad-metropolis are set to `"status": "closed"`. |
| R13 | **Backfill on connect:** at the first App connect, ship-log entries for the last 3 finished weeks are written from the repo's commits, in the same format as the weekly job. The weekly job's per-week body becomes one shared helper. Idempotent through `UNIQUE(project_key, week)` and `facts.checked`. A rerun never duplicates. |
| R14 | **Every sign-in and verify page** (github-verify, App setup, OAuth errors, the X callback 404) uses `brand-page.ts brandShell` (the dark shell with the slim top bar). No unstyled HTML or plain text is left. |
| R15 | **Lint works again:** `next lint` was removed in Next 16, so the script becomes `eslint .` with `.next/` ignored, `_`-prefixed unused vars allowed, and the remaining errors fixed. |

## Tasks

1. Score: R1 to R7 and R5's read at connect (score-v2, person-score, bench-data, ScoreParts, rank, bench-rank, stand-text, profile, feed chips, replies, OG).
2. Backfill on connect: R13 (week-facts helper, repo-proof hook).
3. The leaderboard and consistent messages: R6, R9, R10, R11 (copy, routes, rank_lines rule, tickers).
4. Move up and funding matches: R8, R12 (bench-reply nextStepAsk, bench-find, fund lines, program files).
5. Page shells and lint: R14, R15.
6. Screenshots and the PR.
