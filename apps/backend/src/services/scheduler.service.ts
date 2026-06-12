import { CronExpressionParser } from 'cron-parser';

import type { DBScheduledJob } from '../db/abstractSchema';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import { logger, serializeError } from '../utils/logger';

export type JobHandler<T = unknown> = (payload: T, job: DBScheduledJob) => Promise<void>;

const POLL_INTERVAL_MS = 30_000;
const RECLAIM_INTERVAL_MS = 60_000;
const LEASE_DURATION_MS = 10 * 60_000;
const CLAIM_BATCH_SIZE = 10;
const RETRY_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

const handlers = new Map<string, JobHandler>();
const instanceId = `worker-${crypto.randomUUID().slice(0, 8)}`;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let reclaimTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;

export function registerJob<T = unknown>(name: string, handler: JobHandler<T>): void {
	handlers.set(name, handler as JobHandler);
}

export interface EnsureRecurringInput {
	name: string;
	cron: string;
	uniqueKey: string;
	payload?: Record<string, unknown>;
	maxAttempts?: number;
	/** When the job already exists, reset its `runAt` to the next cron tick. */
	resetRunAtOnConflict?: boolean;
}

/**
 * Idempotently register a recurring job in the database. Safe to call on every
 * boot — the row is created once and refreshed in place if the cron expression
 * changes in code.
 */
export async function ensureRecurring(input: EnsureRecurringInput): Promise<void> {
	const runAt = nextCronTick(input.cron, new Date());
	if (!runAt) {
		throw new Error(`Invalid cron expression for job '${input.name}': ${input.cron}`);
	}
	await scheduledJobQueries.upsertRecurringJob({
		name: input.name,
		cron: input.cron,
		uniqueKey: input.uniqueKey,
		payload: input.payload,
		runAt,
		maxAttempts: input.maxAttempts,
		resetRunAtOnConflict: input.resetRunAtOnConflict,
	});
}

export interface EnqueueOnceInput {
	name: string;
	payload?: Record<string, unknown>;
	runAt?: Date;
	uniqueKey?: string;
	maxAttempts?: number;
}

export async function enqueueOnce(input: EnqueueOnceInput): Promise<void> {
	await scheduledJobQueries.enqueueOnceJob(input);
}

export function startScheduler(): void {
	if (pollTimer) {
		return;
	}

	void runPoll();
	pollTimer = setInterval(() => void runPoll(), POLL_INTERVAL_MS);
	pollTimer.unref?.();

	reclaimTimer = setInterval(() => void runReclaim(), RECLAIM_INTERVAL_MS);
	reclaimTimer.unref?.();
}

export function stopScheduler(): void {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
	if (reclaimTimer) {
		clearInterval(reclaimTimer);
		reclaimTimer = null;
	}
}

async function runPoll(): Promise<void> {
	if (pollInFlight) {
		return;
	}
	pollInFlight = true;
	try {
		const jobs = await scheduledJobQueries.claimDueJobs(new Date(), CLAIM_BATCH_SIZE, instanceId);
		await Promise.all(jobs.map((job) => executeJob(job)));
	} catch (err) {
		logger.error('Scheduler poll failed', { source: 'system', context: serializeError(err) });
	} finally {
		pollInFlight = false;
	}
}

async function runReclaim(): Promise<void> {
	try {
		const reclaimed = await scheduledJobQueries.reclaimStaleJobs(new Date(), LEASE_DURATION_MS);
		if (reclaimed > 0) {
			logger.warn(`Scheduler reclaimed ${reclaimed} stale job(s)`, { source: 'system' });
		}
	} catch (err) {
		logger.error('Scheduler reclaim failed', { source: 'system', context: serializeError(err) });
	}
}

async function executeJob(job: DBScheduledJob): Promise<void> {
	const handler = handlers.get(job.name);
	if (!handler) {
		await scheduledJobQueries.markJobFailed(job.id, `No handler registered for '${job.name}'`, null);
		logger.error(`Scheduler dropped job '${job.name}': no handler registered`, {
			source: 'system',
			context: { jobId: job.id, name: job.name },
		});
		return;
	}

	try {
		await handler(job.payload ?? {}, job);
		await onJobSuccess(job);
	} catch (err) {
		await onJobFailure(job, err);
	}
}

async function onJobSuccess(job: DBScheduledJob): Promise<void> {
	if (!job.cron) {
		await scheduledJobQueries.deleteJob(job.id);
		return;
	}
	const next = nextCronTick(job.cron, new Date());
	if (!next) {
		await scheduledJobQueries.markJobFailed(job.id, `Cron expression became invalid: ${job.cron}`, null);
		return;
	}
	await scheduledJobQueries.rescheduleJob(job.id, next);
}

async function onJobFailure(job: DBScheduledJob, err: unknown): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	logger.error(`Scheduler job '${job.name}' failed: ${message}`, {
		source: 'system',
		context: { jobId: job.id, name: job.name, attempts: job.attempts, error: serializeError(err) },
	});

	if (job.attempts >= job.maxAttempts) {
		if (job.cron) {
			const next = nextCronTick(job.cron, new Date());
			if (next) {
				await scheduledJobQueries.rescheduleJob(job.id, next);
				return;
			}
		}
		await scheduledJobQueries.markJobFailed(job.id, message, null);
		return;
	}

	const backoff = RETRY_BACKOFF_MS[Math.min(job.attempts - 1, RETRY_BACKOFF_MS.length - 1)];
	const nextRunAt = new Date(Date.now() + backoff);
	await scheduledJobQueries.markJobFailed(job.id, message, nextRunAt);
}

export function nextCronTick(cron: string, after: Date): Date | null {
	try {
		const interval = CronExpressionParser.parse(cron, { currentDate: after });
		return interval.next().toDate();
	} catch {
		return null;
	}
}
