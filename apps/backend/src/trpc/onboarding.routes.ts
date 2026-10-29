import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import {
	getActiveWarehouseProvisioningJob,
	getWarehouseProvisioningJob,
	startWarehouseProvisioning,
	submitWarehouseContextSources,
	validateConfluenceContext,
	validateNotionContext,
	validateWarehouseCredentials,
} from '../services/warehouse-provisioning';
import {
	confluenceContextSourceSchema,
	confluenceContextValidationResultSchema,
	notionContextSourceSchema,
	notionContextValidationResultSchema,
	warehouseContextSourcesInputSchema,
	warehouseCredentialsSchema,
	warehouseProvisioningInputSchema,
	warehouseValidationResultSchema,
} from '../types/warehouse';
import { organizationProtectedProcedure, protectedProcedure, router } from './trpc';

export const onboardingRoutes = router({
	validateWarehouseCredentials: organizationProtectedProcedure
		.input(warehouseCredentialsSchema)
		.output(warehouseValidationResultSchema)
		.mutation(({ ctx, input }) => validateWarehouseCredentials(ctx.user.id, input)),

	validateNotionContext: organizationProtectedProcedure
		.input(notionContextSourceSchema)
		.output(notionContextValidationResultSchema)
		.mutation(({ input }) => validateNotionContext(input)),

	validateConfluenceContext: organizationProtectedProcedure
		.input(confluenceContextSourceSchema)
		.output(confluenceContextValidationResultSchema)
		.mutation(({ input }) => validateConfluenceContext(input)),

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

	submitWarehouseContextSources: organizationProtectedProcedure
		.input(warehouseContextSourcesInputSchema)
		.output(z.object({ status: z.literal('syncing') }))
		.mutation(async ({ ctx, input }) => {
			await submitWarehouseContextSources(input.jobId, ctx.user.id, input.contextSources, input.businessContext);
			return { status: 'syncing' as const };
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

function buildOnboardingProjectName(userName: string): string {
	const name = userName.trim();
	return name ? `${name}'s project` : 'My project';
}
