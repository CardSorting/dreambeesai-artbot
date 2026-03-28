# --- STAGE 1: Dependency & Native Builder ---
FROM node:20-bookworm-slim AS builder

# Combine apt install and cleanup to reduce layer size
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# [LAYER CACHING] Copy only package files first
COPY package*.json ./

# Install ALL dependencies (including dev for building)
RUN npm ci

# Copy the rest of the application
COPY . .

# [OPTIMIZATION] Prune devDependencies before copying to production stage
RUN npm prune --production

# --- STAGE 2: High-Performance Production Runtime ---
FROM node:20-bookworm-slim

# Install tini (Signal handling) and cleanup in one step
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# [SPEED] Copy the pre-built, pruned node_modules from builder
# This skips running npm in the production stage entirely
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app ./

# Use Tini as the entrypoint to handle signal forwarding (PID 1)
ENTRYPOINT ["/usr/bin/tini", "--"]

# Set the primary command
CMD ["node", "index.js"]

# Security: Use non-root user
USER node

# Health check port
EXPOSE 8080
