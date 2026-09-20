# aomi-telegram

Multi-tenant Telegram mini-app service for aomi partner bots. The service owns
a partner bot's webhook, answers the partner's own slash commands from venue
reads, and forwards everything else to the aomi backend byte for byte. The
agent never learns the service exists.

```
Telegram ──► worker edge ──┬── /b /p /r /a /d /chart /tasks /app, t: callbacks, web_app_data → service
                           └── text, /start, /help, /wallet, /permission, /transactions, /sign, panel: → aomi webhook (outbox, retried)
```

## Layout

- `packages/core` — tenant contract, store and migrations, Bot API client, initData verifier, edge routing table, handover binding
- `apps/worker` — long-running process: webhook edge, outbox drainer, canonical Aomi binding lookup, onboarding CLI, 60 s scheduler (watches, liquidation alert, per-account fills index), chart PNGs
- `apps/web` — Next.js mini app and BFF
- `tenants/world` — World Markets on UniFi testnet

## Run locally

```bash
pnpm install
cp .env.example .env   # fill DATABASE_URL, SERVICE_KEY (openssl rand -hex 32), PUBLIC_URL
pnpm --filter @aomi-telegram/core test                     # unit tests
TEST_DATABASE_URL=postgres://... pnpm -r test              # plus store and edge tests
pnpm worker                                                # migrates, serves /t/:tenant/webhook, drains the outbox
```

Onboard a tenant bot (captures the aomi webhook URL currently registered on the
bot, then points the bot at this worker):

```bash
BOT_TOKEN=... pnpm onboard --tenant world
```

Against a fake Bot API (for example the `fake_telegram.py` from product-mono's
`scripts/world-e2e`), set `TELEGRAM_API_BASE=http://127.0.0.1:<port>` and
`VERIFY_WEBHOOK_SECRET=false`, and pass `--aomi-webhook-url` explicitly.

## Web app (mini app + BFF)

`apps/web` is a Next.js app. Screens are generic over the tenant contract:
`/t/<tenant>` (compact home), `/ledger`, `/portfolio`, `/products`,
`/chart?symbol=&period=`, `/watch`. Every BFF route under `/api/t/<tenant>/`
verifies the Mini App initData against Telegram's public key with the tenant's
bot id, then resolves the bound account. Env: `DATABASE_URL`; for local work
`WEB_DEV_TELEGRAM_USER_ID` (ignored in production) acts as that Telegram user.

```bash
pnpm --filter @aomi-telegram/web dev   # http://localhost:8791/t/world
```

The worker attaches mini-app buttons when `PUBLIC_WEB_URL` points at this app.

## World tenant

Reads go through the partner's own SDK (`@wcm-inc/sdk`) against UniFi testnet.
Env overrides: `WORLD_RPC_URL`, `WORLD_EXCHANGE_ADDRESS`, `WORLD_CHAIN_ID`.
`WORLD_LIVE=1 pnpm --filter @aomi-telegram/tenant-world test` runs the live
reads against account 20 on the public RPC. The SDK's ABI package ships raw
TypeScript, which is why the worker runs under `tsx`.

## Local network note

Off-venue fetches (Kraken candles) honour `HTTPS_PROXY` / `NO_PROXY` through an
undici proxy agent; venue RPC calls stay direct. On a machine that needs a proxy
for Kraken, set `HTTPS_PROXY` in the worker env and in `apps/web/.env.local`.

## Deploying

See `docs/deploy.md` (Fly.io worker, Vercel web, one Postgres) and
`docs/partner-onboarding.md` for what a partner does once.

## Invariants

- One owner per update. The service never replies to an update it forwards.
- Vendor commands are slash commands only, DM only, and may not use a reserved name.
- Aomi owns handover bindings. The edge forwards `/start`; every account lookup reads Aomi’s current bot-scoped binding. Local historical mappings cannot authorize access.
- Forwarding is at-least-once. The backend's invocation key makes a duplicate a no-op.
- A command that renders over its character budget fails; it is never trimmed.
