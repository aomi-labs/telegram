import { Hono } from "hono";
import { Sealer, Store, type TenantRow, type Update } from "@aomi-telegram/core";
import { TenantEdge } from "./edge.ts";
import { tenants } from "./tenants.ts";
import type { Config } from "./config.ts";

export interface ServerDeps {
  config: Config;
  store: Store;
  sealer: Sealer;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

export function createApp(deps: ServerDeps): Hono {
  const { config, store, sealer, log } = deps;
  const app = new Hono();
  const edges = new Map<string, TenantEdge>();

  async function edgeFor(id: string): Promise<{ row: TenantRow; edge: TenantEdge } | null> {
    const tenant = tenants.get(id);
    const row = await store.tenant(id);
    if (!tenant || !row) return null;
    let edge = edges.get(id);
    if (!edge) {
      edge = new TenantEdge(row, tenant, { store, sealer, telegramApiBase: config.TELEGRAM_API_BASE, log, ...(config.PUBLIC_WEB_URL ? { publicWebUrl: config.PUBLIC_WEB_URL } : {}) });
      edges.set(id, edge);
    }
    return { row, edge };
  }

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.post("/t/:tenant/webhook", async (c) => {
    const found = await edgeFor(c.req.param("tenant"));
    if (!found) return c.json({ ok: false }, 404);
    if (config.VERIFY_WEBHOOK_SECRET && c.req.header("x-telegram-bot-api-secret-token") !== found.row.webhook_secret) {
      return c.json({ ok: false }, 403);
    }
    const update = (await c.req.json().catch(() => null)) as Update | null;
    if (!update || typeof update.update_id !== "number") return c.json({ ok: false }, 400);
    try {
      await found.edge.accept(update);
    } catch (error) {
      // A failed durable write must remain retryable by Telegram.
      log("edge.error", { tenant: found.row.id, update_id: update.update_id, error: String(error) });
      return c.json({ ok: false }, 503);
    }
    return c.json({ ok: true });
  });

  return app;
}
