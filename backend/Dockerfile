# syntax=docker/dockerfile:1

# ─── build ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ─── runtime ─────────────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    STORAGE_ROOT=/var/lib/cloud-storage/data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/cloud-storage/data && chown -R node:node /var/lib/cloud-storage
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
