import { execFileSync } from 'node:child_process';

const GIT_TIMEOUT_MS = 5_000;

export type GitOperation =
	| 'git'
	| 'clone'
	| 'configure-remote'
	| 'setup-worktree'
	| 'validate-repository'
	| 'promote-repository'
	| 'fetch'
	| 'pull'
	| 'push'
	| 'checkout'
	| 'add'
	| 'commit'
	| 'status';

export class GitOperationError extends Error {
	constructor(
		message: string,
		public readonly operation: GitOperation,
		public readonly details: string,
	) {
		super(message);
		this.name = 'GitOperationError';
	}
}

export function execGitOperation(
	args: string[],
	options: { cwd?: string; stdio: 'pipe'; timeout: number; env?: NodeJS.ProcessEnv },
	operation: GitOperation,
): Buffer {
	try {
		return execFileSync('git', args, options);
	} catch (error) {
		throw toGitError(error, operation);
	}
}

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

export function toGitError(error: unknown, operation: GitOperation = 'git'): GitOperationError {
	if (error instanceof GitOperationError) {
		return error.operation !== 'git' || operation === 'git'
			? error
			: new GitOperationError(error.message, operation, error.details);
	}
	const processError = error as NodeJS.ErrnoException & { stderr?: Buffer | string; killed?: boolean };
	const stderr = processError.stderr?.toString().trim() ?? '';
	const details = stderr || processError.message || 'Git operation failed.';
	if (processError.code === 'ENOENT') {
		return new GitOperationError('Git is not installed or is unavailable.', operation, details);
	}
	if (processError.killed || processError.code === 'ETIMEDOUT') {
		return new GitOperationError('Git did not respond before the operation timed out.', operation, details);
	}
	if (processError.code === 'ENOBUFS') {
		return new GitOperationError('Git output exceeded the allowed size.', operation, details);
	}

	if (
		stderr.includes('does not have any commits yet') ||
		stderr.includes('ambiguous argument') ||
		stderr.includes('bad revision') ||
		stderr.includes('Not a valid object name HEAD') ||
		stderr.includes('unknown revision')
	) {
		return new GitOperationError('The context repository has no commits yet.', operation, details);
	}
	if (stderr.includes('not a git repository')) {
		return new GitOperationError('The project folder is not inside a Git repository.', operation, details);
	}

	return new GitOperationError(details, operation, details);
}
