import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as memoryQueries from '../queries/memory';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import { addTeamMember } from '../services/team-member';
import { buildUserAddedEmail } from '../utils/email-builders';
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
			const projectId = ctx.project.id;

			return addTeamMember({
				email: input.email,
				name: input.name,
				checkExisting: async (userId) => !!(await projectQueries.getProjectMember(projectId, userId)),
				addMember: async (userId) => {
					await projectQueries.addProjectMember({ userId, projectId, role: 'user' });
				},
				buildEmail: (user, password) => buildUserAddedEmail(user, ctx.project.name, 'project', password),
			});
		}),

	getMemorySettings: protectedProcedure.query(async ({ ctx }) => {
		const memoryEnabled = await userQueries.getMemoryEnabled(ctx.user.id);
		return { memoryEnabled };
	}),

	getMemories: protectedProcedure.query(async ({ ctx }) => {
		return memoryQueries.getUserMemories(ctx.user.id);
	}),
};
