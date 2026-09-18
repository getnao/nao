import { env } from '../env';
import {
	detectGitPlatform,
	type GitPlatform,
	resolveContextSourceGitAuthMethod,
	sanitizeContextSourceRepositoryUrl,
} from '../utils/context-repo';
import { type GitOperation, GitOperationError } from '../utils/git-repo';
import { logger, sanitizeLogText, serializeError } from '../utils/logger';
import type { InternalRepoProvider, ReviewRequestProvider } from './review-request-provider';
import { REVIEW_REQUEST_PROVIDERS } from './review-request-provider';

export type ContextGitActionOperation = GitOperation | 'create-pull-request';

export interface ContextGitActionFailureDetails {
	operation: ContextGitActionOperation;
	provider: InternalRepoProvider;
	platform: GitPlatform | null;
	authMethod: 'oauth-token' | 'token' | 'ssh-key' | 'public';
	repositoryUrl: string;
}

export class ContextGitActionError extends Error {
	constructor(
		public readonly originalError: unknown,
		public readonly details: ContextGitActionFailureDetails,
	) {
		super(originalError instanceof Error ? originalError.message : String(originalError));
		this.name = 'ContextGitActionError';
	}
}

export function toContextGitActionError(
	error: unknown,
	repo: { provider: InternalRepoProvider; repoFullName: string },
	fallbackOperation: ContextGitActionOperation,
	provider: ReviewRequestProvider = REVIEW_REQUEST_PROVIDERS[repo.provider],
): ContextGitActionError {
	if (error instanceof ContextGitActionError) {
		return error;
	}
	const platform =
		repo.provider === 'generic'
			? (env.NAO_CONTEXT_GIT_PLATFORM ?? detectGitPlatform(repo.repoFullName))
			: repo.provider;
	return new ContextGitActionError(error, {
		operation:
			error instanceof GitOperationError && error.operation !== 'git' ? error.operation : fallbackOperation,
		provider: repo.provider,
		platform,
		authMethod: repo.provider === 'generic' ? resolveContextSourceGitAuthMethod() : 'oauth-token',
		repositoryUrl: sanitizeContextSourceRepositoryUrl(provider.publicRepoUrl(repo.repoFullName)),
	});
}

export function logContextGitActionFailure(
	error: unknown,
	args: { message: string; projectId: string; context?: Record<string, unknown> },
): void {
	const failure = error instanceof ContextGitActionError ? error : null;
	const originalError = failure?.originalError ?? error;
	const serializedError = serializeError(originalError);
	const errorMessage =
		originalError instanceof GitOperationError
			? sanitizeLogText(originalError.details)
			: typeof serializedError.message === 'string'
				? serializedError.message
				: typeof serializedError.value === 'string'
					? serializedError.value
					: 'Unknown error';
	const details = {
		operation:
			failure?.details.operation ??
			(originalError instanceof GitOperationError ? originalError.operation : 'git'),
		...(failure
			? {
					provider: failure.details.provider,
					platform: failure.details.platform,
					authMethod: failure.details.authMethod,
					repositoryUrl: failure.details.repositoryUrl,
				}
			: {}),
		projectId: sanitizeLogText(args.projectId),
		...args.context,
		error: errorMessage,
	};
	logger.error(`${args.message}: ${sanitizeLogText(JSON.stringify(details))}`, {
		source: 'agent',
		projectId: args.projectId,
		context: { ...details, error: serializedError },
	});
}
