import {
	STORY_VIEWER_RESTRICTED_CODE_MARKER,
	VIEWER_NARRATIVE_PLACEHOLDER,
} from '@nao/shared/story-viewer-restrictions';
import { beforeEach, expect, it, vi } from 'vitest';

import type { DBStory } from '../../src/db/abstractSchema';

const mocks = vi.hoisted(() => ({
	getStoryById: vi.fn<(_storyId: string) => Promise<DBStory | undefined>>(),
	notifyUsers: vi.fn(),
	refreshStoryById: vi.fn(),
	refreshStoryForViewer: vi.fn(),
	hasRowSecurity: vi.fn(),
	getUserRoleInProject: vi.fn(),
	resolveDeliveryRecipientUserIds: vi.fn(),
	buildStoryEmailHtml: vi.fn(),
	buildStoryPdfAttachment: vi.fn(),
	renderCustomStoryPdf: vi.fn(),
	logError: vi.fn(),
	updateJobPayload: vi.fn(),
	getStoryShareAccess: vi.fn(),
	addSharedStoryAllowedUsers: vi.fn(),
	getStoryShareRole: vi.fn(),
	getStoryFolderItem: vi.fn(),
	findTeamFolderOf: vi.fn(),
}));

vi.mock('../../src/queries/scheduled-job.queries', () => ({ updateJobPayload: mocks.updateJobPayload }));
vi.mock('../../src/queries/project.queries', () => ({ getUserRoleInProject: mocks.getUserRoleInProject }));
vi.mock('../../src/queries/shared-story.queries', () => ({
	getStoryShareAccess: mocks.getStoryShareAccess,
	addSharedStoryAllowedUsers: mocks.addSharedStoryAllowedUsers,
	getStoryShareRole: mocks.getStoryShareRole,
}));
vi.mock('../../src/queries/story-folder.queries', () => ({
	getStoryFolderItem: mocks.getStoryFolderItem,
	findTeamFolderOf: mocks.findTeamFolderOf,
}));
vi.mock('../../src/queries/story.queries', () => ({
	getStoryById: mocks.getStoryById,
	getLatestVersionByStoryId: vi.fn(async () => ({
		code: 'export default {}',
		title: 'Story title',
	})),
}));
vi.mock('../../src/queries/story-delivery.queries', () => ({
	getByStoryId: vi.fn(async () => ({ channels: ['email'], enabled: true })),
}));
vi.mock('../../src/queries/user.queries', () => ({
	getUserName: vi.fn(async () => 'Story owner'),
}));
vi.mock('../../src/services/custom-story-export', () => ({
	renderCustomStoryPdf: mocks.renderCustomStoryPdf,
}));
vi.mock('../../src/services/live-story', () => ({
	refreshStoryById: mocks.refreshStoryById,
	refreshStoryForViewer: mocks.refreshStoryForViewer,
	omitAccessDeniedQueries: (queryData: Record<string, { accessDenied?: true }>) =>
		Object.fromEntries(Object.entries(queryData).filter(([, result]) => !result.accessDenied)),
}));
vi.mock('../../src/services/notification.service', () => ({
	NotificationChannelDeliveryError: class extends Error {
		constructor(
			readonly succeeded: Array<{ userId: string; channel: string }>,
			readonly failed: Array<{ userId: string; channel: string }>,
		) {
			super('Notification channel delivery failed');
		}
	},
	notifyUsers: mocks.notifyUsers,
}));
vi.mock('../../src/services/story-recipients', () => ({
	resolveDeliveryRecipientUserIds: mocks.resolveDeliveryRecipientUserIds,
}));
vi.mock('../../src/services/user-group-context-access.service', () => ({
	hasEffectiveWarehouseRestrictions: mocks.hasRowSecurity,
}));
vi.mock('../../src/utils/keyed-lock', () => ({
	withKeyedLock: vi.fn(async (_key: string, callback: () => Promise<void>) => callback()),
}));
vi.mock('../../src/utils/logger', () => ({ logger: { error: mocks.logError, info: vi.fn() } }));
vi.mock('../../src/utils/story-email', () => ({
	buildStoryEmailHtml: mocks.buildStoryEmailHtml,
	buildStoryPdfAttachment: mocks.buildStoryPdfAttachment,
}));
vi.mock('../../src/utils/story-links', () => ({
	storyPath: vi.fn(() => '/stories/story-id'),
}));

