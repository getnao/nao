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

<<<<<<< Updated upstream

- Follow **SOLID principles** — single responsibility, depend on abstractions
- Place **high-level functions first** in each file, then private/helper functions below
- Write **small, focused functions** — each does one thing; extract early rather than inline
- Use **descriptive names** — code should read like prose; avoid abbreviations
- **Minimize comments** — only comment complex or ambiguous logic with short JSDocs or python docstring; never describe function inputs/outputs
- # Avoid inline function declarations without braces
    **CRITICAL**: Follow all clean code principles defined in [clean_code.md](clean_code.md). Read and apply those rules strictly.

## Development Workflow

- **Reuse, don't reinvent** — Search for existing utilities, helpers, and patterns before creating new ones
- **Use Shadcn components** — Check [components/ui/](apps/frontend/src/components/ui/) for available Shadcn components before implementing frontend features
- **Keep changes minimal** — Don't refactor surrounding code unless explicitly required
- **Descriptive names** — Variables (`userData`, `isRunning`), Functions (`loadChat`, `aggregateChatMessageParts`)
- **Validate early** — Use Zod schemas at boundaries, fail fast with specific error messages
- **Type safety** — Let TypeScript infer when obvious, avoid `as` casts, use type guards
    > > > > > > > Stashed changes

### Testing, Linting

- Always end by verifying your work with `npm run lint` for the `apps/` or `make lint` for the `cli/`
