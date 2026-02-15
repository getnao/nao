# 🏭 Agent Dispatch Protocol

You are orchestrating the autonomous development team for **nao**.

**Repo root:** This file lives at `agents/DISPATCH.md` in the nao monorepo.

---

## Heartbeat Cycle (execute in order)

### Phase 1: Cycle Start

```bash
npx @ada-ai/cli dispatch start
```

This validates rotation, displays your role, and creates a dispatch lock.

### Phase 2: Context Load

After starting, load your context:

```bash
# Check rotation state and recent history
npx @ada-ai/cli dispatch status --verbose

# View recent memory entries
npx @ada-ai/cli memory list
```

Also read:

- `agents/roster.json` → rotation order and roles
- `agents/rules/RULES.md` → mandatory rules
- `agents/playbooks/<your-role>.md` → your playbook

### Phase 3: Situational Awareness

```bash
# Check open issues
gh issue list --state open --limit 50

# Check open PRs
gh pr list --limit 30
```

Cross-reference with memory bank:

- What's changed since last cycle?
- What's the highest-impact action for your role?
- Are there blockers or dependencies?

### Phase 4: Execute

1. Pick **ONE** action from your role's playbook
2. Execute it via GitHub (create issue, write code + PR, add docs, comment)
3. All work branches from `main`, PRs target `main`

### Phase 5: Memory Update

Update `agents/memory/bank.md`:

- `Current Status` → what changed
- `Role State` → your role's section
- `Active Threads` → if dependencies changed
- `Lessons Learned` → if something noteworthy happened

### Phase 6: Cycle Complete

```bash
npx @ada-ai/cli dispatch complete --action "Brief description of what you did"
```

This updates rotation, commits all changes, and pushes.

---

## Monorepo Context

This is a monorepo with:

- `apps/backend/` — API server (Fastify, tRPC, Drizzle ORM, Vercel AI SDK)
- `apps/frontend/` — Chat UI (React, TanStack Router/Query, Shadcn, Tailwind)
- `apps/shared/` — Shared utilities
- `cli/` — Python CLI (`nao-core` package)

## Rotation

Order: defined in `roster.json → rotation_order`

Check your position:

```bash
npx @ada-ai/cli dispatch status
```

## Key Rules

- **Commits:** Conventional commits (`<type>(<scope>): <description>`)
- **Branches:** `feat/<name>`, `fix/<name>`, `docs/<name>`
- **PRs:** All target `main`
- **Memory:** Read before acting, update after acting

---

## State Files

```
agents/
├── DISPATCH.md              ← You are here
├── roster.json              ← Team composition + rotation order
├── state/
│   └── rotation.json        ← Current rotation state
├── memory/
│   └── bank.md              ← Shared memory
├── rules/
│   └── RULES.md             ← Master rules
└── playbooks/
    ├── engineering.md
    ├── qa.md
    ├── docs.md
    └── ops.md
```
