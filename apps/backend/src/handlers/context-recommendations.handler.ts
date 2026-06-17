import { env } from '../env';
import * as crQueries from '../queries/context-recommendation.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import { runContextRecommendations } from '../services/context-recommendations.service';
import { ensureRecurring, JobHandler } from '../services/scheduler.service';
import {
	CONTEXT_RECOMMENDATION_FREQUENCY_CRON,
	ContextRecommendationFrequency,
	DEFAULT_CONTEXT_RECOMMENDATION_FREQUENCY,
} from '../types/context-recommendation';
import { logger } from '../utils/logger';

export const CONTEXT_RECOMMENDATIONS_JOB_NAME = 'context.recommendations';

interface ContextRecommendationsJobPayload {
	projectId?: unknown;
}

export const contextRecommendationsHandler: JobHandler<ContextRecommendationsJobPayload> = async (payload) => {
	if (typeof payload.projectId !== 'string') {
		throw new Error('Context recommendations job is missing a projectId payload.');
	}
	const latestRun = await crQueries.getLatestRun(payload.projectId);
	if (latestRun?.status === 'running') {
		logger.warn(
			`Skipping scheduled context recommendations for project ${payload.projectId}: a run is already in progress.`,
			{ source: 'agent' },
		);
		return;
	}
	await runContextRecommendations(payload.projectId);
};

/**
 * Register (or update) the recurring analysis job for the given frequency. Pass
 * `reset` when the user changes the cadence so the new schedule takes effect now
 * instead of after the next run.
 */
export async function ensureContextRecommendationsSchedule(
	projectId: string,
	frequency: ContextRecommendationFrequency,
	options?: { reset?: boolean },
): Promise<void> {
	await ensureRecurring({
		name: CONTEXT_RECOMMENDATIONS_JOB_NAME,
		cron: CONTEXT_RECOMMENDATION_FREQUENCY_CRON[frequency],
		uniqueKey: contextRecommendationsJobUniqueKey(projectId),
		payload: { projectId },
		resetRunAtOnConflict: options?.reset,
	});
}

/**
 * Registers the default schedule for a project created after server startup, so
 * it does not have to wait for a restart (or a manual frequency change) to get
 * analyzed. Best-effort: a scheduling failure must not fail project creation.
 */
export async function ensureContextRecommendationsScheduleForNewProject(projectId: string): Promise<void> {
	if (!env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED) {
		return;
	}
	try {
		await ensureContextRecommendationsSchedule(projectId, DEFAULT_CONTEXT_RECOMMENDATION_FREQUENCY);
	} catch (err) {
		logger.error(
			`Failed to register context recommendations schedule for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
			{ source: 'system' },
		);
	}
}

export async function ensureContextRecommendationsSchedules(): Promise<void> {
	await scheduledJobQueries.deleteJobByUniqueKey(CONTEXT_RECOMMENDATIONS_JOB_NAME);

	const configs = await crQueries.listProjectRecommendationScheduleConfigs();
	for (const config of configs) {
		await ensureContextRecommendationsSchedule(
			config.projectId,
			config.frequency ?? DEFAULT_CONTEXT_RECOMMENDATION_FREQUENCY,
		);
	}
}

export function contextRecommendationsJobUniqueKey(projectId: string): string {
	return `${CONTEXT_RECOMMENDATIONS_JOB_NAME}:${projectId}`;
}
