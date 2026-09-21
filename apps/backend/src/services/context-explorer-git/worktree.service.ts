import fs from 'node:fs';
import path from 'node:path';

import type { ContextGitUnavailableReason, RepoProvider } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import { env } from '../../env';
import type { ResolvedContextRepo, UnresolvedContextRepo } from '../../utils/context-repo';
import {
	ContextProjectResolutionError,
	getContextWorktreePath,
	invalidateContextProjectPrefix,
	resolveContextProject,
	resolveContextRepo,
	toContextRepoState,
} from '../../utils/context-repo';
import { getGitOAuthCredential, runGitWithOAuth } from '../../utils/git-oauth';
import { runGit, tryRunGit } from '../../utils/git-repo';
import { getRepoProviderDisplayName, REVIEW_REQUEST_PROVIDERS } from '../review-request-provider';
import {
	assertEntireWorktreeClean,
	assertSafeDestructiveWorktreeTarget,
	discoverLiveRepositoryRoot,
	hasCommit,
	hasRefAt,
	isDirtySwitchConflict,
	isEntireWorktreeClean,
	isGitContextSource,
	normalizeRemote,
	readCurrentBranch,
	readCurrentBranchFromPath,
	readDefaultBranch,
	readDefaultBranchFromRefs,
	readDefaultBranchRef,
	readOptionalGitValue,
	refreshDefaultBranch,
	runDestructiveWorktreeGit,
	runWorktreeGitMutation,
	sameRealPath,
	sanitizeGitError,
	validateRepoFullName,
} from './git-guards';
import type {
	ContextExplorerGitContext,
	ContextExplorerGitResolution,
	ContextHistoricalDiffAction,
	ContextRepositoryProvider,
	ContextWorktreeTarget,
	ContextWorktreeUpdateStatus,
} from './types';
import { COMMIT_PATTERN, GIT_OPERATION_TIMEOUT_MS } from './types';