import {
	resolveStoryDeliveryProjectId,
	runScheduledStoryDelivery,
	storyDeliveryHandler,
} from '../../src/handlers/story-delivery.handler';
import { NotificationChannelDeliveryError } from '../../src/services/notification.service';

const STORY = {
	id: 'story-id',
	archivedAt: null,
	chatId: 'chat-id',
	projectId: 'project-id',
	slug: 'story-slug',
	userId: 'user-id',
} as DBStory;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getStoryById.mockResolvedValue(STORY);
	mocks.getStoryShareAccess.mockResolvedValue({ shareId: 'share-id', visibility: 'organization' });
	mocks.getStoryFolderItem.mockResolvedValue(null);
	mocks.hasRowSecurity.mockResolvedValue(false);
	mocks.getUserRoleInProject.mockResolvedValue('viewer');
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue(['recipient-user-id']);
	mocks.refreshStoryById.mockResolvedValue({ queryData: {}, queriesRefreshed: 0 });
	mocks.refreshStoryForViewer.mockImplementation(async (_story: DBStory, viewerUserId: string) => ({
		queryData: { query_users: rows(viewerUserId) },
		narratives: {},
		code: `code-${viewerUserId}`,
	}));
	mocks.buildStoryEmailHtml.mockResolvedValue(null);
	mocks.buildStoryPdfAttachment.mockResolvedValue([]);
	mocks.renderCustomStoryPdf.mockResolvedValue({ filename: 'story.pdf', buffer: Buffer.from('pdf') });
});

it.each([
	['in a chat', 'chat-id'],
	['standalone', null],
])('delivers the refreshed story %s with scheduler-verified billing access', async (_case, chatId) => {
	mocks.getStoryById.mockResolvedValue({ ...STORY, chatId });

	await runScheduledStoryDelivery('story-id');

	expect(mocks.refreshStoryById).toHaveBeenCalledWith('story-id', {
		billingAccessVerifiedProjectId: 'project-id',
	});
	expect(mocks.notifyUsers).toHaveBeenCalledOnce();
	expect(mocks.notifyUsers).toHaveBeenCalledWith(
		['recipient-user-id'],
		expect.objectContaining({ channels: ['email'] }),
		{ skipDeliveries: [], throwOnChannelError: true },
	);
});

it('shares the owner refresh with unrestricted recipients and rebuilds the story only for restricted ones', async () => {
	mockRestrictedRecipients(['restricted-1', 'restricted-2']);
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue(['open-user', 'restricted-1', 'restricted-2']);
	mocks.refreshStoryById.mockResolvedValue({ queryData: { query_users: rows('owner') }, queriesRefreshed: 1 });

	await runScheduledStoryDelivery('story-id');

	expect(mocks.refreshStoryById).toHaveBeenCalledOnce();
	expect(mocks.refreshStoryForViewer.mock.calls).toEqual([
		[STORY, 'restricted-1', { billingAccessVerifiedProjectId: 'project-id' }],
		[STORY, 'restricted-2', { billingAccessVerifiedProjectId: 'project-id' }],
	]);
	expect(mocks.buildStoryPdfAttachment.mock.calls).toEqual([
		['Story title', 'export default {}', { query_users: rows('owner') }, 'project-id'],
		['Story title', 'code-restricted-1', { query_users: rows('restricted-1') }, 'project-id'],
		['Story title', 'code-restricted-2', { query_users: rows('restricted-2') }, 'project-id'],
	]);
	expect(mocks.notifyUsers.mock.calls.map(([recipients]) => recipients)).toEqual([
		['open-user'],
		['restricted-1'],
		['restricted-2'],
	]);
});

it('grants direct access only to recipients the share does not already reach', async () => {
	mocks.getStoryShareAccess.mockResolvedValue({
		shareId: 'share-id',
		visibility: 'specific',
		allowedUserIds: ['direct-user'],
		allowedGroupIds: ['team-group'],
		recipientUserIds: ['direct-user', 'group-member'],
	});
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue(['direct-user', 'group-member', 'outside-user']);

	await runScheduledStoryDelivery('story-id');

	expect(mocks.addSharedStoryAllowedUsers).toHaveBeenCalledWith('share-id', ['outside-user']);
});

