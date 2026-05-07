# syntax=docker/dockerfile:1

# ── Build stage: install production dependencies ──────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Non-root user for least-privilege execution.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src

USER appuser
EXPOSE 4000
ENV NODE_ENV=production

CMD ["node", "src/server.mjs"]
