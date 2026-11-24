import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SHARED_WITH_ME_FOLDER_ID } from '@nao/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import * as storyFolderQueries from '../../queries/story-folder.queries';
import { type FolderContext, getViewer, moveStoryForUser } from '../../services/story-folder-move.service';
import type { McpContext } from '../logging';
import { jsonToolResult, registerMcpTool } from './register-mcp-tool';

const LIST_STORY_FOLDERS_DESCRIPTION =
	'List the story folders the user can see, with who sees the stories filed in each one.\n\n' +
	'USE WHEN: the user wants to file a story in a folder ("save it in the Marketing folder"): find the folder ' +
	'here, then call `move_story` with its `id`. The first entry is Home, the top level of the stories page.';

const MOVE_STORY_DESCRIPTION =
	'Move a story to one of the folders from `list_story_folders`, Home included, like moving it in nao.\n\n' +
	'Moving a story changes who can see it: a `team` folder shares it with its teams, Home and `project` folders ' +
	'with the whole project, and a `private` folder keeps it to its owner. Tell the user where the story is now and ' +
	'who can see it, in the words of the nao UI (folder names, Home), never with ids or parameters.\n' +
	'Only the owner of the story or an admin can move it.';

const STORY_FOLDER_SCHEMA = z.object({
	id: z.string().nullable().describe('Folder UUID to pass as `folder_id` to `move_story`, null for Home.'),
	name: z.string().describe('Folder name.'),
	parentId: z
		.string()
		.nullable()
		.describe('UUID of the parent folder, null for Home and the folders directly in it.'),
	access: z
		.enum(['private', 'team', 'project'])
		.describe('Who sees the stories filed here: only their owner, the members of `teams`, or the whole project.'),
	teams: z.array(z.string()).describe('Names of the teams that see the folder, when `access` is `team`.'),
});

type StoryFolderListItem = z.infer<typeof STORY_FOLDER_SCHEMA>;

const HOME_FOLDER: StoryFolderListItem = { id: null, name: 'Home', parentId: null, access: 'project', teams: [] };

export function registerStoryFolderTools(server: McpServer, ctx: McpContext): void {
	const folderContext: FolderContext = {
		user: { id: ctx.userId },
		project: { id: ctx.projectId },
		userRole: ctx.role,
	};

	registerMcpTool(server, ctx, {
		name: 'list_story_folders',
		title: 'List Story Folders',
		description: LIST_STORY_FOLDERS_DESCRIPTION,
		inputSchema: {},
		outputSchema: {
			folders: z.array(STORY_FOLDER_SCHEMA).describe('Home, then the folders the user can see, sorted by name.'),
		},
		handler: async () => {
			await storyFolderQueries.ensurePrivateRoot(ctx.userId, ctx.projectId);
			const tree = await storyFolderQueries.listFolderTree(await getViewer(folderContext), ctx.projectId);
			return jsonToolResult({ folders: [HOME_FOLDER, ...tree.filter(isStoryFolder).map(toStoryFolderListItem)] });
		},
	});

	registerMcpTool(server, ctx, {
		name: 'move_story',
		title: 'Move Story',
		description: MOVE_STORY_DESCRIPTION,
		inputSchema: {
			story_id: z
				.string()
				.describe('Story UUID (from `list_stories.id` or `ask_nao.stories[].id`). Not the slug.'),
			folder_id: z
				.string()
				.nullable()
				.describe('Folder UUID from `list_story_folders`, or null for Home (shared with the whole project).'),
		},
		outputSchema: {
			id: z.string().describe('Story UUID that was moved.'),
			folderId: z.string().nullable().describe('UUID of the folder the story is now in, or null for Home.'),
		},
		errorMessage: (error) => (error instanceof TRPCError ? error.message : 'move_story failed. Please try again.'),
		handler: async ({ story_id, folder_id }) => {
			await moveStoryForUser(story_id, folder_id, folderContext);
			return jsonToolResult({ id: story_id, folderId: folder_id });
		},
	});
}

function isStoryFolder(folder: storyFolderQueries.FolderTreeEntry): folder is storyFolderQueries.StoryFolderWithCount {
	return folder.id !== SHARED_WITH_ME_FOLDER_ID;
}

function toStoryFolderListItem(folder: storyFolderQueries.StoryFolderWithCount): StoryFolderListItem {
	return {
		id: folder.id,
		name: folder.name,
		parentId: folder.parentId,
		access: resolveFolderAccess(folder),
		teams: folder.teamGroupNames,
	};
}

function resolveFolderAccess(folder: storyFolderQueries.StoryFolderWithCount): StoryFolderListItem['access'] {
	if (folder.visibility === 'private') {
		return 'private';
	}
	return folder.teamGroupIds.length > 0 ? 'team' : 'project';
}
