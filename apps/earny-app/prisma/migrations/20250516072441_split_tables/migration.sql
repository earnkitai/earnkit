/*
  Warnings:

  - You are about to drop the `orders` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_user_id_fkey";

-- DropTable
DROP TABLE "orders";

-- DropEnum
DROP TYPE "OrderStatus";

-- CreateTable
CREATE TABLE "limit_orders" (
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
    "orderType" "OrderType" NOT NULL DEFAULT 'LIMIT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ai_initiated" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "limit_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_history" (
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
    "orderType" "OrderType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL,
    "executed_price" DOUBLE PRECISION NOT NULL,
    "ai_initiated" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "order_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "limit_orders_user_id_idx" ON "limit_orders"("user_id");

-- CreateIndex
CREATE INDEX "limit_orders_user_address_idx" ON "limit_orders"("user_address");

-- CreateIndex
CREATE INDEX "limit_orders_token_address_direction_idx" ON "limit_orders"("token_address", "direction");

-- CreateIndex
CREATE INDEX "limit_orders_direction_price_at_creation_idx" ON "limit_orders"("direction", "price_at_creation");

-- CreateIndex
CREATE INDEX "limit_orders_created_at_idx" ON "limit_orders"("created_at");

-- CreateIndex
CREATE INDEX "limit_orders_ai_initiated_direction_idx" ON "limit_orders"("ai_initiated", "direction");

-- CreateIndex
CREATE INDEX "order_history_user_id_created_at_idx" ON "order_history"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "order_history_user_address_idx" ON "order_history"("user_address");

-- CreateIndex
CREATE INDEX "order_history_token_address_direction_idx" ON "order_history"("token_address", "direction");

-- CreateIndex
CREATE INDEX "order_history_executed_at_idx" ON "order_history"("executed_at");

-- CreateIndex
CREATE INDEX "order_history_orderType_executed_at_idx" ON "order_history"("orderType", "executed_at");

-- CreateIndex
CREATE INDEX "order_history_ai_initiated_idx" ON "order_history"("ai_initiated");

-- AddForeignKey
ALTER TABLE "limit_orders" ADD CONSTRAINT "limit_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_history" ADD CONSTRAINT "order_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
