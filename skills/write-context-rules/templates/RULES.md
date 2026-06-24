# RULES.md

> Included with every message sent to the nao agent. Keep it lean — it points to context, it doesn't copy it. Per-table detail belongs in `databases/<table>/`, metrics in the semantic layer, domain rules in `docs/`.

## Business overview

**Product**: TODO: one-paragraph description of what the company does, and key product features

**Business model**: TODO: one-paragraph description of revenue structure and customer journey

## Data architecture

**Warehouse:** TODO. (ex: BigQuery (`nao-production`))
**Data stack:** TODO. (ex: dlt, dbt, dbt semantic layer)
**Data layers:** TODO: describe data layers (ex bronze / silver / gold)

**Data sources:**

1. **App Backend** (`stg_app_backend__*`): data from our app backend with users, events
   TODO: one line per source

## Context map

> Where context lives. The agent reads from these before answering — this section routes it there.

**Per-table context** — each table folder under `databases/.../table=<name>/` contains:

- `columns.md` — column names, types, descriptions
- `profiling.md` — distinct counts, min/max, and **`top_values`** (the actual values present in each column). **Read before filtering on any column value.**
- TODO: list any other synced templates (`description.md`, `how_to_use.md`, `ai_summary.md`, `preview.md`) and one line each.

**Repos:**

- TODO: `repos/<dbt>/` — dbt project. Column docs: `models/<schema>.yml`. Domain decisions: `models/**/*.md`. Semantic layer (metrics): `models/<...>_semantic_layer.yml` (omit if none).

**Docs:**

- TODO: `docs/<file>.md` — one line on contents + when to read it (ex: "CRM funnel statuses and opportunity stages. Read before any sales question.").

**Semantic layer:** TODO: name it and where it lives if one exists; "metrics are defined here — query through it." Otherwise: "none — metric definitions are in `## Key Metrics Reference` below."

## Core data models

### Most Used Tables

- `<table>` — TODO: one-line purpose. See `databases/type=*/database=*/schema=*/table=<table>/`.

### Tables detail

> ONLY include this section if no richer table docs exist elsewhere (no `how_to_use.md`/`ai_summary.md` per table, no dbt `schema.yml` column docs). If they exist, delete this section — the Most Used pointers + Context map already route there. Otherwise, reserve it for cross-table pitfalls not documented anywhere else.

#### `table`

**Purpose**: TODO: description
**Granularity**: TODO: One row per **granularity**.
**Key Columns**:

- `col`: TODO: col desc and/or possible values — only the top ≤10 most important cols

**Use For**: TODO: use case where table is relevant (which topic, metric)

## Key Metrics Reference

> ONLY include this section if NO semantic layer / metric docs exist elsewhere. If they do, DELETE the category list below and keep only a routing pointer, e.g.:
> "Metrics are defined in `repos/dbt/models/<...>_semantic_layer.yml`. Use those definitions; query through the semantic layer, don't recompute from raw tables."

**For each key metric, always use the following source-of-truth definition:**

### Metric category 1 (ex: Revenue)

- **metric name** → `table`, column and formula

## Date filtering

> Three example formulas. The agent extrapolates other periods from these patterns.
> Convention: TODO (e.g. "Week starts Monday; 'last X weeks' excludes the current incomplete week.")

### Last X weeks

```sql
TODO
```

### Last X days

```sql
TODO
```

### Current month

```sql
TODO
```

## Analysis Process

> Adapt steps 2-3 to what exists in this repo (see Context map). Steps 1, 4-7 always apply.

### 1. Understand the question

- Identify the metric or insight requested, the time period, and any segments/filters.

### 2. Resolve the metric definition (before picking a table)

- If the metric is in the **semantic layer** → use that definition (and query through the layer).
- Else if a **doc** defines it (`docs/`, domain `*.md` in repos) → use that.
- Else → state the definition you'll use and **validate it with the user** before querying.

### 3. Read relevant docs

- For any topic covered by a file in `docs/` or a repo domain doc, read it before selecting a table.

### 4. Select the right table(s)

- **Question category** → Start with `table`. TODO: map each major category to its starting table.

### 5. Check existing values before filtering (ALWAYS)

- Before filtering on any column value (status, category, type, country, …), read that table's `profiling.md` and filter on the **exact values present** (`top_values` / distinct values). Never guess an enum or status string.

### 6. Write efficient queries

- Fully-qualified table names; filter early (WHERE on dates, user_id); aggregate before joining; CTEs for complex queries.

### 7. Validate results

- Check NULLs in key fields; verify counts make sense (e.g. user counts shouldn't exceed total users).

### 8. Provide context

- Explain what the numbers mean for the business; highlight trends, anomalies, notable patterns.
