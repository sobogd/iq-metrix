import { escapeHtml } from "./layout";

// The shared colored-text-pill vocabulary used by BOTH the sessions list rows
// (visit-list-page.ts) and the session detail page (visit-detail-page.ts), so
// the two surfaces always look identical: a "chip" is one attribute of the
// visit (OS, device class, source, theme, …). Kept here, not duplicated per
// view — never hardcode an emoji into these pills, per the project's approach.

const OS_LABELS: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
};

const THEME_LABELS: Record<string, { text: string; cls: string }> = {
  dark: { text: "dark", cls: "tag-theme-dark" },
  light: { text: "light", cls: "tag-theme-light" },
};

/** One colored text pill. All dynamic text is escaped here. */
export function chip(cls: string, text: string): string {
  return `<span class="tag ${cls}">${escapeHtml(text)}</span>`;
}

export function osChip(os: string | null): string {
  const label = os ? OS_LABELS[os] : undefined;
  return label ? chip("tag-os", label) : "";
}

/** Device-class chip — only "Tablet". Desktop/mobile are already implied
 *  by the OS chip (Windows/macOS/Linux are always desktop; iOS/Android are
 *  phone-sized by default), but a tablet keeps the same OS name, so the one
 *  case worth calling out is when the visit really came from a tablet. */
export function deviceChip(device: string | null): string {
  return device === "tablet" ? chip("tag-device", "Tablet") : "";
}

/** Source chip: the referrer when there is one, otherwise the `from` tag.
 *  UA client classification (search/AI/bot) is deliberately NOT part of this
 *  pill — it misfires on non-browser tools and only confuses the list. Long
 *  values truncate to one line via CSS, so the title carries the full text. */
export function sourceChip(from: string | null, ref: string | null): string {
  const raw = ref ? `via ${ref}` : from ? `from ${from}` : "";
  if (!raw) return "";
  return `<span class="tag tag-source" title="${escapeHtml(raw)}">${escapeHtml(raw)}</span>`;
}

export function themeChip(theme: string | null): string {
  const t = theme ? THEME_LABELS[theme] : undefined;
  return t ? chip(t.cls, t.text) : "";
}

/** Non-human traffic (search engine, AI crawler, link preview, bot) — a
 *  small red pill whose tooltip carries the classification reason token.
 *  Rendered on the session detail head, and on a sessions-list row's first
 *  line — but there only when the visit has no referrer to show instead. */
export function clientChip(client: string | null, reason: string | null): string {
  if (!client || client === "human") return "";
  const title = reason ? ` title="${escapeHtml(reason)}"` : "";
  return `<span class="tag tag-bot"${title}>${escapeHtml(client)}</span>`;
}

// ---------------------------------------------------------------------------
// One combined "what is this client" field — the classification verdict plus
// its reason as a single human-readable line. The sessions list shows it as
// plain text above the entry address instead of the two separate red pills
// (label + tooltip reason). Token names stay in their canonical casing.
// ---------------------------------------------------------------------------

