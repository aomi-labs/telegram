import type { Band, WatchRow } from "@aomi-telegram/core";
import { escapeHtml } from "@aomi-telegram/core";

/** Push copy. One line, figures in <code>, never a menu, never a number the venue did not return. */
export function watchFiredText(watch: WatchRow, observed: string): string {
  const p = watch.params as Record<string, string>;
  if (watch.kind === "price_cross") {
    return `Watch fired — <code>${escapeHtml(p.symbol ?? "")}</code> ${p.direction === "below" ? "below" : "above"} <code>${escapeHtml(p.level ?? "")}</code>: mark <code>${escapeHtml(observed)}</code>.`;
  }
  if (watch.kind === "risk_band") {
    return `Watch fired — liquidation risk entered <code>${escapeHtml(p.band ?? "")}</code>: <code>${escapeHtml(observed)}/10</code>.`;
  }
  return `Watch fired — <code>${escapeHtml(watch.kind)}</code>.`;
}

export function liquidationAlertText(score: number): string {
  return `Eligible for liquidation — liquidation risk <code>${score.toFixed(1)}/10.</code> Act in the chat.`;
}

const BAND_RANK: Record<Band, number> = { safe: 0, elevated: 1, high: 2, liquidation: 3 };

/** A price watch fires the first time the mark is on the far side of the level in the watched direction. */
export function priceCrossed(direction: string, level: string, mark: string): boolean {
  const m = Number(mark), l = Number(level);
  if (!Number.isFinite(m) || !Number.isFinite(l)) return false;
  return direction === "below" ? m <= l : m >= l;
}

/** A band watch fires when risk is at or beyond the watched band. */
export function bandReached(watched: string, band: Band): boolean {
  const want = BAND_RANK[watched as Band];
  return want !== undefined && BAND_RANK[band] >= want;
}
