#!/usr/bin/env bash
# Deps JS (bun possède node_modules) + build du frontend + bundle backend (cold-start).
# Reproduit les stages `deps` et `frontend-builder` du Dockerfile amont.
set -euo pipefail
cd "$(dirname "$0")/.."

# HUSKY=0 : neutralise le hook `prepare` (husky) qui n'a pas de sens dans un build CI.
export HUSKY=0

# --ignore-scripts comme le Dockerfile (évite les postinstall lourds/aléatoires).
# @vscode/ripgrep >=1.18 livre son binaire via des optionalDependencies de plateforme : plus de postinstall.
bun install --ignore-scripts

# Extensions DuckDB (excel) pré-installées : les requêtes locales tournent avec l'accès externe coupé,
# donc rien ne peut être téléchargé à la volée. Reproduit l'étape du Dockerfile amont ; bin/web.sh
# exporte DUCKDB_EXTENSION_DIR si le dossier existe. Best-effort : sans lui, seuls les tableurs échouent.
DUCKDB_EXTENSION_DIR="$PWD/.duckdb-extensions" bun docker/install-duckdb-extensions.mjs \
  || echo "ℹ extensions DuckDB non installées (non bloquant ; lecture des tableurs indisponible)"

# Build du frontend → apps/frontend/dist (servi en statique par le backend).
( cd apps/frontend && bunx vite build )

# Bundle du backend → apps/backend/dist/cli.js, pour accélérer le démarrage à froid :
# bun n'a alors plus à transpiler tout le graphe de modules au boot (cf. timeout 60s Scalingo).
# Best-effort (non bloquant) ; utilisé au runtime seulement si NAO_USE_BUNDLE=true (cf. bin/web.sh).
# Les natifs sont externalisés (résolus depuis node_modules au runtime), comme `build:standalone` amont.
echo "Bundling backend (cold-start optimization)…"
bun build apps/backend/src/cli.ts \
  --target bun \
  --outfile apps/backend/dist/cli.js \
  --minify \
  --external playwright-core \
  --external puppeteer-core \
  --external '@boxlite-ai/boxlite' \
  --external '@pydantic/monty' \
  --external '@duckdb/node-bindings' \
  --external '@vscode/ripgrep' \
  && echo "✓ backend bundle: apps/backend/dist/cli.js" \
  || echo "ℹ backend bundle échoué (non bloquant ; runtime utilisera 'bun run src/cli.ts')"
