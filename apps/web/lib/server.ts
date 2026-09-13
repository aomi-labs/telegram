import postgres from "postgres";
import { Store, type Tenant } from "@aomi-telegram/core";
import { world } from "@aomi-telegram/tenant-world";

/** Process-wide singletons. On serverless each instance builds its own once. */
declare global {
  var __aomiTelegramServer: { sql: postgres.Sql; store: Store } | undefined;
}

export const tenants: ReadonlyMap<string, Tenant<any>> = new Map([[world.id, world]]);

export function server(): { sql: postgres.Sql; store: Store } {
  if (!globalThis.__aomiTelegramServer) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const sql = postgres(url, { max: 4, onnotice: () => {} });
    globalThis.__aomiTelegramServer = { sql, store: new Store(sql) };
  }
  return globalThis.__aomiTelegramServer;
}
