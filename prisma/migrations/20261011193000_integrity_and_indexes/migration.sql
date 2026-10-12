DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "PaymentRequest" WHERE "amount" <= 0) THEN
    RAISE EXCEPTION 'Preflight failed: PaymentRequest contains a non-positive amount';
  END IF;
  IF EXISTS (SELECT 1 FROM "Payment" WHERE "amount" <= 0) THEN
    RAISE EXCEPTION 'Preflight failed: Payment contains a non-positive amount';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Appointment"
    WHERE "status" NOT IN ('SCHEDULED', 'RESCHEDULED', 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'Preflight failed: Appointment contains an unsupported status';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "PaymentRequest" request
    LEFT JOIN "CompanyToken" token ON token."id" = request."createdByCompanyTokenId"
    WHERE request."createdByCompanyTokenId" IS NOT NULL AND token."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Preflight failed: PaymentRequest references a missing company token';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "PaymentRequest" request
    JOIN "CompanyToken" token ON token."id" = request."createdByCompanyTokenId"
    WHERE token."companyId" <> request."companyId"
  ) THEN
    RAISE EXCEPTION 'Preflight failed: PaymentRequest creator token belongs to another company';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "PaymentRequest" request
    JOIN "Company" company ON company."id" = request."companyId"
    WHERE company."mallId" <> request."mallId"
  ) THEN
    RAISE EXCEPTION 'Preflight failed: PaymentRequest contains a company/mall mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Payment" payment
    JOIN "PaymentRequest" request ON request."id" = payment."requestId"
    WHERE request."companyId" <> payment."companyId"
  ) THEN
    RAISE EXCEPTION 'Preflight failed: Payment contains a request/company mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Appointment" appointment
    JOIN "PaymentRequest" request ON request."id" = appointment."requestId"
    WHERE request."companyId" <> appointment."companyId"
  ) THEN
    RAISE EXCEPTION 'Preflight failed: Appointment contains a request/company mismatch';
  END IF;
END $$;

ALTER TABLE "PaymentRequest"
  ADD COLUMN "idempotencyFingerprint" CHAR(64);

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_amount_positive_check" CHECK ("amount" > 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive_check" CHECK ("amount" > 0);

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_createdByCompanyTokenId_fkey"
  FOREIGN KEY ("createdByCompanyTokenId") REFERENCES "CompanyToken"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'RESCHEDULED', 'CANCELLED');
ALTER TABLE "Appointment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Appointment"
  ALTER COLUMN "status" TYPE "AppointmentStatus"
  USING "status"::"AppointmentStatus";
ALTER TABLE "Appointment" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';

WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "requestId" ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
  ) AS position
  FROM "Appointment"
  WHERE "requestId" IS NOT NULL AND "status" = 'SCHEDULED'
)
UPDATE "Appointment" AS appointment
SET "status" = 'RESCHEDULED'
FROM ranked
WHERE appointment."id" = ranked."id" AND ranked.position > 1;

CREATE UNIQUE INDEX "Appointment_one_scheduled_per_request_key"
  ON "Appointment"("requestId")
  WHERE "requestId" IS NOT NULL AND "status" = 'SCHEDULED';

CREATE INDEX "Mall_active_idx" ON "Mall"("active");
CREATE INDEX "PaymentRequest_createdAt_idx" ON "PaymentRequest"("createdAt");
CREATE INDEX "PaymentRequest_requestedAt_idx" ON "PaymentRequest"("requestedAt");
CREATE INDEX "Appointment_requestId_status_idx" ON "Appointment"("requestId", "status");
DROP INDEX "Notification_deliveryStatus_createdAt_idx";
CREATE INDEX "Notification_deliveryStatus_channel_createdAt_idx"
  ON "Notification"("deliveryStatus", "channel", "createdAt");

CREATE FUNCTION mallpay_check_request_company_mall() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE company_mall_id TEXT;
BEGIN
  SELECT "mallId" INTO company_mall_id
  FROM "Company" WHERE "id" = NEW."companyId" FOR SHARE;
  IF company_mall_id IS NOT NULL AND company_mall_id IS DISTINCT FROM NEW."mallId" THEN
    RAISE EXCEPTION 'PaymentRequest mall must match its company'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentRequest_company_mall_check"
BEFORE INSERT OR UPDATE OF "companyId", "mallId" ON "PaymentRequest"
FOR EACH ROW EXECUTE FUNCTION mallpay_check_request_company_mall();

CREATE FUNCTION mallpay_check_request_creator_token_company() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE token_company_id TEXT;
BEGIN
  IF NEW."createdByCompanyTokenId" IS NULL THEN RETURN NEW; END IF;
  SELECT "companyId" INTO token_company_id
  FROM "CompanyToken" WHERE "id" = NEW."createdByCompanyTokenId" FOR SHARE;
  IF token_company_id IS NULL OR token_company_id IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'PaymentRequest creator token must belong to its company'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentRequest_creator_token_company_check"
BEFORE INSERT OR UPDATE OF "companyId", "createdByCompanyTokenId" ON "PaymentRequest"
FOR EACH ROW EXECUTE FUNCTION mallpay_check_request_creator_token_company();

CREATE FUNCTION mallpay_check_company_mall_move() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."mallId" IS DISTINCT FROM OLD."mallId" AND EXISTS (
    SELECT 1 FROM "PaymentRequest"
    WHERE "companyId" = OLD."id" AND "mallId" <> NEW."mallId"
  ) THEN
    RAISE EXCEPTION 'Company mall cannot change while it has payment requests'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Company_mall_move_check"
BEFORE UPDATE OF "mallId" ON "Company"
FOR EACH ROW EXECUTE FUNCTION mallpay_check_company_mall_move();

CREATE FUNCTION mallpay_check_payment_request_company() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE request_company_id TEXT;
BEGIN
  SELECT "companyId" INTO request_company_id
  FROM "PaymentRequest" WHERE "id" = NEW."requestId" FOR SHARE;
  IF request_company_id IS NOT NULL AND request_company_id IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'Payment company must match its payment request'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Payment_request_company_check"
BEFORE INSERT OR UPDATE OF "requestId", "companyId" ON "Payment"
FOR EACH ROW EXECUTE FUNCTION mallpay_check_payment_request_company();

CREATE FUNCTION mallpay_check_appointment_request_company() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE request_company_id TEXT;
BEGIN
  IF NEW."requestId" IS NULL THEN RETURN NEW; END IF;
  SELECT "companyId" INTO request_company_id
  FROM "PaymentRequest" WHERE "id" = NEW."requestId" FOR SHARE;
  IF request_company_id IS NOT NULL AND request_company_id IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'Appointment company must match its payment request'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Appointment_request_company_check"
BEFORE INSERT OR UPDATE OF "requestId", "companyId" ON "Appointment"
FOR EACH ROW EXECUTE FUNCTION mallpay_check_appointment_request_company();

CREATE FUNCTION mallpay_prevent_request_relink_with_children() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."companyId" IS DISTINCT FROM OLD."companyId" AND (
    EXISTS (SELECT 1 FROM "Payment" WHERE "requestId" = OLD."id" AND "companyId" <> NEW."companyId") OR
    EXISTS (SELECT 1 FROM "Appointment" WHERE "requestId" = OLD."id" AND "companyId" <> NEW."companyId")
  ) THEN
    RAISE EXCEPTION 'PaymentRequest company cannot change while it has related records'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentRequest_relink_check"
BEFORE UPDATE OF "companyId" ON "PaymentRequest"
FOR EACH ROW EXECUTE FUNCTION mallpay_prevent_request_relink_with_children();
