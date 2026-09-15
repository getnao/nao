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

export const ROW_SECURITY_OPERATORS = [
	'equals',
	'does-not-equal',
	'greater-than',
	'greater-than-or-equal',
	'less-than',
	'less-than-or-equal',
	'is-one-of',
	'is-not-one-of',
	'is-null',
	'is-not-null',
] as const;

export type RowSecurityOperator = (typeof ROW_SECURITY_OPERATORS)[number];

export interface RowSecurityCondition {
	column: string;
	operator: RowSecurityOperator;
	value?: string;
}

export const ROW_SECURITY_COMBINATORS = ['and', 'or'] as const;

export type RowSecurityCombinator = (typeof ROW_SECURITY_COMBINATORS)[number];

export const ROW_SECURITY_MAX_CONDITIONS = 100;
export const ROW_SECURITY_MAX_VALUE_LENGTH = 10_000;

export type UserGroupTablePolicy =
	| (RowSecurityTableIdentity & { access: 'full' })
	| (RowSecurityTableIdentity & {
			access: 'predicate';
			mode: 'guided';
			combinator: RowSecurityCombinator;
			conditions: RowSecurityCondition[];
	  })
	| (RowSecurityTableIdentity & { access: 'predicate'; mode: 'sql'; predicate: string });

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
	return normalizeUserGroupRowPolicies({
		version: 1,
		policies: parsed.policies
			.filter((policy) => !isLegacyRawPredicatePolicy(policy))
			.map(migrateLegacyGuidedPolicy)
			.map(migrateLegacySqlPolicy) as UserGroupTablePolicy[],
	});
}

export function serializeProjectRowSecurity(value: ProjectRowSecurity): ProjectRowSecurity {
	return normalizeProjectRowSecurity(value);
}

export function serializeUserGroupRowPolicies(value: UserGroupRowPolicies): UserGroupRowPolicies {
	return normalizeUserGroupRowPolicies(value);
}

export function stripRowSecurityWhereClause(value: string): string | null {
	const match = /^\s*where\b([\s\S]*)$/i.exec(value);
	const predicate = match?.[1].trim();
	return predicate ? predicate : null;
}

export function compileRowSecurityConditions(
	conditions: readonly RowSecurityCondition[],
	databaseType: string,
	combinator: RowSecurityCombinator = 'and',
): string {
	const normalized = normalizeConditions(conditions);
	if (normalized === null || !isRowSecurityCombinator(combinator)) {
		throw new Error('Invalid row security conditions.');
	}
	return `(${normalized
		.map((condition) => compileCondition(condition, databaseType))
		.join(` ${combinator.toUpperCase()} `)})`;
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
				.map((policy) => {
					if (policy.mode === 'guided') {
						return compileRowSecurityConditions(policy.conditions, policy.databaseType, policy.combinator);
					}
					const predicate = stripRowSecurityWhereClause(policy.predicate);
					if (predicate === null) {
						throw new Error('Invalid SQL row policy.');
					}
					return `(${predicate})`;
				});
			return predicates.length === 0
				? { ...table, access: 'none' as const }
				: {
						...table,
						access: 'predicate' as const,
						predicate: predicates.join(' OR '),
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
	if (value.mode === 'guided') {
		if (
			!hasOnlyKeys(value, [...IDENTITY_KEYS, 'access', 'mode', 'combinator', 'conditions']) ||
			typeof value.combinator !== 'string' ||
			!isRowSecurityCombinator(value.combinator) ||
			!Array.isArray(value.conditions)
		) {
			return null;
		}
		const conditions = normalizeConditions(value.conditions);
		return conditions === null
			? null
			: {
					...normalizeIdentity(value),
					access: 'predicate',
					mode: 'guided',
					combinator: value.combinator,
					conditions,
				};
	}
	if (
		value.mode !== 'sql' ||
		!hasOnlyKeys(value, [...IDENTITY_KEYS, 'access', 'mode', 'predicate']) ||
		typeof value.predicate !== 'string'
	) {
		return null;
	}
	const predicate = value.predicate.trim();
	const predicateBody = stripRowSecurityWhereClause(predicate);
	return predicateBody === null || predicate.length > ROW_SECURITY_MAX_VALUE_LENGTH
		? null
		: { ...normalizeIdentity(value), access: 'predicate', mode: 'sql', predicate: `WHERE ${predicateBody}` };
}

function migrateLegacyGuidedPolicy(value: unknown): unknown {
	if (
		hasIdentity(value) &&
		value.access === 'predicate' &&
		hasOnlyKeys(value, [...IDENTITY_KEYS, 'access', 'conditions']) &&
		Array.isArray(value.conditions)
	) {
		return { ...value, mode: 'guided', combinator: 'and' };
	}
	return value;
}

function migrateLegacySqlPolicy(value: unknown): unknown {
	if (
		hasIdentity(value) &&
		value.access === 'predicate' &&
		value.mode === 'sql' &&
		hasOnlyKeys(value, [...IDENTITY_KEYS, 'access', 'mode', 'predicate']) &&
		typeof value.predicate === 'string' &&
		value.predicate.trim().length > 0 &&
		value.predicate.length <= ROW_SECURITY_MAX_VALUE_LENGTH &&
		!hasLeadingWhereKeyword(value.predicate)
	) {
		return { ...value, predicate: `WHERE ${value.predicate.trim()}` };
	}
	return value;
}

function isLegacyRawPredicatePolicy(value: unknown): boolean {
	if (
		!hasIdentity(value) ||
		value.access !== 'predicate' ||
		!hasOnlyKeys(value, [...IDENTITY_KEYS, 'access', 'predicate']) ||
		typeof value.predicate !== 'string'
	) {
		return false;
	}
	const predicate = value.predicate.trim();
	return predicate.length > 0 && predicate.length <= ROW_SECURITY_MAX_VALUE_LENGTH;
}

function hasLeadingWhereKeyword(value: string): boolean {
	return /^\s*where\b/i.test(value);
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

function normalizeConditions(values: readonly unknown[]): RowSecurityCondition[] | null {
	if (values.length === 0 || values.length > ROW_SECURITY_MAX_CONDITIONS) {
		return null;
	}
	const conditions = values.map(normalizeCondition);
	return conditions.some((condition) => condition === null) ? null : (conditions as RowSecurityCondition[]);
}

function normalizeCondition(value: unknown): RowSecurityCondition | null {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ['column', 'operator', 'value']) ||
		typeof value.column !== 'string' ||
		!value.column.trim() ||
		value.column.length > 255 ||
		typeof value.operator !== 'string' ||
		!isRowSecurityOperator(value.operator)
	) {
		return null;
	}
	const column = value.column.trim();
	if (operatorNeedsValue(value.operator)) {
		if (
			typeof value.value !== 'string' ||
			!value.value.trim() ||
			value.value.length > ROW_SECURITY_MAX_VALUE_LENGTH ||
			(isListOperator(value.operator) && value.value.split(',').some((item) => !item.trim()))
		) {
			return null;
		}
		return { column, operator: value.operator, value: value.value.trim() };
	}
	return 'value' in value ? null : { column, operator: value.operator };
}

