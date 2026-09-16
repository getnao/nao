import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	events: [] as string[],
	mappingRows: [] as Array<{
		groupId: string;
		projectId: string;
		groupName: string;
		isDefault: boolean;
		ssoMappings: ReturnType<typeof ssoMappings>;
		createdAt: Date;
		projectMemberUserId: string | null;
		orgMemberUserId: string | null;
	}>,
	beforeProjectLock: vi.fn<() => void | Promise<void>>(),
}));

vi.mock('../src/db/dbConfig', () => ({
	Dialect: { Postgres: 'postgres', Sqlite: 'sqlite' },
	default: { dialect: 'postgres' },
}));

vi.mock('../src/db/db', () => ({
	db: {
		transaction: async (operation: (transaction: unknown) => Promise<void>) => operation(transaction()),
	},
}));

import { reconcileSsoUserGroupMemberships } from '../src/queries/sso-user-group-membership.queries';

describe('PostgreSQL SSO membership reconciliation', () => {
	beforeEach(() => {
		mocks.events.length = 0;
		mocks.mappingRows = [
			{
				groupId: 'group-a',
				projectId: 'project-1',
				groupName: 'Group A',
				isDefault: false,
				ssoMappings: ssoMappings(['claim-a']),
				createdAt: new Date('2025-01-01'),
				projectMemberUserId: 'user-1',
				orgMemberUserId: null,
			},
		];
		mocks.beforeProjectLock.mockReset();
	});

	it('locks the user and projects before reading mappings and replacing memberships', async () => {
		await reconcileSsoUserGroupMemberships('user-1', 'oidc', ['claim-a']);

		expect(mocks.events).toEqual([
			'lock-user',
			'list-projects',
			'lock-projects',
			'read-mappings',
			'read-memberships',
			'insert-membership',
		]);
	});

	it('reads the new mapping when an admin update owns the project lock first', async () => {
		mocks.beforeProjectLock.mockImplementation(() => {
			mocks.events.push('admin-update');
			mocks.mappingRows = [];
		});

		await reconcileSsoUserGroupMemberships('user-1', 'oidc', ['claim-a']);

		expect(mocks.events).toEqual([
			'lock-user',
			'list-projects',
			'admin-update',
			'lock-projects',
			'read-mappings',
			'read-memberships',
		]);
	});
});

function transaction() {
	let selectCount = 0;
	return {
		select: () => {
			selectCount += 1;
			if (selectCount === 1) {
				return lockingQuery([{ id: 'user-1' }], async () => {
					mocks.events.push('lock-user');
				});
			}
			if (selectCount === 2) {
				return query([{ id: 'project-1' }], () => mocks.events.push('list-projects'));
			}
			if (selectCount === 3) {
				return lockingQuery([{ id: 'project-1' }], async () => {
					await mocks.beforeProjectLock();
					mocks.events.push('lock-projects');
				});
			}
			if (selectCount === 4) {
				return query(mocks.mappingRows, () => mocks.events.push('read-mappings'));
			}
			return query([], () => mocks.events.push('read-memberships'));
		},
		delete: () => mutation(),
		insert: () => mutation(() => mocks.events.push('insert-membership')),
	};
}

function lockingQuery(rows: unknown[], beforeExecute: () => Promise<void>) {
	const builder = query(rows);
	builder.for = () => {
		builder.execute = vi.fn(async () => {
			await beforeExecute();
			return rows;
		});
		return builder;
	};
	return builder;
}

function query(rows: unknown[], beforeExecute?: () => void) {
	const builder = {
		from: () => builder,
		innerJoin: () => builder,
		leftJoin: () => builder,
		where: () => builder,
		orderBy: () => builder,
		for: (_strength: string) => builder,
		execute: vi.fn(async () => {
			beforeExecute?.();
			return rows;
		}),
	};
	return builder;
}

function mutation(beforeExecute?: () => void) {
	const builder = {
		values: () => builder,
		where: () => builder,
		onConflictDoNothing: () => builder,
		execute: vi.fn(async () => {
			beforeExecute?.();
		}),
	};
	return builder;
}

function ssoMappings(oidc: string[]) {
	return {
		version: 1,
		providers: {
			oidc,
			microsoft: [],
		},
	};
}
