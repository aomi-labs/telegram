import type { Portfolio, Tenant, WatchRow } from "@aomi-telegram/core";
import { server } from "./server.ts";
import type { Authorized } from "./auth.ts";

export interface Summary {
  mapped: boolean;
  tenant: string;
  botUsername: string;
  title: string;
  tagline: string;
  quote?: string;
  portfolio?: Portfolio;
  risk?: { score: number; band: string };
  watches?: { watching: number; paused: number };
  sinceYouLooked?: {
    lastSeenAt: string | null;
    navBefore: string | null;
    fired: WatchRow[];
  };
}

/** What the compact launch shows: the headline figures and what changed since the last visit. */
export async function buildSummary<A>(auth: Authorized<A>): Promise<Summary> {
  const { tenant, row, binding, account } = auth;
  const base = { mapped: binding !== null, tenant: tenant.id, botUsername: row.bot_username, title: tenant.copy.title, tagline: tenant.copy.tagline };
  if (!binding || !account) return base;
  const adapter = (tenant as Tenant<A>).adapter;
  const store = server().store;
  const [portfolio, risk, live, fired, visit] = await Promise.all([
    adapter.portfolio(account),
    adapter.riskBand(account),
    store.watches(tenant.id, binding.accountId, ["watching", "paused"]),
    store.watches(tenant.id, binding.accountId, ["fired"]),
    store.visit(tenant.id, auth.telegramUserId),
  ]);
  const lastSeen = visit?.last_seen_at ?? null;
  return {
    ...base,
    quote: portfolio.quote,
    portfolio,
    risk,
    watches: { watching: live.filter((w) => w.state === "watching").length, paused: live.filter((w) => w.state === "paused").length },
    sinceYouLooked: {
      lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
      navBefore: typeof visit?.snapshot?.nav === "string" ? visit.snapshot.nav : null,
      fired: fired.filter((w) => w.fired_at && (!lastSeen || w.fired_at > lastSeen)),
    },
  };
}
