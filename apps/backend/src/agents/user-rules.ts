import type { UserRulesGroupAccess } from '@nao/shared/rules-template';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { renderRootRulesForAgent } from '../services/agent-visible-project-file.service';
import type { WarehouseTableAccess } from '../services/context-access';

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
	}>;
};

const DATABASE_OBJECTS_TTL_MS = 5 * 60 * 1000;
const databaseObjectsCache = new Map<string, { objects: DatabaseObject[]; expiresAt: number }>();

export function getDatabaseObjects(projectFolder: string): DatabaseObject[] {
	const cached = databaseObjectsCache.get(projectFolder);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.objects;
	}

	const objects = readDatabaseObjectsFromDisk(projectFolder);
	databaseObjectsCache.set(projectFolder, { objects, expiresAt: Date.now() + DATABASE_OBJECTS_TTL_MS });
	return objects;
}

export function getDatabaseContextCatalog(projectFolder: string): DatabaseContextCatalog {
	const scan = scanDatabaseObjects(projectFolder);
	return {
		syncState: scan.syncState,
		objects: scan.objects
			.map(({ type, database, schema, table }) => ({
				databaseType: type.toLowerCase(),
				database,
				schema,
				table,
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
	const obj = getDatabaseObjects(projectFolder).find((o) => o.fqdn === fqdn);
	if (!obj || !isAllowedObject(obj, warehouseTableAccess)) {
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

function isAllowedObject(object: DatabaseObject, access: WarehouseTableAccess): boolean {
	return (
		!access.enforced ||
		access.tables.some(
			(table) =>
				table.databaseType === object.type.toLowerCase() &&
				table.database === object.database &&
				table.schema === object.schema &&
				table.table === object.table,
		)
	);
}
