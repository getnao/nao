import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	role: 'user' as 'admin' | 'context_admin' | 'user' | 'viewer',
	resolveUserGroupAccess: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', orgId: 'org-id', name: 'Project', path: null })),
	getUserRoleInProject: vi.fn(async () => mocks.role),
}));
vi.mock('../../src/services/user-group-availability.service', () => ({
	resolveAvailableUserGroupAccess: mocks.resolveUserGroupAccess,
}));

import { advancedSettingsProtectedProcedure, router } from '../../src/trpc/trpc';
import { createTestCaller } from '../helpers/trpc-caller';

const testRouter = router({ settings: advancedSettingsProtectedProcedure.query(() => 'settings') });
const caller = createTestCaller(testRouter);

describe('advancedSettingsProtectedProcedure', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.role = 'user';
		mocks.resolveUserGroupAccess.mockResolvedValue({ showAllSettings: false });
	});

	it('rejects users whose groups hide advanced settings', async () => {
		await expect(caller.settings()).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Advanced settings are not enabled for your user group.',
		});
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
	});

	it('allows users granted all settings by one of their groups', async () => {
		mocks.resolveUserGroupAccess.mockResolvedValue({ showAllSettings: true });

		await expect(caller.settings()).resolves.toBe('settings');
	});

	it('always allows admins and context admins and rejects viewers', async () => {
		mocks.role = 'admin';
		await expect(caller.settings()).resolves.toBe('settings');

		mocks.role = 'context_admin';
		await expect(caller.settings()).resolves.toBe('settings');

		mocks.role = 'viewer';
		mocks.resolveUserGroupAccess.mockResolvedValue({ showAllSettings: true });
		await expect(caller.settings()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});
