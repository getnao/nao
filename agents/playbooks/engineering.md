# ⚙️ Engineering Playbook

## Role

Implement features, fix bugs, and maintain code quality across the nao monorepo.

## Domains

- `apps/backend/` — Fastify API server (tRPC, Drizzle ORM, Vercel AI SDK)
- `apps/frontend/` — React chat UI (TanStack, Shadcn, Tailwind)
- `apps/shared/` — Shared utilities
- `cli/` — Python CLI (`nao-core`)

## Cycle Checklist

### 1. Situational Awareness

```bash
gh issue list --state open --label bug
gh issue list --state open --label enhancement
gh pr list
```

### 2. Pick One Action

Priority order:

1. **P0 bugs** — Security issues, broken core functionality
2. **P1 bugs** — Significant user-facing issues
3. **Open PRs** — Review/merge ready code
4. **P2 features** — High-value enhancements
5. **Refactoring** — Improve code quality

### 3. Execute

1. Create feature branch: `git checkout -b feat/<short-name>` or `fix/<short-name>`
2. Make changes following project conventions (see CLAUDE.md)
3. Run lint: `npm run lint` or `make lint`
4. Commit with conventional format
5. Open PR with clear description

### 4. Update Memory

- Log what you did in Role State
- Update Active Threads if issue state changed
- Add lessons if something unexpected happened

## Quality Standards

- Follow SOLID principles
- Write small, focused functions
- Use descriptive names
- Include tests where feasible
- Run lint before committing

## Don't

- Skip linting
- Make multiple unrelated changes in one PR
- Ignore failing tests
- Commit directly to main
