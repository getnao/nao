import { randomUUID } from 'node:crypto';

import { buildStoryChartBlock } from '@nao/shared';
import type { displayChart } from '@nao/shared/tools';

import * as chatQueries from '../../queries/chat.queries';
import { insertMcpChartEmbed } from '../../queries/mcp-chart-embed.queries';
import { getMcpQueryData, upsertMcpQueryData } from '../../queries/mcp-query-data.queries';
import type { UserStoryRow } from '../../queries/story.queries';
import * as storyQueries from '../../queries/story.queries';
import { logger } from '../../utils/logger';
import { buildStoryToolResult, type ChartToolPayload, type StoryMcpToolPayload } from '../embed/embed-tool-result';
import { buildChartSandboxHtml, buildStorySandboxHtml } from '../embed/sandbox-html';
import { type McpContext, type ToolResult } from '../logging';
import { chartEmbedUrl, chatUrl, storyChatUrl, storyEmbedUrl, storyUrl } from '../urls';

export async function resolveChartChatId(chatId: string | undefined, ctx: McpContext): Promise<string | undefined> {
	if (!chatId) {
		return undefined;
	}
	const ownerId = await chatQueries.getChatOwnerId(chatId);
	if (ownerId !== ctx.userId) {
		logger.warn(`MCP: chat_id ${chatId} does not belong to user ${ctx.userId}, ignoring`, { source: 'tool' });
		return undefined;
	}
	const chatProjectId = await chatQueries.getChatProjectId(chatId);
	if (chatProjectId !== ctx.projectId) {
		logger.warn(`MCP: chat_id ${chatId} is outside project ${ctx.projectId}, ignoring`, { source: 'tool' });
		return undefined;
	}
	return chatId;
}

export async function resolveStory(storyId: string, ctx: McpContext): Promise<UserStoryRow> {
	const story = await storyQueries.getStoryByIdForUser(storyId, ctx.userId);
	if (!story) {
		throw new Error(`Story not found: ${storyId}`);
	}
	const storyProjectId = await storyQueries.getStoryProjectId(storyId);
	if (storyProjectId !== ctx.projectId) {
		throw new Error(`Story not found: ${storyId}`);
	}
	return story;
}

export async function fetchLatestStoryVersion(story: UserStoryRow) {
	return story.chatId
		? storyQueries.getLatestVersionByChatAndSlug(story.chatId, story.slug)
		: storyQueries.getLatestVersionByStoryId(story.id);
}

export async function buildStoryMcpResultWithSandbox(
	output: StoryMcpToolPayload,
	ctx: McpContext,
	code: string | null | undefined,
	chatId?: string | null,
): Promise<ToolResult> {
	const storyId = String(output.id);
	const title = typeof output.title === 'string' ? output.title : 'Story';
	const openInNaoUrl =
		typeof output.url === 'string' ? output.url : storyUrl({ id: storyId, slug: '', chatId: chatId ?? null });

	let sandboxStoryHtml: string | null = null;
	if (code && code.trim().length > 0) {
		try {
			sandboxStoryHtml = await buildStorySandboxHtml({
				title,
				code,
				storyId,
				projectId: ctx.projectId,
				openInNaoUrl,
				chatId: chatId ?? (typeof output.chatId === 'string' ? output.chatId : null),
				userId: ctx.userId,
			});
		} catch (err) {
			logger.warn(`MCP story sandbox HTML failed: ${String(err)}`, { source: 'tool', context: { storyId } });
		}
	}
	return buildStoryToolResult(output, { sandboxStoryHtml });
}

type ChartQueryData = { columns: string[]; data: Record<string, unknown>[]; sourceChatId: string | null };

type ChartKeyError = { invalidKeys: string[]; availableColumns: string[] };

export async function resolveChartQueryData(args: {
	queryId: string;
	ctx: McpContext;
	callLogId: string;
	validatedChatId: string | null;
}): Promise<ChartQueryData | null> {
	const { queryId, ctx, callLogId, validatedChatId } = args;

	const cached = await getMcpQueryData(queryId, ctx.projectId, { userId: ctx.userId });
	if (cached) {
		return cached;
	}

	const fromChat = await findQueryResultAcrossChats({ queryId, ctx, preferredChatId: validatedChatId });
	if (!fromChat) {
		return null;
	}

	await upsertMcpQueryData(queryId, callLogId, ctx.projectId, fromChat.columns, fromChat.data, {
		sourceChatId: fromChat.chatId,
	});
	return { columns: fromChat.columns, data: fromChat.data, sourceChatId: fromChat.chatId };
}

