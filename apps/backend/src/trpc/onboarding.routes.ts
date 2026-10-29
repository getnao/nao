import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import { restartOnboarding } from '../services/onboarding-restart';
import {
	getActiveWarehouseProvisioningJob,
	getLatestWarehouseProvisioningJob,
	getWarehouseProvisioningJob,
	retryWarehouseProvisioning,
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
