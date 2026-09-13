import type { Candle } from "./tenant.ts";

/**
 * Candlesticks as a plain SVG string, the same drawing the mini app shows.
 * One scale, labels at the extremes, no library. The worker rasterises it.
 */
export function candlesSvg(candles: Candle[], mark: string | null, title: string, opts: { width?: number; height?: number; dark?: boolean } = {}): string {
  const W = opts.width ?? 900, H = opts.height ?? 420, padL = 16, padR = 96, padT = 44, padB = 24;
  const ink = opts.dark ? "#e8e6df" : "#1c1f26", ink2 = opts.dark ? "#83828a" : "#6d727d", bg = opts.dark ? "#15171c" : "#ffffff";
  const good = "#1f7a4d", bad = "#9a3412";
  if (candles.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${bg}"/><text x="${padL}" y="30" font-family="Menlo, monospace" font-size="18" fill="${ink}">${esc(title)}</text><text x="${padL}" y="70" font-family="sans-serif" font-size="16" fill="${ink2}">No candles for this market.</text></svg>`;
  }
  const highs = candles.map((c) => Number(c.h)), lows = candles.map((c) => Number(c.l));
  const m = mark ? Number(mark) : null;
  const max = Math.max(...highs, m ?? -Infinity), min = Math.min(...lows, m ?? Infinity);
  const span = max - min || 1;
  const y = (v: number) => padT + ((max - v) / span) * (H - padT - padB);
  const step = (W - padL - padR) / candles.length;
  const bw = Math.max(2, step * 0.6);
  const fmt = (v: number) => (v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
  const body = candles.map((c, i) => {
    const x = padL + i * step + step / 2;
    const o = Number(c.o), cl = Number(c.c);
    const color = cl >= o ? good : bad;
    return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y(Number(c.h)).toFixed(1)}" y2="${y(Number(c.l)).toFixed(1)}" stroke="${color}" stroke-width="1"/>` +
      `<rect x="${(x - bw / 2).toFixed(1)}" y="${y(Math.max(o, cl)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y(o) - y(cl))).toFixed(1)}" fill="${color}"/>`;
  }).join("");
  const markLine = m !== null
    ? `<line x1="${padL}" x2="${W - padR}" y1="${y(m).toFixed(1)}" y2="${y(m).toFixed(1)}" stroke="${ink2}" stroke-dasharray="4 4" stroke-width="1"/><text x="${W - padR + 8}" y="${(y(m) + 5).toFixed(1)}" font-family="Menlo, monospace" font-size="14" fill="${ink}">${fmt(m)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${bg}"/>` +
    `<text x="${padL}" y="28" font-family="Menlo, monospace" font-size="18" font-weight="bold" fill="${ink}">${esc(title)}</text>` +
    body + markLine +
    `<text x="${W - padR + 8}" y="${(y(max) + 5).toFixed(1)}" font-family="Menlo, monospace" font-size="13" fill="${ink2}">${fmt(max)}</text>` +
    `<text x="${W - padR + 8}" y="${(y(min) + 5).toFixed(1)}" font-family="Menlo, monospace" font-size="13" fill="${ink2}">${fmt(min)}</text>` +
    `</svg>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
