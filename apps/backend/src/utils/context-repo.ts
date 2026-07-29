import fs from 'node:fs';
import path from 'node:path';

import type { RepoProvider } from '@nao/shared/types';

import * as github from '../services/github';
import * as gitlab from '../services/gitlab';
import { runGit } from './git-repo';

export interface ContextRepo {
	provider: RepoProvider;
	repoFullName: string;
	branch: string | null;
	worktreeRoot: string;
	projectPrefix: string;
}

export type ContextRepoState = Pick<ContextRepo, 'provider' | 'repoFullName' | 'branch'>;

export function resolveContextRepo(projectFolder: string): ContextRepo | null {
	const worktreeRoot = resolveWorktreeRoot(projectFolder);
	if (!worktreeRoot) {
		return null;
	}

	const githubInfo = github.getGitInfo(projectFolder);
	if (githubInfo.isGithub && githubInfo.repoFullName) {
		return buildContextRepo('github', githubInfo.repoFullName, githubInfo.branch, worktreeRoot, projectFolder);
	}

	const gitlabInfo = gitlab.getGitInfo(projectFolder);
	if (gitlabInfo.isGitlab && gitlabInfo.repoFullName) {
		return buildContextRepo('gitlab', gitlabInfo.repoFullName, gitlabInfo.branch, worktreeRoot, projectFolder);
	}

	return null;
}

export function toContextRepoState(repo: ContextRepo | null): ContextRepoState | null {
	if (!repo) {
		return null;
	}
	return {
		provider: repo.provider,
		repoFullName: repo.repoFullName,
		branch: repo.branch,
	};
}

export function getCommittedProjectPaths(repo: ContextRepo): Set<string> {
	const pathspec = repo.projectPrefix || '.';
	const output = runGit(repo.worktreeRoot, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', pathspec]);
	const paths = parseNullDelimited(output);
	return new Set(
		paths.map((repoPath) => fromRepoPath(repo, repoPath)).filter((entry): entry is string => entry !== null),
	);
}

export function readCommittedFile(repo: ContextRepo, projectPath: string, maxSize = 10 * 1024 * 1024): Buffer {
	const repoPath = toRepoPath(repo, projectPath);
	const object = `HEAD:${repoPath}`;
	const size = Number(runGit(repo.worktreeRoot, ['cat-file', '-s', object]).toString().trim());
	if (!Number.isFinite(size)) {
		throw new Error(`Unable to determine the committed size of ${projectPath}.`);
	}
	if (size > maxSize) {
		throw new Error(`File is too large (max ${formatFileSize(maxSize)}).`);
	}
	return runGit(repo.worktreeRoot, ['show', object], 5_000, maxSize + 64 * 1024);
}

export function toRepoPath(repo: ContextRepo, projectPath: string): string {
	const normalized = normalizeProjectPath(projectPath);
	return repo.projectPrefix ? `${repo.projectPrefix}/${normalized}` : normalized;
}

export function fromRepoPath(repo: ContextRepo, repoPath: string): string | null {
	const normalized = repoPath.replaceAll('\\', '/');
	if (!repo.projectPrefix) {
		return normalized;
	}
	if (normalized === repo.projectPrefix) {
		return '';
	}
	const prefix = `${repo.projectPrefix}/`;
	return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

export function normalizeProjectPath(projectPath: string): string {
	return projectPath.replaceAll('\\', '/').replace(/^\/+/, '');
}

function resolveWorktreeRoot(projectFolder: string): string | null {
	try {
		const output = runGit(projectFolder, ['rev-parse', '--show-toplevel']);
		return fs.realpathSync(output.toString().trim());
	} catch (error) {
		if (error instanceof Error && error.message === 'The project folder is not inside a Git repository.') {
			return null;
		}
		throw error;
	}
}

function buildContextRepo(
	provider: RepoProvider,
	repoFullName: string,
	branch: string | null,
	worktreeRoot: string,
	projectFolder: string,
): ContextRepo {
	const projectRoot = fs.realpathSync(projectFolder);
	const relative = path.relative(worktreeRoot, projectRoot);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error('The project folder is outside its Git worktree.');
	}

	return {
		provider,
		repoFullName,
		branch,
		worktreeRoot,
		projectPrefix: relative.split(path.sep).join('/'),
	};
}

function parseNullDelimited(output: Buffer): string[] {
	return output
		.toString()
		.split('\0')
		.filter((entry) => entry.length > 0);
}

function formatFileSize(size: number): string {
	if (size % (1024 * 1024) === 0) {
		return `${size / (1024 * 1024)} MB`;
	}
	return `${size} bytes`;
}
