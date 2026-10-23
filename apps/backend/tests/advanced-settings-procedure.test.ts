import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	role: 'user' as 'admin' | 'context_admin' | 'user' | 'viewer',
	resolveUserGroupAccess: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', orgId: 'org-id', name: 'Project', path: null })),
	getUserRoleInProject: vi.fn(async () => mocks.role),
}));
vi.mock('../src/services/user-group-availability.service', () => ({
	resolveAvailableUserGroupAccess: mocks.resolveUserGroupAccess,
}));

import { advancedSettingsProtectedProcedure, router } from '../src/trpc/trpc';

const testRouter = router({ settings: advancedSettingsProtectedProcedure.query(() => 'settings') });

describe('advancedSettingsProtectedProcedure', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.role = 'user';
		mocks.resolveUserGroupAccess.mockResolvedValue({ showAllSettings: false });
	});

	it('rejects users whose groups hide advanced settings', async () => {
		await expect(createCaller().settings()).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Advanced settings are not enabled for your user group.',
		});
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
	});

	it('allows users granted all settings by one of their groups', async () => {
		mocks.resolveUserGroupAccess.mockResolvedValue({ showAllSettings: true });

		await expect(createCaller().settings()).resolves.toBe('settings');
	});

	it('always allows admins and context admins and rejects viewers', async () => {
		mocks.role = 'admin';
		await expect(createCaller().settings()).resolves.toBe('settings');

		mocks.role = 'context_admin';
		await expect(createCaller().settings()).resolves.toBe('settings');

		mocks.role = 'viewer';
		mocks.resolveUserGroupAccess.mockResolvedValue({ showAllSettings: true });
		await expect(createCaller().settings()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', name: 'User', email: 'user@example.test' } },
		selectedProjectId: 'project-id',
	} as never);
}
