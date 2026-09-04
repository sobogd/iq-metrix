-- Add the classification-reason column (why Visit.client got its value).
-- Additive only: existing rows get NULL, meaning "legacy / human default".

ALTER TABLE "Visit" ADD COLUMN "clientReason" TEXT;
