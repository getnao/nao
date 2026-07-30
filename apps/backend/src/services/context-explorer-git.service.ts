import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type {
	ContextBranchInfo,
	ContextChangedFile,
	ContextFileDiff,
	ContextGitUnavailableReason,
	RepoProvider,
} from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import type { ContextRepoConfig, ResolvedContextRepo, UnresolvedContextRepo } from '../utils/context-repo';
import {
	ContextProjectResolutionError,
	fromRepoPath,
	getWorktreeProjectRoot,
	invalidateContextProjectPrefix,
	normalizeProjectPath,
	readCommittedFile,
	resolveContextProject,
	resolveContextRepo,
	toContextRepoState,
	toRepoPath,
} from '../utils/context-repo';
import type { GitIdentity } from '../utils/git-identity';
import { withCoAuthors } from '../utils/git-identity';
import { runGit, toGitError, tryRunGit } from '../utils/git-repo';
import { toRealPath } from '../utils/tools';
import {
	decodeTextContent,
	hashContent,
	MAX_CONTEXT_FILE_SIZE,
	validateContentBuffer,
} from './context-explorer.service';
import type { ReviewRequestProvider } from './review-request-provider';
import { REVIEW_REQUEST_PROVIDERS } from './review-request-provider';

const REPO_FULL_NAME_PATTERN = /^[\w./-]+\/[\w.-]+$/;
const GIT_OPERATION_TIMEOUT_MS = 120_000;

export type ContextRepositoryProvider = ReviewRequestProvider;

export interface ContextExplorerGitContext {
	projectId: string;
	projectFolder: string;
	token: string | null;
	configOverride?: ContextRepoConfig | null;
	integrationAvailableOverride?: boolean;
	providerOverride?: ContextRepositoryProvider;
	includeEditorMetadata?: boolean;
}

export type ContextExplorerGitResolution =
	| {
			status: 'available';
			repo: ResolvedContextRepo;
			context: ContextExplorerGitContext & { token: string };
	  }
	| {
			status: 'unavailable';
			reason: ContextGitUnavailableReason;
			message: string;
			repo: ReturnType<typeof toContextRepoState>;
	  };

export interface ContextRepositoryStatus {
	repo: ReturnType<typeof toContextRepoState>;
	repositoryUrl: string | null;
	managedByContextSource: boolean;
	gitUnavailableReason: ContextGitUnavailableReason | null;
	gitUnavailableMessage: string | null;
	lastCommitMessage: string | null;
	lastCommitDate: string | null;
	branches: ContextBranchInfo | null;
	openReviewRequest: { url: string } | null;
	isGitRepository: boolean;
}

export interface CreateBranchAndCommitInput {
	branch?: string;
	paths: string[];
	message: string;
}

export interface CreateBranchAndCommitResult {
	branch: string;
	commit: string;
	baseUsed: string;
	usedFallbackBase: boolean;
}

type ParsedContextChangedFile = Pick<ContextChangedFile, 'path' | 'kind'>;
type ContextLineCounts = Pick<ContextChangedFile, 'additions' | 'deletions'>;

export async function resolveContextExplorerGit(
	context: ContextExplorerGitContext,
): Promise<ContextExplorerGitResolution> {
	const configuredRepo = await resolveContextRepo(context.projectId, context.projectFolder, context.configOverride);
	if (!configuredRepo) {
		return unavailable('no-repo', null);
	}
	const provider = context.providerOverride ?? REVIEW_REQUEST_PROVIDERS[configuredRepo.provider];
	if (!provider) {
		return unavailable('unsupported-provider', configuredRepo);
	}
	if ((context.integrationAvailableOverride ?? provider.isIntegrationAvailable()) === false) {
		return unavailable('github-unavailable', configuredRepo);
	}
	if (!context.token) {
		return unavailable('no-token', configuredRepo);
	}
	try {
		const repo = await ensureContextWorktree({ ...context, token: context.token }, configuredRepo);
		return { status: 'available', repo, context: { ...context, token: context.token } };
	} catch (error) {
		if (error instanceof ContextProjectResolutionError) {
			return {
				status: 'unavailable',
				reason: error.reason,
				message: error.message,
				repo: toContextRepoState(configuredRepo),
			};
		}
		throw error;
	}
}

export async function requireContextExplorerGit(
	context: ContextExplorerGitContext,
): Promise<{ repo: ResolvedContextRepo; context: ContextExplorerGitContext & { token: string } }> {
	const resolution = await resolveContextExplorerGit(context);
	if (resolution.status === 'unavailable') {
		throw new TRPCError({ code: 'FORBIDDEN', message: resolution.message });
	}
	return resolution;
}

