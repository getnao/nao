// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { OrgMembers } from './org-members';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(),
	mutateAsync: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }),
	useQuery: ({ queryKey }: { queryKey: string[] }) => {
		if (queryKey[0] === 'organization-members') {
			return {
				data: [
					{ id: 'admin-1', name: 'Admin', email: 'admin@example.com', role: 'admin', status: 'active' },
					{ id: 'member-1', name: 'Member', email: 'member@example.com', role: 'user', status: 'active' },
				],
				isError: false,
				isLoading: false,
			};
		}
		if (queryKey[0] === 'organization-user-counts') {
			return { data: { totalUsers: 2 } };
		}
		return {
			data: {
				access: {
					tier: 'free',
					seatLimit: 3,
					availableSeats: 1,
				},
				seatCandidates: [
					{
						userId: 'admin-1',
						name: 'Admin',
						email: 'admin@example.com',
						membershipClass: 'org_admin',
						storedOrgRole: 'admin',
						isSelected: false,
						isSeated: true,
						isReadOnly: false,
					},
					{
						userId: 'member-1',
						name: 'Member',
						email: 'member@example.com',
						membershipClass: 'org_member',
						storedOrgRole: 'user',
						isSelected: false,
						isSeated: true,
						isReadOnly: false,
					},
				],
				trialAvailable: true,
			},
		};
	},
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@/hooks/use-cloud-billing-access', () => ({
	useCloudBillingAccess: () => ({ data: { freeTierEnabled: true } }),
}));

vi.mock('@/hooks/use-nao-mode', () => ({
	useIsCloud: () => true,
}));

vi.mock('@/hooks/use-permissions', () => ({
	usePermissions: () => ({ isOrgAdmin: true }),
}));

vi.mock('@/components/settings/team/add-member-dialog', () => ({
	AddMemberDialog: () => null,
}));

vi.mock('@/components/settings/team/edit-member-dialog', () => ({
	EditMemberDialog: () => null,
}));

vi.mock('@/components/settings/team/new-credentials-dialog', () => ({
	NewCredentialsDialog: () => null,
}));

vi.mock('@/components/settings/team/remove-member-dialog', () => ({
	RemoveMemberDialog: () => null,
}));

vi.mock('@/lib/auth-client', () => ({
	useSession: () => ({ data: { user: { id: 'admin-1' } } }),
}));

vi.mock('@/components/ui/tooltip', () => ({
	SimpleTooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/main', () => ({
	trpc: {
		billing: {
			getAccess: { queryKey: () => ['billing-access'] },
			getStatus: { queryKey: () => ['billing-status'], queryOptions: () => ({ queryKey: ['billing-status'] }) },
			selectSeats: { mutationOptions: () => ({}) },
		},
		organization: {
			addMember: { mutationOptions: () => ({}) },
			getMembers: {
				queryKey: () => ['organization-members'],
				queryOptions: () => ({ queryKey: ['organization-members'] }),
			},
			getUserCounts: { queryOptions: () => ({ queryKey: ['organization-user-counts'] }) },
			modifyMember: { mutationOptions: () => ({}) },
			removeMember: { mutationOptions: () => ({}) },
			resetMemberPassword: { mutationOptions: () => ({}) },
		},
	},
}));

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })),
	);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

it('hides seat access until the organization trial starts', () => {
	render(<OrgMembers />);

	expect(screen.getByText('Deploy a project and start your trial to manage member access.')).toBeTruthy();
	expect(screen.queryByRole('columnheader', { name: /Access/ })).toBeNull();
	expect(screen.queryByText('Seated')).toBeNull();
	expect(screen.getByRole('button', { name: 'Actions for Member' })).toBeTruthy();
});
