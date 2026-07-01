# EarnKit Cleanup Audit

**Context:** We're migrating the DB from Railway → Neon and want to strip out everything unused first.
Only three things are actively used: **`apps/earn-backend`**, **`apps/dashboard`**, **`apps/buyback-cosigner`**.
This document lists every deletion candidate found in a full code + live-DB audit, grouped by category and risk.

## ✅ EXECUTED (2026-07-02)
- **Section A (dormant apps): SKIPPED** — decision: keep all sub-app folders (blogs, earny-app, etc.).
- **Section B (19 unused tables): DROPPED** — all 19 Privy mirror tables. `wallet_accounts` kept.
- **Section C (webhooks): DROPPED** — feature code (7 files) removed + `webhook_endpoints`/`webhook_deliveries` dropped.
- **Section D (dead code): REMOVED** — 8 files deleted in earn-backend, dead code removed in dashboard.
- **Section E (schema drift): FIXED** — both `schema.prisma` files are now identical (earn-backend = source of truth).
- DB migration `20260702000000_drop_unused_privy_and_webhook_tables` applied to Railway (21 tables dropped, all empty).
- Pre-drop full backup: `../earnkit_railway_backup_predrop.sql` (outside repo — contains prod data, do NOT commit).
- Verified: both apps `prisma generate` + `tsc --noEmit` pass (exit 0); Railway now has 18 tables; live data intact.
- **Remaining: the Railway → Neon data move itself (next phase).**

Live DB fact: the Railway DB (`earnkit-db-prod-v2`) contains **exactly the 38 schema tables + `_prisma_migrations`** — no orphan tables. So "cleanup" = removing tables whose *feature/code* is dead, not junk tables.

---

## A. Dormant apps (whole directories)

No active app imports from or depends on any of these (verified: zero `workspace:` deps, zero cross-app imports).

| App | What it is | Touches DB? | Safe to delete? |
|-----|-----------|-------------|-----------------|
| `apps/agent-backend` | Express + Socket.IO + Redis realtime service | No | ✅ yes |
| `apps/blogs` | Next.js blog (create-next-app default) | No | ✅ yes |
| `apps/earny-home` | Next.js "Earny" homepage | No | ✅ yes |
| `apps/frontend` | Next.js app (create-next-app default) | No | ✅ yes |
| `apps/earny-app` | Next.js chat/trading UI (largest, ~172 files). Own Prisma schema (Chat/Message/LimitOrder/OrderHistory) → **separate DB** | Yes (its own) | ⚠️ delete code is safe; confirm its DB isn't reused |
| `apps/backend` | **Legacy** REST API, raw `pg` + SQL migrations. Precursor of earn-backend. Points at the **same shared `DATABASE_URL`** | Yes (shared) | ⚠️ delete app is fine — **do NOT drop the DB**; confirm `migrate:*` scripts below are obsolete first |
| `apps/contracts` (`@earnkit/contracts`) | Solidity contracts mirror. `earn-backend/contract/` is the real compiled source | No | ⚠️ confirm earn-backend's own `contract/` copy is authoritative, then ✅ |
| `apps/packages/earn` (`earnkit-sdk`) | Publishable npm SDK, standalone (not in workspace) | No | ⚠️ it's a **published** package — keep if you want to maintain/republish the SDK |
| root `public/` | 2 vestigial wallet SVGs | No | ✅ low-risk |

