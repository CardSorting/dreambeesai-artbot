# --- STAGE 1: Dependency Builder ---
FROM node:20-bookworm-slim AS builder

# Install build dependencies for native modules and tini
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only package files for optimal layer caching
COPY package*.json ./

# Install ALL dependencies (including dev for building)
RUN npm ci

# Copy source code
COPY . .

# --- STAGE 2: Production Runtime ---
FROM node:20-bookworm-slim

# Bring tini from the builder/system to ensure correct signal handling (SIGTERM)
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy only production dependencies and prebuilt binaries (Sharp) 
# from the builder stage
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy the rest of the application
COPY --from=builder /app ./

# Use Tini as the entrypoint to handle signal forwarding (PID 1 problem)
ENTRYPOINT ["/usr/bin/tini", "--"]

# Set the primary command
CMD ["node", "index.js"]

# Security: Use a non-root user
USER node

# Health check port
EXPOSE 8080
