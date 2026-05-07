# RULES.md

> Included with every message sent to the nao agent. Keep it lean. Per-table detail belongs in `databases/<table>.md`, not here.

## Business overview

**Product**: TODO: one-paragraph description of what the company does, and key product features

**Business model**: TODO: one-paragraph description of revenue structure and customer journey

## Data architecture

**Warehouse:** TODO. (ex: BigQuery (`nao-production`))
**Data stack:** TODO. (ex: dlt, dbt, no semantic layer)
**Data layers:** TODO: describe data layers (ex bronze / silver / gold)

**Data sources:**

- TODO
  Ex:

1. **App Backend** (`stg_app_backend__*`): data from our app backend with users, events

## Core data models

### Most Used Tables

- `<table>` — TODO: one-line purpose. See `databases/type=*/database=*/schema=*/table=table/` folder.

### Tables detail

#### `table`

**Purpose**: TODO: description
**Granularity**: TODO: One row per **granularity**.
**Key Columns**:

- `col`: TODO: col desc and/or possible values - only for max top 10 most important cols of the table

**Use For**: TODO: use case where table can be relevant (which topic, metric)

## Key Metrics Reference

> Source-of-truth pointer per metric. Detailed semantics live in `semantics/<metric>.yaml` if a semantic layer is configured.

**For each key metric, always use the following source-of-truth table:**

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

### 1. Understand the Question

- Identify the metric or insight requested
- Determine the time period
- Identify user segments or filters needed

### 2. Select the Right Table(s)

- **Question category** → Start with `table`

### 3. Write Efficient Queries

- Filter early and often (WHERE clauses on dates, user_id, etc.)
- Aggregate before joining when possible
- Use CTEs for complex queries to improve readability

### 4. Validate Results

- Check for NULL values in key fields
- Verify counts make sense (e.g., user counts shouldn't exceed total users)

### 5. Provide Context

- Explain what the numbers mean for the business
- Highlight trends, anomalies, or notable patterns
