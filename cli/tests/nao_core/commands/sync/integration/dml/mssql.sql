CREATE TABLE dbo.users (
    id INT NOT NULL,
    name NVARCHAR(255) NOT NULL,
    email NVARCHAR(255) NULL,
    active BIT DEFAULT 1
);

INSERT INTO dbo.users VALUES
    (1, 'Alice', 'alice@example.com', 1),
    (2, 'Bob', NULL, 0),
    (3, 'Charlie', 'charlie@example.com', 1);

CREATE TABLE dbo.orders (
    id INT NOT NULL,
    user_id INT NOT NULL,
    amount FLOAT NOT NULL
);

INSERT INTO dbo.orders VALUES
    (1, 1, 99.99),
    (2, 1, 24.50);

CREATE SCHEMA another;

CREATE TABLE another.whatever (
    id INT NOT NULL,
    price FLOAT NOT NULL
);
