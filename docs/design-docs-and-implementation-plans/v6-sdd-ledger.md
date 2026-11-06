# EarnKit v6.0 SDD ledger

Design: `v6-design.md` (approved 2026-11-06). Plan: `v6-plan.md`. Branch `v6-the-filter`, worktree `~/ek-v5`,
from `origin/main` 5ef29261. Process: one subagent per task, then a spec review and a code-quality review before the
next task; one PR for the release.

## Tasks

| # | Task | Status | Implementer | Spec review | Quality review | Commit |
|---|------|--------|-------------|-------------|----------------|--------|
| 1 | Explorer clients and onchain rows | complete | implementer | passed (round 1) | passed | 3eac83ae, d0b50bc0, 11ee8591 |
| 2 | Code, ownership and team rows | complete | implementer | passed (round 1) | passed | cb2be2f9, ef3cde38, 88d8ba82 |
| 3 | Live, depth, evidence assembler, cache | complete | implementer | passed (round 1) | passed | 9787797b, 97398f2b |
| 4 | Named tiers and lines | complete | implementer | passed (round 2) | passed | 374a7fe1, 1790b9af, c52623a9 |
| 5 | Pilot script, resolver, docs, PR | complete | implementer | passed | passed | ffd89990 |

## Owner rulings

- 2026-11-06: design approved; several projects per builder; pilot programs named later; v6.0 builds now.

## Planner rulings (overridable by the owner)

- Template detection in v6.0 is by path overlap against recorded starter trees, not file hashes (no extra reads; hashes if path overlap proves too coarse in the pilots).
- `funded_senders` is sampled (50 senders a contract) and labelled.
- Chains without an explorer client in v6.0 (tempo, monad, robinhood, solana) are shown as claimed.
- Cross-applicant counts in v6.0 are computed inside one list; the cross-program graph needs persisted screens (v6.1).

## Pilot run (Task 5, 2026-11-06)

`pnpm screen apps/frontend/lib/v6/fixtures/applicants.csv --program base-builder-grants --chain base`, live, the
server GitHub token in the shell only, no DATABASE_URL (cache off), 49 seconds, exit 0.

| tier | count |
|---|---|
| used | 0 |
| live | 3 (earnkit, onchain-reaction, abi.ninja resolved from its site) |
| building | 0 |
| flagged | 4 (four rows sharing one pitch; nextjs-dashboard also on the template rule) |
| unverified | 1 (the GitLab row) |

