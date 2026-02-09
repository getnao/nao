import fs from 'fs';
import path from 'path';

const pgMigrationsDir = path.join(process.cwd(), 'migrations-postgres');
const sqliteMigrationsDir = path.join(process.cwd(), 'migrations-sqlite');
const pgMetaDir = path.join(pgMigrationsDir, 'meta');
const sqliteMetaDir = path.join(sqliteMigrationsDir, 'meta');

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
]);

if (!success) {
	process.exit(1);
}

console.log('✅ All migration checks passed!');

// Utils

function runTests(tests: [fn: () => boolean, message: string][]): boolean {
	let success = true;

	for (const test of tests) {
		if (!test[0]()) {
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
