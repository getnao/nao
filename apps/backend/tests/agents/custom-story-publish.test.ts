import '../../src/env';

import type { Tool } from 'ai';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import storyTool from '../../src/agents/tools/story';
import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import * as storyFileQueries from '../../src/queries/story-file.queries';
import type { ToolContext } from '../../src/types/tools';
import { createToolContext, executeTool } from '../helpers/tool-context';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

vi.mock('../../src/services/story-mount', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/story-mount')>()),
	isCustomStoriesEnabled: () => true,
	customStoryAuthoringError: () => null,
}));

const onBuild = vi.hoisted(() => ({ current: async () => {} }));
vi.mock('../../src/services/story-app-build', () => ({
	buildStoryApp: async () => {
		await onBuild.current();
		return { ok: true, app: { kind: 'react', bundle: 'bundle' }, entry: 'app.tsx' };
	},
}));

const STORY_ID = 'story-1';

describe('publishing a custom story', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: 'user-1', name: 'User', email: 'user@example.com' });
		await db.insert(s.project).values({
			id: 'project-1',
			name: 'Project',
			type: 'local',
			path: '/tmp/project',
			agentSettings: { storyImages: { allowedSources: ['https://cdn.acme.com/brand'] } },
		});
		await db.insert(s.chat).values({ id: 'chat-1', projectId: 'project-1', userId: 'user-1', title: 'Chat' });
		await db
			.insert(s.story)
			.values({ id: STORY_ID, chatId: 'chat-1', slug: 'revenue', title: 'Revenue', format: 'custom' });
	});

	beforeEach(async () => {
		onBuild.current = async () => {};
		await db.delete(s.storyVersion);
		await db.delete(s.storyDataCache);
		await db.delete(s.storyDraftFile);
		await storyFileQueries.writeDraftFile(STORY_ID, { path: 'app.jsx', content: 'export default () => null;' });
	});

	it('publishes the draft it built, with its bundle', async () => {
		const output = await publish();

		expect(output).toMatchObject({ success: true, version: 1 });
		expect(await db.select().from(s.storyBundle)).toHaveLength(1);
		expect(await db.select().from(s.storyFolderItem)).toHaveLength(1);
	});

	it('refuses to publish when the draft changes during the build', async () => {
		onBuild.current = async () => {
			await storyFileQueries.writeDraftFile(STORY_ID, { path: 'app.jsx', content: 'export default () => 1;' });
		};

		const output = await publish();

		expect(output).toMatchObject({ success: false, error: expect.stringContaining('draft changed') });
		expect(await db.select().from(s.storyVersion)).toEqual([]);
	});

	it.each([
		[
			'an image from a source the project does not allow',
			false,
			'<Image src="https://upload.wikimedia.org/python-logo.svg" alt="" />',
		],
		['an image from an allowed source', true, '<Image src="https://cdn.acme.com/brand/logo.png" alt="" />'],
		[
			'an image without a file extension from a source the project does not allow',
			false,
			'<Image alt="" src="https://images.example.com/photo/123" />',
		],
		['a link to a picture', true, '<a href="https://upload.wikimedia.org/python-logo.svg">Original</a>'],
		['a link to a web page', true, '<p>See https://docs.example.com/guide</p>'],
	])('with %s, publishes: %s', async (_case, published, jsx) => {
		await storyFileQueries.writeDraftFile(STORY_ID, {
			path: 'app.jsx',
			content: `export default () => ${jsx};`,
		});

		const output = await publish();

		expect(output).toMatchObject({ success: published });
		expect(await db.select().from(s.storyVersion)).toHaveLength(published ? 1 : 0);
	});

	it('refuses to publish when a query the story reads returns an image from a source the project does not allow', async () => {
		await storyFileQueries.writeDraftFile(STORY_ID, {
			path: 'app.jsx',
			content:
				'export default () => useQueryData("query_products").data.map((row) => <Image src={row.image} />);',
		});
		const queryResults = new Map([
			[
				'query_products',
				{
					columns: ['image'],
					data: [
						{ image: 'https://cdn.acme.com/brand/logo.png' },
						{ image: 'https://cdn.acme.com/private/secret.jpg' },
					],
				},
			],
		]);

		const output = await publish(queryResults);

		expect(output).toMatchObject({
			success: false,
			error: expect.stringContaining('(https://cdn.acme.com/private/secret.jpg)'),
		});
		expect(await db.select().from(s.storyVersion)).toEqual([]);
	});

	it('drops only the frozen narratives whose text was revised, so their new prose shows', async () => {
		await storyFileQueries.writeDraftFile(STORY_ID, { path: 'app.jsx', content: narrativesApp('Old trend') });
		await expectPublished();
		await db.insert(s.storyDataCache).values({
			storyId: STORY_ID,
			queryData: {},
			querySources: null,
			analysisResults: { summary: 'Frozen summary', trend: 'Frozen trend' },
			cachedAt: new Date(),
		});
		await storyFileQueries.writeDraftFile(STORY_ID, { path: 'app.jsx', content: narrativesApp('New trend') });

		await expectPublished();

		const [cache] = await db.select().from(s.storyDataCache);
		expect(cache.analysisResults).toEqual({ summary: 'Frozen summary' });
	});

	it('keeps the frozen narratives when the same files are published again', async () => {
		await storyFileQueries.writeDraftFile(STORY_ID, { path: 'app.jsx', content: narrativesApp('Old trend') });
		await expectPublished();
		await db.insert(s.storyDataCache).values({
			storyId: STORY_ID,
			queryData: {},
			querySources: null,
			analysisResults: { summary: 'Frozen summary', trend: 'Frozen trend' },
			cachedAt: new Date(),
		});

		await expectPublished();

		const [cache] = await db.select().from(s.storyDataCache);
		expect(cache.analysisResults).toEqual({ summary: 'Frozen summary', trend: 'Frozen trend' });
	});
});

function publish(queryResults: ToolContext['queryResults'] = new Map()) {
	const tool = storyTool as Tool<{ action: 'publish'; id: string }, { success: boolean }>;
	return executeTool(
		tool,
		{ action: 'publish', id: STORY_ID },
		createToolContext({ userGroupFeatures: ['storyCreation', 'customStoryCreation'], queryResults }),
	);
}

async function expectPublished() {
	expect(await publish()).toMatchObject({ success: true });
}

function narrativesApp(trendText: string) {
	return [
		"import { Narrative } from '@nao/story-kit';",
		'export default () => (',
		'\t<>',
		'\t\t<Narrative id="summary">Revenue grew</Narrative>',
		`\t\t<Narrative id="trend">${trendText}</Narrative>`,
		'\t</>',
		');',
	].join('\n');
}
