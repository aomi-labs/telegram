import { Hono } from "hono";
import { Sealer, Store, sha256Hex, type TenantRow, type Update } from "@aomi-telegram/core";
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

  // Only the trusted issuer may bind token hashes to accounts. Origin is CORS, not authentication.
  const corsFor = (row: TenantRow, origin: string | undefined): Record<string, string> =>
    origin && row.ingest_origins.includes(origin)
      ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" }
      : {};

  app.options("/t/:tenant/handovers", async (c) => {
    const row = await store.tenant(c.req.param("tenant"));
    if (!row) return c.body(null, 404);
    return c.body(null, 204, corsFor(row, c.req.header("origin")));
  });

  app.post("/t/:tenant/handovers", async (c) => {
    const id = c.req.param("tenant");
    const row = await store.tenant(id);
    const tenant = tenants.get(id);
    if (!row || !tenant) return c.json({ error: "unknown_tenant" }, 404);
    const origin = c.req.header("origin");
    const cors = corsFor(row, origin);
    const key = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const keyed = Boolean(key) && sha256Hex(key) === row.ingest_key_hash;
    if (!keyed) return c.json({ error: "unauthorized" }, 401, cors);
    const body = (await c.req.json().catch(() => null)) as Partial<{ token_hash: string; account_id: string; chain_id: number; owner_address: string }> | null;
    if (!body || !/^[0-9a-f]{64}$/.test(body.token_hash ?? "") || !body.account_id || !Number.isInteger(body.chain_id) || !/^0x[0-9a-fA-F]{40}$/.test(body.owner_address ?? "")) {
      return c.json({ error: "invalid_request" }, 400, cors);
    }
    const ownerAddress = body.owner_address!.toLowerCase();
    await store.recordPendingHandover({ tenant: id, tokenHash: body.token_hash!, accountId: String(body.account_id), chainId: body.chain_id!, ownerAddress });
    return c.json({ ok: true }, 200, cors);
  });

  return app;
}
