import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
	const sqliteSchema = await import('../src/db/sqlite-schema');
	const sqlite = new Database(':memory:');
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	for (const statement of statements) {
		sqlite.exec(statement);
	}
	return { db: drizzle(sqlite, { schema: sqliteSchema }) };
});

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	cancelWarehouseProvisioningJob,
	claimWarehouseProvisioningJob,
	createWarehouseProvisioningJob,
	getWarehouseProvisioningJobById,
	updateWarehouseProvisioningJob,
} from '../src/queries/warehouse-provisioning-job.queries';

const JOB_ID = 'job-1';

beforeEach(async () => {
	await db.delete(s.warehouseProvisioningJob);
	await db.delete(s.organization);
	await db.delete(s.user);
	await db.insert(s.user).values({ id: 'user-1', name: 'User', email: 'user@example.com' });
	await db.insert(s.organization).values({ id: 'org-1', name: 'Org', slug: 'org' });
	await createWarehouseProvisioningJob({
		id: JOB_ID,
		userId: 'user-1',
		orgId: 'org-1',
		projectName: 'analytics',
		provider: 'postgres',
		status: 'queued',
	});
});

describe('warehouse provisioning job steps', () => {
	it('records every status the job goes through, in order', async () => {
		await updateWarehouseProvisioningJob(JOB_ID, { status: 'initializing' });
		await updateWarehouseProvisioningJob(JOB_ID, { logs: 'Running nao init' });
		await updateWarehouseProvisioningJob(JOB_ID, { status: 'debugging', logs: '' });
		await cancelWarehouseProvisioningJob(JOB_ID, 'Cancelled');

		const job = await getWarehouseProvisioningJobById(JOB_ID);

		expect(job?.steps?.map((step) => step.status)).toEqual(['queued', 'initializing', 'debugging', 'cancelled']);
		expect(job?.steps?.every((step) => !Number.isNaN(Date.parse(step.at)))).toBe(true);
	});

	it('records the worker attempt that reached each step', async () => {
		await updateWarehouseProvisioningJob(JOB_ID, { status: 'syncing' });
		await claimWarehouseProvisioningJob(JOB_ID, 'worker-2', ['syncing'], new Date());
		await updateWarehouseProvisioningJob(JOB_ID, { status: 'queued' });
		await updateWarehouseProvisioningJob(JOB_ID, { status: 'awaiting_context', attempts: 0 });

		const job = await getWarehouseProvisioningJobById(JOB_ID);

		expect(job?.steps?.map(({ status, attempt }) => ({ status, attempt }))).toEqual([
			{ status: 'queued', attempt: 0 },
			{ status: 'syncing', attempt: 0 },
			{ status: 'queued', attempt: 1 },
			{ status: 'awaiting_context', attempt: 0 },
		]);
	});

	it('keeps the steps of a job created before they were recorded', async () => {
		await db.update(s.warehouseProvisioningJob).set({ steps: null });

		await updateWarehouseProvisioningJob(JOB_ID, { status: 'failed', errorDetail: 'nao init failed: boom' });

		expect(await getWarehouseProvisioningJobById(JOB_ID)).toMatchObject({
			status: 'failed',
			errorDetail: 'nao init failed: boom',
			steps: [{ status: 'failed', at: expect.any(String), attempt: 0 }],
		});
	});
});
