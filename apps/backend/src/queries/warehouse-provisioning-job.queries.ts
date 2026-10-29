import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, notInArray, or, type SQL, sql } from 'drizzle-orm';

import type { DBWarehouseProvisioningJob, NewWarehouseProvisioningJob } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { WarehouseProvisioningStatus } from '../types/warehouse';

export type WarehouseProvisioningJobChanges = Partial<
	Omit<
		NewWarehouseProvisioningJob,
		'id' | 'userId' | 'orgId' | 'projectName' | 'provider' | 'steps' | 'createdAt' | 'updatedAt'
	>
>;

export async function createWarehouseProvisioningJob(
	job: Omit<NewWarehouseProvisioningJob, 'steps'>,
): Promise<DBWarehouseProvisioningJob> {
	const [created] = await db
		.insert(s.warehouseProvisioningJob)
		.values({ ...job, steps: [{ status: job.status ?? 'queued', at: new Date().toISOString() }] })
		.returning()
		.execute();

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

export async function listStoppedSetupProjectIds(userId: string): Promise<string[]> {
	const jobs = await db
		.select({ projectId: s.warehouseProvisioningJob.projectId })
		.from(s.warehouseProvisioningJob)
		.where(
			and(
				eq(s.warehouseProvisioningJob.userId, userId),
				inArray(s.warehouseProvisioningJob.status, ['failed', 'cancelled']),
				isNotNull(s.warehouseProvisioningJob.projectId),
			),
		)
		.execute();

	return jobs.flatMap((job) => (job.projectId ? [job.projectId] : []));
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

export async function getLatestWarehouseProvisioningJob(
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
			),
		)
		.orderBy(desc(s.warehouseProvisioningJob.createdAt))
		.limit(1)
		.execute();

	return job ?? null;
}

/** Cancelled jobs are never updated again, so a worker still running one cannot bring it back to life. */
export async function updateWarehouseProvisioningJob(
	jobId: string,
	changes: WarehouseProvisioningJobChanges,
): Promise<DBWarehouseProvisioningJob | null> {
	const [updated] = await db
		.update(s.warehouseProvisioningJob)
		.set({ ...changes, ...(changes.status && { steps: appendStep(changes.status) }), updatedAt: new Date() })
		.where(and(eq(s.warehouseProvisioningJob.id, jobId), ne(s.warehouseProvisioningJob.status, 'cancelled')))
		.returning()
		.execute();

	return updated ?? null;
}

export async function cancelWarehouseProvisioningJob(
	jobId: string,
	error: string,
): Promise<DBWarehouseProvisioningJob | null> {
	const [cancelled] = await db
		.update(s.warehouseProvisioningJob)
		.set({
			status: 'cancelled',
			failedStatus: sql`${s.warehouseProvisioningJob.status}`,
			steps: appendStep('cancelled'),
			error,
			encryptedCredentials: null,
			finishedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(s.warehouseProvisioningJob.id, jobId),
				notInArray(s.warehouseProvisioningJob.status, ['ready', 'failed', 'cancelled']),
			),
		)
		.returning()
		.execute();

	return cancelled ?? null;
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

export async function clearFinishedWarehouseProvisioningCredentials(finishedBefore: Date): Promise<void> {
	await db
		.update(s.warehouseProvisioningJob)
		.set({ encryptedCredentials: null, updatedAt: new Date() })
		.where(
			and(
				inArray(s.warehouseProvisioningJob.status, ['failed', 'cancelled']),
				isNotNull(s.warehouseProvisioningJob.encryptedCredentials),
				lt(s.warehouseProvisioningJob.finishedAt, finishedBefore),
			),
		)
		.execute();
}

export async function listAbandonedCancelledWarehouseProvisioningJobs(
	staleBefore: Date,
): Promise<DBWarehouseProvisioningJob[]> {
	return db
		.select()
		.from(s.warehouseProvisioningJob)
		.where(
			and(
				eq(s.warehouseProvisioningJob.status, 'cancelled'),
				isNotNull(s.warehouseProvisioningJob.lockedAt),
				lt(s.warehouseProvisioningJob.lockedAt, staleBefore),
			),
		)
		.execute();
}

export async function clearWarehouseProvisioningJobLock(jobId: string): Promise<void> {
	await db
		.update(s.warehouseProvisioningJob)
		.set({ lockedBy: null, lockedAt: null, updatedAt: new Date() })
		.where(eq(s.warehouseProvisioningJob.id, jobId))
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

/** Appends to the stored steps within the update itself, so two workers updating the job cannot drop a step. */
function appendStep(status: WarehouseProvisioningStatus): SQL {
	const steps = s.warehouseProvisioningJob.steps;
	const at = new Date().toISOString();
	return dbConfig.dialect === Dialect.Postgres
		? sql`coalesce(${steps}, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', ${status}::text, 'at', ${at}::text))`
		: sql`json_insert(coalesce(${steps}, '[]'), '$[#]', json_object('status', ${status}, 'at', ${at}))`;
}
