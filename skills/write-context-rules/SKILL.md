---
name: write-context-rules
description: Create or extend a nao project's RULES.md. Owns the RULES.md template. Use when the user wants to generate the initial RULES.md from synced metadata (called by setup-context), or improve their existing RULES.md. Do not use for first-time scope setup (use setup-context) or for diagnosing existing problems (use audit-context).
---

# write-context-rules

`RULES.md` is loaded with **every** message to the nao agent — keep it lean. Two purposes only:

1. **Orchestrator** — point the agent to the right context fast (which metric → which definition, which topic → which file, which question type → which skill).
2. **Broad rules** — how to query and how to answer.

Anything else (per-table schema, full metric semantics, domain-specific rules) belongs in a referenced file. **`RULES.md` should never duplicate context that already lives elsewhere in the repo** — it points to it. Reference: [docs.getnao.io/nao-agent/context-builder/rules-context](https://docs.getnao.io/nao-agent/context-builder/rules-context).

## What already exists in a context repo (read before writing)

`nao sync` populates these. The content of `RULES.md` depends on which are present, so **inventory them first** (Step 0):

| Location                                        | What's in it                                                                                                                                                                                               | Implication for `RULES.md`                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `databases/type=*/database=*/schema=*/table=*/` | Per-table files synced from the warehouse: `columns.md`, `description.md`, `preview.md`, and (if enabled in `nao_config.yaml` `templates:`) `how_to_use.md`, `ai_summary.md`, `profiling.md`               | If rich per-table docs exist here, **don't restate columns** in `RULES.md` — point to the folder.                                                                     |
| `repos/<name>/`                                 | Synced git repos (dbt, ETL, BI). A dbt repo has `models/**/schema.yml` (or `*.yml`) column docs, `*.md` model docs, and possibly a **semantic layer / MetricFlow** file (`semantic_models:` + `metrics:`). | Map the key files in the Context Map. If dbt schema docs cover columns, point there. If a semantic layer exists, **don't write a Key Metrics section** — route to it. |
| `docs/`                                         | Free-text business docs (Notion exports, CRM definitions, analytics decisions).                                                                                                                            | Note they exist, what's in each, and when to read them. If a doc defines a metric/segment, point to it instead of redefining.                                         |
| `semantics/`                                    | nao YAML semantic layer (from `add-semantic-layer`).                                                                                                                                                       | Same as a dbt semantic layer — route metrics to it, don't redefine.                                                                                                   |
| `profiling.md` (per table)                      | Distinct counts, min/max, and **`top_values` for categorical columns** — the actual values present in each column.                                                                                         | The agent must read it **before filtering on any column value** (Analysis Process).                                                                                   |

## Standard sections (see `templates/RULES.md`)

1. `## Business overview` — Product + Business model.
2. `## Data architecture` — Warehouse, data stack, layers, sources.
3. `## Context map` — **where everything lives**: per-table context files, key repo files, docs, semantic layer. The orchestrator's index.
4. `## Core data models` — `### Most Used Tables` (one-line pointers, always) + `### Tables detail` (**only if no richer table docs exist elsewhere** — see Step 4).
5. `## Key Metrics Reference` — **only if no semantic layer / metric docs exist elsewhere** (see Step 5). Otherwise a one-line routing pointer to it.
6. `## Date filtering` — three example formulas (last X weeks / last X days / current month). Don't enumerate every period.
7. `## Analysis Process` — adaptive: read semantic layer → read docs → select table → check `profiling.md` before filtering values → query → validate → context.

## Flow

**Generate section by section.** Write each section to `RULES.md`, show the user, then move on. Don't read everything and write everything in one batch — the user needs to see progress and catch wrong inferences early.

**If `RULES.md` already has content,** run the audit-and-fill flow at the bottom instead.

### Step 0 — Inventory the context

Before writing anything, survey the repo so the rest of the flow knows what to point to vs. what to write:

- `nao_config.yaml` — which `templates:` are synced per database (do `how_to_use` / `ai_summary` / `profiling` exist?), which `repos:` are wired.
- `databases/` — list tables and check how rich the per-table files are.
- `repos/<name>/` — for each repo, find: column docs (`**/schema.yml`, `**/*.yml` with `models:`), model/domain docs (`*.md`), and a **semantic layer** (grep for `semantic_models:` / `metrics:` / MetricFlow). Note the paths.
- `docs/` — list files and skim what each covers.
- `semantics/` — nao YAML semantic layer present?

Produce a one-line inventory and state the two decisions it drives: **(a) write `### Tables detail` or point to existing table docs? (b) write `## Key Metrics Reference` or route to an existing semantic layer / metric docs?**

### Step 1 — `## Business overview`

Sources: web search for the company name/domain (from `nao_config.yaml`), then `databases/` and `repos/<dbt>/`. Output two paragraphs: Product (what the company does) + Business model (revenue + customer journey).

### Step 2 — `## Data architecture`

From `databases/` and `repos/<dbt>/`: Warehouse type/project/dataset, Data stack (e.g. `dlt, dbt, dbt semantic layer`), Data layers (e.g. `bronze / silver / gold`), Data sources (numbered list with prefix + one-line description).

### Step 3 — `## Context map`

The orchestrator's index of where context lives. Built from Step 0. Cover:

- **Per-table context** — what each table folder under `databases/` contains (e.g. `columns.md`, `how_to_use.md`, `ai_summary.md`, `profiling.md`) and one line on what each is for.
- **Repos** — per repo, the key files and what they hold:
    ```
    - `repos/dbt/` — dbt project. Column docs: `models/silver.yml`. Domain decisions: `models/silver/*_ANALYTICS_DECISIONS.md`. Semantic layer (metrics): `models/silver_semantic_layer.yml`.
    ```
- **Docs** — per file in `docs/`, one line on contents + when to read it:
    ```
    - `docs/crm.md` — CRM funnel statuses, company tiering, opportunity-stage taxonomy. Read before any sales/pipeline question.
    ```
- **Semantic layer** — if one exists, name it and say "metrics are defined here; query through it."

### Step 4 — `## Core data models`

**`### Most Used Tables`** (always) — one line per in-scope table:

```
- `dim_users` — user dimension. See `databases/.../table=dim_users/`.
```

**`### Tables detail`** — **conditional.** Only write per-table blocks (Purpose / Granularity / Key Columns ≤10 / Use For) **when no richer table documentation exists elsewhere** (no `how_to_use.md`/`ai_summary.md` per table, no dbt `schema.yml` column docs). If those exist, **do not restate columns** — the Most Used pointer + Context map already route there. Reserve `### Tables detail` for the few cross-table nuances/pitfalls not captured anywhere else (e.g. "weekly table has no `n_active_users` column").

### Step 5 — `## Key Metrics Reference`

**Conditional.** First check the inventory:

- **A semantic layer or metric docs exist** (dbt `semantic_models:`/`metrics:`, `semantics/*.yaml`, or a doc that defines metrics) → **do not write metric formulas here.** Write a one-line routing pointer instead, and (for a metric store like MetricFlow) route through its tool:
    ```
    > Metrics are defined in `repos/dbt/models/silver_semantic_layer.yml`. Use those definitions; query via the semantic layer, don't recompute from raw tables.
    ```
- **No semantic layer anywhere** → write the section. Group by category (Revenue / Activity / Conversion):
    ```
    ### Revenue
    - **MRR** → `fct_stripe_mrr.mrr_amount`, `SUM(mrr_amount) WHERE status='active'`
    ```

If only _some_ metrics are covered by a semantic layer, route those and write formulas only for the gaps — note which is which.

### Step 6 — `## Date filtering` (placeholder until Step 9)

Leave a `> TODO: filled in via the user-validation step below.` Filled in Step 9.

### Step 7 — `## Analysis Process`

Use the template's adaptive process. It must branch on what the inventory found. The ordering is fixed:

1. **Understand the question** — metric, time period, segments/filters.
2. **Resolve the metric definition first** (before picking a table):
    - Semantic layer exists → use its definition.
    - Else a doc defines it → use that.
    - Else → state the definition you'll use and **validate it with the user** before querying.
3. **Read relevant docs** (`docs/`, domain `*.md` in repos) for any topic they cover, before selecting a table.
4. **Select the right table(s)** — map each major question category to its starting table.
5. **Before filtering on any column value, read that table's `profiling.md`** to use the exact values present (`top_values`, distinct values). Never guess an enum/status/category string. _(This rule is unconditional whenever `profiling` is in the synced templates.)_
6. **Write the query** — qualified names, filter early, CTEs.
7. **Validate** — NULLs, sane counts.
8. **Context** — what the numbers mean, trends, anomalies.

The project-specific bit is step 4 (table routing), derived from Steps 4-5 above.

### Step 8 — Validate metrics with the user

For metrics **not** covered by a semantic layer/docs, ask the user to confirm or correct the source-of-truth pointer. For metrics routed to a semantic layer, no validation needed — the layer is the source of truth.

### Step 9 — Date filtering, with the user

Two questions decide most of it:

1. **Week boundary:** does a week start **Sunday** (BigQuery `WEEK`) or **Monday** (`ISOWEEK`)? Applies to "last week", "last N weeks", week-over-week.
2. **Current period inclusion:** when the user says "last 8 weeks" / "last 30 days", **include** the current incomplete period or **exclude** it? Rolling-from-now vs. boundary-aligned.

Then: fiscal year start if non-calendar; anything else org-specific.

Write **three example formulas only** — Last X weeks, Last X days, Current month. The agent extrapolates other periods from these. Each block gets a one-line note above stating the convention used.

```sql
-- Last X weeks (Monday-start, excludes current incomplete week)
WHERE date >= DATE_TRUNC(CURRENT_DATE - INTERVAL (X * 7) DAY, ISOWEEK)
  AND date <  DATE_TRUNC(CURRENT_DATE, ISOWEEK)
```

## Audit-and-fill flow (when `RULES.md` is not empty)

1. Run Step 0 (inventory) first — then read the existing `RULES.md`.
2. Compare against the standard sections. Produce a one-line gap report (present / missing / thin per section), and flag **duplication**: per-table columns or metric formulas that restate `databases/`, dbt schema docs, `docs/`, or a semantic layer. Duplication is a finding, not just a gap — it's stale-prone bloat.
3. Ask the user which sections to fill or slim. Show diffs before saving.
4. Run only the relevant generation steps above.

For deeper diagnostics (MECE, schema drift, test failure root causes), route to `audit-context`.

## Guardrails

- **Inventory first (Step 0).** Don't write a section that duplicates context already in the repo.
- **Section by section, not all-at-once.** Show progress, let the user course-correct.
- **Show diffs, don't auto-overwrite.**
- **Don't bloat `RULES.md`.** Per-table detail in `databases/<table>/`; metrics in the semantic layer; domain rules in `docs/`. Point, don't copy.
- **`### Tables detail` only if no richer table docs exist elsewhere.**
- **`## Key Metrics Reference` only if no semantic layer / metric docs exist elsewhere.** Otherwise route.
- **Don't invent metric sources.** Unclear → list for user validation in Step 8.
- **Always check `profiling.md` before filtering on a column value** — bake this into the Analysis Process.
- **`## Date filtering` keeps three examples max.**

## Templates

- `templates/RULES.md` — section scaffold. This skill is the only one that writes to `RULES.md`.
