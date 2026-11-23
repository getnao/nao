import {
	type DatabaseContextAccess,
	type DatabaseContextTableIdentity,
	isDatabaseContextTableGranted,
	normalizeDatabaseContextAccess,
} from './user-group-context';

export interface SensitiveColumnDefinition extends DatabaseContextTableIdentity {
	restrictedColumns: string[];
}

export interface ProjectColumnSecurity {
	version: 1;
	tables: SensitiveColumnDefinition[];
}

export interface UserGroupColumnPolicy extends DatabaseContextTableIdentity {
	grantedColumns: string[];
}

export interface UserGroupColumnPolicies {
	version: 1;
	policies: UserGroupColumnPolicy[];
}

export type WarehouseColumnSecurity =
	| { enforced: false }
	| {
			enforced: true;
			tables: WarehouseColumnSecurityTable[];
	  };

export type WarehouseColumnSecurityTable = SensitiveColumnDefinition &
	({ access: 'full' } | { access: 'restricted'; deniedColumns: string[] } | { access: 'blocked'; reason: string });

export type StoredProjectColumnSecurity = ProjectColumnSecurity | Record<string, unknown> | null;
export type StoredUserGroupColumnPolicies = UserGroupColumnPolicies | Record<string, unknown> | null;

export const EMPTY_PROJECT_COLUMN_SECURITY: ProjectColumnSecurity = { version: 1, tables: [] };
export const EMPTY_USER_GROUP_COLUMN_POLICIES: UserGroupColumnPolicies = { version: 1, policies: [] };

export function normalizeProjectColumnSecurity(value: ProjectColumnSecurity): ProjectColumnSecurity {
	const tables = value.tables.map(normalizeSensitiveColumnDefinition);
	assertNoNulls(tables, 'Invalid sensitive column definition.');
	assertNoDuplicateKeys(tables as SensitiveColumnDefinition[], columnSecurityTableKey, 'Duplicate sensitive table.');
	return {
		version: 1,
		tables: (tables as SensitiveColumnDefinition[]).sort(compareTables),
	};
}

export function normalizeUserGroupColumnPolicies(value: UserGroupColumnPolicies): UserGroupColumnPolicies {
	const policies = value.policies.map(normalizeColumnPolicy);
	assertNoNulls(policies, 'Invalid column policy.');
	assertNoDuplicateKeys(policies as UserGroupColumnPolicy[], columnSecurityTableKey, 'Duplicate column policy.');
	return {
		version: 1,
		policies: (policies as UserGroupColumnPolicy[]).sort(compareTables),
	};
}

export function filterProjectColumnSecurityByDatabaseContext(
	value: ProjectColumnSecurity,
	access: DatabaseContextAccess,
): ProjectColumnSecurity {
	const normalized = normalizeProjectColumnSecurity(value);
	const normalizedAccess = normalizeDatabaseContextAccess(access);
	return {
		version: 1,
		tables: normalized.tables.filter((table) => isDatabaseContextTableGranted(normalizedAccess, table)),
	};
}

export function filterUserGroupColumnPoliciesByDatabaseContext(
	value: UserGroupColumnPolicies,
	access: DatabaseContextAccess,
): UserGroupColumnPolicies {
	const normalized = normalizeUserGroupColumnPolicies(value);
	const normalizedAccess = normalizeDatabaseContextAccess(access);
	return {
		version: 1,
		policies: normalized.policies.filter((policy) => isDatabaseContextTableGranted(normalizedAccess, policy)),
	};
}

export function parseStoredProjectColumnSecurity(value: unknown): ProjectColumnSecurity {
	if (value === null || value === undefined) {
		return EMPTY_PROJECT_COLUMN_SECURITY;
	}
	const parsed = parseJson(value, 'Stored project column security JSON is malformed.');
	if (
		!isRecord(parsed) ||
		!hasOnlyKeys(parsed, ['version', 'tables']) ||
		parsed.version !== 1 ||
		!Array.isArray(parsed.tables)
	) {
		throw new Error('Stored project column security is malformed.');
	}
	return normalizeProjectColumnSecurity({ version: 1, tables: parsed.tables as SensitiveColumnDefinition[] });
}

export function parseStoredUserGroupColumnPolicies(value: unknown): UserGroupColumnPolicies {
	if (value === null || value === undefined) {
		return EMPTY_USER_GROUP_COLUMN_POLICIES;
	}
	const parsed = parseJson(value, 'Stored user group column policies JSON is malformed.');
	if (
		!isRecord(parsed) ||
		!hasOnlyKeys(parsed, ['version', 'policies']) ||
		parsed.version !== 1 ||
		!Array.isArray(parsed.policies)
	) {
		throw new Error('Stored user group column policies are malformed.');
	}
	return normalizeUserGroupColumnPolicies({ version: 1, policies: parsed.policies as UserGroupColumnPolicy[] });
}

