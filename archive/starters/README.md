# Starter registry beyond arc-tipjar (archived in v2.12)

## What it did

Two kinds of starting points, both shown by `get_program` (today `find` with a `program_id`):

| Piece | Where it lived |
|---|---|
| `build_help`: EarnKit's kits per chain (Arc kit, Base Builder Codes kit), the x402 agent service starter, and the Base campaign starter for an EarnKit campaign, each with one `npx degit` command | `programs.ts` (`KITS`, `AGENT_SERVICE_STARTER`, `CAMPAIGN_STARTER`, `buildHelp`) |
| `starters` and `starters_note`: a program file's optional build ideas (one per track, or up to 2) | the program file's `starters`, written to the `starters` table by `programs:sync` (`upsertProgram`) and read by `getProgram` |

No committed program file had starters when this was archived.

## What stayed live

`arc-tipjar` stays the one starter: `starters.ts STARTERS`, a program file's `fresh_build`, and the
v2.11 build path (deploy, host, entry) are untouched. The program file schema still accepts
`starters`, so `pnpm programs:check` passes on files that name them; they are just not stored.

## The flag

`EARNKIT_STARTER_REGISTRY=on`. Default off. With it off:

- `upsertProgram` neither deletes nor inserts `starters` rows (a track's delete still cascades to its
  rows, as before).
- `getProgram` does not read the table, and its answer has no `starters`, `starters_note` or
  `build_help`.

The table is kept and never dropped (see `TABLES.md`).

## Restore

The app never imports from `archive/`. To bring the feature back:

1. `pnpm exec tsx apps/frontend/scripts/archive-restore.mts starters` (moves `programs-starters.ts`
   and its test back with `git mv`; refuses if a target exists).
2. In `programs.ts`, `import { buildHelp } from './programs-starters';` and, in `programDetails`
   after `submission_url`, add
   `...(archiveFlag('STARTER_REGISTRY') && { build_help: buildHelp(program.chains, program.campaign) }),`
   (the file's header says the same). Put "tested build help" back in `public/llms.txt`'s find line.
3. Set `EARNKIT_STARTER_REGISTRY=on`, then `pnpm programs:sync` to write the files' starters again.

Checked in v2.12 in a scratch worktree: restore plus step 2, with `programs.test.ts` as it was
before the archive commit (`git show 43fab94~1:apps/frontend/lib/earnkit/programs.test.ts`),
passes `programs-starters.test.ts`, `programs.test.ts`, `program-file.test.ts` and
`starters.test.ts` with the flag on (73 tests, 0 fail).
