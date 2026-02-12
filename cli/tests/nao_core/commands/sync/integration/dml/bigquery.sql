CREATE TABLE {public_dataset}.users (
id INT64 NOT NULL,
name STRING NOT NULL,
email STRING,
active BOOL DEFAULT TRUE
);

INSERT INTO {public_dataset}.users VALUES
(1, 'Alice', 'alice@example.com', true),
(2, 'Bob', NULL, false),
(3, 'Charlie', 'charlie@example.com', true);

ALTER TABLE {public_dataset}.users SET OPTIONS (description = 'Registered user accounts');
ALTER TABLE {public_dataset}.users ALTER COLUMN email SET OPTIONS (description = 'User email address');

CREATE TABLE {public_dataset}.orders (
id INT64 NOT NULL,
user_id INT64 NOT NULL,
amount FLOAT64 NOT NULL
);

INSERT INTO {public_dataset}.orders VALUES
(1, 1, 99.99),
(2, 1, 24.50);

CREATE TABLE {another_dataset}.whatever (
id INT64 NOT NULL,
price FLOAT64 NOT NULL
);
