import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/utils/llm', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/utils/llm')>()),
	getProjectAvailableModels: vi
		.fn()
		.mockResolvedValue([
			{ provider: 'mistral', modelId: 'mistral-large-4', name: 'Mistral Large 4', baseUrl: null },
		]),
	resolveDefaultChatModel: vi.fn().mockResolvedValue({ provider: 'mistral', modelId: 'mistral-large-4' }),
}));

import { registerAssetTools } from '../../src/mcp/tools/asset-tools';
import { registerContextLayerTools } from '../../src/mcp/tools/context-layer';
import { registerSubAgentTools } from '../../src/mcp/tools/sub-agent';
import { createMcpContext, FakeMcpServer } from '../helpers/fake-mcp-server';

describe('MCP Story creation permission', () => {
	it('omits create_story while retaining existing-Story tools when denied', () => {
		const server = new FakeMcpServer();
		const context = createMcpContext();

		registerContextLayerTools(server.asMcpServer(), context, []);
		registerAssetTools(server.asMcpServer(), context);

		expect([...server.tools.keys()]).not.toContain('create_story');
		expect([...server.tools.keys()]).toEqual(
			expect.arrayContaining(['update_story', 'list_stories', 'get_story', 'archive_story', 'delete_story']),
		);
	});

	it('registers create_story when allowed', () => {
		const server = new FakeMcpServer();

		registerContextLayerTools(server.asMcpServer(), createMcpContext({ storyCreationEnabled: true }), []);

		expect([...server.tools.keys()]).toContain('create_story');
	});

	it('does not promise Story creation through ask_nao when denied', async () => {
		const server = new FakeMcpServer();

		await registerSubAgentTools(server.asMcpServer(), createMcpContext());

		const description = server.tools.get('ask_nao')?.description;
		expect(description).toContain('New Story creation is unavailable');
		expect(description).toContain('existing Stories can still be updated');
		expect(description).not.toContain('wants a story created');
	});

	it('tells the client about custom stories only when the user can author them', async () => {
		const withCustomStories = new FakeMcpServer();
		const withoutCustomStories = new FakeMcpServer();

		await registerSubAgentTools(
			withCustomStories.asMcpServer(),
			createMcpContext({ storyCreationEnabled: true, customStoryCreationEnabled: true }),
		);
		await registerSubAgentTools(
			withoutCustomStories.asMcpServer(),
			createMcpContext({ storyCreationEnabled: true }),
		);

		expect(withCustomStories.tools.get('ask_nao')?.description).toContain('CUSTOM STORIES');
		expect(withoutCustomStories.tools.get('ask_nao')?.description).not.toContain('CUSTOM STORIES');
	});

	it('accepts custom story inputs only when the user can author custom stories', () => {
		const allowed = new FakeMcpServer();
		const denied = new FakeMcpServer();

		registerContextLayerTools(
			allowed.asMcpServer(),
			createMcpContext({ storyCreationEnabled: true, customStoryCreationEnabled: true }),
			[],
		);
		registerContextLayerTools(denied.asMcpServer(), createMcpContext({ storyCreationEnabled: true }), []);

		expect(Object.keys(allowed.tools.get('create_story')?.inputSchema ?? {})).toEqual(
			expect.arrayContaining(['format', 'files']),
		);
		expect(Object.keys(allowed.tools.get('update_story')?.inputSchema ?? {})).toEqual(
			expect.arrayContaining(['files', 'delete_paths']),
		);
		expect(Object.keys(denied.tools.get('create_story')?.inputSchema ?? {})).not.toContain('format');
		expect(Object.keys(denied.tools.get('update_story')?.inputSchema ?? {})).not.toContain('files');
	});
});
