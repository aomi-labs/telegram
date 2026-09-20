import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { Store } from "../src/store/store.ts";

const sql = vi.fn(async () => [{ aomi_webhook_url: "https://backend.example/api/bots/telegram/secret" }]) as unknown as Sql;
const binding = { account_id: "42", chain_id: 1, owner_address: "0x" + "12".repeat(20), state: "claimed" };

describe("canonical handover reads", () => {
  it("uses the exact tenant capability and verified subject, and rechecks revocation", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ binding })).mockResolvedValueOnce(Response.json({ binding: null }));
    const store = new Store(sql, request);
    expect(await store.binding("world", "123")).toMatchObject({ accountId: "42", telegramUserId: "123" });
    expect(request).toHaveBeenCalledWith("https://backend.example/api/bots/telegram/secret/binding", expect.objectContaining({
      redirect: "error", cache: "no-store", body: JSON.stringify({ telegram_user_id: "123" }),
    }));
    expect(await store.binding("world", "123")).toBeNull();
  });
  it.each(["pending", "expired", "revoked", "unknown"])("rejects %s without any local fallback", async (state) => {
    const store = new Store(sql, async () => Response.json({ binding: { ...binding, state } }));
    await expect(store.binding("world", "123")).rejects.toThrow("Account linking is unavailable");
  });
  it.each([401, 404, 500, 503])("fails closed on HTTP %s", async (status) => {
    const store = new Store(sql, async () => new Response("upstream secret", { status }));
    await expect(store.binding("world", "123")).rejects.toThrow("Account linking is unavailable");
  });
  it("does not leak the capability in transport errors", async () => {
    const store = new Store(sql, async () => { throw new Error("https://backend.example/api/bots/telegram/secret"); });
    const error = await store.binding("world", "123").catch((error) => error);
    expect(error.message).toBe("Account linking is unavailable. Please try again.");
    expect(error.cause).toBeUndefined();
  });
});
