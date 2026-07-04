-- Add claimed_at to both execution tables so the reaper can detect rows wedged
-- in a transitional state (WITHDRAWING/SWAPPING/BURNING) by a crashed worker.
-- Nullable; set each time a worker claims a row.
ALTER TABLE "buyback_executions" ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMP(3);
ALTER TABLE "shared_split_executions" ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMP(3);