Reads used: GitHub 94, explorer 6, site 9. Not read: the domain age for earnkit.com, astral.global and abi.ninja
(rdap.org answers 403 to Node's fetch; curl gets 200).


## Controller rulings during the build (2026-11-06)

- Ruling: tier `live` requires the push-within-60-days condition only when the subject has a repo AND no working site; a working site (url_ok) keeps a stale repo at `live`, a mainnet contract alone with a stale repo is `building` at best — why: the design's intent is "live" = something a person can use now; a working site is that proof even when the code went quiet — cost if wrong: dormant-but-up sites rank with active ones; the push date is a row the reviewer sees anyway.
- Ruling: the T4 test line "a repo pushed 61 days ago with the site down and no contract activity is building only if it has commits in 60 days, else unverified" is amended: no commits in 60 days, no site, no contract activity = `unverified` — why: the design's building tier needs recent commits — cost if wrong: dormant repos read as unverified rather than building; reviewer sees last_push_at either way.
- Ruling: explorer reads are keyless Blockscout on every readable chain (base, ethereum, arbitrum, optimism, polygon, arc), no Etherscan key, avalanche unreadable in v6.0 — why: checked 2026-11-06, Etherscan v2 free tier answers "Free API access is not supported for this chain" for Base; Blockscout answers 200 with a browser-style User-Agent and 403 without — cost if wrong: public Blockscout rate limits are unpublished; the client throttles to 5/s per host and a 429 twice is a labelled unread row. Design §3, §7, §16 and the plan updated.
- Ruling: fixture recording uses the server GitHub token from Railway (`railway variables --json`) in the shell only; fixtures store URL, status and body, never headers — why: no token in the local shell — cost if wrong: none to the code; the token stays out of git.
- Ruling: the fork fixture compare is cross-repo (`{parentOwner}:{branch}...{branch}`) and the parent object comes from the fork's own repo object, not a separate `/repos/{parent}` read — why: the brief's compare would have compared the fork with itself — cost if wrong: none; one fewer request.
- Ruling: nextjs-dashboard is matched against the Next.js Learn starter (`vercel/next-learn` dashboard/starter-example), recorded as an eighth boilerplate, since the create-next-app default is not what it was built from — why: the plan assumed the wrong starter — cost if wrong: one more boilerplate in the manifest.
- Ruling: template_overlap is the share of the REPO's paths (after the ignore list and minus generic files: README*, LICENSE*, .gitignore, .editorconfig, package.json, package-lock.json, pnpm-lock.yaml, yarn.lock, tsconfig.json, .prettierrc*, .eslintrc*) that appear in the boilerplate, not the share of the boilerplate present in the repo; a match needs at least 8 matching paths and the 20-path boilerplate minimum goes — why: the plan inverted the design's "share of files whose hashes match a known boilerplate" and would have flagged every large real project built from a starter — cost if wrong: small starters give fewer matching paths; the 8-path floor keeps README-and-config overlaps from matching.
- Ruling (for Task 4): the `template` flag fires at template_overlap >= 0.5 alone (half the repo's non-generic paths are starter paths); the `own_share < 0.2` half of the design's template rule is dropped as redundant (own_share is 1 minus overlap for a template match); the `fork` flag keeps compare-based own_share < 0.2 — why: with the overlap definition corrected, the design's 0.6-and-under-0.2 pair tests the same thing twice and misses the course clone (0.56) — cost if wrong: a scaffold-style project with many own files but a large starter reads flagged; the rule and the overlap row are shown to the reviewer.
- Ruling: the unfunded flag is `funded_senders_90d < 0.2 * funded_sample` with `senders_90d >= 100` — why: funded is counted inside the 50-sender sample, so the design's ratio against all senders would always fire on busy contracts — cost if wrong: none beyond the threshold's meaning; the rule text is shown.
- Ruling: `used` counts funded senders summed across the counted mainnet contracts (not the top contract) — why: a product with several contracts is used in aggregate and the builder line must match the rule — cost if wrong: two thin contracts can add up to used; the per-contract rows stay visible.
- Ruling: `next` for live names the first missing condition for used (funded senders, then a working site, then a recent push), accepting the implementer's reading of ruling 10 — why: naming the funded rule when the gap is the push would mislead — cost if wrong: none.
- Ruling (reverses the summed-usage ruling): `used` needs one counted mainnet contract with funded_senders_90d >= 25 (the top contract), and `next` reports that top contract's count — why: the automated security review flagged the sum as a sybil vector (the same funded wallets counted once per contract, since rows carry counts not addresses); distinct cross-contract counting would need addresses the rows do not keep — cost if wrong: a product whose usage is genuinely spread across several thin contracts reads live, not used; the per-contract rows are shown. Task 4 fix round 2 dispatched.
- Ruling: a repo-found contract counts toward placement only when plausibly the builder's: deployer_matches_repo, or deployed_at on or after the repo's first commit, or found in a deploy folder; others are shown "named in the repo, not counted"; a CSV-supplied contract whose deployer does not match and which predates the repo is shown "claimed" and not counted — why: Critical 1 — cost if wrong: a builder whose deployer wallet is not in the repo and whose contract predates the repo's first commit reads live instead of used; the rows show why.
- Ruling: starter rules: a fork whose parent is a known starter (boilerplates.json) is flagged `fork` only when ahead_by < 20; other forks keep own_share < 0.2; a template match is flagged only when the repo has fewer than 10 files outside the starter (non-generic) — why: Critical 2 — cost if wrong: a 10-file clone with 20 cosmetic commits passes; the rows show overlap and ahead_by.
- Ruling: team rows for a fork come from the compare commits only (after the fork point); for a template match, logins that are maintainers of the starter (recorded in boilerplates.json at record time) are dropped — why: Critical 3 — cost if wrong: a starter maintainer who really builds on their own starter is not counted; rows say so.
- Ruling: `building` is commits in the last 60 days, as the design says (the code had 90) — why: align code to design — cost if wrong: none material.

## Final review

Whole-branch review (most capable model): Not ready, three Critical (others' contracts counted as usage; starter rules flagged honest scaffold-eth-2 projects; upstream authors read as the team), seven Important, deferred list triaged. One fix wave (commits 9c0f9e0a, 1c6901d3) plus three security-review findings on the ownership code (forgeable deploy files, forgeable commit dates, unbounded raw reads). Scoped re-review: all addressed, no new Critical or Important.

Real run after the wave: `pnpm screen apps/frontend/lib/v6/fixtures/applicants.csv --program base-builder-grants --chain base`, 8 rows: used 0, live 3 (earnkit, onchain-reaction, abi.ninja resolved from its page), building 0, flagged 4 (one shared pitch; nextjs-dashboard also template), unverified 1; reads GitHub 91, explorer 6, site 9; about 38 s with the cache off.

## Deferred to v6.0.1 or v6.1

- Task 1: minor (deferred): onchain.ts "unreachable" label used for unrelated failures; a failed first_tx_at read aborts the whole sender sample.
- Task 1: minor (deferred): no test pins the direction of `funded` (funded means paid own gas).
- Task 1: minor (deferred): throttle state module-level, real throttle path untested.
- Task 2: minor (deferred): three boilerplates (create-next-app, onchainkit-app, forge-template) have under 20 paths and can never match; record fuller templates or lower the rule for them.
- Task 2: minor (deferred): active_weeks_90d undercounts when commits_90d is capped at 300.
- Task 2: minor (deferred): prior_repos_used counts any non-empty homepage without probing it.
- Task 2: minor (deferred): page 1 discarded when the budget stops mid-window (partial count is not a fact; name the choice).
- Task 2: minor (deferred): exactly 300 commits reported as capped.
- Task 2: minor (deferred): a fork repeats the /commits?per_page=1 read readRepo already made.
- Task 2: minor (deferred): prior_repos_used is 0 when no window authors were read; should be null.
- Task 2: minor (deferred): contributors_90d can undercount when the budget stops before /users reads (plan-mandated "left set").
- Task 2: minor (deferred): empty repo 409 note reads "github 409"; `since` is updated time, untested.
- Task 3: minor (deferred): a redirect to another site reads url_ok false and RDAP uses the first host (v5 safeProbePage behavior).
- Task 3: minor (deferred): a site timeout never sets partial (nothing cached, so no loss).
- Task 3: minor (deferred): BUNDLE regex loose (`main\.`, `.js?`), row labelled heuristic.
- Task 3: minor (deferred): a changed pushed_at costs two repo-object reads.
- Task 3: minor (deferred): no evidence_cache sweep (documented).
- Task 3: minor (deferred): ALIASES table in evidence.ts couples to reader note text; tx_90d and sampled-senders aliases untested.
- Task 4: minor (deferred): unfunded next reads as a statement ("20% of sampled wallets paying their own gas; 3 of 50 do.").
- Task 4: minor (deferred): a failed code read on a repo subject passes the push condition as if repo-less (compliant, needs a comment).
- Task 4: minor (deferred): long lines in tiers.ts and tier-words.ts.
- Task 4: minor (deferred): "across N contracts" counts contracts with 0 funded senders; summing can count a wallet twice across contracts (accepted).
- Task 5: minor (deferred): duplicate refs collide in the cross-list maps; a failed readEvidence logs no cause; sharedContributors rebuilt per applicant (cubic); lone unknown-chain and lone short-address rows untested; site read twice for site-only applicants; ref not collapsed to one line in the log.
- Final fix wave re-review: all findings addressed, no new Critical/Important. Parked (minor, before the pilot): (1) CSV header "Project URL" normalizes to the name column (headerKey strips _url); (2) a failed deploy-folder raw read leaves no note; (3) branch names with "/" in the raw URL; (4) "deployed after repo_since" wording in reviewer copy. Ruling: parked rather than a second fix wave; (1) and (2) are the first follow-up before any pilot run.
