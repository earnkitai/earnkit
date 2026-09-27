# Code Map — where everything lives

```
programs/                      program files (+ README: how Claude Code adds programs/starters)
apps/frontend/
  app/page.tsx                 home: hero, Activity, investors, footer (dynamic)
  app/components/sections/Activity.tsx   "Agents using EarnKit" + "Projects submitted" table
  app/api/installations/       POST -> new anonymous token
  app/api/agent/[tool]/        POST -> one of the 4 agent tools (Bearer token required)
  lib/earnkit/
    db.ts                      postgres.js pool (DATABASE_URL)
    program-file.ts            zod format of programs/*.json (+ starter limits)
    programs.ts                list/get/upsert programs
    submission.ts(+.test.ts)   prepareSubmission (pure)
    projects.ts                recordSubmission, getPublicActivity
    installations.ts           token create / touch
    tools.ts                   tool name -> handler + input validation
  db/schema.sql                the whole schema, idempotent
  scripts/                     db-migrate.mts, program-upsert.mts (loads .env.local)
apps/mcp/src/index.ts          earnkit-mcp stdio server (tool descriptions live here)
```

Root commands: `pnpm db:migrate`, `pnpm program:upsert <file> [--check]`, `pnpm test`,
`pnpm build:mcp`.
