# Architecture Guide

## Core terminology

- **Program**: a live builder program run by someone else (hackathon, grant, bounty). Has a
  reward, a deadline, rules, and submission requirements. Curated by hand in `programs/*.json`.
- **existing_work / chains / starts_at**: per-program facts list_programs uses to match a
  builder's public repos (`allowed` / `new_work_only` / `unknown`).
- **Alerts**: EarnKit can't message anyone, so list_programs opens with "Since you last checked"
  (new programs by programs.created_at vs installations.programs_checked_at, and deadlines within
  3 days), and asks the agent to offer a recurring check with its own scheduler.
- **setup / each_time**: what only the builder can do (one-time vs every entry); everything else
  is the agent's job. list_programs turns this into short "Me / You" lines on the server.
- **Memory**: per installation (no account), EarnKit keeps the last GitHub user/repos given and
  `working_on` (programs passed to prepare_submission, cleared by record_submission), so
  list_programs needs no arguments later and leads with "You're working on".
- **verified_at**: the day a program's facts were last checked against its source. Within 7 days
  agents are told not to re-read the source.
- **Track**: a category inside a program with its own requirements.
- **Starter**: an optional idea to start quickly. Max 1 per track, or 2 when there are no tracks.
  Which starter a builder used is never tracked.
- **Installation**: one anonymous agent connection. Identified only by a token hash.
- **Project / submission**: recorded after the agent submitted to the program's own site.
- **Campaign**: EarnKit's own program (a program file with a `campaign` block). record_submission
  *is* the entry (Base contracts + payout wallet). See
  `docs/design-docs-and-implementation-plans/v2-earnkit-campaigns.md`.

For other organizers' programs EarnKit does not build, evaluate, host, or pay. For its own
campaigns it scores, ranks, and pays (after a human approves winners).

## Apps at a glance

- `apps/frontend`: Next.js. Landing page, public activity section, the agent API, and all
  EarnKit logic (`lib/earnkit/`). Postgres via `DATABASE_URL`.
  It also hosts the EarnKit MCP server at `/mcp` and its anonymous OAuth (`/oauth/*`,
  `/.well-known/*`). There is no separate MCP package: every client connects to the URL.

## Data flow

```
agent (Grok Bot, Muse, Claude, Cursor…) ──HTTPS──> /mcp
  first connect: 401 + WWW-Authenticate -> /.well-known/oauth-protected-resource/mcp
    -> /.well-known/oauth-authorization-server -> POST /oauth/register
    -> GET /oauth/authorize (approves instantly, no account) -> POST /oauth/token
    -> token = installation row; the client stores the token
  then: Bearer token -> /mcp -> lib/earnkit/mcp.ts -> lib/earnkit/tools.ts -> Postgres
stdio-only clients: npx mcp-remote https://earnkit.com/mcp
Claude Code ──> programs/<slug>.json ──push to main──> deploy: pnpm programs:sync ──> Postgres
```

## Separation of concerns

- Business logic lives only in `apps/frontend/lib/earnkit/`. Routes, scripts, and the page call it.
- Matching returns keys as well as words: each verdict has `missing` (live_url, mainnet_deploy,
  new_work, real_users) and `effort` (none to weeks); list_programs returns them as `matches`, and
  get_program(repo) as `eligibility`. The text leads with the count and the fastest win, then one
  offer.
- Repo matching (list_programs with github_user) reads only public GitHub data with one server-side token; nothing about the
  builder is stored. Verdicts are hints from code (chain IDs/RPC hosts, commit dates, repo
  homepage); anything unconfirmed is labeled "check".
- launch_token calls tokens.fun's deploy API server-side (tokens.fun pays gas). It only works on
  a project the same installation recorded (projects.installation_id), once per project: the
  project is claimed atomically (token_url='pending') and the claim is kept if tokens.fun's
  response is lost, so a retry can never mint a second token. Requires builder_confirmed=true.
- `prepareSubmission` is pure (no DB) and never invents values. It reports what is filled,
  what is missing, and whether the agent drafts it (`from: project`) or asks the builder
  (`from: builder`).
- OAuth is stateless: client ids and codes are HMAC-signed with `EARNKIT_AUTH_SECRET`; the
  access token is derived from the code, so a replayed code can't create a second installation.
  Rotating the secret invalidates unused codes and client ids, not issued tokens.
- Program files in git are the source of truth for programs/tracks/starters. Every deploy syncs
  them to the database (upsert replaces all three). Programs drop out of list_programs
  automatically after ends_at; there is no scheduled re-check.
- Campaigns: entries are checked at submission (contracts must have no code at the start
  block, via Base RPC; one entry per contract). `pnpm campaign score` counts distinct senders
  of successful txs to the contracts in the window (Blockscout, paced + retried; throttling
  throws, never reads as empty) whose nonce at the start block was > 0. Rank is computed on
  read (score, then earlier entry). `pnpm campaign payout` runs locally only, refuses before
  the deadline, below min_score, or if already paid, and records prize_tx; list_programs then
  tells the winner.
- No auth beyond the installation token. Anyone can get one (by design), so the agent count
  can be inflated by someone scripting the sign-in flow.
