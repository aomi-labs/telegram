// Takes over a tenant bot's webhook. Run once per tenant:
//   BOT_TOKEN=... pnpm onboard --tenant world
// Prints the ingest key exactly once; only its hash is stored.
import { parseArgs } from "node:util";
import postgres from "postgres";
import { BotApi, Sealer, Store, migrate, randomToken, sha256Hex } from "@aomi-telegram/core";
import { loadConfig } from "./config.ts";
import { tenants } from "./tenants.ts";

const { values } = parseArgs({ options: { tenant: { type: "string" }, "aomi-webhook-url": { type: "string" }, "ingest-origin": { type: "string", multiple: true } } });
const tenantId = values.tenant;
const tenant = tenantId ? tenants.get(tenantId) : undefined;
if (!tenantId || !tenant) throw new Error(`--tenant must be one of: ${[...tenants.keys()].join(", ")}`);
const botToken = process.env.BOT_TOKEN;
if (!botToken) throw new Error("BOT_TOKEN is required in the environment");

const config = loadConfig();
const sql = postgres(config.DATABASE_URL, { max: 2, onnotice: () => {} });
await migrate(sql);
const store = new Store(sql);
const sealer = new Sealer(config.SERVICE_KEY);
const api = new BotApi(botToken, config.TELEGRAM_API_BASE);

const me = await api.getMe();
const existing = await store.tenant(tenantId);
const current = await api.getWebhookInfo();
const ourUrl = `${config.PUBLIC_URL.replace(/\/$/, "")}/t/${tenantId}/webhook`;

// Capture the aomi backend's URL before we replace it. On a re-run the
// webhook already points at us, so keep what we stored the first time.
const aomiWebhookUrl = values["aomi-webhook-url"] ?? (current.url && current.url !== ourUrl ? current.url : existing?.aomi_webhook_url);
if (!aomiWebhookUrl) throw new Error("no aomi webhook url: bot has none registered and --aomi-webhook-url was not given");

const webhookSecret = existing?.webhook_secret ?? randomToken(24);
const ingestKey = randomToken(32);
await store.upsertTenant({
  id: tenantId,
  bot_id: String(me.id),
  bot_username: me.username,
  bot_token_sealed: sealer.seal(botToken),
  aomi_webhook_url: aomiWebhookUrl,
  webhook_secret: webhookSecret,
  ingest_key_hash: sha256Hex(ingestKey),
  ingest_origins: values["ingest-origin"] ?? existing?.ingest_origins ?? [],
});
await api.setWebhook(ourUrl, webhookSecret);
await api.setMyCommands(tenant.commands.map((c) => ({ command: c.name, description: c.description })));

console.log(JSON.stringify({ tenant: tenantId, bot: me.username, bot_id: me.id, webhook: ourUrl, forwards_to: aomiWebhookUrl, ingest_origins: values["ingest-origin"] ?? existing?.ingest_origins ?? [] }, null, 2));
console.log(`INGEST_KEY (shown once): ${ingestKey}`);
await sql.end();
