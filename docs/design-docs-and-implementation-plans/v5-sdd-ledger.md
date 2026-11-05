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

`pnpm -s tsx apps/frontend/scripts/replay.mts earnkit --monday` (clock pinned 2026-11-04T12:00Z, then Monday 2026-11-09T09:00Z).
The honest run: the project passes no `live_url` and no `users` (only what the repo shows), so the Base Builder Grant
needs three changes (a live link, Builder Codes, the users answer) and is not listed. With a live link known it is one
change away (`find.test.ts` pins that text). Rerun after v5.0.1 (2026-11-05; ETHGlobal Mumbai closed, honest ready line):

```
== find "" at 2026-11-04T12:00:00.000Z
-- show_to_builder
Ready to apply, 5:
1. Alliance ALL19, $400K at admission, closes in 14 days. Your agent fills the one answer on the page. First: start the application with the first founder's email.
2. Avalanche Team1 Mini Grants, up to $10,000. Drafted: 6 of 9 answers from the repo, the rest from your agent's memory. First: sign in to the Avalanche Builder Hub.
3. Z Fellows, up to $10K investment. Drafted: 1 of 23 answers from the repo, the rest from your agent's memory.
4. Arc Builders Fund, investment from Circle Ventures, a long shot: an investment program with no stated amount. Your agent fills all 6 answers on the page. Needs your investor deck file.
5. Base Ecosystem Fund, pre-seed and seed investment, a long shot: an investment program with no stated amount. Drafted: 3 of 21 answers from the repo, the rest from your agent's memory.

One change away, 1:
6. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc and put a live link up.

Say yes to apply to all 5, numbers to skip, or "do 6" and I'll make the change first.
-- agent_note
Open with show_to_builder in your own words: warm, direct, short, no emojis, no em dashes, no invented facts.
Draft each ready program from its fields: 'earnkit' values as given; 'agent' fields you write from your memory and the field's sources; 'builder' fields you ask once, all together.
Submit only when the builder says yes, in your own browser, field by field (form_id names the form field when given).
Call track with applied after each submission, and with won (amount_usd), rejected or no_result after each result; skipped for a number they skip.
Pass users and live_url in the project whenever you know them; never invent them.
The numbers the builder says are each item's n in ready and gaps ("skip 4" is the item with n 4), not its place in the list.
On "do <n>": make that gap's change (its details carry the chain's RPC and explorer), push, call track with gap_done and the gap's item, then call find again.

== track "applied" at 2026-11-04T12:00:00.000Z
-- show_to_builder
Tracked. I'll ask how it went when results are due.
-- agent_note
Call find again for the updated ledger.

== find "" at 2026-11-09T09:00:00.000Z
-- show_to_builder
Since Nov 4: 5 new programs you fit; Avalanche Team1 Mini Grants closes in 3 days.

Ready to apply, 4:
1. Avalanche Team1 Mini Grants, up to $10,000, closes in 3 days. Drafted: 6 of 9 answers from the repo, the rest from your agent's memory. First: sign in to the Avalanche Builder Hub.
2. Z Fellows, up to $10K investment. Drafted: 1 of 23 answers from the repo, the rest from your agent's memory.
3. Arc Builders Fund, investment from Circle Ventures, a long shot: an investment program with no stated amount. Your agent fills all 6 answers on the page. Needs your investor deck file.
4. Base Ecosystem Fund, pre-seed and seed investment, a long shot: an investment program with no stated amount. Drafted: 3 of 21 answers from the repo, the rest from your agent's memory.

One change away, 1:
5. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc and put a live link up.

Ledger: 1 applied, 0 won, 1 pending.

Say yes to apply to all 4, numbers to skip, or "do 5" and I'll make the change first.
-- agent_note
Open with show_to_builder in your own words: warm, direct, short, no emojis, no em dashes, no invented facts.
Draft each ready program from its fields: 'earnkit' values as given; 'agent' fields you write from your memory and the field's sources; 'builder' fields you ask once, all together.
Submit only when the builder says yes, in your own browser, field by field (form_id names the form field when given).
Call track with applied after each submission, and with won (amount_usd), rejected or no_result after each result; skipped for a number they skip.
Pass users and live_url in the project whenever you know them; never invent them.
The numbers the builder says are each item's n in ready and gaps ("skip 4" is the item with n 4), not its place in the list.
On "do <n>": make that gap's change (its details carry the chain's RPC and explorer), push, call track with gap_done and the gap's item, then call find again.
```

## v5.0.1

First live feedback (2026-11-05). Commit: the `fix(v5.0.1)` commit on branch `v5.0.1-first-feedback`.

1. Old tool names (score, tell, prepare, confirm and the v4 names) get a refresh message as an error result, answered in `app/mcp/route.ts` before the transport (`lib/v5/old-tools.ts`); other calls in a batch go through.
2. Bare-string chains (`chains: ["base"]`) read as mainnet; an unknown slug is dropped by name (`lib/v5/project-input.ts`).
3. ETHGlobal Mumbai closed (attend-by date passed); `programs/README.md` says to close in-person files at the attend-by date. find.test uses a synthetic in-person program.
4. Honest ready line: "Drafted: n of total answers from the repo, the rest from your agent's memory." or "Your agent fills all total answers on the page." (`lib/v5/reply.ts`). The replay output above is rerun.
