import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { registerAssetTools } from '../src/mcp/tools/asset-tools';
import { registerContextLayerTools } from '../src/mcp/tools/context-layer';
import { registerSubAgentTools } from '../src/mcp/tools/sub-agent';

class FakeMcpServer {
	readonly tools = new Map<string, { description?: string; inputSchema?: Record<string, unknown> }>();

	registerTool(name: string, config: { description?: string; inputSchema?: Record<string, unknown> }): void {
		this.tools.set(name, config);
	}
}

function createContext(storyCreationEnabled: boolean, customStoryCreationEnabled = false) {
	return {
		userId: 'user-id',
		projectId: 'project-id',
		settings: {
			contextLayerModeEnabled: true,
			subAgentModeEnabled: true,
		},
		chartDataMode: false,
		storyCreationEnabled,
		customStoryCreationEnabled,
	} as never;
}

describe('MCP Story creation permission', () => {
	it('omits create_story while retaining existing-Story tools when denied', () => {
		const server = new FakeMcpServer();
		const context = createContext(false);

		registerContextLayerTools(server as never, context, []);
		registerAssetTools(server as never, context);

		expect([...server.tools.keys()]).not.toContain('create_story');
		expect([...server.tools.keys()]).toEqual(
			expect.arrayContaining(['update_story', 'list_stories', 'get_story', 'archive_story', 'delete_story']),
		);
	});

	it('registers create_story when allowed', () => {
		const server = new FakeMcpServer();

		registerContextLayerTools(server as never, createContext(true), []);

		expect([...server.tools.keys()]).toContain('create_story');
	});

	it('does not promise Story creation through ask_nao when denied', () => {
		const server = new FakeMcpServer();

		registerSubAgentTools(server as never, createContext(false));

		const description = server.tools.get('ask_nao')?.description;
		expect(description).toContain('New Story creation is unavailable');
		expect(description).toContain('existing Stories can still be updated');
		expect(description).not.toContain('wants a story created');
	});

	it('tells the client about custom stories only when the user can author them', () => {
		const withCustomStories = new FakeMcpServer();
		const withoutCustomStories = new FakeMcpServer();

		registerSubAgentTools(withCustomStories as never, createContext(true, true));
		registerSubAgentTools(withoutCustomStories as never, createContext(true, false));

		expect(withCustomStories.tools.get('ask_nao')?.description).toContain('CUSTOM STORIES');
		expect(withoutCustomStories.tools.get('ask_nao')?.description).not.toContain('CUSTOM STORIES');
	});

	it('accepts custom story inputs only when the user can author custom stories', () => {
		const allowed = new FakeMcpServer();
		const denied = new FakeMcpServer();

		registerContextLayerTools(allowed as never, createContext(true, true), []);
		registerContextLayerTools(denied as never, createContext(true, false), []);

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
