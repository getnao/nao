#!/usr/bin/env bun
/**
 * nao-chat-server CLI
 *
 * Usage:
 *   nao-chat-server migrate
 *   nao-chat-server serve [--port <port>] [--host <host>]
 *   nao-chat-server (defaults to serve)
 */

import './env';

import { hashPassword } from 'better-auth/crypto';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { startServer } from './app';
import dbConfig, { Dialect } from './db/dbConfig';
import { runMigrations } from './db/migrate';
import * as accountQueries from './queries/account.queries';
import * as userQueries from './queries/user.queries';
import {
	parseUserGroupsConfig,
	USER_GROUPS_CONFIG_FILENAME,
	UserGroupConfigError,
} from './services/user-group-config.service';
import { formatUserGroupsConfig } from './services/user-group-config-format.service';
import { lintUserGroupsConfig } from './services/user-group-config-validation.service';

const SECRET_FILE_NAME = '.nao-secret';

interface BuildInfo {
	commit: string;
	commitShort: string;
	buildTime: string;
}

function getExecutableDir(): string {
	// When compiled with bun build --compile, Bun.main points to the embedded
	// filesystem (Unix: /$bunfs/..., Windows: B:/~BUN/...) and process.execPath
	// points to the actual binary on disk. When running as script, Bun.main
	// points to the .ts file being executed.
	const isCompiled = /(\$bunfs|~BUN)/.test(Bun.main);

	if (isCompiled) {
		// Use the actual binary location on disk
		return path.dirname(process.execPath);
	}

	// Running as script from src/cli.ts - migrations are in parent directory
	const scriptDir = path.dirname(Bun.main);
	return path.dirname(scriptDir); // Go up from src/ to apps/backend/
}

function getBuildInfo(): BuildInfo | null {
	try {
		const buildInfoPath = path.join(getExecutableDir(), 'build-info.json');
		if (fs.existsSync(buildInfoPath)) {
			const content = fs.readFileSync(buildInfoPath, 'utf-8');
			return JSON.parse(content) as BuildInfo;
		}
	} catch {
		// Ignore errors reading build info
	}
	return null;
}

function getMigrationsPath(dbType: Dialect): string {
	const execDir = getExecutableDir();
	const migrationsFolder = dbType === Dialect.Postgres ? 'migrations-postgres' : 'migrations-sqlite';
	return path.join(execDir, migrationsFolder);
}

function getSecretFilePath(): string {
	return path.join(getExecutableDir(), SECRET_FILE_NAME);
}

function generateSecret(): string {
	return crypto.randomBytes(32).toString('base64');
}

function ensureAuthSecret(): void {
	// If already set via environment, nothing to do
	if (process.env.BETTER_AUTH_SECRET) {
		return;
	}

	const secretPath = getSecretFilePath();

	// Try to load existing secret from file
	if (fs.existsSync(secretPath)) {
		try {
			const secret = fs.readFileSync(secretPath, 'utf-8').trim();
			if (secret) {
				process.env.BETTER_AUTH_SECRET = secret;
				console.log(`✓ Loaded auth secret from ${secretPath}`);
				return;
			}
		} catch {
			// Fall through to generate new secret
		}
	}

	// Generate and save new secret
	const newSecret = generateSecret();
	try {
		fs.writeFileSync(secretPath, newSecret, { mode: 0o600 }); // Restrictive permissions
		process.env.BETTER_AUTH_SECRET = newSecret;
		console.log(`✓ Generated new auth secret and saved to ${secretPath}`);
	} catch (err) {
		// If we can't write the file, still set the env var for this session
		// but warn the user that sessions won't persist
		process.env.BETTER_AUTH_SECRET = newSecret;
		console.warn(`⚠ Could not save auth secret to ${secretPath}: ${err}`);
		console.warn('  Sessions will not persist across restarts');
	}
}

function printHelp(): void {
	console.log(`
nao-chat-server - nao Chat Server

USAGE:
    nao-chat-server <command> [options]

COMMANDS:
    serve           Run migrations and start the chat server (default)
    migrate         Run database migrations only
    reset-password  Reset a user's password directly in the local database
    groups lint     Validate groups.yaml against the local project
    groups format   Rewrite groups.yaml with the standard key order and indentation

OPTIONS:
    -h, --help  Show this help message

SERVE OPTIONS:
    --port <port>   Port to listen on (default: 5005)
    --host <host>   Host to bind to (default: 0.0.0.0)

RESET-PASSWORD OPTIONS:
    --email <email>   Email of the user whose password should be reset

GROUPS OPTIONS:
    --path <path>     Project folder (default: current directory)
    --check           With format: fail instead of rewriting an unformatted file

ENVIRONMENT VARIABLES:
    DB_URI              Database connection URI
                        SQLite:     sqlite:./path/to/db.sqlite
                        PostgreSQL: postgres://user:pass@host:port/database
    BETTER_AUTH_SECRET  Secret key for signing auth sessions (auto-generated if not set)

EXAMPLES:
    # SQLite (default: sqlite:./db.sqlite)
    nao-chat-server serve --port 3000

    # SQLite with custom path
    DB_URI=sqlite:./data/chat.db nao-chat-server serve

    # PostgreSQL
    DB_URI=postgres://user:pass@localhost/mydb nao-chat-server serve
`);
}

