#!/usr/bin/env bun
/**
 * nao-chat-server CLI
 *
 * Usage:
 *   nao-chat-server migrate
 *   nao-chat-server serve [--port <port>] [--host <host>]
 *   nao-chat-server (defaults to serve)
 */

import path from 'path';

import { Dialect } from './db/dbConfig';
import dbConfig from './db/dbConfig';
import { runMigrations } from './db/migrate';

function getExecutableDir(): string {
	// When running as a compiled binary, process.execPath is the path to the binary itself
	return path.dirname(process.execPath);
}

function getMigrationsPath(dbType: Dialect): string {
	const execDir = getExecutableDir();
	const migrationsFolder = dbType === Dialect.Postgres ? 'migrations-postgres' : 'migrations-sqlite';
	return path.join(execDir, migrationsFolder);
}

function printHelp(): void {
	console.log(`
nao-chat-server - nao Chat Server

USAGE:
    nao-chat-server <command> [options]

COMMANDS:
    serve       Run migrations and start the chat server (default)
    migrate     Run database migrations only

OPTIONS:
    -h, --help  Show this help message

SERVE OPTIONS:
    --port <port>   Port to listen on (default: 5005)
    --host <host>   Host to bind to (default: 0.0.0.0)

ENVIRONMENT VARIABLES:
    DB_URI    Database connection URI
              SQLite:     sqlite:./path/to/db.sqlite
              PostgreSQL: postgres://user:pass@host:port/database

EXAMPLES:
    # SQLite (default: sqlite:./db.sqlite)
    nao-chat-server serve --port 3000

    # SQLite with custom path
    DB_URI=sqlite:./data/chat.db nao-chat-server serve

    # PostgreSQL
    DB_URI=postgres://user:pass@localhost/mydb nao-chat-server serve
`);
}

function parseArgs(args: string[]): { command: string; options: Record<string, string> } {
	const options: Record<string, string> = {};
	let command = 'serve'; // default command

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		if (arg === '-h' || arg === '--help') {
			options['help'] = 'true';
			i++;
		} else if (arg.startsWith('--')) {
			const key = arg.slice(2);
			const value = args[i + 1];
			if (value && !value.startsWith('-')) {
				options[key] = value;
				i += 2;
			} else {
				options[key] = 'true';
				i++;
			}
		} else if (!arg.startsWith('-')) {
			// First non-flag argument is the command
			if (command === 'serve' && (arg === 'migrate' || arg === 'serve')) {
				command = arg;
			}
			i++;
		} else {
			i++;
		}
	}

	return { command, options };
}

async function runServe(options: Record<string, string>): Promise<void> {
	const port = parseInt(options['port'] || '5005', 10);
	const host = options['host'] || '0.0.0.0';
	const { dialect, dbUrl } = dbConfig;

	// Run migrations before starting the server
	try {
		await runMigrateCommand();
	} catch {
		console.error('❌ Failed to run migrations, aborting server start');
		process.exit(1);
	}

	console.log(`\n🚀 Starting nao chat server...`);
	console.log(`   Database: ${dialect}${dialect === Dialect.Sqlite ? ` (${dbUrl})` : ''}`);
	console.log(`   Listening on: ${host}:${port}`);

	// Dynamic import to ensure env vars are set first
	const { default: app } = await import('./app');

	try {
		const address = await app.listen({ host, port });
		console.log(`✅ Server is running on ${address}`);
	} catch (err) {
		app.log.error(err);
		process.exit(1);
	}
}

async function runMigrateCommand(): Promise<void> {
	const migrationsPath = getMigrationsPath(dbConfig.dialect);

	try {
		await runMigrations({
			dbType: dbConfig.dialect,
			connectionString: dbConfig.dbUrl,
			migrationsPath,
		});
	} catch {
		process.exit(1);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const { command, options } = parseArgs(args);

	if (options['help']) {
		printHelp();
		process.exit(0);
	}

	switch (command) {
		case 'migrate':
			await runMigrateCommand();
			break;
		case 'serve':
			await runServe(options);
			break;
		default:
			console.error(`Unknown command: ${command}`);
			printHelp();
			process.exit(1);
	}
}

main();
