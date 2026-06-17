import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	CONTEXT_RECOMMENDATIONS_JOB_NAME,
	contextRecommendationsHandler,
	contextRecommendationsJobUniqueKey,
	ensureContextRecommendationsSchedule,
	ensureContextRecommendationsSchedules,
} from '../src/handlers/context-recommendations.handler';

const mocks = vi.hoisted(() => ({
	deleteJobByUniqueKey: vi.fn(),
	ensureRecurring: vi.fn(),
	getLatestRun: vi.fn(),
	listProjectRecommendationScheduleConfigs: vi.fn(),
	runContextRecommendations: vi.fn(),
}));

vi.mock('../src/queries/context-recommendation.queries', () => ({
	getLatestRun: mocks.getLatestRun,
	listProjectRecommendationScheduleConfigs: mocks.listProjectRecommendationScheduleConfigs,
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/queries/scheduled-job.queries', () => ({
	deleteJobByUniqueKey: mocks.deleteJobByUniqueKey,
}));

vi.mock('../src/services/context-recommendations.service', () => ({
	runContextRecommendations: mocks.runContextRecommendations,
}));

vi.mock('../src/services/scheduler.service', () => ({
	ensureRecurring: mocks.ensureRecurring,
}));

describe('context recommendations scheduling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getLatestRun.mockResolvedValue(null);
	});

	it('uses one recurring job key per project', async () => {
		await ensureContextRecommendationsSchedule('project-daily', 'daily', { reset: true });
		await ensureContextRecommendationsSchedule('project-monthly', 'monthly');

		expect(mocks.ensureRecurring).toHaveBeenCalledTimes(2);
		expect(mocks.ensureRecurring).toHaveBeenNthCalledWith(1, {
			name: CONTEXT_RECOMMENDATIONS_JOB_NAME,
			cron: '0 3 * * *',
			uniqueKey: contextRecommendationsJobUniqueKey('project-daily'),
			payload: { projectId: 'project-daily' },
			resetRunAtOnConflict: true,
		});
		expect(mocks.ensureRecurring).toHaveBeenNthCalledWith(2, {
			name: CONTEXT_RECOMMENDATIONS_JOB_NAME,
			cron: '0 3 1 * *',
			uniqueKey: contextRecommendationsJobUniqueKey('project-monthly'),
			payload: { projectId: 'project-monthly' },
			resetRunAtOnConflict: undefined,
		});
	});

	it('registers every project schedule on startup and removes the legacy global job', async () => {
		mocks.listProjectRecommendationScheduleConfigs.mockResolvedValue([
			{ projectId: 'project-default', frequency: null },
			{ projectId: 'project-monthly', frequency: 'monthly' },
		]);

		await ensureContextRecommendationsSchedules();

		expect(mocks.deleteJobByUniqueKey).toHaveBeenCalledWith(CONTEXT_RECOMMENDATIONS_JOB_NAME);
		expect(mocks.ensureRecurring).toHaveBeenCalledTimes(2);
		expect(mocks.ensureRecurring).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				cron: '0 3 * * 1',
				uniqueKey: contextRecommendationsJobUniqueKey('project-default'),
				payload: { projectId: 'project-default' },
			}),
		);
		expect(mocks.ensureRecurring).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				cron: '0 3 1 * *',
				uniqueKey: contextRecommendationsJobUniqueKey('project-monthly'),
				payload: { projectId: 'project-monthly' },
			}),
		);
	});

	it('runs recommendations only for the project in the job payload', async () => {
		await contextRecommendationsHandler({ projectId: 'project-1' }, {} as never);

		expect(mocks.runContextRecommendations).toHaveBeenCalledWith('project-1');
	});

	it('rejects legacy global jobs without a project payload', async () => {
		await expect(contextRecommendationsHandler({}, {} as never)).rejects.toThrow(
			'Context recommendations job is missing a projectId payload.',
		);
		expect(mocks.runContextRecommendations).not.toHaveBeenCalled();
	});

	it('skips the scheduled run when one is already in progress', async () => {
		mocks.getLatestRun.mockResolvedValue({ status: 'running' });

		await contextRecommendationsHandler({ projectId: 'project-1' }, {} as never);

		expect(mocks.runContextRecommendations).not.toHaveBeenCalled();
	});
});
