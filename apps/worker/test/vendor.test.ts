import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Sealer, Store, migrate, type TenantRow, type Update } from "@aomi-telegram/core";
import { world } from "@aomi-telegram/tenant-world";
import { TenantEdge } from "../src/edge.ts";
import { dispatchVendor, startVendorDrainer } from "../src/vendor.ts";
import { createApp } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";

const { fixtureTenants } = vi.hoisted(() => ({ fixtureTenants: new Map() }));
vi.mock("../src/tenants.ts", () => ({ tenants: fixtureTenants }));
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const dm = (update_id: number, text: string): Update => ({ update_id, message: {
  message_id: update_id, date: 0, chat: { id: 4242, type: "private" },
  from: { id: 4242, is_bot: false, first_name: "T" }, text,
  entities: [{ type: "bot_command", offset: 0, length: text.length }],
} });

suite("durable vendor dispatch", () => {
  const sql = postgres(url ?? "", { max: 4, onnotice: () => {} });
  const store = new Store(sql, async () => Response.json({ binding: null }));
  const sealer = new Sealer("33".repeat(32));
  const id = `vendor_${Date.now()}`;
  const row: TenantRow = { id, bot_id: String(Date.now() + 2000), bot_username: "bot", bot_token_sealed: sealer.seal("tok"), aomi_webhook_url: "http://backend.local/hook", webhook_secret: "s" };
  const replies: string[] = [];
  const log = vi.fn();
  let releaseBalance: () => void = () => {};
  let balanceGate: Promise<void>;
  const tenant = { ...world, id, commands: [
    { name: "b", description: "Balance", budget: 100, render: async () => { await balanceGate; return { text: "balance" }; } },
    { name: "app", description: "App", budget: 100, render: async () => ({ text: "app" }) },
  ] };
  const edge = () => new TenantEdge(row, tenant, { store, sealer, telegramApiBase: "http://tg.local", log,
    fetchImpl: async (_input, init) => {
      replies.push(JSON.parse(String(init?.body)).text);
      return new Response(JSON.stringify({ ok: true, result: true }));
    },
  });
  const app = createApp({ store, sealer, log, config: loadConfig({ DATABASE_URL: url, SERVICE_KEY: "33".repeat(32), PUBLIC_URL: "http://edge.local", TELEGRAM_API_BASE: "http://tg.local" }) });
  const post = (update: Update) => app.request(`/t/${id}/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "s" }, body: JSON.stringify(update) });

  beforeAll(async () => { await migrate(sql); await store.upsertTenant(row); fixtureTenants.set(id, tenant); });
  beforeEach(async () => {
    await sql`DELETE FROM outbox WHERE tenant = ${id}`;
    replies.length = 0;
    balanceGate = new Promise<void>((resolve) => { releaseBalance = resolve; });
  });
  afterAll(async () => {
    releaseBalance();
    await sql`DELETE FROM outbox WHERE tenant = ${id}`;
    await sql`DELETE FROM visits WHERE tenant = ${id}`;
    await sql`DELETE FROM tenants WHERE id = ${id}`;
    await sql.end();
  });

  it("acknowledges before a slow read, deduplicates retries including after completion", async () => {
    const update = dm(101, "/b");
    const responses = await Promise.all([post(update), post(update)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(replies).toEqual([]);
    const jobs = await store.claimVendor(4, "first");
    expect(jobs).toHaveLength(1);
    releaseBalance();
    await dispatchVendor({ store, log, handle: (_id, update) => edge().handle(update) }, jobs[0]!);
    expect(replies).toEqual(["balance"]);
    expect((await post(update)).status).toBe(200);
    expect(await store.claimVendor(4, "again")).toEqual([]);
  });

  it("replies to /app while /b remains pending with bounded concurrent dispatch", async () => {
    await post(dm(201, "/b"));
    await post(dm(202, "/app"));
    const stop = startVendorDrainer({ store, log, handle: (_id, update) => edge().handle(update) }, 10, 2);
    try {
      await vi.waitFor(() => expect(replies).toEqual(["app"]));
      releaseBalance();
      await vi.waitFor(() => expect(replies).toEqual(["app", "balance"]));
      await vi.waitFor(async () => {
        const [pending] = await sql`SELECT count(*)::int AS count FROM outbox WHERE tenant = ${id} AND completed_at IS NULL`;
        expect(pending!.count).toBe(0);
      });
    } finally { stop(); releaseBalance(); }
  });

  it("recovers an abandoned job after restart and rejects stale lease completion", async () => {
    await post(dm(301, "/app"));
    const [first] = await store.claimVendor(1, "old-worker");
    expect(await store.claimVendor(1, "other-worker")).toEqual([]);
    await sql`UPDATE outbox SET lease_until = now() - interval '1 second' WHERE id = ${first!.id}`;
    const restarted = new Store(sql, async () => Response.json({ binding: null }));
    const [recovered] = await restarted.claimVendor(1, "new-worker");
    expect(recovered!.id).toBe(first!.id);
    await store.completeVendor(first!.id, first!.lease_token);
    const [state] = await sql`SELECT completed_at FROM outbox WHERE id = ${first!.id}`;
    expect(state!.completed_at).toBeNull();
    await dispatchVendor({ store: restarted, log, handle: (_id, update) => edge().handle(update) }, recovered!);
    expect(replies).toEqual(["app"]);
  });

  it("keeps backend delivery separate and retries a failed vendor job", async () => {
    await store.enqueueForward(id, dm(401, "/help"));
    await post(dm(402, "/app"));
    expect((await store.claimDue(5)).map((r) => r.update.update_id)).toEqual([401]);
    const [job] = await store.claimVendor(1, "failed");
    await dispatchVendor({ store, log, handle: async () => { throw new Error("transport unavailable"); } }, job!);
    expect(await store.claimVendor(1, "too-soon")).toEqual([]);
    await sql`UPDATE outbox SET next_at = now() WHERE id = ${job!.id}`;
    const [retried] = await store.claimVendor(1, "retry");
    expect(retried!.attempts).toBe(1);
    await dispatchVendor({ store, log, handle: (_id, update) => edge().handle(update) }, retried!);
    expect(replies).toEqual(["app"]);
  });

  it("returns 503 when the durable write fails instead of losing the command", async () => {
    const failure = vi.spyOn(store, "enqueueVendor").mockRejectedValueOnce(new Error("database unavailable"));
    try { expect((await post(dm(501, "/app"))).status).toBe(503); }
    finally { failure.mockRestore(); }
  });
});