function compileCondition(condition: RowSecurityCondition, databaseType: string): string {
	const column = quoteIdentifier(condition.column, databaseType);
	switch (condition.operator) {
		case 'equals':
			return `${column} = ${compileValue(condition.value!)}`;
		case 'does-not-equal':
			return `${column} <> ${compileValue(condition.value!)}`;
		case 'greater-than':
			return `${column} > ${compileValue(condition.value!)}`;
		case 'greater-than-or-equal':
			return `${column} >= ${compileValue(condition.value!)}`;
		case 'less-than':
			return `${column} < ${compileValue(condition.value!)}`;
		case 'less-than-or-equal':
			return `${column} <= ${compileValue(condition.value!)}`;
		case 'is-one-of':
			return `${column} IN (${compileList(condition.value!)})`;
		case 'is-not-one-of':
			return `${column} NOT IN (${compileList(condition.value!)})`;
		case 'is-null':
			return `${column} IS NULL`;
		case 'is-not-null':
			return `${column} IS NOT NULL`;
	}
}

function compileList(value: string): string {
	return value
		.split(',')
		.map((item) => compileValue(item))
		.join(', ');
}

function compileValue(value: string): string {
	const normalized = value.trim();
	const number = Number(normalized);
	if (Number.isFinite(number)) {
		return String(number);
	}
	if (normalized.toLowerCase() === 'true' || normalized.toLowerCase() === 'false') {
		return normalized.toUpperCase();
	}
	return `'${normalized.replaceAll("'", "''")}'`;
}

function quoteIdentifier(value: string, databaseType: string): string {
	switch (databaseType.toLowerCase()) {
		case 'bigquery':
		case 'databricks':
		case 'mysql':
		case 'starrocks':
			return `\`${value.replaceAll('`', '``')}\``;
		case 'fabric':
		case 'mssql':
			return `[${value.replaceAll(']', ']]')}]`;
		default:
			return `"${value.replaceAll('"', '""')}"`;
	}
}

function operatorNeedsValue(operator: RowSecurityOperator): boolean {
	return operator !== 'is-null' && operator !== 'is-not-null';
}

function isListOperator(operator: RowSecurityOperator): boolean {
	return operator === 'is-one-of' || operator === 'is-not-one-of';
}

function isRowSecurityOperator(value: string): value is RowSecurityOperator {
	return (ROW_SECURITY_OPERATORS as readonly string[]).includes(value);
}

function isRowSecurityCombinator(value: string): value is RowSecurityCombinator {
	return (ROW_SECURITY_COMBINATORS as readonly string[]).includes(value);
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
