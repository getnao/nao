import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { registerAssetTools } from '../src/mcp/tools/asset-tools';
import { registerContextLayerTools } from '../src/mcp/tools/context-layer';
import { registerSubAgentTools } from '../src/mcp/tools/sub-agent';

class FakeMcpServer {
	readonly tools = new Map<string, { description?: string }>();

	registerTool(name: string, config: { description?: string }): void {
		this.tools.set(name, config);
	}
}

function createContext(storyCreationEnabled: boolean) {
	return {
		userId: 'user-id',
		projectId: 'project-id',
		settings: {
			contextLayerModeEnabled: true,
			subAgentModeEnabled: true,
		},
		chartDataMode: false,
		storyCreationEnabled,
	} as never;
}

describe('MCP Story creation permission', () => {
	it('omits create_story while retaining existing-Story tools when denied', () => {
		const server = new FakeMcpServer();
		const context = createContext(false);

		registerContextLayerTools(server as never, context);
		registerAssetTools(server as never, context);

		expect([...server.tools.keys()]).not.toContain('create_story');
		expect([...server.tools.keys()]).toEqual(
			expect.arrayContaining(['update_story', 'list_stories', 'get_story', 'archive_story', 'delete_story']),
		);
	});

	it('registers create_story when allowed', () => {
		const server = new FakeMcpServer();

		registerContextLayerTools(server as never, createContext(true));

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
});
