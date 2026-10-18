ALTER TABLE "CompanyToken"
  ALTER COLUMN "companyId" DROP NOT NULL;

CREATE UNIQUE INDEX "CompanyToken_one_global_unrevoked_key"
  ON "CompanyToken" ((1))
  WHERE "companyId" IS NULL AND "revokedAt" IS NULL;

CREATE OR REPLACE FUNCTION mallpay_check_request_creator_token_company() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE token_company_id TEXT;
BEGIN
  IF NEW."createdByCompanyTokenId" IS NULL THEN RETURN NEW; END IF;
  SELECT "companyId" INTO token_company_id
  FROM "CompanyToken" WHERE "id" = NEW."createdByCompanyTokenId" FOR SHARE;
  IF token_company_id IS NOT NULL AND token_company_id IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'PaymentRequest creator token must belong to its company'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
