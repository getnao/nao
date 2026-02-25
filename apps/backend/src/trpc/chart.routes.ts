import { z } from 'zod/v4';

import { generateChartImage } from '../components/generate-chart';
import { projectProtectedProcedure } from './trpc';

export const chartRoutes = {
	download: projectProtectedProcedure
		.input(
			z.object({
				config: z.object({
					query_id: z.string(),
					chart_type: z.enum(['bar', 'stacked_bar', 'line', 'pie']),
					x_axis_key: z.string(),
					x_axis_type: z.enum(['date', 'number', 'category']).nullable(),
					series: z.array(
						z.object({ data_key: z.string(), color: z.string(), label: z.string().optional() }),
					),
					title: z.string(),
				}),
				data: z.array(z.record(z.string(), z.unknown())),
			}),
		)
		.mutation(({ input }) => {
			const png = generateChartImage({ config: input.config, data: input.data });
			const image = png.toString('base64');
			return image;
		}),
};
