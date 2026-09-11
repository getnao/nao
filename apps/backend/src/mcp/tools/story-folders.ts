import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { StoryFolderTargetError, storyFolderTargetService } from '../../services/story-folder-target';
import type { McpContext, ToolResult } from '../logging';
import { registerMcpTool } from './register-mcp-tool';

const STORY_FOLDER_SCHEMA = z.object({
	id: z.string(),
	name: z.string(),
	parentId: z.string().nullable(),
	ownerId: z.string().nullable(),
	visibility: z.enum(['public', 'private']),
	systemType: z.string().nullable(),
	storyCount: z.number().int().nonnegative(),
});

export function registerStoryFolderTools(server: McpServer, context: McpContext): void {
	registerMcpTool(server, context, {
		name: 'list_story_folders',
		title: 'List Story Folders',
		description:
			'List story folders visible to the caller in the current nao project, including stable IDs for later create and move operations.',
		inputSchema: {},
		outputSchema: {
			folders: z.array(STORY_FOLDER_SCHEMA),
		},
		handler: async () =>
			structured({
				folders: await storyFolderTargetService.listFolders(context),
			}),
		errorMessage: targetErrorMessage,
	});

	registerMcpTool(server, context, {
		name: 'create_story_folder',
		title: 'Create Story Folder',
		description:
			'Create a story folder in the current nao project. Omit parent_id for the caller private root, pass a folder ID to preserve a hierarchy, or pass null explicitly for the public root.',
		inputSchema: {
			name: z.string().trim().min(1).max(100),
			parent_id: z.string().nullable().optional(),
		},
		outputSchema: {
			folder: STORY_FOLDER_SCHEMA,
		},
		handler: async ({ name, parent_id }) =>
			structured({
				folder: await storyFolderTargetService.createFolder(context, {
					name,
					parentId: parent_id,
				}),
			}),
		errorMessage: targetErrorMessage,
	});

	registerMcpTool(server, context, {
		name: 'move_story_to_folder',
		title: 'Move Story to Folder',
		description:
			'Move an explicitly identified story into a folder in the current nao project. Pass null to folder_id to move it to the public root.',
		inputSchema: {
			story_id: z.string().min(1),
			folder_id: z.string().nullable(),
		},
		outputSchema: {
			storyId: z.string(),
			folderId: z.string().nullable(),
		},
		handler: async ({ story_id, folder_id }) =>
			structured(
				await storyFolderTargetService.moveStory(context, {
					storyId: story_id,
					folderId: folder_id,
				}),
			),
		errorMessage: targetErrorMessage,
	});
}

function structured(output: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify(output) }],
		structuredContent: output,
	};
}

function targetErrorMessage(error: unknown): string {
	if (error instanceof StoryFolderTargetError) {
		return `${error.code.toUpperCase()}: ${error.message}`;
	}
	return `Story folder operation failed: ${error instanceof Error ? error.message : String(error)}`;
}
