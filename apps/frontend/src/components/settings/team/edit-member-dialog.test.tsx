// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditMemberDialog } from './edit-member-dialog';

vi.mock('@/hooks/use-sso-role-mapping', () => ({
	useSsoRoleMapping: () => ({
		organizationRolesManagedByIdp: true,
		providerName: 'Okta',
		isLoading: false,
	}),
}));

const member = {
	id: 'user-1',
	name: 'Ada',
	email: 'ada@example.com',
	role: 'admin' as const,
	status: 'active' as const,
};

afterEach(cleanup);

describe('EditMemberDialog role scope', () => {
	it('keeps project and account project-role editing enabled', () => {
		render(
			<EditMemberDialog
				open
				onOpenChange={vi.fn()}
				member={member}
				isAdmin
				roleScope='project'
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.getByRole('button', { name: 'Admin' }).hasAttribute('disabled')).toBe(false);
		expect(screen.queryByText(/Organization roles are assigned/)).toBeNull();
	});

	it('disables organization role editing and explains the login refresh', () => {
		render(
			<EditMemberDialog
				open
				onOpenChange={vi.fn()}
				member={member}
				isAdmin
				roleScope='organization'
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.getByRole('button', { name: 'Admin' }).hasAttribute('disabled')).toBe(true);
		expect(
			screen.getByText(
				'Organization roles are assigned from Okta groups and refresh when the user signs in again.',
			),
		).toBeTruthy();
	});
});
