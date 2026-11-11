import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	provisionCloudTrial: vi.fn(),
}));

vi.mock('../src/services/cloud-trial-provisioning.service', () => ({
	provisionCloudTrial: mocks.provisionCloudTrial,
}));

import { cloudTrialProvisioningHandler } from '../src/handlers/cloud-trial-provisioning.handler';

describe('cloudTrialProvisioningHandler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects a job with no organization ID', async () => {
		await expect(cloudTrialProvisioningHandler({}, {} as never)).rejects.toThrow(
			'Cloud trial provisioning job is missing organizationId',
		);

		expect(mocks.provisionCloudTrial).not.toHaveBeenCalled();
	});

	it('rejects a job with a non-string acting user ID', async () => {
		await expect(
			cloudTrialProvisioningHandler({ organizationId: 'org-id', actingUserId: 123 }, {} as never),
		).rejects.toThrow('Cloud trial provisioning job has an invalid actingUserId');

		expect(mocks.provisionCloudTrial).not.toHaveBeenCalled();
	});

	it('forwards the organization and acting user IDs', async () => {
		await cloudTrialProvisioningHandler({ organizationId: 'org-id', actingUserId: 'user-id' }, {} as never);

		expect(mocks.provisionCloudTrial).toHaveBeenCalledWith('org-id', 'user-id');
	});
});
