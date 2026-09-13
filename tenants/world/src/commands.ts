import { candlesSvg, type CommandCtx, type CommandReply, type InlineKeyboardButton, type TenantCommand } from "@aomi-telegram/core";
import { formatMark } from "./money.ts";
import type { WorldAccount, WorldAdapter } from "./adapter.ts";
import { renderAvailable, renderBalance, renderDollarpower, renderPositions, renderRisk, POSITIONS_BUDGET } from "./lookups.ts";
import type { AccountSnapshot } from "./snapshot.ts";

export const UNMAPPED = "Set up your agent on the World Markets web app first, then come back here.";

type Lookup = (snapshot: AccountSnapshot) => string;

function webApp(ctx: CommandCtx<WorldAccount>, text: string, view: string, query?: Record<string, string>): InlineKeyboardButton | undefined {
  const url = ctx.miniAppUrl(view, query);
  return url ? { text, web_app: { url } } : undefined;
}

/** A one-line lookup: bound account → one venue read → one templated line, never a menu. The button is host chrome, never narrated. */
function lookup(adapter: WorldAdapter, name: string, description: string, budget: number, render: Lookup, button?: { text: string; view: string }): TenantCommand<WorldAccount> {
  return {
    name, description, budget,
    async render(ctx: CommandCtx<WorldAccount>): Promise<CommandReply> {
      if (!ctx.account) return { text: UNMAPPED };
      const text = render(await adapter.snapshot(ctx.account));
      const chrome = button ? webApp(ctx, button.text, button.view) : undefined;
      return chrome ? { text, button: chrome } : { text };
    },
  };
}

export function worldCommands(adapter: WorldAdapter): TenantCommand<WorldAccount>[] {
  const viewPortfolio = { text: "View portfolio", view: "portfolio" };
  return [
    lookup(adapter, "b", "Portfolio balance", 60, renderBalance, viewPortfolio),
    lookup(adapter, "p", "Positions", POSITIONS_BUDGET, renderPositions, viewPortfolio),
    lookup(adapter, "r", "Liquidation risk", 60, renderRisk),
    lookup(adapter, "a", "Available to deploy", 60, renderAvailable),
    lookup(adapter, "d", "Dollarpower", 80, renderDollarpower),
    {
      name: "chart", description: "Chart: /chart WETH [d|w|m]", budget: 120,
      async render(ctx) {
        const symbol = ctx.args[0]?.toUpperCase();
        if (!symbol) return { text: "Which market? Try <code>/chart WETH d</code>." };
        const period = (ctx.args[1]?.toLowerCase() ?? "d")[0];
        if (!period || !"dwm".includes(period)) return { text: "Period is d, w or m. Try <code>/chart WETH w</code>." };
        const [candles, mark] = await Promise.all([
          adapter.chart(symbol, period as "d" | "w" | "m"),
          adapter.markPrice(symbol).catch(() => null),
        ]);
        const button = webApp(ctx, "Open chart", "chart", { symbol, period });
        if (candles.length === 0) return button ? { text: `No chart source for <code>${symbol}</code> yet.`, button } : { text: `No chart source for <code>${symbol}</code> yet.` };
        const text = `<code>${symbol}</code> ${({ d: "day", w: "week", m: "month" } as Record<string, string>)[period]}${mark ? ` · mark <code>${formatMark(mark)}</code>` : ""}`;
        const svg = candlesSvg(candles, mark, `${symbol} · ${period}`);
        return button ? { text, button, svg } : { text, svg };
      },
    },
    {
      name: "tasks", description: "Open the ledger", budget: 120,
      async render(ctx) {
        const button = webApp(ctx, "Open ledger", "ledger");
        return button ? { text: "Your ledger.", button } : { text: "The ledger opens in the World mini app." };
      },
    },
    {
      name: "app", description: "Open the World mini app", budget: 120,
      async render(ctx) {
        const button = webApp(ctx, "Open World", "");
        return button ? { text: "World Markets.", button } : { text: "The World mini app is not configured." };
      },
    },
  ];
}
