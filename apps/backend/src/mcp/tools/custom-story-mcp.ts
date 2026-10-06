import { STORY_APP_MANIFEST_PATH } from '@nao/shared/story-app';
import { z } from 'zod';

import { renderStoryKitGuide } from '../../components/ai/story-kit-guide';
import type { DBStory } from '../../db/abstractSchema';
import * as storyQueries from '../../queries/story.queries';
import * as storyFileQueries from '../../queries/story-file.queries';
import {
	applyCustomStoryDraftChanges,
	createCustomStoryDraft,
	publishCustomStoryDraft,
} from '../../services/custom-story-authoring';
import { isValidStorySlug, STORY_SLUG_RULE } from '../../utils/story-mount';
import { buildCustomStoryToolResult } from '../embed/embed-tool-result';
import type { McpContext, ToolResult } from '../logging';
import { storyChatUrl, storyUrl } from '../urls';
import { fetchLatestStoryVersion, generateStorySlug, resolveChartChatId } from './helpers';

const CUSTOM_STORY_DATA_RULES =
	'Its blocks read rows by `queryId`, and a custom story only resolves queries run in its chat: run the ' +
	'queries with `ask_nao` first, pass its `chatId` as `chat_id` and use the ids from its `queries`. ' +
	'Query ids from `execute_sql` do not work in a custom story.';

export const CREATE_CUSTOM_STORY_DESCRIPTION =
	'\n\nCUSTOM STORIES: pass `format: "custom"` to create an interactive React app built with @nao/story-kit ' +
	'instead (slides, simulator, what-if sliders, drill-downs, bespoke layouts). It only renders in nao, so the ' +
	`result is the link to share, never an embed. ${CUSTOM_STORY_DATA_RULES} ` +
	`Pass the whole app in \`files\` — \`${STORY_APP_MANIFEST_PATH}\` (\`{ "entry": "app.jsx" }\`), the entry and its ` +
	'imports — instead of `content`: it is built then published. On `buildErrors` nothing is published; fix the ' +
	'files with `update_story`. Omit `files` to get the story-kit starter app back in `sourceFiles` as an ' +
	`unpublished draft.\n\nHOW TO WRITE A CUSTOM STORY:\n${renderStoryKitGuide()}`;

export const UPDATE_CUSTOM_STORY_DESCRIPTION =
	'\n\nCUSTOM STORIES: send `files` (whole files to add or overwrite) and `delete_paths` instead of `content`; ' +
	'files you leave out are kept. Read the current ones from `get_story` (`sourceFiles`) first. The app is ' +
	'built then published as a new version; on `buildErrors` nothing is published, so fix the files and call ' +
	`\`update_story\` again. ${CUSTOM_STORY_DATA_RULES}`;

const STORY_FILES_INPUT = z
	.array(
		z.object({
			path: z.string().describe('Path relative to the story root, e.g. "app.jsx" or "components/kpi.jsx".'),
			content: z.string().describe('Full file content.'),
		}),
	)
	.optional();

export const CREATE_CUSTOM_STORY_INPUT = {
	format: z
		.enum(['classic', 'custom'])
		.optional()
		.describe('"classic" (default) is a markdown story; "custom" is an interactive app (requires `chat_id`).'),
	files: STORY_FILES_INPUT.describe('Custom stories only: the app source files. Omit for the starter app.'),
};

export const UPDATE_CUSTOM_STORY_INPUT = {
	files: STORY_FILES_INPUT.describe('Custom stories only: files to add or overwrite.'),
	delete_paths: z.array(z.string()).optional().describe('Custom stories only: paths of files to remove.'),
};

export async function createCustomStoryForMcp(
	input: { chatId: string | undefined; title: string; files: { path: string; content: string }[] | undefined },
	ctx: McpContext,
): Promise<ToolResult> {
	const chatId = input.chatId ? await resolveChartChatId(input.chatId, ctx) : undefined;
	if (!chatId) {
		return errorResult(
			input.chatId
				? `Chat not found: ${input.chatId}`
				: 'A custom story needs `chat_id`: the `ask_nao` chat whose queries it reads.',
		);
	}
	const slug = generateStorySlug(input.title);
	if (!isValidStorySlug(slug)) {
		return errorResult(`"${input.title}" does not make a valid story id: ${STORY_SLUG_RULE}. Pick another title.`);
	}
	if (await storyQueries.getStoryByChatAndSlug(chatId, slug)) {
		return errorResult(`A story titled "${input.title}" already exists in this chat. Pick another title.`);
	}

	const { story } = await createCustomStoryDraft({ chatId, slug, title: input.title, files: input.files ?? [] });
	return input.files?.length ? publishResult(story, ctx) : draftResult(story);
}

export async function updateCustomStoryForMcp(
	story: DBStory,
	input: { title: string | undefined; files: { path: string; content: string }[]; deletePaths: string[] },
	ctx: McpContext,
): Promise<ToolResult> {
	await applyCustomStoryDraftChanges(story.id, { files: input.files, deletePaths: input.deletePaths });
	if (input.title !== undefined && input.title !== story.title) {
		await storyQueries.renameStory(story.id, input.title);
	}
	return publishResult({ ...story, title: input.title ?? story.title }, ctx);
}

export async function getCustomStoryForMcp(storyId: string, ctx: McpContext): Promise<ToolResult | null> {
	const story = await resolveAccessibleCustomStory(storyId, ctx);
	if (!story) {
		return null;
	}
	const [draft, latest] = await Promise.all([
		storyFileQueries.listDraftFiles(story.id),
		fetchLatestStoryVersion(story),
	]);
	return buildCustomStoryToolResult({
		...storyLinks(story),
		version: latest?.version ?? 0,
		sourceFiles: draft.map((file) => ({ path: file.path, content: file.content })),
	});
}

export async function resolveCustomStory(storyId: string, ctx: McpContext): Promise<DBStory | null> {
	const story = await resolveAccessibleCustomStory(storyId, ctx);
	return story?.chatId ? story : null;
}

async function resolveAccessibleCustomStory(storyId: string, ctx: McpContext): Promise<DBStory | null> {
	const story = await storyQueries.getStoryById(storyId);
	if (!story || story.format !== 'custom') {
		return null;
	}
	if (story.chatId) {
		return (await resolveChartChatId(story.chatId, ctx)) ? story : null;
	}
	const storyProjectId = await storyQueries.getStoryProjectId(storyId);
	return storyProjectId === ctx.projectId && story.userId === ctx.userId ? story : null;
}

async function publishResult(story: DBStory, ctx: McpContext): Promise<ToolResult> {
	const result = await publishCustomStoryDraft(story, ctx, 'user');
	if (result.ok) {
		return buildCustomStoryToolResult({ ...storyLinks(story), version: result.version });
	}
	const latest = await storyQueries.getLatestVersionByChatAndSlug(story.chatId!, story.slug);
	return buildCustomStoryToolResult({
		...storyLinks(story),
		version: latest?.version ?? 0,
		buildErrors: result.buildErrors,
	});
}

async function draftResult(story: DBStory): Promise<ToolResult> {
	const draft = await storyFileQueries.listDraftFiles(story.id);
	return buildCustomStoryToolResult({
		...storyLinks(story),
		version: 0,
		sourceFiles: draft.map((file) => ({ path: file.path, content: file.content })),
	});
}

function storyLinks(story: DBStory) {
	return { id: story.id, title: story.title, url: storyUrl(story.id), chatUrl: storyChatUrl(story) };
}

function errorResult(message: string): ToolResult {
	return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}
