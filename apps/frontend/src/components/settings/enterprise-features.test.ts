import { describe, expect, it, vi } from 'vitest';

import { ENTERPRISE_FEATURES } from '../../routes/_sidebar-layout.settings.enterprise';

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (options: unknown) => options,
	redirect: vi.fn(),
}));
vi.mock('@/main', () => ({ queryClient: {}, trpc: {} }));

describe('Enterprise features', () => {
	it('describes unlimited groups beyond the free custom-group limit', () => {
		const userGroups = ENTERPRISE_FEATURES.find((feature) => feature.label === 'Unlimited user groups');

		expect(userGroups).toMatchObject({
			key: 'user-groups',
			description: 'Create more than the 3 custom groups included with the free plan.',
		});
	});

	it('uses the row-level-security license feature', () => {
		const rowLevelSecurity = ENTERPRISE_FEATURES.find((feature) => feature.label === 'Row-level security');

		expect(rowLevelSecurity).toMatchObject({ key: 'row-level-security' });
	});
});