it('sends a team folder story only to recipients who can already open it, without granting access', async () => {
	mocks.getStoryFolderItem.mockResolvedValue({ folderId: 'team-folder-id' });
	mocks.findTeamFolderOf.mockResolvedValue({ id: 'team-folder-id', groupIds: ['team-group'] });
	mocks.getStoryShareRole.mockImplementation(async (_storyId: string, userId: string) =>
		userId === 'group-member' ? 'viewer' : null,
	);
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue(['group-member', 'outside-user']);

	await runScheduledStoryDelivery('story-id');

	expect(mocks.addSharedStoryAllowedUsers).not.toHaveBeenCalled();
	expect(mocks.notifyUsers).toHaveBeenCalledWith(['group-member'], expect.anything(), expect.anything());
});

it('sends the owner their own copy, even when their warehouse access is restricted', async () => {
	mocks.hasRowSecurity.mockResolvedValue(true);
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue([STORY.userId]);

	await runScheduledStoryDelivery('story-id');

	expect(mocks.refreshStoryForViewer).not.toHaveBeenCalled();
	expect(mocks.notifyUsers).toHaveBeenCalledWith([STORY.userId], expect.anything(), expect.anything());
});

it('removes the restricted marker and the queries a restricted recipient cannot read', async () => {
	mockRestrictedRecipients(['recipient-user-id']);
	mocks.refreshStoryForViewer.mockResolvedValue({
		code: [
			STORY_VIEWER_RESTRICTED_CODE_MARKER,
			VIEWER_NARRATIVE_PLACEHOLDER,
			'<table query_id="query_users" />',
		].join('\n'),
		queryData: {
			query_users: rows('recipient-user-id'),
			query_salaries: { columns: [], data: [], accessDenied: true },
		},
		narratives: {},
	});

	await runScheduledStoryDelivery('story-id');

	expect(mocks.buildStoryPdfAttachment).toHaveBeenCalledWith(
		'Story title',
		'<table query_id="query_users" />',
		{ query_users: rows('recipient-user-id') },
		'project-id',
	);
});

it('skips a removed recipient before checking their warehouse access', async () => {
	mocks.hasRowSecurity.mockImplementation(async (_projectId: string, userId: string) => {
		if (userId === 'removed-user') {
			throw new Error('You do not have access to this project.');
		}
		return true;
	});
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue(['removed-user', 'active-user']);
	mocks.getUserRoleInProject.mockImplementation(async (_projectId: string, userId: string) =>
		userId === 'removed-user' ? null : 'viewer',
	);

	await runScheduledStoryDelivery('story-id');

	expect(mocks.hasRowSecurity).not.toHaveBeenCalledWith('project-id', 'removed-user');
	expect(mocks.refreshStoryForViewer).toHaveBeenCalledOnce();
	expect(mocks.notifyUsers).toHaveBeenCalledWith(['active-user'], expect.anything(), expect.anything());
});

it('skips a recipient removed while their copy was being built', async () => {
	mockRestrictedRecipients(['recipient-user-id']);
	mocks.getUserRoleInProject.mockResolvedValueOnce('viewer').mockResolvedValueOnce(null);

	await runScheduledStoryDelivery('story-id');

	expect(mocks.refreshStoryForViewer).toHaveBeenCalledOnce();
	expect(mocks.notifyUsers).not.toHaveBeenCalled();
});

it('renders a custom story PDF with the narratives of a restricted recipient', async () => {
	mockRestrictedRecipients(['recipient-user-id']);
	mocks.getStoryById.mockResolvedValue({ ...STORY, format: 'custom' } as DBStory);
	mocks.refreshStoryForViewer.mockResolvedValue({
		queryData: { query_users: rows('recipient-user-id') },
		narratives: { summary: 'Recipient summary' },
		code: 'custom-code',
	});

	await runScheduledStoryDelivery('story-id');

	expect(mocks.renderCustomStoryPdf).toHaveBeenCalledWith(
		'story-id',
		{ query_users: rows('recipient-user-id') },
		{ summary: 'Recipient summary' },
	);
});

