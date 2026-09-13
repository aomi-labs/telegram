import { describe, expect, it } from "vitest";
import { assertNoReservedCommands, classify, type Update } from "../src/index.ts";

const vendor = new Set(["b", "p", "r", "a", "d", "chart", "tasks", "app"]);

function message(text: string, chatType: "private" | "group" = "private", extra: Record<string, unknown> = {}): Update {
  const command = text.startsWith("/") ? text.split(/\s/)[0]! : null;
  return {
    update_id: 1,
    message: {
      message_id: 1, date: 0, chat: { id: 7, type: chatType }, from: { id: 7, is_bot: false, first_name: "A" },
      text,
      ...(command ? { entities: [{ type: "bot_command", offset: 0, length: command.length }] } : {}),
      ...extra,
    },
  };
}

describe("routing table", () => {
  it("vendor slash command in a DM is the service's", () => {
    const route = classify(message("/b"), vendor);
    expect(route.kind).toBe("vendor_command");
    if (route.kind === "vendor_command") expect(route.name).toBe("b");
  });
  it("vendor command with @botname suffix and args", () => {
    const route = classify(message("/chart@world_bot WETH w"), vendor);
    expect(route).toMatchObject({ kind: "vendor_command", name: "chart", args: ["WETH", "w"] });
  });
  it("bare word is text and forwards to the agent", () => {
    expect(classify(message("b"), vendor).kind).toBe("forward");
    expect(classify(message("balance please"), vendor).kind).toBe("forward");
  });
  it("official commands forward", () => {
    for (const cmd of ["/help", "/wallet", "/permission", "/transactions", "/sign"]) {
      expect(classify(message(cmd), vendor).kind).toBe("forward");
    }
  });
  it("/start carries its argument and is never swallowed", () => {
    expect(classify(message("/start abc123"), vendor)).toMatchObject({ kind: "start", arg: "abc123" });
    expect(classify(message("/start"), vendor)).toMatchObject({ kind: "start", arg: null });
  });
  it("vendor command in a group forwards", () => {
    expect(classify(message("/b", "group"), vendor).kind).toBe("forward");
  });
  it("a reserved name never routes to the vendor even if declared", () => {
    expect(classify(message("/help"), new Set(["help"])).kind).toBe("forward");
    expect(() => assertNoReservedCommands(["b", "help"])).toThrow(/help/);
  });
  it("web_app_data stays in the service", () => {
    expect(classify(message("", "private", { web_app_data: { data: "{}", button_text: "x" } }), vendor).kind).toBe("web_app_data");
  });
  it("callbacks split on the t: prefix", () => {
    const cb = (data: string): Update => ({ update_id: 2, callback_query: { id: "1", from: { id: 7, is_bot: false, first_name: "A" }, data } });
    expect(classify(cb("t:watch:pause:9"), vendor).kind).toBe("vendor_callback");
    expect(classify(cb("panel:wallet:open"), vendor).kind).toBe("forward");
  });
  it("unknown update types forward", () => {
    expect(classify({ update_id: 3, edited_message: {} }, vendor).kind).toBe("forward");
  });
});
