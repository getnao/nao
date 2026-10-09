import { TRPCError } from '@trpc/server';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod/v4';

import { isManagedAiEnabled } from '../agents/managed-ai';
import { isCloud } from '../env';
import * as accountQueries from '../queries/account.queries';
import * as aiUsageQueries from '../queries/ai-usage.queries';
import * as creditWalletQueries from '../queries/credit-wallet.queries';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import * as creditWalletService from '../services/credit-wallet.service';
import { emailService } from '../services/email';
import { buildResetPasswordEmail } from '../utils/email-builders';
import { regexPassword } from '../utils/utils';
import { adminProtectedProcedure, protectedProcedure } from './trpc';

const paginationInput = z
	.object({
		cursor: z.object({ createdAt: z.date(), id: z.string() }).optional(),
		limit: z.number().int().min(1).max(100).default(25),
	})
	.default({ limit: 25 });

/** Credits belong to the selected organization; the welcome grant is claimed lazily on first read. */
const walletProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const membership = await orgQueries.getUserOrgMembership(ctx.user.id, ctx.selectedOrganizationId);
	if (membership && isManagedAiEnabled()) {
		await creditWalletService.ensureWelcomeGrant(membership.orgId, ctx.user.id);
	}
	return next({ ctx: { membership } });
});

export const accountRoutes = {
	getCreditSummary: walletProcedure.query(async ({ ctx }) => {
		const summary = ctx.membership
			? await creditWalletQueries.getCreditSummary(ctx.membership.orgId)
			: { balanceMicroUsd: 0, lifetimeGrantedMicroUsd: 0, lifetimeSpentMicroUsd: 0 };
		return { ...summary, enabled: isManagedAiEnabled() };
	}),
	listCreditLedger: walletProcedure.input(paginationInput).query(({ ctx, input }) => {
		if (!ctx.membership) {
			return { groups: [], nextCursor: null };
		}
		return creditWalletQueries.listCreditLedger(ctx.membership.orgId, input);
	}),
	listAiUsage: walletProcedure.input(paginationInput).query(({ ctx, input }) => {
		if (!ctx.membership) {
			return { runs: [], nextCursor: null };
		}
		const userId = ctx.membership.role === 'admin' ? undefined : ctx.user.id;
		return aiUsageQueries.listAiUsage({ orgId: ctx.membership.orgId, userId }, input);
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
				await emailService.sendEmail(user.email, buildResetPasswordEmail(user, userProject?.name, password));
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
