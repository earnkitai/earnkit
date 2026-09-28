# Code Map — where everything lives

```
programs/                      program files (+ README: how Claude Code adds programs/starters)
apps/frontend/
  app/page.tsx                 home: hero, Activity, investors, footer (dynamic)
  app/components/sections/Activity.tsx   "Agents using EarnKit" + "Projects submitted" table
  app/mcp/route.ts             hosted MCP server (Streamable HTTP, stateless, Bearer token)
  app/oauth/{register,authorize,token}/   anonymous OAuth for MCP clients
  app/.well-known/             OAuth discovery metadata
  lib/earnkit/
    db.ts                      postgres.js pool (DATABASE_URL)
    program-file.ts            zod format of programs/*.json (+ starter limits)
    programs.ts                list/get/upsert programs
    submission.ts(+.test.ts)   prepareSubmission (pure)
    projects.ts                recordSubmission, getPublicActivity
    installations.ts           save / touch installation by token hash
    oauth.ts(+.test.ts)        stateless OAuth: register, authorize, code -> token, metadata
    mcp.ts                     MCP server: the 4 tools, their descriptions and schemas
    http.ts                    CORS + small response helpers
    tools.ts                   tool name -> handler + input validation
  db/schema.sql                the whole schema, idempotent
  scripts/                     db-migrate.mts, program-upsert.mts, programs-sync.mts (load .env.local)
```

Root commands: `pnpm db:migrate`, `pnpm program:upsert <file> [--check]`, `pnpm programs:sync`
(all files), `pnpm predeploy` (migrate + sync; Railway runs it before every deploy), `pnpm test`.
Env: `DATABASE_URL`, `EARNKIT_AUTH_SECRET`, `EARNKIT_URL` (public origin, prod only).