export async function connectContextRepository(
	input: ContextExplorerGitContext & { token: string; provider: RepoProvider; repoFullName: string },
	dependencies: {
		provider?: ContextRepositoryProvider;
		updateConfig?: (
			projectId: string,
			patch: { repoFullName: string; repoProvider: RepoProvider },
		) => Promise<unknown>;
	} = {},
): Promise<{
	provider: RepoProvider;
	repoFullName: string;
	defaultBranch: string;
	branch: string;
	connectionType: 'linked-existing-commit';
}> {
	validateRepoFullName(input.repoFullName);
	if (isGitContextSource()) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message:
				'This project is managed by NAO_CONTEXT_SOURCE=git. Change that deployment setting instead of connecting a repository here.',
		});
	}
	const config = { provider: input.provider, repoFullName: input.repoFullName };
	const context = {
		...input,
		configOverride: config,
		providerOverride: dependencies.provider ?? input.providerOverride ?? REVIEW_REQUEST_PROVIDERS[input.provider],
	};
	const repo = await ensureContextWorktree(context);
	const updateConfig =
		dependencies.updateConfig ?? (await import('../queries/context-recommendation.queries')).updateConfig;
	await updateConfig(input.projectId, {
		repoFullName: input.repoFullName,
		repoProvider: input.provider,
	});
	const defaultBranch = readDefaultBranch(repo);
	return {
		provider: input.provider,
		repoFullName: input.repoFullName,
		defaultBranch,
		branch: defaultBranch,
		connectionType: 'linked-existing-commit',
	};
}

export async function ensureContextWorktree(
	context: ContextExplorerGitContext & { token: string },
	configuredRepo?: UnresolvedContextRepo,
): Promise<ResolvedContextRepo> {
	const unresolved =
		configuredRepo ?? (await resolveContextRepo(context.projectId, context.projectFolder, context.configOverride));
	if (!unresolved) {
		throw new TRPCError({ code: 'FORBIDDEN', message: unavailableMessage('no-repo') });
	}
	const provider = context.providerOverride ?? REVIEW_REQUEST_PROVIDERS[unresolved.provider];
	if (!provider) {
		throw new TRPCError({ code: 'FORBIDDEN', message: unavailableMessage('unsupported-provider') });
	}
	const matchingClone = findMatchingLocalClone(context.projectFolder, unresolved.repoFullName, provider);
	if (!isHealthyWorktree(unresolved, provider)) {
		removeBrokenWorktree(unresolved, context.projectFolder, matchingClone);
		fs.mkdirSync(path.dirname(unresolved.worktreeRoot), { recursive: true });
		try {
			if (matchingClone) {
				provisionFromLocalClone(unresolved, context.projectFolder, matchingClone);
			} else {
				provisionByClone(unresolved, context.projectFolder, provider, context.token);
			}
		} catch (error) {
			removeWorktreeDirectory(unresolved.worktreeRoot, context.projectFolder);
			throw sanitizeGitError(error, context.token);
		}
		invalidateContextProjectPrefix(unresolved.worktreeRoot);
	}
	return resolveContextProject(unresolved, context.projectFolder, matchingClone);
}

export async function getContextRepositoryStatus(context: ContextExplorerGitContext): Promise<ContextRepositoryStatus> {
	try {
		const resolution = await resolveContextExplorerGit(context);
		if (resolution.status === 'unavailable') {
			const provider = resolution.repo ? REVIEW_REQUEST_PROVIDERS[resolution.repo.provider] : null;
			return {
				repo: resolution.repo,
				repositoryUrl:
					resolution.repo && provider ? provider.publicRepoUrl(resolution.repo.repoFullName) : null,
				managedByContextSource: isGitContextSource(),
				gitUnavailableReason: resolution.reason,
				gitUnavailableMessage: resolution.message,
				lastCommitMessage: null,
				lastCommitDate: null,
				branches: null,
				openReviewRequest: null,
				isGitRepository: false,
			};
		}
		const { repo } = resolution;
		const provider = resolution.context.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
		const branches = getContextBranches(repo);
		return {
			repo: toContextRepoState(repo),
			repositoryUrl: provider.publicRepoUrl(repo.repoFullName),
			managedByContextSource: isGitContextSource(),
			gitUnavailableReason: null,
			gitUnavailableMessage: null,
			lastCommitMessage: readOptionalGitValue(repo.worktreeRoot, ['log', '-1', '--format=%s']),
			lastCommitDate: readOptionalGitValue(repo.worktreeRoot, ['log', '-1', '--format=%cI']),
			branches,
			openReviewRequest: await findOpenContextReviewRequest(
				provider,
				resolution.context.token,
				repo.repoFullName,
				branches.currentBranch,
				branches.defaultBranch,
			),
			isGitRepository: true,
		};
	} catch {
		return {
			repo: null,
			repositoryUrl: null,
			managedByContextSource: isGitContextSource(),
			gitUnavailableReason: 'git-unavailable',
			gitUnavailableMessage: unavailableMessage('git-unavailable'),
			lastCommitMessage: null,
			lastCommitDate: null,
			branches: null,
			openReviewRequest: null,
			isGitRepository: false,
		};
	}
}

