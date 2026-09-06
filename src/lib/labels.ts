// Validation regexes for free-form event labels, ported unchanged from
// iq-rest's track-v2.controller.ts / translator's app/api/e/route.ts.

// page / action: short human-readable English labels ("Home", "Click",
// "Header sign in"). Free-form by design — no enums.
export const LABEL_REGEX = /^[A-Za-z0-9][A-Za-z0-9 _\-./+]{0,63}$/;
// name carries the detail (error slugs especially), so it gets more room. `%`
// is in the set because scroll-depth names read "Hero - Pricing (75%)".
export const NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9 _\-./+()#:,'%]{0,119}$/;
// Rendered locale of the page the event happened on. Plain two-letter codes
// with an optional region subtag; generous enough that a regional variant
// still passes rather than silently dropping the whole event's locale.
export const LOCALE_REGEX = /^[a-z]{2}(?:-[a-z]{2})?$/i;
// Concrete pathname of the page the event happened on ("/", "/ru",
// "/ru/feature-slug"). Kept as a real URL next to the coarse `page` label.
// Free-form but must look like a path: starts with "/", no whitespace /
// control chars, no query or fragment (the clients stamp window.location
// .pathname, which already excludes those), length-capped so a hostile or
// broken client cannot stuff a megabyte into a row.
export const PATH_REGEX = /^\/[^\s?#"<>\\]{0,254}$/;
// Free-form sub-app label ("landing" | "dashboard" | "web", …). Not present
// in either reference implementation (both are single-app); added here
// because this service is explicitly multi-app per site.
export const APP_REGEX = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/;
