import { execFileSync } from 'node:child_process';

import { CONTEXT_CONFIG_FILENAME } from '@nao/shared';

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
