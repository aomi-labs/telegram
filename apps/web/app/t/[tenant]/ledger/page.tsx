"use client";

import Link from "next/link";
import { use, useState } from "react";
import type { Fill, Order, WatchRow } from "@aomi-telegram/core";
import { Shell } from "@/components/Shell.tsx";
import { Unmapped } from "@/components/Unmapped.tsx";
import { api, useApi } from "@/lib/api.ts";
import { ago, dateShort, money, qty } from "@/lib/format.ts";
import { haptic, openDraft } from "@/lib/tg.ts";
import type { Summary } from "@/lib/summary.ts";
import { describeWatch } from "../page.tsx";

interface Ledger { mapped: boolean; watching: WatchRow[]; open: Order[]; done: { watches: WatchRow[]; fills: (Fill & { market?: string })[]; indexed: { cursor: string; head: string; complete: boolean } | null } }

/** WATCHING is ours. OPEN and DONE are the venue's. Nothing here signs or executes. */
export default function LedgerPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = use(params);
  const summary = useApi<Summary>(tenant, "/summary");
  const ledger = useApi<Ledger>(tenant, "/ledger");
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "pause" | "resume" | "cancel") {
    setBusy(id);
    try {
      await api(tenant, `/watches/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      haptic("success");
      ledger.reload();
    } catch {
      haptic("error");
    } finally {
      setBusy(null);
    }
  }

  const bot = summary.data?.botUsername;
  const d = ledger.data;
  return (
    <Shell tenant={tenant} view="ledger" title={summary.data?.title} tagline={summary.data?.tagline} botUsername={bot}>
      {ledger.error ? <p className="error">Couldn’t read the ledger: {ledger.error}</p> : null}
      {d && !d.mapped ? <Unmapped title={summary.data?.title ?? "partner"} /> : null}
      {d?.mapped ? (
        <>
          <h2>Watching{watchingHeading(d.watching)}</h2>
          {d.watching.length === 0 ? <div className="empty">Nothing watched. <Link href={`/t/${tenant}/watch`}>Watch something</Link>.</div> : null}
          {d.watching.map((w) => (
            <div className="row" key={w.id}>
              <div>
                <div>{describeWatch(w)}{w.state === "paused" ? <> <span className="pill">paused</span></> : null}</div>
                <div className="muted">expires {dateShort(w.expires_at)}</div>
              </div>
              <div className="acts">
                {w.state === "watching"
                  ? <button className="ghost" disabled={busy === w.id} onClick={() => act(w.id, "pause")}>Pause</button>
                  : <button className="ghost" disabled={busy === w.id} onClick={() => act(w.id, "resume")}>Resume</button>}
                <button className="ghost" disabled={busy === w.id} onClick={() => act(w.id, "cancel")}>Cancel</button>
              </div>
            </div>
          ))}

          <h2>Open {d.open.length ? `· ${d.open.length}` : ""}</h2>
          {d.open.length === 0 ? <div className="empty">No resting orders.</div> : null}
          {d.open.map((o) => (
            <div className="row" key={`${o.market}-${o.side}-${o.id}`}>
              <div>
                <div>{o.symbol} {o.market} {o.side}</div>
                <div className="muted num">{qty(o.qty)} @ {money(o.price)} · {o.kind.replace(/_/g, " ")}</div>
              </div>
              {bot ? <button className="ghost" onClick={() => openDraft(bot, cancelText(summary.data, o))}>Cancel in chat</button> : null}
            </div>
          ))}

          <h2>Done</h2>
          {d.done.indexed && !d.done.indexed.complete ? <div className="muted">still indexing fills · block {Number(d.done.indexed.cursor).toLocaleString()} of {Number(d.done.indexed.head).toLocaleString()}</div> : null}
          {d.done.watches.length + d.done.fills.length === 0 ? <div className="empty">Nothing yet. Kept 90 days, then archived.</div> : null}
          {d.done.fills.map((f, i) => (
            <div className="row" key={`fill-${i}`}><div>{f.symbol} {f.market ?? ""} {f.side} <span className="num">{qty(f.qty)} @ {money(f.price)}</span></div><span className="muted">{ago(f.at)}</span></div>
          ))}
          {d.done.watches.map((w) => (
            <div className="row" key={w.id}><div>{describeWatch(w)} <span className="pill">{w.state}</span></div><span className="muted">{ago(w.fired_at ?? w.expires_at)}</span></div>
          ))}
        </>
      ) : null}
    </Shell>
  );
}

/** "· 2" when all are live, "· 2 · 1 paused" when some are, "· 1 paused" when none are live. */
function watchingHeading(rows: WatchRow[]): string {
  const live = rows.filter((w) => w.state === "watching").length;
  const paused = rows.length - live;
  if (rows.length === 0) return "";
  return `${live ? ` · ${live}` : ""}${paused ? ` · ${paused} paused` : ""}`;
}

/** The cancel draft text is tenant copy, but the page only knows the summary; keep it generic and readable. */
function cancelText(_summary: Summary | null, o: Order): string {
  return `cancel ${o.market} ${o.side} order ${o.id} on ${o.symbol}`;
}
