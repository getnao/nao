CREATE TABLE categories (
    id integer PRIMARY KEY,
    name text NOT NULL UNIQUE
);

CREATE TABLE customers (
    id integer PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    region text NOT NULL,
    latitude numeric(9, 6) NOT NULL,
    longitude numeric(9, 6) NOT NULL,
    created_at date NOT NULL
);

CREATE TABLE products (
    id integer PRIMARY KEY,
    category_id integer NOT NULL REFERENCES categories (id),
    name text NOT NULL,
    price numeric(12, 2) NOT NULL CHECK (price >= 0)
);

CREATE TABLE orders (
    id integer PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES customers (id),
    ordered_at date NOT NULL,
    status text NOT NULL CHECK (status IN ('completed', 'pending', 'refunded'))
);

CREATE TABLE order_items (
    id integer PRIMARY KEY,
    order_id integer NOT NULL REFERENCES orders (id),
    product_id integer NOT NULL REFERENCES products (id),
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0)
);

INSERT INTO categories (id, name)
VALUES
    (1, 'Accessories'),
    (2, 'Electronics'),
    (3, 'Home'),
    (4, 'Outdoors');

INSERT INTO customers (id, name, email, region, latitude, longitude, created_at)
VALUES
    (1, 'Ada Lovelace', 'ada@example.com', 'United Kingdom', 51.507400, -0.127800, '2024-01-15'),
    (2, 'Grace Hopper', 'grace@example.com', 'United States', 40.712800, -74.006000, '2024-02-10'),
    (3, 'Katherine Johnson', 'katherine@example.com', 'United States', 38.907200, -77.036900, '2024-03-05'),
    (4, 'Margaret Hamilton', 'margaret@example.com', 'United States', 42.360100, -71.058900, '2024-04-20'),
    (5, 'Edsger Dijkstra', 'edsger@example.com', 'Netherlands', 52.090700, 5.121400, '2024-05-11'),
    (6, 'Barbara Liskov', 'barbara@example.com', 'United States', 42.373600, -71.109700, '2024-06-09'),
    (7, 'Alan Turing', 'alan@example.com', 'United Kingdom', 53.480800, -2.242600, '2024-07-01'),
    (8, 'Radia Perlman', 'radia@example.com', 'United States', 47.606200, -122.332100, '2024-08-18');

INSERT INTO products (id, category_id, name, price)
VALUES
    (1, 1, 'Canvas Tote', 10.00),
    (2, 1, 'Travel Organizer', 25.00),
    (3, 2, 'Wireless Speaker', 120.00),
    (4, 2, 'Noise-Cancelling Headphones', 300.00),
    (5, 3, 'Desk Lamp', 45.00),
    (6, 3, 'Wool Throw', 80.00),
    (7, 4, 'Daypack', 60.00),
    (8, 4, 'Camping Tent', 150.00);

INSERT INTO orders (id, customer_id, ordered_at, status)
SELECT
    order_number,
    ((order_number - 1) % 8) + 1,
    (
        DATE '2025-01-05'
        + ((order_number - 1) / 2) * INTERVAL '1 month'
        + CASE WHEN order_number % 2 = 0 THEN INTERVAL '14 days' ELSE INTERVAL '0 days' END
    )::date,
    CASE
        WHEN order_number IN (8, 15, 22) THEN 'refunded'
        WHEN order_number IN (5, 12, 19) THEN 'pending'
        ELSE 'completed'
    END
FROM generate_series(1, 24) AS order_number;

INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
SELECT
    order_number * 2 - 1,
    order_number,
    product.id,
    1 + order_number % 3,
    product.price
FROM generate_series(1, 24) AS order_number
JOIN products AS product ON product.id = ((order_number - 1) % 8) + 1
UNION ALL
SELECT
    order_number * 2,
    order_number,
    product.id,
    1 + (order_number + 1) % 2,
    product.price
FROM generate_series(1, 24) AS order_number
JOIN products AS product ON product.id = ((order_number + 2) % 8) + 1;
