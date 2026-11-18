import { z } from 'zod/v4';

import { getAutomationsMonitoring } from '../services/monitoring-automations.service';
import { MONITORING_RANGES } from '../types/monitoring';
import { automationAdminProcedure } from './automation.routes';

const rangeInputSchema = z.object({ range: z.enum(MONITORING_RANGES) });

export const monitoringRoutes = {
	getAutomations: automationAdminProcedure.input(rangeInputSchema).query(async ({ ctx, input }) => {
		return getAutomationsMonitoring(ctx.project.id, input.range);
	}),
};
