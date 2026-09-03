-- Add the client classification column to Visit. Nullable: existing rows
-- (including imported history) get NULL, which the admin treats as 'human'.
-- The raw user-agent is never stored — only this label (see src/lib/client-kind.ts).
ALTER TABLE "Visit" ADD COLUMN "client" TEXT;
