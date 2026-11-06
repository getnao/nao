import {
	type DatabaseContextTableIdentity,
	getWarehouseColumnSecurityTable,
	type WarehouseColumnSecurity,
} from '@nao/shared';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

type ColumnCatalogDocument = {
	version?: unknown;
	schemas?: Record<string, Record<string, Array<{ name?: unknown; type?: unknown }>>>;
};

const COLUMN_CATALOG_CACHE_MAX_ENTRIES = 100;
const columnCatalogCache = new Map<string, { document: ColumnCatalogDocument | null; freshnessSignature: string }>();

export function renderColumnSecurityTableFile(
	projectFolder: string,
	virtualPath: string,
	warehouseColumnSecurity: WarehouseColumnSecurity,
): string | null | undefined {
	const match = /^\/?databases\/type=([^/]+)\/database=([^/]+)\/schema=([^/]+)\/table=([^/]+)\/columns\.md$/i.exec(
		virtualPath,
	);
	if (!match) {
		return undefined;
	}
	const table = {
		databaseType: match[1],
		database: match[2],
		schema: match[3],
		table: match[4],
	};
	const policy = getWarehouseColumnSecurityTable(warehouseColumnSecurity, table);
	if (policy?.access === 'blocked') {
		return null;
	}
	if (policy?.access !== 'restricted') {
		return undefined;
	}
	return renderSafeTableColumns(projectFolder, table, policy.deniedColumns);
}

export function renderSafeTableColumns(
	projectFolder: string,
	table: DatabaseContextTableIdentity,
	deniedColumns: readonly string[],
): string | null {
	const catalogPath = join(
		projectFolder,
		'.meta',
		'databases',
		`type=${table.databaseType}`,
		`database=${table.database}`,
		'columns.json',
	);
	const document = getColumnCatalogDocument(catalogPath);
	if (document?.version !== 1) {
		return null;
	}
	const columns = document.schemas?.[table.schema]?.[table.table];
	if (!Array.isArray(columns)) {
		return null;
	}
	const denied = new Set(deniedColumns);
	const allowed = columns.filter(
		(column): column is { name: string; type: string } =>
			typeof column.name === 'string' && typeof column.type === 'string' && !denied.has(column.name),
	);
	return [
		`# ${table.table}`,
		'',
		`**Dataset:** \`${table.schema}\``,
		'',
		`## Columns (${allowed.length})`,
		'',
		...allowed.map((column) => `- ${column.name} (${column.type})`),
	].join('\n');
}

export function resetColumnCatalogCacheForTesting(): void {
	columnCatalogCache.clear();
}

function getColumnCatalogDocument(catalogPath: string): ColumnCatalogDocument | null {
	const freshnessSignature = getFileFreshnessSignature(catalogPath);
	const cached = columnCatalogCache.get(catalogPath);
	if (cached?.freshnessSignature === freshnessSignature) {
		return cached.document;
	}
	let document: ColumnCatalogDocument | null = null;
	try {
		document = JSON.parse(readFileSync(catalogPath, 'utf-8')) as ColumnCatalogDocument;
	} catch {
		document = null;
	}
	setBoundedCacheEntry(catalogPath, { document, freshnessSignature });
	return document;
}

function getFileFreshnessSignature(filePath: string): string {
	try {
		const stats = statSync(filePath);
		return `${stats.ino}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}`;
	} catch {
		return 'missing';
	}
}

function setBoundedCacheEntry(
	key: string,
	value: { document: ColumnCatalogDocument | null; freshnessSignature: string },
): void {
	columnCatalogCache.delete(key);
	while (columnCatalogCache.size >= COLUMN_CATALOG_CACHE_MAX_ENTRIES) {
		const oldestKey = columnCatalogCache.keys().next().value;
		if (oldestKey === undefined) {
			break;
		}
		columnCatalogCache.delete(oldestKey);
	}
	columnCatalogCache.set(key, value);
}
