import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const STORIES = [
	{ id: 'story-uuid', chatId: 'chat-1', slug: 'sales-report', title: 'Sales report', ownerId: 'user-id' },
	{ id: 'foreign-uuid', chatId: 'chat-2', slug: 'churn', title: 'Churn', ownerId: 'other-user' },
];

const mocks = vi.hoisted(() => ({ stories: [] as typeof STORIES }));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/services/agent', () => ({ agentService: { get: vi.fn() } }));
vi.mock('../../src/agents/profiles/messaging', () => ({ messagingAgent: vi.fn() }));
vi.mock('../../src/agents/profiles/story-model', () => ({ storyModelAgent: vi.fn() }));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', orgId: 'org-id' })),
	getUserRoleInProject: vi.fn(async () => 'user'),
}));
vi.mock('../../src/queries/shared-story.queries', () => ({ getStoryShareRole: vi.fn(async () => null) }));
vi.mock('../../src/queries/story.queries', () => ({
	getStoryById: vi.fn(async (id: string) => toDbStory(mocks.stories.find((story) => story.id === id))),
	getStoryByChatAndSlug: vi.fn(async (chatId: string, slug: string) =>
		toDbStory(mocks.stories.find((story) => story.chatId === chatId && story.slug === slug)),
	),
	getStoryOwnerId: vi.fn(async (id: string) => mocks.stories.find((story) => story.id === id)?.ownerId ?? null),
	getStoryProjectId: vi.fn(async () => 'project-id'),
	getLatestVersionByStoryId: vi.fn(async () => null),
	canUserAccessStory: vi.fn(
		async (id: string, userId: string) => mocks.stories.find((story) => story.id === id)?.ownerId === userId,
	),
}));
vi.mock('../../src/utils/story-summary', () => ({ extractStorySummary: vi.fn(() => '') }));

import { storyRoutes } from '../../src/trpc/story.routes';
import { router } from '../../src/trpc/trpc';

const caller = createTestCaller(router({ story: storyRoutes }));

beforeEach(() => {
	mocks.stories = STORIES;
});

describe('story.resolve', () => {
	it.each([
		{ name: 'its id', input: { storyId: 'story-uuid' } },
		{ name: 'its id within a chat', input: { storyId: 'story-uuid', chatId: 'chat-2' } },
		{ name: 'its slug within its own chat', input: { storyId: 'sales-report', chatId: 'chat-1' } },
	])('finds a story by $name', async ({ input }) => {
		await expect(caller.story.resolve(input)).resolves.toMatchObject({
			storyId: 'story-uuid',
			slug: 'sales-report',
		});
	});

	it.each([
		{ name: 'a slug without a chat', input: { storyId: 'sales-report' } },
		{ name: 'a slug from another chat', input: { storyId: 'sales-report', chatId: 'chat-2' } },
		{ name: 'the slug of a story the user cannot open', input: { storyId: 'churn', chatId: 'chat-2' } },
	])('rejects $name', async ({ input }) => {
		await expect(caller.story.resolve(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});
});

function toDbStory(story: (typeof STORIES)[number] | undefined) {
	return story ? { ...story, format: 'classic', archivedAt: null } : null;
}
