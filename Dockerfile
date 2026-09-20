FROM node:24-slim
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY tenants/world/package.json tenants/world/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY tenants tenants
COPY apps apps
RUN pnpm --filter @aomi-telegram/web build
ENV NODE_ENV=production
USER node
CMD ["pnpm", "worker"]
