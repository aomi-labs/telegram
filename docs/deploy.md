# Deploying

Two deployables, one Postgres.

## Postgres

Any Postgres 15+. The worker runs the migrations in `packages/core/src/store/migrations`
on start; the web app only reads and writes existing tables.

## Worker (Fly.io)

```bash
fly launch --no-deploy --copy-config --config apps/worker/fly.toml
fly secrets set --config apps/worker/fly.toml \
  DATABASE_URL=postgres://... \
  SERVICE_KEY=$(openssl rand -hex 32) \
  PUBLIC_URL=https://aomi-telegram-worker.fly.dev \
  PUBLIC_WEB_URL=https://<web>.vercel.app
fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .
```

`SERVICE_KEY` seals tenant bot tokens at rest. Rotating it requires re-onboarding every tenant.
Keep one machine always running: the scheduler evaluates watches every minute.

## Web (Vercel)

Import the repository, set the root directory to `apps/web`, framework Next.js.
Environment: `DATABASE_URL`. Do not set `WEB_DEV_TELEGRAM_USER_ID` in production; it is ignored
there but should not exist at all.

## Onboarding a tenant (once)

Run from the repository root against the production `DATABASE_URL`, with the tenant's bot token:

```bash
BOT_TOKEN=... DATABASE_URL=... SERVICE_KEY=... PUBLIC_URL=https://aomi-telegram-worker.fly.dev \
  pnpm onboard --tenant world --ingest-origin https://dev.wcm.inc
```

It reads the aomi webhook currently registered on the bot, stores it as the forward target,
points the bot at the worker, registers the command menu, and prints the ingest key once.

## Day-one check on a real bot

Open the bot, tap a product act in the mini app, and confirm Telegram opens the chat with the
draft text pre-entered. If it does not, the fallback in `lib/tg.ts` (copy to clipboard, open the
chat) is the one to switch on.
