import { BotApi, Sealer, Store, type AccountBinding, type Tenant, type TenantRow } from "@aomi-telegram/core";
import { bandReached, liquidationAlertText, priceCrossed, watchFiredText } from "./pushes.ts";

export interface SchedulerDeps {
  store: Store;
  sealer: Sealer;
  telegramApiBase: string;
  tenants: ReadonlyMap<string, Tenant<any>>;
  log: (event: string, fields?: Record<string, unknown>) => void;
  /** Blocks per getLogs call while backfilling fills. */
  fillsChunk?: bigint;
}

const LIQUIDATION_ALERT = "liquidation";

/**
 * One pass per tenant: expire watches, evaluate live watches and the
 * liquidation alert per bound account, then advance each account's fills
 * index by one chunk. Every push goes out on the tenant's own token.
 */
export class Scheduler {
  private readonly apis = new Map<string, BotApi>();
  constructor(private readonly deps: SchedulerDeps) {}

  private api(row: TenantRow): BotApi {
    let api = this.apis.get(row.id);
    if (!api) {
      api = new BotApi(this.deps.sealer.open(row.bot_token_sealed), this.deps.telegramApiBase);
      this.apis.set(row.id, api);
    }
    return api;
  }

  async tick(): Promise<void> {
    for (const [id, tenant] of this.deps.tenants) {
      const row = await this.deps.store.tenant(id);
      if (!row) continue;
      try {
        await this.tickTenant(row, tenant);
      } catch (error) {
        this.deps.log("scheduler.tenant.error", { tenant: id, error: String(error) });
      }
    }
  }

  async tickTenant(row: TenantRow, tenant: Tenant<any>): Promise<void> {
    const { store, log } = this.deps;
    const expired = await store.expireWatches(row.id);
    if (expired) log("watches.expired", { tenant: row.id, count: expired });
    const bindings = await store.activeBindings(row.id);
    const live = await store.liveWatches(row.id);
    for (const binding of bindings) {
      const mine = live.filter((w) => w.account_id === binding.accountId);
      try {
        await this.evaluateAccount(row, tenant, binding, mine);
      } catch (error) {
        // A binding the venue rejects (owner does not hold that account) gets no fills scan either.
        log("scheduler.account.error", { tenant: row.id, account: binding.accountId, error: String(error) });
        continue;
      }
      try {
        await this.advanceFills(row, tenant, binding);
      } catch (error) {
        log("fills.error", { tenant: row.id, account: binding.accountId, error: String(error) });
      }
    }
  }

  private async evaluateAccount(row: TenantRow, tenant: Tenant<any>, binding: AccountBinding, watches: Awaited<ReturnType<Store["liveWatches"]>>): Promise<void> {
    const { store, log } = this.deps;
    const account = await tenant.adapter.resolveAccount(binding);
    const risk = await tenant.adapter.riskBand(account);
    const chatId = binding.telegramUserId;

    // Liquidation alert: raise once on entry, clear when the band is left, never re-arm inside it.
    const open = await store.openAlert(row.id, binding.accountId, LIQUIDATION_ALERT);
    if (risk.band === "liquidation" && !open) {
      await store.raiseAlert(row.id, binding.accountId, LIQUIDATION_ALERT);
      await this.api(row).sendMessage(chatId, liquidationAlertText(risk.score));
      log("alert.raised", { tenant: row.id, account: binding.accountId });
    } else if (risk.band !== "liquidation" && open) {
      await store.clearAlert(row.id, binding.accountId, LIQUIDATION_ALERT);
      log("alert.cleared", { tenant: row.id, account: binding.accountId });
    }

    for (const watch of watches) {
      const p = watch.params as Record<string, string>;
      let fired = false, observed = "";
      if (watch.kind === "price_cross" && p.symbol && p.level) {
        const mark = await tenant.adapter.markPrice(p.symbol);
        fired = priceCrossed(p.direction ?? "above", p.level, mark);
        observed = mark;
      } else if (watch.kind === "risk_band" && p.band) {
        fired = bandReached(p.band, risk.band);
        observed = risk.score.toFixed(1);
      }
      if (!fired) continue;
      const updated = await store.setWatchState(row.id, binding.accountId, watch.id, "fired");
      if (!updated) continue; // someone else got there first
      await this.api(row).sendMessage(chatId, watchFiredText(updated, observed));
      log("watch.fired", { tenant: row.id, account: binding.accountId, watch: watch.id });
    }
  }

  /** Moves one account's fills cursor forward by at most one chunk per tick, so backfills never starve live watches. */
  private async advanceFills(row: TenantRow, tenant: Tenant<any>, binding: AccountBinding): Promise<void> {
    const adapter = tenant.adapter;
    if (!adapter.scanFills || !adapter.headBlock || adapter.fillsGenesis === undefined) return;
    const { store, log } = this.deps;
    const key = `fills:${binding.accountId}`;
    const head = await adapter.headBlock();
    const from = (await store.cursor(row.id, key)) ?? adapter.fillsGenesis;
    if (from >= head) return;
    const chunk = this.deps.fillsChunk ?? 100_000n;
    const to = from + chunk < head ? from + chunk : head;
    const account = await adapter.resolveAccount(binding);
    const events = await adapter.scanFills(account, from, to);
    const inserted = await store.insertFills(
      events.map((e) => ({ book: e.book, block: e.block.toString(), log_index: e.logIndex, symbol: e.symbol, market: e.market, side: e.side, price: e.price, qty: e.qty, tx_hash: e.txHash, at: e.at })),
      row.id, binding.accountId,
    );
    await store.setCursor(row.id, key, to + 1n);
    if (inserted) log("fills.indexed", { tenant: row.id, account: binding.accountId, from: from.toString(), to: to.toString(), inserted });
  }
}

export function startScheduler(scheduler: Scheduler, intervalMs: number, log: SchedulerDeps["log"]): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await scheduler.tick();
    } catch (error) {
      log("scheduler.error", { error: String(error) });
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  return () => clearInterval(timer);
}