export function serializeProjectColumnSecurity(value: ProjectColumnSecurity): ProjectColumnSecurity {
	return normalizeProjectColumnSecurity(value);
}

export function serializeUserGroupColumnPolicies(value: UserGroupColumnPolicies): UserGroupColumnPolicies {
	return normalizeUserGroupColumnPolicies(value);
}

export function resolveWarehouseColumnSecurity(
	project: ProjectColumnSecurity,
	groupPolicies: readonly UserGroupColumnPolicies[],
): WarehouseColumnSecurity {
	const normalizedProject = normalizeProjectColumnSecurity(project);
	if (normalizedProject.tables.length === 0) {
		return { enforced: false };
	}
	const grantedColumns = new Map<string, Set<string>>();
	for (const policy of groupPolicies.flatMap((group) => normalizeUserGroupColumnPolicies(group).policies)) {
		const granted = grantedColumns.get(columnSecurityTableKey(policy)) ?? new Set<string>();
		policy.grantedColumns.forEach((column) => granted.add(column));
		grantedColumns.set(columnSecurityTableKey(policy), granted);
	}
	return {
		enforced: true,
		tables: normalizedProject.tables.map((table) => {
			const granted = grantedColumns.get(columnSecurityTableKey(table)) ?? new Set<string>();
			const deniedColumns = table.restrictedColumns.filter((column) => !granted.has(column));
			return deniedColumns.length === 0
				? { ...table, access: 'full' as const }
				: { ...table, access: 'restricted' as const, deniedColumns };
		}),
	};
}

export function columnSecurityTableKey(table: DatabaseContextTableIdentity): string {
	return [table.databaseType.toLowerCase(), table.database, table.schema, table.table].join('\0');
}

export function getWarehouseColumnSecurityTable(
	security: WarehouseColumnSecurity,
	table: DatabaseContextTableIdentity,
): WarehouseColumnSecurityTable | undefined {
	if (!security.enforced) {
		return undefined;
	}
	return security.tables.find((candidate) => columnSecurityTableKey(candidate) === columnSecurityTableKey(table));
}

export function isWarehouseColumnAllowed(
	security: WarehouseColumnSecurity,
	table: DatabaseContextTableIdentity,
	column: string,
): boolean {
	const policy = getWarehouseColumnSecurityTable(security, table);
	return (
		policy === undefined ||
		policy.access === 'full' ||
		(policy.access === 'restricted' && !policy.deniedColumns.includes(column))
	);
}

function normalizeSensitiveColumnDefinition(value: unknown): SensitiveColumnDefinition | null {
	if (!hasIdentity(value) || !hasOnlyKeys(value, [...IDENTITY_KEYS, 'restrictedColumns'])) {
		return null;
	}
	const restrictedColumns = normalizeNames(value.restrictedColumns);
	return restrictedColumns === null ? null : { ...normalizeIdentity(value), restrictedColumns };
}

function normalizeColumnPolicy(value: unknown): UserGroupColumnPolicy | null {
	if (!hasIdentity(value) || !hasOnlyKeys(value, [...IDENTITY_KEYS, 'grantedColumns'])) {
		return null;
	}
	const grantedColumns = normalizeNames(value.grantedColumns);
	return grantedColumns === null ? null : { ...normalizeIdentity(value), grantedColumns };
}

const IDENTITY_KEYS = ['databaseType', 'database', 'schema', 'table'] as const;

function hasIdentity(
	value: unknown,
): value is Record<(typeof IDENTITY_KEYS)[number], string> & Record<string, unknown> {
	return (
		isRecord(value) &&
		IDENTITY_KEYS.every(
			(key) => typeof value[key] === 'string' && value[key].trim().length > 0 && value[key].length <= 255,
		)
	);
}

function normalizeIdentity(value: Record<(typeof IDENTITY_KEYS)[number], string>): DatabaseContextTableIdentity {
	return {
		databaseType: value.databaseType.trim().toLowerCase(),
		database: value.database.trim(),
		schema: value.schema.trim(),
		table: value.table.trim(),
	};
}

function normalizeNames(value: unknown): string[] | null {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > 256 ||
		value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 255)
	) {
		return null;
	}
	const names = (value as string[]).map((item) => item.trim());
	return new Set(names).size === names.length ? names.sort() : null;
}

function compareTables(left: DatabaseContextTableIdentity, right: DatabaseContextTableIdentity): number {
	return columnSecurityTableKey(left).localeCompare(columnSecurityTableKey(right));
}

function assertNoNulls<T>(values: Array<T | null>, message: string): void {
	if (values.some((value) => value === null)) {
		throw new Error(message);
	}
}

function assertNoDuplicateKeys<T>(values: T[], key: (value: T) => string, message: string): void {
	if (new Set(values.map(key)).size !== values.length) {
		throw new Error(message);
	}
}

function parseJson(value: unknown, message: string): unknown {
	if (typeof value !== 'string') {
		return value;
	}
	try {
		return JSON.parse(value);
	} catch {
		throw new Error(message);
	}
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
