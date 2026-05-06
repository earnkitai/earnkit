# EarnKit buyback co-signer (Cloudflare Worker)

This Worker holds the **second of two stamper keys** required by the Turnkey
sub-org policy attached to every auto-buyback wallet. The first stamper lives
in the earn-backend (Railway). Both stamps are required for Turnkey to execute
any signing activity, so a Railway-only compromise cannot move funds — an
attacker would also have to compromise this Worker, deployed in a separate
Cloudflare account.

## Hard rules

1. **Deploy this in a Cloudflare account that is not used for anything else
   EarnKit operates.** Separate login, separate billing, separate MFA. This
   isolation is the entire point.
2. **Never copy `TURNKEY_API_PRIVATE_KEY` from the Railway environment.** The
   key in this Worker is a different key, registered as a separate user in the
   Turnkey parent org.
3. **Set all env values via `wrangler secret put`, never via `wrangler.toml`
   `[vars]`.** Secrets in `[vars]` are committed to the bundle.

## One-time setup

1. **Create the second stamper key in Turnkey.**
   - Generate a P-256 keypair locally: `npx @turnkey/cli gen --key-name buyback-cosigner --directory ./keys`.
   - In the Turnkey dashboard for the parent org, create a new user named
     `buyback-cosigner`. Add the public half of the keypair as an API key on
     that user. Copy the user's ID — that's `TURNKEY_COSIGNER_USER_ID` (also
     set on Railway).

2. **Create a fresh Cloudflare account** (separate from anything else you operate).

3. **Install wrangler and log in.**
   ```
   npm install -g wrangler
   wrangler login
   ```

4. **Deploy and set secrets.** From `apps/buyback-cosigner/`:
   ```
   pnpm install
   wrangler deploy
   wrangler secret put TURNKEY_API_PUBLIC_KEY        # public half from step 1
   wrangler secret put TURNKEY_API_PRIVATE_KEY       # private half from step 1
   wrangler secret put TURNKEY_PARENT_ORG_ID         # same as Railway
   wrangler secret put COSIGNER_SHARED_SECRET        # `openssl rand -base64 32`
   wrangler secret put BUYBACK_BACKEND_BASE_URL      # https://your-railway-url
   wrangler secret put BUYBACK_BACKEND_INTERNAL_KEY  # MUST match Railway's existing INTERNAL_API_SECRET
   ```
   Wrangler prints the deployed URL (e.g.
   `https://earnkit-buyback-cosigner.<account>.workers.dev`).

5. **Configure Railway.** Set on earn-backend:
   ```
   BUYBACK_COSIGNER_URL=https://earnkit-buyback-cosigner.<account>.workers.dev
   BUYBACK_COSIGNER_SHARED_SECRET=<same value you wrangler-secret-put above>
   INTERNAL_API_SECRET=<same value as the Worker's BUYBACK_BACKEND_INTERNAL_KEY>
   TURNKEY_COSIGNER_USER_ID=<from step 1>
   ```

## What the Worker does on every request

1. Auth: rejects unless `x-cosigner-secret` header equals `COSIGNER_SHARED_SECRET`.
2. Re-fetches the activity from Turnkey by id (does not trust the caller's
   claim about what's being signed).
3. Validates the unsigned tx matches one of two permitted shapes:
   - **Buyback op**: `from` is a known buyback wallet, `to` + selector match
     Warehouse withdraw, Uniswap swap, ERC-20 approve to SwapRouter,
     transfer-to-dEaD of the configured user token, or token.burn.
   - **Operator gas drip**: `from` is the operator wallet, `to` is a known
     buyback wallet, `data` is empty, `value` ≤ 0.005 ETH.
4. Calls Turnkey `approveActivity` to add the second stamp.

The whitelist of known buyback wallets is fetched from earn-backend at
`/api/internal/buyback-wallets` (60s cache).

## What is intentionally NOT in this Worker

- No DB access, no on-chain RPC, no signing of arbitrary payloads, no
  arbitrary contract calls. The only output is "approve this Turnkey activity
  if it matches the shape I know."
- No way to provision new sub-orgs, attach policies, or change the whitelist.
- No outbound network access except to `api.turnkey.com` and the configured
  earn-backend URL.

## Local development

Use `wrangler dev` to run locally. Secrets default to nothing; set them via
a local `.dev.vars` file (gitignored — never commit). For local earn-backend
testing without a real co-signer deploy, set `BUYBACK_COSIGNER_URL=stub` on
Railway/local backend — the backend has a guard that refuses stub mode in
production.
