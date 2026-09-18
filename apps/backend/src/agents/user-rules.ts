import type { UserRulesGroupAccess } from '@nao/shared/rules-template';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { renderRootRulesForAgent } from '../services/agent-visible-project-file.service';
import { isDatabaseObjectAllowed, type WarehouseTableAccess } from '../services/context-access';

/**
 * Reads user-defined rules from RULES.md in the project folder if it exists
 */
export function getUserRules(
	projectFolder: string,
	groupAccess: UserRulesGroupAccess = { enforced: false },
): string | undefined {
	const rulesPath = join(projectFolder, 'RULES.md');

	if (!existsSync(rulesPath)) {
		return undefined;
	}

	try {
		const renderedRules = renderRootRulesForAgent(readFileSync(rulesPath, 'utf-8'), groupAccess);
		if (!renderedRules) {
			throw new Error('RULES.md could not be rendered safely');
		}
		return renderedRules.content;
	} catch (error) {
		console.error('Error reading RULES.md:', error);
		return undefined;
	}
}

type Connection = {
	type: string;
	database: string;
};

export function getConnections(projectFolder: string): Connection[] | undefined {
	const databasesPath = join(projectFolder, 'databases');

	if (!existsSync(databasesPath)) {
		return undefined;
	}

	try {
		const connections = readDirEntries(databasesPath, 'type=').flatMap(({ name: type, path: typePath }) =>
			readDirEntries(typePath, 'database=').map(({ name: database }) => ({ type, database })),
		);

		return connections.length > 0 ? connections : undefined;
	} catch (error) {
		console.error('Error reading databases folder:', error);
		return undefined;
	}
}

export type DatabaseObject = {
	type: string;
	database: string;
	schema: string;
	table: string;
	fqdn: string;
};

export type DatabaseContextCatalog = {
	syncState: 'missing' | 'ready';
	objects: Array<{
		databaseType: string;
		database: string;
		schema: string;
		table: string;
		columns: string[];
	}>;
};

const DATABASE_OBJECTS_TTL_MS = 5 * 60 * 1000;
const databaseObjectsCache = new Map<string, { objects: DatabaseObject[]; expiresAt: number }>();
const databaseContextCatalogCache = new Map<string, { catalog: DatabaseContextCatalog; expiresAt: number }>();

export function getDatabaseObjects(projectFolder: string): DatabaseObject[] {
	const cached = databaseObjectsCache.get(projectFolder);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.objects;
	}

	const objects = readDatabaseObjectsFromDisk(projectFolder);
	databaseObjectsCache.set(projectFolder, { objects, expiresAt: Date.now() + DATABASE_OBJECTS_TTL_MS });
	return objects;
}

export function getDatabaseContextCatalog(
	projectFolder: string,
	options: { fresh?: boolean } = {},
): DatabaseContextCatalog {
	const cached = databaseContextCatalogCache.get(projectFolder);
	if (!options.fresh && cached && Date.now() < cached.expiresAt) {
		return cached.catalog;
	}

	const catalog = readDatabaseContextCatalogFromDisk(projectFolder);
	databaseContextCatalogCache.set(projectFolder, {
		catalog,
		expiresAt: Date.now() + DATABASE_OBJECTS_TTL_MS,
	});
	return catalog;
}

function readDatabaseContextCatalogFromDisk(projectFolder: string): DatabaseContextCatalog {
	const scan = scanDatabaseObjects(projectFolder);
	return {
		syncState: scan.syncState,
		objects: scan.objects
			.map(({ type, database, schema, table }) => ({
				databaseType: type.toLowerCase(),
				database,
				schema,
				table,
				columns: readDatabaseObjectColumns(projectFolder, { type, database, schema, table }),
			}))
			.sort(
				(left, right) =>
					left.databaseType.localeCompare(right.databaseType) ||
					left.database.localeCompare(right.database) ||
					left.schema.localeCompare(right.schema) ||
					left.table.localeCompare(right.table),
			),
	};
}

