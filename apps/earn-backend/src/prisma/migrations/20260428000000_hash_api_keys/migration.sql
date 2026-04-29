-- Migration: hash_api_keys
-- Adds api_key_prefix column to users table.
-- Existing plaintext api_key values are cleared (forced re-generation)
-- because we cannot retroactively hash them — we only have the plaintext.
-- After this migration the api_key column stores SHA-256 hashes.

ALTER TABLE "users" ADD COLUMN "api_key_prefix" TEXT;

-- Invalidate all existing plaintext keys so users regenerate through the dashboard.
UPDATE "users" SET "api_key" = NULL, "api_key_prefix" = NULL WHERE "api_key" IS NOT NULL;
