# EarnKit v5 SDD ledger

Design: `v5-design.md` (approved 2026-11-03). Plan: `v5-plan.md`. Branch `v5-grant-inbox`, worktree `~/ek-v5`,
from `origin/main` 9efed0b3. Process: one subagent per task, then a spec review and a code-quality review before the
next task; one PR for the release.

## Tasks

| # | Task | Status | Implementer | Spec review | Quality review | Commit |
|---|------|--------|-------------|-------------|----------------|--------|
| 1 | Program record, chain registry, schema, sync | not started | | | | |
| 2 | Programs API and public list | not started | | | | |
| 3 | Repo facts | not started | | | | |
| 4 | Eligibility and gaps | not started | | | | |
| 5 | Pre-fill | not started | | | | |
| 6 | Ledger and track | not started | | | | |
| 7 | find, reply, MCP server, OAuth | not started | | | | |
| 8 | Freshness probe and owner digest | not started | | | | |
| 9 | The site | not started | | | | |
| 10 | The cut | not started | | | | |
| 11 | Journeys, replay, docs, PR | not started | | | | |

## Owner rulings

- 2026-11-03: design approved; "never Optimism" lifted; journey fixtures are the EarnKit repo plus two or three other
  real public repos.

## Planner rulings (overridable by the owner)

- Eligibility vocabulary is `live_product, chain, contract_on, builder_codes, users, new_work_after, demo_video,
  in_person, feature`. The design's `team_size` and `incorporated` are form fields (`from: builder`), not eligibility.
- `gap_done` is trusted only for kinds EarnKit cannot verify (`feature`, `users`, `demo_video`); verifiable kinds are
  re-read from the repo.
- `ready` shows at most 5 programs and `gaps` at most 3 per reply; the rest are counted in `agent_note`.
- One reply format (markdown-light plain text); the v4 per-client plain rendering is dropped.
- v5 is built in `lib/v5/` and the v4 code is cut in Task 10, so no task untangles v4's imports.

## Deferred

- Aggregate "what wins" from the ledger (design section 6): the table is shaped for it; nothing shown in v5.
- Merging ledgers across a builder's agents: needs a proof of identity; not in v5.
- Builder emails: none in v5.

## Replay output

(Task 11 pastes the EarnKit fixture's replay here.)
