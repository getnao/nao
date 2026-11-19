import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ deliver: vi.fn(), getUser: vi.fn() }));

vi.mock('../../src/queries/user.queries', () => ({ getUser: mocks.getUser }));
vi.mock('../../src/queries/project.queries', () => ({}));
vi.mock('../../src/queries/shared-chat.queries', () => ({}));
vi.mock('../../src/queries/shared-story.queries', () => ({}));
vi.mock('../../src/services/story-recipients', () => ({}));
vi.mock('../../src/services/notification-channels', () => ({
	notificationChannels: [{ id: 'in_app', isEnabled: () => true, deliver: mocks.deliver }],
}));

import { notifyScheduledTestsFailed } from '../../src/services/notification.service';

const RUN = {
	id: 'run-1',
	projectId: 'project-1',
	triggeredByUserId: 'user-1',
	status: 'completed' as const,
	errorMessage: null,
	passedAttempts: 2,
	totalAttempts: 4,
};

function result(testName: string, passed: boolean, details: { message?: string; errorMessage?: string } = {}) {
	return {
		testName,
		llmModelId: 'gpt-6-sol',
		passed,
		message: details.message ?? (passed ? 'match' : null),
		errorMessage: details.errorMessage ?? null,
	};
}

const PASSED_RESULTS = [result('revenue', true), result('stars', true)];

describe('notifyScheduledTestsFailed', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUser.mockResolvedValue({ id: 'user-1', name: 'Ada', email: 'ada@example.com' });
		mocks.deliver.mockResolvedValue(undefined);
	});

	it.each([
		{
			case: 'failed tests first, with why, then the passed ones',
			results: [
				result('orders', true),
				result('revenue', false, { message: 'values differ' }),
				result('revenue', true),
				result('stars', false, { message: 'row count: 3 vs 4' }),
			],
			title: 'Scheduled tests: 2 of 3 failed',
			body: 'Failed: revenue, stars',
			table: {
				headers: ['Test', 'Model', 'Result', 'Why'],
				rows: [
					['revenue', 'gpt-6-sol', '❌ Failed (1/2)', 'Other values than the reference SQL'],
					['stars', 'gpt-6-sol', '❌ Failed', '3 rows instead of 4'],
					['orders', 'gpt-6-sol', '✅ Passed', ''],
				],
			},
		},
		{
			case: 'a test the agent could not answer, with its error on one line',
			results: [
				result('stars', false, {
					message: 'error: Warehouse SQL request denied',
					errorMessage: 'Warehouse SQL request denied:\n  • api_key is required',
				}),
			],
			title: 'Scheduled tests: 1 of 1 failed',
			body: 'Failed: stars',
			table: {
				headers: ['Test', 'Model', 'Result', 'Why'],
				rows: [
					['stars', 'gpt-6-sol', '❌ Failed', 'Error: Warehouse SQL request denied: • api_key is required'],
				],
			},
		},
		{
			case: 'more failed tests than the body lists',
			results: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) =>
				result(name, false, { message: 'actual is empty' }),
			),
			title: 'Scheduled tests: 7 of 7 failed',
			body: 'Failed: a, b, c, d, e and 2 more',
			table: expect.objectContaining({
				rows: expect.arrayContaining([['g', 'gpt-6-sol', '❌ Failed', 'No data returned']]),
			}),
		},
		{
			case: 'a run that broke, with its error',
			run: { ...RUN, status: 'failed' as const, errorMessage: 'The warehouse is unreachable' },
			results: [],
			title: 'Scheduled tests could not run',
			body: 'The warehouse is unreachable',
			table: undefined,
		},
	])(
		'tells who scheduled the tests about $case, with a link to the run',
		async ({ run, results, title, body, table }) => {
			await notifyScheduledTestsFailed(run ?? RUN, results);

			expect(mocks.getUser).toHaveBeenCalledWith({ id: 'user-1' });
			expect(mocks.deliver).toHaveBeenCalledTimes(1);
			expect(mocks.deliver.mock.calls[0][1]).toMatchObject({
				category: 'test_run',
				title,
				body,
				table,
				linkUrl: '/context-hub?testRun=run-1',
			});
		},
	);

	it.each([
		{ case: 'a run that passed', run: RUN },
		{ case: 'a cancelled run', run: { ...RUN, status: 'cancelled' as const } },
		{ case: 'a run whose owner was removed', run: { ...RUN, triggeredByUserId: null } },
	])('stays silent about $case', async ({ run }) => {
		const results = run === RUN ? PASSED_RESULTS : [result('revenue', false, { message: 'values differ' })];

		await notifyScheduledTestsFailed(run, results);

		expect(mocks.deliver).not.toHaveBeenCalled();
	});
});
