import type { InlineKeyboardButton } from "./update.ts";
import { proxyAwareFetch } from "../net.ts";

export interface WebhookInfo { url: string; has_custom_certificate?: boolean; pending_update_count?: number }
export interface BotIdentity { id: number; username: string; first_name: string }

export class BotApiError extends Error {
  constructor(readonly method: string, readonly code: number, description: string) {
    super(`${method}: ${code} ${description}`);
  }
}

/** Thin Bot API client. One instance per tenant, base overridable for a fake. */
export class BotApi {
  constructor(
    private readonly token: string,
    private readonly base = "https://api.telegram.org",
    private readonly fetchImpl: typeof fetch = proxyAwareFetch,
  ) {}

  async call<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.base}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; error_code?: number; description?: string };
    if (!response.ok || payload.ok === false) {
      throw new BotApiError(method, payload.error_code ?? response.status, payload.description ?? response.statusText);
    }
    return payload.result as T;
  }

  getMe(): Promise<BotIdentity> {
    return this.call<BotIdentity>("getMe");
  }

  getWebhookInfo(): Promise<WebhookInfo> {
    return this.call<WebhookInfo>("getWebhookInfo");
  }

  setWebhook(url: string, secretToken?: string): Promise<boolean> {
    return this.call<boolean>("setWebhook", {
      url,
      allowed_updates: ["message", "callback_query"],
      ...(secretToken ? { secret_token: secretToken } : {}),
    });
  }

  setMyCommands(commands: { command: string; description: string }[]): Promise<boolean> {
    return this.call<boolean>("setMyCommands", { commands, scope: { type: "all_private_chats" } });
  }

  sendMessage(chatId: string | number, text: string, button?: InlineKeyboardButton): Promise<unknown> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
    });
  }

  answerCallbackQuery(id: string, text?: string): Promise<unknown> {
    return this.call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  }

  /** Multipart upload so a chart PNG never leaves the worker as a URL. */
  async sendPhoto(chatId: string | number, png: Uint8Array<ArrayBuffer>, caption: string, button?: InlineKeyboardButton): Promise<unknown> {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("caption", caption);
    form.set("photo", new Blob([png], { type: "image/png" }), "chart.png");
    if (button) form.set("reply_markup", JSON.stringify({ inline_keyboard: [[button]] }));
    const response = await this.fetchImpl(`${this.base}/bot${this.token}/sendPhoto`, { method: "POST", body: form });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; error_code?: number; description?: string };
    if (!response.ok || payload.ok === false) {
      throw new BotApiError("sendPhoto", payload.error_code ?? response.status, payload.description ?? response.statusText);
    }
    return payload.result;
  }
}
