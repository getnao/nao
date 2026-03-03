# stg_orders - Profiling

**Dataset:** `main`

**Computed at:** `2026-03-03T15:28:53.588106+00:00`

**Columns:** 4

## Column Profiles (JSONL)

- {"column": "order_id", "type": "int32", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 99}
- {"column": "customer_id", "type": "int32", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 62}
- {"column": "order_date", "type": "date", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 69, "min": "2018-01-01 00:00:00", "max": "2018-04-09 00:00:00"}
- {"column": "status", "type": "string", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 5, "top_values": [{"value": "completed", "count": 67}, {"value": "placed", "count": 13}, {"value": "shipped", "count": 13}, {"value": "returned", "count": 4}, {"value": "return_pending", "count": 2}]}
