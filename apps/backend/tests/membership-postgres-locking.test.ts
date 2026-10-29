import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	events: [] as string[],
	adminCount: 2,
	deletes: 0,
	userDeleteRows: 1,
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

vi.mock('../src/queries/user.queries', () => ({
	getUser: async () => ({ id: 'user-1' }),
	confinedToOrganization: () => undefined,
}));

vi.mock('../src/services/context-explorer-git.service', () => ({ cleanupContextWorktree: vi.fn() }));

vi.mock('../src/services/credit-grant.service', () => ({
	recordOrganizationJoinCandidate: vi.fn(),
	recordProjectJoinCandidate: vi.fn(),
}));

import {
	deleteUserIfConfinedToOrganization,
	putOrganizationMember,
	removeOrganizationMember,
} from '../src/services/membership.service';

describe('PostgreSQL organization admin guards', () => {
	beforeEach(() => {
		mocks.events.length = 0;
		mocks.adminCount = 2;
		mocks.deletes = 0;
		mocks.userDeleteRows = 1;
	});

	it('locks the organization row before the last-admin delete', async () => {
		await removeOrganizationMember('org-1', 'user-1', { deleteSessions: true });

		expect(mocks.events).toEqual(['lock-org', 'delete-member', 'delete-project-members', 'delete-sessions']);
	});

	it('locks the user row before the purge delete, after the organization lock', async () => {
		await removeOrganizationMember('org-1', 'user-1', { deleteSessions: true, purgeAccount: true });

		expect(mocks.events).toEqual([
			'lock-org',
			'delete-member',
			'delete-project-members',
			'delete-sessions',
			'lock-user',
			'delete-user',
		]);
	});

	it('refuses the purge under the lock when the account is no longer confined', async () => {
		mocks.userDeleteRows = 0;

		await expect(removeOrganizationMember('org-1', 'user-1', { purgeAccount: true })).rejects.toMatchObject({
			code: 409,
			message: 'This user belongs to another organization: revoke without purge to keep the account.',
		});

		expect(mocks.events).toEqual([
			'lock-org',
			'delete-member',
			'delete-project-members',
			'lock-user',
			'delete-user',
		]);
	});

	it('locks the user row before the invite-cleanup delete', async () => {
		await expect(deleteUserIfConfinedToOrganization('user-1', 'org-1')).resolves.toBe(true);

		expect(mocks.events).toEqual(['lock-user', 'delete-user']);
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
			let locksUser = false;
			const builder = {
				from: (table?: Record<string, unknown>) => {
					locksUser = table !== undefined && 'email' in table;
					return builder;
				},
				where: () => builder,
				for: (_strength: string) => {
					mocks.events.push(locksUser ? 'lock-user' : 'lock-org');
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
		delete: (table?: Record<string, unknown>) => {
			const deletesUser = table !== undefined && 'email' in table;
			const builder = {
				where: () => builder,
				returning: () => builder,
				execute: async () => {
					if (deletesUser) {
						mocks.events.push('delete-user');
						return mocks.userDeleteRows ? [{ id: 'deleted' }] : [];
					}
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