it('delivers to the other recipients when one copy fails, and retries only what was not sent', async () => {
	mockRestrictedRecipients(['recipient-failed', 'recipient-sent']);
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue(['recipient-failed', 'recipient-sent']);
	mocks.refreshStoryForViewer.mockImplementation(async (_story: DBStory, viewerUserId: string) => {
		if (viewerUserId === 'recipient-failed') {
			throw new Error('Warehouse denied the recipient query.');
		}
		return { queryData: {}, narratives: {}, code: 'recipient-code' };
	});
	const job = { id: 'job-id', attempts: 1, maxAttempts: 3 };

	await expect(storyDeliveryHandler({ storyId: 'story-id' }, job as never)).rejects.toBeInstanceOf(
		NotificationChannelDeliveryError,
	);

	expect(mocks.notifyUsers.mock.calls.map(([recipients]) => recipients)).toEqual([['recipient-sent']]);
	expect(mocks.logError).toHaveBeenCalledWith(
		'Failed to deliver story to 1 recipient(s): Error: Warehouse denied the recipient query.',
		{
			source: 'system',
			projectId: 'project-id',
			context: { storyId: 'story-id', recipientUserIds: ['recipient-failed'] },
		},
	);
	expect(mocks.updateJobPayload).toHaveBeenCalledWith('job-id', {
		storyId: 'story-id',
		skipDeliveries: [{ userId: 'recipient-sent', channel: 'email' }],
	});
});

it('does not rebuild the story for a restricted recipient who already received it', async () => {
	mockRestrictedRecipients(['recipient-failed', 'recipient-sent']);
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue(['recipient-failed', 'recipient-sent']);

	await runScheduledStoryDelivery('story-id', [{ userId: 'recipient-sent', channel: 'email' }]);

	expect(mocks.refreshStoryForViewer.mock.calls.map(([, viewerUserId]) => viewerUserId)).toEqual([
		'recipient-failed',
	]);
});

it.each([
	{ name: 'succeeds', job: { id: 'job-id', attempts: 2, maxAttempts: 3 }, fails: false },
	{ name: 'fails on its last attempt', job: { id: 'job-id', attempts: 3, maxAttempts: 3 }, fails: true },
])('clears what a run already sent once its retry $name, so the next run delivers it again', async ({ job, fails }) => {
	const skipDeliveries = [{ userId: 'recipient-user-id', channel: 'email' as const }];
	if (fails) {
		mocks.notifyUsers.mockRejectedValueOnce(new NotificationChannelDeliveryError([], []));
	}

	await storyDeliveryHandler({ storyId: 'story-id', skipDeliveries }, job as never).catch(() => undefined);

	expect(mocks.updateJobPayload).toHaveBeenCalledWith('job-id', { storyId: 'story-id' });
});

it('lets the handler no-op when the scheduled story no longer exists', async () => {
	mocks.getStoryById.mockResolvedValueOnce(undefined);

	await expect(resolveStoryDeliveryProjectId({ storyId: 'deleted-story-id' })).resolves.toBeNull();
});

it('preserves successful channels when the scheduler retries delivery', async () => {
	const previousSkips = [{ userId: 'recipient-user-id', channel: 'slack' as const }];
	const newlySucceeded = [{ userId: 'recipient-user-id', channel: 'email' as const }];
	const error = new NotificationChannelDeliveryError(newlySucceeded, [
		{ userId: 'recipient-user-id', channel: 'in_app' },
	]);
	mocks.notifyUsers.mockRejectedValueOnce(error);

	await expect(
		storyDeliveryHandler({ storyId: 'story-id', skipDeliveries: previousSkips }, {
			id: 'job-id',
			cron: '0 * * * *',
			attempts: 2,
		} as never),
	).rejects.toBe(error);

	expect(mocks.notifyUsers).toHaveBeenCalledWith(
		['recipient-user-id'],
		expect.objectContaining({ channels: ['email'] }),
		{ skipDeliveries: previousSkips, throwOnChannelError: true },
	);
	expect(mocks.updateJobPayload).toHaveBeenCalledWith('job-id', {
		storyId: 'story-id',
		skipDeliveries: [...previousSkips, ...newlySucceeded],
	});
});

function mockRestrictedRecipients(restrictedUserIds: string[]): void {
	mocks.hasRowSecurity.mockImplementation(async (_projectId: string, userId: string) =>
		restrictedUserIds.includes(userId),
	);
}

function rows(viewer: string) {
	return { columns: ['viewer'], data: [{ viewer }] };
}
