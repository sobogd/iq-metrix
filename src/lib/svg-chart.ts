import { escapeHtml } from "../views/layout";
import { truncate } from "../views/format";

// Minimal inline-<svg> bar charts, no chart library. Deliberately simple —
// per the task this is meant to prove metrics are easy to add later, not to
// be a polished analytics product yet. Bars only (no curves): a straight
// rect is trivial to get pixel-right, a smoothed line is not.
//
// Colors: `var(--accent)`/`var(--muted)`/`var(--panel-2)` reference this
// app's own CSS custom properties (public/style.css) — these charts are
// always inlined directly into the page's HTML (never loaded as a separate
// `.svg` document via <img>), so the custom properties resolve normally
// through the DOM, same as any other element on the page.
//
// Every chart here is a single-series magnitude comparison (one measure,
// ranked or over time) — per the dataviz color-by-job rule that's one
// consistent hue with no legend, since the axis/row labels already carry
// category identity. A multi-series or part-to-whole chart would need the
// categorical palette + legend instead; none of the four charts on the
// visit list are that shape.
//
// Native SVG <title> elements give every bar a zero-JS hover tooltip
// (browsers render them natively) — the closest this app can get to the
// interactive layer a chart normally ships with, without any client JS.

export interface ChartPoint {
  label: string;
  value: number;
}

function emptyState(width: number, height: number): string {
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="No data yet"><text x="4" y="20" fill="var(--muted)" font-size="12">No data yet</text></svg>`;
}

/**
 * Ranked horizontal bar list — label left, bar + value right. Used for "top
 * N by count" questions (countries / devices / pages): horizontal bars keep
 * labels as plain left-aligned text, so there is no collision risk
 * regardless of label length, unlike labels stacked under vertical bars.
 */
export function renderRankedBars(points: ReadonlyArray<ChartPoint>, opts: { width?: number } = {}): string {
  const width = opts.width ?? 320;
  const barHeight = 20;
  const gap = 8;
  const labelWidth = 100;
  const valueGutter = 34;
  const trackWidth = Math.max(20, width - labelWidth - valueGutter);
  const height = points.length === 0 ? 40 : points.length * (barHeight + gap) - gap;
  if (points.length === 0) return emptyState(width, height);

  const max = Math.max(1, ...points.map((p) => p.value));
  const rows = points
    .map((p, i) => {
      const y = i * (barHeight + gap);
      const barWidth = Math.max(2, (p.value / max) * trackWidth);
      const textY = y + barHeight / 2 + 4;
      return `
      <g>
        <title>${escapeHtml(p.label)}: ${p.value}</title>
        <text x="0" y="${textY}" fill="var(--muted)" font-size="12">${escapeHtml(truncate(p.label, 14))}</text>
        <rect x="${labelWidth}" y="${y}" width="${trackWidth}" height="${barHeight}" rx="4" fill="var(--panel-2)" />
        <rect x="${labelWidth}" y="${y}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="4" fill="var(--accent)" />
        <text x="${labelWidth + trackWidth + 8}" y="${textY}" fill="var(--text)" font-size="12">${p.value}</text>
      </g>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Ranked bar chart">${rows}</svg>`;
}

/**
 * Vertical bar chart for a time series (visits per day). Zero-value days
 * still draw a 2px hairline bar so an empty day reads as "zero", not as a
 * gap in the markup.
 */
export function renderTimeSeriesBars(points: ReadonlyArray<ChartPoint>, opts: { width?: number; height?: number } = {}): string {
  const width = opts.width ?? 600;
  const height = opts.height ?? 110;
  if (points.length === 0) return emptyState(width, height);

  const max = Math.max(1, ...points.map((p) => p.value));
  const gap = 2;
  const barWidth = (width - gap * (points.length - 1)) / points.length;
  const baseline = height - 16; // leaves room for a first/last date label
  const bars = points
    .map((p, i) => {
      const x = i * (barWidth + gap);
      const h = Math.max(2, (p.value / Math.max(1, max)) * (baseline - 4));
      const y = baseline - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--accent)"><title>${escapeHtml(p.label)}: ${p.value}</title></rect>`;
    })
    .join("");
  const firstLabel = points[0]?.label ?? "";
  const lastLabel = points[points.length - 1]?.label ?? "";
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Visits per day, last 30 days">
    ${bars}
    <line x1="0" y1="${baseline}" x2="${width}" y2="${baseline}" stroke="var(--border)" stroke-width="1" />
    <text x="0" y="${height}" fill="var(--muted)" font-size="11">${escapeHtml(firstLabel)}</text>
    <text x="${width}" y="${height}" fill="var(--muted)" font-size="11" text-anchor="end">${escapeHtml(lastLabel)}</text>
  </svg>`;
}
