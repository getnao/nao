# =============================================================================
# STAGE 1: Base image with common dependencies
# =============================================================================
FROM node:24-slim AS base
WORKDIR /app

RUN npm install -g bun

# =============================================================================
# STAGE 2: Frontend builder
# =============================================================================
FROM base AS frontend-builder
WORKDIR /app

COPY package.json package-lock.json bun.lock ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/

RUN npm ci

COPY apps/frontend ./apps/frontend
COPY apps/backend ./apps/backend

WORKDIR /app/apps/frontend
RUN npm run build

# =============================================================================
# STAGE 3: Backend dependencies (no build needed - Bun runs TS directly)
# =============================================================================
FROM base AS backend-builder
WORKDIR /app

# Copy workspace config and all package files
COPY package.json package-lock.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

# Install production dependencies only (ignore-scripts skips husky)
RUN npm ci --omit=dev --ignore-scripts

# Copy backend source
COPY apps/backend ./apps/backend

# =============================================================================
# STAGE 4: Python/FastAPI builder
# =============================================================================
FROM python:3.12-slim AS python-builder
WORKDIR /app

# Install uv for fast dependency management
RUN pip install uv

# Copy cli package (contains nao_core)
COPY cli ./cli

# Install nao_core package and dependencies (non-editable for portability)
WORKDIR /app/cli
RUN uv pip install --system .

# =============================================================================
# STAGE 5: Runtime image
# =============================================================================
FROM python:3.12-slim AS runtime

# Install Node.js, Bun, and supervisor
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    supervisor \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g bun \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash nao
WORKDIR /app

# Copy Python packages from python-builder
COPY --from=python-builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages

# Copy workspace package files (needed for module resolution)
COPY --from=backend-builder /app/package.json ./
COPY --from=backend-builder /app/node_modules ./node_modules

# Copy backend source and dependencies
COPY --from=backend-builder /app/apps/backend ./apps/backend

# Copy frontend build artifacts (served as static files)
COPY --from=frontend-builder /app/apps/frontend/dist ./apps/frontend/dist

# Copy migrations
COPY apps/backend/migrations-postgres ./apps/backend/migrations-postgres
COPY apps/backend/migrations-sqlite ./apps/backend/migrations-sqlite

# Copy example project
COPY example /app/example

# Copy supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY docker/supervisord.conf /etc/supervisor/conf.d/nao.conf

# Set ownership
RUN chown -R nao:nao /app /var/log/supervisor

# Environment variables
ENV NODE_ENV=production
ENV FASTAPI_PORT=8005

EXPOSE 5005

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/nao.conf"]