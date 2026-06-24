# nao skills

Skills published by nao for any agent that supports them — Claude Code, Codex, Claude Agent SDK, and others. Each skill is a standard `SKILL.md` (YAML frontmatter + markdown) and works in any harness that loads skills.

Names are short verb-noun phrases (Anthropic convention: `analyze`, `write-query`, `build-dashboard`).

## Available skills

The skills below cover the full context-engineering lifecycle for a nao agent. Each is independently invokable.

| Skill                                          | Purpose                                                                                                                                                                                                                                  | When to use                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [setup-context](./setup-context)               | Scope the project, configure the warehouse, run `nao init` + `nao sync`, generate the first `RULES.md`.                                                                                                                                  | First-time install of nao on a project.                                                               |
| [write-context-rules](./write-context-rules)   | Owns `RULES.md`. Inventories what context already exists (per-table docs, dbt schema/semantic-layer files, `docs/`), then generates only the sections that aren't already covered elsewhere (business overview, data architecture, context map, core data models, key metrics reference, date filtering, analysis process) — pointing to existing context instead of duplicating it; or audits an existing `RULES.md` and fills/slims sections. | Any change to `RULES.md`.                                                                             |
| [create-context-tests](./create-context-tests) | Generate or extend a test suite (one test per key metric), then run it via `nao test`.                                                                                                                                                   | Establishing or extending the reliability benchmark.                                                  |
| [audit-context](./audit-context)               | Diagnose gaps, MECE violations, test failure root causes, modularization needs.                                                                                                                                                          | At any stage — right after setup, mid-build, before a release, or whenever the agent gets surprising. |
| [add-semantic-layer](./add-semantic-layer)     | Wire in dbt MetricFlow, Snowflake views, an in-house YAML semantic layer, or another tool via MCP.                                                                                                                                       | After tests show the agent struggling with metric reliability — not before.                           |
| [deploy-context](./deploy-context)             | Set up `nao deploy` from GitHub Actions so every push to `main` ships the context folder to a remote nao instance, with secrets handled via GitHub Secrets.                                                                              | After the local project is stable in Git and the team's deployed instance should track `main`.        |

**Typical lifecycle:** `setup-context` → `write-context-rules` → `create-context-tests` → `audit-context` (anytime) → `add-semantic-layer` (only after test failures show metric-reliability gaps) → back to `write-context-rules` to refine → `deploy-context` once the project is committed to Git and ready to ship to the team's deployed instance.

## Distribution

These skills are published two ways:

1. **`nao skills` CLI command** — installs into the user's project at `.claude/skills/<name>/`. Pulled from the published registry.
2. **Vercel skills library** — published via a GitHub Action and served as a static site (`registry.json` + per-skill tarballs).

## Source material

Built from:

- [nao Context Engineering playbook](https://docs.getnao.io/nao-agent/context-engineering/playbook)
- [nao Context Engineering principles](https://docs.getnao.io/nao-agent/context-engineering/principles)
- [nao docs — RULES.md](https://docs.getnao.io/nao-agent/context-builder/rules-context)
- [nao docs — evaluation](https://docs.getnao.io/nao-agent/context-engineering/evaluation)