export function getContextBranches(repo: ResolvedContextRepo): ContextBranchInfo {
	const defaultBranch = readDefaultBranch(repo);
	const currentBranch = readCurrentBranch(repo);
	const branches = readContextBranchNames(repo);
	branches.add(defaultBranch);
	return {
		currentBranch,
		defaultBranch,
		aheadCommitCount: readAheadCommitCount(repo, currentBranch, defaultBranch),
		unpushedCommitCount: readUnpushedCommitCount(repo, currentBranch, defaultBranch),
		branches: [...branches].sort(),
		suggestedBranch: generateContextBranchName(repo),
	};
}

export async function switchContextBranch(
	context: ContextExplorerGitContext,
	branch: string,
): Promise<ContextBranchInfo> {
	validateBranch(branch);
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	assertCleanWorktree(repo);
	const localRef = `refs/heads/${branch}`;
	const remoteRef = `refs/remotes/origin/${branch}`;
	if (hasRef(repo, localRef)) {
		runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, ['switch', branch]);
	} else if (hasRef(repo, remoteRef)) {
		runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, [
			'switch',
			'--track',
			'-c',
			branch,
			`origin/${branch}`,
		]);
	} else {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Branch not found: ${branch}` });
	}
	invalidateContextProjectPrefix(repo.worktreeRoot);
	return getContextBranches(resolveAfterBranchChange(repo, context.projectFolder, provider));
}

export async function createContextBranch(
	context: ContextExplorerGitContext,
	branch: string,
): Promise<ContextBranchInfo> {
	validateBranch(branch);
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	fetchContextRepository(repo, context.projectFolder, provider, availableContext.token);
	assertBranchAvailable(repo, branch);
	runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, [
		'switch',
		'-c',
		branch,
		`origin/${readDefaultBranch(repo)}`,
	]);
	invalidateContextProjectPrefix(repo.worktreeRoot);
	return getContextBranches(resolveAfterBranchChange(repo, context.projectFolder, provider));
}

export async function createContextBranchAndCommit(
	context: ContextExplorerGitContext,
	input: CreateBranchAndCommitInput,
): Promise<CreateBranchAndCommitResult> {
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	fetchContextRepository(repo, context.projectFolder, provider, availableContext.token);
	const branch = input.branch ?? generateContextBranchName(repo);
	validateBranch(branch);
	assertBranchAvailable(repo, branch);
	const defaultBranch = readDefaultBranch(repo);
	const currentHead = runGit(repo.worktreeRoot, ['rev-parse', 'HEAD']).toString().trim();
	let baseUsed = `origin/${defaultBranch}`;
	let usedFallbackBase = false;
	try {
		runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, [
			'switch',
			'-c',
			branch,
			baseUsed,
		]);
	} catch (error) {
		if (hasRef(repo, `refs/heads/${branch}`) || !isDirtySwitchConflict(error)) {
			throw error;
		}
		baseUsed = currentHead;
		usedFallbackBase = true;
		runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, [
			'switch',
			'-c',
			branch,
			currentHead,
		]);
	}
	invalidateContextProjectPrefix(repo.worktreeRoot);
	const resolvedRepo = resolveAfterBranchChange(repo, context.projectFolder, provider);
	const commit = await commitSelectedChanges(resolvedRepo, context.projectFolder, availableContext, input);
	if (context.includeEditorMetadata !== false) {
		await clearRecordedContextFileEdits(context.projectId, input.paths);
	}
	return { branch, commit, baseUsed, usedFallbackBase };
}

export async function commitContextChanges(
	context: ContextExplorerGitContext,
	input: { paths: string[]; message: string },
): Promise<{ commit: string }> {
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const commit = await commitSelectedChanges(repo, context.projectFolder, availableContext, input);
	if (context.includeEditorMetadata !== false) {
		await clearRecordedContextFileEdits(context.projectId, input.paths);
	}
	return { commit };
}

export async function getChangedContextFiles(context: ContextExplorerGitContext): Promise<ContextChangedFile[]> {
	try {
		const resolution = await resolveContextExplorerGit(context);
		if (resolution.status === 'unavailable') {
			return [];
		}
		const files = readChangedFiles(resolution.repo);
		if (context.includeEditorMetadata === false) {
			return files;
		}
		const { addContextFileEditors } = await import('./context-file-edit.service');
		return await addContextFileEditors(context.projectId, files);
	} catch {
		return [];
	}
}

export async function getContextFileDiff(
	context: ContextExplorerGitContext,
	filePath: string,
): Promise<ContextFileDiff> {
	const { repo } = await requireContextExplorerGit(context);
	validateWorktreePath(repo, filePath);
	const projectPath = normalizeProjectPath(filePath);
	const changedFile = readChangedFiles(repo).find((entry) => entry.path === `/${projectPath}`);
	if (!changedFile) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'This file has no changes.' });
	}
	return {
		...changedFile,
		oldContent: changedFile.kind === 'untracked' ? '' : readCommittedText(repo, projectPath),
		newContent: changedFile.kind === 'deleted' ? '' : readWorkingTreeText(repo, filePath),
	};
}

export async function discardContextFileChange(
	context: ContextExplorerGitContext,
	filePath: string,
): Promise<{ hash: string | null }> {
	const { repo } = await requireContextExplorerGit(context);
	await discardPath(repo, context.projectFolder, filePath);
	if (context.includeEditorMetadata !== false) {
		await clearRecordedContextFileEdits(context.projectId, [filePath]);
	}
	const target = toRealPath(filePath, getWorktreeProjectRoot(repo));
	return { hash: fs.existsSync(target) ? hashContent(fs.readFileSync(target)) : null };
}

export async function discardAllContextChanges(context: ContextExplorerGitContext): Promise<void> {
	const { repo } = await requireContextExplorerGit(context);
	const changedFiles = parseChangedFiles(readStatus(repo), repo);
	for (const file of changedFiles) {
		await discardPath(repo, context.projectFolder, file.path);
	}
	if (context.includeEditorMetadata !== false) {
		const { clearAllContextFileEdits } = await import('./context-file-edit.service');
		await clearAllContextFileEdits(context.projectId);
	}
}

export function pushContextBranch(
	repo: ResolvedContextRepo,
	projectFolder: string,
	provider: ContextRepositoryProvider,
	token: string,
): { branch: string; defaultBranch: string } {
	const branch = readCurrentBranch(repo);
	const defaultBranch = readDefaultBranch(repo);
	if (!branch || branch === defaultBranch) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Open pull requests from a non-default branch.' });
	}
	assertSafeDestructiveWorktreeTarget(repo.worktreeRoot, projectFolder);
	try {
		provider.pushBranch({ token, repoFullName: repo.repoFullName, dir: repo.worktreeRoot, branch });
		runDestructiveWorktreeGit(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
			'update-ref',
			`refs/remotes/origin/${branch}`,
			'HEAD',
		]);
	} catch (error) {
		throw sanitizeGitError(error, token);
	}
	return { branch, defaultBranch };
}

export function getContextBranchCommitMessages(repo: ResolvedContextRepo): string[] {
	const currentBranch = readCurrentBranch(repo);
	const defaultBranch = readDefaultBranch(repo);
	if (!currentBranch || currentBranch === defaultBranch) {
		return [];
	}
	const base = readDefaultBranchRef(repo, defaultBranch);
	if (!base) {
		return [];
	}
	return runGit(repo.worktreeRoot, ['log', '--reverse', '--format=%s', `${base}..HEAD`])
		.toString()
		.split('\n')
		.map((message) => message.trim())
		.filter(Boolean);
}

export function generateContextBranchName(repo: ResolvedContextRepo, timestamp = Date.now()): string {
	const branches = readContextBranchNames(repo);
	const base = `nao/context-edits-${timestamp.toString(36)}`;
	let candidate = base;
	let suffix = 2;
	while (branches.has(candidate)) {
		candidate = `${base}-${suffix++}`;
	}
	return candidate;
}

export async function suggestContextBranchName(context: ContextExplorerGitContext): Promise<string> {
	const { repo } = await requireContextExplorerGit(context);
	return generateContextBranchName(repo);
}

export function assertSafeDestructiveWorktreeTarget(worktreeRoot: string, projectFolder: string): void {
	const worktree = path.resolve(worktreeRoot);
	const live = path.resolve(projectFolder);
	const segments = worktree.split(path.sep);
	const naoIndex = segments.lastIndexOf('.nao');
	if (naoIndex < 0 || segments[naoIndex + 1] !== 'worktrees' || !segments[naoIndex + 2]) {
		throw new Error('Refusing destructive Git operation outside a .nao/worktrees directory.');
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

function runDestructiveWorktreeGit(
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

function runWorktreeGitMutation(worktreeRoot: string, projectFolder: string, cwd: string, args: string[]): Buffer {
	return runDestructiveWorktreeGit(worktreeRoot, projectFolder, cwd, args);
}

async function commitSelectedChanges(
	repo: ResolvedContextRepo,
	projectFolder: string,
	context: ContextExplorerGitContext & { token: string },
	input: { paths: string[]; message: string },
): Promise<string> {
	const changedPaths = new Set(parseChangedFiles(readStatus(repo), repo).map((file) => file.path));
	const paths = [...new Set(input.paths.map(normalizeVirtualPath))];
	if (paths.length === 0 || paths.some((filePath) => !changedPaths.has(filePath))) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select one or more changed context files to commit.' });
	}
	const repoPaths = paths.map((filePath) => {
		validateWorktreePath(repo, filePath);
		return toRepoPath(repo, filePath);
	});
	const provider = context.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	const author = await provider.getUserGitIdentity(context.token);
	runWorktreeGitMutation(repo.worktreeRoot, projectFolder, repo.worktreeRoot, ['add', '--', ...repoPaths]);
	if (tryRunGit(repo.worktreeRoot, ['diff', '--cached', '--quiet'])) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'The selected files have no changes to commit.' });
	}
	runGitWithIdentity(
		repo,
		projectFolder,
		['commit', '--quiet', '-m', withCoAuthors(input.message, [provider.coAuthor])],
		author,
	);
	return runGit(repo.worktreeRoot, ['rev-parse', 'HEAD']).toString().trim();
}

async function discardPath(repo: ResolvedContextRepo, projectFolder: string, filePath: string): Promise<void> {
	validateWorktreePath(repo, filePath);
	const repoPath = toRepoPath(repo, filePath);
	if (tryRunGit(repo.worktreeRoot, ['ls-files', '--error-unmatch', '--', repoPath]) !== null) {
		runDestructiveWorktreeGit(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
			'restore',
			'--source=HEAD',
			'--staged',
			'--worktree',
			'--',
			repoPath,
		]);
		return;
	}
	const target = toRealPath(filePath, getWorktreeProjectRoot(repo));
	assertSafeDestructiveWorktreeTarget(repo.worktreeRoot, projectFolder);
	const stat = fs.lstatSync(target);
	if (!stat.isFile() && !stat.isSymbolicLink()) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only individual files can be discarded.' });
	}
	fs.unlinkSync(target);
}

function provisionFromLocalClone(repo: UnresolvedContextRepo, projectFolder: string, sourceRoot: string): void {
	const defaultBranch = readDefaultBranchFromRefs(sourceRoot) ?? readCurrentBranchFromPath(sourceRoot);
	if (!defaultBranch) {
		throw new Error('Unable to determine the repository default branch.');
	}
	const ref = hasRefAt(sourceRoot, `refs/remotes/origin/${defaultBranch}`)
		? `origin/${defaultBranch}`
		: defaultBranch;
	runWorktreeGitMutation(repo.worktreeRoot, projectFolder, sourceRoot, [
		'worktree',
		'add',
		'--force',
		'--detach',
		repo.worktreeRoot,
		ref,
	]);
}

function provisionByClone(
	repo: UnresolvedContextRepo,
	projectFolder: string,
	provider: ContextRepositoryProvider,
	token: string,
): void {
	assertSafeDestructiveWorktreeTarget(repo.worktreeRoot, projectFolder);
	runGit(
		path.dirname(repo.worktreeRoot),
		['clone', provider.authenticatedRepoUrl(token, repo.repoFullName), repo.worktreeRoot],
		GIT_OPERATION_TIMEOUT_MS,
	);
	runWorktreeGitMutation(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
		'remote',
		'set-url',
		'origin',
		provider.publicRepoUrl(repo.repoFullName),
	]);
}

function fetchContextRepository(
	repo: ResolvedContextRepo,
	projectFolder: string,
	provider: ContextRepositoryProvider,
	token: string,
): void {
	try {
		runWorktreeGitMutation(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
			'fetch',
			provider.authenticatedRepoUrl(token, repo.repoFullName),
			'+refs/heads/*:refs/remotes/origin/*',
		]);
	} catch (error) {
		throw sanitizeGitError(error, token);
	}
}

function readDefaultBranch(repo: ResolvedContextRepo): string {
	const branch = readDefaultBranchFromRefs(repo.worktreeRoot);
	if (!branch) {
		throw new Error('Unable to determine the repository default branch.');
	}
	return branch;
}

function readDefaultBranchFromRefs(cwd: string): string | null {
	const symbolic = tryRunGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.toString().trim();
	return symbolic?.replace(/^origin\//, '') || null;
}

function findMatchingLocalClone(
	projectFolder: string,
	repoFullName: string,
	provider: ContextRepositoryProvider,
): string | null {
	try {
		const root = fs.realpathSync(runGit(projectFolder, ['rev-parse', '--show-toplevel']).toString().trim());
		const origin = runGit(root, ['remote', 'get-url', 'origin']).toString().trim();
		return normalizeRemote(origin) === normalizeRemote(provider.publicRepoUrl(repoFullName)) ? root : null;
	} catch {
		return null;
	}
}

function isHealthyWorktree(repo: UnresolvedContextRepo, provider: ContextRepositoryProvider): boolean {
	const topLevel = tryRunGit(repo.worktreeRoot, ['rev-parse', '--show-toplevel'])?.toString().trim();
	const origin = tryRunGit(repo.worktreeRoot, ['remote', 'get-url', 'origin'])?.toString().trim();
	return (
		!!topLevel &&
		sameRealPath(topLevel, repo.worktreeRoot) &&
		normalizeRemote(origin) === normalizeRemote(provider.publicRepoUrl(repo.repoFullName))
	);
}

function removeBrokenWorktree(repo: UnresolvedContextRepo, projectFolder: string, matchingClone: string | null): void {
	if (matchingClone) {
		try {
			runDestructiveWorktreeGit(repo.worktreeRoot, projectFolder, matchingClone, [
				'worktree',
				'remove',
				'--force',
				repo.worktreeRoot,
			]);
		} catch {
			runDestructiveWorktreeGit(repo.worktreeRoot, projectFolder, matchingClone, ['worktree', 'prune']);
			removeWorktreeDirectory(repo.worktreeRoot, projectFolder);
		}
	}
	removeWorktreeDirectory(repo.worktreeRoot, projectFolder);
	invalidateContextProjectPrefix(repo.worktreeRoot);
}

function removeWorktreeDirectory(worktreeRoot: string, projectFolder: string): void {
	assertSafeDestructiveWorktreeTarget(worktreeRoot, projectFolder);
	fs.rmSync(worktreeRoot, { recursive: true, force: true });
}

function readStatus(repo: ResolvedContextRepo): Buffer {
	return runGit(repo.worktreeRoot, [
		'status',
		'--porcelain=v1',
		'-z',
		'--untracked-files=all',
		'--',
		repo.projectPrefix || '.',
	]);
}

function readChangedFiles(repo: ResolvedContextRepo): ContextChangedFile[] {
	const files = parseChangedFiles(readStatus(repo), repo);
	const lineCounts = readChangedLineCounts(repo, files);
	return files.map((file) => ({
		...file,
		...(lineCounts.get(file.path) ?? { additions: null, deletions: null }),
	}));
}

function readChangedLineCounts(
	repo: ResolvedContextRepo,
	files: ParsedContextChangedFile[],
): Map<string, ContextLineCounts> {
	const lineCounts = new Map<string, ContextLineCounts>();
	const output = tryRunGit(repo.worktreeRoot, [
		'diff',
		'--numstat',
		'-z',
		'--no-renames',
		'HEAD',
		'--',
		repo.projectPrefix || '.',
	]);
	if (output) {
		addTrackedLineCounts(lineCounts, output, repo);
	}
	for (const file of files) {
		if (file.kind === 'untracked' && !lineCounts.has(file.path)) {
			lineCounts.set(file.path, readUntrackedLineCounts(repo, file.path));
		}
	}
	return lineCounts;
}

function addTrackedLineCounts(
	lineCounts: Map<string, ContextLineCounts>,
	output: Buffer,
	repo: ResolvedContextRepo,
): void {
	for (const record of output.toString().split('\0')) {
		const firstTab = record.indexOf('\t');
		const secondTab = record.indexOf('\t', firstTab + 1);
		if (firstTab < 0 || secondTab < 0) {
			continue;
		}
		const projectPath = fromRepoPath(repo, record.slice(secondTab + 1));
		if (!projectPath) {
			continue;
		}
		lineCounts.set(`/${projectPath}`, {
			additions: parseLineCount(record.slice(0, firstTab)),
			deletions: parseLineCount(record.slice(firstTab + 1, secondTab)),
		});
	}
}

function readUntrackedLineCounts(repo: ResolvedContextRepo, filePath: string): ContextLineCounts {
	try {
		const content = fs.readFileSync(toRealPath(filePath, getWorktreeProjectRoot(repo)));
		if (content.includes(0)) {
			return { additions: null, deletions: null };
		}
		let additions = 0;
		for (const byte of content) {
			if (byte === 10) {
				additions++;
			}
		}
		if (content.length > 0 && content.at(-1) !== 10) {
			additions++;
		}
		return { additions, deletions: 0 };
	} catch {
		return { additions: null, deletions: null };
	}
}

function parseLineCount(value: string): number | null {
	if (!/^\d+$/.test(value)) {
		return null;
	}
	const count = Number(value);
	return Number.isSafeInteger(count) ? count : null;
}

function parseChangedFiles(output: Buffer, repo: ResolvedContextRepo): ParsedContextChangedFile[] {
	const records = output.toString().split('\0');
	const files = new Map<string, ParsedContextChangedFile>();
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record || record.length < 4) {
			continue;
		}
		const status = record.slice(0, 2);
		const repoPath = record.slice(3);
		if (status.includes('R') || status.includes('C')) {
			const source = records[++index];
			addChangedFile(files, repo, repoPath, 'untracked');
			if (status.includes('R') && source) {
				addChangedFile(files, repo, source, 'deleted');
			}
		} else {
			addChangedFile(files, repo, repoPath, statusKind(status));
		}
	}
	return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function addChangedFile(
	files: Map<string, ParsedContextChangedFile>,
	repo: ResolvedContextRepo,
	repoPath: string,
	kind: ContextChangedFile['kind'],
): void {
	const projectPath = fromRepoPath(repo, repoPath);
	if (projectPath) {
		files.set(`/${projectPath}`, { path: `/${projectPath}`, kind });
	}
}

function statusKind(status: string): ContextChangedFile['kind'] {
	return status === '??' || status.includes('A') ? 'untracked' : status.includes('D') ? 'deleted' : 'modified';
}

function readCommittedText(repo: ResolvedContextRepo, projectPath: string): string {
	const content = readCommittedFile(repo, projectPath, MAX_CONTEXT_FILE_SIZE);
	validateContentBuffer(content);
	return decodeTextContent(content);
}

function readWorkingTreeText(repo: ResolvedContextRepo, filePath: string): string {
	const target = toRealPath(filePath, getWorktreeProjectRoot(repo));
	const content = fs.readFileSync(target);
	validateContentBuffer(content);
	return decodeTextContent(content);
}

function validateWorktreePath(repo: ResolvedContextRepo, filePath: string): void {
	toRealPath(filePath, getWorktreeProjectRoot(repo));
}

function readContextBranchNames(repo: ResolvedContextRepo): Set<string> {
	const output = runGit(repo.worktreeRoot, [
		'for-each-ref',
		'--exclude=refs/remotes/origin/HEAD',
		'--format=%(refname:short)',
		'refs/heads',
		'refs/remotes/origin',
	]);
	return new Set(
		output
			.toString()
			.split('\n')
			.map((ref) => ref.trim().replace(/^origin\//, ''))
			.filter((ref) => ref && ref !== 'HEAD'),
	);
}

function assertBranchAvailable(repo: ResolvedContextRepo, branch: string): void {
	if (readContextBranchNames(repo).has(branch)) {
		throw new TRPCError({ code: 'CONFLICT', message: `Branch already exists: ${branch}` });
	}
}

function assertCleanWorktree(repo: ResolvedContextRepo): void {
	if (readStatus(repo).length > 0) {
		throw new TRPCError({ code: 'CONFLICT', message: 'Commit or discard changes before switching branches.' });
	}
}

function hasRef(repo: ResolvedContextRepo, ref: string): boolean {
	return hasRefAt(repo.worktreeRoot, ref);
}

function hasRefAt(cwd: string, ref: string): boolean {
	return tryRunGit(cwd, ['show-ref', '--verify', '--quiet', ref]) !== null;
}

function readCurrentBranch(repo: ResolvedContextRepo): string | null {
	return readCurrentBranchFromPath(repo.worktreeRoot);
}

function readAheadCommitCount(repo: ResolvedContextRepo, currentBranch: string | null, defaultBranch: string): number {
	if (!currentBranch || currentBranch === defaultBranch) {
		return 0;
	}
	const base = readDefaultBranchRef(repo, defaultBranch);
	if (!base) {
		return 0;
	}
	return readCommitCount(repo, `${base}..HEAD`);
}

function readUnpushedCommitCount(
	repo: ResolvedContextRepo,
	currentBranch: string | null,
	defaultBranch: string,
): number {
	if (!currentBranch || currentBranch === defaultBranch) {
		return 0;
	}
	const remoteBranchRef = `refs/remotes/origin/${currentBranch}`;
	const base = hasRef(repo, remoteBranchRef) ? `origin/${currentBranch}` : readDefaultBranchRef(repo, defaultBranch);
	return base ? readCommitCount(repo, `${base}..HEAD`) : 0;
}

function readDefaultBranchRef(repo: ResolvedContextRepo, defaultBranch: string): string | null {
	const remoteDefaultRef = `refs/remotes/origin/${defaultBranch}`;
	const localDefaultRef = `refs/heads/${defaultBranch}`;
	return hasRef(repo, remoteDefaultRef)
		? `origin/${defaultBranch}`
		: hasRef(repo, localDefaultRef)
			? defaultBranch
			: null;
}

function readCommitCount(repo: ResolvedContextRepo, range: string): number {
	const count = Number(readOptionalGitValue(repo.worktreeRoot, ['rev-list', '--count', range]));
	return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

async function findOpenContextReviewRequest(
	provider: ContextRepositoryProvider,
	token: string,
	repoFullName: string,
	currentBranch: string | null,
	defaultBranch: string,
): Promise<{ url: string } | null> {
	if (!currentBranch || currentBranch === defaultBranch) {
		return null;
	}
	try {
		return await provider.findOpenReviewRequest(token, repoFullName, currentBranch);
	} catch {
		return null;
	}
}

function resolveAfterBranchChange(
	repo: ResolvedContextRepo,
	projectFolder: string,
	provider: ContextRepositoryProvider,
): ResolvedContextRepo {
	const matchingClone = findMatchingLocalClone(projectFolder, repo.repoFullName, provider);
	return resolveContextProject({ ...repo, projectPrefix: null }, projectFolder, matchingClone);
}

function readCurrentBranchFromPath(cwd: string): string | null {
	const branch = tryRunGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])?.toString().trim();
	return branch && branch !== 'HEAD' ? branch : null;
}

function runGitWithIdentity(
	repo: ResolvedContextRepo,
	projectFolder: string,
	args: string[],
	identity: GitIdentity,
): Buffer {
	return runDestructiveWorktreeGit(repo.worktreeRoot, projectFolder, repo.worktreeRoot, args, identity);
}

function unavailable(
	reason: ContextGitUnavailableReason,
	repo: UnresolvedContextRepo | null,
): Extract<ContextExplorerGitResolution, { status: 'unavailable' }> {
	return { status: 'unavailable', reason, message: unavailableMessage(reason), repo: toContextRepoState(repo) };
}

async function clearRecordedContextFileEdits(projectId: string, paths: string[]): Promise<void> {
	const { clearContextFileEdits } = await import('./context-file-edit.service');
	await clearContextFileEdits(projectId, paths);
}

function unavailableMessage(reason: ContextGitUnavailableReason): string {
	return {
		'github-unavailable': 'GitHub is not configured for this instance. Add the GitHub client credentials first.',
		'git-unavailable': 'Repository status is temporarily unavailable.',
		'no-token': 'Connect your GitHub account before using Git actions in the context explorer.',
		'no-repo': 'No context repository is connected. Open repository setup to connect one.',
		'unsupported-provider': 'Context explorer Git operations support GitHub only. GitLab is not supported yet.',
		'project-not-found': 'No tracked nao_config.yaml was found in the connected repository.',
		'project-ambiguous': 'Multiple nao projects were found in the connected repository.',
	}[reason];
}

function validateRepoFullName(repoFullName: string): void {
	if (!REPO_FULL_NAME_PATTERN.test(repoFullName)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Expected a repository in "owner/name" format.' });
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
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid repository branch.' });
	}
}

function normalizeVirtualPath(filePath: string): string {
	return `/${normalizeProjectPath(filePath)}`;
}

function normalizeRemote(remote: string | undefined): string {
	return (remote ?? '')
		.replace(/\.git$/, '')
		.replace(/\/$/, '')
		.toLowerCase();
}

function sameRealPath(left: string, right: string): boolean {
	try {
		return fs.realpathSync(left) === fs.realpathSync(right);
	} catch {
		return path.resolve(left) === path.resolve(right);
	}
}

function isGitContextSource(): boolean {
	return process.env.NAO_CONTEXT_SOURCE === 'git';
}

function readOptionalGitValue(cwd: string, args: string[]): string | null {
	return tryRunGit(cwd, args)?.toString().trim() || null;
}

function sanitizeGitError(error: unknown, token: string): Error {
	const message = error instanceof Error ? error.message : 'Git operation failed.';
	return new Error(message.replaceAll(token, '[redacted]'));
}

function isDirtySwitchConflict(error: unknown): boolean {
	const message = error instanceof Error ? error.message : '';
	return message.includes('would be overwritten by checkout') || message.includes('would be overwritten by switch');
}
