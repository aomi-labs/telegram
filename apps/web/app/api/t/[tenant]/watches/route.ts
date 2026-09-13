import { json, route } from "@/lib/auth.ts";
import { server } from "@/lib/server.ts";

export const GET = route(async ({ tenant, binding }) => {
  if (!binding) return json({ mapped: false });
  return json({ watches: await server().store.watches(tenant.id, binding.accountId, ["watching", "paused"]) });
});

/** Creates a watch locally. Watches never reach the agent; the scheduler evaluates them against the venue. */
export const POST = route(async ({ tenant, binding }, request) => {
  if (!binding) return json({ error: "unmapped" }, 403);
  const body = (await request.json().catch(() => null)) as { kind?: string; params?: Record<string, unknown> } | null;
  const kind = tenant.watches.find((k) => k.kind === body?.kind);
  if (!kind || !body?.params || typeof body.params !== "object") return json({ error: "invalid_watch" }, 400);
  if (kind.kind === "price_cross") {
    const { symbol, level, direction } = body.params as { symbol?: string; level?: string; direction?: string };
    if (!symbol || !level || !/^\d+(\.\d+)?$/.test(level) || !["above", "below"].includes(direction ?? "")) return json({ error: "price_cross needs symbol, level, direction" }, 400);
  }
  if (kind.kind === "risk_band") {
    const { band } = body.params as { band?: string };
    if (!["elevated", "high", "liquidation"].includes(band ?? "")) return json({ error: "risk_band needs band" }, 400);
  }
  return json({ watch: await server().store.createWatch(tenant.id, binding.accountId, kind.kind, body.params) }, 201);
});
