import { TOOL_CALL_DENSITIES } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { env } from '../env';
import * as memoryQueries from '../queries/memory';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import * as userPreferenceQueries from '../queries/user-preference.queries';
import { addTeamMember } from '../services/team-member';
import { buildUserAddedEmail } from '../utils/email-builders';
import { adminProtectedProcedure, projectProtectedProcedure, protectedProcedure, publicProcedure } from './trpc';

export const userRoutes = {
	hasUsers: publicProcedure.query(async () => {
		return (await userQueries.countUsers()) > 0;
	}),

	get: projectProtectedProcedure.input(z.object({ userId: z.string() })).query(async ({ input, ctx }) => {
		if (ctx.userRole !== 'admin' && input.userId !== ctx.user.id) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can access other users information' });
		}

		const user = await userQueries.getUser({ id: input.userId });
		if (!user) {
			return null;
		}
		return user;
	}),

	modify: adminProtectedProcedure
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
			const previousName = await userQueries.getUserName(input.userId);

			if (input.newRole && input.newRole !== previousRole) {
				await projectQueries.updateProjectMemberRole(ctx.project.id, input.userId, input.newRole);
			}
			if (input.name && input.name !== previousName) {
				await userQueries.updateUser(input.userId, input.name);
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
					await projectQueries.addProjectMember({ userId, projectId, role: env.DEFAULT_USER_ROLE });
				},
				buildEmail: (user, password) => buildUserAddedEmail(user, ctx.project.name, 'project', password),
			});
		}),

	getPreferences: protectedProcedure.query(async ({ ctx }) => {
		return userPreferenceQueries.getUserPreferences(ctx.user.id);
	}),

	updatePreferences: protectedProcedure
		.input(
			z.object({
				toolCallDensity: z.enum(TOOL_CALL_DENSITIES).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return userPreferenceQueries.updateUserPreferences(ctx.user.id, input);
		}),

	getMemorySettings: protectedProcedure.query(async ({ ctx }) => {
		const memoryEnabled = await userQueries.getUserMemoryEnabled(ctx.user.id);
		return { memoryEnabled };
	}),

	getMemories: protectedProcedure.query(async ({ ctx }) => {
		return memoryQueries.getUserMemories(ctx.user.id);
	}),
};
