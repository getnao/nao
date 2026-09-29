import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const selectBuilder = {
		execute: vi.fn(),
		from: vi.fn(),
		innerJoin: vi.fn(),
		limit: vi.fn(),
		where: vi.fn(),
	};
	const insertBuilder = {
		execute: vi.fn(),
		onConflictDoNothing: vi.fn(),
		values: vi.fn(),
	};

	for (const method of ['from', 'innerJoin', 'limit', 'where'] as const) {
		selectBuilder[method].mockReturnValue(selectBuilder);
	}
	insertBuilder.values.mockReturnValue(insertBuilder);
	insertBuilder.onConflictDoNothing.mockReturnValue(insertBuilder);

	return {
		db: {
			insert: vi.fn().mockReturnValue(insertBuilder),
			select: vi.fn().mockReturnValue(selectBuilder),
		},
		insertBuilder,
		selectBuilder,
	};
});

vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	and: vi.fn(),
	eq: vi.fn(),
}));
vi.mock('../src/db/abstractSchema', () => ({
	default: {
		organization: { id: 'organization.id' },
		orgMember: {
			createdAt: 'orgMember.createdAt',
			orgId: 'orgMember.orgId',
			role: 'orgMember.role',
			userId: 'orgMember.userId',
		},
	},
}));
vi.mock('../src/db/db', () => ({ db: mocks.db }));
vi.mock('../src/env', () => ({ env: { DEFAULT_USER_ROLE: 'viewer' } }));
vi.mock('../src/queries/project.queries', () => ({}));
vi.mock('../src/queries/user.queries', () => ({}));

import { addUserToDefaultOrganizationIfExists } from '../src/queries/organization.queries';

beforeEach(() => {
	mocks.db.insert.mockClear();
	mocks.db.select.mockClear();
	mocks.insertBuilder.execute.mockReset().mockResolvedValue([]);
	mocks.insertBuilder.onConflictDoNothing.mockClear();
	mocks.insertBuilder.values.mockClear();
	mocks.selectBuilder.execute.mockReset();
});

describe('addUserToDefaultOrganizationIfExists', () => {
	it('adds an orphaned user to the default organization', async () => {
		mocks.selectBuilder.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'org-1' }]);

		await addUserToDefaultOrganizationIfExists('user-1');

		expect(mocks.insertBuilder.values).toHaveBeenCalledWith({
			orgId: 'org-1',
			userId: 'user-1',
			role: 'viewer',
		});
		expect(mocks.insertBuilder.onConflictDoNothing).toHaveBeenCalledOnce();
	});

	it('leaves an existing organization membership unchanged', async () => {
		const membership = {
			orgId: 'other-org',
			userId: 'user-1',
			role: 'admin',
			organization: { id: 'other-org' },
		};
		mocks.selectBuilder.execute.mockResolvedValue([membership]);

		await addUserToDefaultOrganizationIfExists('user-1');
		await addUserToDefaultOrganizationIfExists('user-1');

		expect(mocks.db.insert).not.toHaveBeenCalled();
		expect(mocks.insertBuilder.values).not.toHaveBeenCalled();
		expect(membership.role).toBe('admin');
	});

	it('does nothing when the default organization does not exist', async () => {
		mocks.selectBuilder.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

		await addUserToDefaultOrganizationIfExists('user-1');

		expect(mocks.db.insert).not.toHaveBeenCalled();
	});
});
