import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  verify: vi.fn(), binding: vi.fn(), resolveAccount: vi.fn(),
  tenant: vi.fn(async () => ({ bot_id: "bot-1" })),
}));
vi.mock("@aomi-telegram/core", () => ({ verifyTelegramInitData: fixture.verify }));
vi.mock("../lib/server.ts", () => ({
  server: () => ({ store: { tenant: fixture.tenant, binding: fixture.binding } }),
  tenants: new Map([["world", { adapter: { resolveAccount: fixture.resolveAccount } }]]),
}));
import { authorize } from "../lib/auth.ts";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  fixture.verify.mockReturnValue({ ok: true, launch: { telegramUserId: "123" } });
  fixture.binding.mockResolvedValue(null);
});

describe("canonical mini-app authorization", () => {
  it("rejects invalid Telegram identity before canonical lookup", async () => {
    fixture.verify.mockReturnValue({ ok: false, reason: "invalid signature" });
    await expect(authorize(new Request("https://mini.example/api/t/world/portfolio"), "world")).rejects.toMatchObject({ status: 401 });
    expect(fixture.binding).not.toHaveBeenCalled();
  });
  it("derives the subject from verified initData, ignoring caller account and user parameters", async () => {
    const binding = { accountId: "42" };
    fixture.binding.mockResolvedValue(binding);
    fixture.resolveAccount.mockResolvedValue({ accountId: 42n });
    await authorize(new Request("https://mini.example/api/t/world/portfolio?telegram_user_id=999&account_id=victim", { headers: { "x-telegram-init-data": "signed-launch" } }), "world");
    expect(fixture.verify).toHaveBeenCalledWith("signed-launch", "bot-1");
    expect(fixture.binding).toHaveBeenCalledWith("world", "123");
    expect(fixture.resolveAccount).toHaveBeenCalledWith(binding);
  });
  it("does not read venue data while unclaimed or after revocation", async () => {
    expect(await authorize(new Request("https://mini.example"), "world")).toMatchObject({ binding: null, account: null });
    expect(fixture.resolveAccount).not.toHaveBeenCalled();
  });
  it("does not fall back to venue data when the canonical lookup fails", async () => {
    fixture.binding.mockRejectedValue(new Error("unavailable"));
    await expect(authorize(new Request("https://mini.example"), "world")).rejects.toThrow("unavailable");
    expect(fixture.resolveAccount).not.toHaveBeenCalled();
  });
});
