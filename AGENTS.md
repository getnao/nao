# AGENTS.md

## Cursor Cloud specific instructions

### Testing preferences

- Do not perform manual GUI/visual verification for frontend/UI changes (no browser walkthroughs, screenshots, or screen recordings). The maintainers handle visual verification themselves. Still run relevant lint and automated tests.

### Services overview

| Service                    | Port | Command                | Notes                                                                                                    |
| -------------------------- | ---- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Backend (Fastify/tRPC/Bun) | 5005 | `npm run dev:backend`  | Uses `bun --watch` for hot reload                                                                        |
| Frontend (Vite/React)      | 3000 | `npm run dev:frontend` | Vite HMR                                                                                                 |
| FastAPI (Python sidecar)   | 8005 | `npm run dev:fastapi`  | Requires `NAO_DEFAULT_PROJECT_PATH` to point to a valid nao project folder; optional for core UI testing |
| All three together         | —    | `npm run dev`          | Runs all via `npm-run-all`; will fail if FastAPI project path is missing                                 |

### Running the app

- Use `npm run dev:backend` and `npm run dev:frontend` separately when you don't need the FastAPI sidecar. The `npm run dev` command starts all three but exits if any fails (including FastAPI which needs a configured project path).
- The `.env` file must exist at the repo root (copy from `.env.example`). `BETTER_AUTH_SECRET` must be a non-empty string (generate with `openssl rand -base64 32`). `BETTER_AUTH_URL` should be `http://localhost:5005`.
- SQLite is the default database — zero setup needed. Schema is pushed on first run or via `npm run -w @nao/backend db:push`.

### Lint & test

- **JS/TS lint**: `npm run lint` (runs `tsc --noEmit && eslint` across backend, frontend, shared)
- **Python lint**: `cd cli && make lint` (runs `ty check`, `ruff check`, `ruff format --check`)
- **Backend tests**: `npm run -w @nao/backend test` (vitest)
- **Frontend and shared tests**: `npm run -w @nao/frontend test` and `npm run -w @nao/shared test` (vitest)
- **CLI tests**: `cd cli && uv run pytest`
- Where tests go and how to keep the suite small is described under "Tests" in `CLAUDE.md`.
- **Desktop (Tauri)**: `npm run test:desktop` (vitest), `npm run lint:desktop:rust` (cargo fmt, clippy, tests; needs `npm run build:ui -w @nao/desktop` first). E2E smoke test on Linux: build the frontend (`npx vite build` in `apps/frontend`), `npm run build:e2e -w @nao/desktop`, then `xvfb-run -a npm run test:e2e -w @nao/desktop` (needs `tauri-driver` and `WebKitWebDriver`). `npm run dev:desktop` opens the app.
- **Desktop builds**: every desktop PR, push to `main` and manual run of `.github/workflows/desktop.yml` (Actions → Desktop → Run workflow, any branch) uploads the macOS, Windows and Linux installers as run artifacts, kept 14 days and linked in the run summary. The macOS one is notarized when the `APPLE_*` secrets are set.
- **Desktop release**: bump `version` in `apps/desktop/package.json`, then push the tag `desktop-v<version>`. `.github/workflows/desktop.yml` creates a draft release, builds macOS (universal), Windows and Linux into it, publishes it as a prerelease (never the repo's latest, which is the CLI's), and copies its `latest.json` to the `desktop-latest` release that the in-app updater reads. It needs the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets (the key matching `plugins.updater.pubkey`). The `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` secrets sign and notarize the macOS app with nao Labs' Developer ID (the same credentials as `getnao/nao-build`'s `CODESIGN_ENV`); without them it is ad-hoc signed and not notarized. `MIN_SERVER_VERSION` in `src-tauri/src/server_info.rs` must be the first nao release that ships `/api/server-info`.
- **Memory**: the frontend `tsc` can exceed Node's default heap on this VM; prefix lint/build commands with `NODE_OPTIONS=--max-old-space-size=8192` if it aborts with "heap out of memory".
- **Pre-commit hook** (`.husky/pre-commit`): runs `npm run lint`, `npm run format:check`, `npm run db:check-migrations -w @nao/backend`, and `npm run cli:check`

### Gotchas

- `mysqlclient` Python package (pulled by `nao-core[all]`) requires `libmysqlclient-dev` system package to build. The VM snapshot has this pre-installed.
- The `npm run dev` combined command uses `npm-run-all -lp` — if any sub-process exits non-zero the entire group stops. Start services individually to isolate failures.
- Backend uses `bun` as runtime (not Node); make sure `bun` is installed globally (`npm install -g bun`).
- Node.js version is pinned in `.nvmrc` (v22.23.4). Python version is pinned in `cli/.python-version` (3.13).
