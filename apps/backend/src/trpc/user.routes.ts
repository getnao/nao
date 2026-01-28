import { TRPCError } from '@trpc/server';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { z } from 'zod/v4';

import * as accountQueries from '../queries/account.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import { regexPassword } from '../utils/utils';
import { adminProtectedProcedure, projectProtectedProcedure, protectedProcedure, publicProcedure } from './trpc';

export const userRoutes = {
	countAll: publicProcedure.query(() => {
		return userQueries.countAll();
	}),
	get: projectProtectedProcedure.input(z.object({ userId: z.string() })).query(async ({ input, ctx }) => {
		if (ctx.userRole !== 'admin' && input.userId !== ctx.user.id) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can access other users information' });
		}

		const user = await userQueries.get({ id: input.userId });
		if (!user) {
			return null;
		}
		return user;
	}),
	modify: protectedProcedure
		.input(
			z.object({
				userId: z.string(),
				name: z.string().optional(),
				previousPassword: z.string().optional(),
				newPassword: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			if (input.previousPassword && input.newPassword) {
				if (!regexPassword.test(input.newPassword)) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message:
							'New password must be at least 8 characters long and include uppercase, lowercase, number, and special character.',
					});
				}

				const account = await accountQueries.getAccountById(input.userId);
				if (!account || !account.password) {
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: 'User account not found or user does not use password authentication.',
					});
				}

				const isPasswordValid = await verifyPassword({
					hash: account.password,
					password: input.previousPassword,
				});
				if (!isPasswordValid) {
					throw new TRPCError({
						code: 'UNAUTHORIZED',
						message: 'Previous password is incorrect.',
					});
				}

				const hashedPassword = await hashPassword(input.newPassword);
				await accountQueries.updateAccountAndUser(account.id, hashedPassword, input.userId, input.name);
			} else if (input.name) {
				await userQueries.modify(input.userId, { name: input.name });
			}
		}),
	createUserAndAddToProject: adminProtectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				email: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const userId = crypto.randomUUID();
			const accountId = crypto.randomUUID();

			const password = crypto.randomUUID().slice(0, 8);
			const hashedPassword = await hashPassword(password);

			const project = await projectQueries.getProjectById(ctx.project.id);

			const newUser = await userQueries.create(
				{
					id: userId,
					name: input.name,
					email: input.email,
				},
				{
					id: accountId,
					userId: userId,
					accountId: userId,
					providerId: 'credential',
					password: hashedPassword,
				},
				{
					userId: '',
					projectId: project?.id || '',
					role: 'user',
				},
			);

			return { newUser, password };
		}),
};
