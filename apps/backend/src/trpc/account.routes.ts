import { TRPCError } from '@trpc/server';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod/v4';

import { isManagedAiEnabled } from '../agents/managed-ai';
import type { DBProject } from '../db/abstractSchema';
import { isCloud } from '../env';
import * as accountQueries from '../queries/account.queries';
import * as creditWalletQueries from '../queries/credit-wallet.queries';
import * as managedAiUsageQueries from '../queries/managed-ai-usage.queries';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import { emailService } from '../services/email';
import { buildResetPasswordEmail } from '../utils/email-builders';
import { regexPassword } from '../utils/utils';
import { adminProtectedProcedure, projectProtectedProcedure, protectedProcedure } from './trpc';

const creditLedgerPaginationInput = z
	.object({
		cursor: z.object({ createdAt: z.date(), id: z.string() }).optional(),
		limit: z.number().int().min(1).max(100).default(25),
	})
	.default({ limit: 25 });

const managedAiUsagePaginationInput = z
	.object({
		cursor: z.object({ startedAt: z.date(), id: z.string() }).optional(),
		limit: z.number().int().min(1).max(100).default(25),
	})
	.default({ limit: 25 });

const walletProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const membership = await orgQueries.getUserOrgMembership(ctx.user.id, ctx.selectedOrganizationId);
	return next({ ctx: { membership } });
});

const walletAdminProcedure = walletProcedure.use(async ({ ctx, next }) => {
	if (ctx.membership?.role !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only organization admins can view wallet activity' });
	}
	return next({ ctx: { membership: ctx.membership } });
});

export const accountRoutes = {
	getManagedCreditStatus: projectProtectedProcedure.query(({ ctx }) => getManagedCreditStatus(ctx.project)),
	getCreditSummary: walletProcedure.query(async ({ ctx }) => {
		const summary = ctx.membership
			? await creditWalletQueries.getCreditSummary(ctx.membership.orgId)
			: { balanceMicroUsd: 0, lifetimeCreditedMicroUsd: 0, lifetimeDebitedMicroUsd: 0 };
		return { ...summary, enabled: isManagedAiEnabled() };
	}),
	listCreditLedger: walletAdminProcedure.input(creditLedgerPaginationInput).query(({ ctx, input }) => {
		return creditWalletQueries.listCreditLedger(ctx.membership.orgId, input);
	}),
	listManagedAiUsage: walletAdminProcedure.input(managedAiUsagePaginationInput).query(({ ctx, input }) => {
		return managedAiUsageQueries.listManagedAiUsage({ orgId: ctx.membership.orgId }, input);
	}),
	resetPassword: adminProtectedProcedure
		.input(
			z.object({
				userId: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			if (isCloud) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin password resets are disabled in nao cloud.' });
			}

			const account = await accountQueries.getAccountById(input.userId);
			if (!account || !account.password) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'User account not found or user does not use password authentication.',
				});
			}

			const userProject = await projectQueries.getProjectByUserId(input.userId);

			if (ctx.project.id !== userProject?.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You do not have permission to reset the password for this user.',
				});
			}

			const password = crypto.randomUUID().slice(0, 8);
			const hashedPassword = await hashPassword(password);

			await accountQueries.updateAccountPassword(account.id, hashedPassword, input.userId);

			const user = await userQueries.getUser({ id: input.userId });

			if (user) {
				await emailService.sendEmail(
					user.email,
					await buildResetPasswordEmail(user, userProject?.name, password),
				);
			}

			return { password };
		}),
	modifyPassword: protectedProcedure
		.input(
			z.object({
				newPassword: z.string(),
				confirmPassword: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const account = await accountQueries.getAccountById(ctx.user.id);
			if (!account || !account.password) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'User account not found or user does not use password authentication.',
				});
			}

			if (input.newPassword !== input.confirmPassword) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Passwords do not match.',
				});
			}

			if (!regexPassword.test(input.newPassword)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message:
						'New password must be at least 8 characters long and include uppercase, lowercase, number, and special character.',
				});
			}

			const hashedPassword = await hashPassword(input.newPassword);

			await accountQueries.updateAccountPassword(account.id, hashedPassword, ctx.user.id, false);
		}),
};

async function getManagedCreditStatus(project: Pick<DBProject, 'orgId'>) {
	if (!project.orgId) {
		return {
			enabled: isManagedAiEnabled(),
			organization: null,
			balanceMicroUsd: 0,
		};
	}
	const [organization, summary] = await Promise.all([
		orgQueries.getOrganizationById(project.orgId),
		creditWalletQueries.getCreditSummary(project.orgId),
	]);
	return {
		enabled: isManagedAiEnabled(),
		organization: organization ? { id: organization.id, name: organization.name } : null,
		balanceMicroUsd: summary.balanceMicroUsd,
	};
}
