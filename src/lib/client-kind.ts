import { isbot } from "isbot";

// Classifies the client behind a user-agent WITHOUT storing the UA itself
// (the raw string is never persisted — see request-facts.ts). The stored
// `Visit.client` column holds only this enum-like label.
//
// Previously every non-human UA was dropped at ingest (`isBotUa` in the old
// bot-filter.ts). That made "how much traffic is crawlers / AI agents?"
// unanswerable — the rows never existed. Now only pure scripts are dropped;
// search-engine crawlers, AI agents and other bots are stored WITH their
// classification so the admin can filter and measure them.

export type VisitClient = "human" | "search" | "ai" | "bot";

// Server-side scripts that never represent a real visitor browsing a product
// (curl/axios/headless browsers, SEO tools). Dropped before any DB work —
// nothing about them is useful analytics.
const SCRIPT_REGEX =
  /axios\/|node-fetch|got\/|http_request|httpclient|java\/|okhttp|libwww|lwp-trivial|HttpClient|Apache-HttpClient|python-requests|curl\/|wget|HeadlessChrome|PhantomJS|Screaming Frog|Sitebulb/i;

// AI assistants / training crawlers. Checked BEFORE the search list because a
// few overlap with engine names (Google-Extended, Gemini).
const AI_REGEX =
  /gptbot|chatgpt|openai|claude|anthropic|perplexity|gemini|google-extended|bard|cohere|youdot|phind|kimi|moonshot|mistral|meta-externalagent|amazonbot|oai-|deepseek|dify/i;

// Search-engine crawlers.
const SEARCH_REGEX =
  /googlebot|bingbot|msnbot|slurp|duckduckbot|yandex|baiduspider|sogou|yisouspider|naverbot|seznambot|qwantify|petalbot|applebot/i;

// Remaining crawlers/monitors that `isbot` is known to miss.
const CRAWLER_REGEX =
  /AdsBot|Google-InspectionTool|GoogleOther|APIs-Google|FeedFetcher-Google|Storebot-Google|GoogleProducer|ChromeOS-Default-Bot/i;

export function classifyClient(ua: string): VisitClient {
  if (AI_REGEX.test(ua)) return "ai";
  if (SEARCH_REGEX.test(ua)) return "search";
  if (CRAWLER_REGEX.test(ua) || isbot(ua)) return "bot";
  return "human";
}

/** True when the UA is a script (or empty — no real browser sends an empty
 *  UA) and should be dropped rather than stored. Everything else is stored
 *  with its `classifyClient` label. */
export function isScriptUa(ua: string): boolean {
  if (!ua) return true;
  return SCRIPT_REGEX.test(ua);
}
