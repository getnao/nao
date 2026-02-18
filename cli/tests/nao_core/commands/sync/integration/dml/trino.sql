CREATE SCHEMA IF NOT EXISTS {public_schema};
CREATE SCHEMA IF NOT EXISTS {another_schema};

DROP TABLE IF EXISTS {public_schema}.users;
CREATE TABLE {public_schema}.users (
    id INTEGER,
    name VARCHAR,
    email VARCHAR,
    active BOOLEAN
);
INSERT INTO {public_schema}.users (id, name, email, active) VALUES
    (1, 'Alice', 'alice@example.com', TRUE),
    (2, 'Bob', NULL, FALSE),
    (3, 'Charlie', 'charlie@example.com', TRUE);

DROP TABLE IF EXISTS {public_schema}.orders;
CREATE TABLE {public_schema}.orders (
    id INTEGER,
    user_id INTEGER,
    amount DOUBLE
);
INSERT INTO {public_schema}.orders (id, user_id, amount) VALUES
    (1, 1, 99.99),
    (2, 1, 24.5);

DROP TABLE IF EXISTS {another_schema}.whatever;
CREATE TABLE {another_schema}.whatever (
    id INTEGER,
    note VARCHAR
);
INSERT INTO {another_schema}.whatever (id, note) VALUES (1, 'x');