const REPOSITORY_MISMATCH_MESSAGE = "The selected repository does not match the live project's Git repository.";

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
	if (hasLiveRepositoryMismatch(configuredRepo, context.projectFolder, provider)) {
		return unavailable('repository-mismatch', configuredRepo);
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

export async function resolveContextExplorerGitSafely(
	context: ContextExplorerGitContext,
): Promise<ContextExplorerGitResolution> {
	try {
		return await resolveContextExplorerGit(context);
	} catch (error) {
		const message = `Failed to resolve context explorer git for user ${context.userId} in project ${context.projectId}`;
		await logGitFailure(message, error);
		return unavailable('git-unavailable', null);
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
	refreshDefaultBranch(repo, input.provider, input.token);
	const defaultBranch = readDefaultBranch(repo);
	const updateConfig =
		dependencies.updateConfig ?? (await import('../../queries/context-recommendation.queries')).updateConfig;
	await updateConfig(input.projectId, {
		repoFullName: input.repoFullName,
		repoProvider: input.provider,
	});
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
		dependencies.updateConfig ?? (await import('../../queries/context-recommendation.queries')).updateConfig;
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
	assertLiveRepositoryMatches(unresolved, context.projectFolder, provider);
	const matchingClone =
		unresolved.provider === 'generic'
			? null
			: findMatchingLocalClone(context.projectFolder, unresolved.repoFullName, provider);
	let provisioned = false;
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
		provisioned = true;
	}
	if (provisioned) {
		synchronizeDefaultContextWorktree(unresolved, context.projectFolder, matchingClone, provider, context.token);
	}
	return resolveContextProject(unresolved, context.projectFolder, matchingClone);
}

export async function updateContextWorktree(
	context: ContextExplorerGitContext,
	requiredCommits: string[] = [],
): Promise<{ branch: string; commit: string; fetched: boolean }> {
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	assertEntireWorktreeClean(repo);
	let target = readContextWorktreeTarget(repo, context.projectFolder, provider);
	const requiredCommitMissing = requiredCommits.some(
		(commit) => !COMMIT_PATTERN.test(commit) || !hasCommit(repo.worktreeRoot, commit),
	);
	const fetched = target.updateNeeded || requiredCommitMissing;
	if (fetched) {
		fetchContextRepository(repo, context.projectFolder, provider, availableContext.token);
		if (isFirstPartyOAuthProvider(repo.provider, provider)) {
			refreshDefaultBranch(repo, repo.provider, availableContext.token);
		}
		target = readContextWorktreeTarget(repo, context.projectFolder, provider);
	}
	if (target.updateNeeded) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'The latest live context commit is unavailable.' });
	}
	if (!target.commit) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Branch not found: ${target.branch}` });
	}
	if (target.switchNeeded) {
		try {
			runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, [
				'switch',
				'--detach',
				target.commit,
			]);
		} catch (error) {
			if (isDirtySwitchConflict(error)) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'Commit or discard changes before switching branches.',
				});
			}
			throw error;
		}
		invalidateContextProjectPrefix(repo.worktreeRoot);
	}
	if (!requiredCommits.every((commit) => COMMIT_PATTERN.test(commit) && hasCommit(repo.worktreeRoot, commit))) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'This historical change is unavailable.' });
	}
	return { branch: target.branch, commit: target.commit, fetched };
}

export async function getHistoricalContextDiffActions(
	context: ContextExplorerGitContext,
	ranges: Array<{ fromCommit: string | null; toCommit: string | null }>,
): Promise<ContextHistoricalDiffAction[]> {
	try {
		const configuredRepo = await resolveContextRepo(
			context.projectId,
			context.projectFolder,
			context.userId,
			context.configOverride,
		);
		if (!configuredRepo) {
			return ranges.map(() => 'update');
		}
		const provider = context.providerOverride ?? REVIEW_REQUEST_PROVIDERS[configuredRepo.provider];
		if (!provider || !isHealthyWorktree(configuredRepo, provider)) {
			return ranges.map(() => 'update');
		}
		const matchingClone =
			configuredRepo.provider === 'generic'
				? null
				: findMatchingLocalClone(context.projectFolder, configuredRepo.repoFullName, provider);
		const repo = resolveContextProject(configuredRepo, context.projectFolder, matchingClone);
		if (!isEntireWorktreeClean(repo.worktreeRoot)) {
			return ranges.map(() => 'blocked');
		}
		const updateStatus = readContextWorktreeUpdateStatus(repo, context.projectFolder, provider);
		return ranges.map(({ fromCommit, toCommit }) => {
			const commitsAvailable = Boolean(
				fromCommit &&
				toCommit &&
				hasCommit(repo.worktreeRoot, fromCommit) &&
				hasCommit(repo.worktreeRoot, toCommit),
			);
			if (updateStatus.updateNeeded || !commitsAvailable) {
				return 'update';
			}
			return updateStatus.switchNeeded ? 'switch' : 'open';
		});
	} catch {
		return ranges.map(() => 'update');
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
		await logGitFailure(message, error);
	}
}

async function logGitFailure(message: string, error: unknown): Promise<void> {
	try {
		const { logger, serializeError } = await import('../../utils/logger');
		logger.warn(message, { source: 'system', context: { error: serializeError(error) } });
	} catch {
		console.warn(message);
	}
}

export function synchronizeDefaultContextWorktree(
	repo: Pick<UnresolvedContextRepo, 'provider' | 'repoFullName' | 'source' | 'worktreeRoot'>,
	projectFolder: string,
	matchingClone: string | null,
	provider: ContextRepositoryProvider,
	token: string,
): void {
	const defaultBranch =
		repo.provider === 'generic'
			? env.NAO_CONTEXT_GIT_BRANCH || 'main'
			: readDefaultBranchFromRefs(repo.worktreeRoot);
	if (!defaultBranch) {
		return;
	}
	let targetCommit = readOptionalGitValue(repo.worktreeRoot, ['rev-parse', `origin/${defaultBranch}`]);
	const liveCommit =
		matchingClone || repo.source === 'deployment' ? readLiveDefaultCommit(projectFolder, defaultBranch) : null;
	if (
		repo.source === 'settings' &&
		liveCommit &&
		(!hasCommit(repo.worktreeRoot, liveCommit) || targetCommit !== liveCommit)
	) {
		fetchContextRepository(repo, projectFolder, provider, token);
		targetCommit = readOptionalGitValue(repo.worktreeRoot, ['rev-parse', `origin/${defaultBranch}`]);
	}
	if (
		repo.source !== 'settings' &&
		(readCurrentBranchFromPath(repo.worktreeRoot) || !isEntireWorktreeClean(repo.worktreeRoot))
	) {
		return;
	}
	if (liveCommit) {
		if (!hasCommit(repo.worktreeRoot, liveCommit)) {
			fetchContextRepository(repo, projectFolder, provider, token);
		}
		targetCommit = hasCommit(repo.worktreeRoot, liveCommit) ? liveCommit : targetCommit;
	}
	if (!targetCommit) {
		return;
	}
	const currentCommit = readOptionalGitValue(repo.worktreeRoot, ['rev-parse', 'HEAD']);
	if (currentCommit === targetCommit) {
		return;
	}
	if (readCurrentBranchFromPath(repo.worktreeRoot) || !isEntireWorktreeClean(repo.worktreeRoot)) {
		return;
	}
	runDestructiveWorktreeGit(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
		'switch',
		'--detach',
		targetCommit,
	]);
	invalidateContextProjectPrefix(repo.worktreeRoot);
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
	if (isFirstPartyOAuthProvider(repo.provider, provider)) {
		runGitWithOAuth(
			path.dirname(repo.worktreeRoot),
			['clone', provider.publicRepoUrl(repo.repoFullName), repo.worktreeRoot],
			getGitOAuthCredential(repo.provider, token),
			GIT_OPERATION_TIMEOUT_MS,
		);
	} else {
		runGit(
			path.dirname(repo.worktreeRoot),
			['clone', provider.authenticatedRepoUrl(token, repo.repoFullName), repo.worktreeRoot],
			GIT_OPERATION_TIMEOUT_MS,
		);
	}
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

export function fetchContextRepository(
	repo: Pick<ResolvedContextRepo, 'worktreeRoot' | 'repoFullName' | 'provider'>,
	projectFolder: string,
	provider: ContextRepositoryProvider,
	token: string,
): void {
	try {
		if (isFirstPartyOAuthProvider(repo.provider, provider)) {
			assertSafeDestructiveWorktreeTarget(repo.worktreeRoot, projectFolder);
			runGitWithOAuth(
				repo.worktreeRoot,
				['fetch', provider.publicRepoUrl(repo.repoFullName), '+refs/heads/*:refs/remotes/origin/*'],
				getGitOAuthCredential(repo.provider, token),
				GIT_OPERATION_TIMEOUT_MS,
			);
		} else {
			runWorktreeGitMutation(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
				'fetch',
				provider.authenticatedRepoUrl(token, repo.repoFullName),
				'+refs/heads/*:refs/remotes/origin/*',
			]);
		}
	} catch (error) {
		throw sanitizeGitError(error, token);
	}
}

function isFirstPartyOAuthProvider(
	providerName: ResolvedContextRepo['provider'],
	provider: ContextRepositoryProvider,
): providerName is RepoProvider {
	return (
		(providerName === 'github' && provider === REVIEW_REQUEST_PROVIDERS.github) ||
		(providerName === 'gitlab' && provider === REVIEW_REQUEST_PROVIDERS.gitlab)
	);
}

function readLiveDefaultCommit(projectFolder: string, defaultBranch: string): string | null {
	const repositoryRoot = discoverLiveRepositoryRoot(projectFolder);
	if (!repositoryRoot || readCurrentBranchFromPath(repositoryRoot) !== defaultBranch) {
		return null;
	}
	return readOptionalGitValue(repositoryRoot, ['rev-parse', 'HEAD']);
}

export function readContextWorktreeUpdateStatus(
	repo: ResolvedContextRepo,
	projectFolder: string,
	provider: ContextRepositoryProvider,
): ContextWorktreeUpdateStatus {
	const target = readContextWorktreeTarget(repo, projectFolder, provider);
	return {
		updateNeeded: target.updateNeeded,
		switchNeeded: target.switchNeeded,
		branch: target.branch,
	};
}

function readContextWorktreeTarget(
	repo: ResolvedContextRepo,
	projectFolder: string,
	provider: ContextRepositoryProvider,
): ContextWorktreeTarget {
	assertLiveRepositoryMatches(repo, projectFolder, provider);
	const liveRepositoryRoot = discoverLiveRepositoryRoot(projectFolder);
	const branch =
		repo.provider === 'generic'
			? env.NAO_CONTEXT_GIT_BRANCH || 'main'
			: ((liveRepositoryRoot ? readDefaultBranchFromRefs(liveRepositoryRoot) : null) ?? readDefaultBranch(repo));
	const defaultRef = readDefaultBranchRef(repo, branch);
	const cachedCommit = defaultRef ? readOptionalGitValue(repo.worktreeRoot, ['rev-parse', defaultRef]) : null;
	const liveCommit = readLiveDefaultCommit(projectFolder, branch);
	const targetCommit = liveCommit ?? cachedCommit;
	const currentCommit = readOptionalGitValue(repo.worktreeRoot, ['rev-parse', 'HEAD']);
	return {
		updateNeeded:
			!targetCommit ||
			!hasCommit(repo.worktreeRoot, targetCommit) ||
			Boolean(liveCommit && cachedCommit !== liveCommit),
		switchNeeded: readCurrentBranch(repo) !== null || !targetCommit || currentCommit !== targetCommit,
		branch,
		commit: targetCommit,
	};
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

function assertLiveRepositoryMatches(
	repo: Pick<UnresolvedContextRepo, 'provider' | 'repoFullName' | 'source'>,
	projectFolder: string,
	provider: ContextRepositoryProvider,
): void {
	if (hasLiveRepositoryMismatch(repo, projectFolder, provider)) {
		throw new TRPCError({ code: 'CONFLICT', message: REPOSITORY_MISMATCH_MESSAGE });
	}
}

function hasLiveRepositoryMismatch(
	repo: Pick<UnresolvedContextRepo, 'provider' | 'repoFullName' | 'source'>,
	projectFolder: string,
	provider: ContextRepositoryProvider,
): boolean {
	if (repo.provider === 'generic' || repo.source !== 'settings') {
		return false;
	}
	const repositoryRoot = discoverLiveRepositoryRoot(projectFolder);
	if (!repositoryRoot) {
		return false;
	}
	const origin = readOptionalGitValue(repositoryRoot, ['remote', 'get-url', 'origin']);
	return normalizeRemote(origin) !== normalizeRemote(provider.publicRepoUrl(repo.repoFullName));
}

export function isHealthyWorktree(
	repo: Pick<UnresolvedContextRepo, 'worktreeRoot' | 'repoFullName'>,
	provider: ContextRepositoryProvider,
): boolean {
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

export function resolveAfterBranchChange(
	repo: ResolvedContextRepo,
	projectFolder: string,
	provider: ContextRepositoryProvider,
): ResolvedContextRepo {
	const matchingClone =
		repo.provider === 'generic' ? null : findMatchingLocalClone(projectFolder, repo.repoFullName, provider);
	return resolveContextProject({ ...repo, projectPrefix: null }, projectFolder, matchingClone);
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

export function unavailableMessage(reason: ContextGitUnavailableReason, provider?: string): string {
	const providerName = getRepoProviderDisplayName(provider);
	return {
		'github-unavailable': `${providerName} is not configured for this instance. Add the ${providerName} client credentials first.`,
		'git-unavailable': 'Repository status is temporarily unavailable.',
		'repository-mismatch': REPOSITORY_MISMATCH_MESSAGE,
		'no-token': isGitContextSource()
			? 'Add NAO_CONTEXT_GIT_TOKEN or NAO_CONTEXT_GIT_SSH_KEY to edit and propose context changes.'
			: `Connect your ${providerName} account before using Git actions in the context explorer.`,
		'no-repo': 'No context repository is connected. Connect one in Git settings to edit context files.',
		'unsupported-provider': 'The connected repository provider is not supported by the context explorer.',
		'project-not-found': 'No tracked nao_config.yaml was found in the connected repository.',
		'project-ambiguous': 'Multiple nao projects were found in the connected repository.',
	}[reason];
}
