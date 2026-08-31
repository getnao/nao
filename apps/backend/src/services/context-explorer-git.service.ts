import { toContextRepoState } from '../utils/context-repo';
import { findOpenContextReviewRequest, getContextBranches } from './context-explorer-git/branches.service';
import { readOptionalGitValue } from './context-explorer-git/git-guards';
import {
	getDeploymentContextSource,
	getLiveContextRepository,
	getLiveContextUpdateStatus,
	getResolvedLiveContextUpdateStatus,
} from './context-explorer-git/live-context.service';
import type { ContextExplorerGitContext, ContextRepositoryStatus } from './context-explorer-git/types';
import {
	readContextWorktreeUpdateStatus,
	resolveContextExplorerGit,
	unavailableMessage,
} from './context-explorer-git/worktree.service';
import { REVIEW_REQUEST_PROVIDERS } from './review-request-provider';

export async function getContextRepositoryStatus(context: ContextExplorerGitContext): Promise<ContextRepositoryStatus> {
	const contextSource = getDeploymentContextSource();
	try {
		const resolution = await resolveContextExplorerGit(context);
		const liveContextUpdate = getResolvedLiveContextUpdateStatus(context, resolution);
		const repositoryState =
			resolution.status === 'available' ? toContextRepoState(resolution.repo) : resolution.repo;
		const liveContextRepository = getLiveContextRepository(repositoryState, contextSource);
		if (resolution.status === 'unavailable') {
			const provider = resolution.repo ? REVIEW_REQUEST_PROVIDERS[resolution.repo.provider] : null;
			return {
				repo: resolution.repo,
				repositoryUrl:
					resolution.repo && provider ? provider.publicRepoUrl(resolution.repo.repoFullName) : null,
				managedByContextSource: contextSource !== null,
				contextSource,
				liveContextRepository,
				liveContextUpdate,
				gitUnavailableReason: resolution.reason,
				gitUnavailableMessage: resolution.message,
				lastCommitMessage: null,
				lastCommitDate: null,
				branches: null,
				fileExplorerUpdate: null,
				openReviewRequest: null,
				isGitRepository: false,
			};
		}
		const { repo } = resolution;
		const provider = resolution.context.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
		const branches = await getContextBranches(repo, resolution.context);
		const repoState = repositoryState;
		return {
			repo: repoState ? { ...repoState, branch: branches.currentBranch } : null,
			repositoryUrl: provider.publicRepoUrl(repo.repoFullName),
			managedByContextSource: contextSource !== null,
			contextSource,
			liveContextRepository,
			liveContextUpdate,
			gitUnavailableReason: null,
			gitUnavailableMessage: null,
			lastCommitMessage: readOptionalGitValue(repo.worktreeRoot, ['log', '-1', '--format=%s']),
			lastCommitDate: readOptionalGitValue(repo.worktreeRoot, ['log', '-1', '--format=%cI']),
			branches,
			fileExplorerUpdate: readContextWorktreeUpdateStatus(repo, context.projectFolder),
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
		const liveContextUpdate = getLiveContextUpdateStatus(context.projectFolder);
		return {
			repo: null,
			repositoryUrl: null,
			managedByContextSource: contextSource !== null,
			contextSource,
			liveContextRepository: contextSource,
			liveContextUpdate,
			gitUnavailableReason: 'git-unavailable',
			gitUnavailableMessage: unavailableMessage('git-unavailable'),
			lastCommitMessage: null,
			lastCommitDate: null,
			branches: null,
			fileExplorerUpdate: null,
			openReviewRequest: null,
			isGitRepository: false,
		};
	}
}

export { sanitizeContextSourceRepositoryUrl } from '../utils/context-repo';
export {
	commitContextChanges,
	createContextBranch,
	createContextBranchAndCommit,
	deleteOwnedContextBranch,
	generateContextBranchName,
	getContextBranchCommitMessages,
	getContextBranches,
	pushContextBranch,
	suggestContextBranchName,
	switchContextBranch,
} from './context-explorer-git/branches.service';
export {
	discardAllContextChanges,
	discardContextFileChange,
	getChangedContextFiles,
	getContextFileDiff,
} from './context-explorer-git/changes.service';
export {
	assertSafeDestructiveWorktreeCommand,
	assertSafeDestructiveWorktreeTarget,
	normalizeRemote,
	sanitizeLiveContextError,
} from './context-explorer-git/git-guards';
export {
	getDeploymentContextSource,
	getLiveContextUpdateStatus,
	pullLiveContext,
} from './context-explorer-git/live-context.service';
export type {
	ContextExplorerGitContext,
	ContextExplorerGitResolution,
	ContextHistoricalDiffAction,
	ContextRepositoryProvider,
	ContextRepositoryStatus,
	ContextWorktreeUpdateStatus,
	CreateBranchAndCommitInput,
	CreateBranchAndCommitResult,
	DeploymentContextSource,
	LiveContextPullFile,
	LiveContextPullResult,
	LiveContextUpdateStatus,
	OwnedContextBranchDeletionInput,
	OwnedContextBranchDeletionResult,
} from './context-explorer-git/types';
export {
	cleanupContextWorktree,
	connectContextRepository,
	disconnectContextRepository,
	ensureContextWorktree,
	getHistoricalContextDiffActions,
	requireContextExplorerGit,
	resolveContextExplorerGit,
	resolveContextExplorerGitSafely,
	updateContextWorktree,
} from './context-explorer-git/worktree.service';
