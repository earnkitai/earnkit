-- Enforce lowercase wallet addresses at the database level.
--
-- Background: every read path lowercases the address before lookup, so any
-- row written in mixed case becomes unreachable (silent credit loss). These
-- CHECK constraints make Postgres reject the bad write directly with
-- error 23514 (check_violation) instead of letting the data drift.
--
-- Prereq: existing rows have already been lowercased by
-- scripts/normalize-wallet-case.ts (applied 2026-05-19). Adding the
-- constraint to non-conforming data would fail; running the script first
-- guarantees the migration is a no-op on existing rows.

ALTER TABLE "user_balances"
  ADD CONSTRAINT "user_balances_wallet_lowercase_check"
  CHECK ("userWalletAddress" = LOWER("userWalletAddress"));

ALTER TABLE "gift_code_redemptions"
  ADD CONSTRAINT "gift_code_redemptions_wallet_lowercase_check"
  CHECK ("user_wallet_address" = LOWER("user_wallet_address"));

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_wallet_lowercase_check"
  CHECK (
    "customer_wallet_address" IS NULL
    OR "customer_wallet_address" = LOWER("customer_wallet_address")
  );

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_wallet_lowercase_check"
  CHECK (
    "user_wallet_address" IS NULL
    OR "user_wallet_address" = LOWER("user_wallet_address")
  );

ALTER TABLE "top_up_transactions"
  ADD CONSTRAINT "top_up_transactions_wallet_lowercase_check"
  CHECK ("userWalletAddress" = LOWER("userWalletAddress"));

ALTER TABLE "usage_events"
  ADD CONSTRAINT "usage_events_wallet_lowercase_check"
  CHECK ("userWalletAddress" = LOWER("userWalletAddress"));
