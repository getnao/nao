# AGENTS.md

## Cursor Cloud specific instructions

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
- **Frontend tests**: `npm run -w @nao/frontend test` (vitest — currently no test files)
- **Pre-commit hook** (`.husky/pre-commit`): runs `npm run lint`, `npm run format:check`, `npm run db:check-migrations -w @nao/backend`, and `npm run cli:check`

### Gotchas

- `mysqlclient` Python package (pulled by `nao-core[all]`) requires `libmysqlclient-dev` system package to build. The VM snapshot has this pre-installed.
- The `npm run dev` combined command uses `npm-run-all -lp` — if any sub-process exits non-zero the entire group stops. Start services individually to isolate failures.
- Backend uses `bun` as runtime (not Node); make sure `bun` is installed globally (`npm install -g bun`).
- Node.js version is pinned in `.nvmrc` (v22.14.0). Python version is pinned in `cli/.python-version` (3.13).
