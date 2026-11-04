# EarnKit v5 go-live (owner steps)

Do these in order. Nothing here is automatic: v5 merges and builds without them, but the steps below take it live.
Design: `v5-design.md`. Plan: `v5-plan.md`. Ledger: `v5-sdd-ledger.md`.

## 1. Railway environment

Keep exactly these variables on the `earnkit` service and remove every other one (v4 had 65; v5 reads 8).

| Variable | Note |
|---|---|
| `DATABASE_URL` | Unchanged |
| `EARNKIT_AUTH_SECRET` | Unchanged; changing it signs out every agent and voids pending approve links |
| `EARNKIT_URL` | `https://earnkit.com`; required in production |
| `GITHUB_TOKEN` | A server token with no scopes (public reads only) |
| `RESEND_API_KEY` | Owner emails only |
| `CRON_SECRET` | Unchanged, and the same value as the GitHub repo secret `CRON_SECRET` |
| `EARNKIT_PROGRAMS_TOKEN` | The Grok Bot's write token (unchanged) |
| `EARNKIT_PROGRAMS_API` | Optional; `off` closes the write API |

- [ ] Variables trimmed to the list above.
- [ ] GitHub repo secret `CRON_SECRET` is still set and equals the Railway value (the workflow skips quietly when it is unset).

## 2. Deploy

- [ ] Merge the PR. `predeploy` runs `pnpm db:migrate` (additive; v4 tables are untouched) and `pnpm programs:sync`.
- [ ] Deploy with `railway up` (the GitHub source is broken, per the owner's notes).
- [ ] Check: `https://earnkit.com/api/stats` answers the nine v5 keys; `/mcp` answers 401 with a challenge; `/install` redirects to `/docs#install`.
- [ ] Run the cron once by hand: Actions, "EarnKit cron", Run workflow. It must pass.

## 3. v4 tables (after a backup)

- [ ] Back up the production database first (`pg_dump`, stored off Railway).
- [ ] `pnpm db:v4-tables` lists every table outside `db/schema.sql` with row counts and prints the DROP statements. It runs none.
- [ ] Drop them only when you are sure; this is never automatic. Keep `installations` and `programs` (v5 tables with the same names).

## 4. The Grok Bot

- [ ] Replace the Grok Bot's instructions with `docs/programs-api.md` (v5: any program that pays builders, any chain, `form`, `eligibility`, `results_due`, weekly sweep list).
- [ ] Its token is the existing `EARNKIT_PROGRAMS_TOKEN`; nothing to re-issue.

## 5. Chain registry check

`apps/frontend/lib/v5/chains.ts` was written from an implementer's memory for three chains. Confirm in each chain's official docs and fix the file if any is wrong:

- [ ] ethereum: RPC `ethereum-rpc.publicnode.com`, explorer `etherscan.io`.
- [ ] polygon: RPC `polygon-rpc.com`, explorer `polygonscan.com`, chain id 137.
- [ ] arc: mainnet id 5042, RPC `rpc.mainnet.arc.io`, explorer `explorer.arc.io`.

These hosts appear in the gap details an agent follows ("deploy the contract on Arc"), so a wrong host sends a builder to the wrong place.

## 6. jenil.ai funnel follow-up

A jenil.ai change, not an EarnKit one. The funnel tool reads `earnkit.com/api/stats` and the EarnKit database directly.

- [ ] Drop the retired `/api/stats` keys: `installs`/`activated`/`weekly_active`/`shared`/`coins_launched`/`fees_to_safe_eth` and the old shape. v5 returns `programs_open`, `open_money_usd`, `installs`, `installs_active_7d`, `finds_7d`, `applications`, `applications_7d`, `won`, `won_usd`.
- [ ] Drop the `projects` read (the table is a v4 table and is not written any more).
- [ ] Keep the reads of `installations.last_seen_at` and `programs.status`, `starts_at`, `ends_at`; v5 keeps those columns with their names.

## 7. The launch bar (design section 9)

v5 is done, and ready for public launch, in this order:

- [ ] 1. The owner's agent, on a fresh install with zero identity steps, gets a reply in the design shape for the EarnKit repo.
- [ ] 2. The owner sends one real application through v5 and records it with `track`.
- [ ] 3. The owner uses it on two consecutive Mondays without asking it anything.
- [ ] 4. At least 50 programs listed, each with its form mirrored field by field in `submission_requirements` and `form.fields` wherever the platform exposes ids; at least 20 of them not on the v4 chain list.
- [ ] 5. Then ten builders the owner talks to.

Measured (effort only, never a target the builder decides): programs listed, programs with form fields, installs, finds per week, applications per week, won.
