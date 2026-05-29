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
import { projectProtectedProcedure, protectedProcedure } from './trpc';

export const chartRoutes = {
	download: projectProtectedProcedure
		.input(
			z.object({
				toolCallId: z.string(),
			}),
		)
		.query(async ({ input }) => {
			const config = await getChartConfigByToolCallId(input.toolCallId);
			const data = await getChartDataByQueryId(config.query_id);
			const png = generateChartImage({ config, data });
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
