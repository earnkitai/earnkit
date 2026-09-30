# Code Map — where everything lives

```
programs/                      program files (+ README: how Claude Code adds programs/starters)
apps/frontend/
  app/page.tsx                 home: hero, investors, footer
  app/components/sections/AddToAgent.tsx   "Add to your agent" install panel (opened from the hero)
  app/campaigns/[slug]/page.tsx  campaign leaderboard (404 unless the program has a campaign)
  app/p/[id]/page.tsx          campaign entry page
  app/api/projects/[id]/image/ serves a token image the agent uploaded (launch_token image_data)
  app/mcp/route.ts             hosted MCP server (Streamable HTTP, stateless, Bearer token)
  app/oauth/{register,authorize,token}/   anonymous OAuth for MCP clients
  app/.well-known/             OAuth discovery metadata
  lib/earnkit/
    db.ts                      postgres.js pool (DATABASE_URL)
    program-file.ts            zod format of programs/*.json (+ starter limits)
    programs.ts(+test)         list/get/upsert programs; build_help (kits/starter + one start command),
                               trust() (verified_at: skip re-reading sources within 7 days)
    submission.ts(+.test.ts)   prepareSubmission (pure)
    projects.ts                recordSubmission
    installations.ts           save / touch installation by token hash; memory (GitHub, working_on)
    oauth.ts(+.test.ts)        stateless OAuth: register, authorize, code -> token, metadata
    mcp.ts                     MCP server: the 5 tools, their descriptions and schemas
    present.ts(+test)          builder-facing text for list_programs: your repos' fits, then "Also open",
                               one line per program, who-does-what said once
    match.ts(+test)            pure: chain detection (IDs + RPC hosts), repo x program verdicts
    match-projects.ts          repo matching for list_programs + get_program's eligibility check
                               (public GitHub reads, GITHUB_TOKEN)
    http.ts                    CORS + small response helpers
    tools.ts                   tool name -> handler + input validation (+ caller's installation)
    tokens.ts(+test)           launch_token via tokens.fun /api/v1/deploy (TOKENSFUN_DEPLOY_API_KEY)
    campaigns.ts(+test)        EarnKit campaigns: config schema, entry checks, unique_wallets scoring
                               (Base Blockscout + Base RPC), "Your campaign entries" text
    leaderboard.ts             data for the leaderboard and entry pages
  db/schema.sql                the whole schema, idempotent
  scripts/                     db-migrate.mts, programs-sync.mts, campaign.mts (load .env.local)
```

Root commands: `pnpm programs:check` (validate program files), `pnpm test`,
`pnpm campaign score|rank|payout <slug>` (local admin; payout is a dry run without `--execute`). Railway runs
`pnpm predeploy` (= `db:migrate` + `programs:sync`) before every deploy.
Env: `DATABASE_URL`, `EARNKIT_AUTH_SECRET`, `EARNKIT_URL` (public origin, prod only),
`GITHUB_TOKEN` (one server-side read-only token for repo matching), `TOKENSFUN_DEPLOY_API_KEY`
(tokens.fun deploy key for launch_token; `TOKENSFUN_API_URL` overrides the host for tests),
`BASE_RPC_URL` (optional; default public Base RPC). `PAYOUT_PRIVATE_KEY` is local only, never on Railway.
