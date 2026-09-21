#!/usr/bin/env bash
# Process `web` Scalingo. Reproduit docker/entrypoint.sh + docker/supervisord.conf, MAIS sans
# supervisord ni root (indisponibles sur un buildpack) : on lance le sidecar FastAPI en arrière-plan
# puis le backend bun au premier plan, lié à $PORT (ce que la box Scalingo health-check).
set -euo pipefail
cd "$(dirname "$0")/.."

# --- Port : Scalingo impose $PORT ; nao écoute sur SERVER_PORT (et bind 0.0.0.0 par défaut). ---
export SERVER_PORT="${PORT:?Scalingo doit définir PORT}"
export FASTAPI_PORT="${FASTAPI_PORT:-8005}"     # interne (127.0.0.1), défaut du Dockerfile amont
export MODE="${MODE:-prod}"
export NODE_ENV="${NODE_ENV:-production}"

# --- Base interne de nao (sessions, chats…) : l'URL de l'addon (auto-rotée) prime. ---
export DB_URI="${SCALINGO_POSTGRESQL_URL:-${DB_URI:-${DATABASE_URL:-sqlite:./db.sqlite}}}"

# --- Extensions DuckDB pré-installées au build (cf. bin/build-js.sh), requises pour lire les tableurs. ---
if [ -d .duckdb-extensions ]; then
  export DUCKDB_EXTENSION_DIR="${DUCKDB_EXTENSION_DIR:-$PWD/.duckdb-extensions}"
fi

# --- Base SOURCE analysée (référencée par nao_config.yaml). Ergonomie « connection string » :
#     fournis un seul NAO_DB_URL=postgres://user:pass@host:port/db et on le décompose en
#     NAO_DB_HOST/PORT/NAME/USER/PASSWORD. Les variables explicites éventuelles priment. ---
if [ -n "${NAO_DB_URL:-}" ] && command -v python3 >/dev/null 2>&1; then
  eval "$(python3 - "$NAO_DB_URL" <<'PY'
import sys, shlex
from urllib.parse import urlparse, unquote
p = urlparse(sys.argv[1])
vals = {
    "NAO_DB_HOST": p.hostname or "",
    "NAO_DB_PORT": str(p.port or 5432),
    "NAO_DB_NAME": (p.path or "").lstrip("/"),
    "NAO_DB_USER": unquote(p.username or ""),
    "NAO_DB_PASSWORD": unquote(p.password or ""),
}
for k, v in vals.items():
    # ${VAR:-default} : une valeur déjà exportée n'est pas écrasée.
    print(f"export {k}=${{{k}:-{shlex.quote(v)}}}")
PY
)"
fi

