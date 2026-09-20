import { svgToPng } from "./chart.ts";
import {
  BotApi, BudgetError, Sealer, Store, classify, commandNames, enforceBudget,
  miniAppUrl,
  type Tenant, type TenantRow, type Update,
} from "@aomi-telegram/core";

export interface EdgeDeps {
  store: Store;
  sealer: Sealer;
  telegramApiBase: string;
  fetchImpl?: typeof fetch;
  publicWebUrl?: string;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

/**
 * One tenant's edge. Owns the split: vendor commands and callbacks are
 * answered here on the tenant's own token; everything else is queued for the
 * aomi backend. Telegram is acknowledged by the caller as soon as this returns.
 */
export class TenantEdge {
  private readonly api: BotApi;
  private readonly vendorCommands: ReadonlySet<string>;

  constructor(
    private readonly row: TenantRow,
    private readonly tenant: Tenant<any>,
    private readonly deps: EdgeDeps,
  ) {
    this.api = new BotApi(deps.sealer.open(row.bot_token_sealed), deps.telegramApiBase, deps.fetchImpl);
    this.vendorCommands = commandNames(tenant);
  }

  /** Commit slow vendor work before acknowledging Telegram's webhook. */
  async accept(update: Update): Promise<void> {
    if (classify(update, this.vendorCommands).kind === "vendor_command") {
      await this.deps.store.enqueueVendor(this.row.id, update);
      return;
    }
    await this.handle(update);
  }

  async handle(update: Update): Promise<void> {
    const route = classify(update, this.vendorCommands);
    const { store, log } = this.deps;
    switch (route.kind) {
      case "forward":
        await store.enqueueForward(this.row.id, update);
        return;
      case "start": {
        const from = route.message.from;
        if (from) await store.touchVisit(this.row.id, String(from.id));
        await store.enqueueForward(this.row.id, update);
        return;
      }
      case "web_app_data":
        log("web_app_data.dropped", { tenant: this.row.id, chat: route.message.chat.id });
        return;
      case "vendor_callback":
        await this.api.answerCallbackQuery(route.query.id);
        log("callback.unhandled", { tenant: this.row.id, data: route.query.data });
        return;
      case "vendor_command":
        await this.runCommand(route.name, route.args, route.message);
        return;
    }
  }

  private async runCommand(name: string, args: string[], message: Update["message"] & object): Promise<void> {
    const command = this.tenant.commands.find((c) => c.name === name);
    if (!command) return;
    const chatId = String(message.chat.id);
    const telegramUserId = message.from ? String(message.from.id) : null;
    const binding = telegramUserId ? await this.deps.store.binding(this.row.id, telegramUserId) : null;
    if (telegramUserId) await this.deps.store.touchVisit(this.row.id, telegramUserId);
    try {
      const account = binding ? await this.tenant.adapter.resolveAccount(binding) : null;
      const publicWebUrl = this.deps.publicWebUrl;
      const reply = await command.render({
        binding, account, args, chatId, message,
        miniAppUrl: (view, query) => (publicWebUrl ? miniAppUrl(publicWebUrl, this.row.id, view, query) : null),
      });
      const text = enforceBudget(name, reply.text, command.budget);
      if (reply.svg) await this.api.sendPhoto(chatId, svgToPng(reply.svg), text, reply.button);
      else await this.api.sendMessage(chatId, text, reply.button);
    } catch (error) {
      this.deps.log("command.failed", { tenant: this.row.id, command: name, error: String(error), budget: error instanceof BudgetError });
      await this.api.sendMessage(chatId, this.tenant.copy.renderFailed);
    }
  }
}
