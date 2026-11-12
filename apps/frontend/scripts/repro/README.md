# The repro pack

One script per Break from the journey lanes 22 to 29 and 1h (v6.1.16). Each prints exactly one line, `PASS <id>` or
`FAIL <id>: <actual>`, judged against the ruled behaviour, then deletes every row it made (its OAuth client
registrations too, v6.1.18). It drives a running EarnKit over plain HTTP (OAuth, POST /mcp, /me forms, pages) and reads
and seeds its database directly.

Through `run.sh` a script's exit code is its result: 0 on PASS, 1 on FAIL. An error the script does not catch (a
refused target, a database error) prints one line, `FAIL <id>: <message>`, never a stack, and exits 1 (`fail-line.mjs`,
v6.1.18 FR-4). `run-all.sh` reads the lines, not the codes.

It is never part of `pnpm test`: nothing here is a `*.test.ts` file. `lib/v5/repro-target.test.ts` pins only the
target guard (`target.ts`).

## Where it runs

Only against a local instance. The target comes from the environment:

| Variable | Default | Used for |
|---|---|---|
| `REPRO_BASE_URL` | `http://localhost:4600` | The instance the scripts call |
| `REPRO_DATABASE_URL` | `postgresql://localhost:5432/earnkit_journeys` | The same instance's database (seeds, checks, cleanup) |
| `REPRO_AUTH_SECRET` | the local journeys value | Must equal the server's `EARNKIT_AUTH_SECRET` (sessions and CSRF are made in process) |
| `REPRO_CRON_SECRET` | the local journeys value | The server's `CRON_SECRET` (no script calls the cron) |
| `REPRO_ALLOW_REMOTE` | unset | `1` allows a base URL that is not this machine |

The guard (`target.ts`, read by `lib.mts`, `run.sh` and `run-all.sh`):
- a base URL whose host is not `localhost`, `127.0.0.1` or `::1` is refused (`local only`) unless `REPRO_ALLOW_REMOTE=1`;
- `earnkit.com` and its subdomains are refused always, with trailing dots removed and in look-alike letters too
  (`еarnkit.com`, `ꓰꓮꓣꓠꓗꓲꓔ.com`; each label read through the reserved-name `fold`);
- the Railway app domain (`*.up.railway.app`) is refused always;
- the database must be a local Postgres named by its host: `localhost`, `127.0.0.1` or `::1` (an empty host, which
  leaves the choice to `PGHOST`, is refused), no `hostaddr=` parameter, and a `host=` parameter only as a socket path or
  a local name.

The default secrets are the throwaway values of the local journeys server; they sign nothing anywhere else.

`REPRO_BASE_URL` must be the origin the server was started with (its `EARNKIT_URL`), exactly: the /me forms refuse a
post whose Origin is not the public origin (403), so `http://127.0.0.1:4600` against a server on
`EARNKIT_URL=http://localhost:4600` fails every script that posts to /me (L23-1, L24-4, L28-10, L29-4 to L29-6).

## Run it

```
cd apps/frontend/scripts/repro
./run-all.sh               # every Break, then the pack cleanup, then a summary table (about 35 s, plus up to
                           # 12 minutes for L23-2's guide wait)
./run-all.sh 'l28-*'       # one lane
./run.sh $PWD/l24-3.mts    # one Break; exit 0 on PASS, 1 on FAIL
./run.sh $PWD/cleanup.mts  # remove every l33 row, OAuth clients included (run-all does this at the end)
```

The scripts import a few helpers from this checkout (`upsertBuilder`, `createSession`, `csrfToken`,
`linkInstallation`, `deleteBuilder`, `upsertProgram`, `programFixture`, `addReviewer`, `readStats`, `ANSWER_KINDS`),
so the server should run the same commit. If a task renames one, fix `lib.mts` or the script.

### Against a dev server from a worktree, on a throwaway database

From the worktree root, with Postgres on localhost (the recipe of the v6.1.16 Task 8 review):

