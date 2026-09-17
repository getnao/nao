# total_lifetime_value

**Label:** Total lifetime value  
**Type:** simple  
**Description:** Sum of customer lifetime values.  
**Semantic models:** `customers`  

## Dimensions

Group by or filter this metric with any of the dimensions below. `metric_time` accepts a granularity suffix: `metric_time__day`, `metric_time__week`, `metric_time__month`, `metric_time__quarter`, `metric_time__year`.

- `customer__first_name`
- `customer__first_order`
- `customer__last_name`
- `customer__most_recent_order`
- `metric_time`

## Query

Over time:
```json
{"metrics": ["total_lifetime_value"], "group_by": ["metric_time__month"], "order_by": ["metric_time__month"]}
```

Broken down, filtered and ranked (see `../README.md` for every parameter):
```json
{"metrics": ["total_lifetime_value"], "group_by": ["customer__first_name"], "where": ["{{ Dimension('customer__first_name') }} IS NOT NULL"], "order_by": ["-total_lifetime_value"], "limit": 10}
```
