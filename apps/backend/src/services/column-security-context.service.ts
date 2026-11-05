import {
	type DatabaseContextTableIdentity,
	getWarehouseColumnSecurityTable,
	type WarehouseColumnSecurity,
} from '@nao/shared';
import { readFileSync } from 'fs';
import { join } from 'path';

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
	try {
		const catalogPath = join(
			projectFolder,
			'.meta',
			'databases',
			`type=${table.databaseType}`,
			`database=${table.database}`,
			'columns.json',
		);
		const document = JSON.parse(readFileSync(catalogPath, 'utf-8')) as {
			version?: unknown;
			schemas?: Record<string, Record<string, Array<{ name?: unknown; type?: unknown }>>>;
		};
		if (document.version !== 1) {
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
	} catch {
		return null;
	}
}
