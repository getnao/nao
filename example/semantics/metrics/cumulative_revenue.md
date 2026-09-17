# cumulative_revenue

**Label:** Cumulative revenue  
**Type:** cumulative  
**Description:** Running total of revenue since the first order.  
**Semantic models:** `orders`  

## Dimensions

Group by or filter this metric with any of the dimensions below. `metric_time` accepts a granularity suffix: `metric_time__day`, `metric_time__week`, `metric_time__month`, `metric_time__quarter`, `metric_time__year`.

- `customer__first_name`
- `customer__first_order`
- `customer__last_name`
- `customer__most_recent_order`
- `metric_time`
- `order__order_date`
- `order__status`

## Query

Over time:
```json
{"metrics": ["cumulative_revenue"], "group_by": ["metric_time__month"], "order_by": ["metric_time__month"]}
```

Broken down, filtered and ranked (see `../README.md` for every parameter):
```json
{"metrics": ["cumulative_revenue"], "group_by": ["customer__first_name"], "where": ["{{ Dimension('customer__first_name') }} IS NOT NULL"], "order_by": ["-cumulative_revenue"], "limit": 10}
```
