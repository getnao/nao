import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type {
	ContextBranchCreationResult,
	ContextBranchInfo,
	ContextChangedFile,
	ContextFileDiff,
	ContextGitUnavailableReason,
	RepoProvider,
} from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import { env } from '../env';
import type { ContextRepoConfig, ResolvedContextRepo, UnresolvedContextRepo } from '../utils/context-repo';
import {
	ContextProjectResolutionError,
	fromRepoPath,
	getContextWorktreePath,
	getWorktreeProjectRoot,
	invalidateContextProjectPrefix,
	normalizeProjectPath,
	readCommittedFile,
	resolveContextProject,
	resolveContextRepo,
	resolveContextSourceGitToken,
	sanitizeContextSourceRepositoryUrl,
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
import type { OpenReviewRequestResult, ReviewRequestProvider } from './review-request-provider';
import { getRepoProviderDisplayName, REVIEW_REQUEST_PROVIDERS } from './review-request-provider';

const REPO_FULL_NAME_PATTERN = /^[\w./-]+\/[\w.-]+$/;
const GIT_OPERATION_TIMEOUT_MS = 120_000;

export { sanitizeContextSourceRepositoryUrl };

export type ContextRepositoryProvider = ReviewRequestProvider;

export interface ContextExplorerGitContext {
	projectId: string;
	projectFolder: string;
	userId: string;
	user: GitIdentity;
	token: string | null;
	configOverride?: ContextRepoConfig | null;
	integrationAvailableOverride?: boolean;
	providerOverride?: ContextRepositoryProvider;
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
	contextSource: DeploymentContextSource | null;
	gitUnavailableReason: ContextGitUnavailableReason | null;
	gitUnavailableMessage: string | null;
	lastCommitMessage: string | null;
	lastCommitDate: string | null;
	branches: ContextBranchInfo | null;
	openReviewRequest: OpenReviewRequestResult | null;
	isGitRepository: boolean;
}

export interface DeploymentContextSource {
	repositoryUrl: string | null;
	branch: string | null;
	subpath: string | null;
	authMethod: 'token' | 'ssh-key' | 'public';
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

export interface OwnedContextBranchDeletionInput {
	projectId: string;
	projectFolder: string;
	userId: string;
	branch: string;
	token: string;
}

export type OwnedContextBranchDeletionResult =
	| { status: 'deleted'; reason: 'branch-deleted' | 'branch-missing' | 'worktree-missing' }
	| {
			status: 'skipped';
			reason: 'dirty-worktree' | 'unpublished-commits' | 'default-ref-unavailable' | 'commit-check-failed';
	  };

type ParsedContextChangedFile = Pick<ContextChangedFile, 'path' | 'kind'>;
type ContextLineCounts = Pick<ContextChangedFile, 'additions' | 'deletions'>;

export async function resolveContextExplorerGit(
	context: ContextExplorerGitContext,
): Promise<ContextExplorerGitResolution> {
	const configuredRepo = await resolveContextRepo(
		context.projectId,
		context.projectFolder,
		context.userId,
		context.configOverride,
	);
	if (!configuredRepo) {
		return unavailable('no-repo', null);
	}
	const provider = context.providerOverride ?? REVIEW_REQUEST_PROVIDERS[configuredRepo.provider];
	if (!provider) {
		return unavailable('unsupported-provider', configuredRepo);
	}
	if (
		configuredRepo.provider !== 'generic' &&
		(context.integrationAvailableOverride ?? provider.isIntegrationAvailable()) === false
	) {
		return unavailable('github-unavailable', configuredRepo);
	}
	if (context.token === null) {
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

export async function disconnectContextRepository(
	input: Pick<ContextExplorerGitContext, 'projectId' | 'projectFolder' | 'userId'>,
	dependencies: {
		updateConfig?: (
			projectId: string,
			patch: { repoFullName: string | null; repoProvider: RepoProvider | null },
		) => Promise<unknown>;
	} = {},
): Promise<void> {
	const updateConfig =
		dependencies.updateConfig ?? (await import('../queries/context-recommendation.queries')).updateConfig;
	await updateConfig(input.projectId, {
		repoFullName: null,
		repoProvider: null,
	});
	await cleanupContextWorktree(input.projectId, input.projectFolder, input.userId);
}

export async function ensureContextWorktree(
	context: ContextExplorerGitContext & { token: string },
	configuredRepo?: UnresolvedContextRepo,
): Promise<ResolvedContextRepo> {
	const unresolved =
		configuredRepo ??
		(await resolveContextRepo(context.projectId, context.projectFolder, context.userId, context.configOverride));
	if (!unresolved) {
		throw new TRPCError({ code: 'FORBIDDEN', message: unavailableMessage('no-repo') });
	}
	const provider = context.providerOverride ?? REVIEW_REQUEST_PROVIDERS[unresolved.provider];
	if (!provider) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: unavailableMessage('unsupported-provider', unresolved.provider),
		});
	}
	const matchingClone =
		unresolved.provider === 'generic'
			? null
			: findMatchingLocalClone(context.projectFolder, unresolved.repoFullName, provider);
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
	const contextSource = getDeploymentContextSource();
	const contextSourceStatus = {
		managedByContextSource: contextSource !== null,
		contextSource,
	};
	try {
		const resolution = await resolveContextExplorerGit(context);
		if (resolution.status === 'unavailable') {
			const provider = resolution.repo ? REVIEW_REQUEST_PROVIDERS[resolution.repo.provider] : null;
			return {
				repo: resolution.repo,
				repositoryUrl:
					resolution.repo && provider ? provider.publicRepoUrl(resolution.repo.repoFullName) : null,
				...contextSourceStatus,
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
		const branches = await getContextBranches(repo, resolution.context);
		const repoState = toContextRepoState(repo);
		return {
			repo: repoState ? { ...repoState, branch: branches.currentBranch } : null,
			repositoryUrl: provider.publicRepoUrl(repo.repoFullName),
			...contextSourceStatus,
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
				context.projectId,
				context.userId,
			),
			isGitRepository: true,
		};
	} catch {
		return {
			repo: null,
			repositoryUrl: null,
			...contextSourceStatus,
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

export function getDeploymentContextSource(): DeploymentContextSource | null {
	if (!isGitContextSource()) {
		return null;
	}
	return {
		repositoryUrl: env.NAO_CONTEXT_GIT_URL ? sanitizeContextSourceRepositoryUrl(env.NAO_CONTEXT_GIT_URL) : null,
		branch: env.NAO_CONTEXT_GIT_BRANCH || 'main',
		subpath: env.NAO_CONTEXT_GIT_SUBPATH || null,
		authMethod: resolveContextSourceAuthMethod(),
	};
}

export async function getContextBranches(
	repo: ResolvedContextRepo,
	context: Pick<ContextExplorerGitContext, 'projectId' | 'userId'>,
): Promise<ContextBranchInfo> {
	const defaultBranch = readDefaultBranch(repo);
	const currentBranch = readContextCurrentBranch(repo, defaultBranch);
	const branchOwnershipQueries = await getBranchOwnershipQueries();
	const ownedBranches = await branchOwnershipQueries.getOwnedContextBranches(context.projectId, context.userId);
	const branches = new Set([...readContextBranchNames(repo)].filter((branch) => ownedBranches.has(branch)));
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
	const defaultBranch = readDefaultBranch(repo);
	try {
		if (branch === defaultBranch) {
			const defaultRef = readDefaultBranchRef(repo, defaultBranch);
			if (!defaultRef) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Branch not found: ${branch}` });
			}
			runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, [
				'switch',
				'--detach',
				defaultRef,
			]);
		} else if (!(await isContextBranchOwnedByUser(context, branch))) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'This branch belongs to another user.' });
		} else if (hasRef(repo, `refs/heads/${branch}`)) {
			runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, ['switch', branch]);
		} else if (hasRef(repo, `refs/remotes/origin/${branch}`)) {
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
	} catch (error) {
		if (isDirtySwitchConflict(error)) {
			throw new TRPCError({ code: 'CONFLICT', message: 'Commit or discard changes before switching branches.' });
		}
		throw error;
	}
	invalidateContextProjectPrefix(repo.worktreeRoot);
	return getContextBranches(resolveAfterBranchChange(repo, context.projectFolder, provider), context);
}

export async function createContextBranch(
	context: ContextExplorerGitContext,
	branch: string,
): Promise<ContextBranchCreationResult> {
	validateBranch(branch);
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	fetchContextRepository(repo, context.projectFolder, provider, availableContext.token);
	assertBranchAvailable(repo, branch);
	const { usedFallbackBase } = await createOwnedContextBranch(context, repo, branch);
	invalidateContextProjectPrefix(repo.worktreeRoot);
	const branches = await getContextBranches(resolveAfterBranchChange(repo, context.projectFolder, provider), context);
	return { ...branches, usedFallbackBase };
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
	const { baseUsed, usedFallbackBase } = await createOwnedContextBranch(context, repo, branch);
	invalidateContextProjectPrefix(repo.worktreeRoot);
	const resolvedRepo = resolveAfterBranchChange(repo, context.projectFolder, provider);
	const commit = await commitSelectedChanges(resolvedRepo, context.projectFolder, availableContext, input);
	return { branch, commit, baseUsed, usedFallbackBase };
}

export async function commitContextChanges(
	context: ContextExplorerGitContext,
	input: { paths: string[]; message: string },
): Promise<{ commit: string }> {
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const commit = await commitSelectedChanges(repo, context.projectFolder, availableContext, input);
	return { commit };
}

export async function getChangedContextFiles(context: ContextExplorerGitContext): Promise<ContextChangedFile[]> {
	try {
		const resolution = await resolveContextExplorerGit(context);
		if (resolution.status === 'unavailable') {
			return [];
		}
		return readChangedFiles(resolution.repo);
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
	const target = toRealPath(filePath, getWorktreeProjectRoot(repo));
	return { hash: fs.existsSync(target) ? hashContent(fs.readFileSync(target)) : null };
}

export async function discardAllContextChanges(context: ContextExplorerGitContext): Promise<void> {
	const { repo } = await requireContextExplorerGit(context);
	const changedFiles = parseChangedFiles(readStatus(repo), repo);
	for (const file of changedFiles) {
		await discardPath(repo, context.projectFolder, file.path);
	}
}

export function pushContextBranch(
	repo: ResolvedContextRepo,
	projectFolder: string,
	provider: ContextRepositoryProvider,
	token: string,
): { branch: string; defaultBranch: string; pushOutput: string } {
	const branch = readCurrentBranch(repo);
	const defaultBranch = readDefaultBranch(repo);
	if (!branch || branch === defaultBranch) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Open pull requests from a non-default branch.' });
	}
	assertSafeDestructiveWorktreeTarget(repo.worktreeRoot, projectFolder);
	try {
		const pushOutput = provider.pushBranch({
			token,
			repoFullName: repo.repoFullName,
			dir: repo.worktreeRoot,
			branch,
		});
		runDestructiveWorktreeGit(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
			'update-ref',
			`refs/remotes/origin/${branch}`,
			'HEAD',
		]);
		return { branch, defaultBranch, pushOutput };
	} catch (error) {
		throw sanitizeGitError(error, token);
	}
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

export function deleteOwnedContextBranch(input: OwnedContextBranchDeletionInput): OwnedContextBranchDeletionResult {
	const worktreeRoot = getContextWorktreePath(input.projectId, input.projectFolder, input.userId);
	if (!fs.existsSync(worktreeRoot)) {
		return { status: 'deleted', reason: 'worktree-missing' };
	}
	const repo = { worktreeRoot, projectPrefix: '' };
	try {
		if (!isCleanWorktree(repo)) {
			return { status: 'skipped', reason: 'dirty-worktree' };
		}
		if (!hasRef(repo, `refs/heads/${input.branch}`)) {
			return { status: 'deleted', reason: 'branch-missing' };
		}
		const defaultBranch = readDefaultBranchFromRefs(worktreeRoot);
		const remoteBranchRef = `refs/remotes/origin/${input.branch}`;
		const comparisonRef = hasRef(repo, remoteBranchRef)
			? `origin/${input.branch}`
			: defaultBranch
				? readDefaultBranchRef(repo, defaultBranch)
				: null;
		if (!comparisonRef) {
			return { status: 'skipped', reason: 'default-ref-unavailable' };
		}
		const unpublishedCommitCount = readVerifiedCommitCount(repo, `${comparisonRef}..${input.branch}`);
		if (unpublishedCommitCount === null) {
			return { status: 'skipped', reason: 'commit-check-failed' };
		}
		if (unpublishedCommitCount > 0) {
			return { status: 'skipped', reason: 'unpublished-commits' };
		}
		if (readCurrentBranch(repo) === input.branch) {
			const defaultRef = defaultBranch ? readDefaultBranchRef(repo, defaultBranch) : null;
			if (!defaultRef) {
				return { status: 'skipped', reason: 'default-ref-unavailable' };
			}
			runDestructiveWorktreeGit(worktreeRoot, input.projectFolder, worktreeRoot, [
				'switch',
				'--detach',
				defaultRef,
			]);
		}
		runDestructiveWorktreeGit(worktreeRoot, input.projectFolder, worktreeRoot, [
			'branch',
			'-D',
			'--',
			input.branch,
		]);
		return { status: 'deleted', reason: 'branch-deleted' };
	} catch (error) {
		throw sanitizeGitError(error, input.token);
	}
}

export async function cleanupContextWorktree(projectId: string, projectFolder: string, userId: string): Promise<void> {
	let worktreeRoot: string;
	try {
		worktreeRoot = getContextWorktreePath(projectId, projectFolder, userId);
		const repositoryRoot = tryRunGit(projectFolder, ['rev-parse', '--show-toplevel'])?.toString().trim();
		if (repositoryRoot) {
			try {
				runDestructiveWorktreeGit(worktreeRoot, projectFolder, repositoryRoot, [
					'worktree',
					'remove',
					'--force',
					worktreeRoot,
				]);
			} catch {
				removeWorktreeDirectory(worktreeRoot, projectFolder);
			}
			runDestructiveWorktreeGit(worktreeRoot, projectFolder, repositoryRoot, ['worktree', 'prune']);
		} else {
			removeWorktreeDirectory(worktreeRoot, projectFolder);
		}
		invalidateContextProjectPrefix(worktreeRoot);
	} catch (error) {
		const message = `Failed to clean up context worktree for user ${userId} in project ${projectId}`;
		const detail = error instanceof Error ? error.message : String(error);
		try {
			const { logger } = await import('../utils/logger');
			logger.warn(message, { source: 'system', context: { error: detail } });
		} catch {
			console.warn(message, detail);
		}
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
	await assertCommitBranch(repo, context);
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
	const author = await provider.getUserGitIdentity({ token: context.token, user: context.user });
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

async function assertCommitBranch(
	repo: ResolvedContextRepo,
	context: Pick<ContextExplorerGitContext, 'projectId' | 'userId'>,
): Promise<void> {
	const branch = readCurrentBranch(repo);
	const defaultBranch = readDefaultBranch(repo);
	if (!branch || branch === defaultBranch || !(await isContextBranchOwnedByUser(context, branch))) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Create a branch before committing context changes.',
		});
	}
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
	const defaultBranch =
		repo.provider === 'generic'
			? env.NAO_CONTEXT_GIT_BRANCH || 'main'
			: (readDefaultBranchFromRefs(repo.worktreeRoot) ?? readCurrentBranchFromPath(repo.worktreeRoot));
	if (!defaultBranch) {
		throw new Error('Unable to determine the repository default branch.');
	}
	if (!hasRefAt(repo.worktreeRoot, `refs/remotes/origin/${defaultBranch}`)) {
		throw new Error(`Configured context branch not found: ${defaultBranch}`);
	}
	runWorktreeGitMutation(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
		'symbolic-ref',
		'refs/remotes/origin/HEAD',
		`refs/remotes/origin/${defaultBranch}`,
	]);
	runWorktreeGitMutation(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
		'switch',
		'--detach',
		`origin/${defaultBranch}`,
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
	if (repo.provider === 'generic') {
		return env.NAO_CONTEXT_GIT_BRANCH || 'main';
	}
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

function readStatus(repo: Pick<ResolvedContextRepo, 'worktreeRoot' | 'projectPrefix'>): Buffer {
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
	if (!isCleanWorktree(repo)) {
		throw new TRPCError({ code: 'CONFLICT', message: 'Commit or discard changes before switching branches.' });
	}
}

function isCleanWorktree(repo: Pick<ResolvedContextRepo, 'worktreeRoot' | 'projectPrefix'>): boolean {
	return readStatus(repo).length === 0;
}

function hasRef(repo: Pick<ResolvedContextRepo, 'worktreeRoot'>, ref: string): boolean {
	return hasRefAt(repo.worktreeRoot, ref);
}

function hasRefAt(cwd: string, ref: string): boolean {
	return tryRunGit(cwd, ['show-ref', '--verify', '--quiet', ref]) !== null;
}

function readCurrentBranch(repo: Pick<ResolvedContextRepo, 'worktreeRoot'>): string | null {
	return readCurrentBranchFromPath(repo.worktreeRoot);
}

function readContextCurrentBranch(repo: ResolvedContextRepo, defaultBranch: string): string | null {
	const currentBranch = readCurrentBranch(repo);
	if (currentBranch) {
		return currentBranch;
	}
	const defaultRef = readDefaultBranchRef(repo, defaultBranch);
	const head = readOptionalGitValue(repo.worktreeRoot, ['rev-parse', 'HEAD']);
	const defaultHead = defaultRef ? readOptionalGitValue(repo.worktreeRoot, ['rev-parse', defaultRef]) : null;
	return head && head === defaultHead ? defaultBranch : null;
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

function readDefaultBranchRef(repo: Pick<ResolvedContextRepo, 'worktreeRoot'>, defaultBranch: string): string | null {
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

function readVerifiedCommitCount(repo: Pick<ResolvedContextRepo, 'worktreeRoot'>, range: string): number | null {
	const value = readOptionalGitValue(repo.worktreeRoot, ['rev-list', '--count', range]);
	if (!value || !/^\d+$/.test(value)) {
		return null;
	}
	const count = Number(value);
	return Number.isSafeInteger(count) ? count : null;
}

async function findOpenContextReviewRequest(
	provider: ContextRepositoryProvider,
	token: string,
	repoFullName: string,
	currentBranch: string | null,
	defaultBranch: string,
	projectId: string,
	userId: string,
): Promise<OpenReviewRequestResult | null> {
	if (!currentBranch || currentBranch === defaultBranch) {
		return null;
	}
	try {
		return await provider.findOpenReviewRequest({
			token,
			repoFullName,
			branch: currentBranch,
			projectId,
			userId,
		});
	} catch {
		return null;
	}
}

function resolveAfterBranchChange(
	repo: ResolvedContextRepo,
	projectFolder: string,
	provider: ContextRepositoryProvider,
): ResolvedContextRepo {
	const matchingClone =
		repo.provider === 'generic' ? null : findMatchingLocalClone(projectFolder, repo.repoFullName, provider);
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
	return {
		status: 'unavailable',
		reason,
		message: unavailableMessage(reason, repo?.provider),
		repo: toContextRepoState(repo),
	};
}

async function createOwnedContextBranch(
	context: ContextExplorerGitContext,
	repo: ResolvedContextRepo,
	branch: string,
): Promise<{ baseUsed: string; usedFallbackBase: boolean }> {
	await claimBranchOwnership(context, branch);
	try {
		const currentHead = runGit(repo.worktreeRoot, ['rev-parse', 'HEAD']).toString().trim();
		let baseUsed = `origin/${readDefaultBranch(repo)}`;
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
		return { baseUsed, usedFallbackBase };
	} catch (error) {
		const branchOwnershipQueries = await getBranchOwnershipQueries();
		await branchOwnershipQueries.releaseContextBranch(context.projectId, branch, context.userId);
		if (isDirtySwitchConflict(error)) {
			throw new TRPCError({
				code: 'CONFLICT',
				message: 'This branch cannot be created without overwriting your uncommitted changes.',
			});
		}
		throw error;
	}
}

async function claimBranchOwnership(
	context: Pick<ContextExplorerGitContext, 'projectId' | 'userId'>,
	branch: string,
): Promise<void> {
	const branchOwnershipQueries = await getBranchOwnershipQueries();
	const claimed = await branchOwnershipQueries.claimContextBranch(context.projectId, branch, context.userId);
	if (!claimed) {
		throw new TRPCError({ code: 'CONFLICT', message: `Branch already belongs to another user: ${branch}` });
	}
}

async function getBranchOwnershipQueries() {
	return import('../queries/context-branch-ownership.queries');
}

async function isContextBranchOwnedByUser(
	context: Pick<ContextExplorerGitContext, 'projectId' | 'userId'>,
	branch: string,
): Promise<boolean> {
	const branchOwnershipQueries = await getBranchOwnershipQueries();
	return branchOwnershipQueries.isContextBranchOwnedByUser(context.projectId, branch, context.userId);
}

function unavailableMessage(reason: ContextGitUnavailableReason, provider?: string): string {
	const providerName = getRepoProviderDisplayName(provider);
	return {
		'github-unavailable': `${providerName} is not configured for this instance. Add the ${providerName} client credentials first.`,
		'git-unavailable': 'Repository status is temporarily unavailable.',
		'no-token': isGitContextSource()
			? 'Add NAO_CONTEXT_GIT_TOKEN or NAO_CONTEXT_GIT_SSH_KEY to edit and propose context changes.'
			: `Connect your ${providerName} account before using Git actions in the context explorer.`,
		'no-repo': 'No context repository is connected. Connect one in Git settings to edit context files.',
		'unsupported-provider': 'The connected repository provider is not supported by the context explorer.',
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

export function normalizeRemote(remote: string | undefined): string {
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
		return normalizeRemoteParts(parsed.hostname, parsed.pathname);
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

function sameRealPath(left: string, right: string): boolean {
	try {
		return fs.realpathSync(left) === fs.realpathSync(right);
	} catch {
		return path.resolve(left) === path.resolve(right);
	}
}

function isGitContextSource(): boolean {
	return env.NAO_CONTEXT_SOURCE === 'git';
}

function resolveContextSourceAuthMethod(): DeploymentContextSource['authMethod'] {
	if (env.NAO_CONTEXT_GIT_SSH_KEY) {
		return 'ssh-key';
	}
	if (env.NAO_CONTEXT_GIT_TOKEN) {
		return 'token';
	}
	if (resolveContextSourceGitToken() !== null) {
		return 'token';
	}
	return 'public';
}

function readOptionalGitValue(cwd: string, args: string[]): string | null {
	return tryRunGit(cwd, args)?.toString().trim() || null;
}

function sanitizeGitError(error: unknown, token: string): Error {
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

function isDirtySwitchConflict(error: unknown): boolean {
	const message = error instanceof Error ? error.message : '';
	return message.includes('would be overwritten by checkout') || message.includes('would be overwritten by switch');
}
