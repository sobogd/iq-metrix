import { isbot } from "isbot";

// Ported from iq-rest's track-v2.controller.ts / translator's app/api/e/route.ts.
// Dropped: the "a paid click id exempts the request from the crawler
// heuristics" branch — ad/click-id attribution is being removed from both
// source products and is out of scope here, so every bot-looking UA is
// dropped, no exceptions.

/** Server-side clients (curl/axios/headless) and crawlers that `isbot`
 *  misses. */
const HARD_BOT_UA_REGEX =
  /axios\/|node-fetch|got\/|http_request|httpclient|java\/|okhttp|libwww|lwp-trivial|HttpClient|Apache-HttpClient|python-requests|curl\/|wget|HeadlessChrome|PhantomJS|Screaming Frog|Sitebulb/i;
/** Crawlers proper, not covered well by `isbot`. */
const CRAWLER_UA_REGEX =
  /AdsBot|Google-InspectionTool|GoogleOther|APIs-Google|FeedFetcher-Google|Storebot-Google|GoogleProducer|ChromeOS-Default-Bot/i;

/** True when the UA identifies a bot/crawler/script — including an empty UA,
 *  which no real browser sends. Ingest silently drops these (200 with no
 *  body work) rather than erroring, so as not to tip off anything scripted. */
export function isBotUa(ua: string): boolean {
  if (!ua) return true;
  if (HARD_BOT_UA_REGEX.test(ua)) return true;
  if (CRAWLER_UA_REGEX.test(ua)) return true;
  return isbot(ua);
}
