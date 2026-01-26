import { hashPassword } from 'better-auth/crypto';
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
	modifyUser: protectedProcedure
		.input(z.object({ userId: z.string(), name: z.string().optional() }))
		.mutation(({ input }) => {
			return userQueries.modifyUser(input.userId, { name: input.name });
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
