import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { registerStoryFolderTools } from '../src/mcp/tools/story-folders';
import { storyFolderTargetService } from '../src/services/story-folder-target';

type RegisteredHandler = (
	input: Record<string, unknown>,
	extra: never,
) => Promise<{ structuredContent?: Record<string, unknown> }>;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('story folder MCP tools', () => {
	it('registers folder primitives and returns structured IDs', async () => {
		const handlers = new Map<string, RegisteredHandler>();
		const server = {
			registerTool: vi.fn((name: string, _configuration: unknown, handler: RegisteredHandler) => {
				handlers.set(name, handler);
			}),
		} as unknown as McpServer;
		const context = {
			userId: 'user-1',
			projectId: 'project-1',
			settings: {
				enabled: true,
				subAgentModeEnabled: true,
				contextLayerModeEnabled: true,
			},
			chartDataMode: false,
		};
		vi.spyOn(storyFolderTargetService, 'moveStory').mockResolvedValue({
			storyId: 'story-1',
			folderId: 'folder-1',
		});

		registerStoryFolderTools(server, context);

		expect([...handlers.keys()]).toEqual(['list_story_folders', 'create_story_folder', 'move_story_to_folder']);
		const result = await handlers.get('move_story_to_folder')!(
			{ story_id: 'story-1', folder_id: 'folder-1' },
			{} as never,
		);
		expect(storyFolderTargetService.moveStory).toHaveBeenCalledWith(context, {
			storyId: 'story-1',
			folderId: 'folder-1',
		});
		expect(result.structuredContent).toEqual({
			storyId: 'story-1',
			folderId: 'folder-1',
		});
	});
});
