-- CreateTable: agent_token_configs for managing per-agent token payment settings
CREATE TABLE "agent_token_configs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "token_address" TEXT NOT NULL,
    "token_symbol" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "discount_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_token_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_token_configs_agent_id_idx" ON "agent_token_configs"("agent_id");

-- CreateIndex
CREATE INDEX "agent_token_configs_token_address_idx" ON "agent_token_configs"("token_address");

-- CreateIndex (unique constraint for agent + token)
CREATE UNIQUE INDEX "agent_token_configs_agent_id_token_address_key" ON "agent_token_configs"("agent_id", "token_address");

-- AddForeignKey
ALTER TABLE "agent_token_configs" ADD CONSTRAINT "agent_token_configs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

