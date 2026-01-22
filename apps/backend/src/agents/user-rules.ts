import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Reads user-defined rules from RULES.md in the project folder if it exists
 */
export function getUserRules(): string | null {
	const projectFolder = process.env.NAO_DEFAULT_PROJECT_PATH;

	if (!projectFolder) {
		return null;
	}

	const rulesPath = join(projectFolder, 'RULES.md');

	if (!existsSync(rulesPath)) {
		return null;
	}

	try {
		const rulesContent = readFileSync(rulesPath, 'utf-8');
		return rulesContent;
	} catch (error) {
		console.error('Error reading RULES.md:', error);
		return null;
	}
}

type Connection = {
	type: string;
	database: string;
};

export function getConnections(): Connection[] | null {
	const projectFolder = process.env.NAO_DEFAULT_PROJECT_PATH;

	if (!projectFolder) {
		return null;
	}

	const databasesPath = join(projectFolder, 'databases');

	if (!existsSync(databasesPath)) {
		return null;
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

		return connections.length > 0 ? connections : null;
	} catch (error) {
		console.error('Error reading databases folder:', error);
		return null;
	}
}
