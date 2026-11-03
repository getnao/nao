import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import {
	assertOrganizationCloudBillingAccess,
	assertUserCloudBillingAccess,
} from '../services/cloud-billing-access.service';
import { restartOnboarding } from '../services/onboarding-restart';
import {
	getActiveWarehouseProvisioningJob,
	getLatestWarehouseProvisioningJob,
	getWarehouseProvisioningJob,
	retryWarehouseProvisioning,
	startWarehouseProvisioning,
	validateWarehouseCredentials,
} from '../services/warehouse-provisioning';
import { warehouseCredentialsSchema, warehouseProvisioningInputSchema } from '../types/warehouse';
import { organizationProtectedProcedure, protectedProcedure, router } from './trpc';

const onboardingMutationProcedure = organizationProtectedProcedure.use(async ({ ctx, next }) => {
	if (ctx.orgRole === 'viewer') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Viewers cannot provision a warehouse project' });
	}
	await assertOrganizationCloudBillingAccess(ctx.organization.id);
	await assertUserCloudBillingAccess(ctx.organization.id, ctx.user.id);
	return next({ ctx });
});

export const onboardingRoutes = router({
	validateWarehouseCredentials: onboardingMutationProcedure
		.input(warehouseCredentialsSchema)
		.output(z.object({ valid: z.literal(true) }))
		.mutation(({ ctx, input }) => validateWarehouseCredentials(ctx.user.id, input)),

	startWarehouseProvisioning: onboardingMutationProcedure
		.input(warehouseProvisioningInputSchema)
		.output(
			z.object({
				jobId: z.string(),
				status: z.literal('queued'),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertOwnsChat(input.onboardingChatId, ctx.user.id);
			return startWarehouseProvisioning({
				userId: ctx.user.id,
				orgId: ctx.organization.id,
				projectName: buildOnboardingProjectName(ctx.user.name),
				...input,
			});
		}),

	retryWarehouseProvisioning: organizationProtectedProcedure
		.input(z.object({ onboardingChatId: z.uuid() }))
		.mutation(async ({ ctx, input }) => {
			await assertOwnsChat(input.onboardingChatId, ctx.user.id);
			return retryWarehouseProvisioning(ctx.user.id, input.onboardingChatId);
		}),

	restartOnboarding: protectedProcedure
		.input(z.object({ onboardingChatId: z.uuid() }))
		.output(z.object({ cancelledWarehouseSetup: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			await assertOwnsChat(input.onboardingChatId, ctx.user.id);
			return restartOnboarding(ctx.user.id, input.onboardingChatId);
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

	getLatestWarehouseProvisioningJob: protectedProcedure
		.input(z.object({ onboardingChatId: z.uuid() }))
		.query(({ ctx, input }) => getLatestWarehouseProvisioningJob(ctx.user.id, input.onboardingChatId)),
});

async function assertOwnsChat(chatId: string, userId: string): Promise<void> {
	if ((await chatQueries.getChatOwnerId(chatId)) !== userId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Onboarding conversation not found' });
	}
}

function buildOnboardingProjectName(userName: string): string {
	const name = userName.trim();
	return name ? `${name}'s project` : 'My project';
}
