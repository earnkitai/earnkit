# Architecture Guide

What each part of the codebase owns, how data flows between them, and the core terminology.
Read this before making architectural decisions. Keep it current as the monorepo grows.

## What to fill in here

- **Core terminology** — domain terms used throughout the code, defined once so everyone
  (and every agent) uses them consistently.
- **Apps/packages at a glance** — one line per app/package in the monorepo (e.g.
  `apps/frontend` — Next.js marketing site) and what it depends on. Add rows as `apps/backend`,
  `packages/sdk`, etc. show up.
- **Data flow** — how a request/action moves through the system end to end, once there's
  more than one app to connect.
- **Separation of concerns** — the boundaries that should not be crossed (e.g. frontend
  never talks to the DB directly, SDK has no framework dependencies).