```
export DATABASE_URL=postgresql://localhost:5432/earnkit_test
# 1. This worktree's test template (schema run twice, programs synced); prints its name, ek_test_template_<key>.
node --input-type=module -e "const m = await import('./apps/frontend/lib/v5/fixtures/test-db-template.mjs'); await m.buildTemplate(process.env.DATABASE_URL, { ifMissing: true }); console.log(m.TEMPLATE_NAME)"
# 2. A throwaway database copied from it.
createdb -T ek_test_template_<key> ek_repro
# 3. The dev server on a free port, no vendor keys, the same secrets as the pack; EARNKIT_URL is the REPRO_BASE_URL below.
env -u RESEND_API_KEY -u GITHUB_TOKEN -u EARNKIT_PROGRAMS_TOKEN -u GITHUB_OAUTH_CLIENT_ID -u GITHUB_OAUTH_CLIENT_SECRET \
  DATABASE_URL=postgresql://localhost:5432/ek_repro EARNKIT_URL=http://localhost:4597 \
  EARNKIT_AUTH_SECRET=journeys-local-secret-not-for-prod-0123456789abcdef CRON_SECRET=journeys-cron-secret \
  NODE_ENV=development pnpm --filter frontend exec next dev -p 4597
# 4. In another shell: the pack against it.
REPRO_BASE_URL=http://localhost:4597 REPRO_DATABASE_URL=postgresql://localhost:5432/ek_repro apps/frontend/scripts/repro/run-all.sh
# 5. Afterwards: stop the server, `dropdb ek_repro`, and remove the AGENTS.md that next dev may write in apps/frontend.
```

The template's catalog is synced at the tests' clock (2026-11-04), so a program that closed since then may read closed.

## Rules kept

- Plain HTTP only, no browser; rows `l33-<id>-...`; repos `lane33/<id>-...` (seeded in `repo_cache`, so no GitHub read is
  made); addresses 10.33.<octet>.x through X-Forwarded-For (one octet per script); the cron is never called.
- No token, code, cookie or link URL is written to disk or printed: `lib.mts` redacts them (`red`), and nothing in this
  folder holds one.
- Files: `target.ts` (the guard), `target-check.mts` (prints the target; run-all runs it first), `lib.mts` (agents over
  real OAuth, MCP calls, builders with sessions, /me posts, programs, repo seeds, per-script cleanup), `standing.mts`
  (standing approval on through /me), `team.mts` (two co-founders on one repo), `fields.mts` (a find field by key),
  `run.sh`, `fail-line.mjs` (the one-line error and exit code), `run-all.sh`, `cleanup.mts`.

## Method notes (read before trusting a PASS)

- **L26-1:** the hot agent's hour is set to its cap (120) and the address hour to 597 of 600, directly in
  `rate_windows` with the keys `mcp:<id>` and `mcpIp:<ip>`. If the hot agent is served, the script prints a setup FAIL:
  the keys changed and the script needs updating.
- **L26-3** makes 60 real agents from one address (about 3 s). Their per-registration `installClient:client:<hash>`
  windows cannot be mapped back to a run, so they stay until the 2-day sweep. Every 10.33 window is deleted.
- **L22-1 and L28-2** read stats in process (`readStats`) as before/after deltas; another run recording wins at the same
  moment would skew them.
- **L28-1, -2, -3, -11** seed the repo with `authors` and `contributors` lists; **L28-6** fakes a rename with seeded repo
  reads sharing one repo id.
- **L27-4:** locally GitHub sign-in is not set up, so every /link page is the `not set up` state (503).
- **L27-5** passes when the home page's og:image names a 1200x630 PNG whose bytes differ from dafd2ade's; the path is
  fetched from the target, never from earnkit.com.
- **L23-2** uses a fresh program id per run. The guide id list is cached 60 s and the guide page revalidates at 600 s,
  so a freshly seeded program's guide answers 404 for up to about 10 minutes: the script polls it every 20 s, at most
  700 s, until it answers 200, then judges (lane 37 waited 583 s). The time waited goes to stderr.
- **L24-2** first checks the one-program users text (`... : tell me if real people use it.`), then the yes.

## History

- Lane 33 (2026-11-11, dafd2ade): 47 FAIL, 0 PASS (the pack written against the open Breaks).
- Lane 34 (2026-11-12, v6.1.16 at fee51c94): 47 of 47 PASS with the script fixes (l24-2, l29-1, l28-4 to l28-7).
- v6.1.17 Task 5: moved into the repo, the target read from the environment.
- Lane 37 (v6.1.17): 46 PASS, 1 FAIL (L23-2 before the guide refreshed); 353 `l33-` OAuth client rows left behind.
- v6.1.18 Task 6a: L23-2 waits for the guide (the wait variant deleted), the cleanups delete the `l33-` OAuth clients,
  exit codes and one-line errors (FR-4), the guard's trailing dot, look-alike, Railway and database rules.
