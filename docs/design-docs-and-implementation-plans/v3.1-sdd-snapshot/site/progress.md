# SDD ledger — plan: docs/design-docs-and-implementation-plans/v3.1-plan-site.md
Spec: docs/design-docs-and-implementation-plans/v3.1-site-design.md (frozen, owner-approved); canvas https://claude.ai/artifact/MR4rD7VoQWrUaKMNFJzyet
Branch start for this plan: dd1ae3cb
Rulings carried: all 12 site-plan defaults accepted (see v3.1-plan-p0 ledger).
Task 1: dispatched (BASE dd1ae3cb)
Account switched 2026-10-21 (now j@earnkit.com). Canvas MR4rD7... not readable from this account; approved boards committed at docs/design-docs-and-implementation-plans/v3.1-site-boards/ (98887670). Every later site dispatch must point implementers/reviewers there. Task 1 resumed after the rate-limit stop.
Task 1: implemented a9b72676 (DONE_WITH_CONCERNS: site-copy.ts created with scoreBand only (Task 2 must extend); controller art/font copies removed in favour of sized files; Pager colours mapped to nearest tokens); review dispatched (Opus)
Task 1: complete (commits 0e623c72..a9b72676, review clean)
Ruling: metal pill gradients and avatar/logo tile colours become SITE tokens (added in Task 2, mirrored in globals.css and the token test) — keeps "colours only from SITE" true — cost if wrong: a few extra tokens.
Task 1: carry to Task 5: theme-color meta still THEME.page #000; DocsView/AddToAgent still bg-ek-page; Pager clamp page into 1..pages and no hover on disabled ends.
Task 1: minor (deferred): Kaftan fallback is Arial-adjusted (consider adjustFontFallback 'Times New Roman'); hero 2x desktop loads 3200 variant (consider a 2400w); XHandle new-tab hint.
Task 2: dispatched (BASE a9b72676)
Task 2: implemented 171303d0 (deviations: site-copy imports SITE; own copy-sweep regexes instead of BANNED_WORDS); review dispatched (Opus)
Task 2: review found ~45 MB scratch art (.superpowers/art) swept into 171303d0 and pushed. Ruling: controller amended the commit to drop .superpowers/art, added .superpowers/ to .gitignore, force-pushed the feature branch with lease (now e998512f; only this branch, never main) — mechanical hygiene, no code changed — cost if wrong: the orphaned blobs linger on GitHub until GC.
Task 2: complete (commits a9b72676..e998512f, review clean otherwise; deviations accepted)
Task 2: minor (deferred): no sentence-case check in sweep; BENCH_EXTRA backing words not swept; regexes copied not imported; compactNumber 999.6 -> $1000 and negatives; glow/shine values unpinned; no RED run captured.
Task 3: dispatched (BASE e998512f)
Task 3: implemented 4669c804 (concerns: pill title via rankLine repeats label; 0-weeks sub; optional pool param). Ruling: pill title = '#N of M builders' (+ ' on Base' when Base-ranked) per board hover — the rankLine form repeats the pill label — cost if wrong: one string. Review dispatched (Opus)
Task 3: review Needs fixes (pill title form; Token card guard must fail closed on main read error). Fix round 1 sent (+ dedupe mainOf/mainReading, log message, n=0 start sub -> "First week on EarnKit"). FIX_BASE 4669c804
Task 3: minor (deferred): standingPill re-scans pool (rankLines could expose rank/total); contractItem lower() defeats index; Won highlight uses submitted_at; Base 2s block time assumption comment.
Task 3: fix round 1/5 (5 addressed, 0 open; commits 4669c804..0e6a6b9c)
Task 3: complete (commits e998512f..0e6a6b9c, review clean after fix round 1)
Task 3: minor (deferred): highlights [] when main null skips the "On EarnKit since" fallback
Task 4: dispatched (BASE 0e6a6b9c)
Task 4: implemented 0154c53b (concerns: chip 'grants and prizes' triggered by Circle pool_usd; interim HomeView; old landing tests rewritten; went_live counts all visible updates). Ruling: chip says 'grants' unless a summed program is a prize/hackathon by kind; pool_usd does not decide wording — Circle is a grant — cost if wrong: one word. Review dispatched (Opus)
Task 4: review Needs fixes (chip wording keyed on pool_usd; applications counted unlisted/campaign programs). Fix round 1 sent (+ feed stats visibility rule, stale comments, rounding test). FIX_BASE 0154c53b
Task 4: carry to Task 6 (landing page): do NOT deploy between Task 4 and Task 6 (interim HomeView drops leaderboard section; week label can be wrong); delete BenchTop/FeaturedCard and their pinned tests; feed page calls feedWeekStats once.
Task 4: fix round 1/5 (4 addressed, 0 open; commits 0154c53b..209a1eee)
Task 4: complete (commits 0e6a6b9c..209a1eee, review clean after fix round 1)
Task 4: minor (deferred): isPrizeProgram regex would mark a grant mentioning "prize" as hackathon
Task 5: dispatched (BASE 209a1eee)
Task 5: implemented f0c3f325 (concerns: v3 leaderboard row shows Backing for jenilt in local seed with raising on (prod checked: backing null, not live) -> Task 8 must pin; AgentMark #FFFFFF per brief; footer top margin and Kaftan sheet title added; seed disables triggers locally). Review dispatched (Opus)
Task 5: complete (commits 209a1eee..f0c3f325, review clean)
Task 5: carry to Task 6: add id="earn" anchor; llms/v213.txt "All open programs: /programs" -> /#earn; AgentMark fill currentColor + text-s-text (no raw hex); footer CTA text-balance on phone; sheet tab rail cut-off hint.
Task 5: carry to Task 8: Backing chip must never show for earnkitai/earnkit (seen on v3 row with raising on, local only); pin it.
Task 5: minor (deferred): test (f) stub has no effect (server snapshot); seed guard host check; AddToAgent portal comment stale; footer top margin confirm.
Owner question for the final report: X account x.com/EarnKitAI (site) vs x.com/earnkit_ai (deck/canvas).
Task 6: dispatched (BASE f0c3f325)
Task 6: implemented 76334033 (concerns: ProgramCards.tsx kept as shim for copy-review import; v213-copy 12.7 allows commit(s)/repo on landing; phone chip 44px; v3 leaderboard shows leaderboardLine pre-Task 8). Controller viewed screenshots: matches board. Review dispatched (Opus)
Task 6: review Needs fixes (hero sizes underestimates width below 1240px -> phone/tablet upscale; plan-mandated). Ruling: override the plan's sizes string to "(min-width: 768px) 1198px, 865px" — owner bar "no compromise on quality" — cost if wrong: phones download the 1600w file instead of 800w (+180 KB).
Task 6: fix round 1 sent (+ 12.7 narrowed to STEPS[0], tap targets, motion-safe transitions, server-only guard, || fallback). FIX_BASE 76334033
Task 6: minor (deferred): ProgramCards.tsx shim (dead props) delete after copy-review moves (P0 follow-up); pointermove rect caching; decoding=async on LCP.
Task 6: fix round 1/5 (6 addressed, 0 open; commits 76334033..412740cf)
Task 6: complete (commits f0c3f325..412740cf, review clean after fix round 1)
Task 6: minor (deferred): CARD_NEUTRAL string-replace for motion-safe is brittle (test (i) guards); pure-import guard regex single-line only.
Task 7: dispatched (BASE 412740cf)
Task 7: implemented 5427c036 (concerns: footer gap ~120px vs 72px; blue letter tile on navy token card; token card needs coin address; Pager/Avatar small shared edits; ShipGrid/BadgeCopy kept for tests). Controller viewed maya/sam shots. Review dispatched (Opus)
Task 7: review Needs fixes (streak current-week square unlit vs "This week: N"; code-map lost ~100 unrelated lines). Fix round 1 sent (+ coin uses project colour, "$" in Funnel Sans via shared money helper across token card/opportunities/chip, thousands separator, duplicate commits chip, minimal footer gap 72px). FIX_BASE 5427c036
Ruling: "$" glyph rendered in Funnel Sans beside Kaftan digits everywhere money shows — Kaftan's "$" reads as "S" — cost if wrong: a subtle font mix in numbers.
Ruling: keep "$0 earned by <name>" on a new Token card — matches the approved board — cost if wrong: owner may want a softer zero state.
Task 7: fix round 1/5 (7 addressed, 1 new Important: Streak vs Highlights disagree after the view-only bump; commits 5427c036..884cd802)
Task 7: fix round 2 sent (one shared withThisWeek helper used by profileSite highlights and the streak card). FIX_BASE 884cd802
Task 7: fix round 2/5 (1 addressed, 0 open; commits 884cd802..2b178ca1)
Task 7: complete (commits 412740cf..2b178ca1, review clean after fix round 2)
Task 8: dispatched (BASE 2b178ca1)
Task 8: implemented 253595c0 (rulings: podium pill = whole-board rank in card metal; podium no Backed tag; streak 0 shows nothing; filter rail hidden when nobody ranked; concerns: phone rows wrap project; no-photo avatar style). Controller viewed leaderboard-1440: matches board. Review dispatched (Opus)
Task 8: complete (commits 2b178ca1..253595c0, review clean)
Ruling: podium metal follows the builder's whole-board rank (gold 1, silver 2, bronze 3, plain pill above 3) instead of card position — a silver "#5" mixes meanings — carried to Task 11 — cost if wrong: filtered podiums look plainer.
Task 8: carry to Task 11: podium metal by rank; phone rows put project on its own line without "· "; duplicate "Builders" landmark label; run a final full suite.
Task 8: minor (deferred): BENCH_MAX 100 caps paging at 5 pages; no Backed tag on the podium (owner note); no-photo avatar uses initial (shared Avatar).
Task 9: dispatched (BASE 253595c0)
Task 9: implemented 2be13c90 (concerns: phone stats stack 1-up; builders shipped uncapped vs 20-card cap; FEED_LINE not shown; builder note quote dropped). Review dispatched (Opus).
Ruling: the builder's own note stays on feed rows as a short quoted line when present (v3 weekly-updates feature: the builder's voice) — cost if wrong: one extra line on some rows.
Ruling: phone stat cards 2-up grid — 600px of stats before the first row is too much on a phone — cost if wrong: smaller numbers on phone.
Task 9: review Needs fixes (note dropped; phone stats 1-up; builders stat > rows silently). Fix round 1 sent. FIX_BASE 2be13c90
Ruling: show "Showing the top <n> of <N> builders" when the uncapped stat exceeds the shown rows — honest copy beats capping the stat — cost if wrong: one extra quiet line on busy weeks.
Task 9: fix round 1/5 (4 addressed, 0 open; commits 2be13c90..6e2cc54d)
Task 9: complete (commits 253595c0..6e2cc54d, review clean after fix round 1)
Task 10: dispatched (BASE 6e2cc54d)
Task 10: implemented c1ad215c (concerns: phone install tabs scroll in rail vs board wrap; terms inline links 20px on phone; terms section headings old font; docs lost contact email/terms link/badge path; SegTabs light variant). Review dispatched (Sonnet).
Ruling: keep the docs page as minimal as the board (no contact email, terms link lives in the footer, badge path dropped with the profile badge block) — cost if wrong: a builder looking for the README badge URL must ask.
Task 10: carry to Task 11: terms inline links 44px tap targets on phone; terms section headings in Kaftan display.
Task 10: complete (commits 6e2cc54d..c1ad215c, review clean)
Ruling: docs install tabs wrap on phone (light tone only) so all agents show, matching the board — carried to Task 11 — cost if wrong: two rows of tabs on phone.
Task 10: carry to Task 11: docs tabs wrap on phone; tab keyboard roving tabIndex or aria-pressed; "Copy failed" announce; SHIPPING_WEEKS in score copy; selectors URL breaks at "/"; terms inline links 44px; terms headings Kaftan; podium metal by rank; phone rows project line; duplicate Builders landmark.
Task 11: dispatched (BASE c1ad215c)
Task 11: implemented d4a8757d (concerns: plain pill after #3 dark tint; docs wrapped tab row 26px radius; legal sub-headings stay Funnel Display; no RED run). Review dispatched (Opus)
Task 11: complete (commits c1ad215c..d4a8757d, review clean)
Task 11: carry to final fix wave: terms INLINE_LINK after:-inset-y-3 plus py-3 gives ~68px overlapping hit areas (drop after: inset where padded); sweep (d) file-level exemption and variant-prefix lookbehind are coarse; shoot /leaderboard?chain=base full seed once.
Task 11: minor (deferred): sweep (a) page-copy banned list subset (owner to confirm); docs test (g) reads source; risk sub-headings keep Funnel Display (owner).
Task 12: dispatched (BASE d4a8757d)
Task 12: implemented b30decdb (docs only). Review dispatched (Sonnet)
Task 12: complete (commits d4a8757d..b30decdb, review clean)
Task 12: minor (deferred): architecture-guide.md:6564 M2 still quotes "+G points"; ScoreRing 56px missing from DESIGN.md type table.
All site tasks complete. Final whole-branch review dispatched (fable) over merge-base..HEAD covering P0 Tasks 1-10,16 and site Tasks 1-12.
Final review (fable, da87c93b..b30decdb): Ready to merge "With fixes": 0 Critical, 1 Important (coin offer with raising off dead-ends on unregistered confirm), "art" handle check (controller checked prod 2026-10-22: /art and /api/builders/art.json both 404, no such builder).
Ruling: with EARNKIT_RAISING off, a token question answers tokenUnavailable (no coin offer) — token out of default flows, D1 — cost if wrong: no coin path while raising is off (prod has raising on).
Ruling: public profile shows the Builder Codes highlight only when found — a negative is private feedback, not a public fact — cost if wrong: selectors don't see a "missing" signal.
Final fix wave dispatched (one implementer, Opus): items 1-6 (coin flow, MCP version 3.1.0, llms line, Builder Codes positive-only, terms hit areas, doc M2).
Deferred to release 2 (per final triage): campaign/sponsor path to old confirm line (latent, no open campaign); hosting expiry for unlisted rolling programs; shownAnswer "?" in URLs; P0/site test hygiene minors; font fallback; 2400w hero; BENCH_MAX paging; ProgramCards shim.
Final fix wave: re-review clean, all 6 addressed (commits b30decdb..d03de926). Ready to merge: Yes.
Final fix wave: minor (deferred): tell coin yes on an old open offer can still write a coin_moments row with raising off (pre-existing).
