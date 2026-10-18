ALTER TABLE "PaymentRequest"
  DROP CONSTRAINT "PaymentRequest_company_mall_presence_check",
  ADD CONSTRAINT "PaymentRequest_company_mall_presence_check"
    CHECK ("companyId" IS NULL OR "mallId" IS NOT NULL);
