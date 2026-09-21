import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { RepoProvider } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import { env } from '../../env';
import type { ResolvedContextRepo } from '../../utils/context-repo';
import {
	ContextProjectResolutionError,
	detectGitPlatform,
	getContextWorktreePath,
	resolveContextRepo,
	resolveContextSourceGitToken,
	resolveTrackedContextProjectPrefix,
	sanitizeContextSourceRepositoryUrl,
	toContextRepoState,
	validateDeploymentContextSubpath,
} from '../../utils/context-repo';
import {
	getGitOAuthCredential,
	getGitRemoteCredentialSecrets,
	runGitFetchWithCredentials,
	runGitWithOAuth,
} from '../../utils/git-oauth';
import { runGit } from '../../utils/git-repo';
import { getRepoProviderDisplayName, REVIEW_REQUEST_PROVIDERS } from '../review-request-provider';
import {
	assertAbsoluteProjectPath,
	discoverLiveRepositoryRoot,
	isGitContextSource,
	isSameOrAncestor,
	isValidBranch,
	normalizeRemote,
	parseLineCount,
	readCurrentBranchFromPath,
	readDefaultBranch,
	readDefaultBranchFromRefs,
	readOptionalGitValue,
	refreshDefaultBranch,
	resolveLiveProjectPrefix,
	sanitizeLiveContextError,
} from './git-guards';
import type {
	ContextExplorerGitContext,
	ContextExplorerGitResolution,
	ContextRepositoryProvider,
	DeploymentContextSource,
	LiveContextPullFile,
	LiveContextPullResult,
	LiveContextUpdateStatus,
	LiveRepository,
	LiveRepositoryIssue,
} from './types';
import { GIT_OPERATION_TIMEOUT_MS } from './types';
import { isHealthyWorktree, requireContextExplorerGit, synchronizeDefaultContextWorktree } from './worktree.service';

export function getLiveContextUpdateStatus(projectFolder: string): LiveContextUpdateStatus {
	const configuredBranch = env.NAO_CONTEXT_GIT_BRANCH || 'main';
	if (!isGitContextSource()) {
		return {
			enabled: false,
			available: false,
			configuredBranch,
			lastCheckedAt: null,
			unavailableReason: null,
			configurationError: null,
		};
	}
	if (!isValidBranch(configuredBranch)) {
		return unavailableLiveContextStatus(configuredBranch, 'NAO_CONTEXT_GIT_BRANCH is not a valid Git branch name.');
	}
	const repository = resolveLiveRepository(projectFolder);
	if (!repository) {
		return unavailableLiveContextStatus(
			configuredBranch,
			'The live project folder is not inside a Git repository.',
		);
	}
	try {
		validateDeploymentContextSubpath(repository.repositoryRoot, env.NAO_CONTEXT_GIT_SUBPATH);
	} catch (error) {
		if (error instanceof ContextProjectResolutionError) {
			return unavailableLiveContextStatus(
				configuredBranch,
				error.message,
				repository.lastCheckedAt,
				error.message,
			);
		}
		throw error;
	}
	const issue = getLiveRepositoryIssue(repository, configuredBranch, 'configured', env.NAO_CONTEXT_GIT_URL);
	if (issue) {
		return unavailableLiveContextStatus(configuredBranch, issue.message, repository.lastCheckedAt);
	}
	return availableLiveContextStatus(configuredBranch, repository.lastCheckedAt);
}

export function pullLiveContext(projectFolder: string): LiveContextPullResult;

export function pullLiveContext(context: ContextExplorerGitContext): Promise<LiveContextPullResult>;

export function pullLiveContext(
	input: string | ContextExplorerGitContext,
): LiveContextPullResult | Promise<LiveContextPullResult> {
	return typeof input === 'string' ? pullDeploymentLiveContext(input) : pullConnectedLiveContext(input);
}

export function getDeploymentContextSource(): DeploymentContextSource | null {
	if (!isGitContextSource()) {
		return null;
	}
	return {
		repositoryUrl: env.NAO_CONTEXT_GIT_URL ? sanitizeContextSourceRepositoryUrl(env.NAO_CONTEXT_GIT_URL) : null,
		platform: env.NAO_CONTEXT_GIT_PLATFORM ?? detectGitPlatform(env.NAO_CONTEXT_GIT_URL),
		branch: env.NAO_CONTEXT_GIT_BRANCH || 'main',
		subpath: env.NAO_CONTEXT_GIT_SUBPATH || null,
		authMethod: resolveContextSourceAuthMethod(),
	};
}

