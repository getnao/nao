# customers - Profiling

**Dataset:** `main`

**Computed at:** `2026-03-03T15:28:53.494099+00:00`

**Columns:** 7

## Column Profiles (JSONL)

- {"column": "customer_id", "type": "int32", "total_count": 100, "null_count": 0, "null_percentage": 0.0, "distinct_count": 100}
- {"column": "first_name", "type": "string", "total_count": 100, "null_count": 0, "null_percentage": 0.0, "distinct_count": 79}
- {"column": "last_name", "type": "string", "total_count": 100, "null_count": 0, "null_percentage": 0.0, "distinct_count": 19, "top_values": [{"value": "R.", "count": 13}, {"value": "H.", "count": 11}, {"value": "W.", "count": 11}, {"value": "M.", "count": 8}, {"value": "C.", "count": 7}, {"value": "P.", "count": 7}, {"value": "A.", "count": 6}, {"value": "B.", "count": 5}, {"value": "F.", "count": 5}, {"value": "G.", "count": 4}]}
- {"column": "first_order", "type": "date", "total_count": 100, "null_count": 38, "null_percentage": 38.0, "distinct_count": 46, "min": "2018-01-01 00:00:00", "max": "2018-04-07 00:00:00"}
- {"column": "most_recent_order", "type": "date", "total_count": 100, "null_count": 38, "null_percentage": 38.0, "distinct_count": 52, "min": "2018-01-09 00:00:00", "max": "2018-04-09 00:00:00"}
- {"column": "number_of_orders", "type": "int32", "total_count": 100, "null_count": 38, "null_percentage": 38.0, "distinct_count": 4, "min": 1, "max": 5, "mean": 1.5968, "stddev": 0.7717}
- {"column": "customer_lifetime_value", "type": "float64", "total_count": 100, "null_count": 38, "null_percentage": 38.0, "distinct_count": 35, "min": 1.0, "max": 99.0, "mean": 26.9677, "stddev": 18.6599}
