ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'READ';

UPDATE "CompanyToken"
SET "expiresAt" = "createdAt" + INTERVAL '90 days'
WHERE "expiresAt" IS NULL AND "revokedAt" IS NULL;

ALTER TABLE "Notification" ADD COLUMN "providerMessageId" TEXT;
CREATE UNIQUE INDEX "Notification_providerMessageId_key" ON "Notification"("providerMessageId");

CREATE TABLE "RateLimitBucket" (
  "key" TEXT NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimitBucket_updatedAt_idx" ON "RateLimitBucket"("updatedAt");
