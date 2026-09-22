# Code Map — where everything lives

Orientation file. Read this to know *what code exists where*, then go read only what you
need. This is the map, not the territory — deeper detail belongs in `architecture-guide.md`
or a topic-specific file in this same directory.

## What to fill in here

- A directory tree of `apps/` (and later `packages/`) with a one-line purpose for each.
- Pointers to the "deeper docs" for each area (e.g. "auth internals → `auth.md`") as those
  get written, so this file stays a map rather than growing without bound.
- Any non-obvious entry points (e.g. where routing is configured, where env vars are
  validated) that would otherwise take a while to find by grepping.
