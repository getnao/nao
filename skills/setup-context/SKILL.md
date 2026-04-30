---
name: setup-context
description: Bootstrap a nao agent for a project — gather warehouse + scope + extra-context info in one round, look up the warehouse-specific config from nao docs, write nao_config.yaml, run nao init + nao sync, set up the LLM key, and generate the first RULES.md. Use when the user has just decided to use nao on a new project. Only for first-time setup; for editing rules, generating tests, or reviewing an existing context, use write-context-rules / create-context-tests / audit-context.
---

# setup-context

Take the user from `pip install nao-core` to a synced project with a starter `RULES.md`.

**Be brief.** One batch of questions, then act. Don't ping-pong.

**Scope ceiling: ≤100 tables.** Above that, sync gets slow and per-table context budget gets thin. 20 is a great target.

## Step 1 — Ask everything in one round

Send a single message asking for:

1. **Warehouse + auth** — type (BigQuery / Snowflake / Postgres / Redshift / DuckDB / Databricks / Athena / ClickHouse / Fabric / MSSQL / MySQL / Trino), and the auth credentials they have on hand. Tell them you'll fetch the exact field names from the nao docs once they pick a type.
2. **Scope** — which tables. Two valid shapes:
    - **Broad** — gold/marts across multiple domains (exec / cross-functional agents).
    - **Deep** — silver + gold for one domain (team-specific agents).
3. **Extra context** — dbt / ETL / BI repos, Notion, internal docs. Ask for **the SSH git URL** of each repo (e.g. `git@github.com:org/repo.git`) — sync clones them. No local paths.
4. **LLM** — provider + model. Key comes later (Step 5).

## Step 2 — Look up warehouse fields, write `nao_config.yaml`, run `nao init`

1. **Fetch the warehouse-specific config** from [docs.getnao.io/nao-agent/context-builder/databases](https://docs.getnao.io/nao-agent/context-builder/databases). Each warehouse has its own required and optional fields (e.g. BigQuery needs `project_id` + `dataset_id` (optional); Snowflake needs `account_id` + `warehouse` + `schema_name` (optional); Postgres needs `host` + `port` + `database` + `schema_name` (optional). Ask the user for any required field you don't already have.

2. **Write `nao_config.yaml`** from the answers (skeleton in appendix below).

3. **Run `nao init`** — it detects the existing yaml and offers to update; confirm. Folder scaffold gets created. Say "no" to optional providers (skills / MCPs / Notion / Slack); edit the yaml directly afterwards if needed.

4. **Print a summary of `nao_config.yaml` to the user** before going further. Format example:
    ```
    nao_config.yaml summary
      • project: <name>
      • warehouse: BigQuery (project=<id>, dataset=<id>, auth=service-account)
      • scope: include=["analytics.fct_*", "analytics.dim_*"], exclude=[]
      • templates: [columns, preview, description]
      • repos: company-dbt (git@github.com:org/company-dbt.git)
      • llm: anthropic / claude-sonnet-4-7 (key via ${ANTHROPIC_API_KEY})
    ```
    Ask the user to confirm before continuing. This is the last cheap chance to catch a wrong project, a misspelled dataset, or a missing repo.

### Database `templates` field

Per database in the yaml, set:

```yaml
templates: [columns, preview, description]
```

That's the set this skill ships. Other values are valid per-warehouse (`how_to_use`, `profiling`, `ai_summary`, and `indexes` for ClickHouse) — see the docs link above — but stick to `[columns, preview, description]` unless the user specifically asks otherwise.

**Don't use `accessors` — deprecated** (renamed to `templates`).

`nao init` creates: `nao_config.yaml`, empty `RULES.md`, `.naoignore`, and folders `databases/`, `repos/`, `docs/`, `semantics/`, `queries/`, `tests/`, `agent/{tools,mcps,skills}/`.

## Step 3 — `nao sync`

After the user confirms the summary in Step 2:

```bash
cd <project>   # where nao_config.yaml lives — every nao command runs from here
nao sync
```

Common failures: auth (fix yaml), tables not found (check schema casing), permission denied (grant read access), repo missing (fix `repos:` block, confirm SSH key). Don't move on until sync is clean.

## Step 4 — Generate `RULES.md` (no confirmation)

Hand off directly to `write-context-rules`. Don't ask.

## Step 5 — Wire up the LLM key

The key lives in `nao_config.yaml`. Two safe options:

- **Preferred:** env-var ref. Write `api_key: ${ANTHROPIC_API_KEY}`; tell the user to export the key in their shell.
- **If they insist on a literal:** tell them to edit the yaml themselves and add it to `.gitignore`. **Never** ask them to paste a key into chat.

Then `nao debug` to confirm.

### Known issue — `AI_APICallError: Not Found`

If `nao chat` / `nao debug` / `nao test` fails with that error and the URL is `https://api.anthropic.com/messages` (no `/v1/`), the parent agentic CLI (Claude Code, Cursor, Codex) is leaking `ANTHROPIC_BASE_URL` into the child env. Fix:

```bash
unset ANTHROPIC_BASE_URL ANTHROPIC_API_KEY
nao chat   # or debug / test
```

Regular human terminals aren't affected.

## Step 6 — Recommend next steps

1. Smoke test: `nao chat`, ask 3-5 real questions.
2. Review `RULES.md` for wrong inferences.
3. Pick a next skill: `write-context-rules` (refine), `create-context-tests` (benchmark), `audit-context` (anytime), `add-semantic-layer` (only after tests reveal metric-reliability gaps).

## Guardrails

- **`cd` into the project directory before any `nao` command.**
- **Cap at ~100 tables.**
- **One batch of questions.** Look up warehouse-specific fields from the docs, don't keep pinging the user.
- **Run `nao init` non-interactively** with the yaml pre-written.
- **Use `templates: [columns, preview, description]`.** Don't use `accessors`.
- **Repos: SSH git URLs only.** No local paths in the `repos:` block.
- **Print the `nao_config.yaml` summary** and get user confirmation before `nao sync`.
- **Never have the user paste their LLM key into chat.**
- **Don't ask before invoking `write-context-rules`** — just hand off.

## Appendix — `nao_config.yaml` skeleton (BigQuery example)

Use this shape and adapt the `databases:` block per warehouse — see [docs.getnao.io/nao-agent/context-builder/databases](https://docs.getnao.io/nao-agent/context-builder/databases) for the exact required/optional fields for Snowflake, Postgres, Redshift, Databricks, Athena, ClickHouse, Fabric, MSSQL, MySQL, Trino.

```yaml
project_name: <project>

databases:
    - type: bigquery
      name: <connection-name>
      project_id: <gcp-project-id>
      dataset_id: <dataset>
      credentials_path: /path/to/service-account.json # or `sso: true`
      include: ['<dataset_pattern>.<table_pattern>'] # e.g. "analytics.fct_*" - use '*' as multiple patterns
      exclude: ['<pattern>']
      templates: [columns, preview, description]

llm:
    provider: anthropic # openai | bedrock | azure | gemini | mistral | ollama
    api_key: ${ANTHROPIC_API_KEY}

repos:
    - name: <repo-name>
      url: git@github.com:<org>/<repo>.git # SSH only
```
