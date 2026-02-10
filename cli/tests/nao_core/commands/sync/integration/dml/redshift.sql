CREATE TABLE nao_unit_tests.public.users (
id INTEGER NOT NULL,
name VARCHAR NOT NULL,
email VARCHAR,
active BOOLEAN DEFAULT TRUE
);

INSERT INTO nao_unit_tests.public.users VALUES
(1, 'Alice', 'alice@example.com', true),
(2, 'Bob', NULL, false),
(3, 'Charlie', 'charlie@example.com', true);


CREATE TABLE nao_unit_tests.public.orders (
id INTEGER NOT NULL,
user_id INTEGER NOT NULL,
amount FLOAT4 NOT NULL
);

INSERT INTO nao_unit_tests.public.orders VALUES
(1, 1, 99.99),
(2, 1, 24.50);

CREATE SCHEMA nao_unit_tests.another;

CREATE TABLE nao_unit_tests.another.whatever (
id INTEGER NOT NULL,
price FLOAT4 NOT NULL
);