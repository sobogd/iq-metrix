import { prisma } from "../db";
import { madridDelayUntil } from "./madrid";

// Behavioural bot reclassification — the "night" pass that UA analysis can
// never do. A burst of pageview events inside a couple of seconds, on an
// anonymous visit, with no email ever attached, is a crawler pattern a real
// person cannot produce (opening 6+ pages in ≤3 s). Such rows are relabelled
// bot at night, once they have had time to complete.
//
// Conservative by design:
//   - only rows still labelled human (or legacy NULL) are touched — an
//     engine/AI/bot verdict from ingest is never overridden;
//   - identified visits (email set) are never touched — real owners sign in;
//   - folded rows (mergeCount > 0) are left alone — they carried identity
//     work mid-session;
//   - only recent visits are scanned (rolling 36h window), so each night
//     pass is small and idempotent.

const RECENT_WINDOW_MS = 36 * 3600_000;
// Minimum events in a visit AND the max span between its first and last
// event for the burst pattern to count.
const BURST_MIN_EVENTS = 6;
const BURST_MAX_SPAN_S = 3;

/** Reclassify anonymous burst-crawler visits as bot. Returns how many rows
 *  were changed (0 is a perfectly fine outcome). */
export async function reclassifyBurstBots(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - RECENT_WINDOW_MS);
  const changed = await prisma.$executeRaw`
    UPDATE "Visit" v
    SET "client" = 'bot', "clientReason" = 'behaviour:burst'
    WHERE (v."client" IS NULL OR v."client" = 'human')
      AND v.email IS NULL
      AND v."mergeCount" = 0
      AND v."lastAt" >= ${since}
      AND v.id IN (
        SELECT e."visitId"
        FROM "Event" e
        GROUP BY e."visitId"
        HAVING count(*) >= ${BURST_MIN_EVENTS}
           AND EXTRACT(EPOCH FROM (max(e.at) - min(e.at))) <= ${BURST_MAX_SPAN_S}
      )
  `;
  return changed;
}

const DAILY_HOUR = 5;
const DAILY_MINUTE = 30;

/** Run the recompute once shortly after boot (catches up after a deploy at
 *  any hour) and then every day at 05:30 Madrid. Single pm2 fork process, so
 *  an in-process timer is the whole truth. Timers are unref'd so they never
 *  keep the process alive on their own. */
export function startBotReclassifyScheduler(): void {
  const run = (): void => {
    void reclassifyBurstBots()
      .then((n) => console.log(`[reclassify] burst-bot pass done, ${n} visit(s) relabelled`))
      .catch((err: unknown) => console.error("[reclassify] pass failed:", err));
  };

  const bootDelayMs = 60_000;
  const first = setTimeout(run, bootDelayMs);
  first.unref?.();

  const untilDaily = madridDelayUntil(new Date(), DAILY_HOUR, DAILY_MINUTE);
  const daily = setTimeout(() => {
    run();
    const every = setInterval(run, 86_400_000);
    every.unref?.();
  }, untilDaily);
  daily.unref?.();
}
