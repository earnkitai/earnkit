-- CreateEnum
CREATE TYPE "BurnMode" AS ENUM ('DEAD_ADDRESS', 'TOKEN_BURN_FN');

-- CreateEnum
CREATE TYPE "BuybackStatus" AS ENUM ('QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'COMPLETED', 'FAILED', 'RETRYING');

-- CreateTable
CREATE TABLE "buyback_configs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "token_address" TEXT NOT NULL,
    "token_symbol" TEXT NOT NULL,
    "token_decimals" INTEGER NOT NULL,
    "threshold_usd" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "slippage_bps" INTEGER NOT NULL DEFAULT 500,
    "burn_mode" "BurnMode" NOT NULL DEFAULT 'DEAD_ADDRESS',
    "turnkey_sub_org_id" TEXT NOT NULL,
    "turnkey_wallet_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "co_signer_endpoint" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMP(3),
    "last_triggered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyback_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyback_executions" (
    "id" TEXT NOT NULL,
    "buyback_config_id" TEXT NOT NULL,
    "status" "BuybackStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger_balance_usd" DOUBLE PRECISION NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "warehouse_withdraw_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "swap_hash" TEXT,
    "burn_hash" TEXT,
    "assets_in" JSONB,
    "tokens_out_amount" TEXT,
    "tokens_out_usd" DOUBLE PRECISION,
    "gas_spent_eth" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "buyback_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyback_configs_agent_id_key" ON "buyback_configs"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyback_configs_turnkey_sub_org_id_key" ON "buyback_configs"("turnkey_sub_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyback_configs_turnkey_wallet_id_key" ON "buyback_configs"("turnkey_wallet_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyback_configs_wallet_address_key" ON "buyback_configs"("wallet_address");

-- CreateIndex
CREATE INDEX "buyback_configs_is_active_idx" ON "buyback_configs"("is_active");

-- CreateIndex
CREATE INDEX "buyback_configs_wallet_address_idx" ON "buyback_configs"("wallet_address");

-- CreateIndex
CREATE INDEX "buyback_executions_buyback_config_id_status_idx" ON "buyback_executions"("buyback_config_id", "status");

-- CreateIndex
CREATE INDEX "buyback_executions_status_next_attempt_at_idx" ON "buyback_executions"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "buyback_configs" ADD CONSTRAINT "buyback_configs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyback_executions" ADD CONSTRAINT "buyback_executions_buyback_config_id_fkey" FOREIGN KEY ("buyback_config_id") REFERENCES "buyback_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

