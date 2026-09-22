import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getMcpChartEmbedById, getMcpMapEmbedById } from '../queries/mcp-embed.queries';
import { getMcpQueryData } from '../queries/mcp-query-data.queries';
import { getCustomBoundaries } from '../queries/project.queries';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { embedStoryOpenPath, loadEmbedStoryContent } from '../utils/embed-story';
import { assertProjectMcpEnabled, verifyEmbedToken } from '../utils/embed-token';
import { buildDownloadResponse } from '../utils/story-download';
import { publicProcedure, router } from './trpc';

const tokenInput = z.object({ token: z.string() });

function resolveChartToken(token: string, chartEmbedId: string) {
	const payload = verifyEmbedToken(token);
	if (!payload || payload.type !== 'chart' || payload.resourceId !== chartEmbedId) {
		throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid or expired embed token.' });
	}
	return payload;
}

function resolveMapToken(token: string, mapEmbedId: string) {
	const payload = verifyEmbedToken(token);
	if (!payload || payload.type !== 'map' || payload.resourceId !== mapEmbedId) {
		throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid or expired embed token.' });
	}
	return payload;
}

export const embedRoutes = router({
	getStory: publicProcedure.input(tokenInput.extend({ storyId: z.string() })).query(async ({ input }) => {
		const story = await loadEmbedStoryContent(input.storyId, input.token);
		logAnalyticsEvent({
			projectId: story.projectId,
			type: 'page_view',
			assetType: 'story',
			actorUserId: null,
			storyId: story.storyId,
			chatId: story.chatId,
		});
		return {
			id: story.storyId,
			title: story.title,
			code: story.code,
			queryData: story.queryData,
			openInNaoPath: embedStoryOpenPath({
				storyId: story.storyId,
				chatId: story.chatId,
				slug: story.slug,
			}),
		};
	}),

	getChart: publicProcedure.input(tokenInput.extend({ chartEmbedId: z.string() })).query(async ({ input }) => {
		const payload = resolveChartToken(input.token, input.chartEmbedId);

		const embed = await getMcpChartEmbedById(input.chartEmbedId);
		if (!embed) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Chart embed not found.' });
		}
		if (embed.projectId !== payload.projectId) {
			throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Embed token does not match this chart.' });
		}

		await assertProjectMcpEnabled(embed.projectId);

		const queryData = await getMcpQueryData(embed.queryId, embed.projectId);
		if (!queryData) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Query data not found or expired.' });
		}

		const dbChat =
			typeof queryData.sourceChatId === 'string' && queryData.sourceChatId.trim()
				? queryData.sourceChatId.trim()
				: null;
		const rowChat =
			typeof embed.sourceChatId === 'string' && embed.sourceChatId.trim() ? embed.sourceChatId.trim() : null;
		const sourceChatId = dbChat ?? rowChat;

		return {
			data: queryData.data,
			sourceChatId,
			chartConfig: embed.chartConfig,
		};
	}),

	getMap: publicProcedure.input(tokenInput.extend({ mapEmbedId: z.string() })).query(async ({ input }) => {
		const payload = resolveMapToken(input.token, input.mapEmbedId);

		const embed = await getMcpMapEmbedById(input.mapEmbedId);
		if (!embed) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Map embed not found.' });
		}
		if (embed.projectId !== payload.projectId) {
			throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Embed token does not match this map.' });
		}

		await assertProjectMcpEnabled(embed.projectId);

		const queryData = await getMcpQueryData(embed.queryId, embed.projectId);
		if (!queryData) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Query data not found or expired.' });
		}

		const dbChat =
			typeof queryData.sourceChatId === 'string' && queryData.sourceChatId.trim()
				? queryData.sourceChatId.trim()
				: null;
		const rowChat =
			typeof embed.sourceChatId === 'string' && embed.sourceChatId.trim() ? embed.sourceChatId.trim() : null;
		const sourceChatId = dbChat ?? rowChat;

		const regionKey = embed.mapConfig.region_boundaries;
		const customBoundaries =
			embed.mapConfig.map_type === 'choropleth' && regionKey
				? (await getCustomBoundaries(embed.projectId)).filter((set) => set.key === regionKey)
				: [];

		return {
			data: queryData.data,
			columns: queryData.columns,
			sourceChatId,
			projectId: embed.projectId,
			mapConfig: embed.mapConfig,
			customBoundaries,
		};
	}),

	downloadStory: publicProcedure
		.input(tokenInput.extend({ storyId: z.string(), format: z.enum(['pdf', 'html']) }))
		.mutation(async ({ input }) => {
			const story = await loadEmbedStoryContent(input.storyId, input.token);
			logAnalyticsEvent({
				projectId: story.projectId,
				type: 'download',
				assetType: 'story',
				actorUserId: null,
				storyId: story.storyId,
				chatId: story.chatId,
				metadata: { type: 'download', format: input.format, title: story.title },
			});
			return buildDownloadResponse(input.format, story.title, story.code, story.queryData, story.dateFormat);
		}),
});
