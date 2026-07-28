import { execFileSync } from 'node:child_process';

export function isGitRepository(projectFolder: string): boolean {
	try {
		execFileSync('git', ['rev-parse', '--git-dir'], {
			cwd: projectFolder,
			stdio: 'pipe',
			timeout: 5_000,
		});
		return true;
	} catch {
		return false;
	}
}
