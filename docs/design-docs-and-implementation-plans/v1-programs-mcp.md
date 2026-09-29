# EarnKit v1: programs + MCP

Goal: "Anything worth building?" -> pick a real program -> optional starter -> agent builds
with its own tools -> prepare submission -> agent submits externally -> EarnKit records it.

Decisions:
- Postgres (Railway) + postgres.js, one `schema.sql`. No ORM, no queues, no workers.
- MCP is hosted at `https://earnkit.com/mcp`. Hosted agents (Grok Bot, Meta Muse) only accept a
  public HTTPS MCP URL, so a local stdio package can't serve them. Local agents connect to the
  same URL. (A stdio npm package was built first and removed in favor of this.)
- Installation identity uses the MCP authorization spec (OAuth 2.1 + PKCE + dynamic client
  registration) with instant approval and no account. The client stores the token, which is
  the installation, so each connector added counts once.
- Programs, tracks, and starters live in one JSON file per program. Starters are edited in
  the same file, and upsert replaces tracks/starters, so starters need no stable ids.
- `submission_requirements[].from` separates what the agent may draft (project) from what it
  must ask (builder). EarnKit itself never generates answers.
- Public page: hero with the install panel. The agent count and submitted-projects table were
  removed until there is traction; installations and submissions are still recorded.

Not built (on purpose): accounts, admin UI, program pages, evaluation, rewards, scraping.
Known gap: anyone can complete the anonymous sign-in, so the agent count can be inflated.

## Existing projects -> programs (added after launch)

Reason to install beyond starters: "your existing projects already qualify". Each program
carries `existing_work` and a one-line `key_requirement`, returned by `list_programs`. The
server instructions tell the agent to compare the builder's projects against programs that
accept existing work and say what's missing. No new tool; no builder data stored.

## match_projects (5th tool, added after testing)

Testing in Grok Bot showed the expensive part of "what can my projects earn?" is the agent reading
~200 repos. match_projects does it server-side from a GitHub username: detects chains from chain
IDs/RPC hosts in config files, checks commit dates against build windows (starts_at), and
returns likely / after one step / no per repo x program, with ready-to-show text. It works in
any client, including ones that can't build. Uses one server-side GITHUB_TOKEN.

## launch_token (tokens.fun, added 2026-09-29)

After record_submission the agent offers the builder a token for the project. launch_token calls
tokens.fun `POST /api/v1/deploy` (the X bot's route) with EarnKit's deploy key: tokens.fun's gas
wallet pays, the builder's wallet is the creator (40% of trading fees in WETH). The builder's X
comes from the agent and is shown on the token page. Tested live once on Base (test token
removed from tokens.fun afterwards); every failure path tested against a mock of the API.
tokens.fun rate-limits by IP (5/hour, 20/day), which covers all EarnKit launches combined.
