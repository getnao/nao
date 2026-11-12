## Project

nao is an open-source framework for building and deploying **analytics agents**. Users define a project context (databases, metadata, docs, tools) via the `nao-core` CLI, then deploy a chat UI where business users ask questions in natural language and get data insights back.

The CLI (`nao init`, `nao sync`, `nao chat`) scaffolds a project, syncs data sources, and launches the app. End users install the pip package or run the Docker image.

## Codebase

Monorepo with three workspaces:

- **`apps/backend`** — API server (Fastify, tRPC, Drizzle ORM, Vercel AI SDK)
- **`apps/frontend`** — Chat UI (React, TanStack Router/Query/Form, Shadcn, Tailwind)
- **`apps/shared`** — Shared utilities (minimal)
- **`cli/`** — Python CLI (`nao-core` package)

Code is organised in layers (e.g. routes, services, queries, utils, types, etc).

### File Naming & Organisation

- Use **kebab-case** for all TS/TSX files: `chat-input.tsx`, `agent.service.ts`
- Organise directories by **abstraction/role** (`routes/`, `services/`, `queries/`, `components/`, `hooks/`)
- Keep directory depth **shallow** — prefer flat structures over deep nesting

### Coding Standards

Write simple, clean, self-explanatory, easy to read and intelligent code.

- Follow **SOLID principles** — single responsibility, depend on abstractions
- Place **high-level functions first** in each file, then private/helper functions below
- Write **small, focused functions** — each does one thing; extract early rather than inline
- Use **descriptive names** — code should read like prose; avoid abbreviations
- **Minimize comments** — only comment complex or ambiguous logic with short JSDocs or python docstring; never describe function inputs/outputs.
- Important: don't use comments to describe the code inline.
- Avoid inline function declarations without braces

### Backend Migrations (`apps/backend/`)

The app supports both SQLite and PostgreSQL databases (`apps/backend/db/`). Migrations and schema changes must be handled for both.

These are useful scripts to run after changing the database schemas:

- `npm run db:generate <migration_name>` — generate a Drizzle migration file for schema changes. **This command may hang indefinitely when schema changes are ambiguous** (e.g. a column rename that Drizzle cannot resolve automatically). If it hangs, kill it and use `db:push` instead.
- `npm run db:push` — push schema changes directly to the database without generating a migration file. Use this as a fallback when `db:generate` hangs, or during local development when migration history does not matter.

### Settings Search Index (`apps/frontend/src/components/settings-search-index.ts`)

A static index used for fuzzy search in the settings sidebar. When you add, remove, or rename a settings page/section/toggle, update this file to keep the search index in sync. Each entry maps a searchable item (card title, toggle label) to its route path with optional keywords for better matching.

### Tests

Tests live in each workspace's `tests/` folder, never next to the source, in a layout that mirrors it:

- `apps/backend/tests/<layer>/` mirrors `src/<layer>/`: `src/services/billing-lifecycle.service.ts` is tested in `tests/services/billing-lifecycle.service.test.ts`.
- `apps/frontend/tests/` mirrors `src/` and imports through `@/`.
- `apps/shared/tests/` is flat, like `src/`.
- `cli/tests/nao_core/` mirrors the `nao_core` package, with one `test_<module>.py` per module.

Keep the suite from growing out of control:

- **One test file per source module.** Add cases to the existing file instead of creating a new one. Never name a test file after a feature, a bug or a PR.
- **Search before adding a test.** Don't add a test when an existing one already asserts the same behaviour on the same code path, and don't add a mocked test for what an integration test already covers.
- **Use tables for variations.** Inputs of one behaviour go in `it.each` or `pytest.mark.parametrize`, not in copied tests.
- **Every assertion must be able to fail.** Assert on what only the behaviour under test produces. For example, a chart's legend also prints the series names, so hide it before checking the axis labels.
- **Reuse fixtures.** Shared setup lives in `tests/helpers/` and, for the CLI, in `conftest.py` and `commands/sync/integration/base.py`. Look there first, and move setup there as soon as a second file needs it.
    - Backend: `in-memory-db` for the `db` mock (never a `db.sqlite` file), `trpc-caller`, `tool-context`, `temporary-folders`, `process-env-snapshot`, `storage-backend`, `logger-mock` and `fake-mcp-server`.
    - Frontend: `browser-stubs`, `query-client`, `deferred` and `dropdown-menu`.
- **Don't leak state between files.** Backend and frontend Vitest run with `isolate: false`, so test files share a worker. Restore env vars, timers and globals, close database handles, remove temporary folders, and clear any markup written to `document.body` outside `render`. `tests/setup/shared-worker.ts` resets the common cases; when a new kind of leak appears, fix it there.
- **Keep helpers fully typed.** The backend and shared `tsconfig` files only include `src/`, so lint does not type-check tests. Fixtures must still match the full types, such as a complete `ToolContext`.

Run them with `npm run test -w @nao/<backend|frontend|shared>` or `cd cli && uv run pytest`.

### Linting

- Always end by verifying your work with `npm run lint` for the `apps/` or `make lint` for the `cli/`
