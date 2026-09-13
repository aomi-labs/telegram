import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Sealer, Store, handoverTokenHash, migrate, type Update } from "@aomi-telegram/core";
import { world } from "@aomi-telegram/tenant-world";
import { TenantEdge } from "../src/edge.ts";
import { drainOnce } from "../src/forward.ts";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

function dm(text: string, userId = 4242): Update {
  const command = text.startsWith("/") ? text.split(/\s/)[0]! : null;
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: 1, date: 0, chat: { id: userId, type: "private" }, from: { id: userId, is_bot: false, first_name: "T" }, text,
      ...(command ? { entities: [{ type: "bot_command", offset: 0, length: command.length }] } : {}),
    },
  };
}

suite("tenant edge (needs TEST_DATABASE_URL)", () => {
  const sql = postgres(url ?? "", { max: 2, onnotice: () => {} });
  const store = new Store(sql);
  const sealer = new Sealer("11".repeat(32));
  const botId = String(Date.now());
  const tenantId = `edge_${botId}`;
  const telegramCalls: { method: string; body: Record<string, unknown> }[] = [];
  const forwarded: Update[] = [];
  const log = vi.fn();

  const fakeFetch: typeof fetch = async (input, init) => {
    const target = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (target.includes("/bot")) {
      telegramCalls.push({ method: target.split("/").pop()!, body });
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }
    forwarded.push(body);
    return new Response("{}", { status: 200 });
  };

  beforeAll(async () => {
    await migrate(sql);
    await store.upsertTenant({ id: tenantId, bot_id: botId, bot_username: "bot", bot_token_sealed: sealer.seal("tok"), aomi_webhook_url: "http://aomi.local/hook", webhook_secret: "s", ingest_key_hash: "h", ingest_origins: [] });
  });
  afterAll(async () => {
    await sql`DELETE FROM outbox WHERE tenant = ${tenantId}`;
    await sql`DELETE FROM visits WHERE tenant = ${tenantId}`;
    await sql`DELETE FROM accounts WHERE tenant = ${tenantId}`;
    await sql`DELETE FROM tenants WHERE id = ${tenantId}`;
    await sql.end();
  });

  const edge = () => new TenantEdge({ id: tenantId, bot_id: botId, bot_username: "bot", bot_token_sealed: sealer.seal("tok"), aomi_webhook_url: "http://aomi.local/hook", webhook_secret: "s", ingest_key_hash: "h", ingest_origins: [] }, world, { store, sealer, telegramApiBase: "http://tg.local", fetchImpl: fakeFetch, log, publicWebUrl: "https://tg.example" });

  it("answers a vendor command itself and never forwards it", async () => {
    await edge().handle(dm("/b"));
    expect(telegramCalls.at(-1)).toMatchObject({ method: "sendMessage", body: { chat_id: "4242" } });
    expect(await drainOnce({ store, log, webhookUrlFor: async () => "http://aomi.local/hook", fetchImpl: fakeFetch })).toBe(0);
    expect(forwarded).toHaveLength(0);
  });

  it("forwards text verbatim through the outbox", async () => {
    const update = dm("hello there");
    await edge().handle(update);
    await drainOnce({ store, log, webhookUrlFor: async () => "http://aomi.local/hook", fetchImpl: fakeFetch });
    expect(forwarded.at(-1)).toEqual(update);
  });

  it("binds /start to a pending handover and still forwards it", async () => {
    await store.recordPendingHandover({ tenant: tenantId, tokenHash: handoverTokenHash("tokXYZ123456"), accountId: "11", chainId: 1, ownerAddress: "0xabc" });
    const update = dm("/start tokXYZ123456");
    await edge().handle(update);
    expect(await store.binding(tenantId, "4242")).toMatchObject({ accountId: "11" });
    await drainOnce({ store, log, webhookUrlFor: async () => "http://aomi.local/hook", fetchImpl: fakeFetch });
    expect(forwarded.at(-1)).toEqual(update);
  });

  it("a failed forward backs off and is retried, not lost", async () => {
    const update = dm("retry me");
    await edge().handle(update);
    let calls = 0;
    const flaky: typeof fetch = async () => { calls += 1; return new Response("nope", { status: 502 }); };
    await drainOnce({ store, log, webhookUrlFor: async () => "http://aomi.local/hook", fetchImpl: flaky });
    expect(calls).toBe(1);
    const [row] = await sql<{ attempts: number; last_error: string }[]>`SELECT attempts, last_error FROM outbox WHERE tenant = ${tenantId}`;
    expect(row).toMatchObject({ attempts: 1 });
    expect(row?.last_error).toContain("502");
  });
});

suite("chart photo reply (needs TEST_DATABASE_URL)", () => {
  it("rasterises an svg reply and uploads it as a photo with the caption", async () => {
    const { candlesSvg, Sealer, Store, migrate } = await import("@aomi-telegram/core");
    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.TEST_DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
    const store = new Store(sql);
    const sealer = new Sealer("22".repeat(32));
    const botId = String(Date.now());
    const tenantId = `photo_${botId}`;
    await migrate(sql);
    await store.upsertTenant({ id: tenantId, bot_id: botId, bot_username: "bot", bot_token_sealed: sealer.seal("tok"), aomi_webhook_url: "http://aomi.local/hook", webhook_secret: "s", ingest_key_hash: "h", ingest_origins: [] });
    const uploads: { url: string; body: FormData }[] = [];
    const photoFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/sendPhoto")) uploads.push({ url, body: await new Request(url, init).formData() });
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }) as typeof fetch;
    try {
      const candles = [{ t: 1, o: "1", h: "2", l: "0.5", c: "1.5" }, { t: 2, o: "1.5", h: "1.8", l: "1.2", c: "1.3" }];
      const tenant = {
        id: tenantId, adapter: {} as never, watches: [], copy: { unmapped: "", renderFailed: "", title: "", tagline: "" }, compose: {} as never,
        commands: [{ name: "chart", description: "", budget: 120, render: async () => ({ text: "<code>X</code> week", svg: candlesSvg(candles, "1.4", "X · w") }) }],
      };
      const edge = new TenantEdge({ id: tenantId, bot_id: botId, bot_username: "bot", bot_token_sealed: sealer.seal("tok"), aomi_webhook_url: "http://aomi.local/hook", webhook_secret: "s", ingest_key_hash: "h", ingest_origins: [] }, tenant as never, { store, sealer, telegramApiBase: "http://tg.local", fetchImpl: photoFetch, log: () => {} });
      await edge.handle(dm("/chart X w", 777));
      expect(uploads).toHaveLength(1);
      const form = uploads[0]!.body;
      expect(form.get("caption")).toBe("<code>X</code> week");
      const photo = form.get("photo") as Blob;
      expect(photo.type).toBe("image/png");
      const bytes = new Uint8Array(await photo.arrayBuffer());
      expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    } finally {
      await sql`DELETE FROM visits WHERE tenant = ${tenantId}`;
      await sql`DELETE FROM tenants WHERE id = ${tenantId}`;
      await sql.end();
    }
  });
});
