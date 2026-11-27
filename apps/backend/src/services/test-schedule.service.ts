import { createHash } from 'node:crypto';

import type { DBScheduledJob } from '../db/abstractSchema';
import { getFirstProjectAdminUserId } from '../queries/context-recommendation.queries';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import type { TestSchedule, TestScheduleSettings } from '../types/test-run';
import { getTestScheduleCronError } from '../utils/cron';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger } from '../utils/logger';
import { extractConfiguredTestSettings } from '../utils/nao-config';
import { type JobScope, nextCronTick } from './scheduler.service';
import { startTestRun, TestRunInputError } from './test-runner.service';

export const TEST_SCHEDULE_JOB_NAME = 'test.scheduled-run';
export const TEST_SCHEDULE_SYNC_JOB_NAME = 'test.schedule-sync';

const MAX_APP_SCHEDULES = 10;
const CONFIG_SCHEDULE_ID_PREFIX = 'config-';

interface TestScheduleJobPayload extends Omit<TestScheduleSettings, 'cron'> {
	projectId: string;
	/** Who saved the schedule in the app, in whose name its runs start. A schedule of nao_config.yaml has none. */
	userId?: string;
	/**
	 * Kept with the schedule as well as in the status of its job, as the scheduler sets a job it is running back to
	 * pending whatever was asked meanwhile.
	 */
	isPaused?: boolean;
}

export class InvalidTestScheduleError extends Error {}

/**
 * The schedules of a project, each one kept as a recurring job so that they need no table of their own: the ones saved
 * in the app, then the ones of nao_config.yaml as it is now.
 */
export async function listTestSchedules(projectId: string, projectFolder: string): Promise<TestSchedule[]> {
	await syncConfiguredTestSchedules(projectId, projectFolder);
	const jobs = await listScheduleJobs(projectId);
	return jobs.map((job) => toTestSchedule(projectId, job));
}

export async function createTestSchedule(
	owner: { projectId: string; userId: string },
	settings: TestScheduleSettings,
): Promise<void> {
	const cronError = getTestScheduleCronError(settings.cron);
	if (cronError) {
		throw new InvalidTestScheduleError(cronError);
	}
	await withKeyedLock(`test-schedules:${owner.projectId}`, async () => {
		const jobs = await listScheduleJobs(owner.projectId);
		if (jobs.filter((job) => !isConfiguredSchedule(owner.projectId, job)).length >= MAX_APP_SCHEDULES) {
			throw new InvalidTestScheduleError(`A project has at most ${MAX_APP_SCHEDULES} schedules.`);
		}
		await saveScheduleJob(crypto.randomUUID(), { ...owner, ...settings });
	});
}

/** Changes when a schedule of the app runs and what it runs. It stays paused if it was, and keeps its owner. */
export async function updateTestSchedule(
	projectId: string,
	scheduleId: string,
	settings: TestScheduleSettings,
): Promise<void> {
	const job = await getAppScheduleJob(projectId, scheduleId);
	const cronError = getTestScheduleCronError(settings.cron);
	if (cronError) {
		throw new InvalidTestScheduleError(cronError);
	}
	await saveScheduleJob(scheduleId, { ...readPayload(job), ...settings }, isScheduleEnabled(job));
}

/** Pausing keeps the schedule, and resuming it waits for its next tick. */
export async function setTestScheduleEnabled(projectId: string, scheduleId: string, isEnabled: boolean): Promise<void> {
	const job = await getAppScheduleJob(projectId, scheduleId);
	await saveScheduleJob(scheduleId, { ...readPayload(job), cron: job.cron }, isEnabled);
}

export async function deleteTestSchedule(projectId: string, scheduleId: string): Promise<void> {
	if (scheduleId.startsWith(CONFIG_SCHEDULE_ID_PREFIX)) {
		throw new InvalidTestScheduleError('Remove this schedule from nao_config.yaml.');
	}
	await scheduledJobQueries.deleteJobByUniqueKey(scheduleJobKey(projectId, scheduleId));
}

/**
 * Starts the scheduled run on the production context, unless the schedule was paused while its job was running. A run
 * already in progress fails the job, which the scheduler retries a little later, while a schedule that matches no valid
 * test waits for its next tick.
 */
export async function runScheduledTests(payload: TestScheduleJobPayload): Promise<void> {
	if (payload.isPaused) {
		return;
	}
	const { projectId, tags, models, attempts } = payload;
	const userId = await resolveScheduleRunner(payload);
	try {
		await startTestRun({
			projectId,
			userId,
			tags,
			models: models ?? undefined,
			attempts: attempts ?? undefined,
			isScheduled: true,
		});
	} catch (error) {
		if (!(error instanceof TestRunInputError)) {
			throw error;
		}
		logger.warn(`Scheduled test run skipped: ${error.message}`, { source: 'system', projectId });
	}
}

export async function resolveTestScheduleScope(payload: TestScheduleJobPayload): Promise<JobScope> {
	return { projectId: payload.projectId, ownerId: await resolveScheduleRunner(payload) };
}

