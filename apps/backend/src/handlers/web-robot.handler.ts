import { emptyWebRobotRunStats, type WebRobotRecipe } from '@nao/shared/web-robot';

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
			const publishError = artifacts.publishError ?? 'Web robot did not publish its dataset.';
			logger.warn(`Web robot run ${run.id} was rejected by publish safeguards`, {
				source: 'system',
				projectId: robot.projectId,
				context: {
					robotId: robot.id,
					runId: run.id,
					artifactPrefix: artifacts.artifactPrefix,
					publishError,
					stats: result.stats,
				},
			});
			await webRobotQueries.completeWebRobotRun(
				run.id,
				'failed',
				result.stats,
				publishError,
				artifacts.artifactPrefix,
			);
			return;
		}

		const siteChanges = siteChangeSignals(result, robot.lastPublishedProductCount, claimed.definition);
		result.stats.warnings ??= [];
		result.stats.warnings.push(...siteChanges);
		const status =
			result.stats.extractionErrors + result.stats.failedRequests > 0 || siteChanges.length > 0
				? 'partial'
				: 'completed';
		await webRobotQueries.completeWebRobotRun(
			run.id,
			status,
			result.stats,
			siteChanges.length ? siteChanges.join(' ') : null,
			artifacts.artifactPrefix,
		);
		await webRobotQueries.markWebRobotPublish(robot.id, run.id, result.normalized.products.length, completedAt);
		logger.info(`Web robot run ${run.id} finished with status ${status}`, {
			source: 'system',
			projectId: robot.projectId,
			context: {
				robotId: robot.id,
				runId: run.id,
				status,
				artifactPrefix: artifacts.artifactPrefix,
				productCount: result.normalized.products.length,
				stats: result.stats,
			},
		});
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

const siteChangeSignals = (
	result: Awaited<ReturnType<typeof runWebRobotRecipe>>,
	previousProductCount: number | null,
	recipe: WebRobotRecipe,
): string[] => {
	const signals: string[] = [];
	const warningKinds = new Set(
		result.events
			.filter((event) => event.type === 'warning')
			.map((event) =>
				typeof event.data === 'object' && event.data ? (event.data as { kind?: string }).kind : undefined,
			),
	);
	if (warningKinds.has('selector_fallback') || warningKinds.has('pagination_fallback')) {
		signals.push('Site layout changed; the recipe used fallback selectors.');
	}
	if (warningKinds.has('blocker_detected')) {
		signals.push('Source returned a blocker signal during the run.');
	}
	if (warningKinds.has('field_coverage_drop')) {
		signals.push('Extracted product field coverage dropped below the expected threshold.');
	}
	if (warningKinds.has('pagination_stopped')) {
		signals.push('Pagination stopped on an unexpected target.');
	}
	const coverage = result.stats.fieldCoverage ?? {};
	const extractsSku = recipe.stages.some(
		(stage) => stage.output === 'product' && stage.extract && 'sku' in stage.extract.fields,
	);
	if ((coverage.url ?? 100) < 80 || (coverage.name ?? 100) < 80 || (extractsSku && (coverage.sku ?? 100) < 50)) {
		signals.push('Extracted product field coverage dropped below the expected threshold.');
	}
	const productCount = result.normalized.products.length;
	if (previousProductCount && previousProductCount > 0 && productCount <= previousProductCount * 0.5) {
		signals.push(`Product count dropped from ${previousProductCount} to ${productCount}.`);
	}
	return [...new Set(signals)];
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
