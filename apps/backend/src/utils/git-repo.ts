import { execFileSync } from 'node:child_process';

const GIT_TIMEOUT_MS = 5_000;

export function runGit(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS, maxBuffer?: number): Buffer {
	try {
		return execFileSync('git', args, {
			cwd,
			stdio: 'pipe',
			timeout,
			maxBuffer,
		});
	} catch (error) {
		throw toGitError(error);
	}
}

export function tryRunGit(cwd: string, args: string[]): Buffer | null {
	try {
		return runGit(cwd, args);
	} catch {
		return null;
	}
}

export function toGitError(error: unknown): Error {
	const processError = error as NodeJS.ErrnoException & { stderr?: Buffer | string; killed?: boolean };
	if (processError.code === 'ENOENT') {
		return new Error('Git is not installed or is unavailable.');
	}
	if (processError.killed || processError.code === 'ETIMEDOUT') {
		return new Error('Git did not respond before the operation timed out.');
	}
	if (processError.code === 'ENOBUFS') {
		return new Error('Git output exceeded the allowed size.');
	}

	const stderr = processError.stderr?.toString().trim() ?? '';
	if (
		stderr.includes('does not have any commits yet') ||
		stderr.includes('ambiguous argument') ||
		stderr.includes('bad revision') ||
		stderr.includes('Not a valid object name HEAD') ||
		stderr.includes('unknown revision')
	) {
		return new Error('The context repository has no commits yet.');
	}
	if (stderr.includes('not a git repository')) {
		return new Error('The project folder is not inside a Git repository.');
	}

	return new Error(stderr || processError.message || 'Git operation failed.');
}