/** Picks up the schedules added to, or removed from, the nao_config.yaml of every project since the last sync. */
export async function syncAllConfiguredTestSchedules(): Promise<void> {
	for (const project of await projectQueries.listActiveProjectFolders()) {
		try {
			await syncConfiguredTestSchedules(project.id, project.path);
		} catch (error) {
			logger.error(`Could not sync the test schedules of nao_config.yaml: ${String(error)}`, {
				source: 'system',
				projectId: project.id,
			});
		}
	}
}

/** A configured schedule is identified by its content, so editing one replaces its job and the others keep their tick. */
async function syncConfiguredTestSchedules(projectId: string, projectFolder: string): Promise<void> {
	const configured = new Map(
		extractConfiguredTestSettings(projectFolder).schedules.map((schedule) => [
			scheduleJobKey(projectId, CONFIG_SCHEDULE_ID_PREFIX + hashSchedule(schedule)),
			schedule,
		]),
	);
	const jobs = (await listScheduleJobs(projectId)).filter((job) => isConfiguredSchedule(projectId, job));
	const scheduledKeys = new Set(jobs.map((job) => job.uniqueKey));

	for (const job of jobs.filter((scheduled) => !configured.has(scheduled.uniqueKey ?? ''))) {
		await scheduledJobQueries.deleteJob(job.id);
	}
	for (const [uniqueKey, schedule] of configured) {
		if (!scheduledKeys.has(uniqueKey)) {
			await saveScheduleJob(toScheduleId(projectId, uniqueKey), { projectId, ...schedule });
		}
	}
}

/** Who saved the schedule while they can still test the context, else a project admin, so the schedule outlives them. */
async function resolveScheduleRunner({ projectId, userId }: TestScheduleJobPayload): Promise<string> {
	const role = userId ? await projectQueries.getUserRoleInProject(projectId, userId) : null;
	return userId && (role === 'admin' || role === 'context_admin') ? userId : getFirstProjectAdminUserId(projectId);
}

async function getAppScheduleJob(projectId: string, scheduleId: string): Promise<DBScheduledJob & { cron: string }> {
	const job = await scheduledJobQueries.getJobByUniqueKey(scheduleJobKey(projectId, scheduleId));
	if (!job?.cron || isConfiguredSchedule(projectId, job)) {
		throw new InvalidTestScheduleError('This schedule cannot be changed in the app.');
	}
	return { ...job, cron: job.cron };
}

async function saveScheduleJob(
	scheduleId: string,
	schedule: TestScheduleJobPayload & { cron: string },
	isEnabled = true,
): Promise<void> {
	const { cron, ...payload } = schedule;
	const runAt = nextCronTick(cron, new Date());
	if (!runAt) {
		throw new InvalidTestScheduleError(`Invalid cron expression: ${cron}`);
	}
	await scheduledJobQueries.upsertRecurringJob({
		name: TEST_SCHEDULE_JOB_NAME,
		cron,
		uniqueKey: scheduleJobKey(payload.projectId, scheduleId),
		payload: { ...payload, isPaused: !isEnabled },
		runAt,
		status: isEnabled ? 'pending' : 'paused',
		resetRunAtOnConflict: true,
	});
}

async function listScheduleJobs(projectId: string): Promise<DBScheduledJob[]> {
	const jobs = await scheduledJobQueries.listJobsByUniqueKeyPrefix(scheduleJobKey(projectId, ''));
	return jobs.filter((job) => job.cron);
}

function toTestSchedule(projectId: string, job: DBScheduledJob): TestSchedule {
	const { tags, models, attempts } = readPayload(job);
	const isEnabled = isScheduleEnabled(job);
	return {
		id: toScheduleId(projectId, job.uniqueKey ?? ''),
		source: isConfiguredSchedule(projectId, job) ? 'config' : 'app',
		cron: job.cron ?? '',
		isEnabled,
		tags,
		models,
		attempts,
		nextRunAt: isEnabled ? job.runAt : null,
	};
}

function isScheduleEnabled(job: DBScheduledJob): boolean {
	return job.status !== 'paused' && !readPayload(job).isPaused;
}

function readPayload(job: DBScheduledJob): TestScheduleJobPayload {
	return job.payload as unknown as TestScheduleJobPayload;
}

function isConfiguredSchedule(projectId: string, job: DBScheduledJob): boolean {
	return toScheduleId(projectId, job.uniqueKey ?? '').startsWith(CONFIG_SCHEDULE_ID_PREFIX);
}

function scheduleJobKey(projectId: string, scheduleId: string): string {
	return `test-schedule:${projectId}:${scheduleId}`;
}

function toScheduleId(projectId: string, uniqueKey: string): string {
	return uniqueKey.slice(scheduleJobKey(projectId, '').length);
}

function hashSchedule(schedule: TestScheduleSettings): string {
	return createHash('sha256').update(JSON.stringify(schedule)).digest('hex').slice(0, 16);
}
