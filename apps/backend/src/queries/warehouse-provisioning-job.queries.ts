import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';

import type { DBWarehouseProvisioningJob, NewWarehouseProvisioningJob } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { WarehouseProvisioningStatus } from '../types/warehouse';

export type WarehouseProvisioningJobChanges = Partial<
	Omit<
		NewWarehouseProvisioningJob,
		'id' | 'userId' | 'orgId' | 'projectName' | 'provider' | 'createdAt' | 'updatedAt'
	>
>;

export async function createWarehouseProvisioningJob(
	job: NewWarehouseProvisioningJob,
): Promise<DBWarehouseProvisioningJob> {
	const [created] = await db.insert(s.warehouseProvisioningJob).values(job).returning().execute();

	return created;
}

export async function getWarehouseProvisioningJob(
	jobId: string,
	userId: string,
): Promise<DBWarehouseProvisioningJob | null> {
	const [job] = await db
		.select()
		.from(s.warehouseProvisioningJob)
		.where(and(eq(s.warehouseProvisioningJob.id, jobId), eq(s.warehouseProvisioningJob.userId, userId)))
		.execute();

	return job ?? null;
}

export async function getWarehouseProvisioningJobById(jobId: string): Promise<DBWarehouseProvisioningJob | null> {
	const [job] = await db
		.select()
		.from(s.warehouseProvisioningJob)
		.where(eq(s.warehouseProvisioningJob.id, jobId))
		.execute();

	return job ?? null;
}

export async function getActiveWarehouseProvisioningJobByUser(
	userId: string,
): Promise<DBWarehouseProvisioningJob | null> {
	const [job] = await db
		.select()
		.from(s.warehouseProvisioningJob)
		.where(
			and(
				eq(s.warehouseProvisioningJob.userId, userId),
				notInArray(s.warehouseProvisioningJob.status, ['ready', 'failed', 'cancelled']),
			),
		)
		.orderBy(desc(s.warehouseProvisioningJob.createdAt))
		.limit(1)
		.execute();

	return job ?? null;
}

export async function getLatestWarehouseProvisioningJobByUser(
	userId: string,
): Promise<DBWarehouseProvisioningJob | null> {
	const [job] = await db
		.select()
		.from(s.warehouseProvisioningJob)
		.where(eq(s.warehouseProvisioningJob.userId, userId))
		.orderBy(desc(s.warehouseProvisioningJob.createdAt))
		.limit(1)
		.execute();

	return job ?? null;
}

export async function getActiveWarehouseProvisioningJob(
	userId: string,
	onboardingChatId: string,
): Promise<DBWarehouseProvisioningJob | null> {
	const [job] = await db
		.select()
		.from(s.warehouseProvisioningJob)
		.where(
			and(
				eq(s.warehouseProvisioningJob.userId, userId),
				eq(s.warehouseProvisioningJob.onboardingChatId, onboardingChatId),
				notInArray(s.warehouseProvisioningJob.status, ['ready', 'failed', 'cancelled']),
			),
		)
		.orderBy(desc(s.warehouseProvisioningJob.createdAt))
		.limit(1)
		.execute();

	return job ?? null;
}

export async function updateWarehouseProvisioningJob(
	jobId: string,
	changes: WarehouseProvisioningJobChanges,
): Promise<DBWarehouseProvisioningJob | null> {
	const [updated] = await db
		.update(s.warehouseProvisioningJob)
		.set({ ...changes, updatedAt: new Date() })
		.where(eq(s.warehouseProvisioningJob.id, jobId))
		.returning()
		.execute();

	return updated ?? null;
}

export async function claimWarehouseProvisioningJob(
	jobId: string,
	workerId: string,
	statuses: WarehouseProvisioningStatus[],
	staleBefore: Date,
): Promise<DBWarehouseProvisioningJob | null> {
	const [job] = await db
		.update(s.warehouseProvisioningJob)
		.set({
			lockedBy: workerId,
			lockedAt: new Date(),
			attempts: sql`${s.warehouseProvisioningJob.attempts} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(s.warehouseProvisioningJob.id, jobId),
				inArray(s.warehouseProvisioningJob.status, statuses),
				or(isNull(s.warehouseProvisioningJob.lockedAt), lt(s.warehouseProvisioningJob.lockedAt, staleBefore)),
			),
		)
		.returning()
		.execute();

	return job ?? null;
}

export async function renewWarehouseProvisioningJobLock(jobId: string, workerId: string): Promise<boolean> {
	const [job] = await db
		.update(s.warehouseProvisioningJob)
		.set({ lockedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(s.warehouseProvisioningJob.id, jobId), eq(s.warehouseProvisioningJob.lockedBy, workerId)))
		.returning({ id: s.warehouseProvisioningJob.id })
		.execute();

	return Boolean(job);
}

export async function releaseWarehouseProvisioningJobLock(jobId: string, workerId: string): Promise<void> {
	await db
		.update(s.warehouseProvisioningJob)
		.set({ lockedBy: null, lockedAt: null, updatedAt: new Date() })
		.where(and(eq(s.warehouseProvisioningJob.id, jobId), eq(s.warehouseProvisioningJob.lockedBy, workerId)))
		.execute();
}

export async function listRecoverableWarehouseProvisioningJobs(
	statuses: WarehouseProvisioningStatus[],
	staleBefore: Date,
): Promise<DBWarehouseProvisioningJob[]> {
	return db
		.select()
		.from(s.warehouseProvisioningJob)
		.where(
			and(
				inArray(s.warehouseProvisioningJob.status, statuses),
				or(isNull(s.warehouseProvisioningJob.lockedAt), lt(s.warehouseProvisioningJob.lockedAt, staleBefore)),
			),
		)
		.execute();
}
