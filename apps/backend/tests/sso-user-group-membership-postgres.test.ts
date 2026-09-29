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
	existingProviderProjectRows: [] as Array<{ projectId: string }>,
	existingGroupRows: [] as Array<{ groupId: string }>,
	lockedProjectIds: [] as string[],
	beforeProjectLock: vi.fn<() => void | Promise<void>>(),
}));

vi.mock('../src/db/dbConfig', () => ({
	Dialect: { Postgres: 'postgres', Sqlite: 'sqlite' },
	default: { dialect: 'postgres' },
}));

vi.mock('../src/db/db', () => ({
	db: {
		select: (selection: Record<string, unknown>) =>
			'projectMemberUserId' in selection ? query(mocks.mappingRows) : query([]),
		transaction: async (operation: (transaction: unknown) => Promise<void>) => operation(transaction()),
	},
}));

import {
	hasSsoUserGroupSyncState,
	reconcileSsoUserGroupMemberships,
} from '../src/queries/sso-user-group-membership.queries';

describe('PostgreSQL SSO membership reconciliation', () => {
	beforeEach(() => {
		mocks.events.length = 0;
		mocks.mappingRows = [
			{
				groupId: 'group-a',
				projectId: 'project-a',
				groupName: 'Group A',
				isDefault: false,
				ssoMappings: ssoMappings(['claim-a']),
				createdAt: new Date('2025-01-01'),
				projectMemberUserId: 'user-1',
				orgMemberUserId: null,
			},
			{
				groupId: 'group-c',
				projectId: 'project-c',
				groupName: 'Group C',
				isDefault: false,
				ssoMappings: ssoMappings(['claim-c']),
				createdAt: new Date('2025-01-01'),
				projectMemberUserId: 'user-1',
				orgMemberUserId: null,
			},
		];
		mocks.existingProviderProjectRows = [{ projectId: 'project-b' }];
		mocks.existingGroupRows = [];
		mocks.lockedProjectIds = [];
		mocks.beforeProjectLock.mockReset();
	});

	it('locks only matched and existing membership projects before replacing memberships', async () => {
		await reconcileSsoUserGroupMemberships('user-1', 'oidc', ['claim-a']);

		expect(mocks.lockedProjectIds).toEqual(['project-a', 'project-b']);
		expect(mocks.events).toEqual([
			'lock-user',
			'read-mappings',
			'read-existing-projects',
			'lock-projects',
			'read-mappings',
			'read-memberships',
			'insert-membership',
		]);
	});

	it('locks a matched project even when the user lacks project access', async () => {
		mocks.mappingRows = [mocks.mappingRows[0]!];
		mocks.mappingRows[0]!.projectMemberUserId = null;
		mocks.existingProviderProjectRows = [];

		await reconcileSsoUserGroupMemberships('user-1', 'oidc', ['claim-a']);

		expect(mocks.lockedProjectIds).toEqual(['project-a']);
		expect(mocks.events).toEqual([
			'lock-user',
			'read-mappings',
			'read-existing-projects',
			'lock-projects',
			'read-mappings',
			'read-memberships',
		]);
	});

	it('does not lock projects when there are no matches or existing memberships', async () => {
		mocks.existingProviderProjectRows = [];

		await reconcileSsoUserGroupMemberships('user-1', 'oidc', ['claim-missing']);

		expect(mocks.lockedProjectIds).toEqual([]);
		expect(mocks.events).toEqual([
			'lock-user',
			'read-mappings',
			'read-existing-projects',
			'read-mappings',
			'read-memberships',
		]);
	});

	it('does not treat an accessible unmapped group as SSO sync state', async () => {
		for (const mapping of mocks.mappingRows) {
			mapping.ssoMappings = ssoMappings([]);
		}

		await expect(hasSsoUserGroupSyncState('user-1', 'oidc')).resolves.toBe(false);
	});

	it('reads the new mapping when an admin update owns the project lock first', async () => {
		mocks.beforeProjectLock.mockImplementation(() => {
			mocks.events.push('admin-update');
			mocks.mappingRows = [];
		});

		await reconcileSsoUserGroupMemberships('user-1', 'oidc', ['claim-a']);

		expect(mocks.events).toEqual([
			'lock-user',
			'read-mappings',
			'read-existing-projects',
			'admin-update',
			'lock-projects',
			'read-mappings',
			'read-memberships',
		]);
	});
});

function transaction() {
	let lockSelectionCount = 0;
	return {
		select: (selection: Record<string, unknown>) => {
			if ('projectMemberUserId' in selection) {
				return query(mocks.mappingRows, () => mocks.events.push('read-mappings'));
			}
			if ('projectId' in selection) {
				return query(mocks.existingProviderProjectRows, () => mocks.events.push('read-existing-projects'));
			}
			if ('groupId' in selection) {
				return query(mocks.existingGroupRows, () => mocks.events.push('read-memberships'));
			}
			lockSelectionCount += 1;
			if (lockSelectionCount === 1) {
				return lockingQuery([{ id: 'user-1' }], async () => {
					mocks.events.push('lock-user');
				});
			}
			return lockingProjectQuery(async () => {
				await mocks.beforeProjectLock();
				mocks.events.push('lock-projects');
			});
		},
		delete: () => mutation(),
		insert: () => mutation(() => mocks.events.push('insert-membership')),
	};
}

function lockingProjectQuery(beforeExecute: () => Promise<void>) {
	const builder = lockingQuery([], beforeExecute);
	builder.where = (condition: unknown) => {
		mocks.lockedProjectIds = getInArrayValues(condition);
		return builder;
	};
	return builder;
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

function getInArrayValues(condition: unknown): string[] {
	const chunks = (condition as { queryChunks?: unknown[] }).queryChunks ?? [];
	const parameters = chunks.find((chunk): chunk is Array<{ value?: unknown }> => Array.isArray(chunk)) ?? [];
	return parameters.flatMap((parameter) => (typeof parameter.value === 'string' ? [parameter.value] : []));
}

function query(rows: unknown[], beforeExecute?: () => void) {
	const builder = {
		from: () => builder,
		innerJoin: () => builder,
		leftJoin: () => builder,
		where: () => builder,
		orderBy: () => builder,
		limit: () => builder,
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
