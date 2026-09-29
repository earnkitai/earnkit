# Code Map — where everything lives

```
programs/                      program files (+ README: how Claude Code adds programs/starters)
apps/frontend/
  app/page.tsx                 home: hero, investors, footer
  app/components/sections/AddToAgent.tsx   "Add to your agent" install panel (opened from the hero)
  app/mcp/route.ts             hosted MCP server (Streamable HTTP, stateless, Bearer token)
  app/oauth/{register,authorize,token}/   anonymous OAuth for MCP clients
  app/.well-known/             OAuth discovery metadata
  lib/earnkit/
    db.ts                      postgres.js pool (DATABASE_URL)
    program-file.ts            zod format of programs/*.json (+ starter limits)
    programs.ts                list/get/upsert programs
    submission.ts(+.test.ts)   prepareSubmission (pure)
    projects.ts                recordSubmission
    installations.ts           save / touch installation by token hash
    oauth.ts(+.test.ts)        stateless OAuth: register, authorize, code -> token, metadata
    mcp.ts                     MCP server: the 5 tools, their descriptions and schemas
    present.ts(+test)          builder-facing text for list_programs (Me / You lines)
    match.ts(+test)            pure: chain detection (IDs + RPC hosts), repo x program verdicts, text
    match-projects.ts          match_projects: public GitHub reads (GITHUB_TOKEN) + orchestration
    http.ts                    CORS + small response helpers
    tools.ts                   tool name -> handler + input validation (+ caller's installation)
    tokens.ts(+test)           launch_token via tokens.fun /api/v1/deploy (TOKENSFUN_DEPLOY_API_KEY)
  db/schema.sql                the whole schema, idempotent
  scripts/                     db-migrate.mts, programs-sync.mts (load .env.local)
```

Root commands: `pnpm programs:check` (validate program files), `pnpm test`. Railway runs
`pnpm predeploy` (= `db:migrate` + `programs:sync`) before every deploy.
Env: `DATABASE_URL`, `EARNKIT_AUTH_SECRET`, `EARNKIT_URL` (public origin, prod only),
`GITHUB_TOKEN` (one server-side read-only token for match_projects), `TOKENSFUN_DEPLOY_API_KEY`
(tokens.fun deploy key for launch_token; `TOKENSFUN_API_URL` overrides the host for tests).
