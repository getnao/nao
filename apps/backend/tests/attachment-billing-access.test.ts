import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addHook: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
	assertProjectUserCloudBillingAccess: vi.fn(),
	getUserRoleInProject: vi.fn(),
	post: vi.fn(),
	route: vi.fn(),
}));

vi.mock('../src/middleware/auth', () => ({ authMiddleware: vi.fn() }));
vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
	assertProjectUserCloudBillingAccess: mocks.assertProjectUserCloudBillingAccess,
}));
vi.mock('../src/services/storage', () => ({
	isStorageEnabled: () => true,
	relativePathFromKey: vi.fn(),
	STORAGE_DISABLED_MESSAGE: 'disabled',
}));
vi.mock('../src/services/storage/user-files', () => ({
	readUserFileBytes: vi.fn(),
	saveUploadedFile: vi.fn(),
	statUserFile: vi.fn(),
}));

import { attachmentRoutes } from '../src/routes/attachment';

describe('attachment upload billing access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUserRoleInProject.mockResolvedValue('user');
	});

	it('checks the acting user before accepting POST bytes', async () => {
		const restricted = new Error('seat restricted');
		mocks.assertProjectUserCloudBillingAccess.mockRejectedValue(restricted);
		await attachmentRoutes({
			addHook: mocks.addHook,
			post: mocks.post,
			route: mocks.route,
		} as never);
		const handler = mocks.post.mock.calls[0][1] as (request: {
			user: { id: string };
			project: { id: string };
			file: ReturnType<typeof vi.fn>;
		}) => Promise<unknown>;
		const request = {
			user: { id: 'actor-1' },
			project: { id: 'project-1' },
			file: vi.fn(),
		};

		await expect(handler(request)).rejects.toBe(restricted);

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
		expect(mocks.assertProjectUserCloudBillingAccess).toHaveBeenCalledWith('project-1', 'actor-1');
		expect(request.file).not.toHaveBeenCalled();
	});
});
