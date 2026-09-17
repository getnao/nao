import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED = 'true';
});

const mocks = vi.hoisted(() => {
	class ContextPullRequestInputError extends Error {}
	class ProviderNotConnectedError extends Error {}
	const sanitize = (value: string) =>
		value.replace(/:\/\/[^/\s@]+@/g, '://***@').replace(/(\bbearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]');
	return {
		ContextPullRequestInputError,
		ProviderNotConnectedError,
		createBatchPullRequest: vi.fn(),
		createPullRequest: vi.fn(),
		loggerError: vi.fn(),
		sanitize,
	};
});

vi.mock('../src/auth', () => ({ getSession: vi.fn() }));
vi.mock('../src/services/sso-group-mapping.service', () => ({ isGroupRoleMappingActive: vi.fn(async () => false) }));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', path: null })),
	getUserRoleInProject: vi.fn(async () => 'admin'),
}));
vi.mock('../src/queries/context-recommendation.queries', () => ({}));
vi.mock('../src/queries/user.queries', () => ({}));
vi.mock('../src/services/agent', () => ({ agentService: { get: vi.fn() } }));
vi.mock('../src/services/context-pr.service', () => ({
	ContextPullRequestInputError: mocks.ContextPullRequestInputError,
	ProviderNotConnectedError: mocks.ProviderNotConnectedError,
	createBatchRecommendationPullRequest: mocks.createBatchPullRequest,
	createRecommendationPullRequest: mocks.createPullRequest,
	resolveRecommendationRepo: vi.fn(),
}));
vi.mock('../src/utils/logger', () => ({
	logger: { error: mocks.loggerError, info: vi.fn(), warn: vi.fn() },
	sanitizeLogText: mocks.sanitize,
	serializeError: (error: unknown) => ({
		name: error instanceof Error ? error.name : undefined,
		message: mocks.sanitize(error instanceof Error ? error.message : String(error)),
		stack: error instanceof Error && error.stack ? mocks.sanitize(error.stack) : undefined,
	}),
}));
vi.mock('../src/handlers/context-recommendations.handler', () => ({
	ensureContextRecommendationsSchedule: vi.fn(),
}));
vi.mock('../src/services/context-recommendations.service', () => ({
	repairRecommendationTriggerRefs: vi.fn(),
	runContextRecommendations: vi.fn(),
}));
vi.mock('../src/utils/llm', () => ({ getProjectAvailableModels: vi.fn() }));

import { ContextGitActionError } from '../src/services/context-git-action-error';
import { contextRecommendationRoutes } from '../src/trpc/context-recommendation.routes';
import { router } from '../src/trpc/trpc';
import { GitOperationError } from '../src/utils/git-repo';

const testRouter = router(contextRecommendationRoutes);

describe('context recommendation pull request errors', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a generic clone failure while logging sanitized details', async () => {
		const gitError = new GitOperationError(
			'Unauthorized',
			'clone',
			'Command failed: git clone https://oauth2:secret-token@gitlab.com/nao/context.git\nUnauthorized',
		);
		mocks.createPullRequest.mockRejectedValue(
			new ContextGitActionError(gitError, {
				operation: 'clone',
				provider: 'generic',
				platform: 'gitlab',
				authMethod: 'token',
				repositoryUrl: 'https://gitlab.com/nao/context.git',
			}),
		);

		await expect(createCaller().createPullRequest({ id: 'rec-1' })).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to create pull request. Ask an administrator to check Server logs.',
		});

		const [message, options] = mocks.loggerError.mock.calls[0];
		expect(message).toContain('"operation":"clone"');
		expect(message).toContain('"provider":"generic"');
		expect(message).toContain('"repositoryUrl":"https://gitlab.com/nao/context.git"');
		expect(message).toContain('Unauthorized');
		expect(message).not.toContain('secret-token');
		expect(options).toMatchObject({ projectId: 'project-id', source: 'agent' });
	});

	it('identifies batch push failures without exposing their details to the caller', async () => {
		const gitError = new GitOperationError(
			'Unauthorized',
			'push',
			'fatal: Could not read from remote repository. Bearer secret-token',
		);
		mocks.createBatchPullRequest.mockRejectedValue(
			new ContextGitActionError(gitError, {
				operation: 'push',
				provider: 'generic',
				platform: 'bitbucket',
				authMethod: 'ssh-key',
				repositoryUrl: 'git@bitbucket.org:nao/context.git',
			}),
		);

		await expect(createCaller().createBatchPullRequest({ ids: ['rec-1'] })).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to create pull request. Ask an administrator to check Server logs.',
		});

		const message = mocks.loggerError.mock.calls[0][0] as string;
		expect(message).toContain('"mode":"batch"');
		expect(message).toContain('"operation":"push"');
		expect(message).toContain('"platform":"bitbucket"');
		expect(message).toContain('Could not read from remote repository');
		expect(message).not.toContain('secret-token');
	});

	it.each([
		{
			error: new mocks.ContextPullRequestInputError('Recommendation not found.'),
			code: 'BAD_REQUEST',
		},
		{
			error: new mocks.ProviderNotConnectedError('GitLab is not connected.'),
			code: 'UNAUTHORIZED',
		},
	])('keeps safe domain errors specific', async ({ error, code }) => {
		mocks.createPullRequest.mockRejectedValue(error);

		await expect(createCaller().createPullRequest({ id: 'rec-1' })).rejects.toMatchObject({
			code,
			message: error.message,
		});
		expect(mocks.loggerError).not.toHaveBeenCalled();
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: {
			user: { id: 'user-id', name: 'User', email: 'user@example.com' },
		},
		selectedProjectId: 'project-id',
	} as never);
}
