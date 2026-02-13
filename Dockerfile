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

# GitHub token for downloading @vscode/ripgrep binaries (avoids rate limits)
ARG GITHUB_TOKEN

COPY package.json package-lock.json bun.lock ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/
COPY apps/shared/package.json ./apps/shared/

RUN npm ci

COPY apps/frontend ./apps/frontend
COPY apps/backend ./apps/backend
COPY apps/shared ./apps/shared

WORKDIR /app/apps/frontend
RUN npm run build

# =============================================================================
# STAGE 3: Backend dependencies (no build needed - Bun runs TS directly)
# =============================================================================
FROM base AS backend-builder
WORKDIR /app

# GitHub token for downloading @vscode/ripgrep binaries (avoids rate limits)
ARG GITHUB_TOKEN

# Copy workspace config and all package files
COPY package.json package-lock.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/shared/package.json ./apps/shared/

# Install production dependencies only
# --ignore-scripts skips prepare (husky) but we need to manually run @vscode/ripgrep postinstall
RUN npm ci --omit=dev --ignore-scripts && cd node_modules/@vscode/ripgrep && npm run postinstall

# Copy backend source
COPY apps/backend ./apps/backend
COPY apps/shared ./apps/shared

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

ARG APP_VERSION=dev
ARG APP_COMMIT=unknown
ARG APP_BUILD_DATE=

# Install Node.js, Bun, git, and supervisor
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    supervisor \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g bun \
    && rm -rf /var/lib/apt/lists/*

RUN pip install uv

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
COPY --from=backend-builder /app/apps/shared ./apps/shared

# Copy frontend build artifacts (served as static files)
COPY --from=frontend-builder /app/apps/frontend/dist ./apps/frontend/dist

# Copy migrations
COPY apps/backend/migrations-postgres ./apps/backend/migrations-postgres
COPY apps/backend/migrations-sqlite ./apps/backend/migrations-sqlite

# Copy example project (fallback for local mode)
COPY example /app/example

# Copy supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY docker/supervisord.conf /etc/supervisor/conf.d/nao.conf

# Copy entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create context directory for git mode
RUN mkdir -p /app/context && chown -R nao:nao /app/context

# Set ownership
RUN chown -R nao:nao /app /var/log/supervisor

# Environment variables
ENV MODE=prod
ENV NODE_ENV=production
ENV BETTER_AUTH_URL=http://localhost:5005
ENV FASTAPI_PORT=8005
ENV APP_VERSION=$APP_VERSION
ENV APP_COMMIT=$APP_COMMIT
ENV APP_BUILD_DATE=$APP_BUILD_DATE
ENV NAO_DEFAULT_PROJECT_PATH=/app/example
ENV NAO_CONTEXT_SOURCE=local

EXPOSE 5005

# Use entrypoint script to initialize context before starting services
ENTRYPOINT ["/entrypoint.sh"]
