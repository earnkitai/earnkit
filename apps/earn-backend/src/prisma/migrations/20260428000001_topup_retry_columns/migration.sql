-- Migration: topup_retry_columns
-- Adds attempt_count and next_attempt_at to top_up_transactions
-- so the durable verification worker can track retries without setTimeout.

ALTER TABLE "top_up_transactions"
  ADD COLUMN "attempt_count"   INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN "next_attempt_at" TIMESTAMP;
