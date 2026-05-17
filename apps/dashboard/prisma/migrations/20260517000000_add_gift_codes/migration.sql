-- CreateTable
CREATE TABLE "gift_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "credits_per_redemption" INTEGER NOT NULL,
    "max_redemptions" INTEGER,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_code_redemptions" (
    "id" TEXT NOT NULL,
    "gift_code_id" TEXT NOT NULL,
    "user_wallet_address" TEXT NOT NULL,
    "credits_added" INTEGER NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gift_codes_code_key" ON "gift_codes"("code");

-- CreateIndex
CREATE INDEX "gift_codes_agent_id_idx" ON "gift_codes"("agent_id");

-- CreateIndex
CREATE INDEX "gift_codes_code_idx" ON "gift_codes"("code");

-- CreateIndex
CREATE INDEX "gift_code_redemptions_gift_code_id_idx" ON "gift_code_redemptions"("gift_code_id");

-- CreateIndex
CREATE INDEX "gift_code_redemptions_user_wallet_address_idx" ON "gift_code_redemptions"("user_wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "gift_code_redemptions_gift_code_id_user_wallet_address_key" ON "gift_code_redemptions"("gift_code_id", "user_wallet_address");

-- AddForeignKey
ALTER TABLE "gift_codes" ADD CONSTRAINT "gift_codes_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_code_redemptions" ADD CONSTRAINT "gift_code_redemptions_gift_code_id_fkey" FOREIGN KEY ("gift_code_id") REFERENCES "gift_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
