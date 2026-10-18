ALTER TABLE "PaymentRequest"
  ALTER COLUMN "companyId" DROP NOT NULL,
  ALTER COLUMN "mallId" DROP NOT NULL,
  ADD COLUMN "companyName" TEXT,
  ADD CONSTRAINT "PaymentRequest_company_mall_presence_check"
    CHECK (("companyId" IS NULL) = ("mallId" IS NULL)),
  ADD CONSTRAINT "PaymentRequest_unlisted_company_name_check"
    CHECK (
      "companyId" IS NOT NULL OR
      ("companyName" IS NOT NULL AND length(btrim("companyName")) >= 2)
    );

ALTER TABLE "Payment"
  ALTER COLUMN "companyId" DROP NOT NULL;

ALTER TABLE "Appointment"
  ALTER COLUMN "companyId" DROP NOT NULL;

CREATE OR REPLACE FUNCTION mallpay_check_payment_request_company() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE request_company_id TEXT;
BEGIN
  SELECT "companyId" INTO request_company_id
  FROM "PaymentRequest" WHERE "id" = NEW."requestId" FOR SHARE;
  IF FOUND AND request_company_id IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'Payment company must match its payment request'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mallpay_check_appointment_request_company() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE request_company_id TEXT;
BEGIN
  IF NEW."requestId" IS NULL THEN RETURN NEW; END IF;
  SELECT "companyId" INTO request_company_id
  FROM "PaymentRequest" WHERE "id" = NEW."requestId" FOR SHARE;
  IF FOUND AND request_company_id IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'Appointment company must match its payment request'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mallpay_prevent_request_relink_with_children() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."companyId" IS DISTINCT FROM OLD."companyId" AND (
    EXISTS (
      SELECT 1 FROM "Payment"
      WHERE "requestId" = OLD."id" AND "companyId" IS DISTINCT FROM NEW."companyId"
    ) OR EXISTS (
      SELECT 1 FROM "Appointment"
      WHERE "requestId" = OLD."id" AND "companyId" IS DISTINCT FROM NEW."companyId"
    )
  ) THEN
    RAISE EXCEPTION 'PaymentRequest company cannot change while it has related records'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
