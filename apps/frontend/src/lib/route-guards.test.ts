import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireUsageOrManagedAiAccess } from './route-guards';

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

describe('requireUsageOrManagedAiAccess', () => {
	beforeEach(() => {
		mocks.ensureQueryData.mockReset();
	});

	it.each(['admin', 'user', 'context_admin'])(
		'allows a project %s without organization membership',
		async (userRole) => {
			mocks.ensureQueryData
				.mockResolvedValueOnce({ userRole })
				.mockResolvedValueOnce({ naoMode: 'cloud' })
				.mockRejectedValueOnce(new Error('organization not found'));

			await expect(requireUsageOrManagedAiAccess()).resolves.toBeUndefined();
			expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2);
		},
	);
});
