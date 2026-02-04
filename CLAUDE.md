# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

nao Chat is a monorepo chat interface for nao analytics consisting of:

- **Frontend**: React + TypeScript (Vite, TanStack Router, Tailwind CSS, shadcn/ui)
- **Backend**: Bun + TypeScript (Fastify, tRPC, Drizzle ORM)
- **CLI**: Python package (cyclopts) that bundles the server binary and publishes to PyPI as `nao-core`

## Common Commands

### Development

```bash
npm run dev                    # Start backend + frontend in dev mode
npm run dev:backend           # Backend only (Bun watch on :5005)
npm run dev:frontend          # Frontend only (Vite on :3000)
```

### Linting & Formatting

```bash
npm run lint                  # ESLint both apps
npm run lint:fix              # Fix lint issues
npm run format                # Format with Prettier
npm run format:check          # Check formatting
```

### Database (Drizzle ORM)

```bash
npm run pg:start              # Start PostgreSQL via docker-compose
npm run pg:stop               # Stop PostgreSQL
npm run -w @nao/backend db:generate  # Generate migrations
npm run -w @nao/backend db:migrate   # Apply migrations
npm run -w @nao/backend db:studio    # Open Drizzle Studio GUI
```

### Testing

```bash
npm run -w @nao/backend test       # Backend tests (Vitest)
npm run -w @nao/frontend test      # Frontend tests (Vitest)
```

### Building & Publishing

```bash
cd cli && python build.py     # Build frontend + backend binary + Python wheel
python build.py --bump minor  # Build with version bump
uv publish dist/*             # Publish to PyPI
```

### Python CLI Development

```bash
cd cli
pip install -e .              # Install CLI in editable mode
make lint                     # Run ruff linting
make lint-fix                 # Fix ruff issues
```

## Architecture

```
User runs: nao chat (Python CLI)
    ↓ spawns
nao-chat-server (Bun-compiled binary from apps/backend)
    ↓ serves
Backend API (Fastify :5005) + Frontend Static Files
    ↓ opens browser
http://localhost:5005
```

### Backend (`apps/backend/`)

- **Entry**: `src/app.ts` - Fastify setup with tRPC & routes
- **API**: tRPC procedures in `src/trpc/` (type-safe, shared with frontend)
- **Database**: Drizzle ORM, schema in `src/db/sqliteSchema.ts` (SQLite default, PostgreSQL optional)
- **AI Tools**: Agent tools in `src/agents/tools/` - file operations, code search, SQL execution

### Frontend (`apps/frontend/`)

- **Entry**: `src/main.tsx` - React + TanStack Router + tRPC client setup
- **Routes**: File-based routing in `src/routes/`
- **Components**: React components in `src/components/`, UI primitives from shadcn in `src/components/ui/`
- **State**: TanStack Query + tRPC for data fetching

### CLI (`cli/`)

- **Entry**: `nao_core/main.py` - cyclopts CLI app
- **Commands**: `commands/chat.py` (spawns server), `commands/init.py` (project setup)
- **Build**: `build.py` orchestrates frontend build → backend binary → Python wheel

## Key Technologies

| Component | Stack                                                              |
| --------- | ------------------------------------------------------------------ |
| Backend   | Fastify 5, tRPC 11, Drizzle ORM, Vercel AI SDK, better-auth        |
| Frontend  | React 19, Vite 7, TanStack Router/Query, Tailwind CSS 4, shadcn/ui |
| CLI       | Python 3.11+, cyclopts, pydantic, uv package manager               |
| Runtime   | Bun (development & compilation), Node.js 20+ (production)          |

## Environment Variables

Copy `.env.example` to `.env`:

```bash
DB_URI=sqlite:./db.sqlite     # or postgres://user:pass@host:5432/db
BETTER_AUTH_SECRET=           # openssl rand -base64 32
OPENAI_API_KEY=sk-...         # Required for AI features
```

## Adding Features

- **Database table**: Edit `apps/backend/src/db/sqliteSchema.ts`, run `db:generate` then `db:migrate`
- **tRPC procedure**: Add to `apps/backend/src/trpc/chatRoutes.ts` (auto-exported to frontend)
- **Agent tool**: Implement in `apps/backend/src/agents/tools/`, register in `tools.ts`
- **Frontend route**: Create `.tsx` file in `apps/frontend/src/routes/` (file-based routing)
