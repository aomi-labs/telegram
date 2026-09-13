import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store, handoverTokenHash, migrate } from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("store (needs TEST_DATABASE_URL)", () => {
  const sql = postgres(url ?? "", { max: 2, onnotice: () => {} });
  const store = new Store(sql);
  const tenant = `t_${Date.now()}`;

  beforeAll(async () => {
    await migrate(sql);
    await store.upsertTenant({ id: tenant, bot_id: "1", bot_username: "x", bot_token_sealed: "s", aomi_webhook_url: "http://a", webhook_secret: "w", ingest_key_hash: "k", ingest_origins: [] });
  });
  afterAll(async () => {
    await sql`DELETE FROM outbox WHERE tenant = ${tenant}`;
    await sql`DELETE FROM accounts WHERE tenant = ${tenant}`;
    await sql`DELETE FROM tenants WHERE id = ${tenant}`;
    await sql.end();
  });

  it("binds /start to the pending handover once, latest wins", async () => {
    const t1 = "tokenAAAAAAAAAA", t2 = "tokenBBBBBBBBBB";
    await store.recordPendingHandover({ tenant, tokenHash: handoverTokenHash(t1), accountId: "11", chainId: 2092151908, ownerAddress: "0xabc" });
    await store.recordPendingHandover({ tenant, tokenHash: handoverTokenHash(t2), accountId: "12", chainId: 2092151908, ownerAddress: "0xabc" });

    expect(await store.bindStart(tenant, handoverTokenHash("unknown"), "u1")).toBeNull();
    expect(await store.bindStart(tenant, handoverTokenHash(t1), "u1")).toMatchObject({ accountId: "11" });
    expect(await store.bindStart(tenant, handoverTokenHash(t1), "u2")).toBeNull();
    expect(await store.bindStart(tenant, handoverTokenHash(t2), "u1")).toMatchObject({ accountId: "12" });
    expect(await store.binding(tenant, "u1")).toMatchObject({ accountId: "12" });
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
