import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const GIT_PROJECTS_DIR = path.join(os.homedir(), '.nao', 'git-projects');

function ensureGitProjectsDir() {
	if (!fs.existsSync(GIT_PROJECTS_DIR)) {
		fs.mkdirSync(GIT_PROJECTS_DIR, { recursive: true });
	}
}

function buildAuthUrl(gitUrl: string, token?: string): string {
	if (!token) {
		return gitUrl;
	}
	const url = new URL(gitUrl);
	url.username = 'x-access-token';
	url.password = token;
	return url.toString();
}

function sanitizeDirName(gitUrl: string): string {
	return gitUrl
		.replace(/^https?:\/\//, '')
		.replace(/\.git$/, '')
		.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function cloneOrPullGitProject(opts: {
	gitUrl: string;
	gitBranch?: string;
	gitToken?: string;
}): Promise<string> {
	ensureGitProjectsDir();

	const dirName = sanitizeDirName(opts.gitUrl);
	const projectPath = path.join(GIT_PROJECTS_DIR, dirName);
	const authUrl = buildAuthUrl(opts.gitUrl, opts.gitToken);

	if (fs.existsSync(projectPath)) {
		const pullCmd = ['git', '-C', projectPath, 'pull', '--ff-only'];
		execSync(pullCmd.join(' '), { stdio: 'pipe', timeout: 60_000 });
	} else {
		const cloneCmd = ['git', 'clone', '--depth', '1'];
		if (opts.gitBranch) {
			cloneCmd.push('--branch', opts.gitBranch);
		}
		cloneCmd.push(authUrl, projectPath);
		execSync(cloneCmd.join(' '), { stdio: 'pipe', timeout: 120_000 });
	}

	return projectPath;
}
