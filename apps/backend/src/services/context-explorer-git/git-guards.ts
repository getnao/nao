import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { RepoProvider } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import { env } from '../../env';
import type { ResolvedContextRepo } from '../../utils/context-repo';
import { normalizeProjectPath } from '../../utils/context-repo';
import type { GitIdentity } from '../../utils/git-identity';
import { getGitOAuthCredential, runGitWithOAuth } from '../../utils/git-oauth';
import { runGit, toGitError, tryRunGit } from '../../utils/git-repo';
import { GIT_OPERATION_TIMEOUT_MS, REPO_FULL_NAME_PATTERN } from './types';

export function refreshDefaultBranch(repo: ResolvedContextRepo, provider: RepoProvider, token: string): void {
	try {
		runGitWithOAuth(
			repo.worktreeRoot,
			['remote', 'set-head', 'origin', '--auto'],
			getGitOAuthCredential(provider, token),
			GIT_OPERATION_TIMEOUT_MS,
		);
	} catch (error) {
		throw sanitizeGitError(error, token);
	}
}

export function assertAbsoluteProjectPath(projectFolder: string): string {
	if (!path.isAbsolute(projectFolder) || path.resolve(projectFolder) !== projectFolder) {
		throw new Error('The configured live project path must be an exact absolute path.');
	}
	return projectFolder;
}

export function isSameOrAncestor(candidate: string, target: string): boolean {
	const relative = path.relative(candidate, target);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function assertSafeDestructiveWorktreeTarget(worktreeRoot: string, projectFolder: string): void {
	const worktree = path.resolve(worktreeRoot);
	const live = path.resolve(projectFolder);
	const segments = worktree.split(path.sep);
	const naoIndex = segments.lastIndexOf('.nao');
	const worktreeSegments = naoIndex < 0 ? [] : segments.slice(naoIndex);
	if (
		worktreeSegments.length !== 4 ||
		worktreeSegments[0] !== '.nao' ||
		worktreeSegments[1] !== 'worktrees' ||
		!isSafeWorktreeSegment(worktreeSegments[2]) ||
		!isSafeWorktreeSegment(worktreeSegments[3])
	) {
		throw new Error('Refusing destructive Git operation outside a .nao/worktrees/<project>/<user> directory.');
	}
	if (worktree === live) {
		throw new Error('Refusing destructive Git operation against the live project folder.');
	}
	const liveRelative = path.relative(worktree, live);
	if (liveRelative === '' || (!liveRelative.startsWith('..') && !path.isAbsolute(liveRelative))) {
		throw new Error('Refusing destructive Git operation from an ancestor of the live project folder.');
	}
}

export function assertSafeDestructiveWorktreeCommand(worktreeRoot: string, cwd: string, args: string[]): void {
	const relativeCwd = path.relative(path.resolve(worktreeRoot), path.resolve(cwd));
	if (relativeCwd === '' || (!relativeCwd.startsWith('..') && !path.isAbsolute(relativeCwd))) {
		return;
	}
	const [command, subcommand] = args;
	const targetsWorktree = args.some((argument) => path.resolve(argument) === path.resolve(worktreeRoot));
	const allowed =
		command === 'worktree' &&
		((subcommand === 'add' && targetsWorktree) ||
			(subcommand === 'remove' && targetsWorktree) ||
			(subcommand === 'prune' && args.length === 2));
	if (!allowed) {
		throw new Error('Refusing destructive Git operation from outside the context worktree.');
	}
}

export function runDestructiveWorktreeGit(
	worktreeRoot: string,
	projectFolder: string,
	cwd: string,
	args: string[],
	identity?: GitIdentity,
): Buffer {
	assertSafeDestructiveWorktreeTarget(worktreeRoot, projectFolder);
	assertSafeDestructiveWorktreeCommand(worktreeRoot, cwd, args);
	if (identity) {
		try {
			return execFileSync('git', args, {
				cwd,
				stdio: 'pipe',
				timeout: GIT_OPERATION_TIMEOUT_MS,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: identity.name,
					GIT_AUTHOR_EMAIL: identity.email,
					GIT_COMMITTER_NAME: identity.name,
					GIT_COMMITTER_EMAIL: identity.email,
				},
			});
		} catch (error) {
			throw toGitError(error);
		}
	}
	return runGit(cwd, args, GIT_OPERATION_TIMEOUT_MS);
}

