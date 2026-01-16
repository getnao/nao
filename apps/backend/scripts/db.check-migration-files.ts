import fs from 'fs';
import path from 'path';

const pgMigrationsDir = path.join(process.cwd(), 'migrations-postgres');
const sqliteMigrationsDir = path.join(process.cwd(), 'migrations-sqlite');

// Check migrations/ directory
if (!checkDirectoriesHaveSameEntries(pgMigrationsDir, sqliteMigrationsDir)) {
	console.error(
		'❌ Migration directories have different files! You must generate the migrations for both databases.',
	);
	process.exit(1);
}

const pgMetaDir = path.join(pgMigrationsDir, 'meta');
const sqliteMetaDir = path.join(sqliteMigrationsDir, 'meta');

// Check meta/ directory
if (!checkDirectoriesHaveSameEntries(pgMetaDir, sqliteMetaDir)) {
	console.error(
		'❌ Migration directories have different meta files! You must generate the migrations for both databases.',
	);
	process.exit(1);
}

function checkDirectoriesHaveSameEntries(dir1: string, dir2: string): boolean {
	const entries1 = fs.readdirSync(dir1);
	const entries2 = fs.readdirSync(dir2);
	return entries1.every((e) => entries2.includes(e)) && entries1.length === entries2.length;
}
