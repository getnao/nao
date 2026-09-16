# Semantic layer definitions

MetricFlow semantic models and metrics layered on the [jaffle shop](https://github.com/dbt-labs/jaffle_shop_duckdb) dbt project that builds `../jaffle_shop.duckdb`. This folder is not a dbt project: it holds only what the semantic layer adds.

- `models/orders.yml` — `orders` semantic model and the order metrics (`revenue`, `orders`, `average_order_value`, `completed_orders`, `completion_rate`, revenue per payment method, `cumulative_revenue`...).
- `models/customers.yml` — `customers` semantic model, joined to orders on the `customer` entity, plus `customers` and `total_lifetime_value`.
- `models/metricflow_time_spine.{sql,yml}` — the daily calendar MetricFlow needs for time-based and cumulative metrics.
- `semantic_manifest.json` — what `dbt parse` produced from the above; `../nao_config.yaml` points at it under `semantic_layer.manifest_path`.

## Regenerate the manifest

```bash
git clone https://github.com/dbt-labs/jaffle_shop_duckdb.git /tmp/jaffle_shop && cd /tmp/jaffle_shop
python -m venv .venv && .venv/bin/pip install dbt-core dbt-duckdb
cp <nao>/example/dbt/models/* models/
.venv/bin/dbt seed && .venv/bin/dbt run && .venv/bin/dbt parse
cp target/semantic_manifest.json <nao>/example/dbt/semantic_manifest.json
cp jaffle_shop.duckdb <nao>/example/jaffle_shop.duckdb
cd <nao>/example && nao sync -p semantics
```

`dbt run` is only needed when the DuckDB file must be rebuilt (it contains the `metricflow_time_spine` table); editing metrics alone needs `dbt parse` and `nao sync -p semantics`.
