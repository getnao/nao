import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	verifyEmbedToken: vi.fn(),
	assertProjectMcpEnabled: vi.fn(),
	getStoryProjectId: vi.fn(),
	getLatestVersionByStoryId: vi.fn(),
	getStoryOwnerId: vi.fn(),
	getDisplaySettings: vi.fn(),
	getUserRoleInProject: vi.fn(),
	getProjectRowSecurity: vi.fn(),
	getStoryQueryData: vi.fn(),
	backfillMissingQueryDataForSandbox: vi.fn(),
	getActiveThemeForProject: vi.fn(),
	hasEffectiveWarehouseRestrictions: vi.fn(),
}));

vi.mock('../../src/utils/embed-token', () => ({
	verifyEmbedToken: mocks.verifyEmbedToken,
	assertProjectMcpEnabled: mocks.assertProjectMcpEnabled,
}));
vi.mock('../../src/queries/story.queries', () => ({
	getStoryProjectId: mocks.getStoryProjectId,
	getLatestVersionByStoryId: mocks.getLatestVersionByStoryId,
	getStoryOwnerId: mocks.getStoryOwnerId,
}));
vi.mock('../../src/queries/project.queries', () => ({
	getDisplaySettings: mocks.getDisplaySettings,
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../../src/queries/user-group.queries', () => ({
	getProjectRowSecurity: mocks.getProjectRowSecurity,
}));
vi.mock('../../src/services/live-story', () => ({
	getStoryQueryData: mocks.getStoryQueryData,
}));
vi.mock('../../src/services/user-group-context-access.service', () => ({
	hasEffectiveWarehouseRestrictions: mocks.hasEffectiveWarehouseRestrictions,
}));
vi.mock('../../src/services/custom-story', () => ({
	getActiveThemeForProject: mocks.getActiveThemeForProject,
}));
vi.mock('../../src/utils/story-query-data', () => ({
	backfillMissingQueryDataForSandbox: mocks.backfillMissingQueryDataForSandbox,
}));

import { loadEmbedStoryContent } from '../../src/utils/embed-story';

const ORDERS_TABLE_CODE = '<table query_id="query_orders" />';

