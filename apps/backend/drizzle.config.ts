import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';

import { isPostgres } from './src/utils';

const dialect = isPostgres ? 'postgresql' : 'sqlite';
const migrationsFolder = isPostgres ? './migrations-postgres' : './migrations-sqlite';
const schemaPath = isPostgres ? './src/db/pg-schema.ts' : './src/db/sqlite-schema.ts';
const dbUrl = isPostgres ? process.env.DB_URL! : process.env.DB_FILE_NAME!;

export default defineConfig({
	out: migrationsFolder,
	schema: schemaPath,
	dialect: dialect,
	dbCredentials: {
		url: dbUrl,
	},
});
