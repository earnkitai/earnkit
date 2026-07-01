-- Drop unused Privy linked-account mirror tables.
-- These were never written by any live code path (the only writer,
-- dashboard `createLinkedAccounts`, was dead code) and the dashboard reads
-- linked accounts directly from the Privy SDK. All were empty at drop time.
-- `wallet_accounts` is intentionally retained (actively synced).
DROP TABLE IF EXISTS "smart_wallet_accounts" CASCADE;
DROP TABLE IF EXISTS "email_accounts" CASCADE;
DROP TABLE IF EXISTS "phone_accounts" CASCADE;
DROP TABLE IF EXISTS "google_accounts" CASCADE;
DROP TABLE IF EXISTS "twitter_accounts" CASCADE;
DROP TABLE IF EXISTS "discord_accounts" CASCADE;
DROP TABLE IF EXISTS "github_accounts" CASCADE;
DROP TABLE IF EXISTS "spotify_accounts" CASCADE;
DROP TABLE IF EXISTS "instagram_accounts" CASCADE;
DROP TABLE IF EXISTS "tiktok_accounts" CASCADE;
DROP TABLE IF EXISTS "linkedin_accounts" CASCADE;
DROP TABLE IF EXISTS "apple_accounts" CASCADE;
DROP TABLE IF EXISTS "custom_jwt_accounts" CASCADE;
DROP TABLE IF EXISTS "farcaster_accounts" CASCADE;
DROP TABLE IF EXISTS "passkey_accounts" CASCADE;
DROP TABLE IF EXISTS "telegram_accounts" CASCADE;
-- embedded_wallets / smart_wallets depend on cross_app_accounts; drop them first.
DROP TABLE IF EXISTS "embedded_wallets" CASCADE;
DROP TABLE IF EXISTS "smart_wallets" CASCADE;
DROP TABLE IF EXISTS "cross_app_accounts" CASCADE;

-- Drop the unadopted outbound-webhook feature tables (no endpoints ever registered).
-- webhook_deliveries references webhook_endpoints; drop it first.
DROP TABLE IF EXISTS "webhook_deliveries" CASCADE;
DROP TABLE IF EXISTS "webhook_endpoints" CASCADE;
