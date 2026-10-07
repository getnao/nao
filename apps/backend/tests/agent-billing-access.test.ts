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
		vi.clearAllMocks();
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
});
