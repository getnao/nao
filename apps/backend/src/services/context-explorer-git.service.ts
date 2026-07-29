import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { ContextChangedFile, ContextFileDiff, RepoProvider } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import {
	ContextRepo,
	fromRepoPath,
	getCommittedProjectPaths,
	normalizeProjectPath,
	readCommittedFile,
	resolveContextRepo,
	toContextRepoState,
} from '../utils/context-repo';
import { runGit, toGitError, tryRunGit } from '../utils/git-repo';
import { writeFileAtomically } from '../utils/safe-file-write';
import {
	decodeTextContent,
	hashContent,
	MAX_CONTEXT_FILE_SIZE,
	resolveAndValidatePath,
	validateContentBuffer,
} from './context-explorer.service';
import * as github from './github';
import * as gitlab from './gitlab';

const REPO_FULL_NAME_PATTERN = /^[\w./-]+\/[\w.-]+$/;
const CONNECT_GIT_TIMEOUT_MS = 120_000;

interface GitIdentity {
	name: string;
	email: string;
}

export interface ContextRepositoryProvider {
	authenticatedRepoUrl: (token: string, repoFullName: string) => string;
	publicRepoUrl: (repoFullName: string) => string;
	getUserGitIdentity: (token: string) => Promise<GitIdentity>;
	coAuthor: GitIdentity;
}

export interface ConnectContextRepositoryInput {
	projectFolder: string;
	provider: RepoProvider;
	repoFullName: string;
	branch: string;
	token: string;
}

export interface ConnectContextRepositoryResult {
	provider: RepoProvider;
	repoFullName: string;
	branch: string;
	connectionType: 'linked-existing-commit' | 'published-initial-commit';
}

export const CONTEXT_REPOSITORY_PROVIDERS: Record<RepoProvider, ContextRepositoryProvider> = {
	github: {
		authenticatedRepoUrl: github.authenticatedRepoUrl,
		publicRepoUrl: github.publicRepoUrl,
		getUserGitIdentity: github.getUserGitIdentity,
		coAuthor: github.NAO_CO_AUTHOR,
	},
	gitlab: {
		authenticatedRepoUrl: gitlab.authenticatedRepoUrl,
		publicRepoUrl: gitlab.publicRepoUrl,
		getUserGitIdentity: gitlab.getUserGitIdentity,
		coAuthor: gitlab.NAO_CO_AUTHOR,
	},
};

export async function connectContextRepository(
	input: ConnectContextRepositoryInput,
	providerService: ContextRepositoryProvider = CONTEXT_REPOSITORY_PROVIDERS[input.provider],
): Promise<ConnectContextRepositoryResult> {
	validateRepoFullName(input.repoFullName);
	validateBranch(input.branch);
	assertContextRepositoryCanBeConnected(input.projectFolder);

	const gitDirectory = path.join(input.projectFolder, '.git');
	try {
		runGit(input.projectFolder, ['init', '--quiet', `--initial-branch=${input.branch}`]);
		runGit(input.projectFolder, ['remote', 'add', 'origin', providerService.publicRepoUrl(input.repoFullName)]);

		const authenticatedUrl = providerService.authenticatedRepoUrl(input.token, input.repoFullName);
		if (fetchBranch(input.projectFolder, authenticatedUrl, input.branch)) {
			runGit(input.projectFolder, ['reset', '--mixed', 'FETCH_HEAD'], CONNECT_GIT_TIMEOUT_MS);
			return connectionResult(input, 'linked-existing-commit');
		}

		const author = await providerService.getUserGitIdentity(input.token);
		publishInitialCommit(input.projectFolder, authenticatedUrl, input.branch, author, providerService.coAuthor);
		return connectionResult(input, 'published-initial-commit');
	} catch (error) {
		const connectionError = sanitizeConnectionError(error, input.token);
		try {
			fs.rmSync(gitDirectory, { recursive: true, force: true });
		} catch (cleanupError) {
			const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error';
			throw new Error(`${connectionError.message} Rollback failed: ${cleanupMessage}`);
		}
		throw connectionError;
	}
}

export function getContextRepositoryStatus(projectFolder: string) {
	const repo = resolveContextRepo(projectFolder);
	const isGitRepository =
		fs.existsSync(path.join(projectFolder, '.git')) ||
		tryRunGit(projectFolder, ['rev-parse', '--is-inside-work-tree']) !== null;

	return {
		repo: toContextRepoState(repo),
		repositoryUrl: repo ? CONTEXT_REPOSITORY_PROVIDERS[repo.provider].publicRepoUrl(repo.repoFullName) : null,
		isGitRepository,
		managedByContextSource: isGitContextSource(),
		lastCommitMessage: readOptionalGitValue(projectFolder, ['log', '-1', '--format=%s']),
		lastCommitDate: readOptionalGitValue(projectFolder, ['log', '-1', '--format=%cI']),
	};
}

