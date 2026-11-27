import '../../src/env';

import type { Tool } from 'ai';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import storyTool, { buildStoryToolDescription } from '../../src/agents/tools/story';
import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { getStoryByChatAndSlug } from '../../src/queries/story.queries';
import { createToolContext, executeTool } from '../helpers/tool-context';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'story-tool-project';
const USER_ID = 'story-tool-user';
const CHAT_ID = 'story-tool-chat';

describe('buildStoryToolDescription maps', () => {
	it('lists the columns each map_type requires', () => {
		const description = buildStoryToolDescription({ mapsEnabled: true });

		expect(description).toContain('map_type="points" needs latitude_key and longitude_key');
		expect(description).toContain('"scatter_bubble" also needs size_key');
		expect(description).toContain(
			'"choropleth" needs value_key plus region_key with region_boundaries or boundaries_url, or geometry_key',
		);
	});

	it('leaves maps out when they are disabled', () => {
		expect(buildStoryToolDescription({ mapsEnabled: false })).not.toContain('<map');
	});
});

describe('story create', () => {
	beforeAll(seed);

	afterAll(() => {
		db.$client.close();
	});

	it('names the story after its title and returns its id', async () => {
		const output = await createStory('Weekly trips');

		const created = await getStoryByChatAndSlug(CHAT_ID, 'weekly-trips');
		expect(created).not.toBeNull();
		expect(output).toMatchObject({ success: true, id: 'weekly-trips', story_id: created!.id });
	});

	it('points a second story with the same title to the existing one by its id', async () => {
		const existing = await getStoryByChatAndSlug(CHAT_ID, 'weekly-trips');

		const output = await createStory('Weekly Trips');

		expect(output).toMatchObject({ success: false, error: expect.stringContaining(`id "${existing!.id}"`) });
	});
});

function createStory(title: string) {
	const tool = storyTool as Tool<{ action: 'create'; title: string; code: string }, Record<string, unknown>>;
	return executeTool(
		tool,
		{ action: 'create', title, code: `# ${title}\n` },
		createToolContext({
			chatId: CHAT_ID,
			userId: USER_ID,
			projectId: PROJECT_ID,
			userGroupFeatures: ['storyCreation'],
		}),
	);
}

async function seed() {
	await db.insert(s.user).values({ id: USER_ID, name: 'Owner', email: 'story-tool@example.com' });
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Stories', type: 'local', path: '/tmp/stories' });
	await db.insert(s.chat).values({ id: CHAT_ID, userId: USER_ID, projectId: PROJECT_ID, title: 'Trips' });
}
