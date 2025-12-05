-- Add token fields to TopUpTransaction table for ERC-20 token support
ALTER TABLE "top_up_transactions" ADD COLUMN "token_address" TEXT;
ALTER TABLE "top_up_transactions" ADD COLUMN "token_symbol" TEXT;
ALTER TABLE "top_up_transactions" ADD COLUMN "amount_in_token" TEXT;

-- Create index for efficient token-based queries
CREATE INDEX "top_up_transactions_token_address_idx" ON "top_up_transactions"("token_address");

