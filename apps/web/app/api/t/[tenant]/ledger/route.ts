import { json, route } from "@/lib/auth.ts";
import { server } from "@/lib/server.ts";

const NINETY_DAYS = 90 * 24 * 3600 * 1000;

/** Three zones: WATCHING (service-owned), OPEN (venue orders), DONE (fired watches and indexed fills, 90 days). */
export const GET = route(async ({ tenant, account, binding }) => {
  if (!account || !binding) return json({ mapped: false });
  const store = server().store;
  const since = new Date(Date.now() - NINETY_DAYS);
  const [watching, done, open, fills, cursor, head] = await Promise.all([
    store.watches(tenant.id, binding.accountId, ["watching", "paused"]),
    store.watches(tenant.id, binding.accountId, ["fired", "expired", "cancelled"]),
    tenant.adapter.openOrders(account),
    store.fills(tenant.id, binding.accountId, since),
    store.cursor(tenant.id, `fills:${binding.accountId}`),
    tenant.adapter.headBlock ? tenant.adapter.headBlock().catch(() => null) : Promise.resolve(null),
  ]);
  return json({
    mapped: true,
    watching,
    open,
    done: {
      watches: done.filter((w) => (w.fired_at ?? w.expires_at) >= since),
      fills: fills.map((f) => ({ symbol: f.symbol, market: f.market, side: f.side, price: f.price, qty: f.qty, at: f.at, txHash: f.tx_hash })),
      // How far the fills index has caught up, so the view can say "still indexing".
      indexed: cursor !== null && head !== null ? { cursor: cursor.toString(), head: head.toString(), complete: cursor >= head } : null,
    },
  });
});
