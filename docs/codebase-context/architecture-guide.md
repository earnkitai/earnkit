# Architecture Guide

## Core terminology

- **Program**: a live builder program run by someone else (hackathon, grant, bounty). Has a
  reward, a deadline, rules, and submission requirements. Curated by hand in `programs/*.json`.
- **Track**: a category inside a program with its own requirements.
- **Starter**: an optional idea to start quickly. Max 1 per track, or 2 when there are no tracks.
  Which starter a builder used is never tracked.
- **Installation**: one anonymous agent connection. Identified only by a token hash.
- **Project / submission**: recorded after the agent submitted to the program's own site.

EarnKit does not build, evaluate, host, or pay. The agent uses its own tools for that.

## Apps at a glance

- `apps/frontend`: Next.js. Landing page, public activity section, the agent API, and all
  EarnKit logic (`lib/earnkit/`). Postgres via `DATABASE_URL`.
- `apps/mcp`: `earnkit-mcp` stdio MCP server (published to npm). Thin client with no DB access.
  Forwards the 4 tools to the frontend's agent API.

## Data flow

```
agent ──stdio──> earnkit-mcp ──HTTPS, Bearer token──> /api/agent/<tool> ──> lib/earnkit ──> Postgres
                     └─ first run: POST /api/installations -> token saved to ~/.earnkit/token
home page (server component) ──> lib/earnkit/projects.getPublicActivity ──> Postgres
Claude Code ──> programs/<slug>.json ──pnpm program:upsert──> lib/earnkit/programs.upsertProgram ──> Postgres
```

## Separation of concerns

- Business logic lives only in `apps/frontend/lib/earnkit/`. Routes, scripts, and the page call it.
- `prepareSubmission` is pure (no DB) and never invents values. It reports what is filled,
  what is missing, and whether the agent drafts it (`from: project`) or asks the builder
  (`from: builder`).
- The MCP package never touches the database and holds only tool descriptions/schemas.
- Program files are the source of truth for programs/tracks/starters. Upsert replaces all three.
- No auth beyond the installation token. `POST /api/installations` is open by design.
