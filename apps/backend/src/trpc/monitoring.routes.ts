import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { env } from '../env';
import { getAutomationsMonitoring } from '../services/monitoring-automations.service';
import { MONITORING_RANGES } from '../types/monitoring';
import { adminProtectedProcedure } from './trpc';

const rangeInputSchema = z.object({ range: z.enum(MONITORING_RANGES) });

export const monitoringRoutes = {
	getAutomations: adminProtectedProcedure.input(rangeInputSchema).query(async ({ ctx, input }) => {
		if (!env.BETA_AUTOMATIONS_ENABLED) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Automations are disabled on this instance.' });
		}
		return getAutomationsMonitoring(ctx.project.id, input.range);
	}),
};
