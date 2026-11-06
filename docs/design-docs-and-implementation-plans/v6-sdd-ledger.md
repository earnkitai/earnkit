# EarnKit v6.0 SDD ledger

Design: `v6-design.md` (approved 2026-11-06). Plan: `v6-plan.md`. Branch `v6-the-filter`, worktree `~/ek-v5`,
from `origin/main` 5ef29261. Process: one subagent per task, then a spec review and a code-quality review before the
next task; one PR for the release.

## Tasks

| # | Task | Status | Implementer | Spec review | Quality review | Commit |
|---|------|--------|-------------|-------------|----------------|--------|
| 1 | Explorer clients and onchain rows | complete | implementer | passed (round 1) | passed | 3eac83ae, d0b50bc0, 11ee8591 |
| 2 | Code, ownership and team rows | complete | implementer | passed (round 1) | passed | cb2be2f9, ef3cde38, 88d8ba82 |
| 3 | Live, depth, evidence assembler, cache | pending | | | | |
| 4 | Named tiers and lines | pending | | | | |
| 5 | Pilot script, resolver, docs, PR | pending | | | | |

## Owner rulings

- 2026-11-06: design approved; several projects per builder; pilot programs named later; v6.0 builds now.

## Planner rulings (overridable by the owner)

- Template detection in v6.0 is by path overlap against recorded starter trees, not file hashes (no extra reads; hashes if path overlap proves too coarse in the pilots).
- `funded_senders` is sampled (50 senders a contract) and labelled.
- Chains without an explorer client in v6.0 (tempo, monad, robinhood, solana) are shown as claimed.
- Cross-applicant counts in v6.0 are computed inside one list; the cross-program graph needs persisted screens (v6.1).

## Deferred

(filled as tasks run)
