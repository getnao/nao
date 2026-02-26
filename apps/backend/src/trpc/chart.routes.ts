import { z } from 'zod/v4';

import { generateChartImage } from '../components/generate-chart';
import { getChartConfigByToolCallId, getChartDataByQueryId } from '../queries/chart-image';
import { projectProtectedProcedure } from './trpc';

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
};