function pullDeploymentLiveContext(projectFolder: string): LiveContextPullResult {
	if (!isGitContextSource()) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Live context updates are only available when NAO_CONTEXT_SOURCE is set to git.',
		});
	}
	const configuredBranch = env.NAO_CONTEXT_GIT_BRANCH || 'main';
	if (!isValidBranch(configuredBranch)) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'NAO_CONTEXT_GIT_BRANCH is not a valid Git branch name.',
		});
	}
	const repository = resolveLiveRepository(projectFolder);
	if (!repository) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'The live project folder is not inside a Git repository.',
		});
	}
	validateDeploymentContextSubpath(repository.repositoryRoot, env.NAO_CONTEXT_GIT_SUBPATH);
	assertLiveRepositoryUpdatable(repository, configuredBranch, 'configured', env.NAO_CONTEXT_GIT_URL);
	const repositoryUrl = env.NAO_CONTEXT_GIT_URL;
	return updateLiveRepository(
		repository,
		configuredBranch,
		(repositoryRoot, branch) => {
			if (!repositoryUrl) {
				runGit(repositoryRoot, ['fetch', '--no-tags', 'origin', branch], GIT_OPERATION_TIMEOUT_MS);
				return;
			}
			runGitFetchWithCredentials(
				repositoryRoot,
				repositoryUrl,
				branch,
				{
					platform: env.NAO_CONTEXT_GIT_PLATFORM ?? detectGitPlatform(repositoryUrl),
					sshKey: env.NAO_CONTEXT_GIT_SSH_KEY,
					token: env.NAO_CONTEXT_GIT_TOKEN,
				},
				GIT_OPERATION_TIMEOUT_MS,
			);
		},
		getGitRemoteCredentialSecrets(repositoryUrl, {
			sshKey: env.NAO_CONTEXT_GIT_SSH_KEY,
			token: env.NAO_CONTEXT_GIT_TOKEN,
		}),
	);
}

async function pullConnectedLiveContext(context: ContextExplorerGitContext): Promise<LiveContextPullResult> {
	const configuredRepo = await resolveContextRepo(
		context.projectId,
		context.projectFolder,
		context.userId,
		context.configOverride,
	);
	if (!configuredRepo || configuredRepo.source !== 'settings') {
		return pullDeploymentLiveContext(context.projectFolder);
	}
	if (!context.token) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: `Connect your ${getRepoProviderDisplayName(configuredRepo.provider)} account before updating live context files.`,
		});
	}
	if (configuredRepo.provider !== 'github' && configuredRepo.provider !== 'gitlab') {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'The connected repository provider is not supported.' });
	}
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[configuredRepo.provider];
	refreshDefaultBranch(repo, configuredRepo.provider, availableContext.token);
	const configuredBranch = readDefaultBranch(repo);
	const liveRepository = resolveOAuthLiveRepository(context, provider, configuredRepo.repoFullName);
	const result = liveRepository
		? updateOAuthLiveRepository(liveRepository, configuredBranch, configuredRepo.provider, availableContext.token)
		: convertLiveProjectToOAuthRepository(
				context,
				provider,
				configuredRepo.provider,
				configuredRepo.repoFullName,
				configuredBranch,
				availableContext.token,
			);
	synchronizeConnectedDefaultWorktrees(availableContext, repo, provider);
	return result;
}

