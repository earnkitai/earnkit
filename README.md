# EarnKit

Get funded for what you ship. EarnKit turns a builder's repo into money: grants, hackathon prizes,
ecosystem programs, accelerators and bounties.

EarnKit is the brain; the builder's agent is the hands. EarnKit knows every open program (amount,
deadline, rules, the form's fields) and matches the repo, pre-fills each form and says what one
change would unlock. The agent drafts the personal parts, submits in its own browser when the
builder says yes, and reports back. EarnKit never submits.

## Connect an agent

MCP server URL: **`https://earnkit.com/mcp`** (remote, OAuth). Approve it when the browser opens;
no account needed. The full guide is at [earnkit.com/docs](https://earnkit.com/docs).

| Agent | How |
|---|---|
| Grok Bot | Plugins, "Add a custom connector", Server URL `https://earnkit.com/mcp`, Save, then Authenticate |
| Muse | Send: "Build a custom connector to https://earnkit.com/mcp (Streamable HTTP). Sign me in, test it, then save it as a skill." |
| OpenClaw | `openclaw mcp add earnkit --url https://earnkit.com/mcp --transport streamable-http`, then with the gateway stopped `openclaw mcp login earnkit` |
| Hermes | In `~/.hermes/config.yaml`: `mcp_servers: earnkit: url: "https://earnkit.com/mcp", auth: oauth`, then `hermes mcp login earnkit` and `/reload-mcp` |
| Claude | Customize, Connectors, "+ Add", "Add custom connector", paste the URL, Continue, Add |
| Claude Code | `claude mcp add --transport http --scope user earnkit https://earnkit.com/mcp`, then `/mcp`, pick earnkit, Authenticate |
| Cursor | The "Add to Cursor" button on earnkit.com/docs, or in `~/.cursor/mcp.json`: `{"mcpServers": {"earnkit": {"url": "https://earnkit.com/mcp"}}}` |
| Codex | `codex mcp add earnkit --url https://earnkit.com/mcp`, then `codex mcp login earnkit` |
| Any other MCP client | Add the URL as a remote server |

The commands are kept in `apps/frontend/lib/v5/agents.ts`; the site and `/llms.txt` read them from there.

Then ask: "What can I earn?"

## The two tools

- `find`: what this repo can earn: the programs it fits with every field pre-filled, the ones one change away, and the ledger; with `program_id`, one program's details and form.
- `track`: what the builder did (applied, won, rejected, no result, skipped, a gap closed), after every submission and every answer about a result.

## Layout

```
apps/frontend/
  app/             Next.js pages and routes: landing, /programs, /docs, /terms, /llms.txt,
                   /mcp, /oauth/*, /api/programs*, /api/stats, /api/cron
  lib/v5/          all EarnKit logic, with its tests (*.test.ts) and fixtures
  db/schema.sql    the database (applied by pnpm db:migrate)
  scripts/         db-migrate, programs-sync, v4-tables, record-repo-fixture
programs/          one JSON file per program (see programs/README.md)
docs/              architecture guide, code map, design docs, the programs API
.github/workflows/ the daily cron (program freshness probe and the owner digest)
```

## Local setup

```bash
pnpm install
createdb earnkit_test
export DATABASE_URL=postgresql://localhost:5432/earnkit_test
pnpm test               # the whole suite, one database per test file
pnpm dev                # http://localhost:3000
pnpm programs:check     # validate every file in programs/
```

Env (`apps/frontend/.env.local`):

| Variable | Use |
|---|---|
| `DATABASE_URL` | Postgres |
| `EARNKIT_AUTH_SECRET` | signs OAuth tokens (any random string locally) |
| `EARNKIT_URL` | the public origin (production: `https://earnkit.com`) |
| `GITHUB_TOKEN` | reads public repos with a higher rate limit (optional) |
| `RESEND_API_KEY` | the owner's daily digest email (optional) |
| `CRON_SECRET` | authorizes `POST /api/cron` |
| `EARNKIT_PROGRAMS_TOKEN` | the programs write API (at least 32 characters; `EARNKIT_PROGRAMS_API=off` turns it off) |

## Deploy

Railway (`apps/frontend/railway.toml`). Each deploy runs `pnpm predeploy` first:
`pnpm db:migrate` (the additive schema) and `pnpm programs:sync` (every program file into the
database). GitHub Actions calls `POST /api/cron` once a day with `CRON_SECRET`.

Tables v4 left in the database are never read. `pnpm db:v4-tables` lists them with row counts and
prints the `DROP TABLE` statements; dropping them, after a backup, is an owner step.

## License

EarnKit is dual-licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option. Copyright (c) 2026 TokenFi Inc.
