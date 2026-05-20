FROM node:22-alpine AS base
RUN corepack enable

# ── Dependencies ────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── Build ───────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_MUI_X_LICENSE_KEY
ENV NEXT_PUBLIC_MUI_X_LICENSE_KEY=$NEXT_PUBLIC_MUI_X_LICENSE_KEY
RUN pnpm build

# ── Runner ──────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Drizzle migrations need the schema + config at runtime
COPY --from=builder /app/src/server/db/schema.ts ./src/server/db/schema.ts
COPY --from=builder /app/src/server/db/migrations ./src/server/db/migrations
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
# Webhook management CLI (pnpm webhook:view/create/delete) runs via tsx at runtime
COPY --from=builder /app/scripts ./scripts

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
