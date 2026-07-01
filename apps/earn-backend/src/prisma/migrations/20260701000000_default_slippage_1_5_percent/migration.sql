-- Lower the default buyback slippage tolerance from 5% (500 bps) to 1.5%
-- (150 bps). Tighter default protection: with the market-price swap guard in
-- place, a swap that would fill worse than 1.5% off the quote reverts (fails
-- closed) rather than bleeding value on thin/mispriced pools.
--
-- Only affects the DEFAULT for new rows. Existing configs keep their stored
-- value — update them explicitly if desired.
ALTER TABLE "buyback_configs" ALTER COLUMN "slippage_bps" SET DEFAULT 150;
ALTER TABLE "shared_split_buyback_configs" ALTER COLUMN "slippage_bps" SET DEFAULT 150;
