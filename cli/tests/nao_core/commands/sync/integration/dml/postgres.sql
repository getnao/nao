CREATE SCHEMA IF NOT EXISTS public;

CREATE TABLE public.users (
id INTEGER NOT NULL,
name VARCHAR NOT NULL,
email VARCHAR,
active BOOLEAN DEFAULT TRUE
);

INSERT INTO public.users VALUES
(1, 'Alice', 'alice@example.com', true),
(2, 'Bob', NULL, false),
(3, 'Charlie', 'charlie@example.com', true);


CREATE TABLE public.orders (
id INTEGER NOT NULL,
user_id INTEGER NOT NULL,
amount DOUBLE PRECISION NOT NULL
);

INSERT INTO public.orders VALUES
(1, 1, 99.99),
(2, 1, 24.50);

CREATE SCHEMA another;

CREATE TABLE another.whatever (
id INTEGER NOT NULL,
price DOUBLE PRECISION NOT NULL
);
