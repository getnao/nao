import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireContextAdminOrAdmin } from './route-guards';

const mocks = vi.hoisted(() => ({
	ensureQueryData: vi.fn(),
}));

vi.mock('@/main', () => ({
	queryClient: {
		ensureQueryData: mocks.ensureQueryData,
	},
	trpc: {
		organization: {
			get: {
				queryOptions: () => ({}),
			},
		},
		project: {
			getCurrent: {
				queryOptions: () => ({}),
			},
		},
		system: {
			getPublicConfig: {
				queryOptions: () => ({}),
			},
		},
	},
}));

describe('requireContextAdminOrAdmin', () => {
	beforeEach(() => {
		mocks.ensureQueryData.mockReset();
	});

	it.each(['admin', 'context_admin'])('allows a project %s without organization membership', async (userRole) => {
		mocks.ensureQueryData.mockResolvedValueOnce({ userRole });

		await expect(requireContextAdminOrAdmin()).resolves.toBeUndefined();
		expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1);
	});

	it('redirects a regular project user', async () => {
		mocks.ensureQueryData.mockResolvedValueOnce({ userRole: 'user' });

		await expect(requireContextAdminOrAdmin()).rejects.toBeDefined();
		expect(mocks.ensureQueryData).toHaveBeenCalledTimes(1);
	});
});