**Root `package.json` scripts to prune** if the above are deleted (they'd break):
`build:backend`, `build:frontend`, `build:earnyhome`, `build:blogs`, `build:agent_backend`, `build:earnyapp`, `build:agentbackend`, `build:railway`, all matching `dev:*` / `start:*` / `test:*` / `lint:*` for those apps, `dev:bot` (references a non-existent app), and the `migrate:database` / `migrate:tables` / `migrate:deploy_tokens` / `migrate:columns_in_deployed_tokens` scripts (legacy `--filter backend` raw-SQL migrations — **confirm not production path** before removing).
Keep: `*:dashboard`, `*:earnbackend`, and generic `build`/`start`/`lint`/`test`/`format`/`preinstall`.

---

## B. Unused DB tables — safe to drop (empty, never written, no live code)

All empty in production. The only writer (`createLinkedAccounts`) is **dead code, never called**. The dashboard's linked-account/wallet UI is sourced **directly from the Privy SDK** (`useUser` even hardcodes `linkedAccounts: []`). earn-backend never touches these models.

**Social / OAuth mirrors (15):**
`apple_accounts`, `google_accounts`, `twitter_accounts`, `discord_accounts`, `github_accounts`, `spotify_accounts`, `instagram_accounts`, `tiktok_accounts`, `linkedin_accounts`, `farcaster_accounts`, `telegram_accounts`, `phone_accounts`, `email_accounts`, `passkey_accounts`, `custom_jwt_accounts`

**Wallet-family mirrors (4):**
`cross_app_accounts`, `embedded_wallets`, `smart_wallets`, `smart_wallet_accounts`

> **KEEP `wallet_accounts`** — it is actively synced via `syncWalletAccounts` (2 rows in prod).

**Removal touches:** both `schema.prisma` files (models + `User` relation fields), `dashboard/actions/user.ts` (6 `include` blocks + `transformLinkedAccounts` branches), `dashboard/actions/linked-accounts.ts` (delete `createLinkedAccounts`). No data migration needed (empty).

---

## C. Built-but-unadopted feature — DECISION NEEDED

**Webhooks** (`webhook_endpoints`, `webhook_deliveries`). Empty tables, but the feature is **fully wired and running** (routes at `/api/webhooks`, delivery worker polling every 30s, deliveries enqueued from the payment flow). Empty = no customer has registered an endpoint yet, **not** dead code.

- **Keep** → leave tables + 7 files as-is (recommended; it's a working feature).
- **Drop** → delete the feature: `routes/webhooks.ts`, `services/webhookService.ts`, `workers/webhookDeliveryWorker.ts`, plus edits to `index.ts`, `routes/index.ts`, `services/paymentIntentService.ts` (remove 2 enqueue calls), and both models.

👉 **Your call: do you want to offer webhooks to customers, ever?**

---

## D. Dead code inside the active apps (no DB impact — pure code cleanup)

### earn-backend
- `src/services/ledgerService.ts` — **dead** (no callers; ledger writes done inline elsewhere).
- `package.json` → `db:init` script — **broken** (target `src/scripts/initDb.ts` doesn't exist).
- One-off historical scripts (safe to archive/remove): `src/scripts/repriceBuybackExecutions.ts`, `setV4PoolKey.ts`, `attachBuybackV4Policy.ts`, `triggerSharedBuyback.ts`.
- `src/lib/turnkeyPolicy.ts:30` — a param explicitly marked DEPRECATED/IGNORED (minor).

### dashboard
- `actions/linked-accounts.ts` → `createLinkedAccounts` (:27), `addWalletAccount` (:341) — **dead**.
- `actions/user.ts` → `getWalletAccounts` (:557) — dead; `findAllUsers` (:213), `deleteUser` (:208), `findUserByEmail` (:68) — only reachable via dead `/api/users/*` routes.
- `actions/web3.ts` — ~7 dead functions superseded by `lib/web3.ts` (`getBalance`, `getTokenBalances`, `getTokenBalance`, `getTransactions`, `getTokenMetadataWithCoingecko`, `getTokenMetadataBasedOnChain`, `fetchEthValueByUsd`). Only `getTokenPrice` is still used.
- `app/(routes)/new-agent/page.tsx` (634 lines) + `app/api/agents/route.ts` — **orphaned** agent-creation flow, superseded by `/create`.
- `app/api/users/route.ts`, `app/api/users/[id]/route.ts`, `app/api/users/email/[email]/route.ts`, `app/api/users/username/[username]/route.ts` — **dead** (no dashboard callers). ⚠️ confirm no external client hits them first.
- Dead components (never imported): `app/components/PrerequisiteModal.tsx`, `app/components/common/NewFooter.tsx`, `app/components/ui/SocialButton.tsx`, `app/(routes)/settings/components/EmbeddedWalletSection.tsx`, `app/(routes)/settings/components/RevokeAccessButton.tsx`.
- `app/sign-up/passkeys/page.tsx` — orphaned (only nav to it is commented out).

### WIP / placeholder pages (not live)
- `app/(routes)/discover/page.tsx` — "Coming Soon" placeholder (linked in sidebar).
- `app/(routes)/create-wallet/page.tsx` + `create-wallet/success/page.tsx` — non-functional mock.
- `app/sentry-example-page/page.tsx` + `app/api/sentry-example-api/route.ts` — Sentry demo scaffold.

---

## E. Schema drift (fix, not delete)

The dashboard schema is **stale** vs earn-backend (both manage the same DB). Worth reconciling as part of the Neon move — earn-backend should be the source of truth:
- `BuybackConfig.slippageBps` default: **150** (earn-backend) vs **500** (dashboard).
- `TopUpTransaction`: dashboard schema missing 5 columns (`attemptCount`, `nextAttemptAt`, `tokenAddress`, `tokenSymbol`, `amountInToken`) + 1 index.
- Dashboard schema missing 7 models earn-backend has: `AgentTokenConfig`, `PaymentIntent`, `LedgerEntry`, `WebhookEndpoint`, `WebhookDelivery`, `SharedSplitBuybackConfig`, `SharedSplitExecution` (dashboard just doesn't manage these — but running `migrate deploy` from dashboard could conflict).

---

## Open decisions before we execute
1. **Webhooks** (Section C): keep or drop the feature?
2. **Wallet-family tables** (Section B): drop all 19 mirrors, or only the 15 social ones?
3. **earnkit-sdk** (`apps/packages/earn`): keep (still publishing it) or delete?
4. **`contracts`**: confirm `earn-backend/contract/` is authoritative → then delete.
5. **Legacy `backend` migrations**: confirm `migrate:*` scripts aren't your production migration path.
