export type DatabaseContextGrant = DatabaseSchemaGrant | DatabaseTableGrant;

export interface DatabaseSchemaGrant {
	kind: 'schema';
	databaseType: string;
	database: string;
	schema: string;
}

export interface DatabaseTableGrant {
	kind: 'table';
	databaseType: string;
	database: string;
	schema: string;
	table: string;
}

export type DatabaseContextAccess = { mode: 'all' } | { mode: 'restricted'; grants: DatabaseContextGrant[] };

export interface StoredDatabaseContextAccess {
	version: 1;
	access: DatabaseContextAccess;
}

export const ALL_DATABASE_CONTEXT_ACCESS: DatabaseContextAccess = { mode: 'all' };
export const EMPTY_DATABASE_CONTEXT_ACCESS: DatabaseContextAccess = { mode: 'restricted', grants: [] };

export function normalizeDatabaseContextAccess(access: DatabaseContextAccess): DatabaseContextAccess {
	if (access.mode === 'all') {
		return ALL_DATABASE_CONTEXT_ACCESS;
	}

	const grants = access.grants.map(normalizeGrant).filter((grant): grant is DatabaseContextGrant => grant !== null);
	const uniqueGrants = new Map(grants.map((grant) => [grantKey(grant), grant]));

	return {
		mode: 'restricted',
		grants: [...uniqueGrants.values()].sort(compareGrants),
	};
}

export function parseStoredDatabaseContextAccess(value: unknown): DatabaseContextAccess {
	if (!isRecord(value) || value.version !== 1 || !isRecord(value.access)) {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}
	if (value.access.mode === 'all') {
		return ALL_DATABASE_CONTEXT_ACCESS;
	}
	if (value.access.mode !== 'restricted' || !Array.isArray(value.access.grants)) {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}

	const grants = value.access.grants.map(parseGrant);
	if (grants.some((grant) => grant === null)) {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}

	return normalizeDatabaseContextAccess({
		mode: 'restricted',
		grants: grants as DatabaseContextGrant[],
	});
}

export function serializeDatabaseContextAccess(access: DatabaseContextAccess): StoredDatabaseContextAccess {
	return {
		version: 1,
		access: normalizeDatabaseContextAccess(access),
	};
}

export function unionDatabaseContextAccess(accesses: readonly DatabaseContextAccess[]): DatabaseContextAccess {
	if (accesses.some((access) => access.mode === 'all')) {
		return ALL_DATABASE_CONTEXT_ACCESS;
	}

	return normalizeDatabaseContextAccess({
		mode: 'restricted',
		grants: accesses.flatMap((access) => (access.mode === 'restricted' ? access.grants : [])),
	});
}

function parseGrant(value: unknown): DatabaseContextGrant | null {
	if (!isRecord(value)) {
		return null;
	}
	if (value.kind === 'schema') {
		return normalizeGrant({
			kind: 'schema',
			databaseType: value.databaseType,
			database: value.database,
			schema: value.schema,
		});
	}
	if (value.kind === 'table') {
		return normalizeGrant({
			kind: 'table',
			databaseType: value.databaseType,
			database: value.database,
			schema: value.schema,
			table: value.table,
		});
	}
	return null;
}

function normalizeGrant(value: {
	kind: unknown;
	databaseType: unknown;
	database: unknown;
	schema: unknown;
	table?: unknown;
}): DatabaseContextGrant | null {
	if (
		typeof value.databaseType !== 'string' ||
		typeof value.database !== 'string' ||
		typeof value.schema !== 'string'
	) {
		return null;
	}
	const databaseType = value.databaseType.trim().toLowerCase();
	const database = value.database.trim();
	const schema = value.schema.trim();
	if (!databaseType || !database || !schema) {
		return null;
	}
	if (value.kind === 'schema') {
		return { kind: 'schema', databaseType, database, schema };
	}
	if (value.kind !== 'table' || typeof value.table !== 'string' || !value.table.trim()) {
		return null;
	}
	return { kind: 'table', databaseType, database, schema, table: value.table.trim() };
}

function grantKey(grant: DatabaseContextGrant): string {
	return [
		grant.kind,
		grant.databaseType,
		grant.database,
		grant.schema,
		grant.kind === 'table' ? grant.table : '',
	].join('\0');
}

function compareGrants(left: DatabaseContextGrant, right: DatabaseContextGrant): number {
	return (
		left.databaseType.localeCompare(right.databaseType) ||
		left.database.localeCompare(right.database) ||
		left.schema.localeCompare(right.schema) ||
		left.kind.localeCompare(right.kind) ||
		(left.kind === 'table' ? left.table : '').localeCompare(right.kind === 'table' ? right.table : '')
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