async function findQueryResultAcrossChats(args: {
	queryId: string;
	ctx: McpContext;
	preferredChatId: string | null;
}): Promise<{ columns: string[]; data: Record<string, unknown>[]; chatId: string } | null> {
	const { queryId, ctx, preferredChatId } = args;

	if (preferredChatId) {
		const direct = await chatQueries.getQueryResultByQueryId(preferredChatId, queryId);
		if (direct) {
			return { ...direct, chatId: preferredChatId };
		}
	}

	return chatQueries.getQueryResultByQueryIdInProject(ctx.projectId, ctx.userId, queryId);
}

export async function buildChartEmbedFromArtifact(
	artifact: displayChart.Input,
	ctx: McpContext,
	opts: { chatId: string | null; callLogId: string },
): Promise<{ payload: ChartToolPayload; sandboxChartHtml: string | null } | { keyError: ChartKeyError } | null> {
	const { query_id, chart_type, x_axis_key, x_axis_type, series, title } = artifact;
	const block = buildStoryChartBlock({ query_id, chart_type, x_axis_key, x_axis_type, series, title });

	const queryData = await resolveChartQueryData({
		queryId: query_id,
		ctx,
		callLogId: opts.callLogId,
		validatedChatId: opts.chatId,
	});

	if (!queryData) {
		return null;
	}

	const expectedKeys = x_axis_key ? [x_axis_key, ...series.map((s) => s.data_key)] : series.map((s) => s.data_key);
	const missingKeys = expectedKeys.filter((k) => !queryData.columns.includes(k));
	if (missingKeys.length > 0) {
		return { keyError: { invalidKeys: missingKeys, availableColumns: queryData.columns } };
	}

	const effectiveChatId = opts.chatId ?? queryData.sourceChatId ?? null;

	let chartEmbedId: string | null = null;
	let embedUrl: string | null = null;
	try {
		const id = randomUUID();
		const inserted = await insertMcpChartEmbed({
			chartEmbedId: id,
			queryId: query_id,
			projectId: ctx.projectId,
			chartConfig: { chartType: chart_type, xAxisKey: x_axis_key, xAxisType: x_axis_type, series, title },
			sourceChatId: effectiveChatId,
		});
		if (inserted) {
			chartEmbedId = id;
			embedUrl = chartEmbedUrl(id, ctx.projectId);
		}
	} catch (dbErr) {
		logger.warn(`MCP chart embed persistence failed: ${String(dbErr)}`, { source: 'tool' });
	}

	const naoChatUrl = effectiveChatId ? chatUrl(effectiveChatId) : null;
	let sandboxChartHtml: string | null = null;
	try {
		sandboxChartHtml = buildChartSandboxHtml({
			title,
			chartBlock: block,
			queryId: query_id,
			columns: queryData.columns,
			data: queryData.data,
			naoChatUrl,
		});
	} catch (sandboxErr) {
		logger.warn(`MCP sandbox HTML failed: ${String(sandboxErr)}`, { source: 'tool' });
	}

	const payload: ChartToolPayload = {
		embedUrl,
		chartEmbedId,
		block,
		queryId: query_id,
		title,
		chatId: effectiveChatId,
	};
	return { payload, sandboxChartHtml };
}

export async function buildStoryEmbedFromArtifact(
	storyId: string,
	ctx: McpContext,
): Promise<{ payload: StoryMcpToolPayload; sandboxStoryHtml: string | null } | null> {
	let story: UserStoryRow;
	try {
		story = await resolveStory(storyId, ctx);
	} catch {
		return null;
	}

	const version = await fetchLatestStoryVersion(story);
	const embedUrl = storyEmbedUrl(story.id, ctx.projectId);
	const storyForUrl = { id: story.id, slug: story.slug, chatId: story.chatId };

	const payload: StoryMcpToolPayload = {
		embedUrl,
		id: story.id,
		title: story.title,
		slug: story.slug,
		chatId: story.chatId,
		projectId: story.projectId,
		code: version?.code ?? null,
		version: version?.version ?? null,
		isLive: story.isLive,
		archived: story.archivedAt !== null,
		createdAt: story.createdAt,
		updatedAt: story.updatedAt,
		url: storyUrl(storyForUrl),
		chatUrl: storyChatUrl(storyForUrl),
	};

	const openInNaoUrl = typeof payload.url === 'string' ? payload.url : storyUrl(storyForUrl);
	let sandboxStoryHtml: string | null = null;
	const code = version?.code;
	if (code && code.trim().length > 0) {
		try {
			sandboxStoryHtml = await buildStorySandboxHtml({
				title: story.title,
				code,
				storyId: story.id,
				projectId: ctx.projectId,
				openInNaoUrl,
				chatId: story.chatId,
				userId: ctx.userId,
			});
		} catch (err) {
			logger.warn(`MCP story sandbox HTML failed: ${String(err)}`, {
				source: 'tool',
				context: { storyId: story.id },
			});
		}
	}

	return { payload, sandboxStoryHtml };
}
