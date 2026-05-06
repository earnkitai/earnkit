ALTER TABLE "agents"
  ADD COLUMN "split_address"    TEXT,
  ADD COLUMN "buyback_address"  TEXT,
  ADD COLUMN "buyback_percent"  DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX "agents_split_address_idx" ON "agents"("split_address");
