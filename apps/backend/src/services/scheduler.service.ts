import { CronExpressionParser } from 'cron-parser';

import type { DBScheduledJob } from '../db/abstractSchema';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
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

let pollTimer: ReturnType<typeof setInterval> | null = null;
let reclaimTimer: ReturnType<typeof setInterval> | null = null;
let activePoll: Promise<void> | null = null;

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

export async function __resetSchedulerForTesting(): Promise<void> {
	stopScheduler();
	await activePoll;
	handlers.clear();
}

function runPoll(): Promise<void> {
	if (!activePoll) {
		activePoll = executePoll().finally(() => {
			activePoll = null;
		});
	}
	return activePoll;
}

async function executePoll(): Promise<void> {
	try {
		const jobs = await scheduledJobQueries.claimDueJobs(new Date(), CLAIM_BATCH_SIZE, instanceId);
		await Promise.all(jobs.map((job) => executeJob(job)));
	} catch (err) {
		logger.error('Scheduler poll failed', { source: 'system', context: serializeError(err) });
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
			logger.info(`Scheduler skipped job '${job.name}': cloud billing access is restricted`, {
				source: 'system',
				context: { jobId: job.id, name: job.name, projectId },
			});
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
