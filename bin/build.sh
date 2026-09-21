#!/usr/bin/env bash
# Orchestrateur de build, appelé par `heroku-postbuild` (hook du bun-buildpack).
# Reproduit les stages du Dockerfile amont : deps Python (uv) + deps JS (bun) + build frontend.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== [build] 1/2 Python CLI (sidecar FastAPI) ==="
bash bin/build-python.sh

echo "=== [build] 2/4 JS deps + frontend (bun) ==="
bash bin/build-js.sh

echo "=== [build] 3/4 retrait des paquets UI du frontend (déjà buildé) ==="
# `bun install --production` n'élague rien (les deps du workspace frontend sont des dependencies).
# On retire donc explicitement les plus lourdes, jamais importées par apps/backend ni apps/shared
# (~400 Mo, indispensable pour tenir sous la limite d'image de 2 Go). Un filtre par workspace
# (--filter @nao/backend) casserait : backend et shared importent recharts/marked sans les déclarer.
du -sh node_modules 2>/dev/null | sed 's/^/[build] node_modules avant retrait: /' || true
rm -rf \
  node_modules/@tabler \
  node_modules/mermaid \
  node_modules/monaco-editor \
  node_modules/maplibre-gl \
  node_modules/lucide-react \
  node_modules/posthog-js

echo "=== [build] 4/4 nettoyage caches (réduction du slug) ==="
# Caches inutiles au runtime mais embarqués dans le slug. On NE touche PAS à .heroku/bin (binaire bun).
rm -rf \
  .heroku/cache \
  "${HOME:-.}/.cache" .cache \
  node_modules/.cache \
  apps/frontend/.vite \
  cli/tests \
  2>/dev/null || true
du -sh node_modules 2>/dev/null | sed 's/^/[build] node_modules: /' || true

echo "=== [build] terminé ==="
