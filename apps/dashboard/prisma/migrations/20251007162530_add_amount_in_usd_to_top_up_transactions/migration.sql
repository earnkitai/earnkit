/*
  Warnings:

  - You are about to drop the column `amountInEth` on the `top_up_transactions` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "UsageEventStatus" ADD VALUE 'INSUFFICIENT_CREDITS';

-- AlterTable
ALTER TABLE "top_up_transactions" DROP COLUMN "amountInEth",
ADD COLUMN     "amount_in_eth" TEXT NOT NULL DEFAULT '0',
ADD COLUMN     "amount_in_usd" TEXT NOT NULL DEFAULT '0';
