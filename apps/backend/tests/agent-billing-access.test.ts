import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));

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

class StopAfterBillingAgentService extends AgentService {
	constructor(private readonly nextStepError: Error) {
		super();
	}

	protected override async _getResolvedLlmSelectedModel(): Promise<never> {
		throw this.nextStepError;
	}
}
