import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SHELL_LOOKUP_TIMEOUT_MS = 5_000;
const IS_WINDOWS = process.platform === 'win32';
const EXECUTABLE_NAME = IS_WINDOWS ? 'claude.exe' : 'claude';

export interface ClaudeExecutable {
	path: string;
	/** The environment Claude runs with: an app opened from the Finder or the dock lacks the shell's PATH. */
	env: Record<string, string>;
}

let cachedExecutable: Promise<ClaudeExecutable | null> | undefined;

/** The Claude Code the user installed and signed in to; nao never ships its own. */
export function findClaudeExecutable(): Promise<ClaudeExecutable | null> {
	cachedExecutable ??= locateClaudeExecutable().then((executable) => {
		if (!executable) {
			cachedExecutable = undefined;
		}
		return executable;
	});
	return cachedExecutable;
}

async function locateClaudeExecutable(): Promise<ClaudeExecutable | null> {
	const path = await loginShellPath();
	const env = { ...stringEnv(process.env), ...(path && { PATH: path }) };
	const executablePath = [process.env.NAO_CLAUDE_PATH, ...wellKnownLocations(), ...pathLocations(env.PATH)].find(
		(candidate): candidate is string => !!candidate && isExecutable(candidate),
	);
	return executablePath ? { path: executablePath, env } : null;
}

function wellKnownLocations(): string[] {
	const home = homedir();
	if (IS_WINDOWS) {
		return [join(home, '.local', 'bin', EXECUTABLE_NAME)];
	}
	return [
		join(home, '.local', 'bin', EXECUTABLE_NAME),
		join(home, '.claude', 'local', EXECUTABLE_NAME),
		'/opt/homebrew/bin/claude',
		'/usr/local/bin/claude',
	];
}

function pathLocations(path: string | undefined): string[] {
	return (path ?? '')
		.split(delimiter)
		.filter(Boolean)
		.map((directory) => join(directory, EXECUTABLE_NAME));
}

async function loginShellPath(): Promise<string | null> {
	if (IS_WINDOWS) {
		return null;
	}
	const shell = process.env.SHELL || '/bin/zsh';
	try {
		const { stdout } = await execFileAsync(shell, ['-l', '-c', 'printf "%s" "$PATH"'], {
			timeout: SHELL_LOOKUP_TIMEOUT_MS,
		});
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, IS_WINDOWS ? constants.F_OK : constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	return Object.fromEntries(
		Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
	);
}
