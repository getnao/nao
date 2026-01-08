import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';

import { dbUrl, dialect, migrationsFolder, schemaPath } from './src/utils';

export default defineConfig({
	out: migrationsFolder,
	schema: schemaPath,
	dialect: dialect,
	dbCredentials: {
		url: dbUrl,
	},
});
