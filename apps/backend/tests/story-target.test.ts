import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import type { DBStory, DBStoryVersion } from '../src/db/abstractSchema';
import type { UserStoryRow } from '../src/queries/story.queries';
import { type StoryTargetDependencies, StoryTargetService } from '../src/services/story-target';

const context = { userId: 'user-1', projectId: 'project-1' };
const now = new Date('2026-01-01T00:00:00Z');

const userStory = (overrides: Partial<UserStoryRow> = {}): UserStoryRow => ({
	id: 'story-1',
	chatId: null,
	projectId: 'project-1',
	userId: 'user-1',
	slug: 'sales',
	title: 'Sales',
	isLive: false,
	isLiveTextDynamic: true,
	cacheSchedule: null,
	cacheScheduleDescription: null,
	archivedAt: null,
	createdAt: now,
	updatedAt: now,
	code: '# Sales\n',
	version: 1,
	...overrides,
});

const dbStory = (overrides: Partial<DBStory> = {}): DBStory => ({
	id: 'story-1',
	chatId: null,
	projectId: 'project-1',
	userId: 'user-1',
	slug: 'sales',
	title: 'Sales',
	isLive: false,
	isLiveTextDynamic: true,
	cacheSchedule: null,
	cacheScheduleDescription: null,
	scheduledJobId: null,
	archivedAt: null,
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const version: DBStoryVersion & { title: string } = {
	id: 'version-2',
	storyId: 'story-1',
	version: 2,
	code: '# Updated\n',
	action: 'update',
	source: 'user',
	createdAt: now,
	title: 'Updated',
};

const createDependencies = () =>
	({
		createStandaloneStory: vi.fn(async () => ({
			id: 'story-1',
			slug: 'sales-report',
			title: 'Sales Report',
			createdAt: now,
			version: 1,
		})),
		saveStoryInPrivateRoot: vi.fn(async () => {}),
		getStoryByIdForUser: vi.fn(async () => userStory()),
		getStoryProjectId: vi.fn(async () => 'project-1'),
		renameStory: vi.fn(async () => {}),
		createStoryVersion: vi.fn(async () => version),
		getStoryByChatAndSlug: vi.fn(async () => dbStory({ chatId: 'chat-1', projectId: null, userId: null })),
		createStandaloneVersion: vi.fn(async () => version),
		getStandaloneStoryByUserAndSlug: vi.fn(async () => dbStory({ title: 'Updated' })),
	}) satisfies StoryTargetDependencies;

describe('story target service', () => {
	it('creates standalone stories in private root and reports slug collisions', async () => {
		const dependencies = createDependencies();
		const service = new StoryTargetService(dependencies);

		await expect(service.createStandaloneStory(context, { title: 'Sales Report' })).resolves.toMatchObject({
			id: 'story-1',
			slug: 'sales-report',
			chatId: null,
		});
		expect(dependencies.createStandaloneStory).toHaveBeenCalledWith({
			userId: 'user-1',
			projectId: 'project-1',
			slug: 'sales-report',
			title: 'Sales Report',
			code: '# Sales Report\n',
			source: 'user',
		});
		expect(dependencies.saveStoryInPrivateRoot).toHaveBeenCalledWith('user-1', 'project-1', 'story-1');

		dependencies.createStandaloneStory.mockResolvedValueOnce(null);
		await expect(service.createStandaloneStory(context, { title: 'Sales Report!' })).rejects.toMatchObject({
			code: 'conflict',
		});
	});

	it('updates standalone stories only by their explicit UUID', async () => {
		const dependencies = createDependencies();
		const service = new StoryTargetService(dependencies);

		await expect(
			service.updateStoryById(context, {
				storyId: 'story-uuid',
				title: 'Updated',
				code: '# Updated\n',
			}),
		).resolves.toMatchObject({
			story: { id: 'story-1', slug: 'sales', chatId: null },
			code: '# Updated\n',
			updated: { id: 'story-1', title: 'Updated' },
		});
		expect(dependencies.getStoryByIdForUser).toHaveBeenCalledWith('story-uuid', 'user-1');
		expect(dependencies.renameStory).toHaveBeenCalledWith('story-1', 'Updated');
		expect(dependencies.createStandaloneVersion).toHaveBeenCalledWith({
			userId: 'user-1',
			projectId: 'project-1',
			slug: 'sales',
			title: 'Updated',
			code: '# Updated\n',
			action: 'update',
			source: 'user',
		});
	});

	it('preserves chat-linked revisions and rejects cross-project story IDs', async () => {
		const dependencies = createDependencies();
		dependencies.getStoryByIdForUser.mockResolvedValueOnce(userStory({ chatId: 'chat-1' }));
		const service = new StoryTargetService(dependencies);

		await service.updateStoryById(context, { storyId: 'story-1', code: '# Updated\n' });
		expect(dependencies.createStoryVersion).toHaveBeenCalledWith({
			chatId: 'chat-1',
			slug: 'sales',
			title: 'Sales',
			code: '# Updated\n',
			action: 'update',
			source: 'user',
		});

		dependencies.getStoryProjectId.mockResolvedValueOnce('project-2');
		await expect(service.updateStoryById(context, { storyId: 'story-2' })).rejects.toMatchObject({
			code: 'not_found',
		});
		expect(dependencies.createStandaloneVersion).not.toHaveBeenCalled();
	});
});
