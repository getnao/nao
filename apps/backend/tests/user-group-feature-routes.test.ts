import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	automationsEnabled: true,
	archiveStory: vi.fn(),
	buildDownloadResponse: vi.fn(),
	deleteAutomation: vi.fn(),
	createSharedStory: vi.fn(),
	createStoryVersion: vi.fn(),
	getDisplaySettings: vi.fn(),
	getAutomation: vi.fn(),
	getChatInfo: vi.fn(),
	getChatOwnerId: vi.fn(),
	getChatProjectId: vi.fn(),
	getLatestStoryRefreshFailure: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getStoryQueryData: vi.fn(),
	getStoryByChatAndSlug: vi.fn(),
	getStorySharingInfo: vi.fn(),
	getStoryOwnerId: vi.fn(),
	getStoryProjectId: vi.fn(),
	listAutomationFeedRuns: vi.fn(),
	listAutomationRuns: vi.fn(),
	listAutomations: vi.fn(),
	listUserChatStories: vi.fn(),
	logActivity: vi.fn(),
	moveStoryToFolder: vi.fn(),
	renameStory: vi.fn(),
	resolveEffectiveUserGroupAccess: vi.fn(),
	saveStoryInPrivateRoot: vi.fn(),
	updateAutomation: vi.fn(),
	role: 'user' as 'admin' | 'user' | 'viewer' | null,
}));

vi.mock('../src/env', () => ({
	env: {
		get BETA_AUTOMATIONS_ENABLED() {
			return mocks.automationsEnabled;
		},
	},
}));
vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/handlers/automation.handler', () => ({
	AUTOMATION_JOB_NAME: 'automation',
	startAutomationRun: vi.fn(),
}));
vi.mock('../src/handlers/story-refresh.handler', () => ({ STORY_REFRESH_JOB_NAME: 'story-refresh' }));
vi.mock('../src/queries/activity.queries', () => ({
	getLatestStoryRefreshFailure: mocks.getLatestStoryRefreshFailure,
}));
vi.mock('../src/queries/automation.queries', () => ({
	deleteAutomation: mocks.deleteAutomation,
	getAutomation: mocks.getAutomation,
	listAutomationFeedRuns: mocks.listAutomationFeedRuns,
	listAutomationRuns: mocks.listAutomationRuns,
	listAutomations: mocks.listAutomations,
	updateAutomation: mocks.updateAutomation,
}));
vi.mock('../src/queries/chat.queries', () => ({
	getChatInfo: mocks.getChatInfo,
	getChatOwnerId: mocks.getChatOwnerId,
	getChatProjectId: mocks.getChatProjectId,
}));
vi.mock('../src/queries/project.queries', () => ({
	getDisplaySettings: mocks.getDisplaySettings,
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project' })),
	getUserRoleInProject: vi.fn(async () => mocks.role),
}));
vi.mock('../src/queries/shared-story.queries', () => ({
	createSharedStory: mocks.createSharedStory,
	getSharedStory: vi.fn(),
}));
vi.mock('../src/queries/user-group.queries', () => ({
	resolveEffectiveUserGroupAccess: mocks.resolveEffectiveUserGroupAccess,
}));
vi.mock('../src/queries/story.queries', () => ({
	createStoryVersion: mocks.createStoryVersion,
	archiveStory: mocks.archiveStory,
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getStoryOwnerId: mocks.getStoryOwnerId,
	getStoryProjectId: mocks.getStoryProjectId,
	getStorySharingInfo: mocks.getStorySharingInfo,
	listUserChatStories: mocks.listUserChatStories,
	renameStory: mocks.renameStory,
}));
vi.mock('../src/queries/story-folder.queries', () => ({
	moveStoryToFolder: mocks.moveStoryToFolder,
	saveStoryInPrivateRoot: mocks.saveStoryInPrivateRoot,
}));
vi.mock('../src/services/activity', () => ({ logActivity: mocks.logActivity }));
vi.mock('../src/services/agent', () => ({ agentService: { get: vi.fn() } }));
vi.mock('../src/services/live-story', () => ({
	executeLiveQuery: vi.fn(),
	getStoryQueryData: mocks.getStoryQueryData,
	refreshStoryData: vi.fn(),
}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	isGroupRoleMappingActive: vi.fn(async () => false),
}));
vi.mock('../src/utils/analytics-event', () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock('../src/utils/story-download', () => ({ buildDownloadResponse: mocks.buildDownloadResponse }));

import { automationRoutes } from '../src/trpc/automation.routes';
import { sharedStoryRoutes } from '../src/trpc/shared-story.routes';
import { storyRoutes } from '../src/trpc/story.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({
	automation: automationRoutes,
	storyShare: sharedStoryRoutes,
	story: storyRoutes,
});

