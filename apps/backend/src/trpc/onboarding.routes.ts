import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import {
	getActiveWarehouseProvisioningJob,
	getWarehouseProvisioningJob,
	startWarehouseProvisioning,
	validateWarehouseCredentials,
} from '../services/warehouse-provisioning';
import { warehouseCredentialsSchema, warehouseProvisioningInputSchema } from '../types/warehouse';
import { organizationProtectedProcedure, protectedProcedure, router } from './trpc';

export const onboardingRoutes = router({
	validateWarehouseCredentials: organizationProtectedProcedure
		.input(warehouseCredentialsSchema)
		.output(z.object({ valid: z.literal(true) }))
		.mutation(({ ctx, input }) => validateWarehouseCredentials(ctx.user.id, input)),

	startWarehouseProvisioning: organizationProtectedProcedure
		.input(warehouseProvisioningInputSchema)
		.output(
			z.object({
				jobId: z.string(),
				status: z.literal('queued'),
			}),
		)
		.mutation(({ ctx, input }) =>
			startWarehouseProvisioning({
				userId: ctx.user.id,
				orgId: ctx.organization.id,
				projectName: buildOnboardingProjectName(ctx.user.name),
				...input,
			}),
		),

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

function buildOnboardingProjectName(userName: string): string {
	const name = userName.trim();
	return name ? `${name}'s project` : 'My project';
}
