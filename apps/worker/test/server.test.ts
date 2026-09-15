import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sealer, sha256Hex, handoverTokenHash, type Store, type TenantRow } from "@aomi-telegram/core";
import { world } from "@aomi-telegram/tenant-world";
import { createApp } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";

const owner = "0x" + "12".repeat(20);
const row: TenantRow = {
  id: "world", bot_id: "1", bot_username: "bot", bot_token_sealed: "", aomi_webhook_url: "http://aomi.local/hook",
  webhook_secret: "secret", ingest_key_hash: sha256Hex("server-key"), ingest_origins: ["http://dev.wcm.inc:5173"],
};
const record = vi.fn();
const store = { tenant: vi.fn(async () => row), recordPendingHandover: record } as unknown as Store;
const config = loadConfig({ DATABASE_URL: "postgres://localhost/test", SERVICE_KEY: "11".repeat(32), PUBLIC_URL: "http://localhost:8790" });
const body = { token_hash: handoverTokenHash("tokXYZ123456"), account_id: "42", chain_id: 2092151908, owner_address: owner };
const app = createApp({ config, store, sealer: new Sealer(config.SERVICE_KEY), log: vi.fn() });
const post = (headers: Record<string, string>, payload = body) => app.request("/t/world/handovers", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload),
});

describe("handover registration authority", () => {
  beforeEach(() => {
    vi.restoreAllMocks(); record.mockClear();
    vi.spyOn(world.adapter, "accountOwner").mockResolvedValue(owner);
  });
  it("rejects a forged allowed Origin even when the supplied owner matches the victim account", async () => {
    expect((await post({ origin: "http://dev.wcm.inc:5173" })).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });
  it("rejects a wrong bearer even with an allowed Origin", async () => {
    expect((await post({ origin: "http://dev.wcm.inc:5173", authorization: "Bearer wrong" })).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });
  it("preserves trusted server registration without a browser Origin", async () => {
    expect((await post({ authorization: "Bearer server-key" })).status).toBe(200);
    expect(body.token_hash).toBe("5c76bf9ccdd9d47d366856cbb18db613deee6caae77f7d071d2bf2f31d32f954");
    expect(record).toHaveBeenCalledWith({ tenant: "world", tokenHash: body.token_hash, accountId: "42", chainId: body.chain_id, ownerAddress: owner });
  });
});
