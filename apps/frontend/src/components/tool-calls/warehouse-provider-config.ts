import type { requestWarehouseCredentials } from '@nao/shared/tools';

export type SqlProvider = requestWarehouseCredentials.Provider;

export type WarehouseCredentialField =
	| 'accessToken'
	| 'accountId'
	| 'authMode'
	| 'awsAccessKeyId'
	| 'awsRegion'
	| 'awsSecretAccessKey'
	| 'awsSessionToken'
	| 'catalog'
	| 'clientId'
	| 'clientSecret'
	| 'database'
	| 'datasetId'
	| 'driver'
	| 'gcpProjectId'
	| 'host'
	| 'httpPath'
	| 'httpScheme'
	| 'location'
	| 'password'
	| 'port'
	| 'protocol'
	| 's3StagingDirectory'
	| 'schemaName'
	| 'secure'
	| 'serverHostname'
	| 'serviceAccountJson'
	| 'tenantId'
	| 'user'
	| 'warehouse'
	| 'workgroupName';

interface SqlProviderSettings {
	label: string;
	defaultName: string;
	defaultPort: number;
	schemaHint?: string;
	defaultHttpScheme?: 'http' | 'https';
	fields: readonly WarehouseCredentialField[];
}

export const WAREHOUSE_PROVIDER_LABELS: Record<requestWarehouseCredentials.Provider, string> = {
	athena: 'Amazon Athena',
	bigquery: 'BigQuery',
	clickhouse: 'ClickHouse',
	databricks: 'Databricks',
	fabric: 'Microsoft Fabric',
	motherduck: 'MotherDuck',
	mssql: 'Microsoft SQL Server',
	mysql: 'MySQL',
	postgres: 'Postgres',
	redshift: 'Amazon Redshift',
	snowflake: 'Snowflake',
	starrocks: 'StarRocks',
	trino: 'Trino',
};

export const SQL_PROVIDER_SETTINGS: Record<SqlProvider, SqlProviderSettings> = {
	athena: {
		label: 'Amazon Athena',
		defaultName: 'athena-prod',
		defaultPort: 443,
		fields: [
			'database',
			'awsRegion',
			's3StagingDirectory',
			'workgroupName',
			'awsAccessKeyId',
			'awsSecretAccessKey',
			'awsSessionToken',
		],
	},
	bigquery: {
		label: 'BigQuery',
		defaultName: 'bigquery-prod',
		defaultPort: 443,
		fields: ['gcpProjectId', 'datasetId', 'serviceAccountJson', 'location'],
	},
	clickhouse: {
		label: 'ClickHouse',
		defaultName: 'clickhouse-prod',
		defaultPort: 8123,
		fields: ['host', 'port', 'database', 'user', 'password', 'protocol', 'secure'],
	},
	databricks: {
		label: 'Databricks',
		defaultName: 'databricks-prod',
		defaultPort: 443,
		fields: ['serverHostname', 'httpPath', 'accessToken', 'catalog', 'schemaName'],
	},
	fabric: {
		label: 'Fabric',
		defaultName: 'fabric-prod',
		defaultPort: 1433,
		fields: ['host', 'port', 'database', 'clientId', 'clientSecret', 'tenantId'],
	},
	motherduck: {
		label: 'MotherDuck',
		defaultName: 'motherduck-prod',
		defaultPort: 443,
		fields: ['accessToken', 'database'],
	},
	mssql: {
		label: 'Microsoft SQL Server',
		defaultName: 'mssql-prod',
		defaultPort: 1433,
		fields: ['host', 'port', 'database', 'user', 'password', 'schemaName', 'driver'],
	},
	mysql: {
		label: 'MySQL',
		defaultName: 'mysql-prod',
		defaultPort: 3306,
		schemaHint: '(optional)',
		fields: ['host', 'port', 'database', 'user', 'password', 'schemaName'],
	},
	postgres: {
		label: 'Postgres',
		defaultName: 'postgres-prod',
		defaultPort: 5432,
		schemaHint: '(optional, uses public by default)',
		fields: ['host', 'port', 'database', 'user', 'password', 'schemaName'],
	},
	redshift: {
		label: 'Amazon Redshift',
		defaultName: 'redshift-prod',
		defaultPort: 5439,
		schemaHint: '(optional, uses public by default)',
		fields: ['host', 'port', 'database', 'user', 'password', 'schemaName'],
	},
	snowflake: {
		label: 'Snowflake',
		defaultName: 'snowflake-prod',
		defaultPort: 443,
		fields: ['database', 'user', 'password', 'schemaName', 'warehouse', 'accountId'],
	},
	starrocks: {
		label: 'StarRocks',
		defaultName: 'starrocks-prod',
		defaultPort: 9030,
		fields: ['catalog', 'host', 'port', 'database', 'user', 'password', 'schemaName'],
	},
	trino: {
		label: 'Trino',
		defaultName: 'trino-prod',
		defaultPort: 8080,
		defaultHttpScheme: 'http',
		fields: ['catalog', 'host', 'port', 'httpScheme', 'user', 'password', 'schemaName'],
	},
};

export function isSqlProvider(provider: requestWarehouseCredentials.Provider): provider is SqlProvider {
	return provider in SQL_PROVIDER_SETTINGS;
}

export function providerHasField(provider: SqlProvider, field: WarehouseCredentialField): boolean {
	return SQL_PROVIDER_SETTINGS[provider].fields.includes(field);
}
