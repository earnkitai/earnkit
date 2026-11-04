# EarnKit v5 SDD ledger

Design: `v5-design.md` (approved 2026-11-03). Plan: `v5-plan.md`. Branch `v5-grant-inbox`, worktree `~/ek-v5`,
from `origin/main` 9efed0b3. Process: one subagent per task, then a spec review and a code-quality review before the
next task; one PR for the release.

## Tasks

| # | Task | Status | Implementer | Spec review | Quality review | Commit |
|---|------|--------|-------------|-------------|----------------|--------|
| 1 | Program record, chain registry, schema, sync | complete | implementer | passed | passed | 35f73ff8 |
| 2 | Programs API and public list | complete | implementer | passed | passed | bf6459c8, 021812f7 |
| 3 | Repo facts | complete | implementer | passed | passed | 48ea4613, 760d8af1, 168a34e4 |
| 4 | Eligibility and gaps | complete | implementer | passed | passed | e4aae3fb, 03ec94bd |
| 5 | Pre-fill | complete | implementer | passed | passed | dfff7cac, b0e00d21 |
| 6 | Ledger and track | complete | implementer | passed | passed | 5b75a332, e9c111b6 |
| 7 | find, reply, MCP server, OAuth | complete | implementer | passed | passed | cd16c709, 927c48e3 |
| 8 | Freshness probe and owner digest | complete | implementer | passed | passed | 663184e6, 7021dc7e |
| 9 | The site | complete | implementer | passed | passed | e7753326, 0cef9373 |
| 10 | The cut | complete | implementer | passed | passed | b3d33462 |
| 11 | Journeys, replay, docs, PR | complete | implementer | pending | pending | see git log |

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
- (Controller rulings, 2026-11-03 to 11-04) 1. `listOpenPrograms` excludes a program with `stale_since` older than 14 days or an API row unverified for 14 days.
- 2. The migration backfills `programs.file`, and readers skip rows that fail to parse.
- 3. Explicit `eligibility` on base-builder-grants.
- 4. `chain` and `contract_on` are met only on mainnet.
- 5. `traction` fields are `agent`; `builder` fields are only `demo_video` and files; `team`, `contact` and `raised` are `agent`.
- 6. The ledger is keyed by installation only, client-key reuse dropped: a re-authorization starts a fresh ledger.
- 7. The hosted-client rule: a many-builder registration gets no client key.
- 8. A stale program leaves the open list 14 days after `stale_since`.
- 9. The owner digest covers changes since the last digest.
- 10. With one ready program the closing line is "Say yes to apply, or skip it."
- 11. The hosted rate-limit tier applies only when every redirect URI is on the hosted host.
- 12. The guide page follows the list's visibility, and closed programs render without an Apply link.
- 13. `/install` is kept as a permanent redirect to `/docs#install` (old links exist).

## Deferred

- Aggregate "what wins" from the ledger (design section 6): the table is shaped for it; nothing shown in v5.
- Merging ledgers across a builder's agents: needs a proof of identity; not in v5.
- Builder emails: none in v5.

## Replay output

`pnpm -s tsx apps/frontend/scripts/replay.mts earnkit --monday` (clock pinned 2026-11-04T12:00Z, then Monday 2026-11-09T09:00Z):

```
== find "" at 2026-11-04T12:00:00.000Z
-- show_to_builder
Ready to apply, 5:
1. Alliance ALL19, $400K at admission, closes in 14 days. Drafted.
2. Avalanche Team1 Mini Grants, up to $10,000. Drafted: 8 facts from the repo.
3. Z Fellows, up to $10K investment. Drafted: 2 facts from the repo.
4. ETHGlobal Mumbai, up to $15K per partner prize, closes in 2 days, in person. Drafted: 3 facts from the repo.
5. Arc Builders Fund, investment from Circle Ventures, a long shot: an investment program with no stated amount. Drafted: 1 fact from the repo. Needs your investor deck file.

One change away, 2:
6. Base Builder Grant Program, up to $5,000: add Base Builder Codes to the app (I can do this).
7. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc.

Say yes to apply to all 5, numbers to skip, or "do 6" and I'll make the change first.
-- agent_note
Open with show_to_builder in your own words: warm, direct, short, no emojis, no em dashes, no invented facts.
Draft each ready program from its fields: 'earnkit' values as given; 'agent' fields you write from your memory and the field's sources; 'builder' fields you ask once, all together.
Submit only when the builder says yes, in your own browser, field by field (form_id names the form field when given).
Call track with applied after each submission, and with won (amount_usd), rejected or no_result after each result; skipped for a number they skip.
On "do <n>": make that gap's change (its details carry the chain's RPC and explorer), push, call track with gap_done and the gap's item, then call find again.
1 more fit; ask with filter.all for the full list.

== track "applied" at 2026-11-04T12:00:00.000Z
-- show_to_builder
Tracked. I'll ask how it went when results are due.
-- agent_note
Call find again for the updated ledger.

== find "" at 2026-11-09T09:00:00.000Z
-- show_to_builder
Since Nov 4: Avalanche Team1 Mini Grants: deadline moved to Nov 12; Avalanche Team1 Mini Grants closes in 3 days.

Ready to apply, 4:
1. Avalanche Team1 Mini Grants, up to $10,000, closes in 3 days. Drafted: 8 facts from the repo.
2. Z Fellows, up to $10K investment. Drafted: 2 facts from the repo.
3. Arc Builders Fund, investment from Circle Ventures, a long shot: an investment program with no stated amount. Drafted: 1 fact from the repo. Needs your investor deck file.
4. Base Ecosystem Fund, pre-seed and seed investment, a long shot: an investment program with no stated amount. Drafted: 5 facts from the repo.

One change away, 2:
5. Base Builder Grant Program, up to $5,000: add Base Builder Codes to the app (I can do this).
6. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc.

Ledger: 1 applied ($400K asked), 0 won, 1 pending.

Say yes to apply to all 4, numbers to skip, or "do 5" and I'll make the change first.
-- agent_note
Open with show_to_builder in your own words: warm, direct, short, no emojis, no em dashes, no invented facts.
Draft each ready program from its fields: 'earnkit' values as given; 'agent' fields you write from your memory and the field's sources; 'builder' fields you ask once, all together.
Submit only when the builder says yes, in your own browser, field by field (form_id names the form field when given).
Call track with applied after each submission, and with won (amount_usd), rejected or no_result after each result; skipped for a number they skip.
On "do <n>": make that gap's change (its details carry the chain's RPC and explorer), push, call track with gap_done and the gap's item, then call find again.
```
