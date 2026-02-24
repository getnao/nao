import { TRPCError } from '@trpc/server';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod/v4';

import * as memoryQueries from '../queries/memory';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import { emailService } from '../services/email.service';
import { memoryService } from '../services/memory';
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
	modify: projectProtectedProcedure
		.input(
			z.object({
				userId: z.string(),
				name: z.string().optional(),
				newRole: z.enum(['user', 'viewer', 'admin']).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const previousRole = await projectQueries.getUserRoleInProject(ctx.project.id, input.userId);

			if (previousRole === 'admin' && input.newRole && input.newRole !== 'admin') {
				const moreThanOneAdmin = await projectQueries.checkProjectHasMoreThanOneAdmin(ctx.project.id);
				if (!moreThanOneAdmin) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'The project must have at least one admin user.',
					});
				}
			}
			const previousName = await userQueries.getName(input.userId);

			if (ctx.project && input.newRole && input.newRole !== previousRole) {
				await projectQueries.updateProjectMemberRole(ctx.project.id, input.userId, input.newRole);
			}
			if (ctx.project && input.name && input.name !== previousName) {
				await userQueries.modify(input.userId, input.name);
			}
		}),
	addUserToProject: adminProtectedProcedure
		.input(
			z.object({
				email: z.string().min(1),
				name: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const user = await userQueries.get({ email: input.email });

			if (!user) {
				if (!input.name) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'USER_DOES_NOT_EXIST' });
				}
				const userId = crypto.randomUUID();
				const accountId = crypto.randomUUID();

				const password = crypto.randomUUID().slice(0, 8);
				const hashedPassword = await hashPassword(password);

				const newUser = await userQueries.create(
					{
						id: userId,
						name: input.name!,
						email: input.email,
						requiresPasswordReset: true,
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
						projectId: ctx.project?.id || '',
						role: 'user',
					},
				);

				await emailService.safeSendEmail({
					user: newUser,
					type: 'createUser',
					projectName: ctx.project?.name,
					temporaryPassword: password,
				});

				const newUserWithRole = {
					id: newUser.id,
					name: newUser.name,
					email: newUser.email,
					role: 'user',
				};

				return { newUser: newUserWithRole, password };
			}

			const existingMember = await projectQueries.getProjectMember(ctx.project!.id, user.id);
			if (existingMember) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'User is already a member of the project' });
			}

			await projectQueries.addProjectMember({
				userId: user.id,
				projectId: ctx.project!.id,
				role: 'user',
			});

			await emailService.safeSendEmail({
				user,
				type: 'createUser',
				projectName: ctx.project?.name,
			});

			const newUserWithRole = {
				id: user.id,
				name: user.name,
				email: user.email,
				role: 'user',
			};

			return { success: true, newUser: newUserWithRole };
		}),

	getMemorySettings: protectedProcedure.query(async ({ ctx }) => {
		const memoryEnabled = await userQueries.getMemoryEnabled(ctx.user.id);
		return { memoryEnabled };
	}),

	updateMemorySettings: protectedProcedure
		.input(z.object({ memoryEnabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			await userQueries.setMemoryEnabled(ctx.user.id, input.memoryEnabled);
			return { memoryEnabled: input.memoryEnabled };
		}),

	getMemories: protectedProcedure.query(async ({ ctx }) => {
		return memoryQueries.getUserMemories(ctx.user.id);
	}),

	updateMemory: protectedProcedure
		.input(
			z.object({
				memoryId: z.string(),
				content: z.string().trim().min(1).max(1000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const content = memoryService.normalizeMemoryContent(input.content);
			if (!content) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Memory content cannot be empty.' });
			}
			const updated = await memoryQueries.updateUserMemoryContent(ctx.user.id, input.memoryId, content);
			if (!updated) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found.' });
			}
			return updated;
		}),

	deleteMemory: protectedProcedure.input(z.object({ memoryId: z.string() })).mutation(async ({ ctx, input }) => {
		const deleted = await memoryQueries.deleteUserMemory(ctx.user.id, input.memoryId);
		if (!deleted) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found.' });
		}
	}),
};
