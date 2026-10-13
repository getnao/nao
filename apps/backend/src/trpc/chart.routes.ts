import { isBuiltinChartType } from '@nao/shared/chart-types';
import { displayChart } from '@nao/shared/tools';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { generateChartImage } from '../components/generate-chart';
import { getChartOwnerInfo, getDisplayConfigByToolCallId, updateChartConfig } from '../queries/chart-image';
import { getExecuteSqlPartByQueryIdInChat } from '../queries/execute-sql.queries';
import { getDisplaySettings } from '../queries/project.queries';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { canUserViewChatContent } from '../utils/chat-access';
import { logger } from '../utils/logger';
import { projectProtectedProcedure, protectedProcedure } from './trpc';

export const chartRoutes = {
	download: projectProtectedProcedure
		.input(
			z.object({
				toolCallId: z.string(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const owner = await getChartOwnerInfo(input.toolCallId);
			if (!owner || !(await canUserViewChatContent(owner.chatId, owner.projectId, ctx.user.id))) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Visualization not found.' });
			}
			const config = await readDownloadableChartConfig(input.toolCallId);
			const query = await getExecuteSqlPartByQueryIdInChat(owner.chatId, config.query_id);
			if (!query) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Query ${config.query_id} not found.` });
			}
			const displaySettings = await getDisplaySettings(owner.projectId);
			const png = generateChartImage({
				config,
				data: query.toolOutput.data,
				dateFormat: displaySettings.dateFormat,
			});

			try {
				logAnalyticsEvent({
					projectId: owner.projectId,
					type: 'download',
					assetType: 'chat',
					actorUserId: ctx.user.id,
					chatId: owner.chatId,
					metadata: { type: 'download', format: 'png', queryId: input.toolCallId, title: config.title },
				});
			} catch (error) {
				logger.error(`Failed to log chart download analytics for ${input.toolCallId}: ${String(error)}`, {
					source: 'agent',
					projectId: ctx.project.id,
				});
			}

			return png.toString('base64');
		}),

	updateConfig: protectedProcedure
		.input(
			z.object({
				toolCallId: z.string(),
				config: z.custom<displayChart.Input>((value) => displayChart.InputSchema.safeParse(value).success, {
					message: 'Invalid display config',
				}),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const owner = await getChartOwnerInfo(input.toolCallId);
			if (!owner) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Visualization not found.' });
			}
			if (owner.userId !== ctx.user.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You are not authorized to edit this visualization.',
				});
			}

			await updateChartConfig(input.toolCallId, input.config);
			return { success: true as const };
		}),
};

async function readDownloadableChartConfig(
	toolCallId: string,
): Promise<displayChart.BuiltinChartInput | displayChart.KpiCardInput> {
	const config = await getDisplayConfigByToolCallId(toolCallId);
	if (displayChart.isTableInput(config)) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Chart download is only available for chart visualizations.',
		});
	}
	if (!isBuiltinChartType(config.chart_type)) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Custom charts can only be viewed in the interactive web chat.',
		});
	}
	return { ...config, chart_type: config.chart_type };
}
