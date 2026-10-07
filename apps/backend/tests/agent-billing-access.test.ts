import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addHook: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
	getChatProjectId: vi.fn(),
	getUserRoleInProject: vi.fn(),
	handleAgentRoute: vi.fn(),
	post: vi.fn(),
}));

vi.mock('../src/handlers/agent', () => ({
	handleAgentRoute: mocks.handleAgentRoute,
}));
vi.mock('../src/middleware/auth', () => ({ authMiddleware: vi.fn() }));
vi.mock('../src/queries/chat.queries', () => ({
	getChatProjectId: mocks.getChatProjectId,
}));
vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));

import { agentRoutes } from '../src/routes/agent';
import { AgentService } from '../src/services/agent';

describe('agent billing access', () => {
	beforeEach(() => {
		mocks.assertProjectCloudBillingAccess.mockReset();
	});

	it('preserves an existing agent when billing rejects its replacement', async () => {
		const service = new AgentService();
		const existingAgent = { stop: vi.fn() };
		const accessError = new Error('Cloud billing access is restricted');
		const agents = (service as unknown as { _agents: Map<string, typeof existingAgent> })._agents;
		agents.set('chat-1', existingAgent);
		mocks.assertProjectCloudBillingAccess.mockRejectedValue(accessError);

		await expect(service.create({ id: 'chat-1', projectId: 'project-1', userId: 'user-1' })).rejects.toBe(
			accessError,
		);

		expect(existingAgent.stop).not.toHaveBeenCalled();
		expect(service.get('chat-1')).toBe(existingAgent);
	});

	it.each([
		['checks an unverified project', undefined, 1],
		['checks a differently verified project', 'project-2', 1],
		['does not recheck the verified project', 'project-1', 0],
	] as const)('%s', async (_label, billingAccessVerifiedProjectId, expectedChecks) => {
		const nextStepError = new Error('billing gate passed');
		const service = new StopAfterBillingAgentService(nextStepError);

		await expect(
			service.create(
				{ id: 'chat-1', projectId: 'project-1', userId: 'user-1' },
				undefined,
				billingAccessVerifiedProjectId ? { billingAccessVerifiedProjectId } : {},
			),
		).rejects.toBe(nextStepError);

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledTimes(expectedChecks);
		if (expectedChecks === 1) {
			expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
		}
	});
});

describe('agent route billing access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.assertProjectCloudBillingAccess.mockReset();
	});

	it.each([
		['new message', { message: { text: 'Hello' }, adminMode: false }],
		[
			'message edit',
			{ chatId: 'chat-1', messageToEditId: 'message-1', message: { text: 'Edited' }, adminMode: false },
		],
	])('checks billing access before handling a %s', async (_label, body) => {
		const accessError = new Error('Cloud billing access is restricted');
		mocks.getChatProjectId.mockResolvedValue('project-1');
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.assertProjectCloudBillingAccess.mockRejectedValue(accessError);
		await agentRoutes({ addHook: mocks.addHook, post: mocks.post } as never);
		const handler = mocks.post.mock.calls[0][2] as (request: unknown, reply: unknown) => Promise<unknown>;

		await expect(
			handler(
				{
					user: { id: 'user-1' },
					project: { id: 'project-1' },
					body,
					headers: {},
				},
				{},
			),
		).rejects.toBe(accessError);

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
		expect(mocks.handleAgentRoute).not.toHaveBeenCalled();
	});
});

class StopAfterBillingAgentService extends AgentService {
	constructor(private readonly nextStepError: Error) {
		super();
	}

	protected override async _getResolvedLlmSelectedModel(): Promise<never> {
		throw this.nextStepError;
	}
}
