DO $$
DECLARE
    category_count bigint;
    customer_count bigint;
    product_count bigint;
    order_count bigint;
    order_item_count bigint;
    completed_revenue numeric(12, 2);
    electronics_completed_revenue numeric(12, 2);
BEGIN
    SELECT count(*) INTO category_count FROM categories;
    SELECT count(*) INTO customer_count FROM customers;
    SELECT count(*) INTO product_count FROM products;
    SELECT count(*) INTO order_count FROM orders;
    SELECT count(*) INTO order_item_count FROM order_items;
    SELECT sum(order_items.quantity * order_items.unit_price)
    INTO completed_revenue
    FROM order_items
    JOIN orders ON orders.id = order_items.order_id
    WHERE orders.status = 'completed';

    SELECT sum(order_items.quantity * order_items.unit_price)
    INTO electronics_completed_revenue
    FROM order_items
    JOIN orders ON orders.id = order_items.order_id
    JOIN products ON products.id = order_items.product_id
    JOIN categories ON categories.id = products.category_id
    WHERE orders.status = 'completed'
      AND categories.name = 'Electronics';

    IF (
        category_count,
        customer_count,
        product_count,
        order_count,
        order_item_count,
        completed_revenue,
        electronics_completed_revenue
    ) IS DISTINCT FROM (4, 8, 8, 24, 48, 5835.00::numeric, 3360.00::numeric) THEN
        RAISE EXCEPTION 'Fixture verification failed: (%, %, %, %, %, %, %)',
            category_count,
            customer_count,
            product_count,
            order_count,
            order_item_count,
            completed_revenue,
            electronics_completed_revenue;
    END IF;
END
$$;

SELECT
    date_trunc('month', orders.ordered_at)::date AS month,
    sum(order_items.quantity * order_items.unit_price) AS revenue
FROM orders
JOIN order_items ON order_items.order_id = orders.id
WHERE orders.status = 'completed'
GROUP BY 1
ORDER BY 1;

SELECT
    categories.name AS category,
    sum(order_items.quantity * order_items.unit_price) AS revenue
FROM orders
JOIN order_items ON order_items.order_id = orders.id
JOIN products ON products.id = order_items.product_id
JOIN categories ON categories.id = products.category_id
WHERE orders.status = 'completed'
GROUP BY categories.name
ORDER BY revenue DESC;

SELECT
    customers.name AS customer,
    sum(order_items.quantity * order_items.unit_price) AS revenue
FROM orders
JOIN order_items ON order_items.order_id = orders.id
JOIN customers ON customers.id = orders.customer_id
WHERE orders.status = 'completed'
GROUP BY customers.name
ORDER BY revenue DESC, customers.name
LIMIT 5;
