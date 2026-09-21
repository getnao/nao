import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { listChartPlugins, readChartPlugin } from '../services/chart-plugin';
import { projectProtectedProcedure } from './trpc';

export const chartPluginRoutes = {
	list: projectProtectedProcedure.query(({ ctx }) => listChartPlugins(ctx.project.path ?? '')),

	source: projectProtectedProcedure
		.input(
			z.object({
				type: z.string().regex(/^[a-z][a-z0-9_-]*$/),
				version: z.string(),
			}),
		)
		.query(({ input, ctx }) => {
			const plugin = readChartPlugin(ctx.project.path ?? '', input.type);
			if (!plugin) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Custom chart "${input.type}" was not found.` });
			}
			return { source: plugin.source, version: plugin.entry.version };
		}),
};
