# Long-running worker: webhook edge, outbox drainer, scheduler, chart PNGs.
FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY tenants/world/package.json tenants/world/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @aomi-telegram/worker...
COPY packages ./packages
COPY tenants ./tenants
COPY apps/worker ./apps/worker
ENV NODE_ENV=production
EXPOSE 8790
WORKDIR /app/apps/worker
CMD ["pnpm", "start"]
