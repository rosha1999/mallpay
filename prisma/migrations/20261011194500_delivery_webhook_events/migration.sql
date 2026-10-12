ALTER TABLE "Notification"
  ADD COLUMN "readAt" TIMESTAMP(3);

CREATE TABLE "WhatsAppStatusEvent" (
  "id" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "status" "DeliveryStatus" NOT NULL,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "errorMessage" TEXT,
  "dedupeKey" CHAR(64) NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppStatusEvent_dedupeKey_key"
  ON "WhatsAppStatusEvent"("dedupeKey");
CREATE INDEX "WhatsAppStatusEvent_providerMessageId_processedAt_eventAt_idx"
  ON "WhatsAppStatusEvent"("providerMessageId", "processedAt", "eventAt");
CREATE INDEX "WhatsAppStatusEvent_createdAt_idx"
  ON "WhatsAppStatusEvent"("createdAt");
