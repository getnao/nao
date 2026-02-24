import { Column, getTableColumns, getTableName, is, Table } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import fs from 'fs';
import path from 'path';

import * as pgSchema from '../src/db/pg-schema';
import * as sqliteSchema from '../src/db/sqlite-schema';

const pgMigrationsDir = path.join(process.cwd(), 'migrations-postgres');
const sqliteMigrationsDir = path.join(process.cwd(), 'migrations-sqlite');
const pgMetaDir = path.join(pgMigrationsDir, 'meta');
const sqliteMetaDir = path.join(sqliteMigrationsDir, 'meta');

/**
 * Ensures the migrations and schemas from both the sqlite and postgres databases are in sync through migration folders, meta files, and table schema comparisons.
 */
const success = runTests([
	[
		// Check migrations/ directory
		() => checkDirectoriesHaveSameEntries(pgMigrationsDir, sqliteMigrationsDir),
		'Migration directories for postgres and sqlite are not in sync! You must generate the migrations for both databases.',
	],
	[
		// Check meta/ directory
		() => checkDirectoriesHaveSameEntries(pgMetaDir, sqliteMetaDir),
		'Meta directories for postgres and sqlite are not in sync! You must generate the migrations for both databases.',
	],
	[
		// compare migration and meta files (a migration should have a corresponding meta file)
		() => checkMigrationsHaveCorrespondingMetaFiles(pgMigrationsDir),
		'Postgres migrations and snapshots are not in sync! Each migration should have a corresponding snapshot.',
	],
	[
		() => checkMigrationsHaveCorrespondingMetaFiles(sqliteMigrationsDir),
		'SQLite migrations and snapshots are not in sync! Each migration should have a corresponding snapshot.',
	],
	[
		() => checkTableSchemas(),
		(error) =>
			`Postgres and SQLite schemas do not match! The table structures must be identical across databases.\n\t${error}`,
	],
]);

if (!success) {
	process.exit(1);
}

console.log('✅ All migration checks passed!');

function runTests(tests: [fn: () => boolean | string, message: string | ((error: string) => string)][]): boolean {
	let success = true;

	for (const test of tests) {
		const testResult = test[0]();
		if (typeof testResult !== 'boolean') {
			const errorMessage = test[1] instanceof Function ? test[1](testResult) : test[1];
			console.error(`❌ ${errorMessage}`);
			success = false;
			continue;
		}
		if (!testResult) {
			console.error(`❌ ${test[1]}`);
			success = false;
		}
	}

	return success;
}

function checkMigrationsHaveCorrespondingMetaFiles(migrationsDir: string): boolean {
	const migrations = getFiles(migrationsDir);
	const meta = getFiles(path.join(migrationsDir, 'meta'));

	const getFileNumberPrefix = (fileName: string): string => {
		const match = fileName.match(/^(\d+)/);
		return match ? match[1] : '';
	};

	const migrationIds = migrations.map((m) => getFileNumberPrefix(m)).filter(Boolean);
	const metaIds = meta.map((m) => getFileNumberPrefix(m)).filter(Boolean);
	return migrationIds.length === metaIds.length && migrationIds.every((id) => metaIds.includes(id));
}

function checkDirectoriesHaveSameEntries(dir1: string, dir2: string): boolean {
	const entries1 = getFiles(dir1);
	const entries2 = getFiles(dir2);
	return entries1.every((e) => entries2.includes(e)) && entries1.length === entries2.length;
}

function getFiles(dir: string): string[] {
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => e.name);
}

function checkTableSchemas(): string | boolean {
	const pgTables = extractTables(pgSchema, PgTable);
	const sqliteTables = extractTables(sqliteSchema, SQLiteTable);

	const pgTableNames = new Set(pgTables.keys());
	const sqliteTableNames = new Set(sqliteTables.keys());

	for (const name of pgTableNames) {
		if (!sqliteTableNames.has(name)) {
			return `Table "${name}" exists in postgres but not in sqlite`;
		}
	}

	for (const name of sqliteTableNames) {
		if (!pgTableNames.has(name)) {
			return `Table "${name}" exists in sqlite but not in postgres`;
		}
	}

	for (const [tableName, pgTable] of pgTables) {
		const sqliteTable = sqliteTables.get(tableName);
		if (!sqliteTable) {
			continue;
		}

		const pgColumns = getTableColumns(pgTable);
		const sqliteColumns = getTableColumns(sqliteTable);

		const compareColumnsResult = compareSchemaColumns(tableName, pgColumns, sqliteColumns);
		if (compareColumnsResult) {
			return compareColumnsResult;
		}
	}

	return true;
}

function extractTables<T extends typeof Table>(
	schema: Record<string, unknown>,
	tableClass: T,
): Map<string, InstanceType<T>> {
	const tables = new Map<string, InstanceType<T>>();

	for (const value of Object.values(schema)) {
		if (is(value, tableClass)) {
			const tableName = getTableName(value);
			tables.set(tableName, value as InstanceType<T>);
		}
	}

	return tables;
}

function compareSchemaColumns(
	tableName: string,
	pgColumns: Record<string, Column>,
	sqliteColumns: Record<string, Column>,
): string | undefined {
	const pgColNames = new Set(Object.keys(pgColumns));
	const sqliteColNames = new Set(Object.keys(sqliteColumns));

	for (const name of pgColNames) {
		if (!sqliteColNames.has(name)) {
			return `Column "${tableName}.${name}" exists in postgres but not in sqlite`;
		}
	}

	for (const name of sqliteColNames) {
		if (!pgColNames.has(name)) {
			return `Column "${tableName}.${name}" exists in sqlite but not in postgres`;
		}
	}

	for (const [colName, pgCol] of Object.entries(pgColumns)) {
		const sqliteCol = sqliteColumns[colName];
		if (!sqliteCol) {
			continue;
		}

		if (pgCol.primary !== sqliteCol.primary) {
			return `Column "${tableName}.${colName}" primary mismatch: pg=${pgCol.primary}, sqlite=${sqliteCol.primary}`;
		}

		if (pgCol.notNull !== sqliteCol.notNull) {
			return `Column "${tableName}.${colName}" notNull mismatch: pg=${pgCol.notNull}, sqlite=${sqliteCol.notNull}`;
		}

		if (pgCol.name !== sqliteCol.name) {
			return `Column "${tableName}.${colName}" db name mismatch: pg=${pgCol.name}, sqlite=${sqliteCol.name}`;
		}

		const pgType = normalizeColumnType(pgCol.columnType);
		const sqliteType = normalizeColumnType(sqliteCol.columnType);
		if (pgType !== sqliteType) {
			return `Column "${tableName}.${colName}" type mismatch: pg=${pgType}, sqlite=${sqliteType}`;
		}
	}
}

function normalizeColumnType(columnType: string): string {
	const stripped = columnType.replace(/^(Pg|SQLite)/, '');

	const equivalentTypes: Record<string, string> = {
		Jsonb: 'Json',
		TextJson: 'Json',
	};

	return equivalentTypes[stripped] ?? stripped;
}
