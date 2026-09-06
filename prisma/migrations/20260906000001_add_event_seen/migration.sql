-- Admin "viewed" flag on events. An event starts unseen (false) at ingest;
-- the sessions-list (and detail) SELECT returns it and then marks it seen.
-- A visit with any unseen event carries the green "new" dot in the list.
-- Ingested events start unseen.
ALTER TABLE "Event" ADD COLUMN "seen" BOOLEAN NOT NULL DEFAULT false;