export function getResolvedLiveContextUpdateStatus(
	context: ContextExplorerGitContext,
	resolution: ContextExplorerGitResolution,
): LiveContextUpdateStatus {
	if (resolution.repo?.source !== 'settings') {
		return getLiveContextUpdateStatus(context.projectFolder);
	}
	const defaultBranch =
		resolution.status === 'available'
			? readDefaultBranch(resolution.repo)
			: readKnownDefaultBranch(context.projectId, context.projectFolder, context.userId);
	const configuredBranch = defaultBranch ?? 'default branch';
	if (!context.token) {
		return unavailableLiveContextStatus(
			configuredBranch,
			`Connect your ${getRepoProviderDisplayName(resolution.repo.provider)} account before updating live context files.`,
		);
	}
	if (resolution.status === 'unavailable') {
		return unavailableLiveContextStatus(configuredBranch, resolution.message);
	}
	const provider = resolution.context.providerOverride ?? REVIEW_REQUEST_PROVIDERS[resolution.repo.provider];
	try {
		const liveRepository = resolveOAuthLiveRepository(context, provider, resolution.repo.repoFullName);
		if (!liveRepository) {
			assertSafeLiveReplacementTarget(context);
			return availableLiveContextStatus(configuredBranch, null);
		}
		const issue = getLiveRepositoryIssue(liveRepository, configuredBranch, 'repository default');
		if (issue) {
			return unavailableLiveContextStatus(configuredBranch, issue.message, liveRepository.lastCheckedAt);
		}
		return availableLiveContextStatus(configuredBranch, liveRepository.lastCheckedAt);
	} catch (error) {
		return unavailableLiveContextStatus(configuredBranch, sanitizeLiveContextError(error, context.token).message);
	}
}

export function getLiveContextRepository(
	repo: ReturnType<typeof toContextRepoState>,
	contextSource: DeploymentContextSource | null,
): Pick<DeploymentContextSource, 'repositoryUrl' | 'platform'> | null {
	if (repo?.source === 'settings' && (repo.provider === 'github' || repo.provider === 'gitlab')) {
		const provider = REVIEW_REQUEST_PROVIDERS[repo.provider];
		return {
			repositoryUrl: provider.publicRepoUrl(repo.repoFullName),
			platform: repo.provider,
		};
	}
	return contextSource;
}

function availableLiveContextStatus(configuredBranch: string, lastCheckedAt: string | null): LiveContextUpdateStatus {
	return {
		enabled: true,
		available: true,
		configuredBranch,
		lastCheckedAt,
		unavailableReason: null,
		configurationError: null,
	};
}

function unavailableLiveContextStatus(
	configuredBranch: string,
	unavailableReason: string,
	lastCheckedAt: string | null = null,
	configurationError: string | null = null,
): LiveContextUpdateStatus {
	return {
		enabled: true,
		available: false,
		configuredBranch,
		lastCheckedAt,
		unavailableReason,
		configurationError,
	};
}

function readKnownDefaultBranch(projectId: string, projectFolder: string, userId: string): string | null {
	const worktree = getContextWorktreePath(projectId, projectFolder, userId);
	return (
		readDefaultBranchFromRefs(worktree) ??
		readDefaultBranchFromRefs(discoverLiveRepositoryRoot(projectFolder) ?? '')
	);
}

function resolveLiveRepository(projectFolder: string): LiveRepository | null {
	const repositoryRoot = discoverLiveRepositoryRoot(projectFolder);
	return repositoryRoot
		? {
				repositoryRoot,
				projectPrefix: resolveLiveProjectPrefix(repositoryRoot, projectFolder),
				lastCheckedAt: readFetchHeadTime(repositoryRoot),
			}
		: null;
}

function getLiveRepositoryIssue(
	repository: LiveRepository,
	configuredBranch: string,
	branchLabel: 'configured' | 'repository default',
	expectedOrigin?: string,
): LiveRepositoryIssue | null {
	const currentBranch = readCurrentBranchFromPath(repository.repositoryRoot);
	if (currentBranch !== configuredBranch) {
		return {
			code: 'CONFLICT',
			message: currentBranch
				? `The live checkout is on "${currentBranch}", not the ${branchLabel} "${configuredBranch}" branch.`
				: `The live checkout is detached; check out the ${branchLabel} "${configuredBranch}" branch first.`,
		};
	}
	return getLiveRepositoryOriginIssue(
		repository,
		expectedOrigin,
		"The configured repository does not match the live project's Git repository.",
	);
}

