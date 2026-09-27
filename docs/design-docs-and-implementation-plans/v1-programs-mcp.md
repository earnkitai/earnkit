# EarnKit v1: programs + MCP

Goal: "Anything worth building?" -> pick a real program -> optional starter -> agent builds
with its own tools -> prepare submission -> agent submits externally -> EarnKit records it.

Decisions:
- Postgres (Railway) + postgres.js, one `schema.sql`. No ORM, no queues, no workers.
- MCP is a stdio npm package so the installation token can be created and stored locally with
  zero setup. It calls the web app's API, so web and MCP share one DB and one logic module.
- Programs, tracks, and starters live in one JSON file per program. Starters are edited in
  the same file, and upsert replaces tracks/starters, so starters need no stable ids.
- `submission_requirements[].from` separates what the agent may draft (project) from what it
  must ask (builder). EarnKit itself never generates answers.
- Public page shows only the installation count and real submitted projects.

Not built (on purpose): accounts, admin UI, program pages, evaluation, rewards, scraping.
Known gap: `POST /api/installations` is unauthenticated, so the agent count can be inflated.
