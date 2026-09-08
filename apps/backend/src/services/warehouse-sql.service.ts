import { env } from '../env';
import { assertWarehouseTableAccess, type WarehouseTableAccess } from './context-access';

interface WarehouseSqlOptions {
	projectFolder: string;
	databaseId?: string;
	envVars?: Record<string, string>;
	azureAccessToken?: string | null;
	enforceExcludedColumns: boolean;
	tableAccess: WarehouseTableAccess;
}

export interface WarehouseSqlResult {
	data: Record<string, unknown>[];
	row_count: number;
	columns: string[];
	dialect?: string;
}

export class WarehouseSqlError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'WarehouseSqlError';
	}
}

export async function executeWarehouseSql(sql: string, options: WarehouseSqlOptions): Promise<WarehouseSqlResult> {
	return requestWarehouseSql<WarehouseSqlResult>('/execute_sql', sql, options);
}

export async function validateWarehouseSql(sql: string, options: WarehouseSqlOptions): Promise<void> {
	await requestWarehouseSql('/validate_sql', sql, options);
}

async function requestWarehouseSql<T>(
	path: '/execute_sql' | '/validate_sql',
	sql: string,
	options: WarehouseSqlOptions,
): Promise<T> {
	const response = await fetch(`http://localhost:${env.FASTAPI_PORT}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
		},
		body: JSON.stringify({
			sql,
			nao_project_folder: options.projectFolder,
			enforce_excluded_columns: options.enforceExcludedColumns,
			table_access: serializeTableAccess(assertWarehouseTableAccess(options.tableAccess)),
			...(options.databaseId && { database_id: options.databaseId }),
			...(options.envVars && Object.keys(options.envVars).length > 0 && { env_vars: options.envVars }),
			...(options.azureAccessToken && { azure_access_token: options.azureAccessToken }),
		}),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ detail: response.statusText }));
		throw new WarehouseSqlError(
			response.status,
			`Warehouse SQL request denied: ${describeError(errorData.detail)}`,
		);
	}

	return response.json() as Promise<T>;
}

function serializeTableAccess(access: WarehouseTableAccess) {
	const enforced = (access as { enforced: unknown }).enforced;
	if (enforced === false) {
		return { enforced: false as const };
	}
	if (enforced === true && 'tables' in access && Array.isArray(access.tables)) {
		return {
			enforced: true as const,
			tables: access.tables.map((table) => ({
				database_type: table.databaseType,
				database: table.database,
				schema: table.schema,
				table: table.table,
			})),
		};
	}
	throw new Error('Warehouse table access has an invalid enforced discriminant.');
}

function describeError(detail: unknown): string {
	return typeof detail === 'string' ? detail : JSON.stringify(detail);
}
