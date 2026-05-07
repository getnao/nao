---
name: add-semantic-layer
description: Wire a semantic layer into a nao agent so that metric queries are routed through a single source of truth. Supports dbt MetricFlow (dbt Cloud with Semantic Layer), Snowflake (views or semantic views via MCP), an in-house nao YAML semantic layer, or other tools (via MCP discovery). Installs the right MCP server, updates RULES.md to route metric queries through the semantic layer, and (for the nao YAML option) generates starter metric files. Use after a first round of tests has shown the agent struggling with metric reliability. Do not use for raw rule writing (write-context-rules) or first-time setup (setup-context).
---

# add-semantic-layer

Wire a semantic layer in so it becomes the canonical source of truth for metrics. The agent queries it instead of computing metrics from raw tables.

## When to add — and when not to

**Only add a semantic layer after `nao test` shows the agent struggling with metric reliability.** Not before.

- Increases reliability and stability (one definition per metric).
- Reduces the scope of answerable questions (anything outside the layer is harder, sometimes impossible).

If failures are concentrated on schema gaps or date logic, a semantic layer doesn't help — fix `RULES.md` first.

**Semantic layer vs metric store:** a semantic layer is a file (md/yaml) the agent reads to write its own SQL. A metric store exposes metrics through an API the agent calls (`query_metric(...)`); the framework converts to SQL. dbt MetricFlow Cloud is a metric store. Snowflake views and nao YAML are semantic layers. Bigger reliability gain with a metric store, bigger scope reduction too.

## Step 1 — Pick the tool

| Option                         | Type           | When                                                       |
| ------------------------------ | -------------- | ---------------------------------------------------------- |
| **dbt MetricFlow**             | Metric store   | Already running dbt Cloud with the Semantic Layer enabled. |
| **Snowflake views / semantic** | Semantic layer | Snowflake; using curated views or native semantic views.   |
| **nao semantic files**         | Semantic layer | No existing layer. Want a lightweight in-repo YAML.        |
| **Other**                      | Varies         | Looker/LookML, Cube, AtScale, etc.                         |

## Path A — dbt MetricFlow (dbt Cloud with Semantic Layer)

Add to `.claude/mcp.json`:

```json
{
	"mcpServers": {
		"dbt-mcp": {
			"command": "uvx",
			"args": ["dbt-mcp"],
			"env": {
				"DBT_HOST": "us1.dbt.com",
				"MULTICELL_ACCOUNT_PREFIX": "your_prefix",
				"DBT_TOKEN": "${DBT_TOKEN}",
				"DBT_PROD_ENV_ID": "your_env_id",
				"DISABLE_SEMANTIC_LAYER": "false",
				"DISABLE_DISCOVERY": "true",
				"DISABLE_SQL": "true",
				"DISABLE_ADMIN_API": "true",
				"DISABLE_REMOTE": "false"
			}
		}
	}
}
```

Substitute `MULTICELL_ACCOUNT_PREFIX`, `DBT_PROD_ENV_ID`, `DBT_HOST` from the user's dbt Cloud account. Set `DBT_TOKEN` in their shell, **not** in the file. Restart the session and verify the MCP connects (`list_metrics`).

> dbt Core (local-only) is not supported here — no metric-store API to route through.

Hand off to `write-context-rules`: in `## Key Metrics Reference`, route each MetricFlow metric through `query_metric` (e.g. `MRR → query via dbt MCP query_metric (semantic layer)`). In `## Analysis Process`, instruct the agent to use semantic-layer tools for known metrics instead of raw tables.

## Path B — Snowflake views / semantic views

```json
{
	"mcpServers": {
		"snowflake": {
			"command": "uvx",
			"args": ["mcp-server-snowflake"],
			"env": {
				"SNOWFLAKE_ACCOUNT": "your_account",
				"SNOWFLAKE_USER": "your_user",
				"SNOWFLAKE_PASSWORD": "${SNOWFLAKE_PASSWORD}",
				"SNOWFLAKE_WAREHOUSE": "your_warehouse",
				"SNOWFLAKE_DATABASE": "your_database",
				"SNOWFLAKE_SCHEMA": "your_schema",
				"SNOWFLAKE_ROLE": "your_role"
			}
		}
	}
}
```

For native semantic views (Cortex Analyst), use the Cortex MCP variant with `SEMANTIC_VIEW` set. Verify package + env-var names against the latest docs — auth options (key pair / OAuth / password) vary.

Identify the semantic surface (curated views like `analytics.metrics.*` or native semantic views). Hand off to `write-context-rules`: in `## Key Metrics Reference`, route each metric to its view, never the underlying tables.

## Path C — Other (no obvious MCP)

Search the MCP registry, the tool's docs, and the user's installed MCPs. If a fit exists, configure it following the pattern from paths A-B. If not: fall back to **Path D** (nao semantic files) or build a thin MCP wrapper.

## Path D — nao semantic files

For users with no existing semantic layer. **One file: `semantics/semantic.yaml`** holding all dimensions and metrics together. Use `templates/semantic.yaml`.

Walk through dimensions first (slice axes: date, plan, country — capture `name`, `type`, `description`, and allowed `values` for categoricals), then top metrics (capture `name`, `definition`, source `table` + `column` + `aggregation`, `grain`, `dimensions`, `filters`).

Hand off to `write-context-rules`: in `## Key Metrics Reference`, point every metric at `semantics/semantic.yaml`.

## Validate

1. Confirm every metric the user cares about now has a routing rule in `RULES.md`.
2. `nao chat` one of their top questions; confirm the agent uses the semantic layer.
3. `nao test` and **compare to the pre-semantic-layer baseline pass rate**. Reliability is the only reason to do this — measure it.

## Recommend next step

- No tests yet → `create-context-tests`.
- Reliability dropped → `audit-context`.
- Otherwise → `write-context-rules` to refine other sections.

## Guardrails

- **Only after tests show metric failures.** Cite them when the user asks "should we add one?"
- **One semantic layer at a time.** Two competing layers create MECE violations.
- **Don't write `RULES.md` directly.** Hand off to `write-context-rules`.
- **Don't store credentials in `.claude/mcp.json`.** Use `${ENV_VAR}`. Add the file to `.gitignore` if anything sensitive lands there.
- **Don't invent metrics** for Path D. Only encode what the user defines.

## Templates

- `templates/semantic.yaml` — single-file schema for Path D.
