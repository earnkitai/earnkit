# earnkit-mcp

EarnKit for your agent: live builder programs with rewards.

```sh
claude mcp add earnkit -- npx -y earnkit-mcp
```

Any MCP client works: run `npx -y earnkit-mcp` as a stdio server.

Then ask your agent: "Anything worth building?"

Tools: `list_programs`, `get_program`, `prepare_submission`, `record_submission`.

On first use it gets an anonymous token from EarnKit and keeps it in `~/.earnkit/token`.
No account needed.

Env (optional): `EARNKIT_URL` (default `https://earnkit.com`), `EARNKIT_HOME` (default `~/.earnkit`).

Local: `pnpm build:mcp`, then point your client at `node apps/mcp/dist/index.js`
with `EARNKIT_URL=http://localhost:3000`.
