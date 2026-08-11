import { execFileSync } from 'node:child_process';

import { CONTEXT_CONFIG_FILENAME } from '@nao/shared';

import { GitIdentity, withCoAuthors } from '../utils/git-identity';

/** Directories skipped when scanning a repository for `nao_config.yaml`. Shared so every scan path stays in sync. */
export const SUBPATH_SCAN_IGNORED_DIRS = new Set([
	'.git',
	'node_modules',
	'.venv',
	'venv',
	'__pycache__',
	'dist',
	'build',
]);

/** How deep any `nao_config.yaml` scan descends before giving up. */
export const SUBPATH_SCAN_MAX_DEPTH = 6;

/** Returns the path of `dir` relative to the git repo root, e.g. `apps/analytics/nao`. Empty string when at root. */
export function getRepoSubPath(dir: string): string {
	try {
		const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], {
			cwd: dir,
			stdio: 'pipe',
			timeout: 5_000,
		})
			.toString()
			.trim();
		return prefix.replace(/\/$/, '');
	} catch {
		return '';
	}
}

export function checkoutNewBranch(dir: string, branch: string): void {
	execFileSync('git', ['checkout', '-b', branch], { cwd: dir, stdio: 'pipe', timeout: 30_000 });
}

/** Stages all changes and creates a commit. Returns false when there was nothing to commit. */
export function commitAll(
	dir: string,
	{ message, author, coAuthors = [] }: { message: string; author: GitIdentity; coAuthors?: GitIdentity[] },
): boolean {
	const opts = { cwd: dir, stdio: 'pipe' as const, timeout: 120_000 };
	execFileSync('git', ['add', '-A'], opts);
	const status = execFileSync('git', ['status', '--porcelain'], opts).toString().trim();
	if (!status) {
		return false;
	}
	const identity = {
		GIT_AUTHOR_NAME: author.name,
		GIT_AUTHOR_EMAIL: author.email,
		GIT_COMMITTER_NAME: author.name,
		GIT_COMMITTER_EMAIL: author.email,
	};
	execFileSync('git', ['commit', '-m', withCoAuthors(message, coAuthors)], {
		...opts,
		env: { ...process.env, ...identity },
	});
	return true;
}

export function isContextConfigFile(repoPath: string): boolean {
	return basename(repoPath) === CONTEXT_CONFIG_FILENAME;
}

export function configDir(repoPath: string): string {
	const idx = repoPath.lastIndexOf('/');
	return idx === -1 ? '' : repoPath.slice(0, idx);
}

/** Picks the directory closest to the repo root, breaking ties alphabetically. '' when none. */
export function shallowestSubPath(dirs: string[]): string {
	if (dirs.length === 0) {
		return '';
	}
	const segmentCount = (dir: string) => (dir === '' ? 0 : dir.split('/').length);
	return [...dirs].sort((a, b) => segmentCount(a) - segmentCount(b) || a.localeCompare(b))[0];
}

function basename(repoPath: string): string {
	const idx = repoPath.lastIndexOf('/');
	return idx === -1 ? repoPath : repoPath.slice(idx + 1);
}
