import type { DatabaseContextAccess, DatabaseContextGrant } from '@nao/shared';

import type { DatabaseContextCatalog, DatabaseObject } from '../agents/user-rules';

export interface WarehouseTableIdentity {
	databaseType: string;
	database: string;
	schema: string;
	table: string;
}

export type WarehouseTableAccess =
	| { enforced: false }
	| {
			enforced: true;
			tables: WarehouseTableIdentity[];
	  };

export function expandDatabaseAccess(
	access: DatabaseContextAccess,
	catalog: DatabaseContextCatalog,
): WarehouseTableAccess {
	if (catalog.syncState === 'missing') {
		return { enforced: true, tables: [] };
	}

	const tables = catalog.objects.filter(
		(object) => access.mode === 'all' || access.grants.some((grant) => matchesGrant(grant, object)),
	);
	return { enforced: true, tables: deduplicateAndSortTables(tables) };
}

export function isDatabaseObjectAllowed(access: WarehouseTableAccess, object: DatabaseObject): boolean {
	return isWarehouseTableAllowed(access, {
		databaseType: object.type,
		database: object.database,
		schema: object.schema,
		table: object.table,
	});
}

export function isWarehouseTableAllowed(access: WarehouseTableAccess, table: WarehouseTableIdentity): boolean {
	if (!access.enforced) {
		return true;
	}
	const databaseType = table.databaseType.toLowerCase();
	return access.tables.some(
		(allowed) =>
			allowed.databaseType === databaseType &&
			allowed.database === table.database &&
			allowed.schema === table.schema &&
			allowed.table === table.table,
	);
}

export function isContextPathAllowed(access: WarehouseTableAccess, contextPath: string): boolean {
	if (!access.enforced) {
		return true;
	}

	const identity = parseDatabaseContextPath(contextPath);
	if (identity === undefined) {
		return true;
	}
	if (identity === null) {
		return false;
	}

	return access.tables.some(
		(table) =>
			(identity.databaseType === undefined || table.databaseType === identity.databaseType) &&
			(identity.database === undefined || table.database === identity.database) &&
			(identity.schema === undefined || table.schema === identity.schema) &&
			(identity.table === undefined || table.table === identity.table),
	);
}

export function assertContextPathAllowed(access: WarehouseTableAccess | undefined, contextPath: string): void {
	if (!access) {
		throw new Error('Warehouse table access was not resolved for this request.');
	}
	if (!isContextPathAllowed(access, contextPath)) {
		throw new Error(`Access denied: ${contextPath}`);
	}
}

export function assertWarehouseTableAccess(access: WarehouseTableAccess | undefined): WarehouseTableAccess {
	if (!access) {
		throw new Error('Warehouse table access was not resolved for this request.');
	}
	return access;
}

function matchesGrant(grant: DatabaseContextGrant, table: WarehouseTableIdentity): boolean {
	return (
		grant.databaseType === table.databaseType &&
		grant.database === table.database &&
		grant.schema === table.schema &&
		(grant.kind === 'schema' || grant.table === table.table)
	);
}

function deduplicateAndSortTables(tables: WarehouseTableIdentity[]): WarehouseTableIdentity[] {
	const unique = new Map<string, WarehouseTableIdentity>();
	for (const table of tables) {
		const normalized = { ...table, databaseType: table.databaseType.toLowerCase() };
		unique.set(tableKey(normalized), normalized);
	}
	return [...unique.values()].sort(compareTables);
}

function tableKey(table: WarehouseTableIdentity): string {
	return [table.databaseType, table.database, table.schema, table.table].join('\0');
}

function compareTables(left: WarehouseTableIdentity, right: WarehouseTableIdentity): number {
	return (
		left.databaseType.localeCompare(right.databaseType) ||
		left.database.localeCompare(right.database) ||
		left.schema.localeCompare(right.schema) ||
		left.table.localeCompare(right.table)
	);
}

function parseDatabaseContextPath(contextPath: string): Partial<WarehouseTableIdentity> | null | undefined {
	const parts = contextPath.replaceAll('\\', '/').split('/').filter(Boolean);
	if (parts[0] !== 'databases') {
		return undefined;
	}

	const databaseParts = parts.slice(1);
	const identity: Partial<WarehouseTableIdentity> = {};
	const expected = [
		['type=', 'databaseType'],
		['database=', 'database'],
		['schema=', 'schema'],
		['table=', 'table'],
	] as const;

	for (let index = 0; index < databaseParts.length && index < expected.length; index++) {
		const [prefix, key] = expected[index];
		if (!databaseParts[index].startsWith(prefix)) {
			return null;
		}
		const value = databaseParts[index].slice(prefix.length);
		if (!value) {
			return null;
		}
		identity[key] = key === 'databaseType' ? value.toLowerCase() : value;
	}

	return identity;
}
