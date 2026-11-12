import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSharedStoryByStoryId: vi.fn(),
	canUserAccessSharedStory: vi.fn(),
	getUserRoleInProject: vi.fn(),
	getProjectRowSecurity: vi.fn(),
	hasEffectiveWarehouseRestrictions: vi.fn(),
	getCustomStoryVersion: vi.fn(),
	getStandaloneCustomStoryVersion: vi.fn(),
	getSharedCustomStoryQueryData: vi.fn(),
	getSharedCustomStoryQuerySql: vi.fn(),
	getStandaloneCustomStoryQueryData: vi.fn(),
	getSharedCustomStoryNarratives: vi.fn(),
	getStandaloneCustomStoryNarratives: vi.fn(),
	getCustomStoryState: vi.fn(),
	getCustomStoryStateByStoryId: vi.fn(),
	setCustomStoryState: vi.fn(),
	setCustomStoryStateByStoryId: vi.fn(),
	getStoryDataCacheByStoryId: vi.fn(),
	getVersionByStoryIdAndNumber: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/activity.queries', () => ({}));
vi.mock('../../src/queries/project.queries', () => ({ getUserRoleInProject: mocks.getUserRoleInProject }));
vi.mock('../../src/queries/user-group.queries', () => ({ getProjectRowSecurity: mocks.getProjectRowSecurity }));
vi.mock('../../src/queries/shared-story.queries', () => ({
	getSharedStory: vi.fn(),
	getSharedStoryByStoryId: mocks.getSharedStoryByStoryId,
	canUserAccessSharedStory: mocks.canUserAccessSharedStory,
}));
vi.mock('../../src/queries/story.queries', () => ({
	getStoryDataCacheByStoryId: mocks.getStoryDataCacheByStoryId,
	getVersionByStoryIdAndNumber: mocks.getVersionByStoryIdAndNumber,
}));
vi.mock('../../src/queries/story-folder.queries', () => ({}));
vi.mock('../../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../../src/services/custom-story', () => ({
	getCustomStoryVersion: mocks.getCustomStoryVersion,
	getStandaloneCustomStoryVersion: mocks.getStandaloneCustomStoryVersion,
	getSharedCustomStoryQueryData: mocks.getSharedCustomStoryQueryData,
	getSharedCustomStoryQuerySql: mocks.getSharedCustomStoryQuerySql,
	getStandaloneCustomStoryQueryData: mocks.getStandaloneCustomStoryQueryData,
	getSharedCustomStoryNarratives: mocks.getSharedCustomStoryNarratives,
	getStandaloneCustomStoryNarratives: mocks.getStandaloneCustomStoryNarratives,
}));
vi.mock('../../src/services/custom-story-state', () => ({
	getCustomStoryState: mocks.getCustomStoryState,
	getCustomStoryStateByStoryId: mocks.getCustomStoryStateByStoryId,
	setCustomStoryState: mocks.setCustomStoryState,
	setCustomStoryStateByStoryId: mocks.setCustomStoryStateByStoryId,
}));
vi.mock('../../src/services/user-group-context-access.service', () => ({
	hasEffectiveWarehouseRestrictions: mocks.hasEffectiveWarehouseRestrictions,
}));
vi.mock('../../src/utils/analytics-event', () => ({ logAnalyticsEvent: vi.fn() }));

import { sharedStoryRoutes } from '../../src/trpc/shared-story.routes';
import { router } from '../../src/trpc/trpc';
import { createTestCaller } from '../helpers/trpc-caller';

const testRouter = router({ storyShare: sharedStoryRoutes });
const caller = createTestCaller(testRouter, {
	userId: 'viewer-1',
	selectedProjectId: 'project-1',
});
const STORY_INPUT = { storyId: 'story-1' };

describe('storyShare standalone classic story', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockShare({ chatId: null, format: 'classic' });
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.canUserAccessSharedStory.mockResolvedValue(true);
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [] });
		mocks.hasEffectiveWarehouseRestrictions.mockImplementation(
			async () => (await mocks.getProjectRowSecurity()).tables.length > 0,
		);
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			queryData: { q_shown: rows('shown'), q_hidden: rows('hidden') },
		});
	});

	it('serves an older version from the saved rows its code uses, never the others', async () => {
		mocks.getVersionByStoryIdAndNumber.mockResolvedValue({ code: '<table query_id="q_shown" />' });

		await expect(caller.storyShare.getVersionQueryData({ ...STORY_INPUT, versionNumber: 1 })).resolves.toEqual({
			queryData: { q_shown: rows('shown') },
		});
		expect(mocks.getVersionByStoryIdAndNumber).toHaveBeenCalledWith('story-1', 1);
	});
});

