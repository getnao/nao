import { CronExpressionParser } from 'cron-parser';
import { Effect } from 'effect';

import type { DBScheduledJob } from '../db/abstractSchema';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import { fromPromise, repeatInBackground } from '../utils/effect-runtime';
import { logger, serializeError } from '../utils/logger';
import { hasProjectCloudBillingAccess } from './cloud-billing-access.service';

export type JobHandler<T = unknown> = (payload: T, job: DBScheduledJob) => Promise<void>;
export type ProjectIdResolver<T = unknown> = (payload: T) => string | null | Promise<string | null>;

interface JobRegistration<T = unknown> {
	handler: JobHandler<T>;
	resolveProjectId?: ProjectIdResolver<T>;
}

interface RegisterJobOptions<T> {
	resolveProjectId?: ProjectIdResolver<T>;
}

const POLL_INTERVAL_MS = 30_000;
const RECLAIM_INTERVAL_MS = 60_000;
const LEASE_DURATION_MS = 10 * 60_000;
const CLAIM_BATCH_SIZE = 10;
const RETRY_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

const handlers = new Map<string, JobRegistration>();
const instanceId = `worker-${crypto.randomUUID().slice(0, 8)}`;

let stopLoops: (() => Promise<void>) | null = null;

export function registerJob<T = unknown>(
	name: string,
	handler: JobHandler<T>,
	options: RegisterJobOptions<T> = {},
): void {
	handlers.set(name, {
		handler: handler as JobHandler,
		resolveProjectId: options.resolveProjectId as ProjectIdResolver | undefined,
	});
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
	if (stopLoops) {
		return;
	}
	const stopPolling = repeatInBackground('Scheduler poll', pollDueJobs, POLL_INTERVAL_MS, { immediately: true });
	const stopReclaiming = repeatInBackground('Scheduler reclaim', reclaimStaleJobs, RECLAIM_INTERVAL_MS);
	stopLoops = async () => {
		await Promise.all([stopPolling(), stopReclaiming()]);
	};
}

/** Stops claiming jobs. The jobs already claimed still run to the end. */
export function stopScheduler(): Promise<void> {
	const stop = stopLoops;
	stopLoops = null;
	return stop ? stop() : Promise.resolve();
}

export async function __resetSchedulerForTesting(): Promise<void> {
	await stopScheduler();
	handlers.clear();
}

/** Uninterruptible, so that stopping the scheduler waits for the claimed jobs to be run and rescheduled. */
const pollDueJobs = Effect.gen(function* () {
	const jobs = yield* fromPromise(() => scheduledJobQueries.claimDueJobs(new Date(), CLAIM_BATCH_SIZE, instanceId));
	yield* Effect.forEach(jobs, runJob, { concurrency: 'unbounded', discard: true });
}).pipe(Effect.uninterruptible);

const reclaimStaleJobs = Effect.gen(function* () {
	const reclaimed = yield* fromPromise(() => scheduledJobQueries.reclaimStaleJobs(new Date(), LEASE_DURATION_MS));
	if (reclaimed > 0) {
		logger.warn(`Scheduler reclaimed ${reclaimed} stale job(s)`, { source: 'system' });
	}
});

function runJob(job: DBScheduledJob): Effect.Effect<void, unknown> {
	return fromPromise(() => executeJob(job)).pipe(
		Effect.withSpan('scheduler.job', {
			attributes: { 'job.id': job.id, 'job.name': job.name, 'job.attempts': job.attempts },
		}),
	);
}

async function executeJob(job: DBScheduledJob): Promise<void> {
	const registration = handlers.get(job.name);
	if (!registration) {
		const canRetry = job.attempts < job.maxAttempts;
		await scheduledJobQueries.markJobFailed(
			job.id,
			`No handler registered for '${job.name}'`,
			canRetry ? new Date(Date.now() + RECLAIM_INTERVAL_MS) : null,
		);
		logger.warn(`Scheduler ${canRetry ? 'deferred' : 'dropped'} job '${job.name}': no handler registered`, {
			source: 'system',
			context: { jobId: job.id, name: job.name },
		});
		return;
	}

	try {
		const payload = job.payload ?? {};
		const projectId = await registration.resolveProjectId?.(payload);
		if (projectId && !(await hasProjectCloudBillingAccess(projectId))) {
			logger.info(
				`Scheduler skipped job '${job.name}': the project is deactivated or its cloud billing access is restricted`,
				{
					source: 'system',
					context: { jobId: job.id, name: job.name, projectId },
				},
			);
			await onJobSuccess(job);
			return;
		}
		await registration.handler(payload, job);
		await onJobSuccess(job);
	} catch (err) {
		await onJobFailure(job, err);
	}
}

async function onJobSuccess(job: DBScheduledJob): Promise<void> {
	// Re-read the row: the cron may have been edited (or the job promoted to one-off)
	// while it was running, and the next run must reflect the current definition.
	const current = (await scheduledJobQueries.getJobById(job.id)) ?? job;
	if (!current.cron) {
		await scheduledJobQueries.deleteJob(current.id);
		return;
	}
	const next = nextCronTick(current.cron, new Date());
	if (!next) {
		await scheduledJobQueries.markJobFailed(current.id, `Cron expression became invalid: ${current.cron}`, null);
		return;
	}
	await scheduledJobQueries.rescheduleJob(current.id, next);
}

async function onJobFailure(job: DBScheduledJob, err: unknown): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	logger.error(`Scheduler job '${job.name}' failed: ${message}`, {
		source: 'system',
		context: { jobId: job.id, name: job.name, attempts: job.attempts, error: serializeError(err) },
	});

	if (job.attempts >= job.maxAttempts) {
		const cron = (await scheduledJobQueries.getJobById(job.id))?.cron ?? job.cron;
		if (cron) {
			const next = nextCronTick(cron, new Date());
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
