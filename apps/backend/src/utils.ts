import 'dotenv/config';

import * as postgresSchema from './db/pg-schema';
import * as sqliteSchema from './db/sqlite-schema';

export type DatabaseType = 'sqlite' | 'postgres';

const DEFAULT_DB_URI = 'sqlite:./db.sqlite';

/**
 * Parse DB_URI environment variable to extract database type and connection string.
 * Supported formats:
 *   - sqlite:./path/to/db.sqlite
 *   - sqlite:path/to/db.sqlite
 *   - postgres://user:pass@host:port/database
 */
export function parseDbUri(uri?: string): { type: DatabaseType; connectionString: string } {
	const dbUri = uri || process.env.DB_URI || DEFAULT_DB_URI;

	if (dbUri.startsWith('postgres://') || dbUri.startsWith('postgresql://')) {
		return { type: 'postgres', connectionString: dbUri };
	}

	if (dbUri.startsWith('sqlite:')) {
		// Remove 'sqlite:' prefix to get the file path
		const filePath = dbUri.slice('sqlite:'.length);
		return { type: 'sqlite', connectionString: filePath };
	}

	// Default: treat as SQLite file path for backwards compatibility
	return { type: 'sqlite', connectionString: dbUri };
}

const { type: dbType, connectionString: dbConnectionString } = parseDbUri();

export const isPostgres = dbType === 'postgres';
export const databaseType = dbType;
export const connectionString = dbConnectionString;

export const provider = isPostgres ? 'pg' : 'sqlite';
export const schema = isPostgres ? postgresSchema : sqliteSchema;

export const dialect = isPostgres ? 'postgresql' : 'sqlite';
export const migrationsFolder = isPostgres ? './migrations-postgres' : './migrations-sqlite';
export const schemaPath = isPostgres ? './src/db/pg-schema.ts' : './src/db/sqlite-schema.ts';
export const dbUrl = dbConnectionString;
