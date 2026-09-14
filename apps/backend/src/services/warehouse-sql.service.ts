import type { WarehouseRowSecurity } from '@nao/shared';

import { env } from '../env';
import { assertWarehouseTableAccess, type WarehouseTableAccess } from './context-access';

interface WarehouseSqlOptions {
	projectFolder: string;
	databaseId?: string;
	envVars?: Record<string, string>;
	azureAccessToken?: string | null;
	enforceExcludedColumns: boolean;
	tableAccess: WarehouseTableAccess;
	rowSecurity: WarehouseRowSecurity;
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

export async function validateWarehouseRowPredicate(
	predicate: string,
	constraintColumns: string[],
	databaseType: string,
): Promise<string> {
	const response = await fetch(`http://localhost:${env.FASTAPI_PORT}/validate_row_predicate`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
		},
		body: JSON.stringify({
			predicate,
			constraint_columns: constraintColumns,
			database_type: databaseType,
		}),
	});
	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ detail: response.statusText }));
		throw new WarehouseSqlError(
			response.status,
			`Warehouse row predicate denied: ${describeError(errorData.detail)}`,
		);
	}
	const result = (await response.json()) as { normalized_predicate: string };
	return result.normalized_predicate;
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
			row_security: serializeRowSecurity(options.rowSecurity),
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

function serializeRowSecurity(rowSecurity: WarehouseRowSecurity) {
	if (rowSecurity.enforced === false) {
		return { enforced: false as const };
	}
	return {
		enforced: true as const,
		tables: rowSecurity.tables.map((table) => ({
			database_type: table.databaseType,
			database: table.database,
			schema: table.schema,
			table: table.table,
			constraint_columns: table.constraintColumns,
			access: table.access,
			...(table.access === 'predicate' ? { predicate: table.predicate } : {}),
		})),
	};
}

function serializeTableAccess(access: WarehouseTableAccess) {
	const enforced = (access as { enforced: unknown }).enforced;
	if (enforced === false) {
		return { enforced: false as const };
	}
	if (
		enforced === true &&
		'strict' in access &&
		typeof access.strict === 'boolean' &&
		'tables' in access &&
		Array.isArray(access.tables)
	) {
		if (!access.strict) {
			return { enforced: false as const };
		}
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
