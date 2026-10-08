import { SQL_PROVIDER_SETTINGS } from './warehouse-provider-config';
import type { SqlProvider } from './warehouse-provider-config';

export interface WarehouseCredentialsFormValues {
	name: string;
	host: string;
	port: string;
	database: string;
	user: string;
	password: string;
	schemaName: string;
	protocol: 'http' | 'native';
	secure: boolean;
	warehouse: string;
	accountId: string;
	serverHostname: string;
	httpPath: string;
	accessToken: string;
	catalog: string;
	httpScheme: 'http' | 'https';
	driver: string;
	gcpProjectId: string;
	datasetId: string;
	serviceAccountJson: string;
	location: string;
	clientId: string;
	clientSecret: string;
	authMode: string;
	tenantId: string;
	awsRegion: string;
	s3StagingDirectory: string;
	workgroupName: string;
	awsAccessKeyId: string;
	awsSecretAccessKey: string;
	awsSessionToken: string;
}

export function getClickHouseDefaultPort(
	protocol: WarehouseCredentialsFormValues['protocol'],
	secure: boolean,
): number {
	if (protocol === 'native') {
		return secure ? 9440 : 9000;
	}
	return secure ? 8443 : 8123;
}

export function getTrinoDefaultPort(httpScheme: WarehouseCredentialsFormValues['httpScheme']): number {
	return httpScheme === 'https' ? 8443 : 8080;
}

export function getWarehouseCredentialsDefaults(provider: SqlProvider): WarehouseCredentialsFormValues {
	const settings = SQL_PROVIDER_SETTINGS[provider];

	return {
		name: settings.defaultName,
		host: 'localhost',
		port: String(settings.defaultPort),
		database: provider === 'clickhouse' ? 'default' : '',
		user: provider === 'clickhouse' ? 'default' : '',
		password: '',
		schemaName: '',
		protocol: 'http',
		secure: false,
		warehouse: '',
		accountId: '',
		serverHostname: '',
		httpPath: '',
		accessToken: '',
		catalog: '',
		httpScheme: settings.defaultHttpScheme ?? 'http',
		driver: '',
		gcpProjectId: '',
		datasetId: '',
		serviceAccountJson: '',
		location: '',
		clientId: '',
		clientSecret: '',
		authMode: provider === 'fabric' ? 'azure_service_principal' : '',
		tenantId: '',
		awsRegion: '',
		s3StagingDirectory: '',
		workgroupName: provider === 'athena' ? 'primary' : '',
		awsAccessKeyId: '',
		awsSecretAccessKey: '',
		awsSessionToken: '',
	};
}

export function buildWarehouseCredentials(
	provider: SqlProvider,
	values: WarehouseCredentialsFormValues,
): Record<string, unknown> {
	const port = Number(values.port);
	const schemaName = values.schemaName || undefined;
	const database = values.database || undefined;

	switch (provider) {
		case 'athena':
			return {
				regionName: values.awsRegion,
				s3StagingDir: values.s3StagingDirectory,
				workGroup: values.workgroupName || undefined,
				schemaName: database,
				awsAccessKeyId: values.awsAccessKeyId,
				awsSecretAccessKey: values.awsSecretAccessKey,
				awsSessionToken: values.awsSessionToken || undefined,
			};
		case 'bigquery':
			return {
				projectId: values.gcpProjectId,
				datasetId: values.datasetId || undefined,
				credentialsJson: values.serviceAccountJson,
				location: values.location || undefined,
			};
		case 'clickhouse':
			return {
				host: values.host,
				port,
				user: values.user,
				database,
				password: values.password,
				protocol: values.protocol,
				secure: values.secure,
			};
		case 'databricks':
			return {
				schemaName,
				serverHostname: values.serverHostname,
				httpPath: values.httpPath,
				accessToken: values.accessToken,
				catalog: values.catalog || undefined,
			};
		case 'fabric':
			return {
				host: values.host,
				port,
				database: values.database,
				clientId: values.clientId,
				clientSecret: values.clientSecret,
				authMode: 'azure_service_principal',
				tenantId: values.tenantId || undefined,
			};
		case 'motherduck':
			return {
				database,
				token: values.accessToken || undefined,
			};
		case 'mssql':
			return {
				host: values.host,
				port,
				user: values.user,
				database,
				password: values.password,
				schemaName,
				driver: values.driver || undefined,
			};
		case 'mysql':
		case 'postgres':
			return {
				host: values.host,
				port,
				user: values.user,
				database,
				password: values.password,
				schemaName,
			};
		case 'redshift':
			return {
				host: values.host,
				port,
				user: values.user,
				database,
				password: values.password,
				schemaName,
				authMode: 'password',
				sslmode: 'require',
			};
		case 'snowflake':
			return {
				database,
				password: values.password,
				schemaName,
				warehouse: values.warehouse || undefined,
				accountId: values.accountId,
				username: values.user,
			};
		case 'starrocks':
			return {
				host: values.host,
				port,
				user: values.user,
				database,
				password: values.password,
				schemaName,
				catalog: values.catalog || undefined,
			};
		case 'trino':
			return {
				host: values.host,
				port,
				user: values.user,
				catalog: values.catalog || undefined,
				httpScheme: values.httpScheme,
				password: values.password || undefined,
				schemaName,
			};
	}
}
