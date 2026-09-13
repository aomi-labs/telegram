import { serve } from "@hono/node-server";
import postgres from "postgres";
import { Sealer, Store, migrate } from "@aomi-telegram/core";
import { loadConfig } from "./config.ts";
import { startDrainer } from "./forward.ts";
import { createApp } from "./server.ts";
import { Scheduler, startScheduler } from "./scheduler.ts";
import { tenants } from "./tenants.ts";

const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));

const config = loadConfig();
const sql = postgres(config.DATABASE_URL, { max: 8, onnotice: () => {} });
const store = new Store(sql);
const sealer = new Sealer(config.SERVICE_KEY);

const ran = await migrate(sql);
if (ran.length) log("migrated", { files: ran });

const app = createApp({ config, store, sealer, log });
const stopDrainer = startDrainer(
  { store, log, webhookUrlFor: async (tenant) => (await store.tenant(tenant))?.aomi_webhook_url ?? null },
  config.FORWARD_INTERVAL_MS,
);

const stopScheduler = startScheduler(
  new Scheduler({ store, sealer, telegramApiBase: config.TELEGRAM_API_BASE, tenants, log }),
  config.SCHEDULER_INTERVAL_MS,
  log,
);

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => log("listening", { port: info.port }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopDrainer();
    stopScheduler();
    server.close();
    void sql.end({ timeout: 5 }).then(() => process.exit(0));
  });
}
