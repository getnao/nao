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
		transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation(transaction()),
	},
}));

import { updateProjectRowSecurity } from '../src/queries/user-group.queries';

describe('PostgreSQL project row security updates', () => {
	beforeEach(() => {
		mocks.events.length = 0;
	});

	it('locks the project before reading or changing user groups', async () => {
		await updateProjectRowSecurity('project-1', { version: 1, tables: [] });

		expect(mocks.events).toEqual(['lock-project:update', 'lock-project', 'select-groups', 'update-project']);
	});
});

function transaction() {
	return {
		select: (selection: Record<string, unknown>) =>
			'rowSecurity' in selection
				? lockingQuery([{ id: 'project-1', rowSecurity: { version: 1, tables: [] } }], 'lock-project')
				: eventQuery([], 'select-groups'),
		update: () => mutation('update-project'),
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

function lockingQuery(rows: unknown[], event: string) {
	const builder = query(rows);
	builder.for = (strength: string) => {
		mocks.events.push(`${event}:${strength}`);
		builder.execute = vi.fn(async () => {
			mocks.events.push(event);
			return rows;
		});
		return builder;
	};
	return builder;
}

function eventQuery(rows: unknown[], event: string) {
	const builder = query(rows);
	builder.execute = vi.fn(async () => {
		mocks.events.push(event);
		return rows;
	});
	return builder;
}

function mutation(event: string) {
	const builder = {
		set: () => builder,
		where: () => builder,
		execute: vi.fn(async () => {
			mocks.events.push(event);
		}),
	};
	return builder;
}
