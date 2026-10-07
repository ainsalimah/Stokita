ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "demoExpiresAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Store_isDemo_demoExpiresAt_idx" ON "Store"("isDemo", "demoExpiresAt");
