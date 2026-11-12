import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	buildToolContext: vi.fn(),
	executeRawSql: vi.fn(),
	resolveExcludedColumnEnforcement: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
}));

vi.mock('../../src/services/agent', () => ({ buildToolContext: mocks.buildToolContext }));
vi.mock('../../src/services/live-story', () => ({ executeRawSql: mocks.executeRawSql }));
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));
vi.mock('../../src/services/excluded-columns.service', () => ({
	resolveExcludedColumnEnforcement: mocks.resolveExcludedColumnEnforcement,
}));

import { CustomStorySqlError, runCustomStorySql } from '../../src/services/custom-story-sql';
import { WarehouseSqlError } from '../../src/services/warehouse-sql.service';

const TARGET = { projectId: 'project-1', chatId: 'chat-1', viewerId: 'viewer-1' };
const VIEWER_CONTEXT = {
	projectId: 'project-1',
	userId: 'viewer-1',
	semanticLayerMode: null,
	agentSettings: null,
	warehouseTableAccess: { allowedTables: ['sales.orders'] },
};

describe('runCustomStorySql', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.buildToolContext.mockResolvedValue(VIEWER_CONTEXT);
		mocks.resolveExcludedColumnEnforcement.mockResolvedValue(true);
		mocks.executeRawSql.mockResolvedValue({ columns: ['n'], data: [{ n: 1 }], sqlQuery: 'ignored' });
	});

	it('runs the SQL with the viewer’s own permissions, not the story owner’s', async () => {
		const result = await runCustomStorySql(TARGET, { sql: 'SELECT 1 AS n', databaseId: 'warehouse' });

		expect(result).toEqual({ columns: ['n'], data: [{ n: 1 }] });
		expect(mocks.buildToolContext).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'viewer-1',
			chatId: 'chat-1',
		});
		expect(mocks.executeRawSql).toHaveBeenCalledWith('SELECT 1 AS n', {
			executionContext: { toolContext: VIEWER_CONTEXT, enforceExcludedColumns: true },
			databaseId: 'warehouse',
			billingAccessVerifiedProjectId: 'project-1',
		});
		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
	});

	it('renders the filter blocks of the SQL with the quoted values the story sent', async () => {
		const sql =
			'SELECT * FROM orders WHERE 1 = 1 {% filter status %} AND status = {{ filters.status.sql }} {% endfilter %}';

		await runCustomStorySql(TARGET, { sql, filters: { status: "it's" } });
		await runCustomStorySql(TARGET, { sql, filters: { status: null } });

		expect(mocks.executeRawSql.mock.calls[0][0]).toContain("AND status = 'it''s'");
		expect(mocks.executeRawSql.mock.calls[1][0]).not.toContain('AND status');
	});

	it.each([
		['writes', 'DELETE FROM orders'],
		['DDL', 'DROP TABLE orders'],
		['server passthrough calls', "SELECT * FROM postgres_query('db', 'SELECT 1')"],
	])('rejects %s before reaching the warehouse', async (_label, sql) => {
		await expect(runCustomStorySql(TARGET, { sql })).rejects.toBeInstanceOf(CustomStorySqlError);
		expect(mocks.executeRawSql).not.toHaveBeenCalled();
	});

	it('rejects the local database, which reads files rather than the warehouse', async () => {
		await expect(
			runCustomStorySql(TARGET, { sql: 'SELECT 1', databaseId: LOCAL_DATABASE_ID }),
		).rejects.toBeInstanceOf(CustomStorySqlError);
		expect(mocks.buildToolContext).not.toHaveBeenCalled();
	});

	it('rejects raw SQL when the project only allows the semantic layer', async () => {
		mocks.buildToolContext.mockResolvedValue({ ...VIEWER_CONTEXT, semanticLayerMode: 'exclusive' });

		await expect(runCustomStorySql(TARGET, { sql: 'SELECT 1' })).rejects.toThrow(/semantic|disabled/i);
		expect(mocks.executeRawSql).not.toHaveBeenCalled();
	});

	it('surfaces warehouse denials as story errors', async () => {
		mocks.executeRawSql.mockRejectedValue(
			new WarehouseSqlError(403, 'Access to table hr.salaries is not allowed.'),
		);

		await expect(runCustomStorySql(TARGET, { sql: 'SELECT * FROM hr.salaries' })).rejects.toThrow(
			new CustomStorySqlError('Access to table hr.salaries is not allowed.'),
		);
	});

	it('keeps billing and infrastructure failures out of the story, with their own error', async () => {
		const billingError = new Error('Your subscription has ended.');
		mocks.assertProjectCloudBillingAccess.mockRejectedValueOnce(billingError);
		await expect(runCustomStorySql(TARGET, { sql: 'SELECT 1' })).rejects.toBe(billingError);
		expect(mocks.executeRawSql).not.toHaveBeenCalled();

		const outage = new TypeError('fetch failed');
		mocks.executeRawSql.mockRejectedValueOnce(outage);
		await expect(runCustomStorySql(TARGET, { sql: 'SELECT 1' })).rejects.toBe(outage);
	});
});
