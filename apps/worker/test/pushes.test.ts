import { describe, expect, it } from "vitest";
import { visibleLength } from "@aomi-telegram/core";
import { bandReached, liquidationAlertText, priceCrossed, watchFiredText } from "../src/pushes.ts";

describe("watch evaluation", () => {
  it("price crosses in the watched direction only", () => {
    expect(priceCrossed("above", "2500", "2512.1")).toBe(true);
    expect(priceCrossed("above", "2500", "2499.9")).toBe(false);
    expect(priceCrossed("below", "2500", "2499.9")).toBe(true);
    expect(priceCrossed("below", "2500", "2500")).toBe(true);
    expect(priceCrossed("above", "abc", "2500")).toBe(false);
  });
  it("band watches fire at or beyond the watched band", () => {
    expect(bandReached("high", "high")).toBe(true);
    expect(bandReached("high", "liquidation")).toBe(true);
    expect(bandReached("high", "elevated")).toBe(false);
    expect(bandReached("nonsense", "liquidation")).toBe(false);
  });
});

describe("push copy", () => {
  const base = { id: "1", tenant: "world", account_id: "20", state: "fired" as const, created_at: new Date(), expires_at: new Date(), fired_at: new Date() };
  it("watch fired stays one line within 120 visible chars", () => {
    const text = watchFiredText({ ...base, kind: "price_cross", params: { symbol: "WETH", direction: "above", level: "2500" } }, "2512.1");
    expect(text).toBe("Watch fired — <code>WETH</code> above <code>2500</code>: mark <code>2512.1</code>.");
    expect(visibleLength(text)).toBeLessThanOrEqual(120);
    expect(visibleLength(liquidationAlertText(10))).toBeLessThanOrEqual(120);
  });
  it("escapes tenant-supplied params", () => {
    expect(watchFiredText({ ...base, kind: "price_cross", params: { symbol: "<b>", direction: "above", level: "1" } }, "2")).not.toContain("<b>");
  });
});