const CLIENT_TOKEN_NAMES: Record<string, string> = {
  // search engines
  googlebot: "Google", "googlebot-image": "Google Images", "googlebot-news": "Google News",
  "googlebot-video": "Google Video", bingbot: "Bing", msnbot: "Bing", slurp: "Yahoo!",
  duckduckbot: "DuckDuckGo", yandexbot: "Yandex", yandexmobilebot: "Yandex Mobile",
  baiduspider: "Baidu", sogou: "Sogou", yisouspider: "Sogou", naverbot: "Naver",
  seznambot: "Seznam", qwantify: "Qwant", petalbot: "Petal Search", applebot: "Apple",
  // AI crawlers
  gptbot: "OpenAI GPTBot", chatgpt: "ChatGPT", openai: "OpenAI", "oai-searchbot": "OpenAI",
  "gpt-": "OpenAI", claude: "Claude", claudebot: "Claude", anthropic: "Anthropic",
  perplexitybot: "Perplexity", perplexity: "Perplexity", gemini: "Google Gemini",
  "google-extended": "Google (AI)", bard: "Google Bard", cohere: "Cohere",
  youdot: "You.com", phind: "Phind", kimi: "Kimi", moonshot: "Moonshot AI",
  mistral: "Mistral", "meta-externalagent": "Meta", "meta-externalfetcher": "Meta",
  amazonbot: "Amazon", bytespider: "ByteDance", ccbot: "Common Crawl",
  diffbot: "Diffbot", "applebot-extended": "Apple", omgili: "OMGili",
  imagesiftbot: "ImageSift",
  // link previews / social unfurlers
  twitterbot: "X (Twitter)", facebookexternalhit: "Facebook", facebookcatalog: "Facebook",
  facebot: "Facebook", slackbot: "Slack", linkedinbot: "LinkedIn", discordbot: "Discord",
  telegrambot: "Telegram", whatsapp: "WhatsApp", skypeuripreview: "Skype",
  pinterest: "Pinterest", pinterestbot: "Pinterest", tumblr: "Tumblr",
  redditbot: "Reddit", viber: "Viber", imessage: "iMessage", "line-preview": "LINE",
  bytedancewebview: "ByteDance", tiktokbot: "TikTok", bingpreview: "Bing",
  // monitors / other bots
  uptimerobot: "UptimeRobot", pingdom: "Pingdom", site24x7: "Site24x7",
  statuscake: "StatusCake", newrelicpinger: "New Relic", newrelicsynthetics: "New Relic",
  synthetics: "New Relic", datadogsynthetics: "Datadog", qualys: "Qualys",
  catchpoint: "Catchpoint", "dotcom-monitor": "Dotcom-Monitor", "node-supervisor": "PM2",
  adsbot: "Google AdsBot", "adsbot-google": "Google AdsBot", "apis-google": "Google",
  "feedfetcher-google": "Google", "storebot-google": "Google", semrushbot: "Semrush",
  ahrefsbot: "Ahrefs", majestic: "Majestic", mj12bot: "Majestic-12",
  ia_archiver: "Internet Archive", dotbot: "Moz", rogerbot: "Moz",
  blexbot: "BLEX", exabot: "Exalead", dataforseobot: "DataForSEO",
  seokicks: "SeoKicks", builtwith: "BuiltWith", wappalyzer: "Wappalyzer",
  seobility: "Seobility", moz: "Moz", mzcrawler: "MercadoLibre",
  linkdexbot: "Linkdex", sistrix: "SISTRIX", serpstatbot: "Serpstat",
  netcraftsurveyagent: "Netcraft", "microsoft office": "Microsoft Office",
  excel: "Excel", onenote: "OneNote", outlook: "Outlook",
  skypeforbusiness: "Skype for Business", teams: "Teams",
};

function prettyToken(token: string): string {
  const known = CLIENT_TOKEN_NAMES[token];
  if (known) return known;
  // Fallback: the token in title-ish case, "googlebot-image" → "Googlebot-image".
  return token.replace(/(^|-)([a-z])/g, (_m, sep, ch: string) => `${sep === "-" ? " " : ""}${ch.toUpperCase()}`);
}

/** The one combined client field: kind + reason flattened into a single
 *  readable line ("Search engine · Google (IP verified)", "AI crawler ·
 *  OpenAI GPTBot", "Bot · no browser markers", …). Empty for humans — a
 *  real visitor needs no annotation. */
export function clientKindLabel(client: string | null, reason: string | null): string {
  if (!client || client === "human") return "";
  const r = reason ?? "";
  const strip = (prefix: string): string | null =>
    r.startsWith(`${prefix}:`) ? r.slice(prefix.length + 1) : null;

  const spoof = strip("dns-spoof");
  if (spoof) return `Spoofed crawler · claims ${prettyToken(spoof)}`;
  const dns = strip("dns");
  if (dns) return `Search engine · ${prettyToken(dns)} (IP verified)`;
  const preview = strip("preview");
  if (preview) return `Link preview · ${prettyToken(preview)}`;
  const monitor = strip("monitor");
  if (monitor) return `Monitor · ${prettyToken(monitor)}`;
  if (r === "behaviour:burst") return "Bot · burst pattern";
  if (r === "isbot") return "Bot · isbot heuristic";
  if (r === "no-browser-markers") return "Bot · no browser markers";
  const token = strip("token");
  if (token) {
    const name = prettyToken(token);
    if (client === "search") return `Search engine · ${name}`;
    if (client === "ai") return `AI crawler · ${name}`;
    return `Bot · ${name}`;
  }
  // Unknown reason shape — say what the kind is and keep the raw reason.
  const kind = client === "search" ? "Search engine" : client === "ai" ? "AI crawler" : client === "preview" ? "Link preview" : "Bot";
  return r ? `${kind} · ${r}` : kind;
}

/** One "which page" pill — the purple tag the detail event stream uses for
 *  the page an event happened on. Shows the CONCRETE pathname ("/",
 *  "/ru/feature-slug") once the client recorded one, falling back to the
 *  coarse `page` label for events ingested before path capture. Long paths
 *  ellipsize via .tag's CSS; the tooltip carries the full path and, when a
 *  path is shown, the label it replaced. */
export function pageChip(path: string | null, label: string): string {
  const shown = path ?? label;
  const title = path ? `${label} · ${path}` : label;
  return `<span class="tag tag-page" title="${escapeHtml(title)}">${escapeHtml(shown)}</span>`;
}
