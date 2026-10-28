import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	events: [] as string[],
	adminCount: 2,
	deletes: 0,
}));

vi.mock('../src/db/dbConfig', () => ({
	Dialect: { Postgres: 'postgres', Sqlite: 'sqlite' },
	default: { dialect: 'postgres' },
}));

vi.mock('../src/db/db', () => ({
	db: {
		transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation(transaction()),
		update: () => transaction().update(),
	},
}));

vi.mock('../src/queries/organization.queries', () => ({
	getOrganizationById: async () => ({ id: 'org-1', name: 'Org' }),
	getOrgMember: async () => ({ orgId: 'org-1', userId: 'user-1', role: 'admin' }),
	countOrgAdmins: async () => mocks.adminCount,
	updateOrgMemberRole: async () => {
		mocks.events.push('update-role');
	},
	listOrgProjectsForContextCleanup: async () => [],
	removeOrgMemberFromProjects: async () => {},
}));

vi.mock('../src/queries/user.queries', () => ({ getUser: async () => ({ id: 'user-1' }) }));

vi.mock('../src/services/context-explorer-git.service', () => ({ cleanupContextWorktree: vi.fn() }));

vi.mock('../src/services/credit-grant.service', () => ({
	recordOrganizationJoinCandidate: vi.fn(),
	recordProjectJoinCandidate: vi.fn(),
}));

import { putOrganizationMember, removeOrganizationMember } from '../src/services/membership.service';

describe('PostgreSQL organization admin guards', () => {
	beforeEach(() => {
		mocks.events.length = 0;
		mocks.adminCount = 2;
		mocks.deletes = 0;
	});

	it('locks the organization row before the last-admin delete', async () => {
		await removeOrganizationMember('org-1', 'user-1', { deleteSessions: true });

		expect(mocks.events).toEqual(['lock-org', 'delete-member', 'delete-project-members', 'delete-sessions']);
	});

	it('locks the organization row before the demotion guard reads the admin count', async () => {
		await putOrganizationMember('org-1', 'user-1', 'user');

		expect(mocks.events).toEqual(['lock-org', 'count-admins', 'update-role']);
	});

	it('refuses the demotion under the lock when the admin is the last one', async () => {
		mocks.adminCount = 1;

		await expect(putOrganizationMember('org-1', 'user-1', 'user')).rejects.toMatchObject({
			code: 400,
			message: 'The organization must have at least one admin.',
		});

		expect(mocks.events).toEqual(['lock-org', 'count-admins']);
	});
});

function transaction() {
	return {
		select: (selection?: Record<string, unknown>) => {
			const countsAdmins = selection !== undefined && 'count' in selection;
			const builder = {
				from: () => builder,
				where: () => builder,
				for: (_strength: string) => {
					mocks.events.push('lock-org');
					return builder;
				},
				execute: async () => {
					if (!countsAdmins) {
						return [{ id: 'org-1' }];
					}
					mocks.events.push('count-admins');
					return [{ count: mocks.adminCount }];
				},
			};
			return builder;
		},
		delete: () => {
			const builder = {
				where: () => builder,
				returning: () => builder,
				execute: async () => {
					mocks.deletes += 1;
					mocks.events.push(
						['delete-member', 'delete-project-members', 'delete-sessions'][mocks.deletes - 1],
					);
					return [{ id: 'deleted' }];
				},
			};
			return builder;
		},
		update: () => {
			const builder = {
				set: () => builder,
				where: () => builder,
				execute: async () => {
					mocks.events.push('update-role');
					return [];
				},
			};
			return builder;
		},
	};
}
