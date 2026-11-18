import type { ContextBranchInfo, ContextChangedFile, ContextGitUnavailableReason } from '@nao/shared/types';

import type { ContextRepoConfig, GitPlatform, ResolvedContextRepo } from '../../utils/context-repo';
import { toContextRepoState } from '../../utils/context-repo';
import type { GitIdentity } from '../../utils/git-identity';
import type { OpenReviewRequestResult, ReviewRequestProvider } from '../review-request-provider';

export const REPO_FULL_NAME_PATTERN = /^[\w./-]+\/[\w.-]+$/;

export const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/i;

export const GIT_OPERATION_TIMEOUT_MS = 120_000;

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
	liveContextRepository: Pick<DeploymentContextSource, 'repositoryUrl' | 'platform'> | null;
	liveContextUpdate: LiveContextUpdateStatus;
	gitUnavailableReason: ContextGitUnavailableReason | null;
	gitUnavailableMessage: string | null;
	lastCommitMessage: string | null;
	lastCommitDate: string | null;
	branches: ContextBranchInfo | null;
	fileExplorerUpdate: ContextWorktreeUpdateStatus | null;
	openReviewRequest: OpenReviewRequestResult | null;
	isGitRepository: boolean;
}

export interface ContextWorktreeUpdateStatus {
	updateNeeded: boolean;
	switchNeeded: boolean;
	branch: string;
}

export interface ContextWorktreeTarget extends ContextWorktreeUpdateStatus {
	commit: string | null;
}

export type ContextHistoricalDiffAction = 'open' | 'switch' | 'update' | 'blocked';

export interface DeploymentContextSource {
	repositoryUrl: string | null;
	platform: GitPlatform | null;
	branch: string | null;
	subpath: string | null;
	authMethod: 'token' | 'ssh-key' | 'public';
}

export interface LiveContextUpdateStatus {
	enabled: boolean;
	available: boolean;
	configuredBranch: string;
	lastCheckedAt: string | null;
	unavailableReason: string | null;
	configurationError: string | null;
}

export interface LiveContextPullFile {
	path: string;
	additions: number | null;
	deletions: number | null;
}

export interface LiveContextPullResult {
	changed: boolean;
	checkedAt: string;
	configuredBranch: string;
	oldCommit: string | null;
	newCommit: string;
	files: LiveContextPullFile[];
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

export type ParsedContextChangedFile = Pick<ContextChangedFile, 'path' | 'kind'>;

export type ContextLineCounts = Pick<ContextChangedFile, 'additions' | 'deletions'>;

export interface LiveRepository {
	repositoryRoot: string;
	projectPrefix: string;
	lastCheckedAt: string | null;
}

export interface LiveRepositoryIssue {
	code: 'BAD_REQUEST' | 'CONFLICT';
	message: string;
}
