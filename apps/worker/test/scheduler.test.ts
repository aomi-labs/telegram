import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Sealer, Store, migrate, type TenantRow } from "@aomi-telegram/core";
import { world } from "@aomi-telegram/tenant-world";
import { Scheduler } from "../src/scheduler.ts";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("fills at the newest block", () => {
  const sql = postgres(url ?? "", { max: 2, onnotice: () => {} });
  let revoked = false;
  const canonical = { account_id: "21", chain_id: 1, owner_address: "0x" + "11".repeat(20), state: "active" };
  const store = new Store(sql, async () => Response.json({ binding: revoked ? null : canonical }));
  const sealer = new Sealer("44".repeat(32));
  const botId = String(Date.now() + 3000);
  const id = `fills_${botId}`;
  const row: TenantRow = { id, bot_id: botId, bot_username: "test", bot_token_sealed: sealer.seal("test"), aomi_webhook_url: "http://test.invalid", webhook_secret: "s" };
  const scanFills = vi.fn(async () => [{ book: "0xbook", block: 100n, logIndex: 0, symbol: "WETH", market: "spot", side: "sell" as const, price: "2500", qty: "0.01", txHash: "0xreceipt", at: new Date() }]);
  const tenant = { ...world, id, adapter: { ...world.adapter,
    resolveAccount: async () => ({ accountId: 21n, owner: "0xowner", chainId: 1 }),
    riskBand: async () => ({ score: 0, band: "healthy" }),
    headBlock: async () => 100n,
    fillsGenesis: 1n,
    scanFills,
  } };
  const scheduler = new Scheduler({ store, sealer, telegramApiBase: "http://test.invalid", tenants: new Map([[id, tenant]]), log: vi.fn() });

  beforeAll(async () => {
    await migrate(sql);
    await store.upsertTenant(row);
    await store.touchVisit(id, "42");
    await store.setCursor(id, "fills:21", 100n);
  });
  afterAll(async () => {
    await sql`DELETE FROM fills WHERE tenant = ${id}`;
    await sql`DELETE FROM cursors WHERE tenant = ${id}`;
    await sql`DELETE FROM accounts WHERE tenant = ${id}`;
    await sql`DELETE FROM visits WHERE tenant = ${id}`;
    await sql`DELETE FROM tenants WHERE id = ${id}`;
    await sql.end();
  });

  it("indexes the only new block immediately, then waits for the next block", async () => {
    await scheduler.tickTenant(row, tenant);
    expect(scanFills).toHaveBeenCalledWith(expect.objectContaining({ accountId: 21n }), 100n, 100n);
    expect(await store.cursor(id, "fills:21")).toBe(101n);
    expect(await store.fills(id, "21", new Date(0))).toEqual([expect.objectContaining({ block: "100", qty: "0.01", tx_hash: "0xreceipt" })]);
    await scheduler.tickTenant(row, tenant);
    expect(scanFills).toHaveBeenCalledTimes(1);
    expect(await store.fills(id, "21", new Date(0))).toHaveLength(1);
  });
  it("stops venue reads after canonical revocation", async () => {
    revoked = true;
    await store.setCursor(id, "fills:21", 100n);
    scanFills.mockClear();
    await scheduler.tickTenant(row, tenant);
    expect(scanFills).not.toHaveBeenCalled();
    expect(await store.cursor(id, "fills:21")).toBe(100n);
  });

});
