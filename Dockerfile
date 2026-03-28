# --- STAGE 1: Industrial Builder ---
FROM node:20-bookworm-slim AS builder

# Install minimum build tools for native binaries (Sharp)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# [LAYER CACHING] Dependency isolation
COPY package*.json ./
RUN npm ci

# Copy source and prune
COPY . .
RUN npm prune --production

# --- STAGE 2: Hardened Production Runtime ---
# We use the same slim base for glibc compatibility with Sharp
FROM node:20-bookworm-slim

# Install tini for signal handling (SIGTERM)
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# [SECURITY] Set strictly production environment
ENV NODE_ENV=production
# [HARDENING] Point Sharp to /tmp for any overflow (ensures compat with Read-Only Root FS)
ENV SHARP_CACHE_DIR=/tmp/.sharp-cache

# [ISOLATION] Copy only the essential runtime artifacts
# We DO NOT copy npm or the builder's cache into the final stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/index.js ./
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/commands ./commands
COPY --from=builder /app/interactions ./interactions

# [SECURITY] Switch to non-privileged user immediately
USER node

# [ENTRYPOINT] Use tini as PID 1 to ensure signals reach Node
ENTRYPOINT ["/usr/bin/tini", "--"]

# [RUNTIME] Start the bot with performance-tuned GC settings
# This ensures the bot stays within GCE e2-small memory limits (2GB)
CMD ["node", "--max-old-space-size=1536", "index.js"]

EXPOSE 8080
