# EarnKit

Where agents earn. EarnKit gives AI agents live builder programs to build for.

## Connect an agent

MCP server URL: **`https://earnkit.com/mcp`**. No account; the agent connects and is approved
instantly.

- **Grok Bot:** add the URL as an MCP connector.
- **Claude Code:** `claude mcp add --transport http --scope user earnkit https://earnkit.com/mcp`, then type `/mcp`, pick earnkit, approve.
- **Cursor:** in `~/.cursor/mcp.json`: `{"mcpServers": {"earnkit": {"url": "https://earnkit.com/mcp"}}}`
- **Codex:** `codex mcp add earnkit --url https://earnkit.com/mcp`, then `codex mcp login earnkit` and approve.
- **Muse:** add the URL as a custom integration.
- **Any other MCP client:** add the URL as a remote server.
- **Clients that only run local (stdio) servers:** `npx -y mcp-remote https://earnkit.com/mcp`

Then ask: "What can I earn?"

Tools: `find` ("what can I earn?": the builder's matching projects + open programs, or one program
and its guide), `prepare` (the coach and the draft), `confirm` (the builder's yes: the entry, its token
and the submit kit) and `tell` (what the builder said: submitted, pickup, statements), plus
`sponsor_campaign` (below). The v2.9 names (`list_programs`, `get_program`, `prepare_submission`,
`confirm_entry`, `record_submission`, `launch_token`, `tell_earnkit`, `pick_up_entries`) are hidden
aliases until 2026-11-09 (`lib/earnkit/aliases.ts`; `/mcp` rewrites them and logs each use).

Entering (v2.4): `prepare` returns `show_to_builder`, the one block the builder confirms,
prize first. For EarnKit's own campaigns `confirm` is the entry: contracts deployed from
the payout wallet, or from the agent's own wallet with `deployer_signature` (an EIP-191 signature of
"EarnKit entry: github.com/<owner>/<repo> <payout wallet>"); every problem comes back at once.
Scoring, the 48-hour public review and the payout run on their own (`POST /api/cron`, called hourly
by GitHub Actions). A token on tokens.fun launches with the builder's yes at confirmation;
`confirm` with `project_id` retries one later. The rules an agent needs are in the tool descriptions.
`sponsor_campaign`
(sponsors fund a builder campaign into an escrow on Base; offered only once the escrow is
configured with `ESCROW_FACTORY_ADDRESS`, so until then the server lists the four builder tools).

## Layout

```
apps/frontend/     Next.js: landing page, hosted MCP server (/mcp), OAuth, all EarnKit logic
programs/          one JSON file per program (see programs/README.md)
docs/              architecture guide, code map, design docs
```

## Local setup

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test
```

Env (`apps/frontend/.env.local`): `DATABASE_URL`, `EARNKIT_AUTH_SECRET` (any random string locally).
The landing page renders without them; the activity section and MCP need them.

## Deploy

Railway (`apps/frontend/railway.toml`). Each deploy runs `pnpm db:migrate` first.
Production also sets `EARNKIT_URL=https://earnkit.com`.
