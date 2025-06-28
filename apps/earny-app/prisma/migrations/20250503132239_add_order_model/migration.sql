-- CreateEnum
CREATE TYPE "OrderDirection" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('LIMIT', 'DIRECT');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_address" TEXT NOT NULL,
    "token_address" TEXT NOT NULL,
    "token_symbol" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "price_at_creation" DOUBLE PRECISION NOT NULL,
    "target_price" DOUBLE PRECISION,
    "target_change" DOUBLE PRECISION,
    "direction" "OrderDirection" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "orderType" "OrderType" NOT NULL DEFAULT 'LIMIT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executed_at" TIMESTAMP(3),
    "executed_price" DOUBLE PRECISION,
    "ai_initiated" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_user_id_user_address_idx" ON "orders"("user_id", "user_address");

-- CreateIndex
CREATE INDEX "orders_token_address_direction_status_idx" ON "orders"("token_address", "direction", "status");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_ai_initiated_status_idx" ON "orders"("ai_initiated", "status");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
