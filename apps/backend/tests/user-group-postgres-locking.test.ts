import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	events: [] as string[],
}));

vi.mock('../src/db/dbConfig', () => ({
	Dialect: { Postgres: 'postgres', Sqlite: 'sqlite' },
	default: { dialect: 'postgres' },
}));

vi.mock('../src/queries/project.queries', () => ({
	listUsersWithProjectAccess: vi.fn(),
	listUsersWithProjectAccessDetails: vi.fn(),
}));

vi.mock('../src/db/db', () => ({
	db: {
		select: () => query([storedGroup()]),
		transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation(transaction()),
	},
}));

import { updateUserGroup } from '../src/queries/user-group.queries';

describe('PostgreSQL SSO mapping updates', () => {
	beforeEach(() => {
		mocks.events.length = 0;
	});

	it('locks the project before changing mappings and deleting memberships', async () => {
		await updateUserGroup('project-1', 'group-1', {
			featureGrants: [],
			ssoMappings: ssoMappings([]),
		});

		expect(mocks.events).toEqual(['lock-project', 'update-mapping', 'delete-memberships']);
	});
});

function transaction() {
	return {
		select: () => lockingQuery([{ id: 'project-1' }], () => mocks.events.push('lock-project')),
		update: () => mutation([storedGroup(ssoMappings([]))], () => mocks.events.push('update-mapping')),
		delete: () => mutation(undefined, () => mocks.events.push('delete-memberships')),
	};
}

function query(rows: unknown[]) {
	const builder = {
		from: () => builder,
		where: () => builder,
		limit: () => builder,
		for: (_strength: string) => builder,
		execute: vi.fn(async () => rows),
	};
	return builder;
}

function lockingQuery(rows: unknown[], beforeExecute: () => void) {
	const builder = query(rows);
	builder.for = () => {
		builder.execute = vi.fn(async () => {
			beforeExecute();
			return rows;
		});
		return builder;
	};
	return builder;
}

function mutation(rows: unknown, beforeExecute: () => void) {
	const builder = {
		set: () => builder,
		where: () => builder,
		returning: () => builder,
		execute: vi.fn(async () => {
			beforeExecute();
			return rows;
		}),
	};
	return builder;
}

function storedGroup(mappings = ssoMappings(['finance'])) {
	return {
		id: 'group-1',
		projectId: 'project-1',
		name: 'Finance',
		isDefault: false,
		featureGrants: {
			version: 2,
			features: [],
			toolCallDensity: { defaultDensity: 'detailed', canChange: true },
		},
		contextGrants: null,
		ssoMappings: mappings,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
	};
}

function ssoMappings(oidc: string[]) {
	return {
		version: 1 as const,
		providers: {
			oidc,
			microsoft: [],
		},
	};
}
