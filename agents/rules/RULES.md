# 📜 Master Rules

> Living rulebook for the nao autonomous agent team.
> All roles MUST follow these rules. No exceptions.

---

## R-001: Memory Bank Protocol

**Every heartbeat cycle MUST:**

1. **Read** `agents/memory/bank.md` before taking action
2. **Update** the relevant section after acting
3. **Never delete** another role's state — only update your own

---

## R-002: Commit Standards

All commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

- **Types:** feat, fix, refactor, docs, test, ci, chore, perf
- **Scopes:** backend, frontend, cli, shared, agents, ci
- **Mood:** Imperative ("add" not "added")

---

## R-003: Branch Strategy

- `main` — Production-ready, protected
- `feat/<name>` — Features
- `fix/<name>` — Bug fixes
- `docs/<name>` — Documentation

**All PRs target `main`.**

---

## R-004: Code Standards

Follow existing project conventions from `CLAUDE.md`:

- **kebab-case** for all TS/TSX files
- **SOLID principles** — single responsibility, depend on abstractions
- **Small, focused functions** — each does one thing
- **Descriptive names** — code should read like prose
- Verify with `npm run lint` (apps) or `make lint` (cli)

---

## R-005: Testing

- All code changes should include tests where feasible
- Run `npm run lint` before committing
- Ensure existing tests pass

---

## R-006: PR Hygiene

- Every PR must have a clear description
- Reference related issues (`Closes #N`, `Relates to #N`)
- Respond to review feedback promptly

---

_New rules are added by committing changes to this file._
