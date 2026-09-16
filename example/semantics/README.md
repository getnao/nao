# Semantic layer

Synced from the metricflow manifest at `./dbt/semantic_manifest.json` by `nao sync`. Do not edit generated files, they are rewritten on every sync.

- `metrics/<metric>.md` — one file per metric (14 metrics): definition, type and the dimensions it can be grouped or filtered by.
- `dimensions.md` — index of every dimension (6 dimensions).

Query metrics with the `execute_semantic_query` tool: nao compiles the governed definition to SQL with MetricFlow and runs it on the configured database.

## Query parameters

| Parameter | Meaning | Example |
| --- | --- | --- |
| `metrics` | Metric names to compute (required, one or more). | `["revenue", "orders"]` |
| `group_by` | Dimensions or entities to break down by, as `entity__dimension`. Time dimensions take a granularity suffix: `day`, `week`, `month`, `quarter`, `year`. `metric_time` is the metric's own time axis and works for every metric. | `["metric_time__month", "customer__region"]` |
| `where` | SQL filters, ANDed together. Wrap every model field in a template so MetricFlow resolves the joins: `Dimension('entity__dimension')`, `TimeDimension('metric_time', 'day')`, `Entity('entity')`, `Metric('metric', group_by=['entity'])`. Bare column names are not resolved and fail. | `["{{ Dimension('order__status') }} = 'completed'", "{{ TimeDimension('metric_time', 'day') }} >= '2024-01-01'"]` |
| `order_by` | Metrics or `group_by` items to sort by; prefix with `-` for descending. | `["-revenue", "metric_time__month"]` |
| `limit` | Maximum number of rows. | `10` |
| `start_time`, `end_time` | Inclusive ISO dates bounding `metric_time`. Simpler than a `where` for plain date ranges; combine with `where` for anything else. | `"2024-01-01"`, `"2024-12-31"` |

Filter on a metric to keep only entities above a threshold, e.g. customers who spent more than 100: `{"metrics": ["revenue"], "group_by": ["customer__name"], "where": ["{{ Metric('revenue', group_by=['customer']) }} > 100"]}`.

Only metrics are queryable: measures are building blocks and are exposed as metrics either explicitly or with `create_metric: true` in the semantic model.
