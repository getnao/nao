# Dimensions

Every dimension exposed by the semantic layer, named `entity__dimension` as expected by `execute_semantic_query`. Time dimensions accept a granularity suffix (e.g. `booking__ds__month`).

| Dimension | Type | Granularity | Semantic model | Description |
| --- | --- | --- | --- | --- |
| `customer__first_name` | categorical |  | `customers` |  |
| `customer__first_order` | time | day | `customers` |  |
| `customer__last_name` | categorical |  | `customers` |  |
| `customer__most_recent_order` | time | day | `customers` |  |
| `order__order_date` | time | day | `orders` |  |
| `order__status` | categorical |  | `orders` | Order status (placed, shipped, completed, return_pending, returned). |
