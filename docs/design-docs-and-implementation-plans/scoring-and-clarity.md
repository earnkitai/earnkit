# Scoring and clarity

Owner request, 2026-10-19. Branch `scoring-and-clarity` off main (c6fc4951), one PR, no merge or deploy. No token, coin or community round step in these flows.

EarnKit's goal is to connect builders with capital. Moving up means shipping more and ranking higher, never launching a token.

## Decisions (controller rulings)

| # | Decision |
|---|---|
| R1 | **One score, Shipping, 0 to 100 (owner, 2026-10-19).** It answers one question: how often you ship real code. Used and Earned are removed from the score, the profile, the feed chips and the MCP replies. Their stored inputs stay; nothing destructive. |
| R2 | **Shipping** = round(90 × Σ w_i·active_i / Σ w_i) + live bonus. i = 0..11 is the week age (0 = this week). active_i = 1 when the repo has commits that week. w_i = 12 − i, so recent weeks weigh more (Σ = 78). Live bonus = 10 when a live site, contract deploy or published package exists. It is one cheap read from the GitHub App. |
| R3 | **Originality, 0 to 100, a separate value.** It is shown next to Shipping and is not ranked (owner question below). The hourly cron computes it (within an hour of a project connecting, never in a request), and again only when its description changes: its README and description are embedded once. The embedding is compared with every other project on EarnKit (the nearest neighbours) and with a small cached set of known public ideas (`programs/ideas/known-ideas.json`, embedded once). Originality = clamp(round(100 × (0.9 − max similarity) / 0.55), 0, 100): a similarity of 0.35 or less gives 100, and 0.9 or more gives 0. It is free: a small local embedding model runs in the app (no paid API). |
| R4 | **Ranked** means a confirmed (App-proven) project with at least one repo reading. A builder with no commits is ranked at 0, never hidden. Rank = 1 + the number of listed ranked builders with a higher score. |
| R5 | **Scored right after the App connects.** `proveByApp` reads the repo in the same request (one installation-token reading), then rescores. The builder's next reply and page show a real score. |
| R6 | **Rank wording, everywhere:** under 20 ranked, "#N of M builders this week". From 20, "Top P% of builders this week" for the top half and "#N of M builders this week" for the rest. Every ranked builder sees a rank. The leaderboard has a points column (Shipping). |
| R7 | **Why sentence:** one plain sentence on why, plus what raises it next week. Example: "Code in 7 of the last 12 weeks, 3 of the last 4. Ship code this week to add up to 11 points." |
| R8 | **Move up:** after connecting, the next step is always "Ship this week to climb", plus up to 3 funding programs that fit. No coin, token or community round in the default find/score path. They show only when the builder asks about a token (`tell coin`, `confirm { project_id }`, the token tools). |
| R9 | **"the Bench" becomes "the leaderboard"** in all user-visible text: pages, nav, MCP replies, OG, llms.txt, terms. `/leaderboard` is the page, and `/bench` redirects there with a 308. Internal identifiers (`bench_*`, `benchView`, the DB columns) stay. |
| R10 | **One status line and one next step per reply.** A reply never says "not on the leaderboard" while showing a rank: `rank_lines` is empty unless the reply's state is ranked, and news never contradicts the status. |
| R11 | **Names are never cut.** Tickers use the full first word up to 10 letters ("EarnKit" gives $EARNKIT), else initials. Project and token names are never sliced in replies, cards or OG; long text wraps. |
| R12 | **Funding matches:** at most 3 programs that fit the repo's chains, live status and contracts. Each shows its deadline (date, or "rolling") and one line on why it fits. arc-microgrants, colosseum-worlds-fair and monad-metropolis are set to `"status": "closed"`. |
| R13 | **Backfill on connect:** at the first App connect, ship-log entries for the last 3 finished weeks are written from the repo's commits, in the same format as the weekly job. The weekly job's per-week body becomes one shared helper. Idempotent through `UNIQUE(project_key, week)` and `facts.checked`. A rerun never duplicates. |
| R14 | **Every sign-in and verify page** (github-verify, App setup, OAuth errors, the X callback 404) uses `brand-page.ts brandShell` (the dark shell with the slim top bar). No unstyled HTML or plain text is left. |
| R15 | **Lint works again:** `next lint` was removed in Next 16, so the script becomes `eslint .` with `.next/` ignored, `_`-prefixed unused vars allowed, and the remaining errors fixed. |

| R16 | **Owner-approved simplifications, 2026-10-19:** (a) the proven and shipping reply states merge into one `ranked` state (four states); (b) stars, users and traction are no longer read, since no score uses them, and program wins stay as profile facts; (c) one score line everywhere: "Shipping 72 · #3 of 40 builders this week"; (d) one rank phrase helper; (e) per-chain ranks drop the 10-builder minimum and use the same wording as the main rank. |
| R17 | **The leaderboard table** has a Shipping points column. |

| R18 | **Design system and simplification (owner, 2026-10-19).** The profile and feed redesign from #46 is tuned to blend with the rest of the site, using the shared tokens (THEME / --ek-p-*). The whole site is simplified to be minimal: fewer sections, fewer words, one idea per block. Overworded or confusing copy is rewritten. |
| R18 fix 1 | **Leaderboard rows (owner, 2026-10-19; supersedes R6 for rows):** a row shows "#N" alone; the full rank line is read to screen readers, and one header line says what it is out of: "N builders this week. Ranked by Shipping points." (on /leaderboard and under the landing's title). R6 wording stays everywhere else (profile, replies, OG). The profile grid counts commit weeks only (`builder_projects.commit_weeks`). #46's gradient hues stay as the profile's accent palette (owner). |

## Tasks

1. Score: R1, R2, R4 to R7 and R5's read at connect (score-v2, person-score, bench-data, ScoreParts, rank, bench-rank, stand-text, profile, feed chips, replies, OG).
2. Originality: R3.
2b. Backfill on connect: R13.
2c. Stop the unused reads: R16b. (week-facts helper, repo-proof hook).
3. The leaderboard and consistent messages: R6, R9, R10, R11, R17 (copy, routes, rank_lines rule, tickers).
4. Move up, funding matches and four states: R8, R12, R16a (bench-reply nextStepAsk, bench-find, fund lines, program files).
5. Page shells and lint: R14, R15.
5b. Design system and site-wide simplification: R18 (after every functional task, so it styles the final state).
6. Screenshots and the PR.

## Owner questions

- Originality is shown but not ranked until its spread on real projects is known (embedding similarity is noisy, and a fork with a rewritten README can game it). Should it later blend into the rank?
