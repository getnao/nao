import { defineConfig } from 'drizzle-kit';

import dbConfig, { Dialect } from './src/db/dbConfig';

export default defineConfig({
	out: dbConfig.migrationsFolder,
	schema: dbConfig.schemaPath,
	dialect: dbConfig.dialect === Dialect.Postgres ? 'postgresql' : 'sqlite',
	dbCredentials: {
		url: dbConfig.dbUrl,
	},
});
