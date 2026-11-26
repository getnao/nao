import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sendDirectMessageByEmail: vi.fn() }));

vi.mock('../../src/services/slack', () => ({
	slackService: { sendDirectMessageByEmail: mocks.sendDirectMessageByEmail },
}));
vi.mock('../../src/services/email', () => ({ emailService: { isEnabled: () => false } }));
vi.mock('../../src/services/branding.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/branding.service')>()),
	getAppName: async () => 'nao',
}));
vi.mock('../../src/services/notification-unsubscribe', () => ({
	resolveUnsubscribeScope: () => null,
	buildUnsubscribeUrl: () => '',
}));
vi.mock('../../src/queries/notification.queries', () => ({}));
vi.mock('../../src/queries/notification-unsubscribe.queries', () => ({}));

import { notificationChannels } from '../../src/services/notification-channels';

const slackChannel = notificationChannels.find((channel) => channel.id === 'slack')!;
const RECIPIENT = { id: 'user-1', name: 'Ada', email: 'ada@example.com' };

describe('slack notification channel', () => {
	beforeEach(() => {
		mocks.sendDirectMessageByEmail.mockReset().mockResolvedValue(undefined);
	});

	it('sends the table as Markdown below the body, which Slack shows as a native table', async () => {
		await slackChannel.deliver(RECIPIENT, {
			category: 'test_run',
			projectId: 'project-1',
			title: 'Scheduled tests: 1 of 1 failed',
			body: 'Failed: stars',
			table: { headers: ['Test', 'Why'], rows: [['stars', 'a | b\nc']] },
		});

		expect(mocks.sendDirectMessageByEmail.mock.calls[0][2]).toBe(
			[
				'*Scheduled tests: 1 of 1 failed*',
				'Failed: stars',
				'',
				'| Test | Why |',
				'| --- | --- |',
				'| stars | a \\| b c |',
			].join('\n'),
		);
	});
});