describe('storyShare custom story readers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockShare({ chatId: null });
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.canUserAccessSharedStory.mockResolvedValue(true);
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [] });
		mocks.hasEffectiveWarehouseRestrictions.mockImplementation(
			async () => (await mocks.getProjectRowSecurity()).tables.length > 0,
		);
	});

	it('reads the version of a standalone story by its id', async () => {
		mocks.getStandaloneCustomStoryVersion.mockResolvedValue({ version: 2 });

		await expect(caller.storyShare.getCustomVersion({ ...STORY_INPUT, versionNumber: 2 })).resolves.toEqual({
			version: 2,
		});
		expect(mocks.getStandaloneCustomStoryVersion).toHaveBeenCalledWith('story-1', 2);
		expect(mocks.getCustomStoryVersion).not.toHaveBeenCalled();
	});

	it('serves the saved rows and narratives of a standalone story', async () => {
		mocks.getStandaloneCustomStoryQueryData.mockResolvedValue({ data: [{ n: 1 }], columns: ['n'] });
		mocks.getStandaloneCustomStoryNarratives.mockResolvedValue({ summary: 'Frozen' });

		await caller.storyShare.getCustomStoryQueryData({ ...STORY_INPUT, queryId: 'q_revenue' });
		await caller.storyShare.getCustomStoryNarratives(STORY_INPUT);

		expect(mocks.getStandaloneCustomStoryQueryData).toHaveBeenCalledWith(
			'story-1',
			'q_revenue',
			undefined,
			undefined,
		);
		expect(mocks.getStandaloneCustomStoryNarratives).toHaveBeenCalledWith('story-1');
	});

	it('denies standalone owner data to a shared viewer when row security exists', async () => {
		mocks.getProjectRowSecurity.mockResolvedValue({
			version: 1,
			tables: [{ databaseType: 'duckdb', database: 'analytics', schema: 'main', table: 'customers' }],
		});

		await expect(createCaller().storyShare.getCustomVersion(STORY_INPUT)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.getStandaloneCustomStoryVersion).not.toHaveBeenCalled();
	});

	it('allows the standalone story owner when row security exists', async () => {
		mocks.getProjectRowSecurity.mockResolvedValue({
			version: 1,
			tables: [{ databaseType: 'duckdb', database: 'analytics', schema: 'main', table: 'customers' }],
		});
		mocks.getStandaloneCustomStoryVersion.mockResolvedValue({ version: 2 });

		await expect(createCaller('owner-1').storyShare.getCustomVersion(STORY_INPUT)).resolves.toEqual({ version: 2 });
		expect(mocks.getProjectRowSecurity).not.toHaveBeenCalled();
	});

	it('allows stored standalone data to a viewer with full access to every RLS table', async () => {
		mocks.hasEffectiveWarehouseRestrictions.mockResolvedValue(false);
		mocks.getStandaloneCustomStoryVersion.mockResolvedValue({ version: 2 });

		await expect(createCaller().storyShare.getCustomVersion(STORY_INPUT)).resolves.toEqual({ version: 2 });
		expect(mocks.hasEffectiveWarehouseRestrictions).toHaveBeenCalledWith('project-1', 'viewer-1');
	});

	it('keeps the state of a standalone story by its id', async () => {
		const change = { key: 'region', value: 'EMEA', shared: false };

		await caller.storyShare.getCustomStoryState(STORY_INPUT);
		await caller.storyShare.setCustomStoryState({ ...STORY_INPUT, change });

		expect(mocks.getCustomStoryStateByStoryId).toHaveBeenCalledWith('story-1', 'viewer-1');
		expect(mocks.setCustomStoryStateByStoryId).toHaveBeenCalledWith('story-1', 'viewer-1', change);
	});

	it('has no SQL to show for a standalone story', async () => {
		await expect(
			caller.storyShare.getCustomStoryQuerySql({ ...STORY_INPUT, queryId: 'q_revenue' }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(mocks.getSharedCustomStoryQuerySql).not.toHaveBeenCalled();
	});

	it('still reads a chat story through its chat', async () => {
		mockShare({ chatId: 'chat-1' });

		await createCaller().storyShare.getCustomVersion(STORY_INPUT);
		await createCaller().storyShare.getCustomStoryQueryData({ ...STORY_INPUT, queryId: 'q_revenue' });
		await createCaller().storyShare.getCustomStoryNarratives(STORY_INPUT);

		expect(mocks.getCustomStoryVersion).toHaveBeenCalledWith('chat-1', 'revenue', undefined);
		expect(mocks.getSharedCustomStoryQueryData).toHaveBeenCalledWith(
			'chat-1',
			'revenue',
			'q_revenue',
			undefined,
			'viewer-1',
		);
		expect(mocks.getSharedCustomStoryNarratives).toHaveBeenCalledWith('chat-1', 'revenue', 'viewer-1');
		expect(mocks.getStandaloneCustomStoryVersion).not.toHaveBeenCalled();
	});
});

function mockShare({ chatId, format = 'custom' }: { chatId: string | null; format?: string }) {
	mocks.getSharedStoryByStoryId.mockResolvedValue({
		id: 'share-1',
		projectId: 'project-1',
		userId: 'owner-1',
		ownerUserId: 'owner-1',
		visibility: 'project',
		storyId: 'story-1',
		chatId,
		slug: 'revenue',
		format,
		code: '',
	});
}

function rows(value: string) {
	return { columns: ['value'], data: [{ value }] };
}

function createCaller(userId = 'viewer-1') {
	return createTestCaller(testRouter, { userId, selectedProjectId: 'project-1' });
}
