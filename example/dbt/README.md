# Jaffle shop dbt project

The [jaffle shop](https://github.com/dbt-labs/jaffle_shop_duckdb) dbt project that builds `../jaffle_shop.duckdb`, extended with a MetricFlow semantic layer so you can try `execute_semantic_query` in the example nao project.

The semantic layer lives next to the models, the dbt way:

- `models/marts/orders.yml` — `orders` semantic model plus the order metrics (`revenue`, `orders`, `average_order_value`, `completed_orders`, `completion_rate`, per payment method revenues, `cumulative_revenue`...).
- `models/marts/customers.yml` — `customers` semantic model, joined to orders on the `customer` entity, plus `customers` and `total_lifetime_value`.
- `models/marts/metricflow_time_spine.sql` — the daily calendar MetricFlow needs for time-based and cumulative metrics.

`dbt parse` writes `target/semantic_manifest.json`, which `../nao_config.yaml` references under `semantic_layer.manifest_path`.

## Rebuild

```bash
cd example/dbt
python -m venv .venv && .venv/bin/pip install dbt-core dbt-duckdb
.venv/bin/dbt seed && .venv/bin/dbt run && .venv/bin/dbt parse
cd .. && nao sync -p semantics
```

`profiles.yml` sits in this folder and points at `../jaffle_shop.duckdb`, so no `~/.dbt` setup is required. After editing metrics, run `dbt parse` then `nao sync -p semantics` again.
