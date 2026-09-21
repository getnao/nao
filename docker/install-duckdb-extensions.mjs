/**
 * Downloads the DuckDB extensions the local database needs into the image, at build time.
 *
 * Queries against the local database run with external access switched off, so an extension that
 * is not already on disk can never be fetched. Baking them in is what makes spreadsheet support
 * work on an instance with no outbound network.
 *
 * Usage: DUCKDB_EXTENSION_DIR=/app/.duckdb-extensions node docker/install-duckdb-extensions.mjs
 */
import { DuckDBInstance } from '@duckdb/node-api';

const EXTENSIONS = ['excel'];

const directory = process.env.DUCKDB_EXTENSION_DIR;
if (!directory) {
	console.error('DUCKDB_EXTENSION_DIR is required');
	process.exit(1);
}

const instance = await DuckDBInstance.create(':memory:', { extension_directory: directory });
const connection = await instance.connect();

for (const extension of EXTENSIONS) {
	await connection.run(`INSTALL ${extension}`);
	await connection.run(`LOAD ${extension}`);
	console.log(`installed duckdb extension: ${extension}`);
}

connection.closeSync();
instance.closeSync();