function getLiveRepositoryOriginIssue(
	repository: LiveRepository,
	expectedOrigin?: string,
	mismatchMessage = 'The live project uses a different Git origin than the connected repository.',
): LiveRepositoryIssue | null {
	const origin = readOptionalGitValue(repository.repositoryRoot, ['remote', 'get-url', 'origin']);
	if (!origin) {
		return { code: 'BAD_REQUEST', message: 'The live Git repository does not have an origin remote.' };
	}
	if (expectedOrigin && normalizeRemote(origin) !== normalizeRemote(expectedOrigin)) {
		return {
			code: 'CONFLICT',
			message: mismatchMessage,
		};
	}
	return null;
}

function assertLiveRepositoryUpdatable(
	repository: LiveRepository,
	configuredBranch: string,
	branchLabel: 'configured' | 'repository default',
	expectedOrigin?: string,
): void {
	const issue = getLiveRepositoryIssue(repository, configuredBranch, branchLabel, expectedOrigin);
	if (issue) {
		throw new TRPCError(issue);
	}
}

function resolveOAuthLiveRepository(
	context: ContextExplorerGitContext,
	provider: ContextRepositoryProvider,
	repoFullName: string,
): LiveRepository | null {
	const projectFolder = assertAbsoluteProjectPath(context.projectFolder);
	const stat = fs.lstatSync(projectFolder);
	if (stat.isSymbolicLink()) {
		validateManagedLiveProjectSymlink(context);
	} else if (!stat.isDirectory()) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'The configured live project path is not a directory.' });
	}
	const repository = resolveLiveRepository(projectFolder);
	if (!repository) {
		return null;
	}
	const issue = getLiveRepositoryOriginIssue(repository, provider.publicRepoUrl(repoFullName));
	if (issue) {
		throw new TRPCError(issue);
	}
	validateLiveProjectAtHead(repository.repositoryRoot, repository.projectPrefix);
	return repository;
}

function updateOAuthLiveRepository(
	liveRepository: LiveRepository,
	configuredBranch: string,
	providerName: RepoProvider,
	token: string,
): LiveContextPullResult {
	assertLiveRepositoryUpdatable(liveRepository, configuredBranch, 'repository default');
	return updateLiveRepository(
		liveRepository,
		configuredBranch,
		(repositoryRoot, branch) => {
			runGitWithOAuth(
				repositoryRoot,
				['fetch', '--no-tags', 'origin', branch],
				getGitOAuthCredential(providerName, token),
				GIT_OPERATION_TIMEOUT_MS,
			);
		},
		token,
	);
}

function updateLiveRepository(
	repository: LiveRepository,
	configuredBranch: string,
	fetch: (repositoryRoot: string, branch: string) => void,
	secrets?: string | string[],
): LiveContextPullResult {
	const oldCommit = runGit(repository.repositoryRoot, ['rev-parse', 'HEAD']).toString().trim();
	try {
		fetch(repository.repositoryRoot, configuredBranch);
		runGit(repository.repositoryRoot, ['merge', '--ff-only', 'FETCH_HEAD'], GIT_OPERATION_TIMEOUT_MS);
	} catch (error) {
		throw sanitizeLiveContextError(error, secrets);
	}
	const newCommit = runGit(repository.repositoryRoot, ['rev-parse', 'HEAD']).toString().trim();
	return createLivePullResult(repository, configuredBranch, oldCommit, newCommit);
}

function createLivePullResult(
	repository: Pick<LiveRepository, 'repositoryRoot' | 'projectPrefix'>,
	configuredBranch: string,
	oldCommit: string | null,
	newCommit: string,
): LiveContextPullResult {
	return {
		changed: oldCommit !== newCommit,
		checkedAt: new Date().toISOString(),
		configuredBranch,
		oldCommit,
		newCommit,
		files:
			oldCommit === newCommit
				? []
				: oldCommit
					? readLivePullFiles(repository.repositoryRoot, oldCommit, newCommit, repository.projectPrefix)
					: readInitialLiveFiles(repository.repositoryRoot, newCommit, repository.projectPrefix),
	};
}

