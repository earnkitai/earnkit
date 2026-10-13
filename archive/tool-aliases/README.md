# Tool aliases (v2.9 names), staged for archive

## What it did
The 8 v2.9 tool names (list_programs, get_program, prepare_submission, confirm_entry, record_submission,
launch_token, tell_earnkit, pick_up_entries) were rewritten to find, prepare, confirm and tell by
`app/mcp/route.ts` through `apps/frontend/lib/earnkit/aliases.ts`.

## The flag
`EARNKIT_TOOL_ALIASES=on`, default off. Until 2026-11-09 the aliases work with the flag off (R17's
promise to clients). From 2026-11-09 an old name is an unknown tool unless the flag is on.

## The move, on or after 2026-11-09
1. `git mv apps/frontend/lib/earnkit/aliases.ts apps/frontend/lib/earnkit/aliases.test.ts archive/tool-aliases/files/apps/frontend/lib/earnkit/`
2. In `app/mcp/route.ts`, drop `withAliases` and `forOldNames` (keep the snippet here as `route-aliases.ts`).
3. Drop the alias cases from `mcp.test.ts`, `v29-journey.test.ts`, `v210-journey.test.ts`, `v2101.test.ts`, `v211-journey.test.ts` and `tools.test.ts` (grep `aliases`), and write MANIFEST.txt.
4. `pnpm -s test`, then commit.

## Restore
`pnpm exec tsx apps/frontend/scripts/archive-restore.mts tool-aliases`, paste `route-aliases.ts` back, set the flag.
