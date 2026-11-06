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

import { updateProjectColumnSecurity, updateProjectRowSecurity } from '../src/queries/user-group.queries';

describe('PostgreSQL project security updates', () => {
	beforeEach(() => {
		mocks.events.length = 0;
	});

	it('locks the project before reading or changing user groups', async () => {
		await updateProjectRowSecurity('project-1', { version: 1, tables: [] });

		expect(mocks.events).toEqual(['lock-project:update', 'lock-project', 'select-groups', 'update-project']);
	});

	it('uses the same project lock for column security updates', async () => {
		await updateProjectColumnSecurity('project-1', { version: 1, tables: [] });

		expect(mocks.events).toEqual(['lock-project:update', 'lock-project', 'select-groups', 'update-project']);
	});

	it('rejects a column security update based on a stale registry revision', async () => {
		await expect(
			updateProjectColumnSecurity(
				'project-1',
				{ version: 1, tables: [] },
				{
					version: 1,
					tables: [
						{
							databaseType: 'duckdb',
							database: 'analytics',
							schema: 'main',
							table: 'orders',
							restrictedColumns: ['cost'],
						},
					],
				},
			),
		).rejects.toMatchObject({
			code: 'CONFLICT',
			message:
				'Sensitive fields changed while they were being edited. Review the current settings and try again.',
		});

		expect(mocks.events).toEqual(['lock-project:update', 'lock-project']);
	});
});

function transaction() {
	return {
		select: (selection: Record<string, unknown>) =>
			'rowSecurity' in selection || 'columnSecurity' in selection
				? lockingQuery(
						[
							{
								id: 'project-1',
								rowSecurity: { version: 1, tables: [] },
								columnSecurity: { version: 1, tables: [] },
							},
						],
						'lock-project',
					)
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
