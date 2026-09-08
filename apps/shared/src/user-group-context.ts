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

export interface DatabaseContextTableIdentity {
	databaseType: string;
	database: string;
	schema: string;
	table: string;
}

export type DatabaseContextAccess =
	| { mode: 'all'; strict: boolean }
	| { mode: 'restricted'; strict: boolean; grants: DatabaseContextGrant[]; patterns: string[] };

export type DocsContextGrant = { kind: 'folder'; path: string } | { kind: 'file'; path: string };

export type DocsContextAccess = { mode: 'all' } | { mode: 'restricted'; grants: DocsContextGrant[] };

export interface StoredDatabaseContextAccess {
	version: 3;
	access: DatabaseContextAccess;
}

export interface StoredUserGroupContextAccess {
	version: 4;
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
}

export const ALL_DATABASE_CONTEXT_ACCESS: DatabaseContextAccess = { mode: 'all', strict: true };
export const EMPTY_DATABASE_CONTEXT_ACCESS: DatabaseContextAccess = {
	mode: 'restricted',
	strict: true,
	grants: [],
	patterns: [],
};
export const ALL_DOCS_CONTEXT_ACCESS: DocsContextAccess = { mode: 'all' };
export const EMPTY_DOCS_CONTEXT_ACCESS: DocsContextAccess = { mode: 'restricted', grants: [] };

export function normalizeDatabaseContextAccess(access: DatabaseContextAccess): DatabaseContextAccess {
	if (access.mode === 'all') {
		return { mode: 'all', strict: access.strict };
	}

	const grants = access.grants.map(normalizeGrant).filter((grant): grant is DatabaseContextGrant => grant !== null);
	const uniqueGrants = new Map(grants.map((grant) => [grantKey(grant), grant]));
	const patterns = normalizeDatabaseContextPatterns(access.patterns);

	return {
		mode: 'restricted',
		strict: access.strict,
		grants: [...uniqueGrants.values()].sort(compareGrants),
		patterns,
	};
}

export function parseStoredDatabaseContextAccess(value: unknown): DatabaseContextAccess {
	if (
		!isRecord(value) ||
		(value.version !== 1 && value.version !== 2 && value.version !== 3) ||
		!isRecord(value.access)
	) {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}
	const strict = value.version === 3 ? value.access.strict : true;
	if (typeof strict !== 'boolean') {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}
	if (value.access.mode === 'all') {
		return { mode: 'all', strict };
	}
	if (value.access.mode !== 'restricted' || !Array.isArray(value.access.grants)) {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}
	const grants = value.access.grants.map(parseGrant);
	if (grants.some((grant) => grant === null)) {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}
	const patterns = value.version === 1 ? [] : value.access.patterns;
	if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== 'string')) {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}

	return normalizeDatabaseContextAccess({
		mode: 'restricted',
		strict,
		grants: grants as DatabaseContextGrant[],
		patterns: patterns as string[],
	});
}

export function serializeDatabaseContextAccess(access: DatabaseContextAccess): StoredDatabaseContextAccess {
	return {
		version: 3,
		access: normalizeDatabaseContextAccess(access),
	};
}

export function parseStoredUserGroupContextAccess(
	value: unknown,
	isDefault: boolean,
): { databaseAccess: DatabaseContextAccess; docsAccess: DocsContextAccess } {
	const legacyDatabaseAccess = isDefault ? ALL_DATABASE_CONTEXT_ACCESS : EMPTY_DATABASE_CONTEXT_ACCESS;
	const legacyDocsAccess = isDefault ? ALL_DOCS_CONTEXT_ACCESS : EMPTY_DOCS_CONTEXT_ACCESS;

	if (!isRecord(value)) {
		return { databaseAccess: legacyDatabaseAccess, docsAccess: legacyDocsAccess };
	}
	if (value.version === 1 || value.version === 2 || value.version === 3) {
		return {
			databaseAccess: parseStoredDatabaseContextAccess(value),
			docsAccess: legacyDocsAccess,
		};
	}
	if (value.version !== 4) {
		return {
			databaseAccess: EMPTY_DATABASE_CONTEXT_ACCESS,
			docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
		};
	}
	return {
		databaseAccess: parseDatabaseContextAccess(value.databaseAccess),
		docsAccess: parseDocsContextAccess(value.docsAccess),
	};
}

export function serializeUserGroupContextAccess(
	databaseAccess: DatabaseContextAccess,
	docsAccess: DocsContextAccess,
): StoredUserGroupContextAccess {
	return {
		version: 4,
		databaseAccess: normalizeDatabaseContextAccess(databaseAccess),
		docsAccess: normalizeDocsContextAccess(docsAccess),
	};
}

