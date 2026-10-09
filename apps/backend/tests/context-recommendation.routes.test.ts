import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EnvModule from '../src/env';

const mocks = vi.hoisted(() => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
	getLatestRun: vi.fn(),
	getProjectByUserId: vi.fn(),
	getUserRoleInProject: vi.fn(),
	runContextRecommendations: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getSession: vi.fn() }));
vi.mock('../src/env', async (importOriginal) => {
	const actual = await importOriginal<typeof EnvModule>();
	return { ...actual, env: { ...actual.env, BETA_CONTEXT_RECOMMENDATIONS_ENABLED: true } };
});
vi.mock('../src/handlers/context-recommendations.handler', () => ({
	ensureContextRecommendationsSchedule: vi.fn(),
}));
vi.mock('../src/queries/context-recommendation.queries', () => ({
	getLatestRun: mocks.getLatestRun,
}));
vi.mock('../src/queries/organization.queries', () => ({}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: mocks.getProjectByUserId,
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/queries/user.queries', () => ({}));
vi.mock('../src/services/agent', () => ({ agentService: { get: vi.fn() } }));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));
vi.mock('../src/services/context-pr.service', () => ({
	ContextPullRequestInputError: class extends Error {},
	ProviderNotConnectedError: class extends Error {},
	createBatchRecommendationPullRequest: vi.fn(),
	createRecommendationPullRequest: vi.fn(),
	resolveRecommendationRepo: vi.fn(),
}));
vi.mock('../src/services/context-recommendation-prompt', () => ({ buildAgentPrompt: vi.fn() }));
vi.mock('../src/services/context-recommendations.service', () => ({
	repairRecommendationTriggerRefs: vi.fn(),
	runContextRecommendations: mocks.runContextRecommendations,
}));
vi.mock('../src/services/github', () => ({}));
vi.mock('../src/services/gitlab', () => ({}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	isOrganizationRoleMappingActive: vi.fn(),
}));
vi.mock('../src/utils/llm', () => ({ getProjectAvailableModels: vi.fn() }));
vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../src/utils/nao-config', () => ({ extractConfiguredRepos: vi.fn() }));

import { contextRecommendationRoutes } from '../src/trpc/context-recommendation.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ contextRecommendation: contextRecommendationRoutes });

describe('context recommendation routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getLatestRun.mockResolvedValue(null);
		mocks.getProjectByUserId.mockResolvedValue({ id: 'project-id', orgId: 'org-id' });
		mocks.getUserRoleInProject.mockResolvedValue('admin');
	});

	it('blocks protected mutations through the shared cloud billing gate', async () => {
		const accessError = new TRPCError({ code: 'FORBIDDEN', message: 'Cloud billing access is restricted' });
		mocks.assertOrganizationCloudBillingAccess.mockRejectedValue(accessError);

		await expect(caller().contextRecommendation.run()).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Cloud billing access is restricted',
		});

		expect(mocks.runContextRecommendations).not.toHaveBeenCalled();
	});

	it('keeps reads available when billing access is restricted', async () => {
		const latestRun = { id: 'run-id', status: 'completed' };
		mocks.getLatestRun.mockResolvedValue(latestRun);
		mocks.assertOrganizationCloudBillingAccess.mockRejectedValue(
			new TRPCError({ code: 'FORBIDDEN', message: 'Cloud billing access is restricted' }),
		);

		await expect(caller().contextRecommendation.latestRun()).resolves.toEqual(latestRun);

		expect(mocks.assertOrganizationCloudBillingAccess).not.toHaveBeenCalled();
	});
});

function caller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', email: 'admin@example.com', name: 'Admin' } },
		selectedProjectId: 'project-id',
		selectedOrganizationId: null,
	} as never);
}
