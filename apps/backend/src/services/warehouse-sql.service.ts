import type { WarehouseRowSecurity } from '@nao/shared';

import { env } from '../env';
import { assertWarehouseTableAccess, type WarehouseTableAccess } from './context-access';

const BYTES_PER_MB = 1024 * 1024;

interface WarehouseSqlOptions {
	projectFolder: string;
	databaseId?: string;
	envVars?: Record<string, string>;
	warehouseAccessToken?: string | null;
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

export interface WarehouseSqlValidation {
	valid: true;
	dialect: string;
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

export async function validateWarehouseSql(sql: string, options: WarehouseSqlOptions): Promise<WarehouseSqlValidation> {
	return requestWarehouseSql<WarehouseSqlValidation>('/validate_sql', sql, options);
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
			...(options.warehouseAccessToken && { user_access_token: options.warehouseAccessToken }),
		}),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ detail: response.statusText }));
		throw new WarehouseSqlError(
			response.status,
			`Warehouse SQL request denied: ${describeError(errorData.detail)}`,
		);
	}

	return readJsonWithinLimit<T>(response, env.NAO_QUERY_RESULT_MAX_SIZE_MB * BYTES_PER_MB);
}

/** A result over ~2 GB cannot even be parsed, so the body is read under a cap and rejected early when the server declares its size. */
async function readJsonWithinLimit<T>(response: Response, maxBytes: number): Promise<T> {
	const declaredBytes = Number(response.headers.get('content-length'));
	if (declaredBytes > maxBytes) {
		await response.body?.cancel();
		throw resultTooLargeError(declaredBytes);
	}
	return JSON.parse(await readBodyWithinLimit(response, maxBytes)) as T;
}

async function readBodyWithinLimit(response: Response, maxBytes: number): Promise<string> {
	if (!response.body) {
		return response.text();
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let readBytes = 0;
	for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
		readBytes += chunk.value.byteLength;
		if (readBytes > maxBytes) {
			await reader.cancel();
			throw resultTooLargeError();
		}
		chunks.push(chunk.value);
	}
	return Buffer.concat(chunks).toString('utf8');
}

function resultTooLargeError(resultBytes?: number): WarehouseSqlError {
	const size = resultBytes ? `${Math.ceil(resultBytes / BYTES_PER_MB).toLocaleString('en-US')} MB` : 'larger';
	return new WarehouseSqlError(
		413,
		`Query result is ${size}, above the ${env.NAO_QUERY_RESULT_MAX_SIZE_MB} MB limit. ` +
			'Aggregate or filter the query, or add a LIMIT, so it returns less data.',
	);
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
			...(table.access === 'blocked' ? { reason: table.reason } : {}),
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