describe('embedded Story query data', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.verifyEmbedToken.mockReturnValue({
			type: 'story',
			resourceId: 'story-1',
			projectId: 'project-1',
		});
		mocks.getStoryProjectId.mockResolvedValue('project-1');
		mocks.getDisplaySettings.mockResolvedValue({ dateFormat: null });
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [] });
		mocks.getUserRoleInProject.mockResolvedValue(null);
		mocks.hasEffectiveWarehouseRestrictions.mockResolvedValue(false);
	});

	it('allows anonymous static embeds when no row security is configured', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion());
		mocks.getStoryOwnerId.mockResolvedValue('owner-1');
		mocks.getStoryQueryData.mockResolvedValue({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
			cachedAt: null,
			code: ORDERS_TABLE_CODE,
		});

		await expect(loadEmbedStoryContent('story-1', 'token')).resolves.toMatchObject({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
		});
		expect(mocks.getUserRoleInProject).not.toHaveBeenCalled();
	});

	it('resolves static embeds as the Story owner', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion());
		mocks.getStoryQueryData.mockResolvedValue({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
			cachedAt: null,
			code: ORDERS_TABLE_CODE,
		});

		await expect(loadEmbedStoryContent('story-1', 'token')).resolves.toMatchObject({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
		});
		expect(mocks.getStoryQueryData).toHaveBeenCalledWith(
			'chat-1',
			'orders',
			'<table query_id="query_orders" />',
			false,
			undefined,
			{ viewerUserId: undefined },
		);
		expect(mocks.backfillMissingQueryDataForSandbox).not.toHaveBeenCalled();
	});

	it('loads chat-backed data with a signed-in project viewer', async () => {
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [{ table: 'orders' }] });
		mocks.getUserRoleInProject.mockResolvedValue('viewer');
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			storyId: 'story-1',
			chatId: 'chat-1',
			slug: 'orders',
			title: 'Orders',
			code: '<table query_id="query_orders" />',
			isLive: false,
		});
		mocks.getStoryOwnerId.mockResolvedValue('owner-1');
		mocks.getStoryQueryData.mockResolvedValue({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
			cachedAt: null,
			code: '<table query_id="query_orders" />',
		});

		await loadEmbedStoryContent('story-1', 'token', 'viewer-1');

		expect(mocks.getStoryQueryData).toHaveBeenCalledWith(
			'chat-1',
			'orders',
			'<table query_id="query_orders" />',
			false,
			undefined,
			{ viewerUserId: 'viewer-1' },
		);
	});

	it('keeps token-based access for a signed-in nonmember when no row security is configured', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			storyId: 'story-1',
			chatId: 'chat-1',
			slug: 'orders',
			title: 'Orders',
			code: '<table query_id="query_orders" />',
			isLive: false,
		});
		mocks.getStoryOwnerId.mockResolvedValue('owner-1');
		mocks.getStoryQueryData.mockResolvedValue({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
			cachedAt: null,
			code: '<table query_id="query_orders" />',
		});

		await loadEmbedStoryContent('story-1', 'token', 'outside-user');

		expect(mocks.getStoryQueryData).toHaveBeenCalledWith(
			'chat-1',
			'orders',
			'<table query_id="query_orders" />',
			false,
			undefined,
			{ viewerUserId: undefined },
		);
	});

	it('requires project membership when row security is configured', async () => {
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [{ table: 'orders' }] });

		await expect(loadEmbedStoryContent('story-1', 'token', 'outside-user')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
		});

		expect(mocks.getLatestVersionByStoryId).not.toHaveBeenCalled();
	});

	it('requires sign-in for anonymous viewers when row security is configured', async () => {
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [{ table: 'orders' }] });

		await expect(loadEmbedStoryContent('story-1', 'token')).rejects.toMatchObject({
			codeMessage: 'UNAUTHORIZED',
			message: 'Sign in to view this story.',
		});

		expect(mocks.getUserRoleInProject).not.toHaveBeenCalled();
		expect(mocks.getLatestVersionByStoryId).not.toHaveBeenCalled();
	});

	it('backfills static chat-linked embeds when persisted fallback is allowed', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion());
		mocks.getStoryQueryData.mockResolvedValue({
			queryData: null,
			cachedAt: null,
			code: ORDERS_TABLE_CODE,
			allowsPersistedFallback: true,
		});
		const fallback = { query_orders: { columns: ['id'], data: [{ id: 2 }] } };
		mocks.backfillMissingQueryDataForSandbox.mockResolvedValue(fallback);

		await expect(loadEmbedStoryContent('story-1', 'token')).resolves.toMatchObject({ queryData: fallback });
		expect(mocks.backfillMissingQueryDataForSandbox).toHaveBeenCalledWith(ORDERS_TABLE_CODE, {
			storyId: 'story-1',
			chatId: 'chat-1',
			projectId: 'project-1',
			userId: 'owner-1',
		});
	});

	it('loads standalone stored data with the Story owner scope', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion({ chatId: null }));
		const queryData = { query_orders: { columns: ['id'], data: [{ id: 3 }] } };
		mocks.backfillMissingQueryDataForSandbox.mockResolvedValue(queryData);

		await expect(loadEmbedStoryContent('story-1', 'token')).resolves.toMatchObject({ queryData });
		expect(mocks.backfillMissingQueryDataForSandbox).toHaveBeenCalledWith(ORDERS_TABLE_CODE, {
			storyId: 'story-1',
			chatId: null,
			projectId: 'project-1',
			userId: 'owner-1',
		});
		expect(mocks.getStoryQueryData).not.toHaveBeenCalled();
	});

	it('rejects restricted viewers for standalone stories', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('viewer');
		mocks.hasEffectiveWarehouseRestrictions.mockResolvedValue(true);
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			storyId: 'story-1',
			chatId: null,
			slug: 'orders',
			title: 'Orders',
			code: '<table query_id="query_orders" />',
			isLive: false,
		});
		mocks.getStoryOwnerId.mockResolvedValue('owner-1');

		await expect(loadEmbedStoryContent('story-1', 'token', 'viewer-1')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
		});

		expect(mocks.hasEffectiveWarehouseRestrictions).toHaveBeenCalledWith('project-1', 'viewer-1');
		expect(mocks.backfillMissingQueryDataForSandbox).not.toHaveBeenCalled();
	});

	it('executes live embeds as the Story owner', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion({ isLive: true, cacheSchedule: '0 * * * *' }));
		mocks.getStoryQueryData.mockResolvedValue({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
			cachedAt: new Date(),
			code: ORDERS_TABLE_CODE,
		});

		await loadEmbedStoryContent('story-1', 'token');

		expect(mocks.getStoryQueryData).toHaveBeenCalledWith(
			'chat-1',
			'orders',
			'<table query_id="query_orders" />',
			true,
			'0 * * * *',
			{ viewerUserId: undefined },
		);
		expect(mocks.backfillMissingQueryDataForSandbox).not.toHaveBeenCalled();
	});

	it('returns refreshed dynamic code with its query data', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(
			storyVersion({
				code: '# Old summary\n<table query_id="query_orders" />',
				isLive: true,
				isLiveTextDynamic: true,
				cacheSchedule: null,
			}),
		);
		mocks.getStoryQueryData.mockResolvedValue({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 2 }] } },
			cachedAt: new Date(),
			code: '# Refreshed summary\n<table query_id="query_orders" />',
		});

		await expect(loadEmbedStoryContent('story-1', 'token')).resolves.toMatchObject({
			code: '# Refreshed summary\n<table query_id="query_orders" />',
			queryData: { query_orders: { columns: ['id'], data: [{ id: 2 }] } },
		});
		expect(mocks.getLatestVersionByStoryId).toHaveBeenCalledOnce();
	});

	it('fails closed for live embeds without an authorized owner', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion({ isLive: true, cacheSchedule: null }));
		mocks.getStoryOwnerId.mockResolvedValue(undefined);

		await expect(loadEmbedStoryContent('story-1', 'token')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
		});
		expect(mocks.getStoryQueryData).not.toHaveBeenCalled();
		expect(mocks.backfillMissingQueryDataForSandbox).not.toHaveBeenCalled();
	});
});

function storyVersion(overrides: Record<string, unknown> = {}) {
	return {
		storyId: 'story-1',
		chatId: 'chat-1',
		slug: 'orders',
		title: 'Orders',
		code: ORDERS_TABLE_CODE,
		isLive: false,
		...overrides,
	};
}
