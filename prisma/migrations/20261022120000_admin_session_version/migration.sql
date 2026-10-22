-- Bumped whenever admin credentials change so live JWT sessions are revoked.
ALTER TABLE "AdminUser" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
