"use client";

import { useRouter } from "next/navigation";
import { use, useState } from "react";
import type { Product } from "@aomi-telegram/core";
import { Shell } from "@/components/Shell.tsx";
import { api, useApi } from "@/lib/api.ts";
import { haptic } from "@/lib/tg.ts";
import type { Summary } from "@/lib/summary.ts";

/** A watch is not a question: it arms a future push. It is created here and never reaches the agent. */
export default function WatchPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = use(params);
  const router = useRouter();
  const summary = useApi<Summary>(tenant, "/summary");
  const products = useApi<{ products: Product[] }>(tenant, "/products");
  const [kind, setKind] = useState<"price_cross" | "risk_band">("price_cross");
  const [symbol, setSymbol] = useState("WETH");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [level, setLevel] = useState("");
  const [band, setBand] = useState<"elevated" | "high" | "liquidation">("high");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const symbols = [...new Set((products.data?.products ?? []).map((p) => p.symbol))].sort();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const params = kind === "price_cross" ? { symbol, direction, level: level.trim() } : { band };
      await api(tenant, "/watches", { method: "POST", body: JSON.stringify({ kind, params }) });
      haptic("success");
      router.push(`/t/${tenant}/ledger`);
    } catch (e) {
      haptic("error");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell tenant={tenant} view="ledger" title={summary.data?.title} tagline={summary.data?.tagline} botUsername={summary.data?.botUsername}>
      <div className="card">
        <div className="kicker">New watch</div>
        <p className="muted">A watch is not a question — it arms a future message. It never trades.</p>
        <label>Kind</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="price_cross">Mark price crosses a level</option>
          <option value="risk_band">Liquidation risk enters a band</option>
        </select>
        {kind === "price_cross" ? (
          <>
            <label>Market</label>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {(symbols.length ? symbols : ["WETH"]).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="above">goes above</option>
              <option value="below">goes below</option>
            </select>
            <label>Level (in quote)</label>
            <input inputMode="decimal" placeholder="2500" value={level} onChange={(e) => setLevel(e.target.value)} />
          </>
        ) : (
          <>
            <label>Band</label>
            <select value={band} onChange={(e) => setBand(e.target.value as typeof band)}>
              <option value="elevated">elevated (6+)</option>
              <option value="high">high (8+)</option>
              <option value="liquidation">eligible for liquidation</option>
            </select>
          </>
        )}
        {error ? <p className="error">{error}</p> : null}
        <p><button className="primary" disabled={busy || (kind === "price_cross" && !level.trim())} onClick={submit}>Start watching</button></p>
        <p className="muted">Expires in 30 days. Fires once, then moves to Done.</p>
      </div>
    </Shell>
  );
}
