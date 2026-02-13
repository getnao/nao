"""Skills configuration template generator."""


def generate_top_customers_skill() -> str:
    """Generate top customers skill markdown template.

    Returns:
        str: Markdown content for the top-customers skill.
    """
    return """---
name: top-customers
description: Analyze database to find top 5 customers by total payments. Works with PostgreSQL and SQLite databases. Expects tables - 'customers', 'orders', and 'stg_payments'. Triggers when user asks for top customers, best customers, highest paying customers, customer payment analysis, or customer revenue ranking.
---

# Top Customers Analysis

Find the top 5 customers by total payment amount.

## Requirements

- Database: PostgreSQL or SQLite
- Tables: `customers`, `orders`, and `stg_payments`

## SQL Query

Execute the following SQL query to retrieve top customers:

```sql
WITH customer_payments AS (
  SELECT
    o.customer_id,
    SUM(p.amount) AS total_paid
  FROM main.stg_payments p
  JOIN main.orders o
    ON o.order_id = p.order_id
  GROUP BY 1
)
SELECT
  cp.customer_id,
  c.first_name,
  c.last_name,
  cp.total_paid
FROM customer_payments cp
JOIN main.customers c
  ON c.customer_id = cp.customer_id
ORDER BY cp.total_paid DESC
LIMIT 5;
```

## Process

1. **Execute the SQL query** using the available database connection
2. **Format results** - combine first_name and last_name, format currency
3. **Present results** in a clear table format with ranking

## Output Format

Display results as:

```markdown
## Top 5 Customers by Payments

| Rank | Customer | Total Payments |
|------|----------|----------------|
| 1    | [name]   | $X,XXX.XX      |
| 2    | [name]   | $X,XXX.XX      |
| 3    | [name]   | $X,XXX.XX      |
| 4    | [name]   | $X,XXX.XX      |
| 5    | [name]   | $X,XXX.XX      |
```
"""
