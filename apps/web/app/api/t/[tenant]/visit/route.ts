import { json, route } from "@/lib/auth.ts";
import { server } from "@/lib/server.ts";

/** The client calls this after it has painted, so the next launch can say what changed since. */
export const POST = route(async ({ tenant, telegramUserId, account }) => {
  const snapshot = account ? { nav: (await tenant.adapter.portfolio(account)).nav } : {};
  await server().store.recordVisit(tenant.id, telegramUserId, snapshot);
  return json({ ok: true });
});