export function getChangedContextFiles(projectFolder: string): ContextChangedFile[] {
	const repo = requireContextRepo(projectFolder);
	getCommittedProjectPaths(repo);
	const pathspec = repo.projectPrefix || '.';
	const output = runGit(repo.worktreeRoot, [
		'status',
		'--porcelain=v1',
		'-z',
		'--untracked-files=all',
		'--',
		pathspec,
	]);
	return parseChangedFiles(output, repo, projectFolder);
}

export async function getContextFileDiff(filePath: string, projectFolder: string): Promise<ContextFileDiff> {
	resolveAndValidatePath(filePath, projectFolder);
	const projectPath = normalizeProjectPath(filePath);
	const changedFile = getChangedContextFiles(projectFolder).find((entry) => entry.path === `/${projectPath}`);
	if (!changedFile) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'This file has no local changes.' });
	}

	const repo = requireContextRepo(projectFolder);
	const oldContent = changedFile.kind === 'untracked' ? '' : readCommittedText(repo, projectPath);
	const newContent = changedFile.kind === 'deleted' ? '' : readWorkingTreeText(filePath, projectFolder);
	return { ...changedFile, oldContent, newContent };
}

export function discardContextFileChange(filePath: string, projectFolder: string): { hash: string } {
	const { realPath, root } = resolveAndValidatePath(filePath, projectFolder);
	const repo = requireContextRepo(projectFolder);
	const projectPath = normalizeProjectPath(filePath);
	const trackedPaths = getCommittedProjectPaths(repo);
	if (!trackedPaths.has(projectPath)) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'This file is not committed to the context repository, so there is nothing to restore.',
		});
	}

	let committedContent: Buffer;
	try {
		committedContent = readCommittedFile(repo, projectPath, MAX_CONTEXT_FILE_SIZE);
		validateContentBuffer(committedContent);
	} catch (error) {
		throw toDiffError(error);
	}
	const content = decodeTextContent(committedContent);
	writeFileAtomically({
		content,
		displayPath: filePath,
		root,
		target: realPath,
	});
	return { hash: hashContent(committedContent) };
}

export function requireContextRepo(projectFolder: string): ContextRepo {
	const repo = resolveContextRepo(projectFolder);
	if (!repo) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'No context repository is connected. Add a GitHub or GitLab origin to enable Git changes.',
		});
	}
	return repo;
}

function assertContextRepositoryCanBeConnected(projectFolder: string): void {
	if (isGitContextSource()) {
		throw new Error(
			'This project is managed by NAO_CONTEXT_SOURCE=git. Change that deployment setting instead of connecting a repository here.',
		);
	}
	if (
		fs.existsSync(path.join(projectFolder, '.git')) ||
		tryRunGit(projectFolder, ['rev-parse', '--is-inside-work-tree']) !== null
	) {
		throw new Error('This project is already inside a Git repository. Its existing Git metadata was not changed.');
	}
}

function fetchBranch(projectFolder: string, authenticatedUrl: string, branch: string): boolean {
	let fetchError: unknown;
	try {
		runGit(projectFolder, ['fetch', '--depth', '1', authenticatedUrl, branch], CONNECT_GIT_TIMEOUT_MS);
		return true;
	} catch (error) {
		fetchError = error;
	}

	let remoteRefs: Buffer;
	try {
		remoteRefs = runGit(projectFolder, ['ls-remote', authenticatedUrl], CONNECT_GIT_TIMEOUT_MS);
	} catch {
		throw fetchError;
	}
	if (remoteRefs.toString().trim()) {
		throw fetchError;
	}
	return false;
}

function publishInitialCommit(
	projectFolder: string,
	authenticatedUrl: string,
	branch: string,
	author: GitIdentity,
	coAuthor: GitIdentity,
): void {
	runGit(projectFolder, ['add', '-A'], CONNECT_GIT_TIMEOUT_MS);
	runGitWithIdentity(
		projectFolder,
		['commit', '--quiet', '--allow-empty', '-m', withCoAuthor('Initialize nao context', coAuthor)],
		author,
	);
	runGit(projectFolder, ['push', authenticatedUrl, `HEAD:refs/heads/${branch}`], CONNECT_GIT_TIMEOUT_MS);
}

