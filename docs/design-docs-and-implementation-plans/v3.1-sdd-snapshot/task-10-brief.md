### Task 10: the agent sees find, prepare (draft), tell, score; `confirm` only for Backing (spec 3.4) (I: Opus, R: Opus)

**Files:**
- Modify: `apps/frontend/lib/earnkit/mcp.ts:123-131` (`prepareDescription`), `:133-140` (`confirmDescription` → Backing only), `:174-183` (`toolDescriptions`), `:361-440` (register `confirm` only under `raisingEnabled()`, narrowed schema), `apps/frontend/lib/earnkit/tools.ts:3138-3143` (refuse `program_id`), `:1216` (`fresh: undefined`), `apps/frontend/lib/earnkit/present.ts:903-906` (no ideas section), `apps/frontend/lib/earnkit/bench-find.ts:435-441` (no `idea` FundLine for no_project; `needsPicks` fills both slots), `SERVER_INSTRUCTIONS` if it names confirm for entries
- Test: `apps/frontend/lib/earnkit/v31-mcp-surface.test.ts`; update `mcp.test.ts:501` (`FIVE` → four, or five under the flag), `test-foundations.test.ts:68`, `aliases.test.ts:99-116`, `present.test.ts` (ideas), the `build_offer` assertions in `mcp.test.ts`, `tools.test.ts`, `v213-journey.test.ts`, `v213-find.test.ts`, `v2131-o5.test.ts`, `v2131-onboarding.test.ts`, `v2133-owner-test.test.ts` (no build_offer in find), `copy-review.test.ts` (TOOL_DESCRIPTIONS)

**Interfaces:**
- `prepareDescription(...)` = `'Draft an application from the ship log. Pass program_id, project (name, repo_url, live_url) and answers you drafted from the repo, by requirement key; the first call without answers lists the requirements. It never submits: the builder sends the form. Follow agent_note.'` (the `host`/`build` sentences only while those fields are registered).
- `CONFIRM_BACKING_DESCRIPTION = "The builder's yes to opening Backing. Pass project_id, yes: true, wallet and token exactly as tell coin returned them; check: true reads a launching coin. Then follow agent_note."`; schema `{ project_id: int (required), yes?: true, check?: boolean, token?: { name?, symbol? }, wallet?: string, image_url?, image_data?, builder_x?, agent? }.strict()`.
- `CONFIRM_ENTRY_GONE = "EarnKit drafts applications now; the builder sends them on the program's site. Call prepare for a draft."` thrown by `tools.confirm` for any `program_id`.
- `toolDescriptions().confirm` exists only under the flag; `TOOL_DESCRIPTIONS` keeps it for the copy scan.

- [ ] **Step 1: Tests**
```ts
test('(a) tools/list: find, prepare, score, tell with the flag off', ...)
test('(b) flag on: confirm is listed with project_id required and no program_id', ...)
test('(c) flag on: the Backing yes (move_up backing yes, then confirm { project_id, yes }) still launches through the fake tokens.fun deploy', ...)
test('(d) confirm with program_id: CONFIRM_ENTRY_GONE', ...)
test('(e) find (more: true and a shared client) has no build_offer, no "Ideas" section; a no_project Bench reply has no idea line', ...)
test('(f) every description under 800 characters, no em dash, no tool name in builder text', ...)
```
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** plus the updated files and `v3-backing.test.ts`.
- [ ] **Step 5: Commit** `feat(v3.1): the agent drafts, never submits; confirm only opens Backing`

---