# --- Contexte git (repo de contexte du produit). Logique reprise de docker/entrypoint.sh. ---
if [ "${NAO_CONTEXT_SOURCE:-}" = "git" ] || [ -n "${NAO_CONTEXT_GIT_URL:-}" ]; then
  export NAO_CONTEXT_SOURCE=git
  : "${NAO_CONTEXT_GIT_URL:?NAO_CONTEXT_GIT_URL requis quand NAO_CONTEXT_SOURCE=git}"
  NAO_DEFAULT_PROJECT_PATH="${NAO_DEFAULT_PROJECT_PATH:-/app/context}"
  NAO_CONTEXT_GIT_BRANCH="${NAO_CONTEXT_GIT_BRANCH:-main}"
  NAO_CONTEXT_GIT_SUBPATH="${NAO_CONTEXT_GIT_SUBPATH:-}"
  NAO_CONTEXT_GIT_SUBPATH="${NAO_CONTEXT_GIT_SUBPATH#/}"
  NAO_CONTEXT_GIT_SUBPATH="${NAO_CONTEXT_GIT_SUBPATH%/}"

  GIT_URL="$NAO_CONTEXT_GIT_URL"
  case "$NAO_CONTEXT_GIT_URL" in
    git@*|ssh://*)
      : "${NAO_CONTEXT_GIT_SSH_KEY:?clé SSH requise pour une URL git@/ssh://}"
      SSH_DIR="$(mktemp -d)"; chmod 700 "$SSH_DIR"
      printf '%s\n' "$NAO_CONTEXT_GIT_SSH_KEY" > "$SSH_DIR/id_deploy"; chmod 600 "$SSH_DIR/id_deploy"
      ssh-keyscan -t rsa,ecdsa,ed25519 github.com bitbucket.org gitlab.com > "$SSH_DIR/known_hosts" 2>/dev/null || true
      export GIT_SSH_COMMAND="ssh -i $SSH_DIR/id_deploy -o IdentitiesOnly=yes -o UserKnownHostsFile=$SSH_DIR/known_hosts -o StrictHostKeyChecking=yes"
      ;;
    https://*|http://*)
      # Repo public : aucun token. Privé : NAO_CONTEXT_GIT_TOKEN (PAT).
      if [ -n "${NAO_CONTEXT_GIT_TOKEN:-}" ]; then
        GIT_URL="$(printf '%s' "$NAO_CONTEXT_GIT_URL" | sed "s|https://|https://${NAO_CONTEXT_GIT_TOKEN}@|")"
      fi
      ;;
    *) echo "ERREUR: schéma d'URL non supporté: $NAO_CONTEXT_GIT_URL"; exit 1 ;;
  esac

  # Clone propre à chaque boot (FS éphémère sur Scalingo).
  rm -rf "$NAO_DEFAULT_PROJECT_PATH"
  mkdir -p "$(dirname "$NAO_DEFAULT_PROJECT_PATH")"
  if [ -n "$NAO_CONTEXT_GIT_SUBPATH" ]; then
    git clone --branch "$NAO_CONTEXT_GIT_BRANCH" --depth 1 --single-branch \
      --filter=blob:none --sparse "$GIT_URL" "$NAO_DEFAULT_PROJECT_PATH"
    git -C "$NAO_DEFAULT_PROJECT_PATH" sparse-checkout set "$NAO_CONTEXT_GIT_SUBPATH"
    NAO_DEFAULT_PROJECT_PATH="$NAO_DEFAULT_PROJECT_PATH/$NAO_CONTEXT_GIT_SUBPATH"
  else
    git clone --branch "$NAO_CONTEXT_GIT_BRANCH" --depth 1 --single-branch "$GIT_URL" "$NAO_DEFAULT_PROJECT_PATH"
  fi
  [ -f "$NAO_DEFAULT_PROJECT_PATH/nao_config.yaml" ] || { echo "ERREUR: nao_config.yaml absent dans $NAO_DEFAULT_PROJECT_PATH"; exit 1; }
  export NAO_DEFAULT_PROJECT_PATH
  echo "✓ Contexte git prêt: $NAO_DEFAULT_PROJECT_PATH"
fi

# --- Secret d'auth : doit être stable (sinon déconnexions à chaque restart). ---
if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  echo "⚠ BETTER_AUTH_SECRET absent — généré (NON persistant). À définir via env-set."
  export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
fi

# --- Sidecar FastAPI en arrière-plan (127.0.0.1:$FASTAPI_PORT) — le backend l'appelle en localhost. ---
# PYTHONPATH : main.py importe son voisin `api_models` comme module de premier niveau (amont c74cb43),
# ce qui ne se résout pas quand il est chargé sous le nom apps.backend.fastapi.main.
PYTHONPATH="$PWD/apps/backend/fastapi${PYTHONPATH:+:$PYTHONPATH}" \
  python -m uvicorn apps.backend.fastapi.main:app --host 127.0.0.1 --port "$FASTAPI_PORT" &
FASTAPI_PID=$!
trap 'kill "$FASTAPI_PID" 2>/dev/null || true' EXIT
# Si le sidecar meurt, on fait tomber tout le conteneur pour que Scalingo le redémarre proprement.
( while kill -0 "$FASTAPI_PID" 2>/dev/null; do sleep 5; done; echo "✗ FastAPI arrêté — arrêt du conteneur"; kill -TERM 0 ) &

# --- Backend au premier plan, lié à $PORT (joue aussi les migrations au boot). ---
# Optimisation cold-start : si NAO_USE_BUNDLE=true et que le bundle existe, on lance le JS
# pré-bundlé (démarrage bien plus rapide). Sinon, mode par défaut éprouvé (transpile à la volée).
if [ "${NAO_USE_BUNDLE:-}" = "true" ] && [ -f apps/backend/dist/cli.js ]; then
  echo "▶ backend: bundle pré-compilé (apps/backend/dist/cli.js)"
  exec bun apps/backend/dist/cli.js serve --port "$SERVER_PORT"
else
  echo "▶ backend: transpile à la volée (apps/backend/src/cli.ts)"
  exec bun run apps/backend/src/cli.ts serve --port "$SERVER_PORT"
fi
