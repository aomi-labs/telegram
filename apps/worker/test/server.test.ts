import { describe, expect, it, vi } from "vitest";
import { Sealer, type Store } from "@aomi-telegram/core";
import { createApp } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";

const config = loadConfig({ DATABASE_URL: "postgres://localhost/test", SERVICE_KEY: "11".repeat(32), PUBLIC_URL: "http://localhost:8790" });
const tenant = vi.fn();
const app = createApp({ config, store: { tenant } as unknown as Store, sealer: new Sealer(config.SERVICE_KEY), log: vi.fn() });

describe("retired handover registration", () => {
  it.each([{}, { origin: "http://dev.wcm.inc:5173" }, { authorization: "Bearer old-key" }])("cannot register account mappings with %j", async (headers) => {
    const response = await app.request("/t/world/handovers", {
      method: "POST", headers, body: JSON.stringify({ account_id: "victim" }),
    });
    expect(response.status).toBe(404);
    expect(tenant).not.toHaveBeenCalled();
  });
});
