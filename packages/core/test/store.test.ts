import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store, migrate } from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("store (needs TEST_DATABASE_URL)", () => {
  const sql = postgres(url ?? "", { max: 2, onnotice: () => {} });
  const store = new Store(sql);
  const tenant = `t_${Date.now()}`;

  beforeAll(async () => {
    await migrate(sql);
    await store.upsertTenant({ id: tenant, bot_id: "1", bot_username: "x", bot_token_sealed: "s", aomi_webhook_url: "http://a", webhook_secret: "w" });
  });
  afterAll(async () => {
    await sql`DELETE FROM outbox WHERE tenant = ${tenant}`;
    await sql`DELETE FROM accounts WHERE tenant = ${tenant}`;
    await sql`DELETE FROM tenants WHERE id = ${tenant}`;
    await sql.end();
  });

  it("uses old rows only as candidate identities and never as account authority", async () => {
    await sql`INSERT INTO accounts (tenant, token_hash, account_id, chain_id, owner_address, telegram_user_id, active)
      VALUES (${tenant}, 'old', '11', 1, '0xold', '42', true)`;
    const live = new Store(sql, async () => Response.json({ binding: null }));
    expect(await live.binding(tenant, "42")).toBeNull();
    expect(await live.activeBindings(tenant)).toEqual([]);
  });

  it("outbox claims due rows and backs off on failure", async () => {
    await store.enqueueForward(tenant, { update_id: 1 });
    const [row] = await store.claimDue(10);
    expect(row?.tenant).toBe(tenant);
    await store.failed(row!.id, 1, "boom");
    expect(await store.claimDue(10)).toHaveLength(0);
    await sql`UPDATE outbox SET next_at = now() WHERE id = ${row!.id}`;
    await store.delivered(row!.id);
    expect(await store.claimDue(10)).toHaveLength(0);
  });
});
