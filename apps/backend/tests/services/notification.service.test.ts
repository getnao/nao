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
	passedAttempts: 3,
	totalAttempts: 4,
};

describe('notifyScheduledTestsFailed', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUser.mockResolvedValue({ id: 'user-1', name: 'Ada', email: 'ada@example.com' });
		mocks.deliver.mockResolvedValue(undefined);
	});

	it.each([
		{
			case: 'answers that no longer pass',
			run: RUN,
			title: 'Scheduled tests failed: 1 of 4 answers',
			body: 'The agent no longer answers these tests like their reference SQL.',
		},
		{
			case: 'a run that broke, with its error',
			run: { ...RUN, status: 'failed' as const, errorMessage: 'The warehouse is unreachable', passedAttempts: 0 },
			title: 'Scheduled tests could not run',
			body: 'The warehouse is unreachable',
		},
	])('tells who scheduled the tests about $case, with a link to the run', async ({ run, title, body }) => {
		await notifyScheduledTestsFailed(run);

		expect(mocks.getUser).toHaveBeenCalledWith({ id: 'user-1' });
		expect(mocks.deliver).toHaveBeenCalledTimes(1);
		expect(mocks.deliver.mock.calls[0][1]).toMatchObject({
			category: 'test_run',
			title,
			body,
			linkUrl: '/context-hub?testRun=run-1',
		});
	});

	it.each([
		{ case: 'a run that passed', run: { ...RUN, passedAttempts: 4 } },
		{ case: 'a cancelled run', run: { ...RUN, status: 'cancelled' as const } },
		{ case: 'a run whose owner was removed', run: { ...RUN, triggeredByUserId: null } },
	])('stays silent about $case', async ({ run }) => {
		await notifyScheduledTestsFailed(run);

		expect(mocks.deliver).not.toHaveBeenCalled();
	});
});