function convertLiveProjectToOAuthRepository(
	context: ContextExplorerGitContext,
	provider: ContextRepositoryProvider,
	providerName: RepoProvider,
	repoFullName: string,
	configuredBranch: string,
	token: string,
): LiveContextPullResult {
	assertSafeLiveReplacementTarget(context);
	const projectFolder = path.resolve(context.projectFolder);
	const managedParent = getManagedLiveRepositoriesParent(projectFolder);
	fs.mkdirSync(managedParent, { recursive: true });
	const stagingRoot = path.join(managedParent, `.staging-${context.projectId}-${randomUUID()}`);
	const stagedRepository = path.join(stagingRoot, 'repository');
	try {
		fs.mkdirSync(stagingRoot);
		runGitWithOAuth(
			managedParent,
			[
				'clone',
				'--branch',
				configuredBranch,
				'--single-branch',
				provider.publicRepoUrl(repoFullName),
				stagedRepository,
			],
			getGitOAuthCredential(providerName, token),
			GIT_OPERATION_TIMEOUT_MS,
		);
		const projectPrefix = resolveTrackedContextProjectPrefix(stagedRepository);
		validateLiveProjectAtHead(stagedRepository, projectPrefix);
		const newCommit = runGit(stagedRepository, ['rev-parse', 'HEAD']).toString().trim();
		const result = createLivePullResult(
			{ repositoryRoot: stagedRepository, projectPrefix },
			configuredBranch,
			null,
			newCommit,
		);
		promoteStagedLiveRepository(context, stagingRoot, stagedRepository, projectPrefix);
		return result;
	} catch (error) {
		throw sanitizeLiveContextError(error, token);
	} finally {
		fs.rmSync(stagingRoot, { recursive: true, force: true });
	}
}

function promoteStagedLiveRepository(
	context: ContextExplorerGitContext,
	stagingRoot: string,
	stagedRepository: string,
	projectPrefix: string,
): void {
	const projectFolder = path.resolve(context.projectFolder);
	const backupPath = path.join(path.dirname(projectFolder), `.nao-live-backup-${context.projectId}-${randomUUID()}`);
	const managedRoot = getManagedLiveRepositoryContainer(context.projectId, projectFolder);
	if (projectPrefix && fs.existsSync(managedRoot)) {
		throw new Error('The managed live repository location already exists.');
	}
	fs.renameSync(projectFolder, backupPath);
	try {
		if (projectPrefix) {
			fs.renameSync(stagingRoot, managedRoot);
			fs.symlinkSync(path.join(managedRoot, 'repository', ...projectPrefix.split('/')), projectFolder, 'dir');
		} else {
			fs.renameSync(stagedRepository, projectFolder);
		}
	} catch (error) {
		if (fs.lstatSync(projectFolder, { throwIfNoEntry: false })?.isSymbolicLink()) {
			fs.unlinkSync(projectFolder);
		}
		if (projectPrefix && fs.existsSync(managedRoot)) {
			fs.renameSync(managedRoot, stagingRoot);
		}
		fs.renameSync(backupPath, projectFolder);
		throw error;
	}
	fs.rmSync(backupPath, { recursive: true, force: true });
}

function assertSafeLiveReplacementTarget(context: ContextExplorerGitContext): void {
	const projectFolder = assertAbsoluteProjectPath(context.projectFolder);
	getManagedLiveRepositoryContainer(context.projectId, projectFolder);
	const stat = fs.lstatSync(projectFolder);
	if (stat.isSymbolicLink()) {
		throw new Error('Refusing to replace a live project symlink that is not managed by nao.');
	}
	if (!stat.isDirectory()) {
		throw new Error('The configured live project path is not a directory.');
	}
	const home = path.resolve(process.env.HOME ?? '');
	const applicationRepository = discoverLiveRepositoryRoot(process.cwd());
	if (
		projectFolder === path.parse(projectFolder).root ||
		projectFolder === home ||
		(applicationRepository !== null && isSameOrAncestor(projectFolder, applicationRepository))
	) {
		throw new Error('Refusing to replace an unsafe live project path.');
	}
	const configPath = path.join(projectFolder, 'nao_config.yaml');
	const configStat = fs.lstatSync(configPath, { throwIfNoEntry: false });
	if (!configStat?.isFile() || configStat.isSymbolicLink()) {
		throw new Error('The live project folder must contain its expected nao_config.yaml before replacement.');
	}
	fs.accessSync(path.dirname(projectFolder), fs.constants.W_OK);
}

