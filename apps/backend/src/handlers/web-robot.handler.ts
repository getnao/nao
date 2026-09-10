import { emptyWebRobotRunStats } from '@nao/shared/web-robot';

import type { DBScheduledJob, DBWebRobotRun } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import * as webRobotQueries from '../queries/web-robot.queries';
import { publishWebRobotRunArtifacts } from '../services/web-robot-artifacts';
import { runWebRobotRecipe } from '../services/web-scraper';
import { logger, serializeError } from '../utils/logger';

export const WEB_ROBOT_JOB_NAME = 'web_robot.run';
export const webRobotJobUniqueKey = (robotId: string): string => `web_robot:${robotId}`;

type WebRobotJobPayload = {
	webRobotId?: string;
	runId?: string;
};

const activeRuns = new Map<string, AbortController>();

export const requestWebRobotCancellation = (runId: string): void => {
	activeRuns.get(runId)?.abort();
};

export const webRobotRunJob = async (payload: WebRobotJobPayload, job: DBScheduledJob): Promise<void> => {
	if (!payload.webRobotId) {
		throw new Error('Web robot job is missing webRobotId');
	}

	const robot = await webRobotQueries.getWebRobotById(payload.webRobotId);
	if (!robot) {
		throw new Error(`Web robot not found: ${payload.webRobotId}`);
	}

	await webRobotQueries.failStaleWebRobotRuns();
	const run = payload.runId
		? await webRobotQueries.getWebRobotRunById(payload.runId)
		: await createScheduledRun(robot.id, job.id);
	if (!run || run.robotId !== robot.id) {
		throw new Error(`Web robot run not found for robot ${robot.id}`);
	}
	if (run.status === 'cancelled') {
		return;
	}

	const active = await webRobotQueries.findActiveWebRobotRun(robot.id);
	if (active && active.id !== run.id) {
		await webRobotQueries.cancelQueuedWebRobotRun(run.id);
		throw new Error(`Web robot ${robot.id} already has an active run`);
	}

	const claimed = await webRobotQueries.markWebRobotRunRunning(run.id);
	if (!claimed) {
		return;
	}

	const abort = new AbortController();
	activeRuns.set(run.id, abort);
	try {
		const envVars = await projectQueries.getEnvVars(robot.projectId);
		const result = await runWebRobotRecipe({
			recipe: claimed.definition,
			runId: run.id,
			env: envVars,
			signal: abort.signal,
		});
		const requested = await webRobotQueries.getWebRobotRunById(run.id);
		if (abort.signal.aborted || requested?.cancelRequestedAt) {
			throw new Error('Web robot run was cancelled');
		}
		const completedAt = new Date();
		const artifacts = await publishWebRobotRunArtifacts({
			projectId: robot.projectId,
			robotName: robot.name,
			robotSlug: robot.slug,
			runId: run.id,
			recipe: claimed.definition,
			definitionHash: claimed.definitionHash,
			normalized: result.normalized,
			events: result.events,
			stats: result.stats,
			startedAt: claimed.startedAt,
			completedAt,
		});

		if (!artifacts.published) {
			await webRobotQueries.completeWebRobotRun(
				run.id,
				'failed',
				result.stats,
				artifacts.publishError ?? 'Web robot did not publish its dataset.',
				artifacts.artifactPrefix,
			);
			return;
		}

		const status = result.stats.extractionErrors + result.stats.failedRequests > 0 ? 'partial' : 'completed';
		await webRobotQueries.completeWebRobotRun(run.id, status, result.stats, null, artifacts.artifactPrefix);
		await webRobotQueries.markWebRobotPublish(robot.id, run.id, result.normalized.products.length, completedAt);
	} catch (error) {
		const latest = await webRobotQueries.getWebRobotRunById(run.id);
		const cancelled = abort.signal.aborted || latest?.cancelRequestedAt;
		const message = cancelled ? 'Cancelled by user.' : error instanceof Error ? error.message : String(error);
		if (!cancelled) {
			logger.error(`Web robot run ${run.id} failed: ${message}`, {
				source: 'system',
				context: { robotId: robot.id, runId: run.id, error: serializeError(error) },
			});
		}
		await webRobotQueries.completeWebRobotRun(
			run.id,
			cancelled ? 'cancelled' : 'failed',
			latest?.stats ?? emptyWebRobotRunStats(),
			message,
		);
		if (!cancelled) {
			throw error;
		}
	} finally {
		activeRuns.delete(run.id);
	}
};

const createScheduledRun = async (robotId: string, scheduledJobId: string): Promise<DBWebRobotRun> => {
	const active = await webRobotQueries.findActiveWebRobotRun(robotId);
	if (active) {
		throw new Error(`Web robot ${robotId} already has an active run`);
	}

	const robot = await webRobotQueries.getWebRobotById(robotId);
	if (!robot) {
		throw new Error(`Web robot not found: ${robotId}`);
	}

	return webRobotQueries.createWebRobotRun({
		robotId,
		scheduledJobId,
		trigger: 'schedule',
		definition: robot.definition,
		definitionHash: robot.definitionHash,
		stats: emptyWebRobotRunStats(),
	});
};