export function runWorktreeGitMutation(
	worktreeRoot: string,
	projectFolder: string,
	cwd: string,
	args: string[],
): Buffer {
	return runDestructiveWorktreeGit(worktreeRoot, projectFolder, cwd, args);
}

export function hasCommit(cwd: string, commit: string): boolean {
	return tryRunGit(cwd, ['cat-file', '-e', `${commit}^{commit}`]) !== null;
}

export function isEntireWorktreeClean(worktreeRoot: string): boolean {
	return runGit(worktreeRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']).length === 0;
}

export function readDefaultBranch(repo: ResolvedContextRepo): string {
	if (repo.provider === 'generic') {
		return env.NAO_CONTEXT_GIT_BRANCH || 'main';
	}
	const branch = readDefaultBranchFromRefs(repo.worktreeRoot);
	if (!branch) {
		throw new Error('Unable to determine the repository default branch.');
	}
	return branch;
}

export function readDefaultBranchFromRefs(cwd: string): string | null {
	const symbolic = tryRunGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.toString().trim();
	return symbolic?.replace(/^origin\//, '') || null;
}

export function parseLineCount(value: string): number | null {
	if (!/^\d+$/.test(value)) {
		return null;
	}
	const count = Number(value);
	return Number.isSafeInteger(count) ? count : null;
}

export function assertEntireWorktreeClean(repo: ResolvedContextRepo): void {
	if (!isEntireWorktreeClean(repo.worktreeRoot)) {
		throw new TRPCError({ code: 'CONFLICT', message: 'Commit or discard changes before switching branches.' });
	}
}

export function hasRef(repo: Pick<ResolvedContextRepo, 'worktreeRoot'>, ref: string): boolean {
	return hasRefAt(repo.worktreeRoot, ref);
}

export function hasRefAt(cwd: string, ref: string): boolean {
	return tryRunGit(cwd, ['show-ref', '--verify', '--quiet', ref]) !== null;
}

export function readCurrentBranch(repo: Pick<ResolvedContextRepo, 'worktreeRoot'>): string | null {
	return readCurrentBranchFromPath(repo.worktreeRoot);
}

export function readDefaultBranchRef(
	repo: Pick<ResolvedContextRepo, 'worktreeRoot'>,
	defaultBranch: string,
): string | null {
	const remoteDefaultRef = `refs/remotes/origin/${defaultBranch}`;
	const localDefaultRef = `refs/heads/${defaultBranch}`;
	return hasRef(repo, remoteDefaultRef)
		? `origin/${defaultBranch}`
		: hasRef(repo, localDefaultRef)
			? defaultBranch
			: null;
}

export function readCurrentBranchFromPath(cwd: string): string | null {
	const branch = tryRunGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])?.toString().trim();
	return branch && branch !== 'HEAD' ? branch : null;
}

export function validateRepoFullName(repoFullName: string): void {
	if (!REPO_FULL_NAME_PATTERN.test(repoFullName)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Expected a repository in "owner/name" format.' });
	}
}

export function validateBranch(branch: string): void {
	if (!isValidBranch(branch)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid repository branch.' });
	}
}

export function isValidBranch(branch: string): boolean {
	return !(
		!/^[\w][\w./-]*$/.test(branch) ||
		branch.includes('..') ||
		branch.includes('//') ||
		branch.endsWith('/') ||
		branch.endsWith('.lock')
	);
}

export function normalizeVirtualPath(filePath: string): string {
	return `/${normalizeProjectPath(filePath)}`;
}

export function normalizeRemote(remote: string | null | undefined): string {
	const value = remote?.trim();
	if (!value) {
		return '';
	}
	if (!value.includes('://')) {
		const shorthand = value.match(/^(?:[^@/]+@)?([^:/]+):(?:(?:\d+)\/)?(.+)$/);
		if (shorthand) {
			return normalizeRemoteParts(shorthand[1], shorthand[2]);
		}
	}
	try {
		const parsed = new URL(value);
		return normalizeRemoteParts(parsed.host, parsed.pathname);
	} catch {
		return value
			.replace(/\.git$/i, '')
			.replace(/\/+$/, '')
			.toLowerCase();
	}
}

