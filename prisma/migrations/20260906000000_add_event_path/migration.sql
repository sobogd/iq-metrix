-- Concrete page pathname per event ("/", "/ru", "/ru/feature-slug"), sent by
-- the tracking clients alongside the coarse `page` label. Null for legacy
-- events (history predates path capture) — reads fall back to `page`.
ALTER TABLE "Event" ADD COLUMN "path" TEXT;
