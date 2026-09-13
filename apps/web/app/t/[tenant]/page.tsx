"use client";

import Link from "next/link";
import { use, useEffect } from "react";
import type { WatchRow } from "@aomi-telegram/core";
import { Shell } from "@/components/Shell.tsx";
import { Unmapped } from "@/components/Unmapped.tsx";
import { api, useApi } from "@/lib/api.ts";
import { ago, money } from "@/lib/format.ts";
import type { Summary } from "@/lib/summary.ts";

/** Compact launch: the headline figures and what changed since the last look. Drag up for the ledger. */
export default function Home({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = use(params);
  const { data, error, reload } = useApi<Summary>(tenant, "/summary");
  useEffect(() => {
    if (data?.mapped) void api(tenant, "/visit", { method: "POST" }).catch(() => {});
  }, [tenant, data?.mapped]);

  return (
    <Shell tenant={tenant} view="" title={data?.title} tagline={data?.tagline} botUsername={data?.botUsername}>
      {!data && !error ? <p role="status">Loading your World account…</p> : null}
      {error ? <p className="error">Couldn’t load your account: {error} <button onClick={reload}>Retry</button></p> : null}
      {data && !data.mapped ? <Unmapped title={data.title} /> : null}
      {data?.mapped && data.portfolio ? (
        <>
          <div className="card">
            <div className="kicker">Portfolio</div>
            <div className="big">{money(data.portfolio.nav)}</div>
            <div className="muted">
              risk <span className={`pill ${data.risk?.band ?? ""}`}>{data.risk ? `${data.risk.score.toFixed(1)}/10 ${data.risk.band}` : "—"}</span>
              {" · "}{data.watches?.watching ?? 0} watching{data.watches?.paused ? ` · ${data.watches.paused} paused` : ""}
            </div>
          </div>
          <h2>Since you looked</h2>
          <SinceYouLooked summary={data} />
          <div className="acts">
            <Link className="btn primary" href={`/t/${tenant}/ledger`}>Ledger</Link>
            <Link className="btn" href={`/t/${tenant}/portfolio`}>portfolio ↗</Link>
            <Link className="btn" href={`/t/${tenant}/watch`}>Watch something</Link>
          </div>
        </>
      ) : null}
    </Shell>
  );
}

function SinceYouLooked({ summary }: { summary: Summary }) {
  const s = summary.sinceYouLooked;
  if (!s || !summary.portfolio) return null;
  const fired: WatchRow[] = s.fired;
  const before = s.navBefore;
  const delta = before ? Number(summary.portfolio.nav) - Number(before) : null;
  return (
    <div className="card">
      <div className="muted">last look {ago(s.lastSeenAt)}</div>
      {delta !== null ? <div className="row"><span>Portfolio</span><span className="num">{delta >= 0 ? "+" : "−"}{money(Math.abs(delta))}</span></div> : <div className="row"><span className="muted">No earlier visit to compare against.</span></div>}
      {fired.length ? fired.map((w) => (
        <div className="row" key={w.id}><span>Watch fired · {describeWatch(w)}</span><span className="muted">{ago(w.fired_at)}</span></div>
      )) : <div className="row"><span className="muted">No watches fired.</span></div>}
    </div>
  );
}

export function describeWatch(w: WatchRow): string {
  const p = w.params as Record<string, string>;
  if (w.kind === "price_cross") return `${p.symbol} ${p.direction} ${p.level}`;
  if (w.kind === "risk_band") return `risk enters ${p.band}`;
  return w.kind;
}
