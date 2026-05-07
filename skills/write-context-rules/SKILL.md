---
name: write-context-rules
description: Create or extend a nao project's RULES.md. Owns the RULES.md template. Use when the user wants to generate the initial RULES.md from synced metadata (called by setup-context), or improve their existing RULES.md. Do not use for first-time scope setup (use setup-context) or for diagnosing existing problems (use audit-context).
---

# write-context-rules

`RULES.md` is loaded with **every** message to the nao agent — keep it lean. Two purposes only:

1. **Orchestrator** — point the agent to the right context fast (which metric → which table, which topic → which file, which question type → which skill).
2. **Broad rules** — how to query and how to answer.

Anything else (per-table schema, full metric semantics, domain-specific rules) belongs in a referenced file: `databases/<table>.md`, `semantics/<metric>.yaml`, or a domain `.md`. Reference: [docs.getnao.io/nao-agent/context-builder/rules-context](https://docs.getnao.io/nao-agent/context-builder/rules-context).

## Standard sections (see `templates/RULES.md`)

1. `## Business overview` — Product + Business model.
2. `## Data architecture` — Warehouse, data stack, layers, sources.
3. `## Core data models` — `### Most Used Tables` (one-line pointers) + `### Tables detail` (Purpose / Granularity / Key Columns ≤10 / Use For).
4. `## Key Metrics Reference` — grouped by category; `**metric** → table, column, formula`.
5. `## Date filtering` — three example formulas (last X weeks / last X days / current month). Don't enumerate every period.
6. `## Analysis Process` — 5 subsections: Understand → Select Table → Write Query → Validate → Context.

## Flow

**Generate section by section.** Write each section to `RULES.md`, show the user, then move on. Don't read everything and write everything in one batch — the user needs to see progress and catch wrong inferences early.

**If `RULES.md` already has content,** run the audit-and-fill flow at the bottom instead.

### Step 1 — `## Business overview`

Sources: web search for the company name/domain (from `nao_config.yaml`), then `databases/` and `repos/<dbt>/`. Output two paragraphs: Product (what the company does) + Business model (revenue + customer journey).

### Step 2 — `## Data architecture`

From `databases/` and `repos/<dbt>/`: Warehouse type/project/dataset, Data stack (e.g. `dlt, dbt, no semantic layer`), Data layers (e.g. `bronze / silver / gold`), Data sources (numbered list with prefix + one-line description).

### Step 3 — `## Core data models`

**`### Most Used Tables`** — one line per in-scope table:

```
- `dim_users` — user dimension. See `databases/.../table=dim_users/`.
```

**`### Tables detail`** — per-table block: Purpose, Granularity, Key Columns (cap at 10), Use For. Per-table detail beyond top 10 columns lives in `databases/`, not here.

### Step 4 — `## Key Metrics Reference`

Group by category (Revenue / Activity / Conversion). Format:

```
### Revenue
- **MRR** → `fct_stripe_mrr.mrr_amount`, `SUM(mrr_amount) WHERE status='active'`
```

If a semantic layer is configured (`add-semantic-layer`), route through it: `**ARR** → query via dbt MCP query_metric (semantic layer)`.

### Step 5 — `## Date filtering` (placeholder until Step 7)

Leave a `> TODO: filled in via the user-validation step below.` Filled in Step 7.

### Step 6 — `## Analysis Process`

Use the template's 5 subsections verbatim. The project-specific bit is subsection 2 (Select Right Tables): map each major question category to its starting table, derived from Steps 3-4.

### Step 7 — Validate metrics with the user

For each metric in `## Key Metrics Reference`, ask the user to confirm or correct the source-of-truth pointer. Update in place.

### Step 8 — Date filtering, with the user

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

1. Read it. Compare against the six standard sections. Produce a one-line gap report (present / missing / thin per section).
2. Ask the user which sections to fill.
3. Run only the relevant generation steps above. Show diffs before saving.

For deeper diagnostics (MECE, schema drift, test failure root causes), route to `audit-context`.

## Guardrails

- **Section by section, not all-at-once.** Show progress, let the user course-correct.
- **Show diffs, don't auto-overwrite.**
- **Don't bloat `RULES.md`.** Per-table detail in `databases/<table>.md`.
- **Don't invent metric sources.** Unclear → list for user validation in Step 7.
- **`## Date filtering` keeps three examples max.**

## Templates

- `templates/RULES.md` — six-section scaffold. This skill is the only one that writes to `RULES.md`.
