export interface RowSecurityTableIdentity {
	databaseType: string;
	database: string;
	schema: string;
	table: string;
}

export interface SensitiveTableDefinition extends RowSecurityTableIdentity {
	constraintColumns: string[];
}

export interface ProjectRowSecurity {
	version: 1;
	tables: SensitiveTableDefinition[];
}

export type UserGroupTablePolicy =
	| (RowSecurityTableIdentity & { access: 'full' })
	| (RowSecurityTableIdentity & { access: 'predicate'; predicate: string });

export interface UserGroupRowPolicies {
	version: 1;
	policies: UserGroupTablePolicy[];
}

export type WarehouseRowSecurity =
	| { enforced: false }
	| {
			enforced: true;
			tables: Array<
				SensitiveTableDefinition &
					({ access: 'full' } | { access: 'predicate'; predicate: string } | { access: 'none' })
			>;
	  };

export type StoredProjectRowSecurity = ProjectRowSecurity | Record<string, unknown> | null;
export type StoredUserGroupRowPolicies = UserGroupRowPolicies | Record<string, unknown> | null;

export const EMPTY_PROJECT_ROW_SECURITY: ProjectRowSecurity = { version: 1, tables: [] };
export const EMPTY_USER_GROUP_ROW_POLICIES: UserGroupRowPolicies = { version: 1, policies: [] };

export function normalizeProjectRowSecurity(value: ProjectRowSecurity): ProjectRowSecurity {
	const tables = value.tables.map(normalizeSensitiveTableDefinition);
	assertNoNulls(tables, 'Invalid sensitive table definition.');
	return {
		version: 1,
		tables: deduplicate(tables as SensitiveTableDefinition[], tableKey).sort(compareTables),
	};
}

export function normalizeUserGroupRowPolicies(value: UserGroupRowPolicies): UserGroupRowPolicies {
	const policies = value.policies.map(normalizeTablePolicy);
	assertNoNulls(policies, 'Invalid row policy.');
	return {
		version: 1,
		policies: deduplicate(policies as UserGroupTablePolicy[], tableKey).sort(compareTables),
	};
}

export function parseStoredProjectRowSecurity(value: unknown): ProjectRowSecurity {
	if (value === null || value === undefined) {
		return EMPTY_PROJECT_ROW_SECURITY;
	}
	const parsed = parseJson(value);
	if (
		!isRecord(parsed) ||
		!hasOnlyKeys(parsed, ['version', 'tables']) ||
		parsed.version !== 1 ||
		!Array.isArray(parsed.tables)
	) {
		throw new Error('Stored project row security is malformed.');
	}
	return normalizeProjectRowSecurity({ version: 1, tables: parsed.tables as SensitiveTableDefinition[] });
}

export function parseStoredUserGroupRowPolicies(value: unknown): UserGroupRowPolicies {
	if (value === null || value === undefined) {
		return EMPTY_USER_GROUP_ROW_POLICIES;
	}
	const parsed = parseJson(value);
	if (
		!isRecord(parsed) ||
		!hasOnlyKeys(parsed, ['version', 'policies']) ||
		parsed.version !== 1 ||
		!Array.isArray(parsed.policies)
	) {
		throw new Error('Stored user group row policies are malformed.');
	}
	return normalizeUserGroupRowPolicies({ version: 1, policies: parsed.policies as UserGroupTablePolicy[] });
}

export function serializeProjectRowSecurity(value: ProjectRowSecurity): ProjectRowSecurity {
	return normalizeProjectRowSecurity(value);
}

export function serializeUserGroupRowPolicies(value: UserGroupRowPolicies): UserGroupRowPolicies {
	return normalizeUserGroupRowPolicies(value);
}

export function resolveWarehouseRowSecurity(
	project: ProjectRowSecurity,
	groupPolicies: readonly UserGroupRowPolicies[],
): WarehouseRowSecurity {
	if (project.tables.length === 0) {
		return { enforced: false };
	}
	const policies = groupPolicies.flatMap((group) => group.policies);
	return {
		enforced: true,
		tables: project.tables.map((table) => {
			const matching = policies.filter((policy) => tableKey(policy) === tableKey(table));
			if (matching.some((policy) => policy.access === 'full')) {
				return { ...table, access: 'full' as const };
			}
			const predicates = matching
				.filter(
					(policy): policy is Extract<UserGroupTablePolicy, { access: 'predicate' }> =>
						policy.access === 'predicate',
				)
				.map((policy) => policy.predicate.trim())
				.filter(Boolean);
			return predicates.length === 0
				? { ...table, access: 'none' as const }
				: {
						...table,
						access: 'predicate' as const,
						predicate: predicates.map((predicate) => `(${predicate})`).join(' OR '),
					};
		}),
	};
}

export function rowSecurityTableKey(table: RowSecurityTableIdentity): string {
	return tableKey(table);
}

function normalizeSensitiveTableDefinition(value: unknown): SensitiveTableDefinition | null {
	if (!hasIdentity(value) || !hasOnlyKeys(value, [...IDENTITY_KEYS, 'constraintColumns'])) {
		return null;
	}
	if (!Array.isArray(value.constraintColumns) || value.constraintColumns.length === 0) {
		return null;
	}
	const constraintColumns = normalizeNames(value.constraintColumns);
	if (constraintColumns.length !== value.constraintColumns.length) {
		return null;
	}
	return { ...normalizeIdentity(value), constraintColumns };
}

function normalizeTablePolicy(value: unknown): UserGroupTablePolicy | null {
	if (!hasIdentity(value) || (value.access !== 'full' && value.access !== 'predicate')) {
		return null;
	}
	if (value.access === 'full') {
		return hasOnlyKeys(value, [...IDENTITY_KEYS, 'access'])
			? { ...normalizeIdentity(value), access: 'full' }
			: null;
	}
	if (!hasOnlyKeys(value, [...IDENTITY_KEYS, 'access', 'predicate']) || typeof value.predicate !== 'string') {
		return null;
	}
	const predicate = value.predicate.trim();
	return predicate && predicate.length <= 10_000
		? { ...normalizeIdentity(value), access: 'predicate', predicate }
		: null;
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

function normalizeIdentity(value: Record<(typeof IDENTITY_KEYS)[number], string>): RowSecurityTableIdentity {
	return {
		databaseType: value.databaseType.trim().toLowerCase(),
		database: value.database.trim(),
		schema: value.schema.trim(),
		table: value.table.trim(),
	};
}

function normalizeNames(value: unknown[]): string[] {
	if (value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 255)) {
		return [];
	}
	return [...new Set((value as string[]).map((item) => item.trim()))].sort();
}

function deduplicate<T>(values: T[], key: (value: T) => string): T[] {
	return [...new Map(values.map((value) => [key(value), value])).values()];
}

function tableKey(table: RowSecurityTableIdentity): string {
	return [table.databaseType.toLowerCase(), table.database, table.schema, table.table].join('\0');
}

function compareTables(left: RowSecurityTableIdentity, right: RowSecurityTableIdentity): number {
	return tableKey(left).localeCompare(tableKey(right));
}

function assertNoNulls<T>(values: Array<T | null>, message: string): void {
	if (values.some((value) => value === null)) {
		throw new Error(message);
	}
}

function parseJson(value: unknown): unknown {
	if (typeof value !== 'string') {
		return value;
	}
	try {
		return JSON.parse(value);
	} catch {
		throw new Error('Stored row security JSON is malformed.');
	}
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
