import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const TAURI_DRIVER_PORT = 4444;

const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;
const PROFILE_DIRECTORY = path.join(os.tmpdir(), 'nao-desktop-e2e-profile');

let driver: ChildProcess | undefined;

/**
 * The app inherits tauri-driver's environment, so pointing the XDG directories at a fresh folder
 * gives every run an empty server list and cookie jar. BROWSER keeps xdg-open from launching a
 * real browser for the sign-in link.
 */
export async function startTauriDriver(): Promise<void> {
	await resetProfileDirectory();
	driver = spawn('tauri-driver', ['--port', String(TAURI_DRIVER_PORT)], {
		stdio: [null, process.stdout, process.stderr],
		env: {
			...process.env,
			XDG_DATA_HOME: path.join(PROFILE_DIRECTORY, 'data'),
			XDG_CONFIG_HOME: path.join(PROFILE_DIRECTORY, 'config'),
			XDG_CACHE_HOME: path.join(PROFILE_DIRECTORY, 'cache'),
			BROWSER: 'true',
		},
	});
	await waitForDriver();
}

/** The profile is wiped on the next start rather than here: WebKit's helper processes may still be writing to it. */
export function stopTauriDriver(): void {
	driver?.kill();
	driver = undefined;
}

async function resetProfileDirectory(): Promise<void> {
	await rm(PROFILE_DIRECTORY, { recursive: true, force: true });
	await mkdir(PROFILE_DIRECTORY, { recursive: true });
}

async function waitForDriver(): Promise<void> {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await isListening()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
	throw new Error(`tauri-driver did not start within ${STARTUP_TIMEOUT_MS / 1000}s`);
}

async function isListening(): Promise<boolean> {
	try {
		await fetch(`http://127.0.0.1:${TAURI_DRIVER_PORT}/status`);
		return true;
	} catch {
		return false;
	}
}
