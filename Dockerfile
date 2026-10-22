FROM node:24-slim
# Use the distribution's maintained trust store so emergency CA distrusts
# apply to Node's outbound TLS clients instead of a bundled CA snapshot.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
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
ENV NODE_ENV=production \
    NODE_OPTIONS=--use-openssl-ca
USER node
CMD ["pnpm", "worker"]
