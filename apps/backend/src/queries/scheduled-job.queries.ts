import { and, eq, lte, sql } from 'drizzle-orm';

import s, { type DBScheduledJob, type NewScheduledJob } from '../db/abstractSchema';
import { db } from '../db/db';

export interface UpsertRecurringInput {
	name: string;
	cron: string;
	uniqueKey: string;
	payload?: Record<string, unknown>;
	runAt: Date;
	status?: DBScheduledJob['status'];
	maxAttempts?: number;
	resetRunAtOnConflict?: boolean;
}

/**
 * Idempotently register a recurring job. Safe to call on every boot: existing
 * rows keep their `runAt` and `attempts` so a restart does not reset the
 * cadence, but `cron` is refreshed so code-level changes propagate.
 */
export const upsertRecurringJob = async (input: UpsertRecurringInput): Promise<DBScheduledJob> => {
	const values: NewScheduledJob = {
		name: input.name,
		cron: input.cron,
		uniqueKey: input.uniqueKey,
		payload: input.payload,
		runAt: input.runAt,
		status: input.status,
		maxAttempts: input.maxAttempts,
	};
	const updateValues: Partial<NewScheduledJob> = {
		cron: input.cron,
		name: input.name,
		payload: input.payload,
	};
	if (input.status) {
		updateValues.status = input.status;
	}
	if (input.maxAttempts !== undefined) {
		updateValues.maxAttempts = input.maxAttempts;
	}
	if (input.resetRunAtOnConflict) {
		updateValues.runAt = input.runAt;
		updateValues.attempts = 0;
		updateValues.lastError = null;
		updateValues.lockedAt = null;
		updateValues.lockedBy = null;
	}

	const [row] = await db
		.insert(s.scheduledJob)
		.values(values)
		.onConflictDoUpdate({
			target: s.scheduledJob.uniqueKey,
			set: updateValues,
		})
		.returning()
		.execute();

	return row;
};

export interface EnqueueOnceInput {
	name: string;
	payload?: Record<string, unknown>;
	runAt?: Date;
	uniqueKey?: string;
	maxAttempts?: number;
}

export const enqueueOnceJob = async (input: EnqueueOnceInput): Promise<DBScheduledJob | null> => {
	const values: NewScheduledJob = {
		name: input.name,
		payload: input.payload,
		runAt: input.runAt ?? new Date(),
		uniqueKey: input.uniqueKey,
		maxAttempts: input.maxAttempts,
	};

	if (!input.uniqueKey) {
		const [row] = await db.insert(s.scheduledJob).values(values).returning().execute();
		return row;
	}

	const [row] = await db.insert(s.scheduledJob).values(values).onConflictDoNothing().returning().execute();
	return row ?? null;
};

/**
 * Claim up to `limit` due jobs and mark them `running`. Uses a select-then-update
 * pattern with optimistic concurrency: the `WHERE status='pending'` clause on
 * the UPDATE prevents two workers from claiming the same row. Cheaper than
 * `FOR UPDATE SKIP LOCKED` and works identically on SQLite and Postgres.
 */
export const claimDueJobs = async (now: Date, limit: number, lockedBy: string): Promise<DBScheduledJob[]> => {
	const candidates = await db
		.select({ id: s.scheduledJob.id })
		.from(s.scheduledJob)
		.where(and(eq(s.scheduledJob.status, 'pending'), lte(s.scheduledJob.runAt, now)))
		.orderBy(s.scheduledJob.runAt)
		.limit(limit)
		.execute();

	const claimed: DBScheduledJob[] = [];
	for (const { id } of candidates) {
		const [row] = await db
			.update(s.scheduledJob)
			.set({
				status: 'running',
				lockedAt: new Date(),
				lockedBy,
				attempts: sql`${s.scheduledJob.attempts} + 1`,
			})
			.where(and(eq(s.scheduledJob.id, id), eq(s.scheduledJob.status, 'pending')))
			.returning()
			.execute();
		if (row) {
			claimed.push(row);
		}
	}
	return claimed;
};

/**
 * Reclaim jobs that crashed mid-run. A worker that picks up a `running` row
 * whose lease is older than `leaseDurationMs` resets it to `pending`, leaving
 * the existing `attempts` count so retry budget is preserved.
 */
export const reclaimStaleJobs = async (now: Date, leaseDurationMs: number): Promise<number> => {
	const cutoff = new Date(now.getTime() - leaseDurationMs);
	const result = await db
		.update(s.scheduledJob)
		.set({ status: 'pending', lockedAt: null, lockedBy: null })
		.where(and(eq(s.scheduledJob.status, 'running'), lte(s.scheduledJob.lockedAt, cutoff)))
		.returning({ id: s.scheduledJob.id })
		.execute();
	return result.length;
};

export const deleteJob = async (id: string): Promise<void> => {
	await db.delete(s.scheduledJob).where(eq(s.scheduledJob.id, id)).execute();
};

export const deleteJobByUniqueKey = async (uniqueKey: string): Promise<void> => {
	await db.delete(s.scheduledJob).where(eq(s.scheduledJob.uniqueKey, uniqueKey)).execute();
};

export const rescheduleJob = async (id: string, runAt: Date): Promise<void> => {
	await db
		.update(s.scheduledJob)
		.set({
			status: 'pending',
			runAt,
			attempts: 0,
			lastError: null,
			lockedAt: null,
			lockedBy: null,
		})
		.where(eq(s.scheduledJob.id, id))
		.execute();
};

export const markJobFailed = async (id: string, error: string, nextRunAt: Date | null): Promise<void> => {
	await db
		.update(s.scheduledJob)
		.set({
			status: nextRunAt ? 'pending' : 'failed',
			runAt: nextRunAt ?? sql`${s.scheduledJob.runAt}`,
			lastError: error,
			lockedAt: null,
			lockedBy: null,
		})
		.where(eq(s.scheduledJob.id, id))
		.execute();
};
