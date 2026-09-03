// Sanitizer for the custom `meta` bag carried on both a Visit (denormalized
// snapshot) and an Event (source of truth) — see prisma/schema.prisma. Not
// present in either reference implementation (both hardcode restaurantId /
// topicId columns instead of a generic bag); this is new code for the
// /ingest contract's `meta?: Record<string,string>` fields.
//
// Applied identically to visit-level and per-event meta. Per the /ingest
// contract: only keys registered in the site's Site.metaKeys are kept; a bad
// or unknown extra key is silently dropped rather than rejecting the whole
// batch — a typo in one field must not lose the rest of the event.
//
// Three keys are special: `from` / `ref` / `theme` are reserved across every
// site (not run through the per-site metaKeys allowlist, not counted toward
// MAX_KEYS) and never end up in the stored meta Json blob at all — they are
// pulled out by extractAttribution() below and routed to the dedicated
// Visit.from / Visit.ref / Visit.theme columns instead (first-write-wins;
// see applyAttribution in visit.ts). The /ingest body shape has no separate
// `ctx` field for them — the contract's existing `meta` object is reused as
// the transport, with these three names carrying special routing instead of
// going through the generic allowlist.

const MAX_KEYS = 8;
const MAX_KEY_LEN = 32;
const MAX_VALUE_LEN = 128;

export const RESERVED_META_KEYS: ReadonlySet<string> = new Set(["from", "ref", "theme"]);

// Ported verbatim from iq-rest's track-v2.controller.ts (also mirrored in
// translator's app/api/e/route.ts) — same validation as the reference
// implementations, not guessed. FBCLID_REGEX / GCLID_REGEX from that same
// file are deliberately not ported: ad/click-id attribution is out of scope
// here (being removed from both source products separately).
const FROM_REGEX = /^[A-Za-z0-9_.-]{1,64}$/;
const HOST_REGEX = /^[a-z0-9.-]{1,253}$/i;
const THEME_REGEX = /^(dark|light)$/;

export interface Attribution {
  from: string | null;
  ref: string | null;
  theme: string | null;
}

/** Keys allowed for a site, derived from its metaKeys registry (an object
 *  keyed by field name, e.g. `{ restaurantId: { label, link } }`). */
export function allowedMetaKeys(metaKeys: unknown): ReadonlySet<string> {
  if (!metaKeys || typeof metaKeys !== "object" || Array.isArray(metaKeys)) return new Set();
  return new Set(Object.keys(metaKeys as Record<string, unknown>));
}

/**
 * Keep only string-valued, registered keys, capped in count/length. Silently
 * drops anything that doesn't qualify instead of throwing — one bad key must
 * not reject the whole ingest call. `from`/`ref`/`theme` are always skipped
 * here regardless of a site's own metaKeys registry — see extractAttribution,
 * which is what actually reads them.
 */
export function sanitizeMeta(raw: unknown, allowed: ReadonlySet<string>): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (RESERVED_META_KEYS.has(key)) continue;
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (key.length > MAX_KEY_LEN || !allowed.has(key)) continue;
    if (typeof value !== "string" || value.length > MAX_VALUE_LEN) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Pull the three reserved attribution keys out of a raw incoming meta
 * object (visit-level `meta` or a per-event `meta` — ctx-like values can
 * arrive in either, so this is called on both in routes/ingest.ts). Always
 * allowed, for every site, independent of that site's metaKeys registry and
 * uncounted against sanitizeMeta's MAX_KEYS. Values are validated with the
 * same regexes the reference implementations use, ported exactly above;
 * `ref` is lowercased (hostnames are case-insensitive) just like the
 * reference's `ctx.ref.toLowerCase()`.
 */
export function extractAttribution(raw: unknown): Attribution {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { from: null, ref: null, theme: null };
  const r = raw as Record<string, unknown>;
  const from = typeof r.from === "string" && FROM_REGEX.test(r.from) ? r.from : null;
  const ref = typeof r.ref === "string" && HOST_REGEX.test(r.ref) ? r.ref.toLowerCase() : null;
  const theme = typeof r.theme === "string" && THEME_REGEX.test(r.theme) ? r.theme : null;
  return { from, ref, theme };
}

/** Merge precedence for the Visit.meta snapshot: existing visit meta, then
 *  this call's visit-level `meta`, then each event's `meta` in array order
 *  (chronological within the batch). Events win — the schema comment on
 *  Event.meta calls it "the source of truth" because the owner can switch
 *  context (e.g. restaurant) mid-visit, and Visit.meta is only a snapshot of
 *  "the latest event(s)". Batch-level `meta` is a convenience for values an
 *  event stream might not carry on every batch (e.g. `plan`). Inputs here
 *  are always post-sanitizeMeta, so from/ref/theme are already absent. */
export function mergeVisitMeta(
  existing: Record<string, string>,
  bodyMeta: Record<string, string>,
  eventMetas: ReadonlyArray<Record<string, string>>,
): Record<string, string> {
  const merged: Record<string, string> = { ...existing, ...bodyMeta };
  for (const em of eventMetas) Object.assign(merged, em);
  return merged;
}
