import { STORY_APP_MANIFEST_PATH } from '@nao/shared/story-app';
import { z } from 'zod';

import { renderStoryKitGuide } from '../../components/ai/story-kit-guide';
import type { DBStory } from '../../db/abstractSchema';
import * as storyQueries from '../../queries/story.queries';
import type { StoryFileInput } from '../../queries/story-file.queries';
import * as storyFileQueries from '../../queries/story-file.queries';
import {
	applyCustomStoryDraftChanges,
	createCustomStoryDraft,
	publishCustomStoryDraft,
} from '../../services/custom-story-authoring';
import { generateStorySlug, isValidStorySlug, STORY_SLUG_RULE } from '../../utils/story-mount';
import {
	backfillMissingQueryDataByIds,
	extractCustomStoryQueryIds,
	type StoryQueryDataMap,
} from '../../utils/story-query-data';
import { buildCustomStoryToolResult } from '../embed/embed-tool-result';
import type { McpContext, ToolResult } from '../logging';
import { storyChatUrl, storyUrl } from '../urls';
import { fetchLatestStoryVersion, resolveChartChatId } from './helpers';

const CUSTOM_STORY_DATA_RULES =
	'Its blocks read rows by `queryId`. Attached to a chat (`chat_id` from `ask_nao`), it resolves the queries ' +
	'run in that chat: use the ids from its `queries`. Without `chat_id` it is a standalone story that reads the ' +
	'rows saved with it: use `query_id`s from `execute_sql`, or pass the rows of other queries in `query_data`.';

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

const CHAT_QUERY_DATA_REFUSAL =
	'`query_data` only applies to a standalone custom story: one attached to a chat reads the queries run in it.';

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
		.describe('"classic" (default) is a markdown story; "custom" is an interactive app.'),
	files: STORY_FILES_INPUT.describe('Custom stories only: the app source files. Omit for the starter app.'),
};

export const UPDATE_CUSTOM_STORY_INPUT = {
	files: STORY_FILES_INPUT.describe('Custom stories only: files to add or overwrite.'),
	delete_paths: z.array(z.string()).optional().describe('Custom stories only: paths of files to remove.'),
};

export async function createCustomStoryForMcp(
	input: {
		chatId: string | undefined;
		title: string;
		files: StoryFileInput[] | undefined;
		queryData: StoryQueryDataMap | undefined;
	},
	ctx: McpContext,
): Promise<ToolResult> {
	const chatId = input.chatId ? await resolveChartChatId(input.chatId, ctx) : undefined;
	if (input.chatId && !chatId) {
		return errorResult(`Chat not found: ${input.chatId}`);
	}
	if (chatId && input.queryData) {
		return errorResult(CHAT_QUERY_DATA_REFUSAL);
	}
	const slug = generateStorySlug(input.title);
	if (!isValidStorySlug(slug)) {
		return errorResult(`"${input.title}" does not make a valid story id: ${STORY_SLUG_RULE}. Pick another title.`);
	}
	const existing = chatId
		? await storyQueries.getStoryByChatAndSlug(chatId, slug)
		: await storyQueries.getStandaloneStoryByUserAndSlug(ctx.userId, ctx.projectId, slug);
	if (existing) {
		return errorResult(
			`A story titled "${input.title}" already exists${chatId ? ' in this chat' : ''}. Pick another title.`,
		);
	}

	const ownership = chatId ? { chatId } : { projectId: ctx.projectId, userId: ctx.userId };
	const { story } = await createCustomStoryDraft({
		...ownership,
		slug,
		title: input.title,
		files: input.files ?? [],
	});
	if (!story.chatId) {
		await saveStandaloneQueryData(story.id, input.queryData, ctx);
	}
	if (!input.files?.length) {
		return draftResult(story);
	}
	return publishResult(story, ctx);
}

export async function updateCustomStoryForMcp(
	story: DBStory,
	input: {
		title: string | undefined;
		files: StoryFileInput[];
		deletePaths: string[];
		queryData: StoryQueryDataMap | undefined;
	},
	ctx: McpContext,
): Promise<ToolResult> {
	if (story.chatId && input.queryData) {
		return errorResult(CHAT_QUERY_DATA_REFUSAL);
	}
	await applyCustomStoryDraftChanges(story.id, { files: input.files, deletePaths: input.deletePaths });
	if (input.title !== undefined && input.title !== story.title) {
		await storyQueries.renameStory(story.id, input.title);
	}
	if (!story.chatId) {
		await saveStandaloneQueryData(story.id, input.queryData, ctx, { keepSavedRows: true });
	}
	const publishedQueryData = story.chatId ? undefined : input.queryData;
	return publishResult({ ...story, title: input.title ?? story.title }, ctx, publishedQueryData);
}

export async function getCustomStoryForMcp(storyId: string, ctx: McpContext): Promise<ToolResult | null> {
	const story = await resolveCustomStory(storyId, ctx);
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

async function publishResult(
	story: DBStory,
	ctx: McpContext,
	publishedQueryData?: StoryQueryDataMap,
): Promise<ToolResult> {
	const result = await publishCustomStoryDraft(story, ctx, 'user');
	if (result.ok) {
		if (publishedQueryData) {
			await saveStandaloneQueryData(story.id, publishedQueryData, ctx);
		}
		return buildCustomStoryToolResult({ ...storyLinks(story), version: result.version });
	}
	const latest = await storyQueries.getLatestVersionByStoryId(story.id);
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

/** A standalone story has no chat to run its queries in, so the rows its draft references are saved with it. */
async function saveStandaloneQueryData(
	storyId: string,
	queryData: StoryQueryDataMap | undefined,
	ctx: McpContext,
	options: { keepSavedRows?: boolean } = {},
): Promise<void> {
	const [draft, cache] = await Promise.all([
		storyFileQueries.listDraftFiles(storyId),
		storyQueries.getStoryDataCacheByStoryId(storyId),
	]);
	const saved = (cache?.queryData as StoryQueryDataMap | undefined) ?? {};
	const supplied = queryData ?? {};
	const seeded = options.keepSavedRows ? { ...supplied, ...saved } : { ...saved, ...supplied };
	const resolved = await backfillMissingQueryDataByIds(
		extractCustomStoryQueryIds(draft),
		Object.keys(seeded).length > 0 ? seeded : null,
		{ projectId: ctx.projectId, userId: ctx.userId },
	);
	if (resolved) {
		await storyQueries.upsertStoryDataCacheByStoryId(storyId, resolved);
	}
}

function storyLinks(story: DBStory) {
	return { id: story.id, title: story.title, url: storyUrl(story.id), chatUrl: storyChatUrl(story) };
}

function errorResult(message: string): ToolResult {
	return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}
