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

const MAX_KEYS = 8;
const MAX_KEY_LEN = 32;
const MAX_VALUE_LEN = 128;

/** Keys allowed for a site, derived from its metaKeys registry (an object
 *  keyed by field name, e.g. `{ restaurantId: { label, link } }`). */
export function allowedMetaKeys(metaKeys: unknown): ReadonlySet<string> {
  if (!metaKeys || typeof metaKeys !== "object" || Array.isArray(metaKeys)) return new Set();
  return new Set(Object.keys(metaKeys as Record<string, unknown>));
}

/**
 * Keep only string-valued, registered keys, capped in count/length. Silently
 * drops anything that doesn't qualify instead of throwing — one bad key must
 * not reject the whole ingest call.
 */
export function sanitizeMeta(raw: unknown, allowed: ReadonlySet<string>): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (key.length > MAX_KEY_LEN || !allowed.has(key)) continue;
    if (typeof value !== "string" || value.length > MAX_VALUE_LEN) continue;
    out[key] = value;
  }
  return out;
}

/** Merge precedence for the Visit.meta snapshot: existing visit meta, then
 *  this call's visit-level `meta`, then each event's `meta` in array order
 *  (chronological within the batch). Events win — the schema comment on
 *  Event.meta calls it "the source of truth" because the owner can switch
 *  context (e.g. restaurant) mid-visit, and Visit.meta is only a snapshot of
 *  "the latest event(s)". Batch-level `meta` is a convenience for values an
 *  event stream might not carry on every batch (e.g. `plan`). */
export function mergeVisitMeta(
  existing: Record<string, string>,
  bodyMeta: Record<string, string>,
  eventMetas: ReadonlyArray<Record<string, string>>,
): Record<string, string> {
  const merged: Record<string, string> = { ...existing, ...bodyMeta };
  for (const em of eventMetas) Object.assign(merged, em);
  return merged;
}
