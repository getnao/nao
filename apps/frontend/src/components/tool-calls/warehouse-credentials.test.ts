import { describe, expect, it } from 'vitest';

import {
	buildWarehouseCredentials,
	getClickHouseDefaultPort,
	getTrinoDefaultPort,
	getWarehouseCredentialsDefaults,
} from './warehouse-credentials';
import type { WarehouseCredentialsFormValues } from './warehouse-credentials';
import type { SqlProvider } from './warehouse-provider-config';

const values: WarehouseCredentialsFormValues = {
	name: 'test-connection',
	host: 'warehouse.example.com',
	port: '9999',
	database: 'analytics',
	user: 'nao',
	password: 'secret',
	schemaName: 'reporting',
	protocol: 'native',
	secure: true,
	warehouse: 'compute',
	accountId: 'account',
	serverHostname: 'databricks.example.com',
	httpPath: '/sql/warehouse',
	accessToken: 'token',
	catalog: 'main',
	httpScheme: 'https',
	driver: 'FreeTDS',
	gcpProjectId: 'gcp-project',
	datasetId: 'dataset',
	serviceAccountJson: '{"type":"service_account"}',
	location: 'EU',
	clientId: 'client-id',
	clientSecret: 'client-secret',
	authMode: 'sql_password',
	tenantId: 'tenant-id',
	awsRegion: 'eu-west-1',
	s3StagingDirectory: 's3://results/',
	workgroupName: 'primary',
	awsAccessKeyId: 'access-key',
	awsSecretAccessKey: 'secret-key',
	awsSessionToken: 'session-token',
};

const providerCases: Array<{
	provider: SqlProvider;
	expected: Record<string, unknown>;
}> = [
	{
		provider: 'athena',
		expected: {
			regionName: 'eu-west-1',
			s3StagingDir: 's3://results/',
			workGroup: 'primary',
			schemaName: 'analytics',
			awsAccessKeyId: 'access-key',
			awsSecretAccessKey: 'secret-key',
			awsSessionToken: 'session-token',
		},
	},
	{
		provider: 'bigquery',
		expected: {
			projectId: 'gcp-project',
			datasetId: 'dataset',
			credentialsJson: '{"type":"service_account"}',
			location: 'EU',
		},
	},
	{
		provider: 'clickhouse',
		expected: {
			host: 'warehouse.example.com',
			port: 9999,
			user: 'nao',
			database: 'analytics',
			password: 'secret',
			protocol: 'native',
			secure: true,
		},
	},
	{
		provider: 'databricks',
		expected: {
			schemaName: 'reporting',
			serverHostname: 'databricks.example.com',
			httpPath: '/sql/warehouse',
			accessToken: 'token',
			catalog: 'main',
		},
	},
	{
		provider: 'fabric',
		expected: {
			host: 'warehouse.example.com',
			port: 9999,
			database: 'analytics',
			clientId: 'client-id',
			clientSecret: 'client-secret',
			authMode: 'azure_service_principal',
			tenantId: 'tenant-id',
		},
	},
	{
		provider: 'motherduck',
		expected: {
			database: 'analytics',
			token: 'token',
		},
	},
	{
		provider: 'mssql',
		expected: {
			host: 'warehouse.example.com',
			port: 9999,
			user: 'nao',
			database: 'analytics',
			password: 'secret',
			schemaName: 'reporting',
			driver: 'FreeTDS',
		},
	},
	{
		provider: 'mysql',
		expected: {
			host: 'warehouse.example.com',
			port: 9999,
			user: 'nao',
			database: 'analytics',
			password: 'secret',
			schemaName: 'reporting',
		},
	},
	{
		provider: 'postgres',
		expected: {
			host: 'warehouse.example.com',
			port: 9999,
			user: 'nao',
			database: 'analytics',
			password: 'secret',
			schemaName: 'reporting',
		},
	},
	{
		provider: 'redshift',
		expected: {
			host: 'warehouse.example.com',
			port: 9999,
			user: 'nao',
			database: 'analytics',
			password: 'secret',
			schemaName: 'reporting',
			authMode: 'password',
			sslmode: 'require',
		},
	},
	{
		provider: 'snowflake',
		expected: {
			database: 'analytics',
			password: 'secret',
			schemaName: 'reporting',
			warehouse: 'compute',
			accountId: 'account',
			username: 'nao',
		},
	},
	{
		provider: 'starrocks',
		expected: {
			host: 'warehouse.example.com',
			port: 9999,
			user: 'nao',
			database: 'analytics',
			password: 'secret',
			schemaName: 'reporting',
			catalog: 'main',
		},
	},
	{
		provider: 'trino',
		expected: {
			host: 'warehouse.example.com',
			port: 9999,
			user: 'nao',
			catalog: 'main',
			httpScheme: 'https',
			password: 'secret',
			schemaName: 'reporting',
		},
	},
];

describe('buildWarehouseCredentials', () => {
	it.each(providerCases)('builds the $provider backend payload', ({ provider, expected }) => {
		expect(buildWarehouseCredentials(provider, values)).toEqual(expected);
	});

	it('omits empty optional Athena values over the wire', () => {
		const credentials = buildWarehouseCredentials('athena', getWarehouseCredentialsDefaults('athena'));

		expect(JSON.parse(JSON.stringify(credentials))).toEqual({
			regionName: '',
			s3StagingDir: '',
			workGroup: 'primary',
			awsAccessKeyId: '',
			awsSecretAccessKey: '',
		});
	});

	it('omits empty optional MotherDuck values over the wire', () => {
		const credentials = buildWarehouseCredentials('motherduck', getWarehouseCredentialsDefaults('motherduck'));

		expect(JSON.parse(JSON.stringify(credentials))).toEqual({});
	});

	it('omits empty optional Trino values over the wire', () => {
		const credentials = buildWarehouseCredentials('trino', getWarehouseCredentialsDefaults('trino'));

		expect(JSON.parse(JSON.stringify(credentials))).toEqual({
			host: 'localhost',
			port: 8080,
			user: '',
			httpScheme: 'http',
		});
	});

	it('uses service principal authentication for Fabric cloud connections', () => {
		expect(getWarehouseCredentialsDefaults('fabric').authMode).toBe('azure_service_principal');
		expect(buildWarehouseCredentials('fabric', values)).toMatchObject({
			authMode: 'azure_service_principal',
		});
	});
});

describe('warehouse port defaults', () => {
	it.each([
		['http', false, 8123],
		['http', true, 8443],
		['native', false, 9000],
		['native', true, 9440],
	] as const)('uses ClickHouse %s secure=%s port %s', (protocol, secure, expected) => {
		expect(getClickHouseDefaultPort(protocol, secure)).toBe(expected);
	});

	it.each([
		['http', 8080],
		['https', 8443],
	] as const)('uses Trino %s port %s', (httpScheme, expected) => {
		expect(getTrinoDefaultPort(httpScheme)).toBe(expected);
	});
});
