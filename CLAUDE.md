# CLAUDE.md

## Docs discipline

- Before starting non-trivial work, read `docs/codebase-context/architecture-guide.md` and
  `docs/codebase-context/code-map.md` — they hold the current, living picture of how the
  codebase is organized. Use them to orient instead of re-discovering structure from scratch.
- After finishing significant work (e.g. after committing), update
  `docs/codebase-context/architecture-guide.md` and `docs/codebase-context/code-map.md` to
  reflect what changed. Treat this as part of the task, not an optional follow-up.
- Design docs for non-trivial features/changes go in
  `docs/design-docs-and-implementation-plans/` (one file per feature/change). Write them before
  or during the work, not after.
- `docs/` is committed to the repo — keep it accurate rather than treating it as scratch space.

## EarnKit admin

- Adding a program ("Add this program to EarnKit: <url>") or a starter: follow
  `programs/README.md`. Never invent facts the program source doesn't support.