function runGitWithIdentity(projectFolder: string, args: string[], identity: GitIdentity): Buffer {
	try {
		return execFileSync('git', args, {
			cwd: projectFolder,
			stdio: 'pipe',
			timeout: CONNECT_GIT_TIMEOUT_MS,
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

function withCoAuthor(message: string, coAuthor: GitIdentity): string {
	return `${message}\n\nCo-authored-by: ${coAuthor.name} <${coAuthor.email}>`;
}

function connectionResult(
	input: ConnectContextRepositoryInput,
	connectionType: ConnectContextRepositoryResult['connectionType'],
): ConnectContextRepositoryResult {
	return {
		provider: input.provider,
		repoFullName: input.repoFullName,
		branch: input.branch,
		connectionType,
	};
}

function validateRepoFullName(repoFullName: string): void {
	if (!REPO_FULL_NAME_PATTERN.test(repoFullName)) {
		throw new Error('Expected a repository in "owner/name" format.');
	}
}

function validateBranch(branch: string): void {
	if (
		!/^[\w][\w./-]*$/.test(branch) ||
		branch.includes('..') ||
		branch.includes('//') ||
		branch.endsWith('/') ||
		branch.endsWith('.lock')
	) {
		throw new Error('Invalid repository branch.');
	}
}

function isGitContextSource(): boolean {
	return process.env.NAO_CONTEXT_SOURCE === 'git';
}

function readOptionalGitValue(projectFolder: string, args: string[]): string | null {
	return tryRunGit(projectFolder, args)?.toString().trim() || null;
}

function sanitizeConnectionError(error: unknown, token: string): Error {
	const message = error instanceof Error ? error.message : 'Failed to connect repository.';
	return new Error(token ? message.replaceAll(token, '[redacted]') : message);
}

function parseChangedFiles(output: Buffer, repo: ContextRepo, projectFolder: string): ContextChangedFile[] {
	const records = output.toString().split('\0');
	const changedFiles = new Map<string, ContextChangedFile>();

	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record || record.length < 4) {
			continue;
		}
		const status = record.slice(0, 2);
		const repoPath = record.slice(3);
		if (status.includes('R') || status.includes('C')) {
			const sourceRepoPath = records[++index];
			addChangedFile(changedFiles, repo, repoPath, 'untracked', projectFolder);
			if (status.includes('R') && sourceRepoPath) {
				addChangedFile(changedFiles, repo, sourceRepoPath, 'deleted', projectFolder);
			}
			continue;
		}

		addChangedFile(changedFiles, repo, repoPath, statusKind(status), projectFolder);
	}

	return [...changedFiles.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function statusKind(status: string): ContextChangedFile['kind'] {
	if (status === '??' || status.includes('A')) {
		return 'untracked';
	}
	return status.includes('D') ? 'deleted' : 'modified';
}

function addChangedFile(
	changedFiles: Map<string, ContextChangedFile>,
	repo: ContextRepo,
	repoPath: string,
	kind: ContextChangedFile['kind'],
	projectFolder: string,
): void {
	const projectPath = fromRepoPath(repo, repoPath);
	if (!projectPath || !isExplorerPath(projectPath, projectFolder)) {
		return;
	}
	const path = `/${projectPath}`;
	changedFiles.set(path, { path, kind });
}

function isExplorerPath(projectPath: string, projectFolder: string): boolean {
	try {
		resolveAndValidatePath(`/${projectPath}`, projectFolder);
		return true;
	} catch {
		return false;
	}
}

function readCommittedText(repo: ContextRepo, projectPath: string): string {
	try {
		const content = readCommittedFile(repo, projectPath, MAX_CONTEXT_FILE_SIZE);
		validateContentBuffer(content);
		return decodeTextContent(content);
	} catch (error) {
		throw toDiffError(error);
	}
}

function readWorkingTreeText(filePath: string, projectFolder: string): string {
	const { realPath } = resolveAndValidatePath(filePath, projectFolder);
	try {
		const fileDescriptor = fs.openSync(realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
		try {
			const stat = fs.fstatSync(fileDescriptor);
			if (!stat.isFile()) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only regular files can be diffed.' });
			}
			if (stat.size > MAX_CONTEXT_FILE_SIZE) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'File is too large to diff (max 1 MB).' });
			}
			const content = fs.readFileSync(fileDescriptor);
			validateContentBuffer(content);
			return decodeTextContent(content);
		} finally {
			fs.closeSync(fileDescriptor);
		}
	} catch (error) {
		throw toDiffError(error);
	}
}

function toDiffError(error: unknown): TRPCError {
	if (error instanceof TRPCError) {
		return error;
	}
	const message = error instanceof Error ? error.message : 'Unable to read this file diff.';
	if (message.includes('maxBuffer')) {
		return new TRPCError({ code: 'BAD_REQUEST', message: 'File is too large to diff (max 1 MB).' });
	}
	return new TRPCError({ code: 'BAD_REQUEST', message });
}