export function unionDatabaseContextAccess(accesses: readonly DatabaseContextAccess[]): DatabaseContextAccess {
	const strict = accesses.some((access) => access.strict);
	if (accesses.some((access) => access.mode === 'all')) {
		return { mode: 'all', strict };
	}

	return normalizeDatabaseContextAccess({
		mode: 'restricted',
		strict,
		grants: accesses.flatMap((access) => (access.mode === 'restricted' ? access.grants : [])),
		patterns: accesses.flatMap((access) => (access.mode === 'restricted' ? access.patterns : [])),
	});
}

export function normalizeDocsContextAccess(access: DocsContextAccess): DocsContextAccess {
	if (access.mode === 'all') {
		return ALL_DOCS_CONTEXT_ACCESS;
	}
	const grants = access.grants
		.map(normalizeDocsContextGrant)
		.filter((grant): grant is DocsContextGrant => grant !== null);
	const uniqueGrants = new Map(grants.map((grant) => [`${grant.kind}\0${grant.path}`, grant]));
	return {
		mode: 'restricted',
		grants: [...uniqueGrants.values()].sort(
			(left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind),
		),
	};
}

export function normalizeDocsContextGrant(value: unknown): DocsContextGrant | null {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ['kind', 'path']) ||
		(value.kind !== 'folder' && value.kind !== 'file') ||
		typeof value.path !== 'string'
	) {
		return null;
	}
	const normalizedPath = normalizeDocsContextPath(value.path);
	return normalizedPath === null ? null : { kind: value.kind, path: normalizedPath };
}

export function normalizeDocsContextPath(value: string): string | null {
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > 1024 ||
		normalized === 'docs' ||
		normalized.startsWith('docs/') ||
		normalized.startsWith('/') ||
		normalized.endsWith('/') ||
		normalized.includes('\\') ||
		normalized.includes('%') ||
		/^[a-zA-Z]:/.test(normalized) ||
		hasControlCharacter(normalized)
	) {
		return null;
	}
	const segments = normalized.split('/');
	if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
		return null;
	}
	return normalized;
}

export function parseDocsContextAccess(value: unknown): DocsContextAccess {
	if (!isRecord(value)) {
		return EMPTY_DOCS_CONTEXT_ACCESS;
	}
	if (value.mode === 'all') {
		return Object.keys(value).every((key) => key === 'mode') ? ALL_DOCS_CONTEXT_ACCESS : EMPTY_DOCS_CONTEXT_ACCESS;
	}
	if (
		value.mode !== 'restricted' ||
		!hasOnlyKeys(value, ['mode', 'grants']) ||
		!Array.isArray(value.grants) ||
		value.grants.length > 10_000
	) {
		return EMPTY_DOCS_CONTEXT_ACCESS;
	}
	const grants = value.grants.map(normalizeDocsContextGrant);
	if (grants.some((grant) => grant === null)) {
		return EMPTY_DOCS_CONTEXT_ACCESS;
	}
	return normalizeDocsContextAccess({ mode: 'restricted', grants: grants as DocsContextGrant[] });
}

export function unionDocsContextAccess(accesses: readonly DocsContextAccess[]): DocsContextAccess {
	if (accesses.some((access) => access.mode === 'all')) {
		return ALL_DOCS_CONTEXT_ACCESS;
	}
	return normalizeDocsContextAccess({
		mode: 'restricted',
		grants: accesses.flatMap((access) => (access.mode === 'restricted' ? access.grants : [])),
	});
}

export function isDocsContextFileGranted(access: DocsContextAccess, filePath: string): boolean {
	if (access.mode === 'all') {
		return true;
	}
	const normalizedPath = normalizeDocsContextPath(filePath);
	if (normalizedPath === null) {
		return false;
	}
	return access.grants.some(
		(grant) =>
			(grant.kind === 'file' && grant.path === normalizedPath) ||
			(grant.kind === 'folder' && normalizedPath.startsWith(`${grant.path}/`)),
	);
}

export function isDocsContextDirectoryGranted(access: DocsContextAccess, directoryPath: string): boolean {
	if (access.mode === 'all') {
		return true;
	}
	const normalizedPath = normalizeDocsContextPath(directoryPath);
	if (normalizedPath === null) {
		return false;
	}
	return access.grants.some(
		(grant) =>
			(grant.kind === 'folder' &&
				(normalizedPath === grant.path || normalizedPath.startsWith(`${grant.path}/`))) ||
			grant.path.startsWith(`${normalizedPath}/`),
	);
}