function readDatabaseObjectColumns(
	projectFolder: string,
	object: Pick<DatabaseObject, 'type' | 'database' | 'schema' | 'table'>,
): string[] {
	const path = join(
		projectFolder,
		'databases',
		`type=${object.type}`,
		`database=${object.database}`,
		`schema=${object.schema}`,
		`table=${object.table}`,
		'columns.md',
	);
	try {
		return readFileSync(path, 'utf-8')
			.split(/\r?\n/)
			.flatMap((line) => {
				const name = parseGeneratedColumnName(line);
				return name ? [name] : [];
			});
	} catch {
		return [];
	}
}

function parseGeneratedColumnName(line: string): string | null {
	if (!line.startsWith('- ')) {
		return null;
	}
	for (let index = 2; index < line.length - 2; index += 1) {
		if (line[index] !== ' ' || line[index + 1] !== '(' || !isCompleteParenthesizedSuffix(line.slice(index + 1))) {
			continue;
		}
		const name = line.slice(2, index).trim();
		return name ? unquoteGeneratedIdentifier(name) : null;
	}
	return null;
}

function isCompleteParenthesizedSuffix(value: string): boolean {
	let depth = 0;
	let quote: "'" | '"' | '`' | undefined;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (quote) {
			if (character === '\\' && (quote !== '"' || index !== value.length - 3)) {
				index += 1;
			} else if (character === quote) {
				if (value[index + 1] === quote) {
					index += 1;
				} else {
					quote = undefined;
				}
			}
		} else if (character === "'" || character === '"' || character === '`') {
			quote = character;
		} else if (character === '(') {
			depth += 1;
		} else if (character === ')') {
			depth -= 1;
			if (depth === 0 && index !== value.length - 1) {
				return false;
			}
		}
		if (depth < 0) {
			return false;
		}
	}
	return depth === 0 && quote === undefined;
}

function unquoteGeneratedIdentifier(value: string): string {
	if (value.startsWith('`') && value.endsWith('`')) {
		return value.slice(1, -1).replaceAll('``', '`');
	}
	if (value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1).replaceAll('""', '"');
	}
	return value;
}

function readDirEntries(dir: string, prefix: string): { name: string; path: string }[] {
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && e.name.startsWith(prefix))
		.map((e) => ({ name: e.name.slice(prefix.length), path: join(dir, e.name) }))
		.filter((e) => e.name);
}

function readDatabaseObjectsFromDisk(folder: string): DatabaseObject[] {
	try {
		return scanDatabaseObjects(folder).objects;
	} catch (error) {
		console.error('Error reading database objects:', error);
		return [];
	}
}

function scanDatabaseObjects(folder: string): {
	syncState: 'missing' | 'ready';
	objects: DatabaseObject[];
} {
	const databasesPath = join(folder, 'databases');
	if (!existsSync(databasesPath)) {
		return { syncState: 'missing', objects: [] };
	}

	return {
		syncState: 'ready',
		objects: readDirEntries(databasesPath, 'type=').flatMap(({ name: type, path: typePath }) =>
			readDirEntries(typePath, 'database=').flatMap(({ name: database, path: dbPath }) =>
				readDirEntries(dbPath, 'schema=').flatMap(({ name: schema, path: schemaPath }) =>
					readDirEntries(schemaPath, 'table=').map(({ name: table }) => ({
						type,
						database,
						schema,
						table,
						fqdn: `${database}.${schema}.${table}`,
					})),
				),
			),
		),
	};
}

export function getTableColumnsContent(
	projectFolder: string,
	fqdn: string,
	warehouseTableAccess: WarehouseTableAccess,
): string | undefined {
	const obj = getDatabaseObjects(projectFolder).find(
		(object) => object.fqdn === fqdn && isDatabaseObjectAllowed(warehouseTableAccess, object),
	);
	if (!obj) {
		return undefined;
	}

	const columnsPath = join(
		projectFolder,
		'databases',
		`type=${obj.type}`,
		`database=${obj.database}`,
		`schema=${obj.schema}`,
		`table=${obj.table}`,
		'columns.md',
	);

	try {
		return readFileSync(columnsPath, 'utf-8');
	} catch {
		return undefined;
	}
}
