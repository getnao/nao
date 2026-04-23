CREATE TABLE users (
    id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    active BOOLEAN NOT NULL
);

INSERT INTO users (id, name, email, active) VALUES
(1, 'Alice', 'alice@example.com', true),
(2, 'Bob', NULL, false),
(3, 'Charlie', 'charlie@example.com', true);

CREATE TABLE orders (
    id INT NOT NULL,
    user_id INT NOT NULL,
    amount DOUBLE NOT NULL
);

INSERT INTO orders (id, user_id, amount) VALUES
(1, 1, 99.99),
(2, 1, 24.50);