function validateManagedLiveProjectSymlink(context: ContextExplorerGitContext): void {
	const projectFolder = path.resolve(context.projectFolder);
	const managedRoot = getManagedLiveRepositoryContainer(context.projectId, projectFolder);
	const repositoryRoot = path.join(managedRoot, 'repository');
	const target = fs.realpathSync(projectFolder);
	if (target === fs.realpathSync(repositoryRoot) || !isSameOrAncestor(fs.realpathSync(repositoryRoot), target)) {
		throw new Error('Refusing to use a live project symlink that is not managed by nao.');
	}
}

function getManagedLiveRepositoriesParent(projectFolder: string): string {
	return path.join(path.dirname(projectFolder), '.nao', 'live-repositories');
}

function getManagedLiveRepositoryContainer(projectId: string, projectFolder: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
		throw new Error('Invalid project id for managed live repository path.');
	}
	return path.join(getManagedLiveRepositoriesParent(projectFolder), projectId);
}

function validateLiveProjectAtHead(repositoryRoot: string, projectPrefix: string): void {
	const configPath = projectPrefix ? `${projectPrefix}/nao_config.yaml` : 'nao_config.yaml';
	if (readOptionalGitValue(repositoryRoot, ['cat-file', '-t', `HEAD:${configPath}`]) !== 'blob') {
		throw new ContextProjectResolutionError(
			'project-not-found',
			'No tracked nao_config.yaml was found for the live context project.',
		);
	}
}

function readInitialLiveFiles(repositoryRoot: string, newCommit: string, projectPrefix: string): LiveContextPullFile[] {
	const emptyTree = runGit(repositoryRoot, ['hash-object', '-t', 'tree', '/dev/null']).toString().trim();
	return readLivePullFiles(repositoryRoot, emptyTree, newCommit, projectPrefix);
}

function synchronizeConnectedDefaultWorktrees(
	context: ContextExplorerGitContext & { token: string },
	repo: ResolvedContextRepo,
	provider: ContextRepositoryProvider,
): void {
	const worktreesParent = path.dirname(
		getContextWorktreePath(context.projectId, context.projectFolder, context.userId),
	);
	const matchingClone = discoverLiveRepositoryRoot(context.projectFolder);
	let entries: string[];
	try {
		entries = fs.readdirSync(worktreesParent);
	} catch {
		return;
	}
	for (const entry of entries) {
		const candidate = { ...repo, worktreeRoot: path.join(worktreesParent, entry) };
		if (!isHealthyWorktree(candidate, provider)) {
			continue;
		}
		try {
			synchronizeDefaultContextWorktree(candidate, context.projectFolder, matchingClone, provider, context.token);
		} catch {
			continue;
		}
	}
}

function readFetchHeadTime(repositoryRoot: string): string | null {
	const gitPath = readOptionalGitValue(repositoryRoot, ['rev-parse', '--git-path', 'FETCH_HEAD']);
	if (!gitPath) {
		return null;
	}
	try {
		const fetchHeadPath = path.isAbsolute(gitPath) ? gitPath : path.resolve(repositoryRoot, gitPath);
		return fs.statSync(fetchHeadPath).mtime.toISOString();
	} catch {
		return null;
	}
}

function readLivePullFiles(
	repositoryRoot: string,
	oldCommit: string,
	newCommit: string,
	projectPrefix: string,
): LiveContextPullFile[] {
	const output = runGit(repositoryRoot, [
		'diff',
		'--numstat',
		'-z',
		'--no-renames',
		oldCommit,
		newCommit,
		'--',
		projectPrefix || '.',
	]);
	const files: LiveContextPullFile[] = [];
	for (const record of output.toString().split('\0')) {
		const firstTab = record.indexOf('\t');
		const secondTab = record.indexOf('\t', firstTab + 1);
		if (firstTab < 0 || secondTab < 0) {
			continue;
		}
		const filePath = fromLiveRepoPath(record.slice(secondTab + 1), projectPrefix);
		if (!filePath) {
			continue;
		}
		files.push({
			path: `/${filePath}`,
			additions: parseLineCount(record.slice(0, firstTab)),
			deletions: parseLineCount(record.slice(firstTab + 1, secondTab)),
		});
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function fromLiveRepoPath(repoPath: string, projectPrefix: string): string | null {
	if (!projectPrefix) {
		return repoPath;
	}
	const prefix = `${projectPrefix}/`;
	return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null;
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
