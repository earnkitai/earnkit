-- Payment infra foundation for merchant-grade EarnKit flows.
-- This keeps existing MiniDev credit tables intact while adding durable
-- payment intent, ledger, and webhook records for future checkout APIs.

CREATE TYPE "PaymentIntentStatus" AS ENUM (
    'CREATED',
    'REQUIRES_PAYMENT',
    'PROCESSING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'EXPIRED'
);

CREATE TYPE "PaymentMethodType" AS ENUM (
    'ETH',
    'ERC20'
);

CREATE TYPE "LedgerEntryType" AS ENUM (
    'PAYMENT_INTENT_CREATED',
    'PAYMENT_RECEIVED',
    'CREDIT_GRANTED',
    'USAGE_RESERVED',
    'USAGE_CAPTURED',
    'USAGE_RELEASED',
    'REFUND',
    'WITHDRAWAL',
    'FEE'
);

CREATE TYPE "LedgerEntryStatus" AS ENUM (
    'PENDING',
    'POSTED',
    'REVERSED',
    'FAILED'
);

CREATE TYPE "WebhookDeliveryStatus" AS ENUM (
    'PENDING',
    'DELIVERED',
    'FAILED',
    'CANCELLED'
);

CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "external_reference" TEXT,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "customer_wallet_address" TEXT,
    "amount_in_usd" DECIMAL(65,30),
    "credits_to_top_up" BIGINT,
    "payment_method_type" "PaymentMethodType" NOT NULL DEFAULT 'ETH',
    "token_address" TEXT,
    "token_symbol" TEXT,
    "amount_atomic" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "tx_hash" TEXT,
    "metadata" JSONB,
    "expires_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "payment_intent_id" TEXT,
    "user_wallet_address" TEXT,
    "entry_type" "LedgerEntryType" NOT NULL,
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'PENDING',
    "amount_in_usd" DECIMAL(65,30),
    "credits" BIGINT,
    "payment_method_type" "PaymentMethodType" NOT NULL DEFAULT 'ETH',
    "token_address" TEXT,
    "token_symbol" TEXT,
    "amount_atomic" TEXT,
    "chain_id" INTEGER,
    "tx_hash" TEXT,
    "idempotency_key" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "payment_intent_id" TEXT,
    "event_type" TEXT NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "response_status" INTEGER,
    "response_body" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_intents_client_secret_key" ON "payment_intents"("client_secret");
CREATE UNIQUE INDEX "payment_intents_tx_hash_key" ON "payment_intents"("tx_hash");
CREATE INDEX "payment_intents_agent_id_status_idx" ON "payment_intents"("agent_id", "status");
CREATE INDEX "payment_intents_customer_wallet_address_idx" ON "payment_intents"("customer_wallet_address");
CREATE INDEX "payment_intents_tx_hash_idx" ON "payment_intents"("tx_hash");
CREATE INDEX "payment_intents_created_at_idx" ON "payment_intents"("created_at");

CREATE UNIQUE INDEX "ledger_entries_agent_id_idempotency_key_key" ON "ledger_entries"("agent_id", "idempotency_key");
CREATE INDEX "ledger_entries_agent_id_entry_type_idx" ON "ledger_entries"("agent_id", "entry_type");
CREATE INDEX "ledger_entries_payment_intent_id_idx" ON "ledger_entries"("payment_intent_id");
CREATE INDEX "ledger_entries_tx_hash_idx" ON "ledger_entries"("tx_hash");
CREATE INDEX "ledger_entries_created_at_idx" ON "ledger_entries"("created_at");

CREATE INDEX "webhook_endpoints_agent_id_idx" ON "webhook_endpoints"("agent_id");
CREATE INDEX "webhook_endpoints_enabled_idx" ON "webhook_endpoints"("enabled");

CREATE INDEX "webhook_deliveries_endpoint_id_status_idx" ON "webhook_deliveries"("endpoint_id", "status");
CREATE INDEX "webhook_deliveries_payment_intent_id_idx" ON "webhook_deliveries"("payment_intent_id");
CREATE INDEX "webhook_deliveries_next_attempt_at_idx" ON "webhook_deliveries"("next_attempt_at");
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries"("created_at");

ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
