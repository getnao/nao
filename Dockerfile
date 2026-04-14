# =============================================================================
# STAGE 1: Base image with common dependencies
# =============================================================================
FROM node:24-slim AS base
WORKDIR /app

RUN npm install -g bun

# =============================================================================
# STAGE 2: JS dependency installer (shared across frontend and backend)
# =============================================================================
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json bun.lock ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/
COPY apps/shared/package.json ./apps/shared/

# Single install for all workspaces. --ignore-scripts skips prepare (husky);
# @vscode/ripgrep needs its postinstall to download the platform binary.
# GITHUB_TOKEN is injected via BuildKit secret to avoid baking it into layers.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    --mount=type=secret,id=GITHUB_TOKEN \
    GITHUB_TOKEN="$(cat /run/secrets/GITHUB_TOKEN 2>/dev/null || true)" \
    bun install --ignore-scripts \
    && GITHUB_TOKEN="$(cat /run/secrets/GITHUB_TOKEN 2>/dev/null || true)" \
    cd node_modules/@vscode/ripgrep && npm run postinstall

# =============================================================================
# STAGE 3: Frontend builder
# =============================================================================
FROM deps AS frontend-builder

COPY apps/frontend ./apps/frontend
COPY apps/backend ./apps/backend
COPY apps/shared ./apps/shared

WORKDIR /app/apps/frontend
RUN npm run build

# =============================================================================
# STAGE 4: Python/FastAPI builder
# =============================================================================
FROM python:3.12-slim AS python-builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    unixodbc-dev \
    pkg-config \
    libmariadb-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY cli ./cli

WORKDIR /app/cli
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system '.[all]'

# =============================================================================
# STAGE 5: Runtime image
# =============================================================================
FROM python:3.12-slim AS runtime

ARG APP_VERSION=dev
ARG APP_COMMIT=unknown
ARG APP_BUILD_DATE=

# Install only runtime system packages — Node.js and Bun are copied from the
# base stage below, avoiding the slow nodesource.com setup + npm install.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    fontconfig \
    fonts-dejavu-core \
    git \
    libpq5 \
    supervisor \
    unixodbc \
    && rm -rf /var/lib/apt/lists/*

# Copy Node.js and Bun binaries from the base stage
COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -sf ../lib/node_modules/bun/bin/bun.exe /usr/local/bin/bun \
    && ln -sf ../lib/node_modules/bun/bin/bunx.exe /usr/local/bin/bunx

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Create non-root user and required directories
RUN useradd -m -s /bin/bash nao \
    && mkdir -p /var/log/supervisor /app/context /app/projects \
    && chown nao:nao /var/log/supervisor /app /app/context /app/projects

WORKDIR /app

# Copy all artifacts with --chown to avoid expensive recursive `chown -R`
COPY --from=python-builder --chown=nao:nao /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=python-builder --chown=nao:nao /usr/local/bin/nao /usr/local/bin/nao
COPY --from=deps --chown=nao:nao /app/package.json ./
COPY --from=deps --chown=nao:nao /app/node_modules ./node_modules

# Copy backend and shared source (no build needed — Bun runs TS directly)
COPY --chown=nao:nao apps/backend ./apps/backend
COPY --chown=nao:nao apps/shared ./apps/shared

# Copy frontend build output
COPY --from=frontend-builder --chown=nao:nao /app/apps/frontend/dist ./apps/frontend/dist

# Copy example project (fallback for local mode)
COPY --chown=nao:nao example /app/example

# Copy supervisor configuration
COPY docker/supervisord.conf /etc/supervisor/conf.d/nao.conf

# Copy entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

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
