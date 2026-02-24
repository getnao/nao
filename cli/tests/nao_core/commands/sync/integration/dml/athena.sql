CREATE EXTERNAL TABLE {database}.users (
    id INT,
    name STRING,
    email STRING,
    active BOOLEAN
) 
STORED AS PARQUET
LOCATION '{s3_staging_dir}{database}/users/';

INSERT INTO {database}.users VALUES
    (1, 'Alice', 'alice@example.com', true),
    (2, 'Bob', NULL, false),
    (3, 'Charlie', 'charlie@example.com', true);

CREATE EXTERNAL TABLE {database}.orders (
    id INT,
    user_id INT,
    amount DOUBLE
) 
STORED AS PARQUET
LOCATION '{s3_staging_dir}{database}/orders/';

INSERT INTO {database}.orders VALUES
    (1, 1, 99.99),
    (2, 1, 24.50);

CREATE EXTERNAL TABLE {another_database}.whatever (
    id INT,
    price DOUBLE
) 
STORED AS PARQUET
LOCATION '{s3_staging_dir}{another_database}/whatever/';