function normalizeRemoteParts(host: string, repositoryPath: string): string {
	const normalizedPath = repositoryPath
		.replace(/^\/+/, '')
		.replace(/\/+$/, '')
		.replace(/\.git$/i, '');
	return `${host.toLowerCase()}/${normalizedPath.toLowerCase()}`;
}

function isSafeWorktreeSegment(segment: string | undefined): boolean {
	return !!segment && segment !== '.' && segment !== '..';
}

export function sameRealPath(left: string, right: string): boolean {
	try {
		return fs.realpathSync(left) === fs.realpathSync(right);
	} catch {
		return path.resolve(left) === path.resolve(right);
	}
}

export function isGitContextSource(): boolean {
	return env.NAO_CONTEXT_SOURCE === 'git';
}

export function discoverLiveRepositoryRoot(projectFolder: string): string | null {
	const root = tryRunGit(projectFolder, ['rev-parse', '--show-toplevel'])?.toString().trim();
	if (!root) {
		return null;
	}
	try {
		const projectPath = fs.realpathSync(projectFolder);
		const repositoryPath = fs.realpathSync(root);
		const relative = path.relative(repositoryPath, projectPath);
		return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)) ? repositoryPath : null;
	} catch {
		return null;
	}
}

export function resolveLiveProjectPrefix(repositoryRoot: string, projectFolder: string): string {
	const relative = path.relative(fs.realpathSync(repositoryRoot), fs.realpathSync(projectFolder));
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'The live project folder is outside its Git repository.' });
	}
	return relative.split(path.sep).join('/');
}

export function sanitizeLiveContextError(error: unknown, credentials?: string | string[] | null): Error {
	let message = error instanceof Error ? error.message : 'Git pull failed.';
	const providedCredentials = Array.isArray(credentials) ? credentials : [credentials];
	for (const secret of [env.NAO_CONTEXT_GIT_TOKEN, env.NAO_CONTEXT_GIT_SSH_KEY, ...providedCredentials]) {
		if (secret) {
			message = message.replaceAll(secret, '[redacted]');
		}
	}
	message = message.replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@');
	if (/Not possible to fast-forward|divergent branches|non-fast-forward/i.test(message)) {
		return new Error('The live context branch has diverged and cannot be updated with a fast-forward pull.');
	}
	if (/local changes.*would be overwritten|would be overwritten by merge/i.test(message)) {
		return new Error('The live context has local changes that would be overwritten by this update.');
	}
	return new Error(translateGitErrorMessage(message) ?? message);
}

export function readOptionalGitValue(cwd: string, args: string[]): string | null {
	return tryRunGit(cwd, args)?.toString().trim() || null;
}

export function sanitizeGitError(error: unknown, token: string): Error {
	const message = error instanceof Error ? error.message : 'Git operation failed.';
	const redactedMessage = token ? message.replaceAll(token, '[redacted]') : message;
	return new Error(translateGitErrorMessage(redactedMessage) ?? redactedMessage);
}

function translateGitErrorMessage(message: string): string | null {
	const branchCollision = message.match(
		/cannot lock ref ['"]refs\/heads\/([^'"]+)['"]:[\s\S]*?['"]refs\/heads\/([^'"]+)['"] exists; cannot create/i,
	);
	if (branchCollision) {
		return `The branch name "${branchCollision[1]}" can't be used because "${branchCollision[2]}" already exists; choose a different branch name.`;
	}
	if (/non-fast-forward|fetch first/i.test(message)) {
		return 'The branch changed on the remote repository since nao last checked it, so refresh and try again.';
	}
	if (/protected branch|pre-receive hook declined/i.test(message)) {
		return 'The remote repository refused this push because a branch protection rule blocks changes to this branch.';
	}
	if (/Authentication failed|could not read Username|(?:HTTP|returned error:)\s*403/i.test(message)) {
		return 'The repository rejected the configured Git credential; check that the token or SSH key is valid and has access.';
	}
	if (/Repository not found|(?:HTTP|returned error:)\s*404/i.test(message)) {
		return 'This repository does not exist or the configured Git credential cannot access it.';
	}
	return null;
}

export function isDirtySwitchConflict(error: unknown): boolean {
	const message = error instanceof Error ? error.message : '';
	return message.includes('would be overwritten by checkout') || message.includes('would be overwritten by switch');
}