describe('user group feature route enforcement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.automationsEnabled = true;
		mocks.role = 'user';
		mocks.getChatOwnerId.mockResolvedValue('user-id');
		mocks.getChatProjectId.mockResolvedValue('project-id');
		mocks.getChatInfo.mockResolvedValue({ id: 'chat-id', projectId: 'project-id' });
		mocks.getAutomation.mockResolvedValue(null);
		mocks.listAutomationFeedRuns.mockResolvedValue([]);
		mocks.listAutomationRuns.mockResolvedValue([]);
		mocks.listAutomations.mockResolvedValue([]);
		mocks.updateAutomation.mockResolvedValue(null);
		mocks.getStoryByChatAndSlug.mockResolvedValue({ id: 'story-id' });
		mocks.getStoryOwnerId.mockResolvedValue('user-id');
		mocks.getStoryProjectId.mockResolvedValue('project-id');
		mocks.createStoryVersion.mockResolvedValue({ storyId: 'story-id', version: 2 });
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			storyId: 'story-id',
			title: 'Existing Story',
			code: '# Existing',
			version: 2,
			isLive: false,
			cacheSchedule: null,
		});
		mocks.getStoryQueryData.mockResolvedValue({ queryData: null, cachedAt: null });
		mocks.getLatestStoryRefreshFailure.mockResolvedValue(null);
		mocks.getStorySharingInfo.mockResolvedValue(new Map());
		mocks.listUserChatStories.mockResolvedValue([
			{ id: 'story-id', projectId: 'project-id', slug: 'existing-story', code: '# Existing' },
		]);
		mocks.getDisplaySettings.mockResolvedValue({ dateFormat: 'MM/dd/yyyy' });
		mocks.buildDownloadResponse.mockReturnValue({ body: 'download' });
		mocks.createSharedStory.mockResolvedValue({ id: 'shared-story-id' });
		mockEffectiveFeatures(['story-creation', 'automation-creation']);
	});

	it('denies Automation creation after the beta and role checks', async () => {
		mockEffectiveFeatures(['story-creation']);

		await expect(
			createCaller().automation.create({
				prompt: 'Summarize daily activity',
				webhookEnabled: true,
			}),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Automation creation is not enabled for your user group.',
		});
		expect(mocks.resolveEffectiveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
	});

	it('allows existing Automation operations without the creation grant', async () => {
		mockEffectiveFeatures(['story-creation']);
		mocks.getAutomation
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: 'automation-id', scheduledJobId: null });

		await expect(createCaller().automation.list()).resolves.toEqual([]);
		await expect(createCaller().automation.get({ id: 'automation-id' })).resolves.toBeNull();
		await expect(
			createCaller().automation.update({
				id: 'automation-id',
				title: 'Existing Automation',
				prompt: 'Updated prompt',
				webhookEnabled: true,
			}),
		).resolves.toBeNull();
		await expect(createCaller().automation.setEnabled({ id: 'automation-id', enabled: false })).resolves.toBeNull();
		await expect(createCaller().automation.runNow({ id: 'automation-id' })).resolves.toBeNull();
		await expect(createCaller().automation.delete({ id: 'automation-id' })).resolves.toEqual({ success: true });
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
		expect(mocks.listAutomations).toHaveBeenCalledWith('project-id', 'user-id');
		expect(mocks.getAutomation).toHaveBeenCalledWith('project-id', 'user-id', 'automation-id');
		expect(mocks.updateAutomation).toHaveBeenCalledWith(
			'project-id',
			'user-id',
			'automation-id',
			expect.objectContaining({ title: 'Existing Automation', prompt: 'Updated prompt' }),
		);
		expect(mocks.deleteAutomation).toHaveBeenCalledWith('project-id', 'user-id', 'automation-id');
	});

	it('preserves the Automation beta check before the creation grant', async () => {
		mocks.automationsEnabled = false;

		await expect(
			createCaller().automation.create({
				prompt: 'Summarize daily activity',
				webhookEnabled: true,
			}),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Automations are disabled on this instance.',
		});
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('preserves the Automation role check before the creation grant', async () => {
		mocks.role = 'viewer';

		await expect(
			createCaller().automation.create({
				prompt: 'Summarize daily activity',
				webhookEnabled: true,
			}),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Viewers cannot perform this action',
		});
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('preserves Story ownership before feature grants', async () => {
		mocks.getStoryOwnerId.mockResolvedValue('another-user');

		await expect(createCaller().story.getStandalone({ storyId: 'story-id' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'You are not authorized to modify this story.',
		});
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('allows management of an owned Story without the creation grant', async () => {
		mockEffectiveFeatures(['automation-creation']);

		await expect(createCaller().story.rename({ storyId: 'story-id', title: 'Renamed' })).resolves.toBeUndefined();
		expect(mocks.renameStory).toHaveBeenCalledWith('story-id', 'Renamed');
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('allows listing, viewing, archiving, downloading, and sharing existing Stories without the creation grant', async () => {
		mockEffectiveFeatures([]);

		await expect(createCaller().story.listAll()).resolves.toHaveLength(1);
		await expect(
			createCaller().story.getLatest({ chatId: 'chat-id', storySlug: 'existing-story' }),
		).resolves.toMatchObject({ storyId: 'story-id' });
		await expect(
			createCaller().story.archive({ chatId: 'chat-id', storySlug: 'existing-story' }),
		).resolves.toBeUndefined();
		await expect(
			createCaller().story.download({
				chatId: 'chat-id',
				storySlug: 'existing-story',
				format: 'html',
			}),
		).resolves.toEqual({ body: 'download' });
		await expect(
			createCaller().storyShare.create({
				chatId: 'chat-id',
				storySlug: 'existing-story',
				visibility: 'specific',
				notify: false,
			}),
		).resolves.toEqual({ id: 'shared-story-id' });
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});

	it.each(['update', 'replace'] as const)(
		'denies %s against a missing Story without the creation grant',
		async (action) => {
			mocks.getStoryByChatAndSlug.mockResolvedValue(null);
			mockEffectiveFeatures(['automation-creation']);

			await expect(
				createCaller().story.createVersion({
					chatId: 'chat-id',
					storySlug: 'missing-story',
					title: 'Missing Story',
					code: '# Missing',
					action,
				}),
			).rejects.toMatchObject({
				code: 'FORBIDDEN',
				message: 'Story creation is not enabled for your user group.',
			});
			expect(mocks.resolveEffectiveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
		},
	);

	it('allows updating an existing Story without the creation grant', async () => {
		mockEffectiveFeatures(['automation-creation']);

		await expect(
			createCaller().story.createVersion({
				chatId: 'chat-id',
				storySlug: 'existing-story',
				title: 'Existing Story',
				code: '# Updated',
				action: 'update',
			}),
		).resolves.toEqual({ storyId: 'story-id', version: 2 });
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
		expect(mocks.saveStoryInPrivateRoot).not.toHaveBeenCalled();
	});
});

function mockEffectiveFeatures(features: Array<'story-creation' | 'automation-creation'>): void {
	mocks.resolveEffectiveUserGroupAccess.mockResolvedValue({
		features,
		toolCallDensityPolicy: {
			defaultDensity: 'detailed',
			canChange: true,
		},
	});
}

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', name: 'Test User', email: 'test@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
