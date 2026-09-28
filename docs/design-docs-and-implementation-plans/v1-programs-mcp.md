# EarnKit v1: programs + MCP

Goal: "Anything worth building?" -> pick a real program -> optional starter -> agent builds
with its own tools -> prepare submission -> agent submits externally -> EarnKit records it.

Decisions:
- Postgres (Railway) + postgres.js, one `schema.sql`. No ORM, no queues, no workers.
- MCP is hosted at `https://earnkit.com/mcp`. Hosted agents (Grok, Meta Muse) only accept a
  public HTTPS MCP URL, so a local stdio package can't serve them. Local agents connect to the
  same URL. (A stdio npm package was built first and removed in favor of this.)
- Installation identity uses the MCP authorization spec (OAuth 2.1 + PKCE + dynamic client
  registration) with instant approval and no account. The client stores the token, which is
  the installation, so each connector added counts once.
- Programs, tracks, and starters live in one JSON file per program. Starters are edited in
  the same file, and upsert replaces tracks/starters, so starters need no stable ids.
- `submission_requirements[].from` separates what the agent may draft (project) from what it
  must ask (builder). EarnKit itself never generates answers.
- Public page shows only the installation count and real submitted projects.

Not built (on purpose): accounts, admin UI, program pages, evaluation, rewards, scraping.
Known gap: anyone can complete the anonymous sign-in, so the agent count can be inflated.
