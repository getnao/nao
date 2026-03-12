# syntax=docker/dockerfile:1
# =============================================================================
# STAGE 1: Base image with common dependencies
# =============================================================================
FROM node:24-slim AS base
WORKDIR /app

RUN --mount=type=cache,target=/root/.npm \
    npm install -g bun

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

# Use bun install instead of npm ci for the frontend builder.
# npm ci doesn't install platform-specific optional deps (rollup, lightningcss, etc.)
# when the lockfile was generated on a different platform (npm bug #4828).
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=shared \
    bun install

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

# Install production dependencies only.
# Uses bun instead of npm ci — npm ci doesn't install platform-specific optional
# deps when the lockfile was generated on a different platform (npm bug #4828).
# --ignore-scripts skips prepare (husky) but we need to manually run @vscode/ripgrep postinstall.
# The ripgrep tarball cache at /tmp/vscode-ripgrep-cache-* persists between builds.
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=shared \
    --mount=type=cache,target=/tmp/vscode-ripgrep-cache-1.17.0 \
    bun install --ignore-scripts && cd node_modules/@vscode/ripgrep && npm run postinstall

# Copy backend source
COPY apps/backend ./apps/backend
COPY apps/shared ./apps/shared

# =============================================================================
# STAGE 4: Python/FastAPI builder
# =============================================================================
FROM python:3.12-slim AS python-builder
WORKDIR /app

# Install uv and unixodbc-dev (required to build pyodbc for FabricConfig)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    unixodbc-dev

RUN pip install uv

# Copy cli package (contains nao_core)
COPY cli ./cli

# Install nao_core package and dependencies (non-editable for portability)
WORKDIR /app/cli
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system .

# =============================================================================
# STAGE 5: Runtime image
# =============================================================================
FROM python:3.12-slim AS runtime

ARG APP_VERSION=dev
ARG APP_COMMIT=unknown
ARG APP_BUILD_DATE=

# Install system packages. Node.js and bun are copied from base instead of
# being installed via the nodesource setup script (~40s saved per build).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    libpq5 \
    supervisor \
    unixodbc

# Copy Node.js binary and global node_modules (npm + bun) from base.
# Both images share the same Debian base so system library deps are compatible.
COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -sf /usr/local/lib/node_modules/bun/bin/bun /usr/local/bin/bun \
    && ln -sf /usr/local/bin/bun /usr/local/bin/bunx

RUN pip install uv

# Create non-root user
RUN useradd -m -s /bin/bash nao
WORKDIR /app

# Copy Python packages from python-builder
COPY --from=python-builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages

# Copy workspace package files (needed for module resolution)
COPY --chown=nao:nao --from=backend-builder /app/package.json ./
COPY --chown=nao:nao --from=backend-builder /app/node_modules ./node_modules

# Copy backend source and dependencies
COPY --chown=nao:nao --from=backend-builder /app/apps/backend ./apps/backend
COPY --chown=nao:nao --from=backend-builder /app/apps/shared ./apps/shared

# Copy frontend build artifacts (served as static files)
COPY --chown=nao:nao --from=frontend-builder /app/apps/frontend/dist ./apps/frontend/dist

# Copy migrations
COPY --chown=nao:nao apps/backend/migrations-postgres ./apps/backend/migrations-postgres
COPY --chown=nao:nao apps/backend/migrations-sqlite ./apps/backend/migrations-sqlite

# Copy example project (fallback for local mode)
COPY --chown=nao:nao example /app/example

# Copy supervisor configuration
RUN mkdir -p /var/log/supervisor && chown nao:nao /var/log/supervisor
COPY docker/supervisord.conf /etc/supervisor/conf.d/nao.conf

# Copy entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /app/context && chown nao:nao /app/context

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
ENV DOCKER=1

EXPOSE 5005

# Use entrypoint script to initialize context before starting services
ENTRYPOINT ["/entrypoint.sh"]
