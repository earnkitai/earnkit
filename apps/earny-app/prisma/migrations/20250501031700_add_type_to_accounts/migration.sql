-- AlterTable
ALTER TABLE "apple_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'apple_oauth';

-- AlterTable
ALTER TABLE "cross_app_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'cross_app';

-- AlterTable
ALTER TABLE "custom_jwt_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'custom_auth';

-- AlterTable
ALTER TABLE "discord_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'discord_oauth';

-- AlterTable
ALTER TABLE "email_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'email';

-- AlterTable
ALTER TABLE "farcaster_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'farcaster';

-- AlterTable
ALTER TABLE "github_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'github_oauth';

-- AlterTable
ALTER TABLE "google_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'google_oauth';

-- AlterTable
ALTER TABLE "instagram_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'instagram_oauth';

-- AlterTable
ALTER TABLE "linkedin_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'linkedin_oauth';

-- AlterTable
ALTER TABLE "passkey_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'passkey';

-- AlterTable
ALTER TABLE "phone_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'phone';

-- AlterTable
ALTER TABLE "smart_wallet_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'smart_wallet';

-- AlterTable
ALTER TABLE "spotify_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'spotify_oauth';

-- AlterTable
ALTER TABLE "telegram_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'telegram';

-- AlterTable
ALTER TABLE "tiktok_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'tiktok_oauth';

-- AlterTable
ALTER TABLE "twitter_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'twitter_oauth';

-- AlterTable
ALTER TABLE "wallet_accounts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'wallet';
