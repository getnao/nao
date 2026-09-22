import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const execute = vi.fn();
	const orderBy = vi.fn();
	const query: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of ['from', 'innerJoin', 'where', 'limit']) {
		query[method] = vi.fn(() => query);
	}
	query.orderBy = orderBy.mockImplementation(() => query);
	query.execute = execute;

	return {
		execute,
		orderBy,
		select: vi.fn(() => query),
	};
});

vi.mock('../src/db/db', () => ({
	db: { select: mocks.select },
}));

import { getUserOrgMembership, listUserOrgMemberships } from '../src/queries/organization.queries';

const USER_ID = 'organization-selection-user';
const FIRST_ORG_ID = 'organization-selection-first';
const SELECTED_ORG_ID = 'organization-selection-selected';
const UNAUTHORIZED_ORG_ID = 'organization-selection-unauthorized';

describe('organization selection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns an explicitly selected membership', async () => {
		mocks.execute.mockResolvedValueOnce([membershipRow(SELECTED_ORG_ID, 'Alpha Organization', 'viewer')]);

		const membership = await getUserOrgMembership(USER_ID, SELECTED_ORG_ID);

		expect(membership).toMatchObject({
			orgId: SELECTED_ORG_ID,
			role: 'viewer',
			organization: { id: SELECTED_ORG_ID, name: 'Alpha Organization' },
		});
	});

	it('retains the current fallback when no organization is selected', async () => {
		mocks.execute.mockResolvedValueOnce([membershipRow(FIRST_ORG_ID, 'Zulu Organization', 'admin')]);

		const membership = await getUserOrgMembership(USER_ID);

		expect(membership?.orgId).toBe(FIRST_ORG_ID);
		expect(mocks.execute).toHaveBeenCalledOnce();
	});

	it('falls back without granting access to an unauthorized organization', async () => {
		mocks.execute
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([membershipRow(FIRST_ORG_ID, 'Zulu Organization', 'admin')]);

		const membership = await getUserOrgMembership(USER_ID, UNAUTHORIZED_ORG_ID);

		expect(membership?.orgId).toBe(FIRST_ORG_ID);
		expect(membership?.orgId).not.toBe(UNAUTHORIZED_ORG_ID);
		expect(mocks.execute).toHaveBeenCalledTimes(2);
	});

	it('falls back when the selected organization no longer exists', async () => {
		mocks.execute
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([membershipRow(FIRST_ORG_ID, 'Zulu Organization', 'admin')]);

		const membership = await getUserOrgMembership(USER_ID, 'stale-organization-id');

		expect(membership?.orgId).toBe(FIRST_ORG_ID);
	});

	it('lists only the membership fields needed by the selector', async () => {
		mocks.execute.mockResolvedValueOnce([
			{ id: SELECTED_ORG_ID, name: 'Alpha Organization', role: 'viewer' },
			{ id: FIRST_ORG_ID, name: 'Zulu Organization', role: 'admin' },
		]);

		const memberships = await listUserOrgMemberships(USER_ID);

		expect(memberships).toEqual([
			{ id: SELECTED_ORG_ID, name: 'Alpha Organization', role: 'viewer' },
			{ id: FIRST_ORG_ID, name: 'Zulu Organization', role: 'admin' },
		]);
		expect(mocks.orderBy).toHaveBeenCalledOnce();
		expect(mocks.orderBy.mock.calls[0]).toHaveLength(2);
	});
});

function membershipRow(orgId: string, name: string, role: 'admin' | 'user' | 'viewer') {
	return {
		orgId,
		userId: USER_ID,
		role,
		createdAt: new Date(),
		organization: {
			id: orgId,
			name,
			slug: orgId,
		},
	};
}
