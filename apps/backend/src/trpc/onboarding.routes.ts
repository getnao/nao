import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as organizationQueries from '../queries/organization.queries';
import {
	getActiveWarehouseProvisioningJob,
	getWarehouseProvisioningJob,
	startWarehouseProvisioning,
} from '../services/warehouse-provisioning';
import { warehouseProvisioningInputSchema } from '../types/warehouse';
import { protectedProcedure, router } from './trpc';

export const onboardingRoutes = router({
	startWarehouseProvisioning: protectedProcedure
		.input(warehouseProvisioningInputSchema)
		.output(
			z.object({
				jobId: z.string(),
				status: z.literal('queued'),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const membership = await organizationQueries.getUserOrgMembership(ctx.user.id, ctx.selectedOrganizationId);

			if (!membership) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'You are not a member of an organization',
				});
			}

			return startWarehouseProvisioning({
				userId: ctx.user.id,
				orgId: membership.orgId,
				...input,
			});
		}),

	getWarehouseProvisioningStatus: protectedProcedure
		.input(z.object({ jobId: z.uuid() }))
		.query(async ({ ctx, input }) => {
			const job = await getWarehouseProvisioningJob(input.jobId, ctx.user.id);
			if (!job) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Warehouse setup job not found',
				});
			}
			return job;
		}),

	getActiveWarehouseProvisioningJob: protectedProcedure
		.input(z.object({ onboardingChatId: z.uuid() }))
		.query(({ ctx, input }) => getActiveWarehouseProvisioningJob(ctx.user.id, input.onboardingChatId)),
});
