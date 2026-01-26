import { TRPCError } from '@trpc/server';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { z } from 'zod/v4';

import * as accountQueries from '../queries/account.queries';
import * as userQueries from '../queries/user.queries';
import { adminProtectedProcedure, protectedProcedure, publicProcedure } from './trpc';

export const userRoutes = {
	countUsers: publicProcedure.query(() => {
		return userQueries.countUsers();
	}),
	getAllUsers: protectedProcedure.query(() => {
		return userQueries.getAllUsers();
	}),
	getUser: protectedProcedure.input(z.object({ userId: z.string() })).query(async ({ input }) => {
		const user = await userQueries.getUser({ id: input.userId });
		if (!user) {
			return null;
		}
		return user;
	}),
	modifyUser: protectedProcedure
		.input(
			z.object({
				userId: z.string(),
				name: z.string().optional(),
				previousPassword: z.string().optional(),
				newPassword: z.string().min(8).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			if (input.name) {
				await userQueries.modifyUser(input.userId, { name: input.name });
			}

			if (input.previousPassword && input.newPassword) {
				const account = await accountQueries.getUserAccount(input.userId);

				if (!account) {
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: 'User account not found or user does not use password authentication.',
					});
				}

				if (!account.password) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'This account does not use password authentication.',
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
				await accountQueries.updateAccountPassword(account.id, hashedPassword);
			}

			return { success: true };
		}),
	createUser: adminProtectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				email: z.string().min(1),
				password: z.string().min(8),
			}),
		)
		.mutation(async ({ input }) => {
			const userId = crypto.randomUUID();
			const accountId = crypto.randomUUID();

			const hashedPassword = await hashPassword(input.password);

			const user = await userQueries.createUser({
				id: userId,
				name: input.name,
				email: input.email,
			});

			await accountQueries.createAccount({
				id: accountId,
				userId: userId,
				accountId: userId,
				providerId: 'credential',
				password: hashedPassword,
			});

			return user;
		}),
};
