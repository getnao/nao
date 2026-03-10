import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { env } from '../env';

/**
 * Reads user-defined rules from RULES.md in the project folder if it exists
 */
export function getUserRules(): string | undefined {
	const projectFolder = env.NAO_DEFAULT_PROJECT_PATH;

	if (!projectFolder) {
		return undefined;
	}

	const rulesPath = join(projectFolder, 'RULES.md');

	if (!existsSync(rulesPath)) {
		return undefined;
	}

	try {
		const rulesContent = readFileSync(rulesPath, 'utf-8');
		return rulesContent;
	} catch (error) {
		console.error('Error reading RULES.md:', error);
		return undefined;
	}
}

type Connection = {
	type: string;
	database: string;
};

export function getConnections(): Connection[] | undefined {
	const projectFolder = env.NAO_DEFAULT_PROJECT_PATH;

	if (!projectFolder) {
		return undefined;
	}

	const databasesPath = join(projectFolder, 'databases');

	if (!existsSync(databasesPath)) {
		return undefined;
	}

	try {
		const entries = readdirSync(databasesPath, { withFileTypes: true });
		const connections: Connection[] = [];

		for (const entry of entries) {
			if (entry.isDirectory() && entry.name.startsWith('type=')) {
				const type = entry.name.slice('type='.length);
				if (type) {
					const typePath = join(databasesPath, entry.name);
					const dbEntries = readdirSync(typePath, { withFileTypes: true });

					for (const dbEntry of dbEntries) {
						if (dbEntry.isDirectory() && dbEntry.name.startsWith('database=')) {
							const database = dbEntry.name.slice('database='.length);
							if (database) {
								connections.push({ type, database });
							}
						}
					}
				}
			}
		}

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

const DATABASE_OBJECTS_TTL_MS = 5 * 60 * 1000;
const databaseObjectsCache = new Map<string, { objects: DatabaseObject[]; expiresAt: number }>();

export function getDatabaseObjects(projectFolder?: string): DatabaseObject[] {
	const folder = projectFolder ?? env.NAO_DEFAULT_PROJECT_PATH;
	if (!folder) {
		return [];
	}

	const cached = databaseObjectsCache.get(folder);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.objects;
	}

	const objects = readDatabaseObjectsFromDisk(folder);
	databaseObjectsCache.set(folder, { objects, expiresAt: Date.now() + DATABASE_OBJECTS_TTL_MS });
	return objects;
}

function readDatabaseObjectsFromDisk(folder: string): DatabaseObject[] {
	const databasesPath = join(folder, 'databases');
	if (!existsSync(databasesPath)) {
		return [];
	}

	try {
		const objects: DatabaseObject[] = [];

		for (const typeEntry of readdirSync(databasesPath, { withFileTypes: true })) {
			if (!typeEntry.isDirectory() || !typeEntry.name.startsWith('type=')) {
				continue;
			}
			const type = typeEntry.name.slice('type='.length);
			if (!type) {
				continue;
			}

			const typePath = join(databasesPath, typeEntry.name);
			for (const dbEntry of readdirSync(typePath, { withFileTypes: true })) {
				if (!dbEntry.isDirectory() || !dbEntry.name.startsWith('database=')) {
					continue;
				}
				const database = dbEntry.name.slice('database='.length);
				if (!database) {
					continue;
				}

				const dbPath = join(typePath, dbEntry.name);
				for (const schemaEntry of readdirSync(dbPath, { withFileTypes: true })) {
					if (!schemaEntry.isDirectory() || !schemaEntry.name.startsWith('schema=')) {
						continue;
					}
					const schema = schemaEntry.name.slice('schema='.length);
					if (!schema) {
						continue;
					}

					const schemaPath = join(dbPath, schemaEntry.name);
					for (const tableEntry of readdirSync(schemaPath, { withFileTypes: true })) {
						if (!tableEntry.isDirectory() || !tableEntry.name.startsWith('table=')) {
							continue;
						}
						const table = tableEntry.name.slice('table='.length);
						if (!table) {
							continue;
						}

						objects.push({ type, database, schema, table, fqdn: `${database}.${schema}.${table}` });
					}
				}
			}
		}

		return objects;
	} catch (error) {
		console.error('Error reading database objects:', error);
		return [];
	}
}

export function getTableColumnsContent(projectFolder: string, fqdn: string): string | undefined {
	const parts = fqdn.split('.');
	if (parts.length !== 3) {
		return undefined;
	}
	const [database, schema, table] = parts;

	const databasesPath = join(projectFolder, 'databases');
	if (!existsSync(databasesPath)) {
		return undefined;
	}

	try {
		for (const typeEntry of readdirSync(databasesPath, { withFileTypes: true })) {
			if (!typeEntry.isDirectory() || !typeEntry.name.startsWith('type=')) {
				continue;
			}

			const columnsPath = join(
				databasesPath,
				typeEntry.name,
				`database=${database}`,
				`schema=${schema}`,
				`table=${table}`,
				'columns.md',
			);

			if (existsSync(columnsPath)) {
				return readFileSync(columnsPath, 'utf-8');
			}
		}
	} catch (error) {
		console.error('Error reading columns for', fqdn, error);
	}

	return undefined;
}