export function mayTraverseDocsContextDirectory(access: DocsContextAccess, directoryPath: string): boolean {
	if (directoryPath.trim() === '') {
		return access.mode === 'all' || access.grants.length > 0;
	}
	return isDocsContextDirectoryGranted(access, directoryPath);
}

export function normalizeDatabaseContextPatterns(patterns: readonly string[]): string[] {
	return [...new Set(patterns.map((pattern) => pattern.trim().toLowerCase()).filter(Boolean))].sort((left, right) =>
		left.localeCompare(right),
	);
}

export function matchesDatabaseContextPattern(
	pattern: string,
	table: Pick<DatabaseContextTableIdentity, 'schema' | 'table'>,
): boolean {
	const normalizedPattern = pattern.trim().toLowerCase();
	if (!normalizedPattern) {
		return false;
	}
	const qualifiedPattern = normalizedPattern.includes('.') ? normalizedPattern : `${normalizedPattern}.*`;
	return new RegExp(`^${globToRegexSource(qualifiedPattern)}$`, 'i').test(`${table.schema}.${table.table}`);
}

export function isDatabaseContextTableGranted(
	access: DatabaseContextAccess,
	table: DatabaseContextTableIdentity,
): boolean {
	if (access.mode === 'all') {
		return true;
	}
	return (
		access.grants.some((grant) => grantMatchesTable(grant, table)) ||
		access.patterns.some((pattern) => matchesDatabaseContextPattern(pattern, table))
	);
}

function parseGrant(value: unknown): DatabaseContextGrant | null {
	if (!isRecord(value)) {
		return null;
	}
	if (value.kind === 'schema') {
		if (!hasOnlyKeys(value, ['kind', 'databaseType', 'database', 'schema'])) {
			return null;
		}
		return normalizeGrant({
			kind: 'schema',
			databaseType: value.databaseType,
			database: value.database,
			schema: value.schema,
		});
	}
	if (value.kind === 'table') {
		if (!hasOnlyKeys(value, ['kind', 'databaseType', 'database', 'schema', 'table'])) {
			return null;
		}
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

function parseDatabaseContextAccess(value: unknown): DatabaseContextAccess {
	if (!isRecord(value) || typeof value.strict !== 'boolean') {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}
	if (value.mode === 'all') {
		return hasOnlyKeys(value, ['mode', 'strict'])
			? { mode: 'all', strict: value.strict }
			: EMPTY_DATABASE_CONTEXT_ACCESS;
	}
	if (
		value.mode !== 'restricted' ||
		!hasOnlyKeys(value, ['mode', 'strict', 'grants', 'patterns']) ||
		!Array.isArray(value.grants) ||
		!Array.isArray(value.patterns) ||
		value.patterns.some((pattern) => typeof pattern !== 'string')
	) {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}
	const grants = value.grants.map(parseGrant);
	if (grants.some((grant) => grant === null)) {
		return EMPTY_DATABASE_CONTEXT_ACCESS;
	}
	return normalizeDatabaseContextAccess({
		mode: 'restricted',
		strict: value.strict,
		grants: grants as DatabaseContextGrant[],
		patterns: value.patterns as string[],
	});
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

function grantMatchesTable(grant: DatabaseContextGrant, table: DatabaseContextTableIdentity): boolean {
	return (
		grant.databaseType === table.databaseType.toLowerCase() &&
		grant.database === table.database &&
		grant.schema === table.schema &&
		(grant.kind === 'schema' || grant.table === table.table)
	);
}

function globToRegexSource(pattern: string): string {
	let source = '';
	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index];
		if (character === '*') {
			source += '.*';
			continue;
		}
		if (character === '?') {
			source += '.';
			continue;
		}
		if (character === '[') {
			const characterClass = parseCharacterClass(pattern, index);
			if (characterClass) {
				source += characterClass.source;
				index = characterClass.endIndex;
				continue;
			}
		}
		source += escapeRegexCharacter(character);
	}
	return source;
}

function parseCharacterClass(pattern: string, startIndex: number): { source: string; endIndex: number } | null {
	const endIndex = pattern.indexOf(']', startIndex + 1);
	if (endIndex === -1) {
		return null;
	}
	let content = pattern.slice(startIndex + 1, endIndex);
	if (!content) {
		return null;
	}
	const negated = content.startsWith('!') || content.startsWith('^');
	if (negated) {
		content = content.slice(1);
	}
	if (!content) {
		return null;
	}
	const source = `[${negated ? '^' : ''}${content.replaceAll('\\', '\\\\')}]`;
	try {
		new RegExp(source);
		return { source, endIndex };
	} catch {
		return null;
	}
}

function escapeRegexCharacter(character: string): string {
	return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
	});
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowedKeys = new Set(keys);
	return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
