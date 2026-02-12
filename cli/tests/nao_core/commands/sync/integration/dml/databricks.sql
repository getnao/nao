CREATE TABLE {catalog}.public.users (
id INTEGER NOT NULL,
name STRING NOT NULL,
email STRING,
active BOOLEAN
);

INSERT INTO {catalog}.public.users VALUES
(1, 'Alice', 'alice@example.com', true),
(2, 'Bob', NULL, false),
(3, 'Charlie', 'charlie@example.com', true);

COMMENT ON TABLE {catalog}.public.users IS 'Registered user accounts';
ALTER TABLE {catalog}.public.users ALTER COLUMN email COMMENT 'User email address';

CREATE TABLE {catalog}.public.orders (
id INTEGER NOT NULL,
user_id INTEGER NOT NULL,
amount DOUBLE NOT NULL
);

INSERT INTO {catalog}.public.orders VALUES
(1, 1, 99.99),
(2, 1, 24.50);

CREATE SCHEMA {catalog}.another;

CREATE TABLE {catalog}.another.whatever (
id INTEGER NOT NULL,
price DOUBLE NOT NULL
);
