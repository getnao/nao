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


CREATE TABLE {database}.public.orders (
id INTEGER NOT NULL,
user_id INTEGER NOT NULL,
amount FLOAT4 NOT NULL
);

INSERT INTO {database}.public.orders VALUES
(1, 1, 99.99),
(2, 1, 24.50);

CREATE SCHEMA {database}.another;

CREATE TABLE {database}.another.whatever (
id INTEGER NOT NULL,
price FLOAT4 NOT NULL
);