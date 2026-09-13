import { json, route } from "@/lib/auth.ts";
import { server } from "@/lib/server.ts";

/** pause | resume | cancel. Anything else, or an illegal transition, is a 409. */
export const PATCH = route(async ({ tenant, binding }, request, params) => {
  if (!binding) return json({ error: "unmapped" }, 403);
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const state = ({ pause: "paused", resume: "watching", cancel: "cancelled" } as const)[body?.action ?? ""];
  if (!state) return json({ error: "action must be pause, resume or cancel" }, 400);
  const row = await server().store.setWatchState(tenant.id, binding.accountId, params.id ?? "", state);
  return row ? json({ watch: row }) : json({ error: "not_allowed" }, 409);
});
