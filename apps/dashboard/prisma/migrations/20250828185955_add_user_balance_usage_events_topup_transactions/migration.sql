-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DELETED');

-- CreateEnum
CREATE TYPE "FeeModel" AS ENUM ('FREE_TIER', 'CREDIT_BASED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('EARNING', 'WITHDRAWAL', 'TOP_UP', 'REFUND');

-- CreateEnum
CREATE TYPE "UsageEventStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TopUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "has_accepted_terms" BOOLEAN NOT NULL DEFAULT false,
    "is_guest" BOOLEAN NOT NULL DEFAULT false,
    "mfa_methods" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'wallet',
    "address" TEXT NOT NULL,
    "chain_type" TEXT NOT NULL,
    "wallet_client_type" TEXT NOT NULL,
    "connector_type" TEXT NOT NULL,
    "recovery_method" TEXT NOT NULL,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "delegated" BOOLEAN NOT NULL DEFAULT false,
    "wallet_index" INTEGER,

    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_wallet_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'smart_wallet',
    "address" TEXT NOT NULL,
    "smart_wallet_type" TEXT NOT NULL,

    CONSTRAINT "smart_wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'email',
    "address" TEXT NOT NULL,

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'phone',
    "number" TEXT NOT NULL,

    CONSTRAINT "phone_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'google_oauth',
    "subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "google_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twitter_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'twitter_oauth',
    "subject" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "profile_picture_url" TEXT,

    CONSTRAINT "twitter_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'discord_oauth',
    "subject" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,

    CONSTRAINT "discord_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'github_oauth',
    "subject" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "email" TEXT,

    CONSTRAINT "github_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spotify_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'spotify_oauth',
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,

    CONSTRAINT "spotify_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'instagram_oauth',
    "subject" TEXT NOT NULL,
    "username" TEXT,

    CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiktok_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'tiktok_oauth',
    "subject" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,

    CONSTRAINT "tiktok_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linkedin_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'linkedin_oauth',
    "subject" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "vanity_name" TEXT,

    CONSTRAINT "linkedin_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apple_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'apple_oauth',
    "subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "apple_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_jwt_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'custom_auth',
    "custom_user_id" TEXT NOT NULL,

    CONSTRAINT "custom_jwt_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farcaster_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'farcaster',
    "fid" INTEGER,
    "owner_address" TEXT NOT NULL,
    "username" TEXT,
    "display_name" TEXT,
    "bio" TEXT,
    "pfp" TEXT,
    "url" TEXT,
    "signer_public_key" TEXT,

    CONSTRAINT "farcaster_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'passkey',
    "credential_id" TEXT NOT NULL,
    "enrolled_in_mfa" BOOLEAN NOT NULL DEFAULT false,
    "authenticator_name" TEXT NOT NULL,
    "created_with_device" TEXT NOT NULL,
    "created_with_os" TEXT NOT NULL,
    "created_with_browser" TEXT NOT NULL,

    CONSTRAINT "passkey_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'telegram',
    "telegram_user_id" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "username" TEXT,
    "photo_url" TEXT,

    CONSTRAINT "telegram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_app_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'cross_app',
    "subject" TEXT NOT NULL,
    "provider_app" JSONB NOT NULL,

    CONSTRAINT "cross_app_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedded_wallets" (
    "id" TEXT NOT NULL,
    "cross_app_account_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "embedded_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_wallets" (
    "id" TEXT NOT NULL,
    "cross_app_account_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "smart_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "feeModel" "FeeModel" NOT NULL DEFAULT 'FREE_TIER',
    "free_prompt_threshold" INTEGER,
    "rate_per_prompt" DOUBLE PRECISION,
    "credits_per_prompt" INTEGER,
    "total_earnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "top_up_packages" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "top_up_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_logs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "transaction_hash" TEXT,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "transactionType" "TransactionType" NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_balances" (
    "userWalletAddress" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "ethBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "creditBalance" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_balances_pkey" PRIMARY KEY ("userWalletAddress","agentId")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "status" "UsageEventStatus" NOT NULL DEFAULT 'PENDING',
    "feeDeducted" DECIMAL(65,30),
    "creditsDeducted" BIGINT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "agentId" TEXT NOT NULL,
    "userWalletAddress" TEXT NOT NULL,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "top_up_transactions" (
    "txHash" TEXT NOT NULL,
    "status" "TopUpStatus" NOT NULL DEFAULT 'PENDING',
    "userWalletAddress" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "amountInEth" TEXT NOT NULL,
    "creditsToTopUp" BIGINT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "top_up_transactions_pkey" PRIMARY KEY ("txHash")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_id_key" ON "users"("id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agents_agent_id_key" ON "agents"("agent_id");

-- CreateIndex
CREATE INDEX "agents_user_id_idx" ON "agents"("user_id");

-- CreateIndex
CREATE INDEX "agents_agent_id_idx" ON "agents"("agent_id");

-- CreateIndex
CREATE INDEX "agents_status_idx" ON "agents"("status");

-- CreateIndex
CREATE INDEX "agents_created_at_idx" ON "agents"("created_at");

-- CreateIndex
CREATE INDEX "top_up_packages_agent_id_idx" ON "top_up_packages"("agent_id");

-- CreateIndex
CREATE INDEX "top_up_packages_is_active_idx" ON "top_up_packages"("is_active");

-- CreateIndex
CREATE INDEX "transaction_logs_agent_id_idx" ON "transaction_logs"("agent_id");

-- CreateIndex
CREATE INDEX "transaction_logs_user_id_idx" ON "transaction_logs"("user_id");

-- CreateIndex
CREATE INDEX "transaction_logs_status_idx" ON "transaction_logs"("status");

-- CreateIndex
CREATE INDEX "transaction_logs_transactionType_idx" ON "transaction_logs"("transactionType");

-- CreateIndex
CREATE INDEX "transaction_logs_created_at_idx" ON "transaction_logs"("created_at");

-- CreateIndex
CREATE INDEX "usage_events_agentId_userWalletAddress_status_idx" ON "usage_events"("agentId", "userWalletAddress", "status");

-- CreateIndex
CREATE UNIQUE INDEX "usage_events_agentId_idempotencyKey_key" ON "usage_events"("agentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "top_up_transactions_status_idx" ON "top_up_transactions"("status");

-- AddForeignKey
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_wallet_accounts" ADD CONSTRAINT "smart_wallet_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_accounts" ADD CONSTRAINT "phone_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twitter_accounts" ADD CONSTRAINT "twitter_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_accounts" ADD CONSTRAINT "discord_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_accounts" ADD CONSTRAINT "github_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spotify_accounts" ADD CONSTRAINT "spotify_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_accounts" ADD CONSTRAINT "linkedin_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apple_accounts" ADD CONSTRAINT "apple_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_jwt_accounts" ADD CONSTRAINT "custom_jwt_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farcaster_accounts" ADD CONSTRAINT "farcaster_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkey_accounts" ADD CONSTRAINT "passkey_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_app_accounts" ADD CONSTRAINT "cross_app_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embedded_wallets" ADD CONSTRAINT "embedded_wallets_cross_app_account_id_fkey" FOREIGN KEY ("cross_app_account_id") REFERENCES "cross_app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_wallets" ADD CONSTRAINT "smart_wallets_cross_app_account_id_fkey" FOREIGN KEY ("cross_app_account_id") REFERENCES "cross_app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "top_up_packages" ADD CONSTRAINT "top_up_packages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_logs" ADD CONSTRAINT "transaction_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_balances" ADD CONSTRAINT "user_balances_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "top_up_transactions" ADD CONSTRAINT "top_up_transactions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