function parseArgs(args: string[]): { command: string; subcommand?: string; options: Record<string, string> } {
	const options: Record<string, string> = {};
	let command = 'serve'; // default command
	let subcommand: string | undefined;

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
			if (command === 'serve' && ['migrate', 'serve', 'reset-password', 'groups'].includes(arg)) {
				command = arg;
			} else if (command === 'groups' && subcommand === undefined) {
				subcommand = arg;
			}
			i++;
		} else {
			i++;
		}
	}

	return { command, subcommand, options };
}

async function runServe(options: Record<string, string>): Promise<void> {
	const port = parseInt(options['port'] || '5005', 10);
	const host = options['host'] || '0.0.0.0';
	const { dialect, dbUrl } = dbConfig;
	const buildInfo = getBuildInfo();

	// Set up global error handlers to prevent server crashes
	process.on('uncaughtException', (err) => {
		console.error('❌ Uncaught exception (server continuing):', err);
	});

	process.on('unhandledRejection', (reason, promise) => {
		console.error('❌ Unhandled rejection (server continuing):', reason);
		console.error('   Promise:', promise);
	});

	// Run migrations before starting the server
	try {
		await runMigrateCommand();
	} catch {
		console.error('❌ Failed to run migrations, aborting server start');
		process.exit(1);
	}

	console.log(`\n🚀 Starting nao chat server...`);
	if (buildInfo) {
		console.log(`   Build: ${buildInfo.commitShort} (${buildInfo.buildTime})`);
	}
	console.log(`   Database: ${dialect}${dialect === Dialect.Sqlite ? ` (${dbUrl})` : ''}`);
	console.log(`   Listening on: ${host}:${port}`);

	try {
		await startServer({ port, host });
	} catch (err) {
		console.error('❌ Failed to start server:', err);
		process.exit(1);
	}
}

async function runResetPassword(options: Record<string, string>): Promise<void> {
	const email = options['email']?.trim();
	if (!email) {
		console.error('❌ Missing required option: --email <email>');
		process.exit(1);
	}

	const user = (await userQueries.getUser({ email })) ?? (await userQueries.getUser({ email: email.toLowerCase() }));
	if (!user) {
		console.error(`❌ No user found with email "${email}"`);
		process.exit(1);
	}

	const account = await accountQueries.getAccountById(user.id);
	if (!account?.password) {
		console.error(`❌ ${user.email} signs in via SSO/OAuth and has no password to reset.`);
		process.exit(1);
	}

	const temporaryPassword = crypto.randomBytes(12).toString('base64url');
	const hashedPassword = await hashPassword(temporaryPassword);
	await accountQueries.updateAccountPassword(account.id, hashedPassword, user.id);

	console.log(`\n✓ Password reset for ${user.email}`);
	console.log(`   Temporary password: ${temporaryPassword}`);
	console.log(`   You'll be prompted to choose a new password after logging in.\n`);
	process.exit(0);
}

/** Runs offline: the checks that need the database only run on the server. */
function runGroups(subcommand: string | undefined, options: Record<string, string>): never {
	const projectPath = path.resolve(options['path'] || process.cwd());
	const configPath = path.join(projectPath, USER_GROUPS_CONFIG_FILENAME);
	try {
		if (!fs.existsSync(configPath)) {
			throw new UserGroupConfigError(`${USER_GROUPS_CONFIG_FILENAME} not found in ${projectPath}.`);
		}
		const source = fs.readFileSync(configPath, 'utf8');
		if (subcommand === 'lint') {
			lintUserGroupsConfig(projectPath, parseUserGroupsConfig(source, configPath));
			console.log(`✓ ${USER_GROUPS_CONFIG_FILENAME} is valid`);
			process.exit(0);
		}
		if (subcommand === 'format') {
			const formatted = formatUserGroupsConfig(source);
			if (formatted === source) {
				console.log(`✓ ${USER_GROUPS_CONFIG_FILENAME} is already formatted`);
				process.exit(0);
			}
			if (options['check']) {
				console.error(`✗ ${USER_GROUPS_CONFIG_FILENAME} is not formatted. Run nao group format.`);
				process.exit(1);
			}
			fs.writeFileSync(configPath, formatted);
			console.log(`✓ Formatted ${USER_GROUPS_CONFIG_FILENAME}`);
			process.exit(0);
		}
		console.error('Usage: nao-chat-server groups <lint|format> [--path <project>] [--check]');
		process.exit(2);
	} catch (error) {
		if (!(error instanceof UserGroupConfigError)) {
			throw error;
		}
		console.error(`✗ ${USER_GROUPS_CONFIG_FILENAME} is invalid:\n${error.message}`);
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
	const { command, subcommand, options } = parseArgs(args);

	if (options['help']) {
		printHelp();
		process.exit(0);
	}

	if (command === 'groups') {
		runGroups(subcommand, options);
	}

	// Ensure auth secret is available before any command that needs the database
	ensureAuthSecret();

	switch (command) {
		case 'migrate':
			await runMigrateCommand();
			break;
		case 'reset-password':
			await runResetPassword(options);
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
