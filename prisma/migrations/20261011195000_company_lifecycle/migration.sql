ALTER TABLE "Company"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Company_active_mallId_idx"
  ON "Company"("active", "mallId");
