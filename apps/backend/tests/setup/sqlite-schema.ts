import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import type { TestProject } from 'vitest/node';

import * as sqliteSchema from '../../src/db/sqlite-schema';

declare module 'vitest' {
	export interface ProvidedContext {
		sqliteSchemaStatements: string[];
	}
}

/**
 * Generates the app schema DDL once, so test files can create databases without loading drizzle-kit,
 * which also adds enumerable properties to `Array.prototype` that would leak into shared workers.
 */
export default async function setup(project: TestProject) {
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	project.provide('sqliteSchemaStatements', statements);
}
