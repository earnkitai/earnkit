-- Phase 2 (activation) of the per-token Doppler buyback flow can fail
-- transiently (Turnkey timeout, RPC hiccup, token-safety edge cases). Without
-- telemetry the failure is invisible — the config stays in PROVISIONING and
-- the worker never picks it up. These columns:
--   * last_activation_error / last_activation_attempt_at / activation_attempts:
--     captured every time activate-token-buyback runs (success or fail).
--     The admin UI shows the error to the creator; the worker uses these to
--     decide whether to retry and to back off.
--   * pending_token_address: the token address the caller supplied. Stored
--     even on failure so the worker can retry attach without needing the
--     caller to re-send it.
--   * swap_venue / v4_*: Doppler tokens trade on Uniswap V4 multicurve, not
--     V3. The worker branches on swap_venue and the V4 pool fields drive both
--     the calldata construction and the Turnkey signing policy (V4 router +
--     Permit2 vs V3 SwapRouter02). Existing agent-buyback rows default to
--     UNISWAP_V3 to preserve current behavior.

ALTER TABLE "shared_split_buyback_configs"
  ADD COLUMN IF NOT EXISTS "last_activation_error" TEXT,
  ADD COLUMN IF NOT EXISTS "last_activation_attempt_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "activation_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pending_token_address" TEXT,
  ADD COLUMN IF NOT EXISTS "swap_venue" TEXT NOT NULL DEFAULT 'UNISWAP_V3',
  ADD COLUMN IF NOT EXISTS "v4_pool_hook" TEXT,
  ADD COLUMN IF NOT EXISTS "v4_paired_token" TEXT,
  ADD COLUMN IF NOT EXISTS "v4_tick_spacing" INTEGER,
  ADD COLUMN IF NOT EXISTS "v4_fee_flag" INTEGER;
