import { proxyAwareFetch, type Store } from "@aomi-telegram/core";

export interface ForwardDeps {
  store: Store;
  webhookUrlFor: (tenant: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  log: (event: string, fields?: Record<string, unknown>) => void;
  alertAfter?: number;
}

/**
 * Drains the outbox to the aomi backend. A 2xx deletes the row; anything else
 * backs off exponentially, capped at five minutes, and logs an alert once the
 * attempt count crosses the threshold. Delivery is at-least-once by design:
 * the backend's own invocation key makes a duplicate turn a no-op.
 */
export async function drainOnce(deps: ForwardDeps, limit = 50): Promise<number> {
  const fetchImpl = deps.fetchImpl ?? proxyAwareFetch;
  const alertAfter = deps.alertAfter ?? 10;
  const rows = await deps.store.claimDue(limit);
  for (const row of rows) {
    const url = await deps.webhookUrlFor(row.tenant);
    if (!url) {
      await deps.store.failed(row.id, row.attempts + 1, "tenant has no aomi webhook url");
      continue;
    }
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(row.update),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        await deps.store.delivered(row.id);
        continue;
      }
      await deps.store.failed(row.id, row.attempts + 1, `${response.status} ${await response.text().catch(() => "")}`);
    } catch (error) {
      await deps.store.failed(row.id, row.attempts + 1, String(error));
    }
    if (row.attempts + 1 >= alertAfter) deps.log("forward.stuck", { tenant: row.tenant, id: row.id, attempts: row.attempts + 1 });
  }
  return rows.length;
}

export function startDrainer(deps: ForwardDeps, intervalMs: number): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await drainOnce(deps);
    } catch (error) {
      deps.log("forward.error", { error: String(error) });
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
