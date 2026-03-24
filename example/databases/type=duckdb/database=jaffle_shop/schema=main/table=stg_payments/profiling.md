# stg_payments - Profiling

**Dataset:** `main`

**Computed at:** `2026-03-03T15:28:53.601999+00:00`

**Columns:** 4

## Column Profiles (JSONL)

- {"column": "payment_id", "type": "int32", "total_count": 113, "null_count": 0, "null_percentage": 0.0, "distinct_count": 113}
- {"column": "order_id", "type": "int32", "total_count": 113, "null_count": 0, "null_percentage": 0.0, "distinct_count": 99}
- {"column": "payment_method", "type": "string", "total_count": 113, "null_count": 0, "null_percentage": 0.0, "distinct_count": 4, "top_values": [{"value": "credit_card", "count": 55}, {"value": "bank_transfer", "count": 33}, {"value": "coupon", "count": 13}, {"value": "gift_card", "count": 12}]}
- {"column": "amount", "type": "float64", "total_count": 113, "null_count": 0, "null_percentage": 0.0, "distinct_count": 30, "min": 0.0, "max": 30.0, "mean": 14.7965, "stddev": 9.1576}
