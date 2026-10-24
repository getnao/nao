import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { backendRoot, exampleProjectPath } from './paths';

export const BACKEND_URL = 'http://localhost:5005';

const STARTUP_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

let backend: ChildProcess | undefined;
let dataDirectory: string | undefined;

/** Starts the backend from the repo on a fresh SQLite database. The built frontend is served same-origin. */
export async function startBackend(): Promise<void> {
	dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'nao-desktop-e2e-backend-'));
	const env = backendEnvironment(dataDirectory);

	await runToCompletion('bun', ['scripts/db.migrate.ts'], env);
	backend = spawn('bun', ['src/index.ts'], { cwd: backendRoot, env, stdio: 'inherit' });
	await waitUntilHealthy();
}

export async function stopBackend(): Promise<void> {
	backend?.kill('SIGTERM');
	backend = undefined;
	if (dataDirectory) {
		await rm(dataDirectory, { recursive: true, force: true });
	}
}

function backendEnvironment(directory: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		DB_URI: `sqlite:${path.join(directory, 'db.sqlite')}`,
		BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
		BETTER_AUTH_URL: BACKEND_URL,
		NAO_DEFAULT_PROJECT_PATH: exampleProjectPath,
		ENABLE_USER_LOGIN: 'true',
		POSTHOG_DISABLED: 'true',
	};
}

function runToCompletion(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd: backendRoot, env, stdio: 'inherit' });
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
			}
		});
	});
}

async function waitUntilHealthy(): Promise<void> {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (backend?.exitCode !== null) {
			throw new Error(`The backend exited during startup with code ${backend?.exitCode}`);
		}
		if (await isHealthy()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
	throw new Error(`The backend did not become healthy within ${STARTUP_TIMEOUT_MS / 1000}s`);
}

async function isHealthy(): Promise<boolean> {
	try {
		const response = await fetch(`${BACKEND_URL}/api/health`);
		return response.ok;
	} catch {
		return false;
	}
}
