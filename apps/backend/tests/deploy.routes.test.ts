import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	post: vi.fn(),
	validateApiKey: vi.fn(),
}));

vi.mock('../src/handlers/context-recommendations.handler', () => ({
	ensureContextRecommendationsScheduleForNewProject: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({}));

vi.mock('../src/services/api-key.service', () => ({
	validateApiKey: mocks.validateApiKey,
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
}));

import { deployRoutes } from '../src/routes/deploy';

describe('deploy route cloud billing access', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.validateApiKey.mockResolvedValue({
			status: 'ok',
			org: { id: 'organization-id' },
			scope: 'deploy',
		});
		mocks.assertOrganizationCloudBillingAccess.mockRejectedValue(new Error('Cloud billing access is restricted'));
		await deployRoutes({ post: mocks.post } as never);
	});

	it('allows a restricted organization to reach project upload validation', async () => {
		const send = vi.fn();
		const status = vi.fn(() => ({ send }));
		const file = vi.fn().mockResolvedValue(undefined);

		await handler()(
			{
				headers: { authorization: 'Bearer nao_valid' },
				file,
			},
			{ status },
		);

		expect(mocks.validateApiKey).toHaveBeenCalledWith('nao_valid');
		expect(file).toHaveBeenCalledOnce();
		expect(status).toHaveBeenCalledWith(400);
		expect(send).toHaveBeenCalledWith({ error: 'No file uploaded. Send a tar.gz as multipart field "context".' });
		expect(mocks.assertOrganizationCloudBillingAccess).not.toHaveBeenCalled();
	});

	it('answers 403 for a key scoped to another API, and 401 for a key that is not one', async () => {
		mocks.validateApiKey.mockResolvedValue({ status: 'scope_mismatch' });
		const unscoped = reply();
		await handler()({ headers: { authorization: 'Bearer nao_user_management' }, file: vi.fn() }, unscoped);
		expect(unscoped.status).toHaveBeenCalledWith(403);
		expect(unscoped.send).toHaveBeenCalledWith({ error: 'This API key is not scoped for deploy' });

		mocks.validateApiKey.mockResolvedValue({ status: 'invalid' });
		const invalid = reply();
		await handler()({ headers: { authorization: 'Bearer nao_nope' }, file: vi.fn() }, invalid);
		expect(invalid.status).toHaveBeenCalledWith(401);
		expect(invalid.send).toHaveBeenCalledWith({ error: 'Invalid API key' });
	});
});

function reply() {
	const send = vi.fn();
	return { send, status: vi.fn(() => ({ send })) };
}

function handler() {
	return mocks.post.mock.calls[0][1] as (
		request: {
			headers: { authorization?: string };
			file: () => Promise<undefined>;
		},
		reply: {
			status: (code: number) => { send: (body: unknown) => unknown };
		},
	) => Promise<unknown>;
}
