# orders - Profiling

**Dataset:** `main`

**Computed at:** `2026-03-03T15:28:53.526562+00:00`

**Columns:** 9

## Column Profiles (JSONL)

- {"column": "order_id", "type": "int32", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 99}
- {"column": "customer_id", "type": "int32", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 62}
- {"column": "order_date", "type": "date", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 69, "min": "2018-01-01 00:00:00", "max": "2018-04-09 00:00:00"}
- {"column": "status", "type": "string", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 5, "top_values": [{"value": "completed", "count": 67}, {"value": "placed", "count": 13}, {"value": "shipped", "count": 13}, {"value": "returned", "count": 4}, {"value": "return_pending", "count": 2}]}
- {"column": "credit_card_amount", "type": "float64", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 25, "min": 0.0, "max": 30.0, "mean": 8.798, "stddev": 10.9036}
- {"column": "coupon_amount", "type": "float64", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 12, "min": 0.0, "max": 26.0, "mean": 1.8687, "stddev": 5.9249}
- {"column": "bank_transfer_amount", "type": "float64", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 19, "min": 0.0, "max": 26.0, "mean": 4.1515, "stddev": 7.3833}
- {"column": "gift_card_amount", "type": "float64", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 11, "min": 0.0, "max": 30.0, "mean": 2.0707, "stddev": 6.36}
- {"column": "amount", "type": "float64", "total_count": 99, "null_count": 0, "null_percentage": 0.0, "distinct_count": 32, "min": 0.0, "max": 58.0, "mean": 16.8889, "stddev": 10.6817}
