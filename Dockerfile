FROM node:22-alpine AS base
RUN corepack enable

# ── Dependencies ────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
# pnpm v10 blocks dependency build scripts by default. @posthog/cli's postinstall
# downloads the binary that withPostHogConfig uses to upload source maps during
# `pnpm build`; without it the build would fail when POSTHOG_API_KEY is set.
# Rebuild it explicitly so the binary is present regardless of pnpm's allowlist.
RUN pnpm rebuild @posthog/cli

# ── Build ───────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_MUI_X_LICENSE_KEY
ENV NEXT_PUBLIC_MUI_X_LICENSE_KEY=$NEXT_PUBLIC_MUI_X_LICENSE_KEY
# PostHog public project token — a NEXT_PUBLIC_ var, so it must be present at
# build time to be inlined into the client bundle (runtime env is too late).
ARG NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
# PostHog source-map upload credentials. Build-time only: these ARGs live in the
# builder stage and are NOT carried into the runner image below. POSTHOG_API_KEY
# is a personal API key scoped to error-tracking write.
ARG POSTHOG_API_KEY
ENV POSTHOG_API_KEY=$POSTHOG_API_KEY
ARG POSTHOG_PROJECT_ID
ENV POSTHOG_PROJECT_ID=$POSTHOG_PROJECT_ID
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
