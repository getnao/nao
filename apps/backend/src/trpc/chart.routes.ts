import { displayChart } from '@nao/shared/tools';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { generateChartImage } from '../components/generate-chart';
import {
	getChartConfigByToolCallId,
	getChartDataByQueryId,
	getChartOwnerInfo,
	updateChartConfig,
} from '../queries/chart-image';
import { getDisplaySettings } from '../queries/project.queries';
import { logAnalyticsEvent } from '../utils/analytics-event';
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
			const config = await getChartConfigByToolCallId(input.toolCallId);
			const data = await getChartDataByQueryId(config.query_id);
			const displaySettings = await getDisplaySettings(ctx.project.id);
			const png = generateChartImage({ config, data, dateFormat: displaySettings.dateFormat });

			try {
				const owner = await getChartOwnerInfo(input.toolCallId);
				if (owner?.chatId) {
					logAnalyticsEvent({
						projectId: ctx.project.id,
						type: 'download',
						assetType: 'chat',
						actorUserId: ctx.user.id,
						chatId: owner.chatId,
						metadata: { type: 'download', format: 'png', queryId: input.toolCallId, title: config.title },
					});
				}
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
					message: 'Invalid chart config',
				}),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const owner = await getChartOwnerInfo(input.toolCallId);
			if (!owner) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chart not found.' });
			}
			if (owner.userId !== ctx.user.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You are not authorized to edit this chart.',
				});
			}

			await updateChartConfig(input.toolCallId, input.config);
			return { success: true as const };
		}),
};
