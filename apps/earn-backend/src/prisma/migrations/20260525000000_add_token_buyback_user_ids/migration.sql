-- Per-token Doppler buyback flow (tokens.fun creation) needs the two-phase
-- provisioning to attach a token-specific policy AFTER the on-chain token
-- address exists. Phase 1 (wallet provision) returns the sub-org-local
-- parent-admin + cosigner user IDs; Phase 2 (policy attach) needs them again.
--
-- Storing them on SharedSplitBuybackConfig avoids re-querying Turnkey at
-- activation time. Both columns are nullable because existing rows (agent
-- buyback flow, splits-card / token-card 0xSplits flows) never go through
-- two-phase provisioning — the policy is attached in the same call as the
-- wallet creation, so these IDs are only meaningful in memory and never
-- persisted.

ALTER TABLE "shared_split_buyback_configs"
  ADD COLUMN IF NOT EXISTS "parent_admin_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "co_signer_user_id" TEXT;
