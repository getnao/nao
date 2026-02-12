CREATE TABLE {database}.public.users (
id INTEGER NOT NULL,
name VARCHAR NOT NULL,
email VARCHAR,
active BOOLEAN DEFAULT TRUE
);

INSERT INTO {database}.public.users VALUES
(1, 'Alice', 'alice@example.com', true),
(2, 'Bob', NULL, false),
(3, 'Charlie', 'charlie@example.com', true);

COMMENT ON TABLE {database}.public.users IS 'Registered user accounts';
COMMENT ON COLUMN {database}.public.users.email IS 'User email address';

CREATE TABLE {database}.public.orders (
id INTEGER NOT NULL,
user_id INTEGER NOT NULL,
amount FLOAT NOT NULL
);

INSERT INTO {database}.public.orders VALUES
(1, 1, 99.99),
(2, 1, 24.50);

CREATE SCHEMA {database}.another;

CREATE TABLE {database}.another.whatever (
id INTEGER NOT NULL,
price FLOAT NOT NULL
);
