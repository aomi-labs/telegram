# Deploying

Two deployables, one Postgres.

## World staging (operator deployment)

The World staging worker and web app run together on `staging-2`
(`143.198.76.109`), under `/opt/world-telegram-staging`. This is separate from
the Aomi wallet/signing mini-app at `mini-app-staging.aomi.dev`.

- Worker: `https://world-tg-worker-staging.aomi.dev`
- Web: `https://world-tg-staging.aomi.dev/t/world`
- Bot: `@wordaomistaging_bot` (`8871026030`)
- Existing Aomi registration: `ca1c1a14-e740-499a-a18a-8ec24a0c40b0`,
  application `2937607`, project `1660`. Preserve this mapping when updating the worker.

The repository-root `Dockerfile` builds one image for both processes. Its
`.dockerignore` excludes local secrets, development state and build outputs.
Deploy a reviewed source snapshot using a unique image tag, record the resulting
image digest, and retain the previous image for rollback. The current deployment
uses source-content tag `world-telegram:ddf6e95c098d7789`, image digest
`sha256:17b5b5ff4bb3af68c5a782d05f42982dbd1be927462a85b5ba9805296375f00b`.

The host's `compose.json` runs worker, web and a dedicated PostgreSQL database.
Database storage persists in the `world-telegram-staging_data` Docker volume;
never use `docker compose down --volumes` for an application update. Protected
`worker.env` and `web.env` contain existing runtime settings. PostgreSQL has no
published port; worker/web listen through host loopback ports `28790`/`28791`.
No new application environment variables are required.

The `world-telegram-staging-tunnel` systemd service supplies HTTPS through the
dedicated named Cloudflare tunnel. Its ingress admits only the two hostnames
above and returns 404 otherwise. The scoped tunnel credential and token-sealing
key stay on the host; do not print or commit them.

Inspect or restart from the host:

```bash
cd /opt/world-telegram-staging
docker compose -f compose.json ps
docker compose -f compose.json up -d --wait
systemctl status world-telegram-staging-tunnel
```

Onboarding stores the existing Aomi webhook as the forwarding destination, then
switches Telegram to `/t/world/webhook` with a secret header. The bot's default
menu button opens the World web URL. Re-registering the bot through Aomi can
replace Telegram's worker webhook, so verify `getWebhookInfo` after changing its
registration. Do not copy the backend capability URL into documentation or logs.

Before calling the deployment healthy, require worker `/healthz` and web
`/t/world` to return 200, unsigned webhook requests to return 403, authenticated
but malformed webhook requests to return 400, and unsigned mini-app API requests
to return 401. Check the Telegram webhook destination, menu button and pending
updates using the stored token without exposing it.

Deployment is separate from account-linking readiness: the staging backend must
serve the canonical bot-scoped `/binding` endpoint before account pages work.
The worker deliberately keeps forwarding to the existing staging backend while
that dependency is being rolled out. Real Telegram launch, wallet handover and
trading still require their own end-to-end verification.

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
  pnpm onboard --tenant world
```

It reads the aomi webhook currently registered on the bot, stores it as the forward target,
points the bot at the worker and registers the command menu. Deploy the canonical Aomi binding endpoint before updating worker and web; no ingestion key is required.

## Day-one check on a real bot

Open the bot, tap a product act in the mini app, and confirm Telegram opens the chat with the
draft text pre-entered. If it does not, the fallback in `lib/tg.ts` (copy to clipboard, open the
chat) is the one to switch on.
